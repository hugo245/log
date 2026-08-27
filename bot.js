const {
    Client, GatewayIntentBits, Events,
    SlashCommandBuilder, EmbedBuilder, REST, Routes,
    ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const {
    DISCORD_BOT_TOKEN,
    DISCORD_CLIENT_ID,
    DISCORD_GUILD_ID,
    DISCORD_HR_ROLE_ID,
    DISCORD_HR_ROLE_IDS,
    DISCORD_LEAD_ROLE_ID,
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    APP_ORIGIN
} = process.env;

const LEAD_ROLE_ID = DISCORD_LEAD_ROLE_ID || '1539922527013572668';

// Comma-separated list supported via DISCORD_HR_ROLE_IDS, or a single id via DISCORD_HR_ROLE_ID.
const HR_ROLE_IDS = (DISCORD_HR_ROLE_IDS || DISCORD_HR_ROLE_ID || '')
    .split(',').map(s => s.trim()).filter(Boolean);
if (!HR_ROLE_IDS.length) {
    console.warn('DISCORD_HR_ROLE_ID(S) not set - the ticket panel (Accept/Reject/Claim/Configure) will be usable by anyone.');
}

for (const [name, val] of Object.entries({ DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY })) {
    if (!val) { console.error(`Missing required env var: ${name}`); process.exit(1); }
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
    new SlashCommandBuilder()
        .setName('recruit-stats')
        .setDescription('Quick recruitment pipeline totals'),
    new SlashCommandBuilder()
        .setName('recruit-ticket')
        .setDescription('Look up a recruitment application by ticket id')
        .addStringOption(opt => opt.setName('id').setDescription('Ticket id').setRequired(true))
].map(c => c.toJSON());

async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);
    try {
        if (DISCORD_GUILD_ID) {
            await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID), { body: commands });
            console.log(`Registered slash commands to guild ${DISCORD_GUILD_ID}`);
        } else {
            await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), { body: commands });
            console.log('Registered global slash commands (can take up to an hour to show up everywhere)');
        }
    } catch (e) {
        if (e && e.status === 429) {
            console.error(`registerCommands: Discord rate-limited this request (429)${e.retryAfter ? `, retry after ${e.retryAfter}s` : ''}. Not retrying immediately to avoid making the block worse.`);
        }
        throw e;
    }
}

function generateRequestId() {
    const rand = Math.floor(100000 + Math.random() * 900000);
    const stamp = Date.now().toString(36).slice(-4);
    return `PV_${rand}_${stamp}`;
}

// Configurable recruitment auto-hire settings, mirrors server.js's copy - kept in app_settings so
// both processes (and the dashboard) read/write the same source of truth.
async function getRecruitmentConfig() {
    const { data, error } = await supabase
        .from('app_settings')
        .select('recruitment_auto_role_id, recruitment_discord_role_id, recruitment_grace_period_hours')
        .eq('id', 1)
        .maybeSingle();
    if (error) throw error;
    return {
        autoRoleId: data && data.recruitment_auto_role_id != null ? String(data.recruitment_auto_role_id) : null,
        discordRoleId: data && data.recruitment_discord_role_id ? String(data.recruitment_discord_role_id) : null,
        gracePeriodHours: data && data.recruitment_grace_period_hours != null ? Number(data.recruitment_grace_period_hours) : null
    };
}

async function grantAutoHireRole(ticket, roleId) {
    if (!roleId || !ticket.roblox_user_id) return;
    const { error } = await supabase.from('user_role_assignments').insert({
        roblox_user_id: ticket.roblox_user_id,
        role_id: roleId,
        roblox_username: ticket.roblox_username
    });
    if (error && error.code !== '23505') console.error('grantAutoHireRole failed:', error.message);
}

async function grantDiscordRole(guild, discordUserId, roleId) {
    if (!guild || !discordUserId || !roleId) return;
    try {
        const member = await guild.members.fetch(discordUserId);
        await member.roles.add(roleId);
    } catch (e) {
        console.error(`grantDiscordRole: failed to add role ${roleId} to ${discordUserId}:`, e.message);
    }
}

