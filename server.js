const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const zlib = require('zlib');
const { createClient } = require('@supabase/supabase-js');
let webpush = null;
try { webpush = require('web-push'); } catch (e) { }
require('dotenv').config();

const PORT = process.env.PORT || 3000;
const APP_ORIGIN = process.env.APP_ORIGIN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ROBLOX_CLIENT_ID = process.env.ROBLOX_CLIENT_ID;
const ROBLOX_CLIENT_SECRET = process.env.ROBLOX_CLIENT_SECRET;
const ROBLOX_REDIRECT_URI = process.env.ROBLOX_REDIRECT_URI;
const ROBLOX_GROUP_API_KEY = process.env.ROBLOX_GROUP_API_KEY;
const SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000;
const STATE_LIFETIME_MS = 10 * 60 * 1000;
const ACCESS_SYNC_INTERVAL_MS = 10 * 60 * 1000;

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
const DISCORD_LEAD_CHANNEL_ID = process.env.DISCORD_LEAD_CHANNEL_ID;
const DISCORD_LEAD_ROLE_ID = process.env.DISCORD_LEAD_ROLE_ID || '1539922527013572668';
// Category new per-applicant ticket channels are created under, and the HR role(s) allowed into them.
const DISCORD_TICKET_CATEGORY_ID = process.env.DISCORD_TICKET_CATEGORY_ID || '1540256971096072295';
// Comma-separated list supported via DISCORD_HR_ROLE_IDS, or a single id via DISCORD_HR_ROLE_ID.
const DISCORD_HR_ROLE_IDS = (process.env.DISCORD_HR_ROLE_IDS || process.env.DISCORD_HR_ROLE_ID || '')
    .split(',').map(s => s.trim()).filter(Boolean);
const RECRUIT_SESSION_LIFETIME_MS = 30 * 60 * 1000;
const RECRUIT_SESSION_PORTAL_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
const DISCORD_CONFIGURED = !!(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET && DISCORD_REDIRECT_URI);
if (!DISCORD_CONFIGURED) {
    console.warn('Discord recruitment OAuth is not configured (DISCORD_CLIENT_ID/SECRET/REDIRECT_URI missing) - the recruitment flow will be disabled until it is.');
}
if (!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID) {
    console.warn('DISCORD_BOT_TOKEN/DISCORD_GUILD_ID not set - new recruitment tickets will not get a private Discord ticket channel.');
}
if (!DISCORD_HR_ROLE_IDS.length) {
    console.warn('DISCORD_HR_ROLE_ID(S) not set - ticket channels will only be visible to the applicant, not to HR.');
}

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_CONTACT_EMAIL = process.env.VAPID_CONTACT_EMAIL || 'mailto:admin@playverse.cc';
const PUSH_CONFIGURED = !!(webpush && VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (webpush && PUSH_CONFIGURED) {
    webpush.setVapidDetails(VAPID_CONTACT_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
    console.warn('Push notifications are not configured (missing the web-push package or VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY) - applicants will not receive browser notifications.');
}

const requiredEnv = {
    APP_ORIGIN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
    ROBLOX_CLIENT_ID, ROBLOX_CLIENT_SECRET, ROBLOX_REDIRECT_URI
};
for (const key of Object.keys(requiredEnv)) {
    if (!requiredEnv[key]) {
        console.error(`Missing required environment variable: ${key}`);
        process.exit(1);
    }
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
});

const PERMISSIONS = [
    'dashboard.view',
    'dashboard.mark_paid',
    'dashboard.export',
    'dashboard.submit_request',
    'settings.manage_games',
    'settings.manage_rate',
    'settings.manage_groups',
    'settings.manage_base_access',
    'settings.manage_onboarding',
    'roles.manage',
    'staff.view_database',
    'staff.moderate',
    'broadcasts.manage',
    'audit.view',
    'audit.revert',
    'backups.manage',
    'recruitment.view',
    'recruitment.respond',
    'recruitment.manage',
    'recruitment.signoff',
    'recruitment.finalise',
    'recruitment.analytics'
];

const TOS_CONTENT = `Last updated: August 2026

1. Who this applies to
These Terms of Service apply to anyone signing in to the PlayVerse HR & Payment tool ("the Tool") using their Roblox account, including staff, developers, and contributors of PlayVerse (playverse.cc).

2. Your account
You sign in with your own Roblox account through Roblox OAuth. You're responsible for keeping that account secure. Access to the Tool can be granted or revoked at any time based on your role or group standing within PlayVerse.

3. What the Tool is for
The Tool is used to log completed work, submit and review payment requests, track DevEx/Robux and cash payouts, and manage staff access and roles. It is an internal tool, not a public product, and it is not affiliated with or endorsed by Roblox Corporation.

4. Accuracy of information
Any payment request, task log, or work summary you submit must be accurate and represent work you actually completed. Submitting false, inflated, or duplicated work entries is a violation of these Terms and may result in the request being rejected, access being revoked, and, in serious cases, referral to group leadership for further action.

5. Payments
Payment amounts, currencies, and DevEx rates shown in the Tool are set by PlayVerse and may change at any time. Being able to submit a request does not guarantee payment; requests are reviewed and approved at PlayVerse's discretion. It's your responsibility to keep your payout details (PayPal, Venmo, or Roblox username for DevEx) accurate and up to date.

6. No warranty
The Tool is provided "as is." PlayVerse makes reasonable efforts to keep it available and your data accurate, but does not guarantee uninterrupted access or that the Tool will be free of errors.

7. Changes
These Terms may be updated from time to time. Continued use of the Tool after an update means you accept the revised Terms. Material changes will be reflected here with an updated date.

8. Contact
Questions about these Terms can be directed to PlayVerse leadership through your usual staff channels.`;

const AUP_CONTENT = `Last updated: August 2026

This Acceptable Use Policy explains what is and isn't okay when using the PlayVerse HR & Payment tool ("the Tool"). It applies to everyone with access, regardless of role.

1. Use the Tool for its intended purpose
Only submit payment requests and work logs for work you actually did. Only use the accounts, groups, and permissions you've been given for the purpose they were given to you.

2. Don't misuse access
Do not attempt to access data, requests, or settings you have not been granted permission to view or edit. Do not share your session, login link, or account access with anyone else. Do not attempt to bypass, disable, or trick the Tool's permission or eligibility checks.

3. Respect other staff
Treat other staff, developers, and contributors with respect when interacting through or about the Tool. Harassment, discrimination, or abusive behavior toward other members of the team is not tolerated and may result in removal from all PlayVerse groups and revocation of Tool access.

4. Financial integrity
Do not submit duplicate, inflated, or fraudulent payment requests. Do not mark your own requests as paid, approve your own submissions, or otherwise use elevated access for your own benefit. If you're granted a role with financial permissions, that access is for processing the team's requests, not your own.

5. Data handling
Information in the Tool, including payment history, personal payout details, and staff roles, is internal and confidential. Do not export, screenshot, or share this data outside of PlayVerse without authorization.

6. Required groups and access
Some access to the Tool is tied to membership in specific Roblox groups. Do not attempt to join required groups, achieve a rank, or gain access under false pretenses (for example, using an alternate account to bypass a restriction placed on your main account).

7. Consequences
Violating this policy may result in a rejected or reversed payment request, loss of specific permissions, removal from PlayVerse groups, and loss of access to the Tool, depending on the severity of the violation.

8. Reporting concerns
If you see something that looks like a violation of this policy, report it to PlayVerse leadership through your usual staff channels.`;

const ONBOARDING_STEPS = [
    {
        id: 'welcome',
        type: 'intro',
        title: 'Welcome to the PlayVerse HR tool',
        description: 'A quick tour before you get started.',
        content: `This tool is how PlayVerse staff log completed work, submit and track payment requests, and see what's been paid.

If you can submit requests: use "New request" to log a task, the game it was for, time worked, and the payout amount. Add a payout method under "My payments" first so it's ready to go.

If you have dashboard access: the Dashboard shows every request from the team. You can review, mark things paid, or reject a request with a note.

Everyone can check "My payments" any time to see their own history and running totals.

That's the basics, take a look around once you're through this checklist.`,
        required: true
    },
    {
        id: 'team_info',
        type: 'team_info',
        title: 'Your team & skillset',
        description: 'Where you fit in at PlayVerse.',
        content: '',
        required: false
    },
    {
        id: 'tos',
        type: 'tos',
        title: 'Terms of Service',
        description: 'Please read and accept before continuing.',
        content: TOS_CONTENT,
        required: true
    },
    {
        id: 'aup',
        type: 'aup',
        title: 'Acceptable Use Policy',
        description: 'Please read and accept before continuing.',
        content: AUP_CONTENT,
        required: true
    }
];
const ONBOARDING_STEP_IDS = new Set(ONBOARDING_STEPS.map(s => s.id));

const PAYMENT_METHOD_TYPES = {
    PAYPAL: { fields: ['paypalEmail'] },
    DEVEX_ROBUX: { fields: ['robloxUsername'] },
    VENMO: { fields: ['venmoUsername'] }
};

const app = express();
app.use(cors({
    origin: APP_ORIGIN,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'ngrok-skip-browser-warning']
}));

app.use(express.json({ limit: '8mb' }));

app.get('/ping', (req, res) => {
    res.status(200).json({ ok: true, time: new Date().toISOString() });
});

app.get("/api/roblox/avatar/:userId", async (req, res) => {
    try {
        const response = await fetch(
            `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${req.params.userId}&size=150x150&format=Png`
        );

        const data = await response.json();

        res.json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch avatar" });
    }
});

function randomToken(bytes) {
    return crypto.randomBytes(bytes || 32).toString('hex');
}

function base64url(buffer) {
    return buffer.toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

function getBearerToken(req) {
    const auth = (req && req.headers && req.headers.authorization) || '';
    return auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
}

function generateLinkToken() {
    return randomToken(9);
}

function generateRequestId() {
    const rand = Math.floor(100000 + Math.random() * 900000);
    const stamp = Date.now().toString(36).slice(-4);
    return `PV_${rand}_${stamp}`;
}

async function getRecruitSession(req) {
    const token = getBearerToken(req) || (req.query && req.query.rt) || (req.body && req.body.rt);
    if (!token) return null;
    const { data, error } = await supabase.from('recruit_sessions').select('*').eq('token', token).maybeSingle();
    if (error || !data) return null;
    if (new Date(data.expires_at).getTime() < Date.now()) {
        await supabase.from('recruit_sessions').delete().eq('token', token);
        return null;
    }
    return data;
}

async function createRecruitSession(robloxUserId, robloxUsername) {
    const token = randomToken(24);
    const expiresAt = new Date(Date.now() + RECRUIT_SESSION_LIFETIME_MS).toISOString();

    // If this person already linked a Discord account before (from a previous application attempt,
    // or as staff), carry it over onto the new session so they land straight back on their existing
    // ticket status instead of being asked to "link Discord" again every time they sign back in.
    const { data: existingLink } = await supabase
        .from('discord_links')
        .select('discord_user_id, discord_username, discord_avatar')
        .eq('roblox_user_id', robloxUserId)
        .maybeSingle();

    const { error: insertErr } = await supabase.from('recruit_sessions').insert({
        token,
        roblox_user_id: robloxUserId,
        roblox_username: robloxUsername,
        discord_user_id: existingLink ? existingLink.discord_user_id : null,
        discord_username: existingLink ? existingLink.discord_username : null,
        discord_avatar: existingLink ? existingLink.discord_avatar : null,
        expires_at: expiresAt
    });
    if (insertErr) throw new Error(insertErr.message);
    return token;
}

let recruitersCache = { at: 0, data: null };
const RECRUITERS_CACHE_MS = 5 * 60 * 1000;

async function fetchGroupRoleMembers(groupId, rank) {
    try {
        const rolesRes = await fetch(`https://groups.roblox.com/v1/groups/${groupId}/roles`);
        if (!rolesRes.ok) return [];
        const rolesJson = await rolesRes.json().catch(() => null);
        const roleset = rolesJson && Array.isArray(rolesJson.roles) ? rolesJson.roles.find(r => r.rank === rank) : null;
        if (!roleset) return [];
        const members = [];
        let cursor = '';
        for (let page = 0; page < 10; page++) {
            const url = `https://groups.roblox.com/v1/groups/${groupId}/roles/${roleset.id}/users?limit=100${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`;
            const res = await fetch(url);
            if (!res.ok) break;
            const json = await res.json().catch(() => null);
            if (!json) break;
            (json.data || []).forEach(u => members.push({ robloxUserId: u.userId, robloxUsername: u.username }));
            if (!json.nextPageCursor) break;
            cursor = json.nextPageCursor;
        }
        return members;
    } catch (e) {
        console.error('fetchGroupRoleMembers failed:', e.message);
        return [];
    }
}

async function listRecruiters({ skipCache } = {}) {
    if (!skipCache && recruitersCache.data && (Date.now() - recruitersCache.at) < RECRUITERS_CACHE_MS) {
        return recruitersCache.data;
    }

    const { data: roles, error: rolesErr } = await supabase.from('roles').select('*');
    if (rolesErr) throw new Error(rolesErr.message);
    const recruiterRoles = (roles || []).filter(r => Array.isArray(r.permissions) && r.permissions.includes('recruitment.respond'));
    if (!recruiterRoles.length) { recruitersCache = { at: Date.now(), data: [] }; return []; }

    const byId = new Map();

    const { data: assignments, error: assignErr } = await supabase
        .from('user_role_assignments')
        .select('roblox_user_id, roblox_username')
        .in('role_id', recruiterRoles.map(r => r.id));
    if (assignErr) throw new Error(assignErr.message);
    (assignments || []).forEach(a => { if (!byId.has(a.roblox_user_id)) byId.set(a.roblox_user_id, a.roblox_username); });

    const groupRankRoles = recruiterRoles.filter(r => !r.link_only && r.roblox_group_id != null && r.min_rank != null);
    for (const role of groupRankRoles) {
        const members = await fetchGroupRoleMembers(role.roblox_group_id, role.min_rank);
        members.forEach(m => { if (!byId.has(m.robloxUserId)) byId.set(m.robloxUserId, m.robloxUsername); });
    }

    const result = [...byId.entries()].map(([robloxUserId, robloxUsername]) => ({ robloxUserId, robloxUsername }))
        .sort((a, b) => a.robloxUsername.localeCompare(b.robloxUsername));
    recruitersCache = { at: Date.now(), data: result };
    return result;
}

async function discordApi(path, options) {
    if (!DISCORD_BOT_TOKEN) throw new Error('discord_bot_not_configured');
    const res = await fetch(`https://discord.com/api/v10${path}`, {
        ...options,
        headers: {
            Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
            'Content-Type': 'application/json',
            ...(options && options.headers)
        }
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`discord_api_${res.status}: ${body}`);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
}

function discordChannelUrl(channelId) {
    if (!channelId || !DISCORD_GUILD_ID) return null;
    return `https://discord.com/channels/${DISCORD_GUILD_ID}/${channelId}`;
}

async function ticketEmbedPayload(ticket) {
    const statusColors = { pending: 0xD8AC50, in_review: 0x7C76E8, accepted: 0x178A4C, team_selection: 0x3730D9, signed_off: 0x9D6BE0, finalised: 0x2B6CB0, rejected: 0xB3311C, withdrawn: 0x8A93A3 };

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
        { name: 'Why they want to join', value: (ticket.why_join || '').slice(0, 500) || 'N/A' },
        { name: 'Experience', value: (ticket.experience || '').slice(0, 500) || 'N/A' }
    );

    return {
        title: `Application: ${ticket.roblox_username}`,
        color: statusColors[ticket.status] || 0x3730D9,
        fields,
        footer: { text: `Ticket ${ticket.id}` },
        timestamp: new Date().toISOString()
    };
}

// True if the given Discord user is currently a member of the configured guild.
async function isDiscordGuildMember(discordUserId, guildId = DISCORD_GUILD_ID) {
    if (!DISCORD_BOT_TOKEN || !guildId || !discordUserId) return false;
    try {
        const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${discordUserId}`, {
            headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` }
        });
        if (res.status === 404) return false;
        if (!res.ok) {
            const bodyText = await res.text().catch(() => '');
            console.error(`isDiscordGuildMember: unexpected status ${res.status} checking ${discordUserId} in guild ${guildId}: ${bodyText}`);
            return false;
        }
        return true;
    } catch (e) {
        console.error('isDiscordGuildMember failed:', e.message);
        return false;
    }
}

// Checks membership across several Discord servers at once, e.g. a main studio server plus a
// separate testers-only server, returning true on the first match.
async function isMemberOfAnyGuild(discordUserId, guildIds) {
    if (!discordUserId || !guildIds || !guildIds.length) return false;
    for (const guildId of guildIds) {
        if (await isDiscordGuildMember(discordUserId, guildId)) return true;
    }
    return false;
}

// Creates a private per-applicant ticket channel under DISCORD_TICKET_CATEGORY_ID, visible only to the
// applicant and the HR role(s), with a status panel embed (no buttons - manage the application from the
// website dashboard). This is where all communication with the applicant now happens instead of the old
// website chat.
async function createDiscordTicketChannel(ticket, positionRoleId) {
    if (!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID) {
        console.error('createDiscordTicketChannel: skipped - DISCORD_BOT_TOKEN/DISCORD_GUILD_ID not configured.');
        return null;
    }
    console.log(`createDiscordTicketChannel: creating channel for ticket ${ticket.id} in guild ${DISCORD_GUILD_ID}, category ${DISCORD_TICKET_CATEGORY_ID}, HR role(s): ${DISCORD_HR_ROLE_IDS.join(', ') || '(none configured)'}, position role: ${positionRoleId || '(none)'}`);
    try {
        const VIEW_CHANNEL = 1024, SEND_MESSAGES = 2048, READ_MESSAGE_HISTORY = 65536, ATTACH_FILES = 32768, EMBED_LINKS = 16384;
        const memberAllow = String(VIEW_CHANNEL + SEND_MESSAGES + READ_MESSAGE_HISTORY + ATTACH_FILES + EMBED_LINKS);
        const overwrites = [
            { id: DISCORD_GUILD_ID, type: 0, deny: String(VIEW_CHANNEL) }, // @everyone can't see it
            { id: ticket.discord_user_id, type: 1, allow: memberAllow } // the applicant
        ];
        const rolesWithAccess = new Set(DISCORD_HR_ROLE_IDS);
        if (positionRoleId) rolesWithAccess.add(positionRoleId);
        for (const roleId of rolesWithAccess) {
            overwrites.push({ id: roleId, type: 0, allow: memberAllow });
        }
        // The bot's own user id matches its application (client) id - make sure it can always see the channel.
        if (DISCORD_CLIENT_ID) overwrites.push({ id: DISCORD_CLIENT_ID, type: 1, allow: memberAllow });

        const safeName = `ticket-${(ticket.roblox_username || 'applicant').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || ticket.id}`;
        const channel = await discordApi(`/guilds/${DISCORD_GUILD_ID}/channels`, {
            method: 'POST',
            body: JSON.stringify({
                name: safeName,
                type: 0,
                parent_id: DISCORD_TICKET_CATEGORY_ID,
                topic: `Recruitment ticket ${ticket.id} - ${ticket.roblox_username}`,
                permission_overwrites: overwrites
            })
        });
        if (!channel || !channel.id) {
            console.error('createDiscordTicketChannel: channel creation returned no id for ticket', ticket.id);
            return null;
        }
        console.log(`createDiscordTicketChannel: created channel ${channel.id} for ticket ${ticket.id}`);

        // Ping the role configured for this specific position if there is one, instead of the
        // general HR role(s) - keeps the noise down to whichever team actually owns that position.
        // Falls back to the general HR role(s) when the position has no role configured.
        const pingRoleIds = positionRoleId ? [positionRoleId] : DISCORD_HR_ROLE_IDS;
        const embed = await ticketEmbedPayload(ticket);
        const message = await discordApi(`/channels/${channel.id}/messages`, {
            method: 'POST',
            body: JSON.stringify({
                content: `${pingRoleIds.map(id => `<@&${id}>`).join(' ')} <@${ticket.discord_user_id}> - a new application ticket was opened here. Chat here about the application. Manage this application (accept, reject, assign, etc.) from the dashboard on the website.`,
                embeds: [embed]
            })
        });

        const { error: saveErr } = await supabase.from('recruitment_tickets').update({
            discord_channel_id: channel.id,
            ticket_message_id: message ? message.id : null
        }).eq('id', ticket.id);
        if (saveErr) console.error(`createDiscordTicketChannel: channel ${channel.id} was created but saving it to ticket ${ticket.id} failed:`, saveErr.message);

        return channel.id;
    } catch (e) {
        // discordApi() throws with the raw Discord error body baked into the message (e.g. invalid
        // parent_id/category, bad role/user snowflake in permission_overwrites, missing Manage Channels
        // permission, etc) - log it in full so the real cause shows up instead of failing silently.
        console.error(`createDiscordTicketChannel failed for ticket ${ticket.id}:`, e.message);
        return null;
    }
}

// Opens (or reuses) a DM channel with a Discord user and sends them a message via the bot's REST
// token. Silently no-ops if they have DMs closed to the bot, aren't found, etc - a failed DM
// should never block the underlying status change from saving.
async function sendDiscordDM(discordUserId, content) {
    if (!DISCORD_BOT_TOKEN || !discordUserId) return;
    try {
        const dmChannel = await discordApi('/users/@me/channels', {
            method: 'POST',
            body: JSON.stringify({ recipient_id: discordUserId })
        });
        if (!dmChannel || !dmChannel.id) return;
        await discordApi(`/channels/${dmChannel.id}/messages`, {
            method: 'POST',
            body: JSON.stringify({ content })
        });
    } catch (e) {
        console.error(`sendDiscordDM: failed to DM ${discordUserId}:`, e.message);
    }
}

// One message per possible ticket status - kept in one place so every status change (however it
// happens - website, auto-accept, etc.) DMs the applicant the same way, instead of only some paths
// remembering to do it.
const STATUS_DM_MESSAGES = {
    in_review: () => `Your PlayVerse application is now in review. Someone is actively looking at it.`,
    accepted: () => `Your PlayVerse application has been accepted. Someone from the team will reach out here shortly.`,
    rejected: () => `Thanks for applying to PlayVerse. Unfortunately your application wasn't accepted this time. You're welcome to apply again in the future.`,
    withdrawn: () => `Your PlayVerse application has been marked as withdrawn.`,
    team_selection: () => `Your application has moved to team selection. Please wait while leads finish placing you.`,
    signed_off: () => `Your placement has been reviewed and is now awaiting final approval.`,
    finalised: () => `You are fully placed and roled onto your team. Welcome aboard.`
};

async function dmApplicantStatusChange(ticket, newStatus) {
    const buildMessage = STATUS_DM_MESSAGES[newStatus];
    if (!buildMessage || !ticket.discord_user_id) return;
    await sendDiscordDM(ticket.discord_user_id, buildMessage());
}

async function notifyDiscordStatusChange(ticket, newStatus, byUsername) {
    if (!DISCORD_BOT_TOKEN || !ticket.discord_channel_id) return;
    try {
        await discordApi(`/channels/${ticket.discord_channel_id}/messages`, {
            method: 'POST',
            body: JSON.stringify({
                content: `${ticket.roblox_username}'s application was marked ${newStatus} by ${byUsername} on the website.`
            })
        });
    } catch (e) {
        console.error('notifyDiscordStatusChange failed:', e.message);
    }
}

async function notifyDiscordNextPhase(ticket, skillset) {
    if (!DISCORD_BOT_TOKEN || !DISCORD_LEAD_CHANNEL_ID) return null;
    try {
        const { data: teams } = await supabase.from('teams').select('id, name').order('name', { ascending: true }).limit(24);
        const teamOptions = (teams || []).map(t => ({ label: t.name.slice(0, 100), value: String(t.id) }));

        const components = [];
        if (teamOptions.length) {
            components.push({
                type: 1,
                components: [{
                    type: 3,
                    custom_id: `nextphase_team_${ticket.id}`,
                    placeholder: 'Assign a team...',
                    options: teamOptions
                }]
            });
        }
        components.push({
            type: 1,
            components: [{
                type: 6,
                custom_id: `nextphase_roles_${ticket.id}`,
                placeholder: 'Assign Discord roles...',
                min_values: 0,
                max_values: 10
            }]
        });

        const message = await discordApi(`/channels/${DISCORD_LEAD_CHANNEL_ID}/messages`, {
            method: 'POST',
            body: JSON.stringify({
                content: `<@&${DISCORD_LEAD_ROLE_ID}> ${ticket.roblox_username} is ready for team selection.`,
                embeds: [{
                    title: `${ticket.roblox_username} - ready for team selection`,
                    color: 0x178A4C,
                    fields: [
                        { name: 'Roblox', value: ticket.roblox_username, inline: true },
                        { name: 'Discord', value: `<@${ticket.discord_user_id}>`, inline: true },
                        { name: 'Position applied for', value: ticket.position || 'Not specified', inline: true },
                        { name: 'Skillset', value: skillset ? skillset.name : 'Not set', inline: true },
                        { name: 'Referred by', value: ticket.referred_by_username || 'None', inline: true },
                        { name: 'Experience', value: (ticket.experience || 'N/A').slice(0, 400) }
                    ],
                    footer: { text: `Ticket ${ticket.id} - use the menus below to finish placing them` },
                    timestamp: new Date().toISOString()
                }],
                components
            })
        });
        return message ? message.id : null;
    } catch (e) {
        console.error('notifyDiscordNextPhase failed:', e.message);
        return null;
    }
}

async function notifyDiscordPlacement(ticket, team, byUsername) {
    if (!DISCORD_BOT_TOKEN || !DISCORD_LEAD_CHANNEL_ID) return;
    try {
        await discordApi(`/channels/${DISCORD_LEAD_CHANNEL_ID}/messages`, {
            method: 'POST',
            body: JSON.stringify({
                content: `${ticket.roblox_username} confirmed for ${team.name}${ticket.skillset_name ? ` as ${ticket.skillset_name}` : ''} (by ${byUsername} on the website).`
            })
        });
    } catch (e) {
        console.error('notifyDiscordPlacement failed:', e.message);
    }
}

