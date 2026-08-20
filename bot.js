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
    DISCORD_RECRUITER_ROLE_ID,
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
    if (DISCORD_GUILD_ID) {
        await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID), { body: commands });
        console.log(`Registered slash commands to guild ${DISCORD_GUILD_ID}`);
    } else {
        await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), { body: commands });
        console.log('Registered global slash commands (can take up to an hour to show up everywhere)');
    }
}

function statusColor(status) {
    return { pending: 0xD8AC50, in_review: 0x7C76E8, accepted: 0x178A4C, rejected: 0xB3311C, withdrawn: 0x8A93A3 }[status] || 0x8A93A3;
}

async function requireRecruiterRole(interaction) {
    if (!DISCORD_RECRUITER_ROLE_ID) return true;
    const member = interaction.member;
    const has = member && member.roles && member.roles.cache && member.roles.cache.has(DISCORD_RECRUITER_ROLE_ID);
    if (!has) {
        await interaction.reply({ content: "You don't have the recruiter role for this.", ephemeral: true });
        return false;
    }
    return true;
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

        if (interaction.isButton()) {
            const [, action, ticketId] = interaction.customId.match(/^recruit_(accept|reject|claim)_(.+)$/) || [];
            if (!action) return;

            if (!(await requireRecruiterRole(interaction))) return;

            const { data: ticket, error } = await supabase.from('recruitment_tickets').select('*').eq('id', ticketId).maybeSingle();
            if (error || !ticket) { await interaction.reply({ content: 'That ticket no longer exists.', ephemeral: true }); return; }

            if (action === 'claim') {
                await supabase.from('recruitment_tickets').update({
                    assigned_to_username: interaction.user.username,
                    status: ticket.status === 'pending' ? 'in_review' : ticket.status,
                    updated_at: new Date().toISOString()
                }).eq('id', ticketId);
                await interaction.reply({ content: `Claimed by ${interaction.user}.`, ephemeral: false });
                return;
            }

            const newStatus = action === 'accept' ? 'accepted' : 'rejected';
            const updates = {
                status: newStatus,
                closed_at: new Date().toISOString(),
                closed_by_username: interaction.user.username,
                updated_at: new Date().toISOString()
            };
            if (!ticket.first_response_at) {
                updates.first_response_at = new Date().toISOString();
                updates.first_response_by_username = interaction.user.username;
            }
            await supabase.from('recruitment_tickets').update(updates).eq('id', ticketId);
            await supabase.from('recruitment_messages').insert({
                ticket_id: ticketId, author_type: 'staff', author_username: interaction.user.username,
                body: `Marked ${newStatus} via Discord.`, internal_note: true
            });

            await interaction.reply({
                content: `**${ticket.roblox_username}**'s application marked **${newStatus}** by ${interaction.user}. <@${ticket.discord_user_id}>`
            });

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

            await supabase.from('user_assignments').upsert({
                roblox_user_id: ticket.roblox_user_id,
                roblox_username: ticket.roblox_username,
                team_id: team.id,
                skillset_id: ticket.skillset_id || null,
                assigned_at: new Date().toISOString()
            }, { onConflict: 'roblox_user_id,team_id' });

            await supabase.from('recruitment_tickets').update({
                placed_team_id: team.id,
                placed_team_name: team.name,
                placed_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }).eq('id', ticketId);

            // Grant the HR-tool roles tied to this team/skillset so the recruit
            // actually gets access on the website, not just the DB fields.
            const roleIds = [...new Set([team.role_id, skillset && skillset.role_id].filter(v => v != null))];
            let grantedRoleNames = [];
            if (roleIds.length) {
                const { data: roleRows } = await supabase.from('roles').select('id, name').in('id', roleIds);
                grantedRoleNames = (roleRows || []).map(r => r.name);
                for (const roleId of roleIds) {
                    const { error: assignErr } = await supabase.from('user_role_assignments').insert({
                        roblox_user_id: ticket.roblox_user_id,
                        role_id: roleId,
                        roblox_username: ticket.roblox_username
                    });
                    if (assignErr && assignErr.code !== '23505') {
                        console.error('Failed to grant role', roleId, 'to', ticket.roblox_user_id, assignErr.message);
                    }
                }
            }

            const roleSummary = grantedRoleNames.length ? ` Granted role(s): **${grantedRoleNames.join(', ')}**.` : '';
            await interaction.editReply({ content: `Placed **${ticket.roblox_username}** on **${team.name}** (by ${interaction.user}).${roleSummary}` });

            try {
                const link = await supabase.from('discord_links').select('discord_user_id').eq('roblox_user_id', ticket.roblox_user_id).maybeSingle();
                const discordUserId = (link.data && link.data.discord_user_id) || ticket.discord_user_id;
                const user = await client.users.fetch(discordUserId);
                const parts = [`You've been accepted and placed on the **${team.name}** team!`];
                if (skillset) parts.push(`Skillset: **${skillset.name}**.`);
                if (grantedRoleNames.length) parts.push(`You now have access on the site as: **${grantedRoleNames.join(', ')}**.`);
                if (APP_ORIGIN) parts.push(`Check it out here: ${APP_ORIGIN}/#/recruit/status`);
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
    await registerCommands();
    await client.login(DISCORD_BOT_TOKEN);
})();