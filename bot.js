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
    DISCORD_LEAD_CHANNEL_ID,
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
        .addStringOption(opt => opt.setName('id').setDescription('Ticket id').setRequired(true)),
    new SlashCommandBuilder()
        .setName('me')
        .setDescription('Your open work and what you are owed'),
    new SlashCommandBuilder()
        .setName('review')
        .setDescription('Work waiting on you to review'),
    new SlashCommandBuilder()
        .setName('run')
        .setDescription('How the current payment run is doing'),
    new SlashCommandBuilder()
        .setName('whois')
        .setDescription('Look someone up on the website')
        .addUserOption(opt => opt.setName('member').setDescription('Who to look up').setRequired(true)),
    new SlashCommandBuilder()
        .setName('note')
        .setDescription('Put a note on someone staff record')
        .addUserOption(opt => opt.setName('member').setDescription('Who it is about').setRequired(true))
        .addStringOption(opt => opt.setName('text').setDescription('What to record').setRequired(true)),
    new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Warn someone, recorded on their staff record')
        .addUserOption(opt => opt.setName('member').setDescription('Who to warn').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Why').setRequired(true)),
    new SlashCommandBuilder()
        .setName('health')
        .setDescription('Check the bot and database are responding')
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
    return { pending: 0xD8AC50, in_review: 0x7C76E8, accepted: 0x178A4C, team_selection: 0x3730D9, signed_off: 0x9D6BE0, finalised: 0x2B6CB0, rejected: 0xB3311C, withdrawn: 0x8A93A3 }[status] || 0x8A93A3;
}

async function getOnboardingGroupConfig() {
    const { data, error } = await supabase
        .from('app_settings')
        .select('onboarding_group_id, onboarding_group_role_id, recruitment_auto_role_id')
        .eq('id', 1)
        .maybeSingle();
    if (error) throw error;
    return {
        groupId: data && data.onboarding_group_id != null ? Number(data.onboarding_group_id) : null,
        groupRoleId: data && data.onboarding_group_role_id != null ? Number(data.onboarding_group_role_id) : null,
        autoRoleId: data && data.recruitment_auto_role_id ? String(data.recruitment_auto_role_id) : null
    };
}

async function grantAutoHireRole(robloxUserId, robloxUsername, roleId) {
    if (!roleId || !robloxUserId) return;
    const { error } = await supabase.from('user_role_assignments').insert({
        roblox_user_id: robloxUserId,
        role_id: roleId,
        roblox_username: robloxUsername
    });
    if (error && error.code !== '23505') console.error('grantAutoHireRole failed:', error.message);
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


async function grantInviteLinkAccess(flow) {
    if (!flow.link_token) return;

    const { data: link } = await supabase.from('onboarding_links').select('*').eq('token', flow.link_token).maybeSingle();
    const teamId = flow.team_id ?? (link && link.team_id) ?? null;
    const skillsetId = flow.skillset_id ?? (link && link.skillset_id) ?? null;
    const roleId = flow.role_id ?? (link && link.role_id) ?? null;
    if (!teamId) return;

    const result = await upsertUserAssignment({
        robloxUserId: flow.roblox_user_id,
        robloxUsername: flow.roblox_username,
        teamId,
        skillsetId
    });
    if (!result.ok) console.error(`grantInviteLinkAccess: failed to assign ${flow.roblox_username} to team ${teamId}:`, result.error);

    if (link) {
        await supabase.from('user_assignments')
            .update({ source_link_token: flow.link_token })
            .eq('roblox_user_id', flow.roblox_user_id)
            .eq('team_id', teamId);
    }

    if (!roleId) return;
    const { data: role } = await supabase.from('roles').select('*').eq('id', roleId).maybeSingle();
    if (!role) return;

    let meetsRankSafeguard = true;
    if (role.link_only && role.min_rank != null && role.roblox_group_id != null) {
        try {
            const res = await fetch(`https://groups.roblox.com/v1/users/${flow.roblox_user_id}/groups/roles`);
            const json = res.ok ? await res.json().catch(() => null) : null;
            const membership = (json && json.data || []).find(g => g.group && g.group.id === Number(role.roblox_group_id));
            const rank = membership ? membership.role.rank : null;
            meetsRankSafeguard = rank != null && rank === role.min_rank;
        } catch (e) {
            meetsRankSafeguard = false;
        }
    }
    if (!meetsRankSafeguard) return;

    const { error: roleAssignErr } = await supabase.from('user_role_assignments').insert({
        roblox_user_id: flow.roblox_user_id,
        role_id: roleId,
        roblox_username: flow.roblox_username
    });
    if (roleAssignErr && roleAssignErr.code !== '23505') {
        console.error(`grantInviteLinkAccess: failed to assign role ${roleId} to ${flow.roblox_username}:`, roleAssignErr.message);
    }
}

const RECONCILE_INTERVAL_MS = 6 * 60 * 60 * 1000;
let nextReconcileAt = null;
const TICKET_AUTO_DELETE_DELAY_MS = 12 * 60 * 60 * 1000;

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
            await channel.send(`${ticket.roblox_username} has been fully placed and roled onto their team. This ticket channel will be automatically deleted in 12 hours.`);
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
        .eq('status', 'finalised')
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
    }
    if (fixed) console.log(`reconcilePlacements: fixed ${fixed} finalised placement(s) missing from user_assignments.`);
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