async function notifyDiscordAssignment(ticket, assigneeUserId, assigneeUsername, byUsername) {
    if (!DISCORD_BOT_TOKEN || !ticket.discord_channel_id) return;
    try {
        let assigneeText = 'Unassigned';
        if (assigneeUsername) {
            const assigneeDiscordId = assigneeUserId != null ? await getLinkedDiscordUserId(assigneeUserId) : null;
            assigneeText = assigneeDiscordId ? `${assigneeUsername} (<@${assigneeDiscordId}>)` : assigneeUsername;
        }
        await discordApi(`/channels/${ticket.discord_channel_id}/messages`, {
            method: 'POST',
            body: JSON.stringify({
                content: assigneeUsername
                    ? `${ticket.roblox_username}'s application was assigned to ${assigneeText} by ${byUsername} on the website.`
                    : `${ticket.roblox_username}'s application was unassigned by ${byUsername} on the website.`
            })
        });
    } catch (e) {
        console.error('notifyDiscordAssignment failed:', e.message);
    }
}

// Edits the ticket's pinned panel embed in place so it always reflects the latest status/assignee/
// position/etc, regardless of whether the change came from the website or (for status) from Discord.
async function refreshDiscordTicketPanel(ticket) {
    if (!DISCORD_BOT_TOKEN || !ticket.discord_channel_id || !ticket.ticket_message_id) return;
    try {
        const embed = await ticketEmbedPayload(ticket);
        await discordApi(`/channels/${ticket.discord_channel_id}/messages/${ticket.ticket_message_id}`, {
            method: 'PATCH',
            body: JSON.stringify({ embeds: [embed] })
        });
    } catch (e) {
        console.error(`refreshDiscordTicketPanel: failed to update panel for ticket ${ticket.id}:`, e.message);
    }
}

// Adds a configured Discord role to a member via the bot's REST token. Safe to call even if the
// member already has the role (Discord treats it as a no-op).
async function addDiscordRoleToMember(discordUserId, roleId) {
    if (!discordUserId || !roleId || !DISCORD_GUILD_ID) return false;
    try {
        await discordApi(`/guilds/${DISCORD_GUILD_ID}/members/${discordUserId}/roles/${roleId}`, { method: 'PUT' });
        return true;
    } catch (e) {
        console.error(`addDiscordRoleToMember: failed to add role ${roleId} to ${discordUserId}:`, e.message);
        return false;
    }
}

// Grants the configured in-app tool role to a freshly-hired user. Ignores the unique-constraint
// error if they somehow already have it.
async function grantAutoHireRole(ticket, roleId) {
    if (!roleId || !ticket.roblox_user_id) return false;
    const { error } = await supabase.from('user_role_assignments').insert({
        roblox_user_id: ticket.roblox_user_id,
        role_id: roleId,
        roblox_username: ticket.roblox_username
    });
    if (error && error.code !== '23505') { console.error('grantAutoHireRole failed:', error.message); return false; }
    return true;
}

// Logs a 1,000 Robux payment request from "System" (not a real staff member) for referral/review bonuses.
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
    runPaymentMethodConversionSweep({ robloxUserId });
    return id;
}

// Runs exactly once per ticket the moment it becomes "accepted" (whether by HR or auto-accept):
// grants the configured tool/Discord roles, and auto-logs 1,000 Robux payment requests (from
// "System") to the referrer and the reviewer who accepted them. Idempotency flags on the ticket
// keep this from double-granting roles or double-paying if the status is touched again later.
async function processHire(ticket, { reviewerUserId, reviewerUsername }) {
    try {
        const config = await getRecruitmentConfig();
        const flagUpdates = {};

        if (!ticket.hire_role_granted) {
            if (config.autoRoleId) await grantAutoHireRole(ticket, config.autoRoleId);
            if (config.discordRoleId && ticket.discord_user_id) await addDiscordRoleToMember(ticket.discord_user_id, config.discordRoleId);
            flagUpdates.hire_role_granted = true;
        }

        if (!ticket.referral_reward_logged && ticket.referred_by_user_id
            && String(ticket.referred_by_user_id) !== String(ticket.roblox_user_id)) {
            const paymentId = await logSystemPaymentRequest({
                robloxUserId: ticket.referred_by_user_id,
                robloxUsername: ticket.referred_by_username,
                taskName: 'Referral bonus',
                note: `Referral bonus for ${ticket.roblox_username} being hired (ticket ${ticket.id}).`
            });
            flagUpdates.referral_reward_logged = true;
            if (paymentId) {
                logAudit(null, {
                    category: 'payments', action: 'auto_referral_bonus',
                    targetUserId: ticket.referred_by_user_id, targetUsername: ticket.referred_by_username,
                    details: { actor: 'System', ticketId: ticket.id, paymentId, hiredUser: ticket.roblox_username }
                });
            }
        }

        if (!ticket.reviewer_reward_logged && reviewerUserId && reviewerUsername
            && String(reviewerUserId) !== String(ticket.roblox_user_id)) {
            const paymentId = await logSystemPaymentRequest({
                robloxUserId: reviewerUserId,
                robloxUsername: reviewerUsername,
                taskName: 'Recruitment ticket review',
                note: `Reviewed and accepted ${ticket.roblox_username}'s application (ticket ${ticket.id}).`
            });
            flagUpdates.reviewer_reward_logged = true;
            if (paymentId) {
                logAudit(null, {
                    category: 'payments', action: 'auto_reviewer_bonus',
                    targetUserId: reviewerUserId, targetUsername: reviewerUsername,
                    details: { actor: 'System', ticketId: ticket.id, paymentId, hiredUser: ticket.roblox_username }
                });
            }
        }

        if (Object.keys(flagUpdates).length) {
            await supabase.from('recruitment_tickets').update(flagUpdates).eq('id', ticket.id);
        }
    } catch (e) {
        console.error(`processHire failed for ticket ${ticket.id}:`, e.message);
    }
}

const RECRUITMENT_AUTO_ACCEPT_INTERVAL_MS = 15 * 60 * 1000;

// Sweeps pending/in_review tickets that have sat longer than the configured grace period with no
// HR response, and auto-accepts them as "System" - same role grants and referral/reviewer payouts
// as a normal accept, minus the reviewer payout (nobody actually reviewed it).
async function runRecruitmentAutoAccept() {
    try {
        const config = await getRecruitmentConfig();
        if (!config.gracePeriodHours || config.gracePeriodHours <= 0) return;

        const cutoff = new Date(Date.now() - config.gracePeriodHours * 60 * 60 * 1000).toISOString();
        const { data: tickets, error } = await supabase
            .from('recruitment_tickets')
            .select('*')
            .in('status', ['pending', 'in_review'])
            .lte('created_at', cutoff);
        if (error) { console.error('runRecruitmentAutoAccept: could not load tickets:', error.message); return; }

        for (const ticket of (tickets || [])) {
            const nowIso = new Date().toISOString();
            const updates = {
                status: 'accepted',
                closed_at: nowIso,
                closed_by_username: 'System',
                closed_by_roblox_user_id: null,
                closed_by_roblox_username: null,
                close_reason: `Auto-accepted after the ${config.gracePeriodHours}-hour grace period with no HR response.`,
                auto_accepted: true,
                updated_at: nowIso
            };
            if (!ticket.first_response_at) {
                updates.first_response_at = nowIso;
                updates.first_response_by_username = 'System';
            }
            const { error: updateErr } = await supabase.from('recruitment_tickets').update(updates).eq('id', ticket.id);
            if (updateErr) { console.error(`runRecruitmentAutoAccept: failed updating ticket ${ticket.id}:`, updateErr.message); continue; }

            const merged = { ...ticket, ...updates };
            await processHire(merged, { reviewerUserId: null, reviewerUsername: null });

            sendPushToApplicant(ticket.roblox_user_id, {
                title: 'Your PlayVerse application was updated',
                body: 'Your application was automatically accepted after the review window passed.',
                url: `${APP_ORIGIN}/#/recruit/status`
            });
            notifyDiscordStatusChange(merged, 'accepted', 'System (auto-accept)');
            dmApplicantStatusChange(merged, 'accepted');
            refreshDiscordTicketPanel(merged);
            if (config.notifyRoleId) {
                notifyRoleHoldersDM(config.notifyRoleId, `${ticket.roblox_username} was auto-accepted after the grace period. Take a look in the Tool.`);
            }
            logAudit(null, {
                category: 'recruitment', action: 'auto_accept',
                targetUserId: ticket.roblox_user_id, targetUsername: ticket.roblox_username,
                details: { actor: 'System', ticketId: ticket.id, gracePeriodHours: config.gracePeriodHours }
            });
        }
    } catch (e) {
        console.error('runRecruitmentAutoAccept failed:', e.message);
    }
}

const TICKET_AUTO_DELETE_DELAY_MS = 12 * 60 * 60 * 1000; // 12 hours

// Marks a ticket "finalised" once it's been placed on a team AND actually roled in (in
// user_assignments) - the very end of the recruitment pipeline. Posts a heads-up in the ticket's
// Discord channel that it'll be auto-deleted in 12 hours, and schedules that deletion.
async function finalizeAfterRoling(ticket, byUsername) {
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
            await discordApi(`/channels/${ticket.discord_channel_id}/messages`, {
                method: 'POST',
                body: JSON.stringify({
                    content: `${ticket.roblox_username} has been fully placed and roled onto their team. This ticket channel will be automatically deleted in 12 hours.`
                })
            });
        } catch (e) {
            console.error(`finalizeAfterRoling: failed to post message in channel ${ticket.discord_channel_id}:`, e.message);
        }
    }

    const finalisedTicket = { ...ticket, status: 'finalised', finalised_at: nowIso, channel_delete_at: deleteAt };
    dmApplicantStatusChange(finalisedTicket, 'finalised');
    refreshDiscordTicketPanel(finalisedTicket);
    startOnboardingFlow(finalisedTicket);

    logAudit(null, {
        category: 'recruitment', action: 'finalised',
        targetUserId: ticket.roblox_user_id, targetUsername: ticket.roblox_username,
        details: { actor: byUsername || 'System', ticketId: ticket.id }
    });
}

const TICKET_CHANNEL_CLEANUP_INTERVAL_MS = 15 * 60 * 1000;

// Deletes ticket channels whose 12-hour post-finalise window has passed. If the channel's already
// gone (404), we still mark it deleted rather than retrying forever; any other error is retried
// on the next sweep.
async function runTicketChannelCleanup() {
    try {
        const nowIso = new Date().toISOString();
        const { data: tickets, error } = await supabase
            .from('recruitment_tickets')
            .select('id, discord_channel_id')
            .eq('channel_deleted', false)
            .not('channel_delete_at', 'is', null)
            .lte('channel_delete_at', nowIso);
        if (error) { console.error('runTicketChannelCleanup: could not load tickets:', error.message); return; }

        for (const ticket of (tickets || [])) {
            let done = true;
            if (ticket.discord_channel_id) {
                try {
                    await discordApi(`/channels/${ticket.discord_channel_id}`, { method: 'DELETE' });
                } catch (e) {
                    if (String(e.message).startsWith('discord_api_404')) {
                        // channel's already gone - nothing left to clean up
                    } else {
                        console.error(`runTicketChannelCleanup: failed to delete channel ${ticket.discord_channel_id} for ticket ${ticket.id}:`, e.message);
                        done = false;
                    }
                }
            }
            if (done) await supabase.from('recruitment_tickets').update({ channel_deleted: true }).eq('id', ticket.id);
        }
    } catch (e) {
        console.error('runTicketChannelCleanup failed:', e.message);
    }
}

async function sendPushToApplicant(robloxUserId, { title, body, url }) {
    if (!PUSH_CONFIGURED) return;
    try {
        const { data: subs } = await supabase.from('recruit_push_subscriptions').select('*').eq('roblox_user_id', robloxUserId);
        if (!subs || !subs.length) return;
        const payload = JSON.stringify({ title, body, url: url || `${APP_ORIGIN}/#/recruit/status` });
        await Promise.all(subs.map(async sub => {
            try {
                await webpush.sendNotification({
                    endpoint: sub.endpoint,
                    keys: { p256dh: sub.p256dh, auth: sub.auth }
                }, payload);
            } catch (e) {
                if (e.statusCode === 404 || e.statusCode === 410) {
                    await supabase.from('recruit_push_subscriptions').delete().eq('id', sub.id);
                } else {
                    console.error('sendPushToApplicant failed for one subscription:', e.message);
                }
            }
        }));
    } catch (e) {
        console.error('sendPushToApplicant failed:', e.message);
    }
}

async function fetchRobloxGroupRoles(robloxUserId) {
    const res = await fetch(`https://groups.roblox.com/v1/users/${robloxUserId}/groups/roles`);
    if (!res.ok) return [];
    const json = await res.json().catch(() => null);
    return (json && json.data) || [];
}