async function logSystemPaymentRequest({ robloxUserId, robloxUsername, taskName, note }) {
    if (!robloxUserId || !robloxUsername) return null;
    const id = generateRequestId();
    const { error } = await supabase.from('payment_requests').insert({
        id,
        requested_by: 'System',
        roblox_username: robloxUsername,
        roblox_user_id: robloxUserId,
        task_name: taskName,
        game: 'Recruitment',
        work_raw: note || '',
        time_worked: '',
        payment: 1000,
        currency: 'ROBUX',
        paid: false,
        paid_at: null,
        created_at: new Date().toISOString()
    });
    if (error) { console.error('logSystemPaymentRequest failed:', error.message); return null; }
    return id;
}

// Resolves the Roblox identity of a staff member from their Discord id, via the same discord_links
// table applicants use to link their accounts (staff go through the same Roblox+Discord linking).
async function resolveRobloxForDiscordUser(discordUserId) {
    if (!discordUserId) return null;
    const { data } = await supabase.from('discord_links').select('roblox_user_id, roblox_username').eq('discord_user_id', discordUserId).maybeSingle();
    return data || null;
}

// Runs once per ticket the moment it becomes "accepted": grants the configured tool/Discord roles,
// and auto-logs 1,000 Robux payment requests (from "System") to the referrer and the reviewer.
// Idempotency flags on the ticket keep this from double-granting/double-paying.
async function processHire(ticket, { reviewerUserId, reviewerUsername, guild }) {
    try {
        const config = await getRecruitmentConfig();
        const flagUpdates = {};

        if (!ticket.hire_role_granted) {
            if (config.autoRoleId) await grantAutoHireRole(ticket, config.autoRoleId);
            if (config.discordRoleId && ticket.discord_user_id) await grantDiscordRole(guild, ticket.discord_user_id, config.discordRoleId);
            flagUpdates.hire_role_granted = true;
        }

        if (!ticket.referral_reward_logged && ticket.referred_by_user_id
            && String(ticket.referred_by_user_id) !== String(ticket.roblox_user_id)) {
            await logSystemPaymentRequest({
                robloxUserId: ticket.referred_by_user_id,
                robloxUsername: ticket.referred_by_username,
                taskName: 'Referral bonus',
                note: `Referral bonus for ${ticket.roblox_username} being hired (ticket ${ticket.id}).`
            });
            flagUpdates.referral_reward_logged = true;
        }

        if (!ticket.reviewer_reward_logged && reviewerUserId && reviewerUsername
            && String(reviewerUserId) !== String(ticket.roblox_user_id)) {
            await logSystemPaymentRequest({
                robloxUserId: reviewerUserId,
                robloxUsername: reviewerUsername,
                taskName: 'Recruitment ticket review',
                note: `Reviewed and accepted ${ticket.roblox_username}'s application (ticket ${ticket.id}).`
            });
            flagUpdates.reviewer_reward_logged = true;
        }

        if (Object.keys(flagUpdates).length) {
            await supabase.from('recruitment_tickets').update(flagUpdates).eq('id', ticket.id);
        }
    } catch (e) {
        console.error(`processHire failed for ticket ${ticket.id}:`, e.message);
    }
}

function statusColor(status) {
    return { pending: 0xD8AC50, in_review: 0x7C76E8, accepted: 0x178A4C, rejected: 0xB3311C, withdrawn: 0x8A93A3 }[status] || 0x8A93A3;
}

async function upsertUserAssignment({ robloxUserId, robloxUsername, teamId, skillsetId }) {
    if (!robloxUserId || !teamId) return { ok: false, error: 'missing_fields' };

    const { data: existing, error: findErr } = await supabase
        .from('user_assignments')
        .select('roblox_user_id, team_id')
        .eq('roblox_user_id', robloxUserId)
        .eq('team_id', teamId)
        .maybeSingle();
    if (findErr) return { ok: false, error: findErr.message };

    if (existing) {
        const { error: updateErr } = await supabase.from('user_assignments')
            .update({
                roblox_username: robloxUsername,
                skillset_id: skillsetId ?? null,
                assigned_at: new Date().toISOString()
            })
            .eq('roblox_user_id', robloxUserId)
            .eq('team_id', teamId);
        if (updateErr) return { ok: false, error: updateErr.message };
        return { ok: true, mode: 'updated' };
    }

    const { error: insertErr } = await supabase.from('user_assignments').insert({
        roblox_user_id: robloxUserId,
        roblox_username: robloxUsername,
        team_id: teamId,
        skillset_id: skillsetId ?? null,
        assigned_at: new Date().toISOString()
    });
    if (insertErr) return { ok: false, error: insertErr.message };
    return { ok: true, mode: 'inserted' };
}