async function ticketEmbed(ticket) {
    const fields = [
        { name: 'Status', value: ticket.status, inline: true },
        { name: 'Discord', value: `<@${ticket.discord_user_id}>`, inline: true },
        { name: 'Position', value: ticket.position || 'Not specified', inline: true },
        { name: 'Referred by', value: ticket.referred_by_username || 'None', inline: true },
        { name: 'Assigned to', value: ticket.assigned_to_username || 'Unassigned', inline: true }
    ];

    if (ticket.placed_team_id) {
        const { data: team } = await supabase.from('teams').select('name, roblox_group_url, roblox_group_id').eq('id', ticket.placed_team_id).maybeSingle();
        const groupUrl = team ? (team.roblox_group_url || (team.roblox_group_id ? `https://www.roblox.com/groups/${team.roblox_group_id}` : null)) : null;
        const teamName = (team && team.name) || ticket.placed_team_name || 'Not set';
        fields.push({ name: 'Team group', value: groupUrl ? `[${teamName}](${groupUrl})` : teamName, inline: true });
    }

    fields.push(
        { name: 'Experience', value: (ticket.experience || 'N/A').slice(0, 500) },
        { name: 'Why they want to join', value: (ticket.why_join || 'N/A').slice(0, 500) }
    );

    return new EmbedBuilder()
        .setTitle(`Application: ${ticket.roblox_username}`)
        .setColor(statusColor(ticket.status))
        .addFields(fields)
        .setFooter({ text: `Ticket ${ticket.id}` })
        .setTimestamp(new Date(ticket.created_at));
}

const BRAND = 0x3730D9;
const OK_GREEN = 0x178A4C;
const WARN_AMBER = 0xD8AC50;

function siteLink(path) {
    if (!APP_ORIGIN) return null;
    return `${APP_ORIGIN.replace(/\/$/, '')}/#${path}`;
}

function moneyLine(amount, currency) {
    if (!amount) return '';
    return currency === 'USD' ? `$${Number(amount).toFixed(2)}` : `R$ ${Math.round(Number(amount)).toLocaleString()}`;
}

function dueLine(dueAt) {
    if (!dueAt) return 'no due date';
    const diff = new Date(dueAt).getTime() - Date.now();
    const days = Math.round(Math.abs(diff) / 86400000);
    if (diff < 0) return days === 0 ? 'due today' : `${days} ${days === 1 ? 'day' : 'days'} late`;
    if (days === 0) return 'due today';
    return `due in ${days} ${days === 1 ? 'day' : 'days'}`;
}