async function resolveRobloxUserId(username) {
    const res = await fetch('https://users.roblox.com/v1/usernames/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames: [username], excludeBannedUsers: false })
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    const match = json && json.data && json.data[0];
    return match ? match.id : null;
}

// Roblox usernames can change at any time - identity is always tracked by roblox_user_id, so
// renaming never breaks anyone's access, but every table that also caches a display username
// needs to catch up or it'll keep showing the stale name. Runs on every sign-in; each update is a
// no-op if the name already matches, so this is cheap to call unconditionally.
async function syncRobloxUsername(robloxUserId, newUsername) {
    if (!robloxUserId || !newUsername) return;
    try {
        await Promise.all([
            supabase.from('payment_methods').update({ roblox_username: newUsername }).eq('roblox_user_id', robloxUserId),
            supabase.from('payment_requests').update({ roblox_username: newUsername }).eq('roblox_user_id', robloxUserId),
            supabase.from('payment_requests').update({ requested_by: newUsername }).eq('requested_by_user_id', robloxUserId),
            supabase.from('user_role_assignments').update({ roblox_username: newUsername }).eq('roblox_user_id', robloxUserId),
            supabase.from('user_assignments').update({ roblox_username: newUsername }).eq('roblox_user_id', robloxUserId),
            supabase.from('discord_links').update({ roblox_username: newUsername }).eq('roblox_user_id', robloxUserId),
            supabase.from('staff_warnings').update({ roblox_username: newUsername }).eq('roblox_user_id', robloxUserId),
            supabase.from('banned_users').update({ roblox_username: newUsername }).eq('roblox_user_id', robloxUserId),
            supabase.from('recruitment_tickets').update({ roblox_username: newUsername }).eq('roblox_user_id', robloxUserId),
            supabase.from('recruitment_tickets').update({ referred_by_username: newUsername }).eq('referred_by_user_id', robloxUserId),
            supabase.from('recruitment_tickets').update({ assigned_to_username: newUsername }).eq('assigned_to_user_id', robloxUserId),
            supabase.from('recruitment_tickets').update({ closed_by_roblox_username: newUsername }).eq('closed_by_roblox_user_id', robloxUserId)
        ]);
    } catch (e) {
        console.error(`syncRobloxUsername failed for ${robloxUserId}:`, e.message);
    }
}

async function getBaseAccessGroups() {
    const { data, error } = await supabase.from('base_access_groups').select('*').order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
}

async function getBaseAccessDiscordServers() {
    const { data, error } = await supabase.from('base_access_discord_servers').select('*').order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
}

async function getLinkedDiscordUserId(robloxUserId) {
    const { data, error } = await supabase.from('discord_links').select('discord_user_id').eq('roblox_user_id', robloxUserId).maybeSingle();
    if (error) return null;
    return data ? data.discord_user_id : null;
}

async function getIgnoreEligibilityConfig() {
    const { data, error } = await supabase
        .from('app_settings')
        .select('ignore_eligibility')
        .eq('id', 1)
        .maybeSingle();
    if (error) throw error;
    return !!(data && data.ignore_eligibility);
}

async function getDevexRate() {
    const { data, error } = await supabase
        .from('app_settings')
        .select('devex_rate')
        .eq('id', 1)
        .maybeSingle();
    if (error) throw error;
    return data && data.devex_rate != null ? Number(data.devex_rate) : 0;
}

// Configurable recruitment auto-hire settings: the in-app tool role and Discord role given
// automatically on acceptance, and how long HR has to respond before an application auto-accepts.
async function getRecruitmentConfig() {
    const { data, error } = await supabase
        .from('app_settings')
        .select('recruitment_auto_role_id, recruitment_discord_role_id, recruitment_grace_period_hours, recruitment_notify_role_id')
        .eq('id', 1)
        .maybeSingle();
    if (error) throw error;
    return {
        autoRoleId: data && data.recruitment_auto_role_id != null ? String(data.recruitment_auto_role_id) : null,
        discordRoleId: data && data.recruitment_discord_role_id ? String(data.recruitment_discord_role_id) : null,
        gracePeriodHours: data && data.recruitment_grace_period_hours != null ? Number(data.recruitment_grace_period_hours) : null,
        notifyRoleId: data && data.recruitment_notify_role_id != null ? String(data.recruitment_notify_role_id) : null
    };
}

async function notifyRoleHoldersDM(roleId, message) {
    if (!roleId) return 0;
    const { data: holders, error } = await supabase.from('user_role_assignments').select('roblox_user_id').eq('role_id', roleId);
    if (error || !holders || !holders.length) return 0;
    const userIds = [...new Set(holders.map(h => h.roblox_user_id))];
    let notified = 0;
    for (const userId of userIds) {
        const discordUserId = await getLinkedDiscordUserId(userId);
        if (discordUserId) {
            await sendDiscordDM(discordUserId, message);
            notified++;
        }
    }
    return notified;
}

async function getRecruitmentApprovalConfig() {
    const { data, error } = await supabase
        .from('app_settings')
        .select('recruitment_signoff_role_id, recruitment_producer_role_id')
        .eq('id', 1)
        .maybeSingle();
    if (error) throw error;
    return {
        signoffRoleId: data && data.recruitment_signoff_role_id ? String(data.recruitment_signoff_role_id) : null,
        producerRoleId: data && data.recruitment_producer_role_id ? String(data.recruitment_producer_role_id) : null
    };
}

async function getOnboardingGroupConfig() {
    const { data, error } = await supabase
        .from('app_settings')
        .select('onboarding_group_id, onboarding_group_role_id')
        .eq('id', 1)
        .maybeSingle();
    if (error) throw error;
    return {
        groupId: data && data.onboarding_group_id != null ? Number(data.onboarding_group_id) : null,
        groupRoleId: data && data.onboarding_group_role_id != null ? Number(data.onboarding_group_role_id) : null
    };
}

// Kicks off the post-finalise Discord onboarding flow: DMs the new hire a "join the Roblox group"
// message with a Continue button that starts out disabled. The scheduled sweep below enables it
// once they've actually joined; bot.js handles the button clicks themselves (Continue, then Get
// Ranked) since those need a live gateway connection to respond to.
//
// Generalized so it can be kicked off either from a finalised recruitment ticket, or from someone
// claiming an invite/onboarding link - both cases end with the same "join main group, request to
// join team group" Discord DM flow. Exactly one of ticketId/linkToken should be set so bot.js and
// runOnboardingJoinCheck know which record to look at and (for links) what to grant once done.
async function startAccessOnboardingFlow({ robloxUserId, robloxUsername, discordUserId, ticketId = null, linkToken = null, teamId = null, skillsetId = null, roleId = null }) {
    try {
        const config = await getOnboardingGroupConfig();
        if (!config.groupId || !DISCORD_BOT_TOKEN || !discordUserId) return null;

        const dmChannel = await discordApi('/users/@me/channels', {
            method: 'POST',
            body: JSON.stringify({ recipient_id: discordUserId })
        });
        if (!dmChannel || !dmChannel.id) return null;

        const { data: flow, error: flowErr } = await supabase.from('recruit_onboarding_flows').insert({
            roblox_user_id: robloxUserId,
            roblox_username: robloxUsername,
            discord_user_id: discordUserId,
            dm_channel_id: dmChannel.id,
            ticket_id: ticketId,
            link_token: linkToken,
            team_id: teamId,
            skillset_id: skillsetId,
            role_id: roleId,
            step: 'awaiting_group_join',
            last_prompt_state: 'neither'
        }).select('id').maybeSingle();
        if (flowErr || !flow) { console.error('startAccessOnboardingFlow: could not create flow row:', flowErr && flowErr.message); return null; }

        let teamGroupLine = '';
        let teamJoinRow = null;
        if (teamId) {
            const { data: team } = await supabase.from('teams').select('name, roblox_group_id').eq('id', teamId).maybeSingle();
            // If the team's own group IS the main onboarding group, there's nothing separate to
            // join or request - joining the main group covers it, and bot.js's continue handler
            // ranks them straight onto the team's configured role instead of the default main rank.
            if (team && team.roblox_group_id && Number(team.roblox_group_id) !== Number(config.groupId)) {
                teamGroupLine = ` You also need to request to join your team's group (${team.name}) below - it's invite-only, so the bot will accept your request and rank you automatically once you've asked to join.`;
                teamJoinRow = {
                    type: 1,
                    components: [{
                        type: 2, style: 5, label: `Request to join ${team.name}`, url: `https://www.roblox.com/groups/${team.roblox_group_id}`
                    }]
                };
            }
        }

        const components = [{
            type: 1,
            components: [{
                type: 2, style: 5, label: 'Join the Roblox group', url: `https://www.roblox.com/groups/${config.groupId}`
            }, {
                type: 2, style: 1, label: 'Continue', custom_id: `onboarding_continue_${flow.id}`, disabled: true
            }]
        }];
        if (teamJoinRow) components.push(teamJoinRow);

        const message = await discordApi(`/channels/${dmChannel.id}/messages`, {
            method: 'POST',
            body: JSON.stringify({
                content: `Welcome to the team, ${robloxUsername}. To finish setting up your access, you need to join the PlayVerse Roblox group first.${teamGroupLine}`,
                components
            })
        });
        if (message && message.id) {
            await supabase.from('recruit_onboarding_flows').update({ message_id: message.id }).eq('id', flow.id);
        }
        return flow;
    } catch (e) {
        console.error(`startAccessOnboardingFlow failed:`, e.message);
        return null;
    }
}

// Thin wrapper kept for the recruitment-ticket call site: pulls the team id straight off the
// finalised ticket and hands off to the generalized flow starter above.
async function startOnboardingFlow(ticket) {
    return startAccessOnboardingFlow({
        robloxUserId: ticket.roblox_user_id,
        robloxUsername: ticket.roblox_username,
        discordUserId: ticket.discord_user_id,
        ticketId: ticket.id,
        teamId: ticket.placed_team_id || null
    });
}

// Checks whether someone has either already joined a group, or at least filed a join request for
// it (invite-only groups) - either counts as "they've done their part" for the purposes of the
// onboarding checklist. Read-only, never accepts anything.
async function hasJoinedOrRequestedGroup(groupId, robloxUserId) {
    try {
        const groupRoles = await fetchRobloxGroupRoles(robloxUserId);
        if (groupRoles.some(gr => gr.group && gr.group.id === Number(groupId))) return true;
    } catch (e) { }

    if (!ROBLOX_GROUP_API_KEY) return false;
    try {
        const listUrl = `https://apis.roblox.com/cloud/v2/groups/${groupId}/join-requests?maxPageSize=10&filter=${encodeURIComponent(`user == 'users/${robloxUserId}'`)}`;
        const res = await fetch(listUrl, { headers: { 'x-api-key': ROBLOX_GROUP_API_KEY } });
        if (!res.ok) return false;
        const json = await res.json().catch(() => null);
        const requests = (json && (json.groupJoinRequests || json.data)) || [];
        return requests.some(r => String(r.user || '').endsWith(`/${robloxUserId}`));
    } catch (e) {
        return false;
    }
}

const ONBOARDING_JOIN_CHECK_INTERVAL_MS = 3 * 1000;

// Every 3 seconds, checks anyone still on "awaiting_group_join" against both the main group and
// (if their team has one) the team group, and only enables Continue once both are satisfied.
// Edits the message to reflect whichever one is still outstanding, but only when that actually
// changes - not on every tick - so it doesn't spam Discord's edit rate limit for no reason.
async function runOnboardingJoinCheck() {
    try {
        const config = await getOnboardingGroupConfig();
        if (!config.groupId) return;

        const { data: flows, error } = await supabase
            .from('recruit_onboarding_flows')
            .select('*')
            .eq('step', 'awaiting_group_join');
        if (error || !flows || !flows.length) return;

        for (const flow of flows) {
            const groupRoles = await fetchRobloxGroupRoles(flow.roblox_user_id);
            const mainJoined = groupRoles.some(gr => gr.group && gr.group.id === config.groupId);

            let team = null;
            // team_id is stored directly on the flow row for both ticket-based and invite-link-based
            // flows now - fall back to looking it up via the ticket for older rows created before
            // that column existed.
            let teamId = flow.team_id;
            if (teamId == null && flow.ticket_id) {
                const { data: ticket } = await supabase.from('recruitment_tickets').select('placed_team_id').eq('id', flow.ticket_id).maybeSingle();
                teamId = ticket ? ticket.placed_team_id : null;
            }
            if (teamId) {
                const { data: teamRow } = await supabase.from('teams').select('name, roblox_group_id, default_group_role_id').eq('id', teamId).maybeSingle();
                // Skip treating this as a separate group to wait on when it's the same group
                // as the main one - joining the main group already satisfies it, and there's
                // no separate join-request step for bot.js to accept later.
                if (teamRow && teamRow.roblox_group_id && teamRow.default_group_role_id && Number(teamRow.roblox_group_id) !== Number(config.groupId)) team = teamRow;
            }
            const teamRequested = team ? await hasJoinedOrRequestedGroup(team.roblox_group_id, flow.roblox_user_id) : true;

            const currentState = mainJoined && teamRequested ? 'both' : mainJoined ? 'main_only' : (team && teamRequested) ? 'team_only' : 'neither';
            if (currentState === (flow.last_prompt_state || 'neither')) continue;

            const updates = { last_prompt_state: currentState, updated_at: new Date().toISOString() };
            let content;
            const components = [{
                type: 1,
                components: [{
                    type: 2, style: 5, label: 'Join the Roblox group', url: `https://www.roblox.com/groups/${config.groupId}`
                }, {
                    type: 2, style: mainJoined && teamRequested ? 3 : 1, label: 'Continue', custom_id: `onboarding_continue_${flow.id}`, disabled: !(mainJoined && teamRequested)
                }]
            }];
            if (team) {
                components.push({
                    type: 1,
                    components: [{
                        type: 2, style: 5, label: `Request to join ${team.name}`, url: `https://www.roblox.com/groups/${team.roblox_group_id}`
                    }]
                });
            }

            // team is only ever non-null here when there's an actual separate group to wait on
            // (see above) - every branch below that references team.name is guarded by `team`
            // so it can't fire when there's no separate team group (or the team's group IS the
            // main group), since teamRequested defaults to true in that case.
            if (mainJoined && teamRequested) {
                updates.step = 'group_joined';
                content = `You've joined both groups. Click Continue to finish setting up your access.`;
            } else if (mainJoined) {
                content = `You've joined the main group. You still need to request to join ${team.name}'s group to continue.`;
            } else if (team && teamRequested) {
                content = `You've requested to join ${team.name}'s group. You still need to join the main PlayVerse group to continue.`;
            } else {
                content = team
                    ? `Still waiting for you to join the main group and request to join ${team.name}'s group.`
                    : `Still waiting for you to join the main group.`;
            }

            await supabase.from('recruit_onboarding_flows').update(updates).eq('id', flow.id);

            if (flow.dm_channel_id && flow.message_id) {
                try {
                    await discordApi(`/channels/${flow.dm_channel_id}/messages/${flow.message_id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ content, components })
                    });
                } catch (e) {
                    console.error(`runOnboardingJoinCheck: failed to update message for flow ${flow.id}:`, e.message);
                }
            }
        }
    } catch (e) {
        console.error('runOnboardingJoinCheck failed:', e.message);
    }
}

async function userHasConfiguredRole(session, roleId) {
    if (!roleId || !session) return false;
    const { data: role } = await supabase.from('roles').select('name').eq('id', roleId).maybeSingle();
    if (!role) return false;
    return Array.isArray(session.roles) && session.roles.includes(role.name);
}

async function findProducersForTeam(teamId) {
    const config = await getRecruitmentApprovalConfig();
    if (!config.producerRoleId || !teamId) return [];
    const { data: assigned } = await supabase.from('user_assignments').select('roblox_user_id, roblox_username').eq('team_id', teamId);
    if (!assigned || !assigned.length) return [];
    const userIds = assigned.map(a => a.roblox_user_id);
    const { data: roleHolders } = await supabase.from('user_role_assignments').select('roblox_user_id').eq('role_id', config.producerRoleId).in('roblox_user_id', userIds);
    const producerIds = new Set((roleHolders || []).map(r => r.roblox_user_id));
    return assigned.filter(a => producerIds.has(a.roblox_user_id));
}

async function getUsdMinimumPending() {
    const { data, error } = await supabase
        .from('app_settings')
        .select('usd_minimum_pending')
        .eq('id', 1)
        .maybeSingle();
    if (error) throw error;
    return data && data.usd_minimum_pending != null ? Number(data.usd_minimum_pending) : 0;
}

async function getPendingUsdEquivalent(robloxUserId, robloxUsername) {
    let query = supabase.from('payment_requests').select('payment, currency, status, paid').eq('paid', false);
    if (robloxUserId != null) {
        query = query.eq('roblox_user_id', robloxUserId);
    } else if (robloxUsername) {
        query = query.is('roblox_user_id', null).ilike('roblox_username', robloxUsername);
    } else {
        return 0;
    }
    const { data: rows } = await query;
    const pendingRows = (rows || []).filter(r => (r.status || 'pending') === 'pending');
    if (!pendingRows.length) return 0;
    const rate = await getDevexRate();
    return pendingRows.reduce((sum, r) => {
        const amount = Number(r.payment) || 0;
        if ((r.currency || 'ROBUX') === 'USD') return sum + amount;
        return sum + (rate > 0 ? amount * rate : 0);
    }, 0);
}

async function enforceUsdMinimumThreshold(filter) {
    try {
        const threshold = await getUsdMinimumPending();
        if (!(threshold > 0)) return;

        let methodQuery = supabase.from('payment_methods').select('*').in('method', ['PAYPAL', 'VENMO']);
        if (filter && filter.robloxUserId != null) methodQuery = methodQuery.eq('roblox_user_id', filter.robloxUserId);
        const { data: methods, error: methodsErr } = await methodQuery;
        if (methodsErr || !methods || !methods.length) return;

        for (const m of methods) {
            const pendingUsdEquivalent = await getPendingUsdEquivalent(m.roblox_user_id, m.roblox_username);
            if (pendingUsdEquivalent >= threshold) continue;

            await supabase.from('payment_methods').update({
                method: 'DEVEX_ROBUX',
                details: { robloxUsername: m.roblox_username },
                updated_at: new Date().toISOString()
            }).eq('roblox_user_id', m.roblox_user_id);

            const discordUserId = await getLinkedDiscordUserId(m.roblox_user_id);
            if (discordUserId) {
                sendDiscordDM(discordUserId, `Your payment method has been changed to DevEx Robux because your pending balance ($${pendingUsdEquivalent.toFixed(2)}) is below the $${threshold} minimum required for USD payouts. Your pending payment requests have been converted to Robux.`);
            }

            logAudit(null, {
                category: 'payments', action: 'auto_downgrade_payment_method',
                targetUserId: m.roblox_user_id, targetUsername: m.roblox_username,
                details: { actor: 'System', from: m.method, to: 'DEVEX_ROBUX', pendingUsdEquivalent, threshold }
            });
        }
    } catch (e) {
        console.error('enforceUsdMinimumThreshold failed:', e.message);
    }
}

// Bulk-resolves current Roblox usernames for a list of user ids via Roblox's users-by-id endpoint,
// batching in groups of 200 (its limit). Returns a { userId: currentUsername } map.
async function resolveCurrentRobloxUsernames(userIds) {
    const ids = [...new Set((userIds || []).filter(id => id != null))];
    const result = {};
    if (!ids.length) return result;
    for (let i = 0; i < ids.length; i += 200) {
        const batch = ids.slice(i, i + 200);
        try {
            const res = await fetch('https://users.roblox.com/v1/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userIds: batch, excludeBannedUsers: false })
            });
            if (!res.ok) continue;
            const json = await res.json().catch(() => null);
            (json && json.data || []).forEach(u => { result[u.id] = u.name; });
        } catch (e) {
            console.error('resolveCurrentRobloxUsernames: batch failed:', e.message);
        }
    }
    return result;
}

// Someone can rename their Roblox account at any time. syncRobloxUsername() catches this for
// whoever's actually signing in, but a payment request just sits there referencing whatever name
// was current when it was created - the issuer, the recipient, or both might have renamed since,
// and neither necessarily needs to log in again before that request gets paid. This sweeps every
// pending request and corrects both the issuer and recipient names to whatever's current on
// Roblox right now, independent of anyone logging in.
async function refreshPaymentRequestUsernames() {
    try {
        const { data: rows, error } = await supabase
            .from('payment_requests')
            .select('id, roblox_user_id, roblox_username, requested_by, requested_by_user_id')
            .eq('paid', false)
            .eq('status', 'pending');
        if (error || !rows || !rows.length) return;

        const userIds = [];
        rows.forEach(r => {
            if (r.roblox_user_id != null) userIds.push(r.roblox_user_id);
            if (r.requested_by_user_id != null) userIds.push(r.requested_by_user_id);
        });
        const currentNames = await resolveCurrentRobloxUsernames(userIds);
        if (!Object.keys(currentNames).length) return;

        await Promise.all(rows.map(row => {
            const updates = {};
            const currentRecipientName = row.roblox_user_id != null ? currentNames[row.roblox_user_id] : null;
            if (currentRecipientName && currentRecipientName !== row.roblox_username) {
                updates.roblox_username = currentRecipientName;
            }
            const currentIssuerName = row.requested_by_user_id != null ? currentNames[row.requested_by_user_id] : null;
            if (currentIssuerName && currentIssuerName !== row.requested_by) {
                updates.requested_by = currentIssuerName;
            }
            if (!Object.keys(updates).length) return Promise.resolve();
            return supabase.from('payment_requests').update(updates).eq('id', row.id);
        }));
    } catch (e) {
        console.error('refreshPaymentRequestUsernames failed:', e.message);
    }
}


async function runPaymentMethodConversionSweep(filter) {
    try {
        let query = supabase
            .from('payment_requests')
            .select('id, roblox_user_id, roblox_username, payment, currency, status, paid')
            .eq('paid', false);
        if (filter && filter.robloxUserId != null) {
            query = query.eq('roblox_user_id', filter.robloxUserId);
        } else if (filter && filter.robloxUsername) {
            query = query.is('roblox_user_id', null).ilike('roblox_username', filter.robloxUsername);
        }
        const { data: rows, error } = await query;
        if (error || !rows || !rows.length) return;

        const pendingRows = rows.filter(r => (r.status || 'pending') === 'pending');
        if (!pendingRows.length) return;

        const userIds = [...new Set(pendingRows.filter(r => r.roblox_user_id != null).map(r => r.roblox_user_id))];
        const usernames = [...new Set(pendingRows.filter(r => r.roblox_user_id == null && r.roblox_username).map(r => r.roblox_username))];

        const [byIdRes, byUsernameRes] = await Promise.all([
            userIds.length ? supabase.from('payment_methods').select('roblox_user_id, roblox_username, method').in('roblox_user_id', userIds) : Promise.resolve({ data: [] }),
            usernames.length ? supabase.from('payment_methods').select('roblox_user_id, roblox_username, method').in('roblox_username', usernames) : Promise.resolve({ data: [] })
        ]);
        const methodByUserId = {};
        const methodByUsername = {};
        [].concat(byIdRes.data || [], byUsernameRes.data || []).forEach(m => {
            if (m.roblox_user_id != null) methodByUserId[m.roblox_user_id] = m.method;
            if (m.roblox_username) methodByUsername[m.roblox_username.toLowerCase()] = m.method;
        });

        const methodToCurrency = { PAYPAL: 'USD', VENMO: 'USD', DEVEX_ROBUX: 'ROBUX' };

        const toConvert = pendingRows
            .map(r => {
                const method = (r.roblox_user_id != null ? methodByUserId[r.roblox_user_id] : null)
                    || (r.roblox_username ? methodByUsername[(r.roblox_username || '').toLowerCase()] : null);
                return { row: r, targetCurrency: methodToCurrency[method] };
            })
            .filter(x => x.targetCurrency && x.targetCurrency !== (x.row.currency || 'ROBUX'));
        if (!toConvert.length) return;

        const rate = await getDevexRate();
        if (!(rate > 0)) return;

        await Promise.all(toConvert.map(({ row, targetCurrency }) => {
            const amount = targetCurrency === 'USD'
                ? Math.round((Number(row.payment) || 0) * rate * 100) / 100
                : Math.round((Number(row.payment) || 0) / rate);
            return supabase.from('payment_requests').update({ payment: amount, currency: targetCurrency }).eq('id', row.id);
        }));
    } catch (e) {
        console.error('runPaymentMethodConversionSweep failed:', e.message);
    }
}

// Runs the conversion sweep for both possible identities of a user (matched by id, and separately
// by username for older rows that only ever had a username stored) - used right after something
// happens for one specific person, so it converts immediately rather than waiting on the schedule.
async function convertPendingForUser(robloxUserId, robloxUsername) {
    if (robloxUserId != null) await enforceUsdMinimumThreshold({ robloxUserId });
    await Promise.all([
        robloxUserId != null ? runPaymentMethodConversionSweep({ robloxUserId }) : Promise.resolve(),
        robloxUsername ? runPaymentMethodConversionSweep({ robloxUsername }) : Promise.resolve()
    ]);
}

const PAYMENT_CONVERSION_SWEEP_INTERVAL_MS = 15 * 60 * 1000;

// Sign-in access is granted if the Roblox account belongs to at least one of the configured
// Roblox groups (at that group's minimum rank, if set) OR their linked Discord account belongs to
// at least one of the configured Discord servers - so a separate "tester" group/server can be
// added alongside the main one without anyone needing to be in both. If neither list has any
// entries, sign-in is unrestricted (matches the old "leave the group ID blank" behavior).
async function checkBaseAccess(robloxUserId) {
    const [groups, discordServers] = await Promise.all([getBaseAccessGroups(), getBaseAccessDiscordServers()]);

    if (!groups.length && !discordServers.length) {
        return { allowed: true, isMember: true, viaPlacement: false };
    }

    const [{ data: manualRows, error: manualErr }, { data: placementRows, error: placementErr }] = await Promise.all([
        supabase.from('user_role_assignments').select('id').eq('roblox_user_id', robloxUserId).limit(1),
        supabase.from('user_assignments').select('roblox_user_id').eq('roblox_user_id', robloxUserId).limit(1)
    ]);
    if (manualErr) throw manualErr;
    if (placementErr) throw placementErr;
    const hasBypass = (manualRows && manualRows.length > 0) || (placementRows && placementRows.length > 0);

    let isMember = false;

    if (groups.length) {
        const groupRoles = await fetchRobloxGroupRoles(robloxUserId);
        isMember = groups.some(g => {
            const membership = groupRoles.find(gr => gr.group && gr.group.id === Number(g.roblox_group_id));
            return !!membership && (g.min_rank == null || membership.role.rank >= g.min_rank);
        });
    }

    if (!isMember && discordServers.length) {
        const discordUserId = await getLinkedDiscordUserId(robloxUserId);
        if (discordUserId) {
            isMember = await isMemberOfAnyGuild(discordUserId, discordServers.map(s => s.discord_guild_id));
        }
    }

    if (isMember) return { allowed: true, isMember: true, viaPlacement: false };
    if (hasBypass) return { allowed: true, isMember: false, viaPlacement: true };
    return { allowed: false, isMember: false, viaPlacement: false };
}

async function computeAccess(robloxUserId) {
    const { data: roles, error: rolesErr } = await supabase.from('roles').select('*');
    if (rolesErr) throw rolesErr;

    const { data: manualRows, error: manualErr } = await supabase
        .from('user_role_assignments')
        .select('role_id')
        .eq('roblox_user_id', robloxUserId);
    if (manualErr) throw manualErr;
    const manualRoleIds = new Set((manualRows || []).map(r => r.role_id));

    const groupRoles = await fetchRobloxGroupRoles(robloxUserId);
    const rankByGroupId = {};
    groupRoles.forEach(g => { rankByGroupId[g.group.id] = g.role.rank; });

    const matchedRoles = (roles || []).filter(role => {
        if (manualRoleIds.has(role.id)) return true;
        if (role.link_only) return false;
        if (role.roblox_group_id != null) {
            const rank = rankByGroupId[role.roblox_group_id];
            if (rank == null) return false;
            if (role.min_rank == null) return true;
            return rank === role.min_rank;
        }
        return false;
    });

    const permissionSet = new Set();
    matchedRoles.forEach(role => (role.permissions || []).forEach(p => permissionSet.add(p)));

    const maxHierarchy = matchedRoles.reduce((max, role) => Math.max(max, Number(role.hierarchy) || 0), 0);

    return {
        roleNames: matchedRoles.map(r => r.name),
        permissions: Array.from(permissionSet),
        maxHierarchy
    };
}

async function getUserHierarchy(robloxUserId) {
    try {
        const access = await computeAccess(robloxUserId);
        return access.maxHierarchy || 0;
    } catch (e) {
        return 0;
    }
}

async function computeGroupEligibility(robloxUserId) {
    const results = [];

    const requiredStepIds = ONBOARDING_STEPS.filter(s => s.required).map(s => s.id);
    const { data: progress, error: progErr } = await supabase
        .from('staff_onboarding_progress')
        .select('step_id, completed_at')
        .eq('roblox_user_id', robloxUserId);
    if (progErr) throw progErr;
    const completedStepIds = new Set((progress || []).filter(p => p.completed_at).map(p => p.step_id));
    const onboardingComplete = requiredStepIds.every(id => completedStepIds.has(id));

    results.push({
        id: 'onboarding_complete',
        name: 'Completed onboarding (incl. Terms of Service)',
        isMember: onboardingComplete,
        eligible: onboardingComplete,
        metaLabel: onboardingComplete ? 'Onboarding complete' : 'Onboarding not completed'
    });

    const { data: paymentMethod, error: pmErr } = await supabase
        .from('payment_methods')
        .select('roblox_user_id')
        .eq('roblox_user_id', robloxUserId)
        .maybeSingle();
    if (pmErr) throw pmErr;
    const hasPaymentMethod = !!paymentMethod;

    results.push({
        id: 'payment_method',
        name: 'Payment method on file',
        isMember: hasPaymentMethod,
        eligible: hasPaymentMethod,
        metaLabel: hasPaymentMethod ? 'Payment method saved' : 'No payment method saved'
    });

    const { data: requiredGroups, error: groupsErr } = await supabase
        .from('required_groups')
        .select('*')
        .order('name', { ascending: true });
    if (groupsErr) throw groupsErr;

    if (requiredGroups && requiredGroups.length > 0) {
        const memberships = await fetchRobloxGroupRoles(robloxUserId);
        const groupIdsJoined = new Set(memberships.map(m => String(m.group.id)));

        for (const rg of requiredGroups) {
            const isMember = groupIdsJoined.has(String(rg.roblox_group_id));

            results.push({
                id: rg.id,
                robloxGroupId: rg.roblox_group_id,
                name: rg.name,
                isMember,
                eligible: isMember
            });

            await supabase.from('group_eligibility_cache').upsert({
                roblox_user_id: robloxUserId,
                required_group_id: rg.id,
                is_member: isMember,
                eligible: isMember,
                checked_at: new Date().toISOString()
            }, { onConflict: 'roblox_user_id,required_group_id' });
        }
    }

    return results;
}

async function upsertUserAssignmentRecord({ robloxUserId, robloxUsername, teamId, skillsetId }) {
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

// NOTE: invite/onboarding links used to be granted instantly here on claim. That's now handled by
// the generalized Discord-gated group-join flow (see startAccessOnboardingFlow, the
// claim_onboarding_link action, and bot.js's onboarding_continue handler / grantInviteLinkAccess),
// which only grants the team/skillset/role once the person has linked Discord, is in the server,
// and has joined (or requested to join) the relevant Roblox group(s) - matching how recruitment
// finalisation already worked.

async function getUserTeamAssignments(robloxUserId) {
    const { data: rows, error } = await supabase
        .from('user_assignments')
        .select('*')
        .eq('roblox_user_id', robloxUserId)
        .order('assigned_at', { ascending: true });
    if (error) throw error;
    const list = rows || [];
    const teamIds = [...new Set(list.filter(r => r.team_id != null).map(r => r.team_id))];
    const skillsetIds = [...new Set(list.filter(r => r.skillset_id != null).map(r => r.skillset_id))];
    const [teamsRes, skillsetsRes] = await Promise.all([
        teamIds.length ? supabase.from('teams').select('*').in('id', teamIds) : Promise.resolve({ data: [] }),
        skillsetIds.length ? supabase.from('skillsets').select('*').in('id', skillsetIds) : Promise.resolve({ data: [] })
    ]);
    const teamById = {}; (teamsRes.data || []).forEach(t => { teamById[t.id] = t; });
    const skillsetById = {}; (skillsetsRes.data || []).forEach(s => { skillsetById[s.id] = s; });
    return list.map(r => ({
        teamId: r.team_id,
        skillsetId: r.skillset_id,
        team: r.team_id != null ? (teamById[r.team_id] || null) : null,
        skillset: r.skillset_id != null ? (skillsetById[r.skillset_id] || null) : null,
        assignedAt: r.assigned_at
    }));
}

async function isUserBanned(robloxUserId) {
    const { data } = await supabase.from('banned_users').select('roblox_user_id').eq('roblox_user_id', robloxUserId).maybeSingle();
    return !!data;
}

async function getWarnCount(robloxUserId) {
    const { count, error } = await supabase
        .from('staff_warnings')
        .select('*', { count: 'exact', head: true })
        .eq('roblox_user_id', robloxUserId);
    if (error) return 0;
    return count || 0;
}

function hasPermission(session, permission) {
    return !!session && Array.isArray(session.permissions) && session.permissions.includes(permission);
}

function requirePermission(res, session, permission) {
    if (hasPermission(session, permission)) return true;
    res.status(403).json({ ok: false, error: 'missing_permission' });
    return false;
}

function requireHigherHierarchy(res, session, targetHierarchy) {
    const actorHierarchy = Number(session && session.max_hierarchy) || 0;
    if (actorHierarchy > (Number(targetHierarchy) || 0)) return true;
    res.status(403).json({ ok: false, error: 'insufficient_hierarchy' });
    return false;
}

async function logAudit(session, { category, action, targetUserId, targetUsername, details, revert }) {
    try {
        const { data, error } = await supabase.from('audit_logs').insert({
            category,
            action,
            actor_user_id: session ? session.roblox_user_id : null,
            actor_username: session ? session.roblox_username : (details && details.actor) || 'system',
            target_user_id: targetUserId != null ? targetUserId : null,
            target_username: targetUsername || null,
            details: details || {},
            revert_data: revert || null,
            reverted: false,
            created_at: new Date().toISOString()
        }).select('id').maybeSingle();
        if (error) { console.error('audit log insert failed:', error.message); return null; }
        return data ? data.id : null;
    } catch (e) {
        console.error('audit log insert failed:', e.message);
        return null;
    }
}

async function applyRevert(revert) {
    if (!revert || !revert.type) return { ok: false, error: 'nothing_to_revert' };
    switch (revert.type) {
        case 'unmark_paid': {
            const { error } = await supabase.from('payment_requests')
                .update({ paid: false, paid_at: null, status: 'pending', status_note: null })
                .eq('id', revert.id);
            return error ? { ok: false, error: error.message } : { ok: true };
        }
        case 'unmark_paid_bulk': {
            const { error } = await supabase.from('payment_requests')
                .update({ paid: false, paid_at: null, status: 'pending', status_note: null })
                .in('id', revert.ids || []);
            return error ? { ok: false, error: error.message } : { ok: true };
        }
        case 'reopen_request': {
            const { error } = await supabase.from('payment_requests')
                .update({ status: 'pending', status_note: null })
                .eq('id', revert.id);
            return error ? { ok: false, error: error.message } : { ok: true };
        }
        case 'delete_payment_request': {
            const { error } = await supabase.from('payment_requests').delete().eq('id', revert.id);
            return error ? { ok: false, error: error.message } : { ok: true };
        }
        case 'restore_payment_request': {
            const { error } = await supabase.from('payment_requests').upsert(revert.row);
            return error ? { ok: false, error: error.message } : { ok: true };
        }
        case 'remove_warning': {
            const { error } = await supabase.from('staff_warnings').delete().eq('id', revert.warningId);
            return error ? { ok: false, error: error.message } : { ok: true };
        }
        case 'restore_warning': {
            const { error } = await supabase.from('staff_warnings').upsert(revert.row);
            return error ? { ok: false, error: error.message } : { ok: true };
        }
        case 'unban_user': {
            const { error } = await supabase.from('banned_users').delete().eq('roblox_user_id', revert.robloxUserId);
            return error ? { ok: false, error: error.message } : { ok: true };
        }
        case 'reban_user': {
            const { error } = await supabase.from('banned_users').upsert(revert.row, { onConflict: 'roblox_user_id' });
            return error ? { ok: false, error: error.message } : { ok: true };
        }
        default:
            return { ok: false, error: 'unknown_revert_type' };
    }
}

const BACKUP_TABLES = [
    'payment_requests', 'payment_methods', 'staff_warnings', 'banned_users',
    'roles', 'user_role_assignments', 'teams', 'skillsets', 'user_assignments',
    'games', 'audit_logs', 'recruitment_tickets', 'recruitment_messages', 'discord_links'
];

async function runBackup(trigger, actorUsername) {
    const dump = {};
    const rowCounts = {};
    for (const table of BACKUP_TABLES) {
        const { data, error } = await supabase.from(table).select('*');
        if (error) { dump[table] = []; rowCounts[table] = 0; continue; }
        dump[table] = data || [];
        rowCounts[table] = (data || []).length;
    }
    const json = JSON.stringify({ tables: BACKUP_TABLES, dump, created_at: new Date().toISOString() });
    const gz = zlib.gzipSync(Buffer.from(json, 'utf8'));
    const dataGz = gz.toString('base64');

    const { data, error } = await supabase.from('backups').insert({
        created_by: actorUsername || 'system',
        trigger,
        tables: BACKUP_TABLES,
        row_counts: rowCounts,
        size_bytes: gz.length,
        data_gz: dataGz,
        created_at: new Date().toISOString()
    }).select('id, created_by, trigger, tables, row_counts, size_bytes, created_at').maybeSingle();

    if (error) throw new Error(error.message);
    return data;
}

const BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
setTimeout(() => {
    runBackup('scheduled', 'system').catch(e => console.error('scheduled backup failed:', e.message));
}, 60 * 1000);
setInterval(() => {
    runBackup('scheduled', 'system').catch(e => console.error('scheduled backup failed:', e.message));
}, BACKUP_INTERVAL_MS);

setTimeout(() => {
    runRecruitmentAutoAccept().catch(e => console.error('initial runRecruitmentAutoAccept failed:', e.message));
}, 60 * 1000);
setInterval(() => {
    runRecruitmentAutoAccept().catch(e => console.error('scheduled runRecruitmentAutoAccept failed:', e.message));
}, RECRUITMENT_AUTO_ACCEPT_INTERVAL_MS);

setTimeout(() => {
    runTicketChannelCleanup().catch(e => console.error('initial runTicketChannelCleanup failed:', e.message));
}, 90 * 1000);
setInterval(() => {
    runTicketChannelCleanup().catch(e => console.error('scheduled runTicketChannelCleanup failed:', e.message));
}, TICKET_CHANNEL_CLEANUP_INTERVAL_MS);

setInterval(() => {
    runOnboardingJoinCheck().catch(e => console.error('scheduled runOnboardingJoinCheck failed:', e.message));
}, ONBOARDING_JOIN_CHECK_INTERVAL_MS);

setTimeout(() => {
    enforceUsdMinimumThreshold().then(() => runPaymentMethodConversionSweep()).then(() => refreshPaymentRequestUsernames()).catch(e => console.error('initial payment conversion pass failed:', e.message));
}, 30 * 1000);
setInterval(() => {
    enforceUsdMinimumThreshold().then(() => runPaymentMethodConversionSweep()).then(() => refreshPaymentRequestUsernames()).catch(e => console.error('scheduled payment conversion pass failed:', e.message));
}, PAYMENT_CONVERSION_SWEEP_INTERVAL_MS);

async function getSession(req) {
    const token = getBearerToken(req);
    if (!token) return null;
    const { data, error } = await supabase
        .from('hr_sessions')
        .select('*')
        .eq('token', token)
        .maybeSingle();
    if (error || !data) return null;
    if (new Date(data.expires_at).getTime() < Date.now()) {
        await supabase.from('hr_sessions').delete().eq('token', token);
        return null;
    }

    try {
        if (await isUserBanned(data.roblox_user_id)) {
            await supabase.from('hr_sessions').delete().eq('token', token);
            return null;
        }
    } catch (e) { }

    const lastSynced = data.last_synced_at ? new Date(data.last_synced_at).getTime() : 0;
    if (Date.now() - lastSynced > ACCESS_SYNC_INTERVAL_MS) {
        try {
            const baseCheck = await checkBaseAccess(data.roblox_user_id);
            if (!baseCheck.allowed) {
                await supabase.from('hr_sessions').delete().eq('token', token);
                return null;
            }

            const access = await computeAccess(data.roblox_user_id);
            const updated = {
                ...data,
                roles: access.roleNames,
                permissions: access.permissions,
                max_hierarchy: access.maxHierarchy,
                last_synced_at: new Date().toISOString()
            };
            await supabase.from('hr_sessions').update({
                roles: updated.roles,
                permissions: updated.permissions,
                max_hierarchy: updated.max_hierarchy,
                last_synced_at: updated.last_synced_at
            }).eq('token', token);
            return updated;
        } catch (e) {
            return data;
        }
    }

    return data;
}

app.get('/roblox-auth-start', async (req, res) => {
    const state = randomToken(16);
    const codeVerifier = randomToken(32);
    const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
    const refToken = req.query.ref ? String(req.query.ref).trim().slice(0, 64) : null;

    const { error } = await supabase.from('oauth_states').insert({
        state,
        code_verifier: codeVerifier,
        ref_token: refToken || null
    });

    if (error) {
        res.status(500).send('Could not start the sign-in flow.');
        return;
    }

    const authorizeUrl = new URL('https://apis.roblox.com/oauth/v1/authorize');
    authorizeUrl.searchParams.set('client_id', ROBLOX_CLIENT_ID);
    authorizeUrl.searchParams.set('redirect_uri', ROBLOX_REDIRECT_URI);
    authorizeUrl.searchParams.set('scope', 'openid profile');
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('code_challenge', codeChallenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');

    res.redirect(authorizeUrl.toString());
});

app.get('/roblox-auth-callback', async (req, res) => {
    const code = req.query.code;
    const state = req.query.state;

    function fail(reason) {
        res.redirect(`${APP_ORIGIN}/#/auth-callback?error=${encodeURIComponent(reason)}`);
    }

    if (!code || !state) { fail('missing_code_or_state'); return; }

    const { data: stateRow } = await supabase
        .from('oauth_states')
        .select('*')
        .eq('state', state)
        .maybeSingle();

    await supabase.from('oauth_states').delete().eq('state', state);

    if (!stateRow) { fail('invalid_state'); return; }
    if (Date.now() - new Date(stateRow.created_at).getTime() > STATE_LIFETIME_MS) { fail('state_expired'); return; }

    const tokenRes = await fetch('https://apis.roblox.com/oauth/v1/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            client_id: ROBLOX_CLIENT_ID,
            client_secret: ROBLOX_CLIENT_SECRET,
            redirect_uri: ROBLOX_REDIRECT_URI,
            code_verifier: stateRow.code_verifier
        })
    });

    if (!tokenRes.ok) { fail('token_exchange_failed'); return; }
    const tokenJson = await tokenRes.json();

    const userInfoRes = await fetch('https://apis.roblox.com/oauth/v1/userinfo', {
        headers: { Authorization: `Bearer ${tokenJson.access_token}` }
    });

    if (!userInfoRes.ok) { fail('userinfo_failed'); return; }
    const userInfo = await userInfoRes.json();
    const robloxUserId = Number(userInfo.sub);
    const robloxUsername = userInfo.preferred_username || userInfo.nickname || String(robloxUserId);

    if (!robloxUserId) { fail('userinfo_failed'); return; }

    syncRobloxUsername(robloxUserId, robloxUsername);

    try {
        if (await isUserBanned(robloxUserId)) { fail('account_banned'); return; }
    } catch (e) {
        fail('ban_check_failed');
        return;
    }

    let baseCheck;
    try {
        baseCheck = await checkBaseAccess(robloxUserId);
    } catch (e) {
        fail('base_access_check_failed');
        return;
    }
    if (!baseCheck.allowed) {
        try {
            const rt = await createRecruitSession(robloxUserId, robloxUsername);
            res.redirect(`${APP_ORIGIN}/#/recruit?rt=${encodeURIComponent(rt)}`);
        } catch (e) {
            fail('not_eligible');
        }
        return;
    }

    let access;
    try {
        access = await computeAccess(robloxUserId);
    } catch (e) {
        fail('hr_check_failed');
        return;
    }

    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS).toISOString();

    const { error: sessionErr } = await supabase.from('hr_sessions').insert({
        token,
        roblox_user_id: robloxUserId,
        roblox_username: robloxUsername,
        roles: access.roleNames,
        permissions: access.permissions,
        max_hierarchy: access.maxHierarchy,
        last_synced_at: new Date().toISOString(),
        expires_at: expiresAt
    });

    if (sessionErr) { fail('session_create_failed'); return; }

    // Note: invite/onboarding links are no longer auto-claimed here. Claiming now requires a
    // linked, in-server Discord account and joining the relevant Roblox group(s) first (see the
    // claim_onboarding_link action below), so the frontend sends people with a pending ref back to
    // the #/join/<token> page after signing in rather than granting anything at this step.

    res.redirect(`${APP_ORIGIN}/#/auth-callback?session=${encodeURIComponent(token)}`);
});