const RECONCILE_INTERVAL_MS = 6 * 60 * 60 * 1000;
let nextReconcileAt = null;

async function reconcilePlacements() {
    nextReconcileAt = Date.now() + RECONCILE_INTERVAL_MS;

    const { data: tickets, error } = await supabase
        .from('recruitment_tickets')
        .select('roblox_user_id, roblox_username, skillset_id, skillset_name, placed_team_id, placed_team_name')
        .not('placed_team_id', 'is', null);
    if (error) { console.error('reconcilePlacements: could not load tickets:', error.message); return; }

    let fixed = 0;
    for (const ticket of tickets || []) {
        let skillsetId = ticket.skillset_id || null;
        if (!skillsetId && ticket.skillset_name) {
            const { data: skillsetRow } = await supabase.from('skillsets').select('id').eq('name', ticket.skillset_name).maybeSingle();
            skillsetId = skillsetRow ? skillsetRow.id : null;
        }
        const result = await upsertUserAssignment({
            robloxUserId: ticket.roblox_user_id,
            robloxUsername: ticket.roblox_username,
            teamId: ticket.placed_team_id,
            skillsetId
        });
        if (!result.ok) {
            console.error(`reconcilePlacements: failed for ${ticket.roblox_username} (${ticket.roblox_user_id}):`, result.error);
        } else if (result.mode === 'inserted') {
            fixed++;
        }
    }
    if (fixed) console.log(`reconcilePlacements: rolled in ${fixed} pending placement(s).`);
}

function nextReconcileUnix() {
    return nextReconcileAt ? Math.floor(nextReconcileAt / 1000) : null;
}

function hasHRRole(member) {
    if (!HR_ROLE_IDS.length) return true;
    return !!(member && member.roles && member.roles.cache && HR_ROLE_IDS.some(id => member.roles.cache.has(id)));
}

async function requireHRRole(interaction) {
    if (hasHRRole(interaction.member)) return true;
    await interaction.reply({ content: "Only HR roles can use this ticket panel.", ephemeral: true });
    return false;
}

async function requireLeadRole(interaction) {
    const member = interaction.member;
    const has = member && member.roles && member.roles.cache && member.roles.cache.has(LEAD_ROLE_ID);
    if (!has) {
        await interaction.reply({ content: "Only leads can use this panel.", ephemeral: true });
        return false;
    }
    return true;
}

function ticketEmbed(ticket) {
    return new EmbedBuilder()
        .setTitle(`Application: ${ticket.roblox_username}`)
        .setColor(statusColor(ticket.status))
        .addFields(
            { name: 'Status', value: ticket.status, inline: true },
            { name: 'Discord', value: `<@${ticket.discord_user_id}>`, inline: true },
            { name: 'Position', value: ticket.position || 'Not specified', inline: true },
            { name: 'Referred by', value: ticket.referred_by_username || 'None', inline: true },
            { name: 'Assigned to', value: ticket.assigned_to_username || 'Unassigned', inline: true },
            { name: 'Experience', value: (ticket.experience || 'N/A').slice(0, 500) },
            { name: 'Why they want to join', value: (ticket.why_join || 'N/A').slice(0, 500) }
        )
        .setFooter({ text: `Ticket ${ticket.id}` })
        .setTimestamp(new Date(ticket.created_at));
}