async function viewerContext(discordUserId) {
    const { data: link } = await supabase
        .from('discord_links')
        .select('roblox_user_id, roblox_username')
        .eq('discord_user_id', discordUserId)
        .maybeSingle();
    if (!link || link.roblox_user_id == null) return null;

    const { data: assignments } = await supabase
        .from('user_role_assignments')
        .select('role_id')
        .eq('roblox_user_id', link.roblox_user_id);
    const roleIds = [...new Set((assignments || []).map(a => a.role_id).filter(id => id != null))];

    const permissions = new Set();
    const roleNames = [];
    let maxHierarchy = 0;
    if (roleIds.length) {
        const { data: roles } = await supabase.from('roles').select('id, name, hierarchy, permissions').in('id', roleIds);
        (roles || []).forEach(r => {
            (r.permissions || []).forEach(p => permissions.add(p));
            roleNames.push(r.name);
            const h = Number(r.hierarchy) || 0;
            if (h > maxHierarchy) maxHierarchy = h;
        });
    }
    return {
        robloxUserId: link.roblox_user_id,
        robloxUsername: link.roblox_username,
        permissions: [...permissions],
        roles: roleNames,
        maxHierarchy
    };
}

function viewerCan(viewer, permission) {
    return !!viewer && viewer.permissions.includes(permission);
}

async function requireLink(interaction) {
    const viewer = await viewerContext(interaction.user.id);
    if (!viewer) {
        const link = siteLink('/');
        await interaction.editReply(`Your Discord isn't linked to a PlayVerse account yet.${link ? ` Sign in at ${link} and link it from your account menu.` : ''}`);
        return null;
    }
    return viewer;
}

async function botAudit({ action, actorUserId, actorUsername, targetUserId, targetUsername, details }) {
    try {
        await supabase.from('audit_logs').insert({
            category: 'discord',
            action,
            actor_user_id: actorUserId != null ? actorUserId : null,
            actor_username: actorUsername || 'bot',
            target_user_id: targetUserId != null ? targetUserId : null,
            target_username: targetUsername || null,
            details: details || {},
            reverted: false,
            created_at: new Date().toISOString()
        });
    } catch (e) {
        console.error('[bot] audit insert failed:', e.message);
    }
}

async function dmRobloxUser(robloxUserId, text) {
    try {
        const { data: link } = await supabase
            .from('discord_links')
            .select('discord_user_id')
            .eq('roblox_user_id', robloxUserId)
            .maybeSingle();
        if (!link || !link.discord_user_id) return false;
        const user = await client.users.fetch(link.discord_user_id);
        await user.send(text);
        return true;
    } catch (e) {
        return false;
    }
}

async function reviewersForTask(task) {
    const ids = new Set();
    if (task.game_id) {
        const { data: game } = await supabase.from('games').select('producer_user_id').eq('id', task.game_id).maybeSingle();
        if (game && game.producer_user_id != null) ids.add(String(game.producer_user_id));
    }
    if (!ids.size && task.team_id != null) {
        const { data: members } = await supabase.from('user_assignments').select('roblox_user_id').eq('team_id', task.team_id);
        const memberIds = [...new Set((members || []).map(m => m.roblox_user_id).filter(id => id != null))];
        if (memberIds.length) {
            const { data: links } = await supabase.from('user_role_assignments').select('roblox_user_id, role_id').in('roblox_user_id', memberIds);
            const { data: roles } = await supabase.from('roles').select('id, hierarchy');
            const level = {};
            (roles || []).forEach(r => { level[String(r.id)] = Number(r.hierarchy) || 0; });
            const best = {};
            (links || []).forEach(l => {
                const key = String(l.roblox_user_id);
                const h = level[String(l.role_id)] || 0;
                if (!best[key] || h > best[key]) best[key] = h;
            });
            let top = 0;
            Object.values(best).forEach(h => { if (h > top) top = h; });
            if (top > 0) Object.keys(best).filter(k => best[k] === top).forEach(k => ids.add(k));
        }
    }
    return [...ids].filter(id => String(id) !== String(task.assigned_to_user_id));
}