app.get('/recruit-session', async (req, res) => {
    const session = await getRecruitSession(req);
    if (!session) { res.status(401).json({ ok: false, error: 'not_found_or_expired' }); return; }

    let hasFullAccess = false;
    try {
        const baseCheck = await checkBaseAccess(session.roblox_user_id);
        hasFullAccess = !!baseCheck.allowed;
    } catch (e) { }

    res.json({
        ok: true,
        robloxUserId: session.roblox_user_id,
        robloxUsername: session.roblox_username,
        discordLinked: !!session.discord_user_id,
        discordUsername: session.discord_username || null,
        discordConfigured: DISCORD_CONFIGURED,
        hasFullAccess
    });
});

app.get('/discord-auth-start', async (req, res) => {
    if (!DISCORD_CONFIGURED) { res.status(500).send('Discord sign-in is not configured.'); return; }
    const rt = req.query.rt ? String(req.query.rt) : '';
    if (!rt) { res.status(400).send('Missing recruit session.'); return; }
    const recruitSession = await getRecruitSession({ query: { rt } });
    if (!recruitSession) { res.redirect(`${APP_ORIGIN}/#/recruit?error=session_expired`); return; }

    const state = randomToken(16);
    const returnHash = req.query.return ? String(req.query.return).slice(0, 128) : '#/recruit/apply';
    const { error } = await supabase.from('discord_oauth_states').insert({ state, rt, return_hash: returnHash });
    if (error) { res.status(500).send('Could not start Discord sign-in.'); return; }
    console.log(`[discord-auth-start] created state ${state} for rt ${rt} (supabase url: ${SUPABASE_URL})`);

    const authorizeUrl = new URL('https://discord.com/oauth2/authorize');
    authorizeUrl.searchParams.set('client_id', DISCORD_CLIENT_ID);
    authorizeUrl.searchParams.set('redirect_uri', DISCORD_REDIRECT_URI);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('scope', 'identify');
    authorizeUrl.searchParams.set('state', state);
    console.log(`[discord-auth-start] sending user to Discord with redirect_uri=${DISCORD_REDIRECT_URI}`);
    res.redirect(authorizeUrl.toString());
});

app.get('/discord-auth-start-staff', async (req, res) => {
    if (!DISCORD_CONFIGURED) { res.status(500).send('Discord sign-in is not configured.'); return; }
    const token = req.query.token ? String(req.query.token) : '';
    if (!token) { res.status(400).send('Missing session.'); return; }
    const { data: hrSession } = await supabase.from('hr_sessions').select('token').eq('token', token).maybeSingle();
    if (!hrSession) { res.redirect(`${APP_ORIGIN}/#/?error=session_expired`); return; }

    const state = randomToken(16);
    // Lets callers (e.g. the invite-link flow) send the user back to wherever they started from
    // instead of always landing on the dashboard - falls back to the dashboard if not provided.
    const returnHash = req.query.return ? String(req.query.return).slice(0, 200) : null;
    const { error } = await supabase.from('discord_oauth_states').insert({ state, rt: token, is_staff: true, return_hash: returnHash });
    if (error) { res.status(500).send('Could not start Discord sign-in.'); return; }

    const authorizeUrl = new URL('https://discord.com/oauth2/authorize');
    authorizeUrl.searchParams.set('client_id', DISCORD_CLIENT_ID);
    authorizeUrl.searchParams.set('redirect_uri', DISCORD_REDIRECT_URI);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('scope', 'identify');
    authorizeUrl.searchParams.set('state', state);
    res.redirect(authorizeUrl.toString());
});

app.get('/discord-auth-callback', async (req, res) => {
    const code = req.query.code;
    const state = req.query.state;

    function fail(rt, reason) {
        res.redirect(`${APP_ORIGIN}/#/recruit/apply?rt=${encodeURIComponent(rt || '')}&error=${encodeURIComponent(reason)}`);
    }
    function failStaff(reason, returnHash) {
        const target = (returnHash || '#/dashboard').split('?')[0];
        res.redirect(`${APP_ORIGIN}/${target}?discordLinkError=${encodeURIComponent(reason)}`);
    }

    if (!code || !state) { fail(null, 'missing_code_or_state'); return; }

    const { data: stateRow, error: stateSelectErr } = await supabase.from('discord_oauth_states').select('*').eq('state', state).maybeSingle();
    await supabase.from('discord_oauth_states').delete().eq('state', state);
    if (!stateRow) {
        console.error(`[discord-auth-callback] state ${state} not found (supabase url: ${SUPABASE_URL})`, stateSelectErr ? stateSelectErr.message : '(no select error - row genuinely missing)');
        fail(null, 'invalid_state');
        return;
    }
    console.log(`[discord-auth-callback] matched state ${state} -> rt ${stateRow.rt}`);

    if (stateRow.is_staff) {
        const returnHash = stateRow.return_hash || null;
        const { data: hrSession } = await supabase.from('hr_sessions').select('roblox_user_id, roblox_username').eq('token', stateRow.rt).maybeSingle();
        if (!hrSession) { failStaff('session_expired', returnHash); return; }

        const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: DISCORD_REDIRECT_URI,
                client_id: DISCORD_CLIENT_ID,
                client_secret: DISCORD_CLIENT_SECRET
            })
        });
        if (!tokenRes.ok) { failStaff('token_exchange_failed', returnHash); return; }
        const tokenJson = await tokenRes.json();

        const userRes = await fetch('https://discord.com/api/v10/users/@me', {
            headers: { Authorization: `Bearer ${tokenJson.access_token}` }
        });
        if (!userRes.ok) { failStaff('userinfo_failed', returnHash); return; }
        const discordUser = await userRes.json();
        const discordUserId = discordUser.id;
        const discordUsername = discordUser.username + (discordUser.discriminator && discordUser.discriminator !== '0' ? `#${discordUser.discriminator}` : '');
        const discordAvatar = discordUser.avatar
            ? `https://cdn.discordapp.com/avatars/${discordUserId}/${discordUser.avatar}.png`
            : null;

        const { data: existingLink } = await supabase.from('discord_links').select('roblox_user_id, roblox_username').eq('discord_user_id', discordUserId).maybeSingle();
        if (existingLink && String(existingLink.roblox_user_id) !== String(hrSession.roblox_user_id)) {
            failStaff('discord_already_linked', returnHash);
            return;
        }

        const { error: linkErr } = await supabase.from('discord_links').upsert({
            roblox_user_id: hrSession.roblox_user_id,
            roblox_username: hrSession.roblox_username,
            discord_user_id: discordUserId,
            discord_username: discordUsername,
            discord_avatar: discordAvatar,
            linked_at: new Date().toISOString()
        }, { onConflict: 'roblox_user_id' });
        if (linkErr) {
            failStaff(linkErr.code === '23505' ? 'discord_already_linked' : 'link_save_failed', returnHash);
            return;
        }

        const target = (returnHash || '#/dashboard').split('?')[0];
        res.redirect(`${APP_ORIGIN}/${target}?discordLinked=1`);
        return;
    }

    const recruitSession = await getRecruitSession({ query: { rt: stateRow.rt } });
    if (!recruitSession) { fail(stateRow.rt, 'session_expired'); return; }

    const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: DISCORD_REDIRECT_URI,
            client_id: DISCORD_CLIENT_ID,
            client_secret: DISCORD_CLIENT_SECRET
        })
    });
    if (!tokenRes.ok) {
        const errBody = await tokenRes.text().catch(() => '');
        console.error(`[discord-auth-callback] token exchange failed (status ${tokenRes.status}) for rt ${stateRow.rt}: ${errBody}`);
        fail(stateRow.rt, 'token_exchange_failed');
        return;
    }
    const tokenJson = await tokenRes.json();

    const userRes = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: `Bearer ${tokenJson.access_token}` }
    });
    if (!userRes.ok) { fail(stateRow.rt, 'userinfo_failed'); return; }
    const discordUser = await userRes.json();
    const discordUserId = discordUser.id;
    const discordUsername = discordUser.username + (discordUser.discriminator && discordUser.discriminator !== '0' ? `#${discordUser.discriminator}` : '');
    const discordAvatar = discordUser.avatar
        ? `https://cdn.discordapp.com/avatars/${discordUserId}/${discordUser.avatar}.png`
        : null;

    const { error: linkErr } = await supabase.from('recruit_sessions').update({
        discord_user_id: discordUserId,
        discord_username: discordUsername,
        discord_avatar: discordAvatar
    }).eq('token', recruitSession.token);

    if (linkErr) {
        // Don't redirect as if this succeeded - discordLinked would still be false and the
        // user would just land back on the "Link your Discord" screen with no explanation.
        console.error(`[discord-auth-callback] failed to save discord link for rt ${stateRow.rt}:`, linkErr.message);
        fail(stateRow.rt, 'link_save_failed');
        return;
    }

    res.redirect(`${APP_ORIGIN}/#/recruit/apply?rt=${encodeURIComponent(recruitSession.token)}`);
});

app.post('/recruitment/apply', async (req, res) => {
    const recruitSession = await getRecruitSession(req);
    if (!recruitSession) { res.status(401).json({ ok: false, error: 'session_expired' }); return; }
    if (!recruitSession.discord_user_id) { res.status(400).json({ ok: false, error: 'discord_not_linked' }); return; }

    try {
        if (await isUserBanned(recruitSession.roblox_user_id)) { res.status(403).json({ ok: false, error: 'account_banned' }); return; }
    } catch (e) { }

    // Auto-deny applications from accounts whose linked Discord user isn't actually in the server -
    // we can't open a private ticket channel for them (or let HR reach them) otherwise.
    if (DISCORD_GUILD_ID) {
        const inServer = await isDiscordGuildMember(recruitSession.discord_user_id);
        if (!inServer) {
            console.warn(`recruitment/apply: rejected - Discord user ${recruitSession.discord_user_id} is not a member of guild ${DISCORD_GUILD_ID} (or the membership check failed - see isDiscordGuildMember logs above).`);
            res.status(403).json({ ok: false, error: 'discord_not_in_server' });
            return;
        }
    }

    const body = req.body || {};
    const experience = body.experience ? String(body.experience).trim() : '';
    const whyJoin = body.whyJoin ? String(body.whyJoin).trim() : '';
    let portfolioUrl = body.portfolioUrl ? String(body.portfolioUrl).trim() : null;
    const positionId = body.positionId != null && body.positionId !== '' ? Number(body.positionId) : null;
    const referredByUserId = body.referredByUserId != null && body.referredByUserId !== '' ? Number(body.referredByUserId) : null;

    if (!experience) { res.status(400).json({ ok: false, error: 'missing_experience' }); return; }
    if (!whyJoin) { res.status(400).json({ ok: false, error: 'missing_why_join' }); return; }

    let position = null;
    let positionRoleId = null;
    if (positionId) {
        const { data: positionRow } = await supabase.from('recruitment_positions').select('*').eq('id', positionId).maybeSingle();
        if (positionRow) {
            position = positionRow.name;
            positionRoleId = positionRow.discord_role_id || null;
        }
    }

    // Reject anything that isn't a genuine http(s) link. This is the field HR staff click
    // on from the review dashboard, so it must never be able to carry a javascript:, data:,
    // vbscript:, etc. URL through to their browser - that's a stored XSS -> session-theft path.
    if (portfolioUrl) {
        let parsed;
        try { parsed = new URL(portfolioUrl); } catch (e) { parsed = null; }
        if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
            res.status(400).json({ ok: false, error: 'invalid_portfolio_url' });
            return;
        }
        portfolioUrl = parsed.href;
    }

    const { data: existingOpen } = await supabase
        .from('recruitment_tickets')
        .select('id')
        .eq('roblox_user_id', recruitSession.roblox_user_id)
        .in('status', ['pending', 'in_review'])
        .maybeSingle();
    if (existingOpen) { res.status(409).json({ ok: false, error: 'application_already_open' }); return; }

    let referredByUsername = null;
    if (referredByUserId) {
        const recruiters = await listRecruiters();
        const match = recruiters.find(r => String(r.robloxUserId) === String(referredByUserId));
        if (match) referredByUsername = match.robloxUsername;
    }

    const { error: discordLinkErr } = await supabase.from('discord_links').upsert({
        roblox_user_id: recruitSession.roblox_user_id,
        roblox_username: recruitSession.roblox_username,
        discord_user_id: recruitSession.discord_user_id,
        discord_username: recruitSession.discord_username,
        discord_avatar: recruitSession.discord_avatar,
        linked_at: new Date().toISOString()
    }, { onConflict: 'roblox_user_id' });
    if (discordLinkErr) {
        console.error(`recruitment/apply: could not save discord_links for ${recruitSession.roblox_username} (Discord already linked to a different account? code ${discordLinkErr.code}):`, discordLinkErr.message);
    }

    const { data: ticket, error } = await supabase.from('recruitment_tickets').insert({
        roblox_user_id: recruitSession.roblox_user_id,
        roblox_username: recruitSession.roblox_username,
        discord_user_id: recruitSession.discord_user_id,
        discord_username: recruitSession.discord_username,
        portfolio_url: portfolioUrl,
        experience,
        why_join: whyJoin,
        position,
        position_id: positionId,
        referred_by_user_id: referredByUserId,
        referred_by_username: referredByUsername,
        status: 'pending'
    }).select('*').maybeSingle();

    if (error) { res.status(500).json({ ok: false, error: error.message }); return; }

    const portalExpiresAt = new Date(Date.now() + RECRUIT_SESSION_PORTAL_LIFETIME_MS).toISOString();
    await supabase.from('recruit_sessions').update({ expires_at: portalExpiresAt }).eq('token', recruitSession.token);

    createDiscordTicketChannel(ticket, positionRoleId);
    res.json({ ok: true, data: { id: ticket.id } });
});