// Rebuilds and re-sends the pinned panel embed for a ticket channel (used after Accept/Reject/Claim/Configure).
async function refreshTicketPanel(interaction, ticket) {
    if (!ticket.ticket_message_id || !ticket.discord_channel_id) return;
    try {
        const channel = await client.channels.fetch(ticket.discord_channel_id);
        const message = await channel.messages.fetch(ticket.ticket_message_id);
        await message.edit({ embeds: [ticketEmbed(ticket)] });
    } catch (e) {
        console.error('refreshTicketPanel failed:', e.message);
    }
}

client.once(Events.ClientReady, c => {
    console.log(`Logged in as ${c.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
    try {
        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === 'recruit-stats') {
                await interaction.deferReply({ ephemeral: true });
                const { data: tickets, error } = await supabase.from('recruitment_tickets').select('status');
                if (error) { await interaction.editReply('Could not load stats: ' + error.message); return; }
                const counts = { pending: 0, in_review: 0, accepted: 0, rejected: 0, withdrawn: 0 };
                (tickets || []).forEach(t => { counts[t.status] = (counts[t.status] || 0) + 1; });
                const embed = new EmbedBuilder()
                    .setTitle('Recruitment pipeline')
                    .setColor(0x3730D9)
                    .addFields(
                        { name: 'Total', value: String(tickets.length), inline: true },
                        { name: 'Pending', value: String(counts.pending), inline: true },
                        { name: 'In review', value: String(counts.in_review), inline: true },
                        { name: 'Accepted (hired)', value: String(counts.accepted), inline: true },
                        { name: 'Rejected', value: String(counts.rejected), inline: true },
                        { name: 'Withdrawn', value: String(counts.withdrawn), inline: true }
                    );
                await interaction.editReply({ embeds: [embed] });
                return;
            }

            if (interaction.commandName === 'recruit-ticket') {
                await interaction.deferReply({ ephemeral: true });
                const id = interaction.options.getString('id');
                const { data: ticket, error } = await supabase.from('recruitment_tickets').select('*').eq('id', id).maybeSingle();
                if (error || !ticket) { await interaction.editReply('No ticket found with that id.'); return; }
                await interaction.editReply({ embeds: [ticketEmbed(ticket)] });
                return;
            }
        }

        if (interaction.isButton()) {
            const [, action, ticketId] = interaction.customId.match(/^recruit_(accept|reject|claim|config)_(.+)$/) || [];
            if (!action) return;

            if (!(await requireHRRole(interaction))) return;

            const { data: ticket, error } = await supabase.from('recruitment_tickets').select('*').eq('id', ticketId).maybeSingle();
            if (error || !ticket) { await interaction.reply({ content: 'That ticket no longer exists.', ephemeral: true }); return; }

            if (action === 'config') {
                const modal = new ModalBuilder()
                    .setCustomId(`recruit_config_modal_${ticketId}`)
                    .setTitle('Configure application');
                const positionInput = new TextInputBuilder()
                    .setCustomId('position')
                    .setLabel('Position applied for')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setMaxLength(100)
                    .setValue(ticket.position || '');
                modal.addComponents(new ActionRowBuilder().addComponents(positionInput));
                await interaction.showModal(modal);
                return;
            }

            if (action === 'claim') {
                const updates = {
                    assigned_to_username: interaction.user.username,
                    status: ticket.status === 'pending' ? 'in_review' : ticket.status,
                    updated_at: new Date().toISOString()
                };
                await supabase.from('recruitment_tickets').update(updates).eq('id', ticketId);
                await interaction.reply({ content: `Claimed by ${interaction.user}.`, ephemeral: false });
                await refreshTicketPanel(interaction, { ...ticket, ...updates });
                return;
            }

            const newStatus = action === 'accept' ? 'accepted' : 'rejected';
            let reviewerLink = null;
            if (newStatus === 'accepted') {
                reviewerLink = await resolveRobloxForDiscordUser(interaction.user.id);
                if (!reviewerLink) {
                    console.warn(`recruit_accept: ${interaction.user.tag} (${interaction.user.id}) has no discord_links entry - skipping their reviewer bonus.`);
                }
            }
            const updates = {
                status: newStatus,
                closed_at: new Date().toISOString(),
                closed_by_username: interaction.user.username,
                closed_by_roblox_user_id: reviewerLink ? reviewerLink.roblox_user_id : null,
                closed_by_roblox_username: reviewerLink ? reviewerLink.roblox_username : null,
                updated_at: new Date().toISOString()
            };
            if (!ticket.first_response_at) {
                updates.first_response_at = new Date().toISOString();
                updates.first_response_by_username = interaction.user.username;
            }
            await supabase.from('recruitment_tickets').update(updates).eq('id', ticketId);

            await interaction.reply({
                content: `**${ticket.roblox_username}**'s application marked **${newStatus}** by ${interaction.user}. <@${ticket.discord_user_id}>`
            });
            await refreshTicketPanel(interaction, { ...ticket, ...updates });

            if (newStatus === 'accepted' && ticket.status !== 'accepted') {
                await processHire({ ...ticket, ...updates }, {
                    reviewerUserId: reviewerLink ? reviewerLink.roblox_user_id : null,
                    reviewerUsername: reviewerLink ? reviewerLink.roblox_username : null,
                    guild: interaction.guild
                });
            }

            try {
                const link = await supabase.from('discord_links').select('discord_user_id').eq('roblox_user_id', ticket.roblox_user_id).maybeSingle();
                const discordUserId = (link.data && link.data.discord_user_id) || ticket.discord_user_id;
                const user = await client.users.fetch(discordUserId);
                if (newStatus === 'accepted') {
                    await user.send(`Congrats! Your PlayVerse application was **accepted**. Someone from the team will reach out here shortly.`);
                } else {
                    await user.send(`Thanks for applying to PlayVerse. Unfortunately your application wasn't accepted this time. You're welcome to apply again in the future.`);
                }
            } catch (e) { }
            return;
        }

        if (interaction.isModalSubmit()) {
            const [, ticketId] = interaction.customId.match(/^recruit_config_modal_(.+)$/) || [];
            if (!ticketId) return;
            if (!hasHRRole(interaction.member)) {
                await interaction.reply({ content: "Only HR roles can configure this application.", ephemeral: true });
                return;
            }

            const { data: ticket, error } = await supabase.from('recruitment_tickets').select('*').eq('id', ticketId).maybeSingle();
            if (error || !ticket) { await interaction.reply({ content: 'That ticket no longer exists.', ephemeral: true }); return; }

            const position = interaction.fields.getTextInputValue('position').trim() || null;
            const updates = { position, updated_at: new Date().toISOString() };
            const { error: updateErr } = await supabase.from('recruitment_tickets').update(updates).eq('id', ticketId);
            if (updateErr) {
                await interaction.reply({ content: `Could not save that: ${updateErr.message}`, ephemeral: true });
                return;
            }

            await interaction.reply({ content: `Updated by ${interaction.user}: position set to **${position || 'Not specified'}**.`, ephemeral: false });
            await refreshTicketPanel(interaction, { ...ticket, ...updates });
            return;
        }

        if (interaction.isStringSelectMenu()) {
            const [, ticketId] = interaction.customId.match(/^nextphase_team_(.+)$/) || [];
            if (!ticketId) return;
            if (!(await requireLeadRole(interaction))) return;

            await interaction.deferReply();

            const teamId = Number(interaction.values[0]);
            const { data: ticket, error } = await supabase.from('recruitment_tickets').select('*').eq('id', ticketId).maybeSingle();
            if (error || !ticket) { await interaction.editReply({ content: 'That ticket no longer exists.' }); return; }

            const { data: team } = await supabase.from('teams').select('*').eq('id', teamId).maybeSingle();
            if (!team) { await interaction.editReply({ content: 'That team no longer exists.' }); return; }

            let skillset = null;
            if (ticket.skillset_id) {
                const { data: skillsetRow } = await supabase.from('skillsets').select('*').eq('id', ticket.skillset_id).maybeSingle();
                skillset = skillsetRow || null;
            }

            const { error: updateErr } = await supabase.from('recruitment_tickets').update({
                placed_team_id: team.id,
                placed_team_name: team.name,
                placed_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }).eq('id', ticketId);
            if (updateErr) {
                await interaction.editReply({ content: `Couldn't save that placement: ${updateErr.message}` });
                return;
            }

            const nextRunUnix = nextReconcileUnix();
            const nextRunNote = nextRunUnix
                ? ` They'll be rolled into the system automatically <t:${nextRunUnix}:R>, or use **Manual Roling** on the dashboard to give them access right now.`
                : ` They'll be rolled into the system on the next scheduled batch, or use **Manual Roling** on the dashboard to give them access right now.`;
            await interaction.editReply({
                content: `✅ **${ticket.roblox_username}** confirmed for **${team.name}**${skillset ? ` as **${skillset.name}**` : ''} (by ${interaction.user}).${nextRunNote}`
            });

            try {
                const link = await supabase.from('discord_links').select('discord_user_id').eq('roblox_user_id', ticket.roblox_user_id).maybeSingle();
                const discordUserId = (link.data && link.data.discord_user_id) || ticket.discord_user_id;
                const user = await client.users.fetch(discordUserId);
                const parts = [`You've been accepted and placed on the **${team.name}** team!`];
                if (skillset) parts.push(`Skillset: **${skillset.name}**.`);
                parts.push(nextRunUnix
                    ? `Your access will finish setting up automatically <t:${nextRunUnix}:R>, a lead can also speed this up for you if needed.`
                    : `Your access will finish setting up shortly, a lead can also speed this up for you if needed.`);
                if (APP_ORIGIN) parts.push(`Check your status here: ${APP_ORIGIN}/#/recruit/status`);
                await user.send(parts.join(' '));
            } catch (e) { }
            return;
        }

        if (interaction.isRoleSelectMenu()) {
            const [, ticketId] = interaction.customId.match(/^nextphase_roles_(.+)$/) || [];
            if (!ticketId) return;
            if (!(await requireLeadRole(interaction))) return;

            const { data: ticket, error } = await supabase.from('recruitment_tickets').select('*').eq('id', ticketId).maybeSingle();
            if (error || !ticket) { await interaction.reply({ content: 'That ticket no longer exists.', ephemeral: true }); return; }

            const selectedRoles = interaction.roles;
            if (!selectedRoles || !selectedRoles.size) { await interaction.reply({ content: 'No roles selected.', ephemeral: true }); return; }

            await interaction.deferReply();
            try {
                const guild = interaction.guild;
                const member = await guild.members.fetch(ticket.discord_user_id);
                const roleIds = [...selectedRoles.keys()];
                await member.roles.add(roleIds);
                const roleNames = [...selectedRoles.values()].map(r => r.name).join(', ');
                await interaction.editReply({ content: `Granted **${ticket.roblox_username}** (<@${ticket.discord_user_id}>) the role(s): ${roleNames} (by ${interaction.user}).` });
            } catch (e) {
                await interaction.editReply({ content: `Could not assign those roles: ${e.message}. Make sure the bot's own role sits above them in the role list.` });
            }
            return;
        }
    } catch (e) {
        console.error('Interaction handling failed:', e);
        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
            try { await interaction.reply({ content: 'Something went wrong handling that.', ephemeral: true }); } catch (e2) { }
        }
    }
});

const http = require('http');
http.createServer((req, res) => res.end('bot is alive')).listen(4000);

(async () => {
    try {
        await registerCommands();
    } catch (e) {
        // Don't let a failed command registration (e.g. Discord's global rate limit, or a
        // transient network error) take down the whole bot process. Slash commands can be
        // registered again on a later boot - what matters is that the bot still logs in and
        // keeps handling tickets/buttons in the meantime.
        console.error('registerCommands failed, continuing without re-registering slash commands:', e.message);
    }
    try {
        await client.login(DISCORD_BOT_TOKEN);
    } catch (e) {
        console.error('client.login failed - the bot will not be able to handle interactions:', e.message);
        return;
    }
    try {
        await reconcilePlacements();
    } catch (e) {
        console.error('initial reconcilePlacements failed:', e.message);
    }
    setInterval(reconcilePlacements, RECONCILE_INTERVAL_MS);
})();