const COMMAND_HANDLERS = {
    async me(interaction) {
        const viewer = await requireLink(interaction);
        if (!viewer) return;

        const [tasksRes, requestsRes, runRes] = await Promise.all([
            supabase.from('team_tasks').select('*').eq('assigned_to_user_id', viewer.robloxUserId).order('due_at', { ascending: true }).limit(40),
            supabase.from('payment_requests').select('payment, currency, status, paid').eq('roblox_user_id', viewer.robloxUserId).eq('paid', false),
            supabase.from('payment_runs').select('label, period_end').eq('status', 'open').limit(1)
        ]);
        const tasks = (tasksRes.data || []).filter(t => t.status !== 'done' && t.status !== 'cancelled');
        const open = tasks.filter(t => t.status !== 'review');
        const inReview = tasks.filter(t => t.status === 'review');

        let usd = 0, robux = 0, proposed = 0;
        (requestsRes.data || []).forEach(r => {
            if (r.status === 'rejected') return;
            if (r.status === 'proposed') { proposed++; return; }
            if (r.currency === 'USD') usd += Number(r.payment) || 0;
            else robux += Number(r.payment) || 0;
        });
        const run = (runRes.data || [])[0];

        const embed = new EmbedBuilder()
            .setTitle(`${viewer.robloxUsername}`)
            .setColor(BRAND)
            .addFields(
                { name: 'Open tasks', value: String(open.length), inline: true },
                { name: 'With your producer', value: String(inReview.length), inline: true },
                { name: 'Requests pending', value: String(proposed), inline: true },
                { name: 'Owed', value: [usd ? `$${usd.toFixed(2)}` : null, robux ? `R$ ${Math.round(robux).toLocaleString()}` : null].filter(Boolean).join(' and ') || 'Nothing right now' },
                { name: 'Next run', value: run ? `${run.label}, closes ${run.period_end}` : 'No run open yet' }
            );
        if (open.length) {
            embed.addFields({
                name: 'What is on you',
                value: open.slice(0, 8).map(t => `- ${t.title} (${dueLine(t.due_at)})${t.payment ? ' · ' + moneyLine(t.payment, t.currency) : ''}`).join('\n')
            });
        }
        const link = siteLink('/home');
        await interaction.editReply({ embeds: [embed], content: link ? `Full view: ${link}` : undefined });
    },

    async review(interaction) {
        const viewer = await requireLink(interaction);
        if (!viewer) return;

        const { data: rows } = await supabase.from('team_tasks').select('*').eq('status', 'review').order('submitted_at', { ascending: true });
        const all = rows || [];
        const mine = [];
        for (const t of all) {
            if (String(t.assigned_to_user_id) === String(viewer.robloxUserId)) continue;
            if (viewerCan(viewer, 'teams.manage')) { mine.push(t); continue; }
            const reviewers = await reviewersForTask(t);
            if (reviewers.includes(String(viewer.robloxUserId))) mine.push(t);
        }
        if (!mine.length) {
            await interaction.editReply('Nothing is waiting on you right now.');
            return;
        }
        const embed = new EmbedBuilder()
            .setTitle(`Waiting on you (${mine.length})`)
            .setColor(mine.length > 3 ? WARN_AMBER : BRAND)
            .setDescription(mine.slice(0, 10).map(t => {
                const link = siteLink(`/task/${t.id}`);
                const who = t.assigned_to_username || 'someone';
                return `- ${link ? `[${t.title}](${link})` : t.title} by ${who}${t.payment ? ' · ' + moneyLine(t.payment, t.currency) : ''}`;
            }).join('\n'));
        await interaction.editReply({ embeds: [embed] });
    },

    async run(interaction) {
        const viewer = await requireLink(interaction);
        if (!viewer) return;
        if (!viewerCan(viewer, 'dashboard.view')) {
            await interaction.editReply('You do not have access to the payments dashboard.');
            return;
        }
        const { data: runs } = await supabase.from('payment_runs').select('*').order('period_start', { ascending: false }).limit(1);
        const run = (runs || [])[0];
        if (!run) { await interaction.editReply('No payment runs have been created yet.'); return; }

        const { data: lines } = await supabase.from('payment_requests').select('payment, currency, paid').eq('run_id', run.id);
        const rows = lines || [];
        let usd = 0, robux = 0;
        rows.forEach(r => { if (r.currency === 'USD') usd += Number(r.payment) || 0; else robux += Number(r.payment) || 0; });

        const embed = new EmbedBuilder()
            .setTitle(run.label)
            .setColor(run.status === 'open' ? BRAND : run.status === 'closed' ? OK_GREEN : WARN_AMBER)
            .addFields(
                { name: 'Covers', value: `${run.period_start} to ${run.period_end}`, inline: true },
                { name: 'Status', value: run.status, inline: true },
                { name: 'Items', value: `${rows.filter(r => r.paid).length} paid of ${rows.length}`, inline: true },
                { name: 'Cash', value: `$${usd.toFixed(2)}`, inline: true },
                { name: 'Robux', value: `R$ ${Math.round(robux).toLocaleString()}`, inline: true }
            );
        const link = siteLink('/runs');
        await interaction.editReply({ embeds: [embed], content: link ? link : undefined });
    },

    async whois(interaction) {
        const viewer = await requireLink(interaction);
        if (!viewer) return;
        if (!viewerCan(viewer, 'staff.view_database')) {
            await interaction.editReply('You do not have access to the staff database.');
            return;
        }
        const target = interaction.options.getUser('member');
        const theirs = await viewerContext(target.id);
        if (!theirs) { await interaction.editReply(`${target.username} has not linked a PlayVerse account.`); return; }

        const [teamsRes, tasksRes] = await Promise.all([
            supabase.from('user_assignments').select('team_id').eq('roblox_user_id', theirs.robloxUserId),
            supabase.from('team_tasks').select('status').eq('assigned_to_user_id', theirs.robloxUserId)
        ]);
        const teamIds = [...new Set((teamsRes.data || []).map(a => a.team_id).filter(id => id != null))];
        let teamNames = [];
        if (teamIds.length) {
            const { data: teams } = await supabase.from('teams').select('name').in('id', teamIds);
            teamNames = (teams || []).map(t => t.name);
        }
        const tasks = tasksRes.data || [];
        const embed = new EmbedBuilder()
            .setTitle(theirs.robloxUsername)
            .setColor(BRAND)
            .addFields(
                { name: 'Discord', value: `<@${target.id}>`, inline: true },
                { name: 'Roblox id', value: String(theirs.robloxUserId), inline: true },
                { name: 'Roles', value: theirs.roles.join(', ') || 'None', inline: true },
                { name: 'Teams', value: teamNames.join(', ') || 'None', inline: true },
                { name: 'Open tasks', value: String(tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled').length), inline: true },
                { name: 'Finished', value: String(tasks.filter(t => t.status === 'done').length), inline: true }
            );
        await interaction.editReply({ embeds: [embed] });
    },

    async note(interaction) {
        const viewer = await requireLink(interaction);
        if (!viewer) return;
        if (!viewerCan(viewer, 'staff.moderate')) { await interaction.editReply('You do not have permission to add staff notes.'); return; }
        const target = interaction.options.getUser('member');
        const text = interaction.options.getString('text');
        const theirs = await viewerContext(target.id);
        if (!theirs) { await interaction.editReply(`${target.username} has not linked a PlayVerse account, so there is nothing to attach a note to.`); return; }
        if (theirs.maxHierarchy >= viewer.maxHierarchy) { await interaction.editReply('Their role is at or above yours, so you cannot add notes to their record.'); return; }

        await botAudit({
            action: 'note', actorUserId: viewer.robloxUserId, actorUsername: viewer.robloxUsername,
            targetUserId: theirs.robloxUserId, targetUsername: theirs.robloxUsername,
            details: { note: text, via: 'discord' }
        });
        await interaction.editReply(`Noted on ${theirs.robloxUsername}'s record.`);
    },

    async warn(interaction) {
        const viewer = await requireLink(interaction);
        if (!viewer) return;
        if (!viewerCan(viewer, 'staff.moderate')) { await interaction.editReply('You do not have permission to warn people.'); return; }
        const target = interaction.options.getUser('member');
        const reason = interaction.options.getString('reason');
        const theirs = await viewerContext(target.id);
        if (!theirs) { await interaction.editReply(`${target.username} has not linked a PlayVerse account, so a warning cannot be recorded.`); return; }
        if (String(theirs.robloxUserId) === String(viewer.robloxUserId)) { await interaction.editReply('You cannot warn your own account.'); return; }
        if (theirs.maxHierarchy >= viewer.maxHierarchy) { await interaction.editReply('Their role is at or above yours, so you cannot warn them.'); return; }

        const { error } = await supabase.from('staff_warnings').insert({
            roblox_user_id: theirs.robloxUserId,
            roblox_username: theirs.robloxUsername,
            reason,
            issued_by: viewer.robloxUsername,
            issued_by_user_id: viewer.robloxUserId,
            created_at: new Date().toISOString()
        });
        if (error) {
            console.error('[bot] warn insert failed:', error.message);
            await interaction.editReply('Could not save that warning. Tell an admin.');
            return;
        }
        await botAudit({
            action: 'add_user_warning', actorUserId: viewer.robloxUserId, actorUsername: viewer.robloxUsername,
            targetUserId: theirs.robloxUserId, targetUsername: theirs.robloxUsername,
            details: { reason, via: 'discord' }
        });
        await dmRobloxUser(theirs.robloxUserId, `You've been given a warning on PlayVerse.\nReason: ${reason}`);
        await interaction.editReply(`Warned ${theirs.robloxUsername}. They have been told why.`);
    },

    async health(interaction) {
        const started = Date.now();
        const { error } = await supabase.from('app_settings').select('id').eq('id', 1).maybeSingle();
        const dbMs = Date.now() - started;
        const up = Math.round(process.uptime());
        const embed = new EmbedBuilder()
            .setTitle('Bot health')
            .setColor(error ? 0xB3311C : OK_GREEN)
            .addFields(
                { name: 'Database', value: error ? `Failing: ${error.message}` : `Responding in ${dbMs}ms`, inline: true },
                { name: 'Gateway', value: `${Math.max(0, Math.round(client.ws.ping))}ms`, inline: true },
                { name: 'Uptime', value: up > 3600 ? `${Math.round(up / 3600)}h` : `${Math.round(up / 60)}m`, inline: true }
            );
        await interaction.editReply({ embeds: [embed] });
    }
};

const REVIEW_NAG_AFTER_MS = 48 * 60 * 60 * 1000;
const JOB_INTERVAL_MS = 60 * 60 * 1000;
const jobMarks = { reviewNag: new Map(), overdueNag: new Map(), freezeNag: null };

function today() {
    return new Date().toISOString().slice(0, 10);
}

async function nagStaleReviews() {
    const { data: rows } = await supabase.from('team_tasks').select('*').eq('status', 'review');
    const stale = (rows || []).filter(t => t.submitted_at && Date.now() - new Date(t.submitted_at).getTime() > REVIEW_NAG_AFTER_MS);
    if (!stale.length) return 0;

    const perReviewer = new Map();
    for (const t of stale) {
        const reviewers = await reviewersForTask(t);
        reviewers.forEach(id => {
            if (!perReviewer.has(id)) perReviewer.set(id, []);
            perReviewer.get(id).push(t);
        });
    }
    let sent = 0;
    for (const [reviewerId, tasks] of perReviewer) {
        if (jobMarks.reviewNag.get(reviewerId) === today()) continue;
        const lines = tasks.slice(0, 6).map(t => `- ${t.title} by ${t.assigned_to_username || 'someone'}`).join('\n');
        const link = siteLink('/home');
        const ok = await dmRobloxUser(Number(reviewerId),
            `${tasks.length} ${tasks.length === 1 ? 'piece' : 'pieces'} of work ${tasks.length === 1 ? 'has' : 'have'} been waiting on your review for over two days.\n${lines}${link ? `\n${link}` : ''}`);
        if (ok) { sent++; jobMarks.reviewNag.set(reviewerId, today()); }
    }
    return sent;
}

async function nagOverdueTasks() {
    const { data: rows } = await supabase.from('team_tasks').select('*').eq('status', 'open');
    const overdue = (rows || []).filter(t => t.due_at && new Date(t.due_at).getTime() < Date.now() && t.assigned_to_user_id != null);
    let sent = 0;
    for (const t of overdue) {
        const key = String(t.id);
        if (jobMarks.overdueNag.get(key) === today()) continue;
        const link = siteLink(`/task/${t.id}`);
        const ok = await dmRobloxUser(t.assigned_to_user_id,
            `"${t.title}" is ${dueLine(t.due_at)}. If it is blocked, tell your producer rather than letting it sit.${link ? `\n${link}` : ''}`);
        if (ok) sent++;
        jobMarks.overdueNag.set(key, today());
    }
    return sent;
}

async function nagRunFreeze() {
    const { data: runs } = await supabase.from('payment_runs').select('*').eq('status', 'open').limit(1);
    const run = (runs || [])[0];
    if (!run || !run.period_end) return false;
    const daysLeft = Math.ceil((new Date(run.period_end + 'T23:59:59Z').getTime() - Date.now()) / 86400000);
    if (daysLeft < 0 || daysLeft > 3) return false;
    if (jobMarks.freezeNag === `${run.id}:${today()}`) return false;
    if (!DISCORD_LEAD_CHANNEL_ID) return false;
    try {
        const channel = await client.channels.fetch(DISCORD_LEAD_CHANNEL_ID);
        if (!channel || !channel.isTextBased()) return false;
        await channel.send(`The **${run.label}** payment run closes in ${daysLeft === 0 ? 'under a day' : `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}`}. Anything not approved by then rolls into the next one.`);
        jobMarks.freezeNag = `${run.id}:${today()}`;
        return true;
    } catch (e) {
        console.error('[bot] run freeze notice failed:', e.message);
        return false;
    }
}

async function runScheduledJobs() {
    for (const [name, job] of [['stale reviews', nagStaleReviews], ['overdue tasks', nagOverdueTasks], ['run freeze', nagRunFreeze]]) {
        try {
            await job();
        } catch (e) {
            console.error(`[bot] job "${name}" failed:`, e && e.stack ? e.stack : e);
        }
    }
    if (jobMarks.overdueNag.size > 2000) jobMarks.overdueNag.clear();
    if (jobMarks.reviewNag.size > 500) jobMarks.reviewNag.clear();
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
                await interaction.editReply({ embeds: [await ticketEmbed(ticket)] });
                return;
            }

            const handler = COMMAND_HANDLERS[interaction.commandName];
            if (handler) {
                await interaction.deferReply({ ephemeral: true });
                try {
                    await handler(interaction);
                } catch (e) {
                    console.error(`[bot] /${interaction.commandName} failed:`, e && e.stack ? e.stack : e);
                    await interaction.editReply('Something went wrong running that. It has been logged.');
                }
                return;
            }
        }

        if (interaction.isButton()) {
            const continueMatch = interaction.customId.match(/^onboarding_continue_(.+)$/);

            if (continueMatch) {
                await interaction.reply({
                    content: "Thanks, nothing more is needed here. A lead ranks you in the Roblox group by hand, and your access on the site is already set up.",
                    ephemeral: true
                });
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

            const nextRunNote = ' They need to be signed off, then finalised by a producer on the dashboard before their access is granted.';
            await interaction.editReply({
                content: `${ticket.roblox_username} confirmed for ${team.name}${skillset ? ` as ${skillset.name}` : ''} (by ${interaction.user}).${nextRunNote}`
            });

            try {
                const link = await supabase.from('discord_links').select('discord_user_id').eq('roblox_user_id', ticket.roblox_user_id).maybeSingle();
                const discordUserId = (link.data && link.data.discord_user_id) || ticket.discord_user_id;
                const user = await client.users.fetch(discordUserId);
                const parts = [`You've been accepted and placed on the **${team.name}** team!`];
                if (skillset) parts.push(`Skillset: **${skillset.name}**.`);
                parts.push('Your access will finish setting up shortly, a lead can also speed this up for you if needed.');
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

    try {
        await runScheduledJobs();
    } catch (e) {
        console.error('initial scheduled jobs failed:', e.message);
    }
    setInterval(runScheduledJobs, JOB_INTERVAL_MS);
})();

process.on('unhandledRejection', (reason) => {
    console.error('[bot] unhandled promise rejection:', reason && reason.stack ? reason.stack : reason);
});

process.on('uncaughtException', (err) => {
    console.error('[bot] uncaught exception:', err && err.stack ? err.stack : err);
});