app.get('/recruitment/my-ticket', async (req, res) => {
    const recruitSession = await getRecruitSession(req);
    if (!recruitSession) { res.status(401).json({ ok: false, error: 'session_expired' }); return; }

    const { data: ticket, error: ticketErr } = await supabase
        .from('recruitment_tickets')
        .select('*')
        .eq('roblox_user_id', recruitSession.roblox_user_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (ticketErr) { res.status(500).json({ ok: false, error: ticketErr.message }); return; }
    if (!ticket) { res.status(404).json({ ok: false, error: 'no_ticket' }); return; }

    // Now that we know they already have a ticket, keep them signed in to their status page for
    // the long "portal" lifetime instead of the short initial session window - so coming back
    // later doesn't force another Roblox sign-in just to see where their application stands.
    const portalExpiresAt = new Date(Date.now() + RECRUIT_SESSION_PORTAL_LIFETIME_MS).toISOString();
    if (new Date(recruitSession.expires_at).getTime() < new Date(portalExpiresAt).getTime()) {
        supabase.from('recruit_sessions').update({ expires_at: portalExpiresAt }).eq('token', recruitSession.token)
            .then(({ error }) => { if (error) console.error('my-ticket: could not extend recruit session:', error.message); });
    }

    res.json({
        ok: true,
        data: {
            ticket,
            discordChannelUrl: discordChannelUrl(ticket.discord_channel_id),
            pushConfigured: PUSH_CONFIGURED
        }
    });
});

app.get('/recruitment/push-public-key', (req, res) => {
    res.json({ ok: true, publicKey: PUSH_CONFIGURED ? VAPID_PUBLIC_KEY : null });
});

app.post('/recruitment/push-subscribe', async (req, res) => {
    const recruitSession = await getRecruitSession(req);
    if (!recruitSession) { res.status(401).json({ ok: false, error: 'session_expired' }); return; }
    const sub = req.body && req.body.subscription;
    if (!sub || !sub.endpoint || !sub.keys) { res.status(400).json({ ok: false, error: 'invalid_subscription' }); return; }
    const { error } = await supabase.from('recruit_push_subscriptions').upsert({
        roblox_user_id: recruitSession.roblox_user_id,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth
    }, { onConflict: 'endpoint' });
    if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
    res.json({ ok: true });
});

app.post('/recruitment/push-unsubscribe', async (req, res) => {
    const recruitSession = await getRecruitSession(req);
    if (!recruitSession) { res.status(401).json({ ok: false, error: 'session_expired' }); return; }
    const endpoint = req.body && req.body.endpoint;
    if (endpoint) await supabase.from('recruit_push_subscriptions').delete().eq('endpoint', endpoint);
    res.json({ ok: true });
});

app.get('/recruitment/recruiters', async (req, res) => {
    try {
        const recruiters = await listRecruiters();
        res.json({ ok: true, data: recruiters });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.get('/recruitment/positions', async (req, res) => {
    const { data, error } = await supabase.from('recruitment_positions').select('id, name').order('name', { ascending: true });
    if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
    res.json({ ok: true, data: data || [] });
});

app.get('/onboarding-link-preview', async (req, res) => {
    const token = req.query.token ? String(req.query.token).trim() : '';
    if (!token) { res.status(400).json({ ok: false, error: 'missing_token' }); return; }
    const { data: link, error } = await supabase.from('onboarding_links').select('*').eq('token', token).maybeSingle();
    if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
    if (!link) { res.status(404).json({ ok: false, error: 'link_not_found' }); return; }
    let team = null, skillset = null;
    if (link.team_id) { const { data } = await supabase.from('teams').select('name, color, info').eq('id', link.team_id).maybeSingle(); team = data || null; }
    if (link.skillset_id) { const { data } = await supabase.from('skillsets').select('name, color, description').eq('id', link.skillset_id).maybeSingle(); skillset = data || null; }
    res.json({ ok: true, data: { team, skillset, label: link.label } });
});

app.get('/hr-session', async (req, res) => {
    const session = await getSession(req);
    if (!session) { res.status(401).json({ ok: false }); return; }

    const discordUserId = await getLinkedDiscordUserId(session.roblox_user_id);

    res.json({
        ok: true,
        robloxUserId: session.roblox_user_id,
        robloxUsername: session.roblox_username,
        roles: session.roles || [],
        permissions: session.permissions || [],
        maxHierarchy: session.max_hierarchy || 0,
        discordLinked: !!discordUserId
    });
});

app.delete('/hr-session', async (req, res) => {
    const token = getBearerToken(req);
    if (token) await supabase.from('hr_sessions').delete().eq('token', token);
    res.json({ ok: true });
});

app.post('/hr-data', async (req, res) => {
    const session = await getSession(req);
    if (!session) { res.status(401).json({ ok: false, error: 'not_authenticated' }); return; }

    const action = req.body && req.body.action;
    const payload = (req.body && req.body.payload) || {};

    if (action === 'submit_request') {
        if (!requirePermission(res, session, 'dashboard.submit_request')) return;

        const robloxUsername = payload.robloxUsername && String(payload.robloxUsername).trim();
        const taskName = payload.taskName && String(payload.taskName).trim();
        const game = payload.game && String(payload.game).trim();
        const workRaw = payload.workRaw != null ? String(payload.workRaw) : '';
        const timeWorked = payload.timeWorked != null ? String(payload.timeWorked).trim() : '';
        const payment = Number(payload.payment);
        const currency = payload.currency === 'USD' ? 'USD' : 'ROBUX';
        const skillsetIds = Array.isArray(payload.skillsetIds)
            ? [...new Set(payload.skillsetIds.map(Number).filter(n => n > 0))]
            : [];

        if (!robloxUsername || !taskName || !game || !(payment > 0)) {
            res.status(400).json({ ok: false, error: 'invalid_fields' });
            return;
        }

        let recipientUserId = null;
        try {
            recipientUserId = await resolveRobloxUserId(robloxUsername);
        } catch (e) { }

        if (!recipientUserId) {
            res.status(400).json({ ok: false, error: 'That Roblox username could not be found.' });
            return;
        }

        let skillsetNames = [];
        if (skillsetIds.length) {
            const { data: skillsetRows } = await supabase.from('skillsets').select('id, name').in('id', skillsetIds);
            const nameById = {};
            (skillsetRows || []).forEach(s => { nameById[s.id] = s.name; });
            skillsetNames = skillsetIds.map(id => nameById[id]).filter(Boolean);
        }

        const id = generateRequestId();

        const { error } = await supabase.from('payment_requests').insert({
            id,
            requested_by: session.roblox_username,
            requested_by_user_id: session.roblox_user_id,
            roblox_username: robloxUsername,
            roblox_user_id: recipientUserId,
            task_name: taskName,
            game,
            work_raw: workRaw,
            time_worked: timeWorked,
            payment,
            currency,
            skillset_ids: skillsetIds.length ? skillsetIds : null,
            skillset_names: skillsetNames.length ? skillsetNames : null,
            skillset_id: skillsetIds[0] || null,
            skillset_name: skillsetNames[0] || null,
            paid: false,
            paid_at: null,
            created_at: new Date().toISOString()
        });

        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        logAudit(session, {
            category: 'payments', action: 'submit_request',
            targetUserId: recipientUserId, targetUsername: robloxUsername,
            details: { id, taskName, game, payment, currency, skillsetNames },
            revert: { type: 'delete_payment_request', id }
        });
        runPaymentMethodConversionSweep({ robloxUserId: recipientUserId });
        res.json({ ok: true, id });
        return;
    }

    if (action === 'list_requests') {
        if (!requirePermission(res, session, 'dashboard.view')) return;
        await enforceUsdMinimumThreshold();
        await runPaymentMethodConversionSweep();
        await refreshPaymentRequestUsernames();
        const { data, error } = await supabase
            .from('payment_requests')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }

        const rows = data || [];
        const userIds = [...new Set(rows.filter(r => r.roblox_user_id != null).map(r => r.roblox_user_id))];
        const usernames = [...new Set(rows.filter(r => r.roblox_user_id == null && r.roblox_username).map(r => r.roblox_username))];

        const [byIdRes, byUsernameRes, sessionRolesRes, assignmentsRes] = await Promise.all([
            userIds.length ? supabase.from('payment_methods').select('*').in('roblox_user_id', userIds) : Promise.resolve({ data: [] }),
            usernames.length ? supabase.from('payment_methods').select('*').in('roblox_username', usernames) : Promise.resolve({ data: [] }),
            userIds.length ? supabase.from('hr_sessions').select('roblox_user_id, roles').in('roblox_user_id', userIds) : Promise.resolve({ data: [] }),
            userIds.length ? supabase.from('user_assignments').select('roblox_user_id, team_id, skillset_id').in('roblox_user_id', userIds) : Promise.resolve({ data: [] })
        ]);
        const methodRows = [].concat(byIdRes.data || [], byUsernameRes.data || []);

        const methodByUserId = {};
        const methodByUsername = {};
        methodRows.forEach(m => {
            methodByUserId[m.roblox_user_id] = m;
            if (m.roblox_username) methodByUsername[m.roblox_username.toLowerCase()] = m;
        });

        let rolesByUserId = {};
        let assignsByUserId = {};
        let teamNameById = {};
        let skillsetNameById = {};
        if (userIds.length) {
            (sessionRolesRes.data || []).forEach(s => { rolesByUserId[s.roblox_user_id] = s.roles || []; });
            (assignmentsRes.data || []).forEach(a => {
                if (!assignsByUserId[a.roblox_user_id]) assignsByUserId[a.roblox_user_id] = [];
                assignsByUserId[a.roblox_user_id].push(a);
            });

            const teamIds = [...new Set((assignmentsRes.data || []).filter(a => a.team_id != null).map(a => a.team_id))];
            const skillsetIds = [...new Set((assignmentsRes.data || []).filter(a => a.skillset_id != null).map(a => a.skillset_id))];
            const [teamsRes, skillsetsRes] = await Promise.all([
                teamIds.length ? supabase.from('teams').select('id,name').in('id', teamIds) : Promise.resolve({ data: [] }),
                skillsetIds.length ? supabase.from('skillsets').select('id,name').in('id', skillsetIds) : Promise.resolve({ data: [] })
            ]);
            (teamsRes.data || []).forEach(t => { teamNameById[t.id] = t.name; });
            (skillsetsRes.data || []).forEach(s => { skillsetNameById[s.id] = s.name; });
        }

        rows.forEach(r => {
            const m = (r.roblox_user_id != null ? methodByUserId[r.roblox_user_id] : null)
                || (r.roblox_username ? methodByUsername[r.roblox_username.toLowerCase()] : null)
                || null;
            r.payment_method = m ? { method: m.method, details: m.details || {} } : null;

            r.requester_roles = r.roblox_user_id != null ? (rolesByUserId[r.roblox_user_id] || []) : [];
            const assigns = r.roblox_user_id != null ? (assignsByUserId[r.roblox_user_id] || []) : [];
            const teamNames = [...new Set(assigns.filter(a => a.team_id != null).map(a => teamNameById[a.team_id]).filter(Boolean))];
            const skillsetNames = [...new Set(assigns.filter(a => a.skillset_id != null).map(a => skillsetNameById[a.skillset_id]).filter(Boolean))];
            r.requester_team = teamNames.length ? teamNames.join(', ') : null;
            r.requester_skillset = skillsetNames.length ? skillsetNames.join(', ') : null;
        });

        res.json({ ok: true, data: rows });
        return;
    }

    if (action === 'mark_paid') {
        if (!requirePermission(res, session, 'dashboard.mark_paid')) return;
        const id = payload.id;
        if (!id) { res.status(400).json({ ok: false, error: 'missing_id' }); return; }
        const { data: existing } = await supabase.from('payment_requests').select('roblox_user_id, roblox_username').eq('id', id).maybeSingle();
        const { error } = await supabase
            .from('payment_requests')
            .update({ paid: true, paid_at: new Date().toISOString(), status: 'paid', status_note: null })
            .eq('id', id);
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        logAudit(session, {
            category: 'payments', action: 'mark_paid',
            targetUserId: existing ? existing.roblox_user_id : null, targetUsername: existing ? existing.roblox_username : null,
            details: { id },
            revert: { type: 'unmark_paid', id }
        });
        res.json({ ok: true });
        return;
    }

    if (action === 'mark_all_paid') {
        if (!requirePermission(res, session, 'dashboard.mark_paid')) return;
        const robloxUserId = payload.robloxUserId != null && payload.robloxUserId !== '' ? Number(payload.robloxUserId) : null;
        const robloxUsername = payload.robloxUsername ? String(payload.robloxUsername).trim() : '';
        if (robloxUserId == null && !robloxUsername) { res.status(400).json({ ok: false, error: 'missing_user' }); return; }

        let query = supabase.from('payment_requests').select('id').eq('status', 'pending');
        query = robloxUserId != null
            ? query.eq('roblox_user_id', robloxUserId)
            : query.is('roblox_user_id', null).ilike('roblox_username', robloxUsername);

        const { data: rows, error } = await query;
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        const ids = (rows || []).map(r => r.id);
        if (!ids.length) { res.json({ ok: true, count: 0 }); return; }

        const { error: updateError } = await supabase
            .from('payment_requests')
            .update({ paid: true, paid_at: new Date().toISOString(), status: 'paid', status_note: null })
            .in('id', ids);
        if (updateError) { res.status(500).json({ ok: false, error: updateError.message }); return; }
        logAudit(session, {
            category: 'payments', action: 'mark_all_paid',
            targetUserId: robloxUserId, targetUsername: robloxUsername || null,
            details: { count: ids.length, ids },
            revert: { type: 'unmark_paid_bulk', ids }
        });
        res.json({ ok: true, count: ids.length });
        return;
    }

    if (action === 'reject_request') {
        if (!requirePermission(res, session, 'dashboard.mark_paid')) return;
        const id = payload.id;
        const note = payload.note ? String(payload.note).trim() : '';
        if (!id) { res.status(400).json({ ok: false, error: 'missing_id' }); return; }
        const { data: existing } = await supabase.from('payment_requests').select('roblox_user_id, roblox_username').eq('id', id).maybeSingle();
        const { error } = await supabase
            .from('payment_requests')
            .update({ paid: false, paid_at: null, status: 'rejected', status_note: note || null })
            .eq('id', id);
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        logAudit(session, {
            category: 'payments', action: 'reject_request',
            targetUserId: existing ? existing.roblox_user_id : null, targetUsername: existing ? existing.roblox_username : null,
            details: { id, note },
            revert: { type: 'reopen_request', id }
        });
        res.json({ ok: true });
        return;
    }

    if (action === 'reopen_request') {
        if (!requirePermission(res, session, 'dashboard.mark_paid')) return;
        const id = payload.id;
        if (!id) { res.status(400).json({ ok: false, error: 'missing_id' }); return; }
        const { data: existing } = await supabase.from('payment_requests').select('roblox_user_id, roblox_username').eq('id', id).maybeSingle();
        const { error } = await supabase
            .from('payment_requests')
            .update({ paid: false, paid_at: null, status: 'pending', status_note: null })
            .eq('id', id);
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        logAudit(session, {
            category: 'payments', action: 'reopen_request',
            targetUserId: existing ? existing.roblox_user_id : null, targetUsername: existing ? existing.roblox_username : null,
            details: { id }
        });
        res.json({ ok: true });
        return;
    }

    if (action === 'delete_request') {
        if (!requirePermission(res, session, 'dashboard.mark_paid')) return;
        const id = payload.id;
        if (!id) { res.status(400).json({ ok: false, error: 'missing_id' }); return; }
        const { data: existing } = await supabase.from('payment_requests').select('*').eq('id', id).maybeSingle();
        const { error } = await supabase.from('payment_requests').delete().eq('id', id);
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        logAudit(session, {
            category: 'payments', action: 'delete_request',
            targetUserId: existing ? existing.roblox_user_id : null, targetUsername: existing ? existing.roblox_username : null,
            details: { id },
            revert: existing ? { type: 'restore_payment_request', row: existing } : null
        });
        res.json({ ok: true });
        return;
    }

    if (action === 'get_my_summary') {
        await convertPendingForUser(session.roblox_user_id, session.roblox_username);

        const [byId, byUsername] = await Promise.all([
            supabase.from('payment_requests').select('*').eq('roblox_user_id', session.roblox_user_id),
            supabase.from('payment_requests').select('*').is('roblox_user_id', null).ilike('roblox_username', session.roblox_username)
        ]);

        if (byId.error) { res.status(500).json({ ok: false, error: byId.error.message }); return; }
        if (byUsername.error) { res.status(500).json({ ok: false, error: byUsername.error.message }); return; }

        const data = [...(byId.data || []), ...(byUsername.data || [])]
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        const totals = {};
        data.forEach(row => {
            const cur = row.currency || 'ROBUX';
            if (!totals[cur]) totals[cur] = { pending: 0, paid: 0 };
            if (row.paid) totals[cur].paid += Number(row.payment) || 0;
            else if ((row.status || 'pending') === 'pending') totals[cur].pending += Number(row.payment) || 0;
        });

        res.json({ ok: true, data, totals });
        return;
    }

    if (action === 'get_payment_method') {
        const { data, error } = await supabase
            .from('payment_methods')
            .select('*')
            .eq('roblox_user_id', session.roblox_user_id)
            .maybeSingle();
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true, data: data ? { method: data.method, details: data.details || {} } : null });
        return;
    }

    if (action === 'get_payment_method_for_user') {
        if (!hasPermission(session, 'dashboard.submit_request') && !hasPermission(session, 'staff.view_database') && !hasPermission(session, 'staff.moderate')) {
            res.status(403).json({ ok: false, error: 'missing_permission' });
            return;
        }
        const robloxUsername = payload.robloxUsername && String(payload.robloxUsername).trim();
        if (!robloxUsername) { res.status(400).json({ ok: false, error: 'missing_username' }); return; }
        const { data, error } = await supabase
            .from('payment_methods')
            .select('*')
            .ilike('roblox_username', robloxUsername)
            .maybeSingle();
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true, data: data ? { method: data.method, details: data.details || {} } : null });
        return;
    }

    if (action === 'admin_set_payment_method') {
        if (!requirePermission(res, session, 'staff.moderate')) return;
        const robloxUserId = Number(payload.robloxUserId);
        if (!robloxUserId) { res.status(400).json({ ok: false, error: 'missing_user_id' }); return; }

        const method = payload.method;
        const details = payload.details && typeof payload.details === 'object' ? payload.details : {};
        const methodDef = PAYMENT_METHOD_TYPES[method];
        if (!methodDef) { res.status(400).json({ ok: false, error: 'invalid_method' }); return; }
        const missing = methodDef.fields.find(f => !String(details[f] || '').trim());
        if (missing) { res.status(400).json({ ok: false, error: 'missing_field' }); return; }

        if (method === 'PAYPAL' || method === 'VENMO') {
            const threshold = await getUsdMinimumPending();
            if (threshold > 0) {
                const pendingUsdEquivalent = await getPendingUsdEquivalent(robloxUserId, null);
                if (pendingUsdEquivalent < threshold) {
                    res.status(400).json({ ok: false, error: `This person needs $${(threshold - pendingUsdEquivalent).toFixed(2)} more in pending requests before ${method === 'PAYPAL' ? 'PayPal' : 'Venmo'} can be selected.` });
                    return;
                }
            }
        }

        const cleanDetails = {};
        methodDef.fields.forEach(f => { cleanDetails[f] = String(details[f]).trim(); });

        let username = payload.robloxUsername ? String(payload.robloxUsername).trim() : null;
        if (!username) {
            const lookupRes = await fetch(`https://users.roblox.com/v1/users/${robloxUserId}`);
            if (lookupRes.ok) username = (await lookupRes.json()).name;
        }

        const { error } = await supabase.from('payment_methods').upsert({
            roblox_user_id: robloxUserId,
            roblox_username: username,
            method,
            details: cleanDetails,
            updated_at: new Date().toISOString(),
            set_by: session.roblox_username
        }, { onConflict: 'roblox_user_id' });
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        await convertPendingForUser(robloxUserId, username);
        res.json({ ok: true });
        return;
    }

    if (action === 'save_payment_method') {
        const method = payload.method;
        const details = payload.details && typeof payload.details === 'object' ? payload.details : {};
        const methodDef = PAYMENT_METHOD_TYPES[method];
        if (!methodDef) { res.status(400).json({ ok: false, error: 'invalid_method' }); return; }
        const missing = methodDef.fields.find(f => !String(details[f] || '').trim());
        if (missing) { res.status(400).json({ ok: false, error: 'missing_field' }); return; }

        if (method === 'PAYPAL' || method === 'VENMO') {
            const threshold = await getUsdMinimumPending();
            if (threshold > 0) {
                const pendingUsdEquivalent = await getPendingUsdEquivalent(session.roblox_user_id, session.roblox_username);
                if (pendingUsdEquivalent < threshold) {
                    res.status(400).json({ ok: false, error: `You need $${(threshold - pendingUsdEquivalent).toFixed(2)} more in pending requests before you can select ${method === 'PAYPAL' ? 'PayPal' : 'Venmo'}.` });
                    return;
                }
            }
        }

        const cleanDetails = {};
        methodDef.fields.forEach(f => { cleanDetails[f] = String(details[f]).trim(); });

        const { error } = await supabase.from('payment_methods').upsert({
            roblox_user_id: session.roblox_user_id,
            roblox_username: session.roblox_username,
            method,
            details: cleanDetails,
            updated_at: new Date().toISOString()
        }, { onConflict: 'roblox_user_id' });
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        await convertPendingForUser(session.roblox_user_id, session.roblox_username);
        res.json({ ok: true });
        return;
    }

    if (action === 'get_usd_eligibility') {
        const threshold = await getUsdMinimumPending();
        const pendingUsdEquivalent = await getPendingUsdEquivalent(session.roblox_user_id, session.roblox_username);
        res.json({
            ok: true,
            data: {
                threshold,
                pendingUsdEquivalent,
                eligible: threshold <= 0 || pendingUsdEquivalent >= threshold,
                amountNeeded: threshold > 0 ? Math.max(0, threshold - pendingUsdEquivalent) : 0
            }
        });
        return;
    }

    if (action === 'get_usd_eligibility_for_user') {
        if (!requirePermission(res, session, 'staff.moderate')) return;
        const robloxUserId = payload.robloxUserId != null ? Number(payload.robloxUserId) : null;
        const robloxUsername = payload.robloxUsername ? String(payload.robloxUsername).trim() : null;
        const threshold = await getUsdMinimumPending();
        const pendingUsdEquivalent = await getPendingUsdEquivalent(robloxUserId, robloxUsername);
        res.json({
            ok: true,
            data: {
                threshold,
                pendingUsdEquivalent,
                eligible: threshold <= 0 || pendingUsdEquivalent >= threshold,
                amountNeeded: threshold > 0 ? Math.max(0, threshold - pendingUsdEquivalent) : 0
            }
        });
        return;
    }

    if (action === 'get_usd_minimum') {
        if (!requirePermission(res, session, 'settings.manage_rate')) return;
        const threshold = await getUsdMinimumPending();
        res.json({ ok: true, data: { threshold } });
        return;
    }

    if (action === 'save_usd_minimum') {
        if (!requirePermission(res, session, 'settings.manage_rate')) return;
        const threshold = Number(payload.threshold);
        if (!(threshold >= 0)) { res.status(400).json({ ok: false, error: 'invalid_threshold' }); return; }
        const { error } = await supabase
            .from('app_settings')
            .upsert({ id: 1, usd_minimum_pending: threshold, updated_at: new Date().toISOString() });
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true });
        return;
    }

    if (action === 'list_required_groups') {
        const { data, error } = await supabase
            .from('required_groups')
            .select('*')
            .order('name', { ascending: true });
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true, data });
        return;
    }

    if (action === 'add_required_group') {
        if (!requirePermission(res, session, 'settings.manage_groups')) return;
        const robloxGroupId = Number(payload.robloxGroupId);
        const name = payload.name && String(payload.name).trim();
        if (!robloxGroupId || !name) { res.status(400).json({ ok: false, error: 'invalid_fields' }); return; }
        const { error } = await supabase.from('required_groups').insert({
            roblox_group_id: robloxGroupId,
            name
        });
        if (error?.code === '23505') {
            return res.status(400).json({ ok: false, error: 'That group is already configured.' });
        }
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true });
        return;
    }

    if (action === 'delete_required_group') {
        if (!requirePermission(res, session, 'settings.manage_groups')) return;
        const id = payload.id;
        if (!id) { res.status(400).json({ ok: false, error: 'missing_id' }); return; }
        const { error } = await supabase.from('required_groups').delete().eq('id', id);
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true });
        return;
    }

    if (action === 'get_my_eligibility') {
        try {
            const data = await computeGroupEligibility(session.roblox_user_id);
            res.json({ ok: true, data });
        } catch (e) {
            res.status(500).json({ ok: false, error: 'eligibility_check_failed' });
        }
        return;
    }

    if (action === 'get_user_eligibility') {
        if (!requirePermission(res, session, 'dashboard.submit_request')) return;
        const robloxUsername = payload.robloxUsername && String(payload.robloxUsername).trim();
        if (!robloxUsername) { res.status(400).json({ ok: false, error: 'missing_username' }); return; }
        try {
            const userId = await resolveRobloxUserId(robloxUsername);
            if (!userId) { res.status(404).json({ ok: false, error: 'roblox_user_not_found' }); return; }
            let data = await computeGroupEligibility(userId);

            const ignoreEligibility = await getIgnoreEligibilityConfig();
            if (ignoreEligibility) {
                data = data.map(entry => ({ ...entry, eligible: true, overridden: true }));
            }

            res.json({ ok: true, data, ignoreEligibility });
        } catch (e) {
            res.status(500).json({ ok: false, error: 'eligibility_check_failed' });
        }
        return;
    }

    if (action === 'add_game') {
        if (!requirePermission(res, session, 'settings.manage_games')) return;
        const name = payload.name && String(payload.name).trim();
        if (!name) { res.status(400).json({ ok: false, error: 'missing_name' }); return; }
        const { error } = await supabase.from('games').insert({ name });
        if (error?.code === '23505') {
            return res.status(400).json({ ok: false, error: 'A game with that name already exists.' });
        }
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true });
        return;
    }

    if (action === 'delete_game') {
        if (!requirePermission(res, session, 'settings.manage_games')) return;
        const id = payload.id;
        if (!id) { res.status(400).json({ ok: false, error: 'missing_id' }); return; }
        const { error } = await supabase.from('games').delete().eq('id', id);
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true });
        return;
    }

    if (action === 'save_rate') {
        if (!requirePermission(res, session, 'settings.manage_rate')) return;
        const rate = Number(payload.rate);
        if (!(rate >= 0)) { res.status(400).json({ ok: false, error: 'invalid_rate' }); return; }
        const { error } = await supabase
            .from('app_settings')
            .upsert({ id: 1, devex_rate: rate, updated_at: new Date().toISOString() });
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true });
        return;
    }

    if (action === 'list_base_access_groups') {
        try {
            const data = await getBaseAccessGroups();
            res.json({ ok: true, data });
        } catch (e) {
            res.status(500).json({ ok: false, error: 'Could not load the sign-in group requirements.' });
        }
        return;
    }

    if (action === 'add_base_access_group') {
        if (!requirePermission(res, session, 'settings.manage_base_access')) return;
        const robloxGroupId = Number(payload.robloxGroupId);
        const minRank = payload.minRank === '' || payload.minRank == null ? null : Number(payload.minRank);
        const name = payload.name ? String(payload.name).trim() : null;
        if (!robloxGroupId || !(robloxGroupId > 0)) { res.status(400).json({ ok: false, error: 'invalid_group_id' }); return; }
        const { error } = await supabase.from('base_access_groups').insert({
            roblox_group_id: robloxGroupId,
            min_rank: minRank,
            name
        });
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true });
        return;
    }

    if (action === 'delete_base_access_group') {
        if (!requirePermission(res, session, 'settings.manage_base_access')) return;
        const id = payload.id;
        if (!id) { res.status(400).json({ ok: false, error: 'missing_id' }); return; }
        const { error } = await supabase.from('base_access_groups').delete().eq('id', id);
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true });
        return;
    }

    if (action === 'list_base_access_discord_servers') {
        try {
            const data = await getBaseAccessDiscordServers();
            res.json({ ok: true, data });
        } catch (e) {
            res.status(500).json({ ok: false, error: 'Could not load the sign-in Discord server requirements.' });
        }
        return;
    }

    if (action === 'add_base_access_discord_server') {
        if (!requirePermission(res, session, 'settings.manage_base_access')) return;
        const discordGuildId = payload.discordGuildId ? String(payload.discordGuildId).trim() : '';
        const name = payload.name ? String(payload.name).trim() : null;
        if (!discordGuildId) { res.status(400).json({ ok: false, error: 'invalid_guild_id' }); return; }
        const { error } = await supabase.from('base_access_discord_servers').insert({
            discord_guild_id: discordGuildId,
            name
        });
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true });
        return;
    }

    if (action === 'delete_base_access_discord_server') {
        if (!requirePermission(res, session, 'settings.manage_base_access')) return;
        const id = payload.id;
        if (!id) { res.status(400).json({ ok: false, error: 'missing_id' }); return; }
        const { error } = await supabase.from('base_access_discord_servers').delete().eq('id', id);
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true });
        return;
    }

    if (action === 'recruitment_get_config') {
        if (!requirePermission(res, session, 'settings.manage_onboarding')) return;
        try {
            const data = await getRecruitmentConfig();
            res.json({ ok: true, data });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
        return;
    }

    if (action === 'recruitment_save_config') {
        if (!requirePermission(res, session, 'settings.manage_onboarding')) return;
        const autoRoleId = payload.autoRoleId != null && payload.autoRoleId !== '' ? String(payload.autoRoleId) : null;
        const discordRoleId = payload.discordRoleId ? String(payload.discordRoleId).trim() : null;
        const gracePeriodHours = payload.gracePeriodHours != null && payload.gracePeriodHours !== '' ? Number(payload.gracePeriodHours) : null;
        const notifyRoleId = payload.notifyRoleId != null && payload.notifyRoleId !== '' ? String(payload.notifyRoleId) : null;
        if (gracePeriodHours != null && !(gracePeriodHours >= 0)) { res.status(400).json({ ok: false, error: 'invalid_grace_period' }); return; }
        const { error } = await supabase
            .from('app_settings')
            .upsert({
                id: 1,
                recruitment_auto_role_id: autoRoleId,
                recruitment_discord_role_id: discordRoleId,
                recruitment_grace_period_hours: gracePeriodHours,
                recruitment_notify_role_id: notifyRoleId,
                updated_at: new Date().toISOString()
            });
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        logAudit(session, {
            category: 'settings', action: 'update_recruitment_config',
            details: { autoRoleId, discordRoleId, gracePeriodHours, notifyRoleId }
        });
        res.json({ ok: true });
        return;
    }

    if (action === 'recruitment_get_approval_config') {
        if (!requirePermission(res, session, 'settings.manage_onboarding')) return;
        try {
            const data = await getRecruitmentApprovalConfig();
            res.json({ ok: true, data });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
        return;
    }

    // Lightweight version of the above for anyone who can see recruitment tickets, not just
    // settings.manage_onboarding holders - just the role names (not the full role records), so the
    // dashboard can grey out Sign off / Finalise for people who aren't eligible and say why.
    if (action === 'recruitment_get_approval_role_names') {
        if (!requirePermission(res, session, 'recruitment.view')) return;
        try {
            const config = await getRecruitmentApprovalConfig();
            const [signoffRole, producerRole] = await Promise.all([
                config.signoffRoleId ? supabase.from('roles').select('name').eq('id', config.signoffRoleId).maybeSingle() : Promise.resolve({ data: null }),
                config.producerRoleId ? supabase.from('roles').select('name').eq('id', config.producerRoleId).maybeSingle() : Promise.resolve({ data: null })
            ]);
            res.json({
                ok: true,
                data: {
                    signoffRoleName: signoffRole.data ? signoffRole.data.name : null,
                    producerRoleName: producerRole.data ? producerRole.data.name : null
                }
            });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
        return;
    }

    if (action === 'get_onboarding_group_config') {
        if (!requirePermission(res, session, 'settings.manage_onboarding')) return;
        try {
            const data = await getOnboardingGroupConfig();
            res.json({ ok: true, data });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
        return;
    }

    if (action === 'save_onboarding_group_config') {
        if (!requirePermission(res, session, 'settings.manage_onboarding')) return;
        const groupId = payload.groupId != null && payload.groupId !== '' ? Number(payload.groupId) : null;
        const groupRoleId = payload.groupRoleId != null && payload.groupRoleId !== '' ? Number(payload.groupRoleId) : null;
        const { error } = await supabase
            .from('app_settings')
            .upsert({ id: 1, onboarding_group_id: groupId, onboarding_group_role_id: groupRoleId, updated_at: new Date().toISOString() });
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        logAudit(session, {
            category: 'settings', action: 'update_onboarding_group_config',
            details: { groupId, groupRoleId }
        });
        res.json({ ok: true });
        return;
    }

    // Deliberately read-only: only exposes whether ROBLOX_GROUP_API_KEY is set, never its value,
    // and there is no corresponding "save" action anywhere - the key can only ever be set as a
    // server environment variable, never typed into or stored via the web UI.
    if (action === 'get_roblox_group_api_key_status') {
        if (!requirePermission(res, session, 'settings.manage_onboarding')) return;
        res.json({ ok: true, data: { configured: !!ROBLOX_GROUP_API_KEY } });
        return;
    }

    if (action === 'recruitment_save_approval_config') {
        if (!requirePermission(res, session, 'settings.manage_onboarding')) return;
        const signoffRoleId = payload.signoffRoleId != null && payload.signoffRoleId !== '' ? String(payload.signoffRoleId) : null;
        const producerRoleId = payload.producerRoleId != null && payload.producerRoleId !== '' ? String(payload.producerRoleId) : null;
        const { error } = await supabase
            .from('app_settings')
            .upsert({
                id: 1,
                recruitment_signoff_role_id: signoffRoleId,
                recruitment_producer_role_id: producerRoleId,
                updated_at: new Date().toISOString()
            });
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        logAudit(session, {
            category: 'settings', action: 'update_recruitment_approval_config',
            details: { signoffRoleId, producerRoleId }
        });
        res.json({ ok: true });
        return;
    }

    if (action === 'get_ignore_eligibility') {
        try {
            const ignoreEligibility = await getIgnoreEligibilityConfig();
            res.json({ ok: true, data: { ignoreEligibility } });
        } catch (e) {
            res.status(500).json({ ok: false, error: 'Could not load the eligibility override setting.' });
        }
        return;
    }

    if (action === 'save_ignore_eligibility') {
        if (!requirePermission(res, session, 'settings.manage_groups')) return;
        const ignoreEligibility = !!payload.ignoreEligibility;
        const { error } = await supabase
            .from('app_settings')
            .upsert({ id: 1, ignore_eligibility: ignoreEligibility, updated_at: new Date().toISOString() });
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true });
        return;
    }

    if (action === 'list_permissions') {
        if (!requirePermission(res, session, 'roles.manage')) return;
        res.json({ ok: true, data: PERMISSIONS });
        return;
    }

    if (action === 'list_roles') {
        if (!requirePermission(res, session, 'roles.manage')) return;
        const { data, error } = await supabase.from('roles').select('*').order('name', { ascending: true });
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true, data });
        return;
    }

    if (action === 'add_role') {
        if (!requirePermission(res, session, 'roles.manage')) return;
        const name = payload.name && String(payload.name).trim();
        if (!name) { res.status(400).json({ ok: false, error: 'missing_name' }); return; }
        const robloxGroupId = payload.robloxGroupId === '' || payload.robloxGroupId == null ? null : Number(payload.robloxGroupId);
        const minRank = payload.minRank === '' || payload.minRank == null ? null : Number(payload.minRank);
        const hierarchy = payload.hierarchy === '' || payload.hierarchy == null ? 0 : Number(payload.hierarchy);
        const linkOnly = !!payload.linkOnly;
        const permissions = Array.isArray(payload.permissions) ? payload.permissions.filter(p => PERMISSIONS.includes(p)) : [];
        if (!requireHigherHierarchy(res, session, hierarchy)) return;
        const { error } = await supabase.from('roles').insert({
            name,
            roblox_group_id: robloxGroupId,
            min_rank: minRank,
            link_only: linkOnly,
            hierarchy,
            permissions
        });
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true });
        return;
    }

    if (action === 'update_role') {
        if (!requirePermission(res, session, 'roles.manage')) return;
        const id = payload.id;
        if (!id) { res.status(400).json({ ok: false, error: 'missing_id' }); return; }
        const { data: existingRole, error: existingErr } = await supabase.from('roles').select('hierarchy').eq('id', id).maybeSingle();
        if (existingErr) { res.status(500).json({ ok: false, error: existingErr.message }); return; }
        if (!existingRole) { res.status(404).json({ ok: false, error: 'role_not_found' }); return; }
        if (!requireHigherHierarchy(res, session, existingRole.hierarchy)) return;
        const name = payload.name != null ? String(payload.name).trim() : null;
        if (payload.name != null && !name) { res.status(400).json({ ok: false, error: 'missing_name' }); return; }
        const robloxGroupId = payload.robloxGroupId === '' || payload.robloxGroupId == null ? null : Number(payload.robloxGroupId);
        const minRank = payload.minRank === '' || payload.minRank == null ? null : Number(payload.minRank);
        const hierarchy = payload.hierarchy === '' || payload.hierarchy == null ? 0 : Number(payload.hierarchy);
        const linkOnly = !!payload.linkOnly;
        if (!requireHigherHierarchy(res, session, hierarchy)) return;
        const permissions = Array.isArray(payload.permissions) ? payload.permissions.filter(p => PERMISSIONS.includes(p)) : [];
        const update = {
            roblox_group_id: robloxGroupId,
            min_rank: minRank,
            link_only: linkOnly,
            hierarchy,
            permissions
        };
        if (name) update.name = name;
        const { error } = await supabase.from('roles').update(update).eq('id', id);
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true });
        return;
    }

    if (action === 'delete_role') {
        if (!requirePermission(res, session, 'roles.manage')) return;
        const id = payload.id;
        if (!id) { res.status(400).json({ ok: false, error: 'missing_id' }); return; }
        const { data: existingRole, error: existingErr } = await supabase.from('roles').select('hierarchy').eq('id', id).maybeSingle();
        if (existingErr) { res.status(500).json({ ok: false, error: existingErr.message }); return; }
        if (!existingRole) { res.status(404).json({ ok: false, error: 'role_not_found' }); return; }
        if (!requireHigherHierarchy(res, session, existingRole.hierarchy)) return;
        const { error } = await supabase.from('roles').delete().eq('id', id);
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true });
        return;
    }

    if (action === 'list_role_assignments') {
        if (!requirePermission(res, session, 'roles.manage')) return;
        const { data, error } = await supabase
            .from('user_role_assignments')
            .select('id, roblox_user_id, role_id, roblox_username, roles(name, hierarchy)')
            .order('created_at', { ascending: false });
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true, data });
        return;
    }

    if (action === 'add_role_assignment') {
        if (!requirePermission(res, session, 'roles.manage')) return;
        const roleId = payload.roleId;
        const robloxUserId = Number(payload.robloxUserId);
        if (!roleId || !robloxUserId) { res.status(400).json({ ok: false, error: 'missing_fields' }); return; }

        const { data: role, error: roleErr } = await supabase.from('roles').select('hierarchy').eq('id', roleId).maybeSingle();
        if (roleErr) { res.status(500).json({ ok: false, error: roleErr.message }); return; }
        if (!role) { res.status(404).json({ ok: false, error: 'role_not_found' }); return; }
        if (!requireHigherHierarchy(res, session, role.hierarchy)) return;

        const lookupRes = await fetch(`https://users.roblox.com/v1/users/${robloxUserId}`);
        const robloxUsername = lookupRes.ok ? (await lookupRes.json()).name : null;

        const { error } = await supabase.from('user_role_assignments').insert({
            roblox_user_id: robloxUserId,
            role_id: roleId,
            roblox_username: robloxUsername
        });
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true });
        return;
    }

    if (action === 'delete_role_assignment') {
        if (!requirePermission(res, session, 'roles.manage')) return;
        const id = payload.id;
        if (!id) { res.status(400).json({ ok: false, error: 'missing_id' }); return; }
        const { data: assignment, error: assignErr } = await supabase
            .from('user_role_assignments')
            .select('id, roles(hierarchy)')
            .eq('id', id)
            .maybeSingle();
        if (assignErr) { res.status(500).json({ ok: false, error: assignErr.message }); return; }
        if (!assignment) { res.status(404).json({ ok: false, error: 'assignment_not_found' }); return; }
        if (!requireHigherHierarchy(res, session, assignment.roles && assignment.roles.hierarchy)) return;
        const { error } = await supabase.from('user_role_assignments').delete().eq('id', id);
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true });
        return;
    }

    if (action === 'refresh_access') {
        try {
            const access = await computeAccess(session.roblox_user_id);
            await supabase.from('hr_sessions').update({
                roles: access.roleNames,
                permissions: access.permissions,
                max_hierarchy: access.maxHierarchy,
                last_synced_at: new Date().toISOString()
            }).eq('token', getBearerToken(req));
            res.json({ ok: true, roles: access.roleNames, permissions: access.permissions, maxHierarchy: access.maxHierarchy });
        } catch (e) {
            res.status(500).json({ ok: false, error: 'refresh_failed' });
        }
        return;
    }

    if (action === 'list_onboarding_steps') {
        res.json({ ok: true, data: ONBOARDING_STEPS });
        return;
    }

    if (action === 'get_my_onboarding') {
        try {
            const { data: progress, error: progErr } = await supabase
                .from('staff_onboarding_progress')
                .select('step_id, completed_at')
                .eq('roblox_user_id', session.roblox_user_id);
            if (progErr) throw progErr;
            const completedByStep = {};
            (progress || []).forEach(p => { completedByStep[p.step_id] = p.completed_at; });

            const data = ONBOARDING_STEPS.map(s => ({
                ...s,
                completedAt: completedByStep[s.id] || null
            }));

            res.json({ ok: true, data });
        } catch (e) {
            res.status(500).json({ ok: false, error: 'Could not load your onboarding status.' });
        }
        return;
    }

    if (action === 'complete_onboarding_step') {
        const stepId = payload.stepId;
        if (!stepId || !ONBOARDING_STEP_IDS.has(stepId)) { res.status(400).json({ ok: false, error: 'missing_step_id' }); return; }
        try {
            const { error } = await supabase.from('staff_onboarding_progress').upsert({
                roblox_user_id: session.roblox_user_id,
                roblox_username: session.roblox_username,
                step_id: stepId,
                completed_at: new Date().toISOString()
            }, { onConflict: 'roblox_user_id,step_id' });
            if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ ok: false, error: 'Could not save that step. Try again.' });
        }
        return;
    }

    if (action === 'list_staff_database') {
        if (!requirePermission(res, session, 'staff.view_database')) return;
        try {
            const [sessionsRes, requestsRes, assignmentsRes, progressRes, teamAssignRes, warningsRes, bansRes, rolesRes] = await Promise.all([
                supabase.from('hr_sessions').select('roblox_user_id, roblox_username, roles, last_synced_at, expires_at'),
                supabase.from('payment_requests').select('roblox_user_id, roblox_username, payment, currency, paid, status'),
                supabase.from('user_role_assignments').select('roblox_user_id, roblox_username, roles(name)'),
                supabase.from('staff_onboarding_progress').select('roblox_user_id, step_id'),
                supabase.from('user_assignments').select('roblox_user_id, team_id, skillset_id'),
                supabase.from('staff_warnings').select('roblox_user_id'),
                supabase.from('banned_users').select('roblox_user_id'),
                supabase.from('roles').select('name, hierarchy')
            ]);
            if (sessionsRes.error) throw sessionsRes.error;
            if (requestsRes.error) throw requestsRes.error;
            if (assignmentsRes.error) throw assignmentsRes.error;
            if (progressRes.error) throw progressRes.error;
            if (teamAssignRes.error) throw teamAssignRes.error;

            const hierarchyByRoleName = {};
            (rolesRes.data || []).forEach(r => { hierarchyByRoleName[r.name] = Number(r.hierarchy) || 0; });

            const teamIds = [...new Set((teamAssignRes.data || []).filter(a => a.team_id != null).map(a => a.team_id))];
            const skillsetIds = [...new Set((teamAssignRes.data || []).filter(a => a.skillset_id != null).map(a => a.skillset_id))];
            const [teamsLookupRes, skillsetsLookupRes] = await Promise.all([
                teamIds.length ? supabase.from('teams').select('id,name').in('id', teamIds) : Promise.resolve({ data: [] }),
                skillsetIds.length ? supabase.from('skillsets').select('id,name').in('id', skillsetIds) : Promise.resolve({ data: [] })
            ]);
            const teamNameById = {}; (teamsLookupRes.data || []).forEach(t => { teamNameById[t.id] = t.name; });
            const skillsetNameById = {}; (skillsetsLookupRes.data || []).forEach(s => { skillsetNameById[s.id] = s.name; });
            const teamAssignsByUserId = {};
            (teamAssignRes.data || []).forEach(a => {
                if (!teamAssignsByUserId[a.roblox_user_id]) teamAssignsByUserId[a.roblox_user_id] = [];
                teamAssignsByUserId[a.roblox_user_id].push(a);
            });

            const totalRequiredSteps = ONBOARDING_STEPS.filter(s => s.required).length;
            const requiredStepIds = new Set(ONBOARDING_STEPS.filter(s => s.required).map(s => s.id));

            const byKey = new Map();
            function keyFor(userId, username) {
                if (userId != null) return `id:${userId}`;
                if (username) return `un:${String(username).toLowerCase()}`;
                return null;
            }
            function ensure(userId, username) {
                const key = keyFor(userId, username);
                if (!key) return null;
                if (!byKey.has(key)) {
                    byKey.set(key, {
                        robloxUserId: userId != null ? userId : null,
                        robloxUsername: username || null,
                        roles: [],
                        lastActive: null,
                        requestCount: 0,
                        pendingCount: 0,
                        paidTotals: {},
                        onboardingCompleted: 0,
                        team: null,
                        skillset: null,
                        teams: [],
                        warnCount: 0,
                        isBanned: false
                    });
                }
                const row = byKey.get(key);
                if (userId != null && row.robloxUserId == null) row.robloxUserId = userId;
                if (username && !row.robloxUsername) row.robloxUsername = username;
                return row;
            }

            (sessionsRes.data || []).forEach(s => {
                const row = ensure(s.roblox_user_id, s.roblox_username);
                if (!row) return;
                row.roles = Array.from(new Set([...row.roles, ...(s.roles || [])]));
                const seen = s.last_synced_at || null;
                if (seen && (!row.lastActive || new Date(seen) > new Date(row.lastActive))) row.lastActive = seen;
            });

            (assignmentsRes.data || []).forEach(a => {
                const row = ensure(a.roblox_user_id, a.roblox_username);
                if (!row) return;
                const roleName = a.roles && a.roles.name;
                if (roleName && !row.roles.includes(roleName)) row.roles.push(roleName);
            });

            (requestsRes.data || []).forEach(r => {
                const row = ensure(r.roblox_user_id, r.roblox_username);
                if (!row) return;
                row.requestCount += 1;
                if (!r.paid && (r.status || 'pending') === 'pending') row.pendingCount += 1;
                if (r.paid) {
                    const cur = r.currency || 'ROBUX';
                    row.paidTotals[cur] = (row.paidTotals[cur] || 0) + (Number(r.payment) || 0);
                }
            });

            const progressByUser = new Map();
            (progressRes.data || []).forEach(p => {
                if (!requiredStepIds.has(p.step_id)) return;
                const key = `id:${p.roblox_user_id}`;
                progressByUser.set(key, (progressByUser.get(key) || 0) + 1);
            });
            byKey.forEach((row, key) => {
                row.onboardingCompleted = progressByUser.get(key) || 0;
                row.onboardingRequired = totalRequiredSteps;
                const tas = row.robloxUserId != null ? (teamAssignsByUserId[row.robloxUserId] || []) : [];
                row.teams = tas.map(ta => ({
                    teamId: ta.team_id,
                    teamName: ta.team_id != null ? (teamNameById[ta.team_id] || null) : null,
                    skillsetId: ta.skillset_id,
                    skillsetName: ta.skillset_id != null ? (skillsetNameById[ta.skillset_id] || null) : null
                })).filter(t => t.teamName || t.skillsetName);
                row.team = row.teams.map(t => t.teamName).filter(Boolean).join(', ') || null;
                row.skillset = [...new Set(row.teams.map(t => t.skillsetName).filter(Boolean))].join(', ') || null;
            });

            const warnCountByUser = {};
            (warningsRes.data || []).forEach(w => {
                if (w.roblox_user_id != null) {
                    warnCountByUser[w.roblox_user_id] = (warnCountByUser[w.roblox_user_id] || 0) + 1;
                }
            });
            const bannedSet = new Set((bansRes.data || []).map(b => b.roblox_user_id));
            byKey.forEach((row) => {
                if (row.robloxUserId != null) {
                    row.warnCount = warnCountByUser[row.robloxUserId] || 0;
                    row.isBanned = bannedSet.has(row.robloxUserId);
                }
            });

            byKey.forEach((row) => {
                row.maxHierarchy = row.roles.reduce((max, name) => Math.max(max, hierarchyByRoleName[name] || 0), 0);
            });

            const data = Array.from(byKey.values()).filter(r => r.robloxUserId != null || r.robloxUsername);
            res.json({ ok: true, data, viewerHierarchy: session.max_hierarchy || 0 });
        } catch (e) {
            res.status(500).json({ ok: false, error: 'Could not load the staff database.' });
        }
        return;
    }

    if (action === 'list_teams') {
        const { data, error } = await supabase.from('teams').select('*').order('name', { ascending: true });
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        const { data: links, error: linkErr } = await supabase.from('team_skillsets').select('team_id, skillset_id');
        if (linkErr) { res.status(500).json({ ok: false, error: linkErr.message }); return; }
        const skillsetIdsByTeam = {};
        (links || []).forEach(l => {
            if (!skillsetIdsByTeam[l.team_id]) skillsetIdsByTeam[l.team_id] = [];
            skillsetIdsByTeam[l.team_id].push(l.skillset_id);
        });
        const out = (data || []).map(t => ({ ...t, skillsetIds: skillsetIdsByTeam[t.id] || [] }));
        res.json({ ok: true, data: out });
        return;
    }

    if (action === 'add_team') {
        if (!requirePermission(res, session, 'settings.manage_onboarding')) return;
        const name = payload.name && String(payload.name).trim();
        if (!name) { res.status(400).json({ ok: false, error: 'missing_name' }); return; }
        const { data, error } = await supabase.from('teams').insert({
            name,
            color: payload.color ? String(payload.color).trim() : null,
            discord_url: payload.discordUrl ? String(payload.discordUrl).trim() : null,
            roblox_group_url: payload.robloxGroupUrl ? String(payload.robloxGroupUrl).trim() : null,
            roblox_group_id: payload.robloxGroupId ? Number(payload.robloxGroupId) : null,
            default_group_role_id: payload.defaultGroupRoleId ? Number(payload.defaultGroupRoleId) : null,
            info: payload.info ? String(payload.info) : null
        }).select().maybeSingle();
        if (error?.code === '23505') { res.status(400).json({ ok: false, error: 'A team with that name already exists.' }); return; }
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        const skillsetIds = Array.isArray(payload.skillsetIds) ? payload.skillsetIds : [];
        if (data && skillsetIds.length) {
            await supabase.from('team_skillsets').insert(skillsetIds.map(sid => ({ team_id: data.id, skillset_id: sid })));
        }
        res.json({ ok: true, data });
        return;
    }

    if (action === 'update_team') {
        if (!requirePermission(res, session, 'settings.manage_onboarding')) return;
        const id = payload.id;
        if (!id) { res.status(400).json({ ok: false, error: 'missing_id' }); return; }
        const update = {};
        if (payload.name != null) update.name = String(payload.name).trim();
        if (payload.color !== undefined) update.color = payload.color ? String(payload.color).trim() : null;
        if (payload.discordUrl !== undefined) update.discord_url = payload.discordUrl ? String(payload.discordUrl).trim() : null;
        if (payload.robloxGroupUrl !== undefined) update.roblox_group_url = payload.robloxGroupUrl ? String(payload.robloxGroupUrl).trim() : null;
        if (payload.robloxGroupId !== undefined) update.roblox_group_id = payload.robloxGroupId ? Number(payload.robloxGroupId) : null;
        if (payload.defaultGroupRoleId !== undefined) update.default_group_role_id = payload.defaultGroupRoleId ? Number(payload.defaultGroupRoleId) : null;
        if (payload.info !== undefined) update.info = payload.info ? String(payload.info) : null;
        const { error } = await supabase.from('teams').update(update).eq('id', id);
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        if (Array.isArray(payload.skillsetIds)) {
            await supabase.from('team_skillsets').delete().eq('team_id', id);
            if (payload.skillsetIds.length) {
                await supabase.from('team_skillsets').insert(payload.skillsetIds.map(sid => ({ team_id: id, skillset_id: sid })));
            }
        }
        res.json({ ok: true });
        return;
    }

    if (action === 'delete_team') {
        if (!requirePermission(res, session, 'settings.manage_onboarding')) return;
        const id = payload.id;
        if (!id) { res.status(400).json({ ok: false, error: 'missing_id' }); return; }
        const { error } = await supabase.from('teams').delete().eq('id', id);
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true });
        return;
    }

    if (action === 'list_skillsets') {
        const { data, error } = await supabase.from('skillsets').select('*').order('name', { ascending: true });
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true, data });
        return;
    }

    if (action === 'add_skillset') {
        if (!requirePermission(res, session, 'settings.manage_onboarding')) return;
        const name = payload.name && String(payload.name).trim();
        if (!name) { res.status(400).json({ ok: false, error: 'missing_name' }); return; }
        const { error } = await supabase.from('skillsets').insert({
            name,
            color: payload.color ? String(payload.color).trim() : null,
            description: payload.description ? String(payload.description).trim() : null
        });
        if (error?.code === '23505') { res.status(400).json({ ok: false, error: 'A skillset with that name already exists.' }); return; }
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true });
        return;
    }

    if (action === 'update_skillset') {
        if (!requirePermission(res, session, 'settings.manage_onboarding')) return;
        const id = payload.id;
        if (!id) { res.status(400).json({ ok: false, error: 'missing_id' }); return; }
        const update = {};
        if (payload.name != null) update.name = String(payload.name).trim();
        if (payload.color !== undefined) update.color = payload.color ? String(payload.color).trim() : null;
        if (payload.description !== undefined) update.description = payload.description ? String(payload.description).trim() : null;
        const { error } = await supabase.from('skillsets').update(update).eq('id', id);
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true });
        return;
    }

    if (action === 'delete_skillset') {
        if (!requirePermission(res, session, 'settings.manage_onboarding')) return;
        const id = payload.id;
        if (!id) { res.status(400).json({ ok: false, error: 'missing_id' }); return; }
        const { error } = await supabase.from('skillsets').delete().eq('id', id);
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true });
        return;
    }

    if (action === 'list_recruitment_positions') {
        if (!requirePermission(res, session, 'settings.manage_onboarding')) return;
        const { data, error } = await supabase.from('recruitment_positions').select('*').order('name', { ascending: true });
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true, data: data || [] });
        return;
    }

    if (action === 'add_recruitment_position') {
        if (!requirePermission(res, session, 'settings.manage_onboarding')) return;
        const name = payload.name && String(payload.name).trim();
        const discordRoleId = payload.discordRoleId ? String(payload.discordRoleId).trim() : null;
        if (!name) { res.status(400).json({ ok: false, error: 'missing_name' }); return; }
        const { error } = await supabase.from('recruitment_positions').insert({ name, discord_role_id: discordRoleId });
        if (error?.code === '23505') { res.status(400).json({ ok: false, error: 'A position with that name already exists.' }); return; }
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true });
        return;
    }

    if (action === 'update_recruitment_position') {
        if (!requirePermission(res, session, 'settings.manage_onboarding')) return;
        const id = payload.id;
        if (!id) { res.status(400).json({ ok: false, error: 'missing_id' }); return; }
        const update = {};
        if (payload.name != null) update.name = String(payload.name).trim();
        if (payload.discordRoleId !== undefined) update.discord_role_id = payload.discordRoleId ? String(payload.discordRoleId).trim() : null;
        const { error } = await supabase.from('recruitment_positions').update(update).eq('id', id);
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true });
        return;
    }

    if (action === 'delete_recruitment_position') {
        if (!requirePermission(res, session, 'settings.manage_onboarding')) return;
        const id = payload.id;
        if (!id) { res.status(400).json({ ok: false, error: 'missing_id' }); return; }
        const { error } = await supabase.from('recruitment_positions').delete().eq('id', id);
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true });
        return;
    }

    if (action === 'list_broadcasts') {
        if (!requirePermission(res, session, 'broadcasts.manage')) return;
        const { data, error } = await supabase
            .from('broadcasts')
            .select('id, type, team_id, message, created_by, created_at, teams(name)')
            .order('created_at', { ascending: false });
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true, data: data || [] });
        return;
    }

    if (action === 'create_broadcast') {
        if (!requirePermission(res, session, 'broadcasts.manage')) return;
        const type = payload.type === 'team' ? 'team' : payload.type === 'global' ? 'global' : null;
        const message = payload.message ? String(payload.message).trim() : '';
        if (!type) { res.status(400).json({ ok: false, error: 'invalid_type' }); return; }
        if (!message) { res.status(400).json({ ok: false, error: 'missing_message' }); return; }
        let teamId = null;
        if (type === 'team') {
            teamId = payload.teamId === '' || payload.teamId == null ? null : Number(payload.teamId);
            if (!teamId) { res.status(400).json({ ok: false, error: 'missing_team' }); return; }
        }
        const { error } = await supabase.from('broadcasts').insert({
            type,
            team_id: teamId,
            message,
            created_by: session.roblox_username,
            created_at: new Date().toISOString()
        });
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true });
        return;
    }

    if (action === 'delete_broadcast') {
        if (!requirePermission(res, session, 'broadcasts.manage')) return;
        const id = payload.id;
        if (!id) { res.status(400).json({ ok: false, error: 'missing_id' }); return; }
        const { error } = await supabase.from('broadcasts').delete().eq('id', id);
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true });
        return;
    }

    if (action === 'list_my_broadcasts') {
        try {
            const { data: uas } = await supabase
                .from('user_assignments')
                .select('team_id')
                .eq('roblox_user_id', session.roblox_user_id);
            const teamIds = [...new Set((uas || []).filter(a => a.team_id != null).map(a => a.team_id))];

            const orParts = ["type.eq.global"];
            teamIds.forEach(teamId => orParts.push(`and(type.eq.team,team_id.eq.${teamId})`));

            const { data, error } = await supabase
                .from('broadcasts')
                .select('id, type, team_id, message, created_by, created_at, teams(name)')
                .or(orParts.join(','))
                .order('created_at', { ascending: false });
            if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
            res.json({ ok: true, data: data || [] });
        } catch (e) {
            res.status(500).json({ ok: false, error: 'Could not load broadcasts.' });
        }
        return;
    }

    if (action === 'list_onboarding_links') {
        if (!requirePermission(res, session, 'settings.manage_onboarding')) return;
        const { data, error } = await supabase.from('onboarding_links').select('*').order('created_at', { ascending: false });
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        const teamIds = [...new Set((data || []).filter(l => l.team_id != null).map(l => l.team_id))];
        const skillsetIds = [...new Set((data || []).filter(l => l.skillset_id != null).map(l => l.skillset_id))];
        const roleIds = [...new Set((data || []).filter(l => l.role_id != null).map(l => l.role_id))];
        const [teamsRes, skillsetsRes, rolesRes] = await Promise.all([
            teamIds.length ? supabase.from('teams').select('id,name').in('id', teamIds) : { data: [] },
            skillsetIds.length ? supabase.from('skillsets').select('id,name').in('id', skillsetIds) : { data: [] },
            roleIds.length ? supabase.from('roles').select('id,name').in('id', roleIds) : { data: [] }
        ]);
        const teamNameById = {}; (teamsRes.data || []).forEach(t => { teamNameById[t.id] = t.name; });
        const skillsetNameById = {}; (skillsetsRes.data || []).forEach(s => { skillsetNameById[s.id] = s.name; });
        const roleNameById = {}; (rolesRes.data || []).forEach(r => { roleNameById[r.id] = r.name; });
        const out = (data || []).map(l => ({
            ...l,
            teamName: l.team_id != null ? (teamNameById[l.team_id] || null) : null,
            skillsetName: l.skillset_id != null ? (skillsetNameById[l.skillset_id] || null) : null,
            roleName: l.role_id != null ? (roleNameById[l.role_id] || null) : null,
            url: `${APP_ORIGIN}/#/join/${l.token}`
        }));
        res.json({ ok: true, data: out });
        return;
    }

    if (action === 'create_onboarding_link') {
        if (!requirePermission(res, session, 'settings.manage_onboarding')) return;
        const teamId = payload.teamId ? Number(payload.teamId) : null;
        const skillsetId = payload.skillsetId ? Number(payload.skillsetId) : null;
        const roleId = payload.roleId ? Number(payload.roleId) : null;
        const label = payload.label ? String(payload.label).trim() : null;
        const token = generateLinkToken();
        const { error } = await supabase.from('onboarding_links').insert({
            token,
            team_id: teamId,
            skillset_id: skillsetId,
            role_id: roleId,
            label,
            created_by: session.roblox_username,
            uses: 0
        });
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true, token, url: `${APP_ORIGIN}/#/join/${token}` });
        return;
    }

    if (action === 'delete_onboarding_link') {
        if (!requirePermission(res, session, 'settings.manage_onboarding')) return;
        const token = payload.token;
        if (!token) { res.status(400).json({ ok: false, error: 'missing_token' }); return; }
        const { error } = await supabase.from('onboarding_links').delete().eq('token', token);
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true });
        return;
    }

    if (action === 'get_onboarding_link_info') {
        const token = payload.token && String(payload.token).trim();
        if (!token) { res.status(400).json({ ok: false, error: 'missing_token' }); return; }
        const { data: link, error } = await supabase.from('onboarding_links').select('*').eq('token', token).maybeSingle();
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        if (!link) { res.status(404).json({ ok: false, error: 'link_not_found' }); return; }
        let team = null, skillset = null, role = null;
        if (link.team_id) { const { data } = await supabase.from('teams').select('*').eq('id', link.team_id).maybeSingle(); team = data || null; }
        if (link.skillset_id) { const { data } = await supabase.from('skillsets').select('*').eq('id', link.skillset_id).maybeSingle(); skillset = data || null; }
        if (link.role_id) { const { data } = await supabase.from('roles').select('id,name').eq('id', link.role_id).maybeSingle(); role = data || null; }
        res.json({ ok: true, data: { team, skillset, role, label: link.label } });
        return;
    }

    if (action === 'claim_onboarding_link') {
        const token = payload.token && String(payload.token).trim();
        if (!token) { res.status(400).json({ ok: false, error: 'missing_token' }); return; }
        try {
            const { data: link, error: linkErr } = await supabase.from('onboarding_links').select('*').eq('token', token).maybeSingle();
            if (linkErr) { res.status(500).json({ ok: false, error: linkErr.message }); return; }
            if (!link) { res.status(404).json({ ok: false, error: 'link_not_found' }); return; }

            // Same gate as recruitment: must have a linked Discord account, and that account must
            // actually be in the Discord server, before we'll start the group-join flow at all -
            // otherwise there's no way to DM them the join instructions or verify they've joined.
            const discordUserId = await getLinkedDiscordUserId(session.roblox_user_id);
            if (!discordUserId) { res.status(400).json({ ok: false, error: 'discord_not_linked' }); return; }
            if (DISCORD_GUILD_ID) {
                const inServer = await isDiscordGuildMember(discordUserId);
                if (!inServer) { res.status(403).json({ ok: false, error: 'discord_not_in_server' }); return; }
            }

            // Don't spin up a second DM/flow if they already started (or finished) this exact link.
            const { data: existingFlow } = await supabase
                .from('recruit_onboarding_flows')
                .select('id, step')
                .eq('roblox_user_id', session.roblox_user_id)
                .eq('link_token', token)
                .maybeSingle();
            if (existingFlow) {
                res.json({ ok: true, data: { alreadyStarted: true, done: existingFlow.step === 'done' } });
                return;
            }

            const flow = await startAccessOnboardingFlow({
                robloxUserId: session.roblox_user_id,
                robloxUsername: session.roblox_username,
                discordUserId,
                linkToken: token,
                teamId: link.team_id || null,
                skillsetId: link.skillset_id || null,
                roleId: link.role_id || null
            });
            if (!flow) {
                res.status(500).json({ ok: false, error: 'Could not start setup - make sure the onboarding group is configured and the bot can DM you.' });
                return;
            }

            await supabase.from('onboarding_links').update({ uses: (link.uses || 0) + 1 }).eq('token', link.token);

            res.json({ ok: true, data: { started: true } });
        } catch (e) {
            res.status(500).json({ ok: false, error: 'Could not apply that invite link.' });
        }
        return;
    }

    if (action === 'get_my_onboarding_link_flow_status') {
        const token = payload.token && String(payload.token).trim();
        if (!token) { res.status(400).json({ ok: false, error: 'missing_token' }); return; }
        const { data: flow, error } = await supabase
            .from('recruit_onboarding_flows')
            .select('step')
            .eq('roblox_user_id', session.roblox_user_id)
            .eq('link_token', token)
            .maybeSingle();
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true, data: { started: !!flow, done: !!flow && flow.step === 'done' } });
        return;
    }

    if (action === 'get_my_assignment') {
        try {
            const assignments = await getUserTeamAssignments(session.roblox_user_id);
            res.json({ ok: true, data: assignments });
        } catch (e) {
            res.status(500).json({ ok: false, error: 'Could not load your team assignments.' });
        }
        return;
    }

    if (action === 'get_my_discord_link') {
        const { data, error } = await supabase
            .from('discord_links')
            .select('discord_username, discord_avatar, linked_at')
            .eq('roblox_user_id', session.roblox_user_id)
            .maybeSingle();
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true, data: data || null });
        return;
    }

    if (action === 'unlink_my_discord') {
        const { error } = await supabase.from('discord_links').delete().eq('roblox_user_id', session.roblox_user_id);
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        logAudit(session, {
            category: 'account', action: 'unlink_discord',
            targetUserId: session.roblox_user_id, targetUsername: session.roblox_username,
            details: {}
        });
        res.json({ ok: true });
        return;
    }

    if (action === 'search_roblox_usernames') {
        if (!requirePermission(res, session, 'dashboard.submit_request')) return;
        const q = payload.query ? String(payload.query).trim() : '';
        if (q.length < 2) { res.json({ ok: true, data: [] }); return; }
        try {
            const [sessionsRes, methodsRes, assignmentsRes] = await Promise.all([
                supabase.from('hr_sessions').select('roblox_username').ilike('roblox_username', `%${q}%`).limit(8),
                supabase.from('payment_methods').select('roblox_username').ilike('roblox_username', `%${q}%`).limit(8),
                supabase.from('user_assignments').select('roblox_username').ilike('roblox_username', `%${q}%`).limit(8)
            ]);
            const names = new Set();
            [sessionsRes, methodsRes, assignmentsRes].forEach(r => (r.data || []).forEach(row => { if (row.roblox_username) names.add(row.roblox_username); }));
            res.json({ ok: true, data: Array.from(names).slice(0, 8) });
        } catch (e) {
            res.status(500).json({ ok: false, error: 'search_failed' });
        }
        return;
    }

    if (action === 'assign_user_team_skillset') {
        if (!requirePermission(res, session, 'settings.manage_onboarding')) return;
        const robloxUserId = Number(payload.robloxUserId);
        if (!robloxUserId) { res.status(400).json({ ok: false, error: 'missing_user_id' }); return; }
        const teamId = payload.teamId === '' || payload.teamId == null ? null : Number(payload.teamId);
        if (!teamId) { res.status(400).json({ ok: false, error: 'missing_team_id' }); return; }
        const skillsetId = payload.skillsetId === '' || payload.skillsetId == null ? null : Number(payload.skillsetId);
        let username = payload.robloxUsername ? String(payload.robloxUsername).trim() : null;
        if (!username) {
            const lookupRes = await fetch(`https://users.roblox.com/v1/users/${robloxUserId}`);
            if (lookupRes.ok) username = (await lookupRes.json()).name;
        }
        const { error } = await supabase.from('user_assignments').upsert({
            roblox_user_id: robloxUserId,
            roblox_username: username,
            team_id: teamId,
            skillset_id: skillsetId,
            assigned_at: new Date().toISOString()
        }, { onConflict: 'roblox_user_id,team_id' });
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true });
        return;
    }

    if (action === 'remove_user_team_assignment') {
        if (!requirePermission(res, session, 'settings.manage_onboarding')) return;
        const robloxUserId = Number(payload.robloxUserId);
        const teamId = payload.teamId === '' || payload.teamId == null ? null : Number(payload.teamId);
        if (!robloxUserId) { res.status(400).json({ ok: false, error: 'missing_user_id' }); return; }
        if (!teamId) { res.status(400).json({ ok: false, error: 'missing_team_id' }); return; }
        const { error } = await supabase.from('user_assignments').delete().eq('roblox_user_id', robloxUserId).eq('team_id', teamId);
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true });
        return;
    }

    if (action === 'list_user_team_assignments') {
        if (!requirePermission(res, session, 'settings.manage_onboarding')) return;
        const robloxUserId = Number(payload.robloxUserId);
        if (!robloxUserId) { res.status(400).json({ ok: false, error: 'missing_user_id' }); return; }
        try {
            const assignments = await getUserTeamAssignments(robloxUserId);
            res.json({ ok: true, data: assignments });
        } catch (e) {
            res.status(500).json({ ok: false, error: 'Could not load that user\'s team assignments.' });
        }
        return;
    }

    if (action === 'list_user_skillsets') {
        if (!hasPermission(session, 'dashboard.submit_request') && !hasPermission(session, 'staff.view_database') && !hasPermission(session, 'settings.manage_onboarding')) {
            res.status(403).json({ ok: false, error: 'missing_permission' });
            return;
        }
        const robloxUserId = payload.robloxUserId != null && payload.robloxUserId !== '' ? Number(payload.robloxUserId) : null;
        const robloxUsername = payload.robloxUsername ? String(payload.robloxUsername).trim() : null;
        if (!robloxUserId && !robloxUsername) { res.status(400).json({ ok: false, error: 'missing_user' }); return; }

        let resolvedUserId = robloxUserId;
        if (!resolvedUserId && robloxUsername) {
            try { resolvedUserId = await resolveRobloxUserId(robloxUsername); } catch (e) { }
        }
        if (!resolvedUserId) { res.json({ ok: true, data: [] }); return; }

        // A person's "skillsets" are the union of two sources: skillsets deliberately assigned
        // here (user_skillsets - the "General skillsets" list in Staff Database), and whatever
        // skillset(s) they picked up through team assignment (user_assignments.skillset_id - set
        // e.g. when they join through an onboarding invite link that has a skillset attached).
        // Deliberately plain queries joined in JS instead of a PostgREST embed - the embed depends
        // on PostgREST having detected the foreign key, which can silently return nothing (not
        // even an error) if the schema cache hasn't picked it up yet.
        const [linksRes, assignmentsRes] = await Promise.all([
            supabase.from('user_skillsets').select('id, skillset_id').eq('roblox_user_id', resolvedUserId),
            supabase.from('user_assignments').select('skillset_id').eq('roblox_user_id', resolvedUserId).not('skillset_id', 'is', null)
        ]);
        if (linksRes.error) { res.status(500).json({ ok: false, error: linksRes.error.message }); return; }
        if (assignmentsRes.error) { res.status(500).json({ ok: false, error: assignmentsRes.error.message }); return; }

        const idsFromGeneral = (linksRes.data || []).map(l => l.skillset_id);
        const idsFromTeams = (assignmentsRes.data || []).map(a => a.skillset_id);
        const skillsetIds = [...new Set([...idsFromGeneral, ...idsFromTeams].filter(id => id != null))];
        if (!skillsetIds.length) { res.json({ ok: true, data: [] }); return; }

        const { data: skillsetRows, error: skillsetsErr } = await supabase
            .from('skillsets')
            .select('id, name, color')
            .in('id', skillsetIds);
        if (skillsetsErr) { res.status(500).json({ ok: false, error: skillsetsErr.message }); return; }

        const out = (skillsetRows || []).map(s => ({ id: s.id, name: s.name, color: s.color }));
        res.json({ ok: true, data: out });
        return;
    }

    if (action === 'add_user_skillsets') {
        if (!requirePermission(res, session, 'settings.manage_onboarding')) return;
        const robloxUserId = Number(payload.robloxUserId);
        if (!robloxUserId) { res.status(400).json({ ok: false, error: 'missing_user_id' }); return; }
        const skillsetIds = Array.isArray(payload.skillsetIds) ? payload.skillsetIds.map(Number).filter(Boolean) : [];
        if (!skillsetIds.length) { res.status(400).json({ ok: false, error: 'missing_skillset_ids' }); return; }
        let username = payload.robloxUsername ? String(payload.robloxUsername).trim() : null;
        if (!username) {
            const lookupRes = await fetch(`https://users.roblox.com/v1/users/${robloxUserId}`);
            if (lookupRes.ok) username = (await lookupRes.json()).name;
        }
        const rows = skillsetIds.map(skillsetId => ({
            roblox_user_id: robloxUserId,
            roblox_username: username,
            skillset_id: skillsetId
        }));
        const { error } = await supabase.from('user_skillsets').upsert(rows, { onConflict: 'roblox_user_id,skillset_id', ignoreDuplicates: true });
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true });
        return;
    }

    if (action === 'remove_user_skillset') {
        if (!requirePermission(res, session, 'settings.manage_onboarding')) return;
        const robloxUserId = Number(payload.robloxUserId);
        const skillsetId = Number(payload.skillsetId);
        if (!robloxUserId || !skillsetId) { res.status(400).json({ ok: false, error: 'missing_fields' }); return; }
        const { error } = await supabase.from('user_skillsets').delete().eq('roblox_user_id', robloxUserId).eq('skillset_id', skillsetId);
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true });
        return;
    }

    if (action === 'get_my_warnings') {
        const { data, error } = await supabase
            .from('staff_warnings')
            .select('*')
            .eq('roblox_user_id', session.roblox_user_id)
            .order('created_at', { ascending: false });
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true, data: data || [] });
        return;
    }

    if (action === 'list_user_warnings') {
        if (!hasPermission(session, 'staff.moderate') && !hasPermission(session, 'staff.view_database')) {
            res.status(403).json({ ok: false, error: 'missing_permission' });
            return;
        }
        const robloxUserId = Number(payload.robloxUserId);
        if (!robloxUserId) { res.status(400).json({ ok: false, error: 'missing_user_id' }); return; }
        const { data, error } = await supabase
            .from('staff_warnings')
            .select('*')
            .eq('roblox_user_id', robloxUserId)
            .order('created_at', { ascending: false });
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        const { data: ban } = await supabase.from('banned_users').select('*').eq('roblox_user_id', robloxUserId).maybeSingle();
        res.json({ ok: true, data: data || [], banned: ban || null, warnCount: (data || []).length });
        return;
    }

    if (action === 'add_user_warning') {
        if (!requirePermission(res, session, 'staff.moderate')) return;
        const robloxUserId = Number(payload.robloxUserId);
        const reason = payload.reason ? String(payload.reason).trim() : '';
        if (!robloxUserId) { res.status(400).json({ ok: false, error: 'missing_user_id' }); return; }
        if (!reason) { res.status(400).json({ ok: false, error: 'missing_reason' }); return; }
        const targetHierarchy = await getUserHierarchy(robloxUserId);
        if (!requireHigherHierarchy(res, session, targetHierarchy)) return;
        let username = payload.robloxUsername ? String(payload.robloxUsername).trim() : null;
        if (!username) {
            const lookupRes = await fetch(`https://users.roblox.com/v1/users/${robloxUserId}`);
            if (lookupRes.ok) username = (await lookupRes.json()).name;
        }
        const { data: insertedWarning, error } = await supabase.from('staff_warnings').insert({
            roblox_user_id: robloxUserId,
            roblox_username: username,
            reason,
            warned_by: session.roblox_username,
            created_at: new Date().toISOString()
        }).select('id').maybeSingle();
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }

        const count = await getWarnCount(robloxUserId);
        let banned = false;
        if (count >= 3) {
            await supabase.from('banned_users').upsert({
                roblox_user_id: robloxUserId,
                roblox_username: username,
                reason: 'Reached 3 warnings',
                banned_by: session.roblox_username,
                banned_at: new Date().toISOString()
            }, { onConflict: 'roblox_user_id' });
            await supabase.from('hr_sessions').delete().eq('roblox_user_id', robloxUserId);
            banned = true;
            logAudit(session, {
                category: 'moderation', action: 'auto_ban',
                targetUserId: robloxUserId, targetUsername: username,
                details: { reason: 'Reached 3 warnings' },
                revert: { type: 'unban_user', robloxUserId }
            });
        }
        logAudit(session, {
            category: 'moderation', action: 'add_user_warning',
            targetUserId: robloxUserId, targetUsername: username,
            details: { reason, warnCount: count },
            revert: insertedWarning ? { type: 'remove_warning', warningId: insertedWarning.id } : null
        });
        res.json({ ok: true, warnCount: count, banned });
        return;
    }

    if (action === 'remove_user_warning') {
        if (!requirePermission(res, session, 'staff.moderate')) return;
        const warningId = payload.warningId;
        if (!warningId) { res.status(400).json({ ok: false, error: 'missing_warning_id' }); return; }
        const { data: warning, error: warningErr } = await supabase
            .from('staff_warnings')
            .select('*')
            .eq('id', warningId)
            .maybeSingle();
        if (warningErr) { res.status(500).json({ ok: false, error: warningErr.message }); return; }
        if (!warning) { res.status(404).json({ ok: false, error: 'warning_not_found' }); return; }
        const targetHierarchy = await getUserHierarchy(warning.roblox_user_id);
        if (!requireHigherHierarchy(res, session, targetHierarchy)) return;
        const { error } = await supabase.from('staff_warnings').delete().eq('id', warningId);
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        const count = await getWarnCount(warning.roblox_user_id);
        logAudit(session, {
            category: 'moderation', action: 'remove_user_warning',
            targetUserId: warning.roblox_user_id, targetUsername: warning.roblox_username,
            details: { warningId, reason: warning.reason },
            revert: { type: 'restore_warning', row: warning }
        });
        res.json({ ok: true, warnCount: count });
        return;
    }

    if (action === 'unban_user') {
        if (!requirePermission(res, session, 'staff.moderate')) return;
        const robloxUserId = Number(payload.robloxUserId);
        if (!robloxUserId) { res.status(400).json({ ok: false, error: 'missing_user_id' }); return; }
        const targetHierarchy = await getUserHierarchy(robloxUserId);
        if (!requireHigherHierarchy(res, session, targetHierarchy)) return;
        const { data: banRow } = await supabase.from('banned_users').select('*').eq('roblox_user_id', robloxUserId).maybeSingle();
        await supabase.from('banned_users').delete().eq('roblox_user_id', robloxUserId);
        logAudit(session, {
            category: 'moderation', action: 'unban_user',
            targetUserId: robloxUserId, targetUsername: banRow ? banRow.roblox_username : null,
            details: {},
            revert: banRow ? { type: 'reban_user', row: banRow } : null
        });
        res.json({ ok: true });
        return;
    }

    if (action === 'list_audit_logs') {
        if (!requirePermission(res, session, 'audit.view')) return;
        const category = payload.category && payload.category !== 'all' ? String(payload.category) : null;
        const search = payload.search ? String(payload.search).trim().toLowerCase() : '';
        let query = supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(300);
        if (category) query = query.eq('category', category);
        const { data, error } = await query;
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        let rows = data || [];
        if (search) {
            rows = rows.filter(r =>
                (r.actor_username || '').toLowerCase().includes(search) ||
                (r.target_username || '').toLowerCase().includes(search) ||
                (r.action || '').toLowerCase().includes(search)
            );
        }
        res.json({ ok: true, data: rows });
        return;
    }

    if (action === 'revert_audit_log') {
        if (!requirePermission(res, session, 'audit.revert')) return;
        const id = payload.id;
        if (!id) { res.status(400).json({ ok: false, error: 'missing_id' }); return; }
        const { data: log, error: logErr } = await supabase.from('audit_logs').select('*').eq('id', id).maybeSingle();
        if (logErr) { res.status(500).json({ ok: false, error: logErr.message }); return; }
        if (!log) { res.status(404).json({ ok: false, error: 'log_not_found' }); return; }
        if (log.reverted) { res.status(400).json({ ok: false, error: 'already_reverted' }); return; }
        if (!log.revert_data) { res.status(400).json({ ok: false, error: 'not_revertible' }); return; }

        const result = await applyRevert(log.revert_data);
        if (!result.ok) { res.status(500).json({ ok: false, error: result.error }); return; }

        await supabase.from('audit_logs').update({
            reverted: true, reverted_by: session.roblox_username, reverted_at: new Date().toISOString()
        }).eq('id', id);

        logAudit(session, {
            category: log.category, action: 'revert',
            targetUserId: log.target_user_id, targetUsername: log.target_username,
            details: { reverted_log_id: id, original_action: log.action }
        });
        res.json({ ok: true });
        return;
    }

    if (action === 'quick_moderate') {
        if (!requirePermission(res, session, 'staff.moderate')) return;
        const robloxUserId = Number(payload.robloxUserId);
        const robloxUsername = payload.robloxUsername ? String(payload.robloxUsername).trim() : null;
        const type = payload.type;
        const reason = payload.reason ? String(payload.reason).trim() : '';
        if (!robloxUserId) { res.status(400).json({ ok: false, error: 'missing_user_id' }); return; }
        if (!['warn', 'ban', 'unban', 'note'].includes(type)) { res.status(400).json({ ok: false, error: 'invalid_type' }); return; }
        const targetHierarchy = await getUserHierarchy(robloxUserId);
        if (!requireHigherHierarchy(res, session, targetHierarchy)) return;

        if (type === 'note') {
            if (!reason) { res.status(400).json({ ok: false, error: 'missing_reason' }); return; }
            await logAudit(session, {
                category: 'moderation', action: 'note',
                targetUserId: robloxUserId, targetUsername: robloxUsername,
                details: { reason }
            });
            res.json({ ok: true });
            return;
        }

        if (type === 'warn') {
            if (!reason) { res.status(400).json({ ok: false, error: 'missing_reason' }); return; }
            const { data: insertedWarning, error } = await supabase.from('staff_warnings').insert({
                roblox_user_id: robloxUserId,
                roblox_username: robloxUsername,
                reason,
                warned_by: session.roblox_username,
                created_at: new Date().toISOString()
            }).select('id').maybeSingle();
            if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
            const count = await getWarnCount(robloxUserId);
            let banned = false;
            if (count >= 3) {
                await supabase.from('banned_users').upsert({
                    roblox_user_id: robloxUserId, roblox_username: robloxUsername,
                    reason: 'Reached 3 warnings', banned_by: session.roblox_username,
                    banned_at: new Date().toISOString()
                }, { onConflict: 'roblox_user_id' });
                await supabase.from('hr_sessions').delete().eq('roblox_user_id', robloxUserId);
                banned = true;
            }
            await logAudit(session, {
                category: 'moderation', action: 'quick_warn',
                targetUserId: robloxUserId, targetUsername: robloxUsername,
                details: { reason, warnCount: count },
                revert: insertedWarning ? { type: 'remove_warning', warningId: insertedWarning.id } : null
            });
            res.json({ ok: true, warnCount: count, banned });
            return;
        }

        if (type === 'ban') {
            await supabase.from('banned_users').upsert({
                roblox_user_id: robloxUserId, roblox_username: robloxUsername,
                reason: reason || 'Quick moderation action', banned_by: session.roblox_username,
                banned_at: new Date().toISOString()
            }, { onConflict: 'roblox_user_id' });
            await supabase.from('hr_sessions').delete().eq('roblox_user_id', robloxUserId);
            await logAudit(session, {
                category: 'moderation', action: 'quick_ban',
                targetUserId: robloxUserId, targetUsername: robloxUsername,
                details: { reason },
                revert: { type: 'unban_user', robloxUserId }
            });
            res.json({ ok: true });
            return;
        }

        if (type === 'unban') {
            const { data: banRow } = await supabase.from('banned_users').select('*').eq('roblox_user_id', robloxUserId).maybeSingle();
            await supabase.from('banned_users').delete().eq('roblox_user_id', robloxUserId);
            await logAudit(session, {
                category: 'moderation', action: 'quick_unban',
                targetUserId: robloxUserId, targetUsername: robloxUsername,
                details: { reason },
                revert: banRow ? { type: 'reban_user', row: banRow } : null
            });
            res.json({ ok: true });
            return;
        }
    }

    if (action === 'backup_all_data') {
        if (!requirePermission(res, session, 'backups.manage')) return;
        try {
            const backup = await runBackup('manual', session.roblox_username);
            logAudit(session, {
                category: 'backups', action: 'backup_created',
                details: { id: backup.id, row_counts: backup.row_counts, size_bytes: backup.size_bytes }
            });
            res.json({ ok: true, data: backup });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
        return;
    }

    if (action === 'list_backups') {
        if (!requirePermission(res, session, 'backups.manage')) return;
        const { data, error } = await supabase
            .from('backups')
            .select('id, created_by, trigger, tables, row_counts, size_bytes, created_at')
            .order('created_at', { ascending: false })
            .limit(50);
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true, data: data || [] });
        return;
    }

    if (action === 'load_backup') {
        if (!requirePermission(res, session, 'backups.manage')) return;
        const id = payload.id;
        if (!id) { res.status(400).json({ ok: false, error: 'missing_id' }); return; }
        const { data, error } = await supabase.from('backups').select('*').eq('id', id).maybeSingle();
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        if (!data) { res.status(404).json({ ok: false, error: 'backup_not_found' }); return; }
        let parsed = null;
        try {
            const buf = Buffer.from(data.data_gz, 'base64');
            const json = zlib.gunzipSync(buf).toString('utf8');
            parsed = JSON.parse(json);
        } catch (e) {
            res.status(500).json({ ok: false, error: 'Could not decode this backup.' });
            return;
        }
        logAudit(session, { category: 'backups', action: 'backup_loaded', details: { id } });
        res.json({ ok: true, data: parsed, meta: { id, created_by: data.created_by, trigger: data.trigger, created_at: data.created_at, row_counts: data.row_counts } });
        return;
    }

    if (action === 'restore_backup') {
        if (!requirePermission(res, session, 'backups.manage')) return;
        if (!requirePermission(res, session, 'roles.manage')) return;
        const id = payload.id;
        if (!id) { res.status(400).json({ ok: false, error: 'missing_id' }); return; }
        const { data, error } = await supabase.from('backups').select('*').eq('id', id).maybeSingle();
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        if (!data) { res.status(404).json({ ok: false, error: 'backup_not_found' }); return; }

        let parsed = null;
        try {
            const buf = Buffer.from(data.data_gz, 'base64');
            const json = zlib.gunzipSync(buf).toString('utf8');
            parsed = JSON.parse(json);
        } catch (e) {
            res.status(500).json({ ok: false, error: 'Could not decode this backup.' });
            return;
        }

        const summary = {};
        for (const table of (parsed.tables || [])) {
            const rows = (parsed.dump && parsed.dump[table]) || [];
            if (!rows.length) { summary[table] = { restored: 0 }; continue; }
            const { error: upsertErr } = await supabase.from(table).upsert(rows);
            summary[table] = upsertErr ? { restored: 0, error: upsertErr.message } : { restored: rows.length };
        }

        logAudit(session, {
            category: 'backups', action: 'restore_backup',
            details: { id, summary }
        });
        res.json({ ok: true, summary });
        return;
    }

    if (action === 'recruitment_list_recruiters') {
        if (!requirePermission(res, session, 'recruitment.view')) return;
        try {
            const data = await listRecruiters();
            res.json({ ok: true, data });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
        return;
    }

    if (action === 'recruitment_list_tickets') {
        if (!requirePermission(res, session, 'recruitment.view')) return;
        const status = payload.status && payload.status !== 'all' ? String(payload.status) : null;
        let query = supabase.from('recruitment_tickets').select('*').order('created_at', { ascending: false }).limit(200);
        if (status) query = query.eq('status', status);
        const { data, error } = await query;
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true, data: data || [] });
        return;
    }

    if (action === 'recruitment_get_ticket') {
        if (!requirePermission(res, session, 'recruitment.view')) return;
        const id = payload.id;
        if (!id) { res.status(400).json({ ok: false, error: 'missing_id' }); return; }
        const { data: ticket, error: ticketErr } = await supabase.from('recruitment_tickets').select('*').eq('id', id).maybeSingle();
        if (ticketErr) { res.status(500).json({ ok: false, error: ticketErr.message }); return; }
        if (!ticket) { res.status(404).json({ ok: false, error: 'ticket_not_found' }); return; }
        res.json({ ok: true, data: { ticket, discordChannelUrl: discordChannelUrl(ticket.discord_channel_id) } });
        return;
    }

    if (action === 'recruitment_update_status') {
        if (!requirePermission(res, session, 'recruitment.manage')) return;
        const id = payload.id;
        const status = payload.status;
        const reason = payload.reason ? String(payload.reason).trim() : null;
        const validStatuses = ['pending', 'in_review', 'accepted', 'rejected', 'withdrawn'];
        if (!id || !validStatuses.includes(status)) { res.status(400).json({ ok: false, error: 'invalid_status' }); return; }

        const { data: ticket, error: ticketErr } = await supabase.from('recruitment_tickets').select('*').eq('id', id).maybeSingle();
        if (ticketErr) { res.status(500).json({ ok: false, error: ticketErr.message }); return; }
        if (!ticket) { res.status(404).json({ ok: false, error: 'ticket_not_found' }); return; }

        const updates = { status, updated_at: new Date().toISOString() };
        if (!ticket.first_response_at) {
            updates.first_response_at = new Date().toISOString();
            updates.first_response_by_username = session.roblox_username;
        }
        if (['accepted', 'rejected', 'withdrawn'].includes(status)) {
            updates.closed_at = new Date().toISOString();
            updates.closed_by_username = session.roblox_username;
            updates.closed_by_roblox_user_id = session.roblox_user_id;
            updates.closed_by_roblox_username = session.roblox_username;
            updates.close_reason = reason;
        } else {
            updates.closed_at = null; updates.closed_by_username = null;
            updates.closed_by_roblox_user_id = null; updates.closed_by_roblox_username = null;
            updates.close_reason = null;
        }

        const { error: updateErr } = await supabase.from('recruitment_tickets').update(updates).eq('id', id);
        if (updateErr) { res.status(500).json({ ok: false, error: updateErr.message }); return; }

        if (status === 'accepted' && ticket.status !== 'accepted') {
            await processHire({ ...ticket, ...updates }, {
                reviewerUserId: session.roblox_user_id,
                reviewerUsername: session.roblox_username
            });
            const notifyConfig = await getRecruitmentConfig();
            if (notifyConfig.notifyRoleId) {
                notifyRoleHoldersDM(notifyConfig.notifyRoleId, `${ticket.roblox_username} was accepted by ${session.roblox_username}. Take a look in the Tool.`);
            }
        }

        if (reason && ticket.discord_channel_id) {
            discordApi(`/channels/${ticket.discord_channel_id}/messages`, {
                method: 'POST',
                body: JSON.stringify({ content: `Reason (${session.roblox_username}): ${reason}` })
            }).catch(e => console.error('posting status reason to Discord failed:', e.message));
        }

        const statusLabels = { pending: 'set to pending', in_review: 'marked in review', accepted: 'accepted', rejected: 'rejected', withdrawn: 'marked withdrawn' };
        sendPushToApplicant(ticket.roblox_user_id, {
            title: 'Your PlayVerse application was updated',
            body: `Your application was ${statusLabels[status] || status}.`,
            url: `${APP_ORIGIN}/#/recruit/status`
        });

        logAudit(session, {
            category: 'recruitment', action: 'status_change',
            targetUserId: ticket.roblox_user_id, targetUsername: ticket.roblox_username,
            details: { ticketId: id, from: ticket.status, to: status }
        });
        const updatedTicket = { ...ticket, ...updates };
        notifyDiscordStatusChange(updatedTicket, status, session.roblox_username);
        dmApplicantStatusChange(updatedTicket, status);
        refreshDiscordTicketPanel(updatedTicket);
        res.json({ ok: true });
        return;
    }

    if (action === 'recruitment_next_phase') {
        if (!requirePermission(res, session, 'recruitment.manage')) return;
        const id = payload.id;
        const skillsetId = payload.skillsetId;
        if (!id || !skillsetId) { res.status(400).json({ ok: false, error: 'missing_fields' }); return; }

        const { data: ticket, error: ticketErr } = await supabase.from('recruitment_tickets').select('*').eq('id', id).maybeSingle();
        if (ticketErr) { res.status(500).json({ ok: false, error: ticketErr.message }); return; }
        if (!ticket) { res.status(404).json({ ok: false, error: 'ticket_not_found' }); return; }
        if (ticket.status !== 'accepted') { res.status(400).json({ ok: false, error: 'not_accepted' }); return; }

        const { data: skillset, error: skillsetErr } = await supabase.from('skillsets').select('id, name').eq('id', skillsetId).maybeSingle();
        if (skillsetErr) { res.status(500).json({ ok: false, error: skillsetErr.message }); return; }
        if (!skillset) { res.status(404).json({ ok: false, error: 'skillset_not_found' }); return; }

        const nextPhaseAt = new Date().toISOString();
        const { error: updateErr } = await supabase.from('recruitment_tickets').update({
            status: 'team_selection',
            skillset_id: skillset.id,
            skillset_name: skillset.name,
            next_phase_at: nextPhaseAt,
            next_phase_by_username: session.roblox_username,
            updated_at: nextPhaseAt
        }).eq('id', id);
        if (updateErr) { res.status(500).json({ ok: false, error: updateErr.message }); return; }

        const updatedTicket = { ...ticket, status: 'team_selection', skillset_id: skillset.id, skillset_name: skillset.name };
        const messageId = await notifyDiscordNextPhase(updatedTicket, skillset);
        if (messageId) {
            await supabase.from('recruitment_tickets').update({ team_selection_message_id: messageId }).eq('id', id);
        }

        sendPushToApplicant(ticket.roblox_user_id, {
            title: "You're in!",
            body: 'Your application moved to team selection - hang tight while leads finish placing you.',
            url: `${APP_ORIGIN}/#/recruit/status`
        });

        logAudit(session, {
            category: 'recruitment', action: 'next_phase',
            targetUserId: ticket.roblox_user_id, targetUsername: ticket.roblox_username,
            details: { ticketId: id, skillsetId: skillset.id, skillsetName: skillset.name }
        });
        dmApplicantStatusChange(updatedTicket, 'team_selection');
        refreshDiscordTicketPanel(updatedTicket);

        res.json({ ok: true, data: { discordPosted: !!messageId } });
        return;
    }

    if (action === 'recruitment_place_team') {
        if (!requirePermission(res, session, 'recruitment.manage')) return;
        const id = payload.id;
        const teamId = payload.teamId != null ? Number(payload.teamId) : null;
        if (!id || !teamId) { res.status(400).json({ ok: false, error: 'missing_fields' }); return; }

        const { data: ticket, error: ticketErr } = await supabase.from('recruitment_tickets').select('*').eq('id', id).maybeSingle();
        if (ticketErr) { res.status(500).json({ ok: false, error: ticketErr.message }); return; }
        if (!ticket) { res.status(404).json({ ok: false, error: 'ticket_not_found' }); return; }
        if (ticket.status !== 'team_selection' && ticket.status !== 'signed_off') { res.status(400).json({ ok: false, error: 'not_in_team_selection' }); return; }

        const { data: team, error: teamErr } = await supabase.from('teams').select('id, name').eq('id', teamId).maybeSingle();
        if (teamErr) { res.status(500).json({ ok: false, error: teamErr.message }); return; }
        if (!team) { res.status(404).json({ ok: false, error: 'team_not_found' }); return; }

        const placedAt = new Date().toISOString();
        const { error: updateErr } = await supabase.from('recruitment_tickets').update({
            placed_team_id: team.id,
            placed_team_name: team.name,
            placed_at: placedAt,
            updated_at: placedAt
        }).eq('id', id);
        if (updateErr) { res.status(500).json({ ok: false, error: updateErr.message }); return; }

        notifyDiscordPlacement(ticket, team, session.roblox_username);

        sendPushToApplicant(ticket.roblox_user_id, {
            title: "You've been placed!",
            body: `You've been placed on ${team.name}${ticket.skillset_name ? ' as ' + ticket.skillset_name : ''}.`,
            url: `${APP_ORIGIN}/#/recruit/status`
        });
        if (ticket.discord_user_id) {
            sendDiscordDM(ticket.discord_user_id, `You have been accepted and placed on the ${team.name} team.${ticket.skillset_name ? ` Skillset: ${ticket.skillset_name}.` : ''} A recruiter will sign off on this placement, and a producer will finalise your access.`);
        }

        logAudit(session, {
            category: 'recruitment', action: 'team_placement',
            targetUserId: ticket.roblox_user_id, targetUsername: ticket.roblox_username,
            details: { ticketId: id, teamId: team.id, teamName: team.name, skillsetId: ticket.skillset_id, skillsetName: ticket.skillset_name }
        });
        refreshDiscordTicketPanel({ ...ticket, placed_team_id: team.id, placed_team_name: team.name });

        res.json({ ok: true, data: { teamId: team.id, teamName: team.name } });
        return;
    }

    if (action === 'recruitment_sign_off') {
        const hasSignoffPermission = hasPermission(session, 'recruitment.signoff');
        const approvalConfig = await getRecruitmentApprovalConfig();
        const isEligible = hasSignoffPermission || await userHasConfiguredRole(session, approvalConfig.signoffRoleId);
        if (!isEligible) { res.status(403).json({ ok: false, error: 'missing_permission' }); return; }

        const id = payload.id;
        if (!id) { res.status(400).json({ ok: false, error: 'missing_id' }); return; }
        const { data: ticket, error: ticketErr } = await supabase.from('recruitment_tickets').select('*').eq('id', id).maybeSingle();
        if (ticketErr) { res.status(500).json({ ok: false, error: ticketErr.message }); return; }
        if (!ticket) { res.status(404).json({ ok: false, error: 'ticket_not_found' }); return; }
        if (ticket.status !== 'team_selection' || !ticket.placed_team_id) { res.status(400).json({ ok: false, error: 'not_ready_for_signoff' }); return; }

        const nowIso = new Date().toISOString();
        const { error: updateErr } = await supabase.from('recruitment_tickets').update({
            status: 'signed_off',
            signed_off_at: nowIso,
            signed_off_by_username: session.roblox_username,
            updated_at: nowIso
        }).eq('id', id);
        if (updateErr) { res.status(500).json({ ok: false, error: updateErr.message }); return; }

        const updatedTicket = { ...ticket, status: 'signed_off', signed_off_at: nowIso, signed_off_by_username: session.roblox_username };

        const producers = await findProducersForTeam(ticket.placed_team_id);
        for (const producer of producers) {
            const discordUserId = await getLinkedDiscordUserId(producer.roblox_user_id);
            if (discordUserId) {
                sendDiscordDM(discordUserId, `${ticket.roblox_username} was signed off by ${session.roblox_username} and is ready for you to finalise on ${ticket.placed_team_name}. Review and finalise in the Tool.`);
            }
        }

        dmApplicantStatusChange(updatedTicket, 'signed_off');
        refreshDiscordTicketPanel(updatedTicket);

        logAudit(session, {
            category: 'recruitment', action: 'sign_off',
            targetUserId: ticket.roblox_user_id, targetUsername: ticket.roblox_username,
            details: { ticketId: id, teamId: ticket.placed_team_id, teamName: ticket.placed_team_name, producersNotified: producers.length }
        });

        res.json({ ok: true, data: { producersNotified: producers.length } });
        return;
    }

    if (action === 'recruitment_assign') {
        if (!requirePermission(res, session, 'recruitment.manage')) return;
        const id = payload.id;
        if (!id) { res.status(400).json({ ok: false, error: 'missing_id' }); return; }
        const assignToUserId = payload.assignToUserId != null ? Number(payload.assignToUserId) : null;
        const assignToUsername = payload.assignToUsername ? String(payload.assignToUsername) : null;

        const { data: ticket, error: ticketErr } = await supabase.from('recruitment_tickets').select('*').eq('id', id).maybeSingle();
        if (ticketErr) { res.status(500).json({ ok: false, error: ticketErr.message }); return; }
        if (!ticket) { res.status(404).json({ ok: false, error: 'ticket_not_found' }); return; }

        const { error } = await supabase.from('recruitment_tickets').update({
            assigned_to_user_id: assignToUserId,
            assigned_to_username: assignToUsername,
            updated_at: new Date().toISOString()
        }).eq('id', id);
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }

        const updatedTicket = { ...ticket, assigned_to_user_id: assignToUserId, assigned_to_username: assignToUsername };
        notifyDiscordAssignment(updatedTicket, assignToUserId, assignToUsername, session.roblox_username);
        refreshDiscordTicketPanel(updatedTicket);

        if (assignToUserId != null) {
            getLinkedDiscordUserId(assignToUserId).then(discordUserId => {
                if (discordUserId) sendDiscordDM(discordUserId, `You have been assigned to ${ticket.roblox_username}'s application by ${session.roblox_username}.`);
            });
        }

        logAudit(session, {
            category: 'recruitment', action: 'assign',
            targetUserId: ticket.roblox_user_id, targetUsername: ticket.roblox_username,
            details: { ticketId: id, assignToUserId, assignToUsername }
        });

        res.json({ ok: true });
        return;
    }

    if (action === 'recruitment_manual_roling') {
        const hasFinalisePermission = hasPermission(session, 'recruitment.finalise');
        const approvalConfig = await getRecruitmentApprovalConfig();
        const isProducer = hasFinalisePermission || await userHasConfiguredRole(session, approvalConfig.producerRoleId);
        if (!isProducer) { res.status(403).json({ ok: false, error: 'missing_permission' }); return; }

        const id = payload.id;
        if (!id) { res.status(400).json({ ok: false, error: 'missing_id' }); return; }

        const { data: ticket, error: ticketErr } = await supabase.from('recruitment_tickets').select('*').eq('id', id).maybeSingle();
        if (ticketErr) { res.status(500).json({ ok: false, error: ticketErr.message }); return; }
        if (!ticket) { res.status(404).json({ ok: false, error: 'ticket_not_found' }); return; }
        if (!ticket.placed_team_id) { res.status(400).json({ ok: false, error: 'not_placed_on_team_yet' }); return; }
        if (ticket.status !== 'signed_off') { res.status(400).json({ ok: false, error: 'not_signed_off_yet' }); return; }

        const result = await upsertUserAssignmentRecord({
            robloxUserId: ticket.roblox_user_id,
            robloxUsername: ticket.roblox_username,
            teamId: ticket.placed_team_id,
            skillsetId: ticket.skillset_id || null
        });
        if (!result.ok) { res.status(500).json({ ok: false, error: result.error }); return; }

        await finalizeAfterRoling(ticket, session.roblox_username);

        logAudit(session, {
            category: 'recruitment', action: 'manual_roling',
            targetUserId: ticket.roblox_user_id, targetUsername: ticket.roblox_username,
            details: {
                ticketId: id, teamId: ticket.placed_team_id, teamName: ticket.placed_team_name,
                skillsetId: ticket.skillset_id, skillsetName: ticket.skillset_name, mode: result.mode
            }
        });

        sendPushToApplicant(ticket.roblox_user_id, {
            title: "You're all set!",
            body: `Your ${ticket.placed_team_name || 'team'} access is live${ticket.skillset_name ? ' as ' + ticket.skillset_name : ''}.`,
            url: `${APP_ORIGIN}/#/recruit/status`
        });

        res.json({ ok: true, data: { mode: result.mode } });
        return;
    }

    if (action === 'recruitment_analytics') {
        if (!requirePermission(res, session, 'recruitment.analytics')) return;
        const { data: tickets, error } = await supabase.from('recruitment_tickets').select('*');
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        const all = tickets || [];

        const totals = {
            total: all.length,
            pending: all.filter(t => t.status === 'pending').length,
            inReview: all.filter(t => t.status === 'in_review').length,
            accepted: all.filter(t => t.status === 'accepted').length,
            rejected: all.filter(t => t.status === 'rejected').length,
            withdrawn: all.filter(t => t.status === 'withdrawn').length
        };

        const byStaff = {};
        all.forEach(t => {
            if (t.first_response_by_username) {
                const key = t.first_response_by_username;
                byStaff[key] = byStaff[key] || { username: key, responded: 0, accepted: 0, rejected: 0, totalResponseMs: 0, responseCount: 0 };
                byStaff[key].responded += 1;
                if (t.status === 'accepted') byStaff[key].accepted += 1;
                if (t.status === 'rejected') byStaff[key].rejected += 1;
                if (t.first_response_at) {
                    byStaff[key].totalResponseMs += (new Date(t.first_response_at).getTime() - new Date(t.created_at).getTime());
                    byStaff[key].responseCount += 1;
                }
            }
        });
        const staffLeaderboard = Object.values(byStaff).map(s => ({
            username: s.username,
            responded: s.responded,
            accepted: s.accepted,
            rejected: s.rejected,
            avgResponseMinutes: s.responseCount ? Math.round(s.totalResponseMs / s.responseCount / 60000) : null
        })).sort((a, b) => b.responded - a.responded);

        const byReferrer = {};
        all.forEach(t => {
            if (t.referred_by_username) {
                byReferrer[t.referred_by_username] = byReferrer[t.referred_by_username] || { username: t.referred_by_username, count: 0, hired: 0 };
                byReferrer[t.referred_by_username].count += 1;
                if (t.status === 'accepted') byReferrer[t.referred_by_username].hired += 1;
            }
        });
        const referrerLeaderboard = Object.values(byReferrer).sort((a, b) => b.count - a.count);

        const byDay = {};
        all.forEach(t => {
            const day = new Date(t.created_at).toISOString().slice(0, 10);
            byDay[day] = (byDay[day] || 0) + 1;
        });
        const timeline = Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0])).map(([date, count]) => ({ date, count }));

        const responded = all.filter(t => t.first_response_at);
        const avgResponseMinutes = responded.length
            ? Math.round(responded.reduce((sum, t) => sum + (new Date(t.first_response_at).getTime() - new Date(t.created_at).getTime()), 0) / responded.length / 60000)
            : null;
        const medianResponseMinutes = (() => {
            if (!responded.length) return null;
            const mins = responded.map(t => (new Date(t.first_response_at).getTime() - new Date(t.created_at).getTime()) / 60000).sort((a, b) => a - b);
            const mid = Math.floor(mins.length / 2);
            return Math.round(mins.length % 2 ? mins[mid] : (mins[mid - 1] + mins[mid]) / 2);
        })();

        const closed = all.filter(t => ['accepted', 'rejected', 'withdrawn'].includes(t.status));
        const conversionRate = closed.length ? Math.round((totals.accepted / closed.length) * 1000) / 10 : null;

        const byPosition = {};
        all.forEach(t => {
            const key = t.position && t.position.trim() ? t.position.trim() : 'Not specified';
            byPosition[key] = byPosition[key] || { position: key, applications: 0, accepted: 0 };
            byPosition[key].applications += 1;
            if (t.status === 'accepted') byPosition[key].accepted += 1;
        });
        const positionBreakdown = Object.values(byPosition).sort((a, b) => b.applications - a.applications);

        const now = Date.now();
        const oneDay = 24 * 60 * 60 * 1000;
        const last7 = all.filter(t => now - new Date(t.created_at).getTime() <= 7 * oneDay).length;
        const prev7 = all.filter(t => {
            const age = now - new Date(t.created_at).getTime();
            return age > 7 * oneDay && age <= 14 * oneDay;
        }).length;
        const weekOverWeekChangePct = prev7 > 0 ? Math.round(((last7 - prev7) / prev7) * 1000) / 10 : (last7 > 0 ? 100 : 0);

        res.json({
            ok: true,
            data: {
                totals, staffLeaderboard, referrerLeaderboard, timeline,
                avgResponseMinutes, medianResponseMinutes, conversionRate,
                positionBreakdown, last7, prev7, weekOverWeekChangePct
            }
        });
        return;
    }

    res.status(400).json({ ok: false, error: 'unknown_action' });
});

app.listen(PORT, () => {
    console.log(`HR auth server listening on port ${PORT}`);
});