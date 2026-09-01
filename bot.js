const {
    Client, GatewayIntentBits, Events,
    SlashCommandBuilder, EmbedBuilder, REST, Routes
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const {
    DISCORD_BOT_TOKEN,
    DISCORD_CLIENT_ID,
    DISCORD_GUILD_ID,
    DISCORD_LEAD_ROLE_ID,
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    APP_ORIGIN
} = process.env;

const LEAD_ROLE_ID = DISCORD_LEAD_ROLE_ID || '1539922527013572668';

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

function statusColor(status) {
    return { pending: 0xD8AC50, in_review: 0x7C76E8, accepted: 0x178A4C, team_selection: 0x3730D9, finalised: 0x2B6CB0, rejected: 0xB3311C, withdrawn: 0x8A93A3 }[status] || 0x8A93A3;
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
const TICKET_AUTO_DELETE_DELAY_MS = 12 * 60 * 60 * 1000; // 12 hours

// Marks a ticket "finalised" once it's been placed on a team AND actually roled in (in
// user_assignments) - the very end of the recruitment pipeline. Posts a heads-up in the ticket's
// Discord channel that it'll be auto-deleted in 12 hours; server.js schedules that deletion.
async function finalizeAfterRoling(ticket) {
    if (!ticket || ticket.status === 'finalised') return;
    const nowIso = new Date().toISOString();
    const deleteAt = new Date(Date.now() + TICKET_AUTO_DELETE_DELAY_MS).toISOString();
    const { error } = await supabase.from('recruitment_tickets').update({
        status: 'finalised',
        finalised_at: nowIso,
        channel_delete_at: deleteAt,
        updated_at: nowIso
    }).eq('id', ticket.id);
    if (error) { console.error(`finalizeAfterRoling: failed updating ticket ${ticket.id}:`, error.message); return; }

    if (ticket.discord_channel_id) {
        try {
            const channel = await client.channels.fetch(ticket.discord_channel_id);
            await channel.send(`✅ **${ticket.roblox_username}** has been fully placed and roled onto their team. This ticket channel will be automatically deleted in 12 hours.`);
        } catch (e) {
            console.error(`finalizeAfterRoling: failed to post message in channel ${ticket.discord_channel_id}:`, e.message);
        }
    }
}

async function reconcilePlacements() {
    nextReconcileAt = Date.now() + RECONCILE_INTERVAL_MS;

    const { data: tickets, error } = await supabase
        .from('recruitment_tickets')
        .select('id, status, roblox_user_id, roblox_username, skillset_id, skillset_name, placed_team_id, placed_team_name, discord_channel_id')
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
            continue;
        }
        if (result.mode === 'inserted') fixed++;
        if (ticket.status !== 'finalised') await finalizeAfterRoling(ticket);
    }
    if (fixed) console.log(`reconcilePlacements: rolled in ${fixed} pending placement(s).`);
}

function nextReconcileUnix() {
    return nextReconcileAt ? Math.floor(nextReconcileAt / 1000) : null;
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