const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const zlib = require('zlib');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const PORT = process.env.PORT || 3000;
const APP_ORIGIN = process.env.APP_ORIGIN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ROBLOX_CLIENT_ID = process.env.ROBLOX_CLIENT_ID;
const ROBLOX_CLIENT_SECRET = process.env.ROBLOX_CLIENT_SECRET;
const ROBLOX_REDIRECT_URI = process.env.ROBLOX_REDIRECT_URI;
const SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000;
const STATE_LIFETIME_MS = 10 * 60 * 1000;
const ACCESS_SYNC_INTERVAL_MS = 10 * 60 * 1000;

// --- Recruitment system (Discord OAuth + tickets) ---------------------------
// Optional: the app boots fine without these, but the recruitment flow and
// Discord notifications are disabled until they're set.
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_NOTIFY_CHANNEL_ID = process.env.DISCORD_NOTIFY_CHANNEL_ID;
const RECRUIT_SESSION_LIFETIME_MS = 30 * 60 * 1000;
const DISCORD_CONFIGURED = !!(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET && DISCORD_REDIRECT_URI);
if (!DISCORD_CONFIGURED) {
    console.warn('Discord recruitment OAuth is not configured (DISCORD_CLIENT_ID/SECRET/REDIRECT_URI missing) - the recruitment flow will be disabled until it is.');
}
if (!DISCORD_BOT_TOKEN || !DISCORD_NOTIFY_CHANNEL_ID) {
    console.warn('DISCORD_BOT_TOKEN/DISCORD_NOTIFY_CHANNEL_ID not set - new recruitment tickets will not be posted to Discord.');
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

app.use(express.json());

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

// ---------------------------------------------------------------------------
// Recruitment: recruit sessions, Discord link helpers, Discord notifications
// ---------------------------------------------------------------------------

// Looks up the short-lived "applicant" identity created when someone signs in
// with Roblox but isn't eligible for the HR tool yet. Deliberately not the
// same table/shape as hr_sessions - it carries no roles or permissions.
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
    const { error } = await supabase.from('recruit_sessions').insert({
        token, roblox_user_id: robloxUserId, roblox_username: robloxUsername, expires_at: expiresAt
    });
    if (error) throw new Error(error.message);
    return token;
}

// Everyone currently holding a role that grants recruitment.respond - this is
// the "signed up with recruitment role" list used for the referred-by picker
// and for per-staff analytics. Sourced from manual role assignments, since
// that's an explicit opt-in rather than an incidental group rank.
async function listRecruiters() {
    const { data: roles, error: rolesErr } = await supabase.from('roles').select('id, name, permissions');
    if (rolesErr) throw new Error(rolesErr.message);
    const recruiterRoleIds = (roles || [])
        .filter(r => Array.isArray(r.permissions) && r.permissions.includes('recruitment.respond'))
        .map(r => r.id);
    if (!recruiterRoleIds.length) return [];
    const { data: assignments, error: assignErr } = await supabase
        .from('user_role_assignments')
        .select('roblox_user_id, roblox_username')
        .in('role_id', recruiterRoleIds);
    if (assignErr) throw new Error(assignErr.message);
    const byId = new Map();
    (assignments || []).forEach(a => { if (!byId.has(a.roblox_user_id)) byId.set(a.roblox_user_id, a.roblox_username); });
    return [...byId.entries()].map(([robloxUserId, robloxUsername]) => ({ robloxUserId, robloxUsername }))
        .sort((a, b) => a.robloxUsername.localeCompare(b.robloxUsername));
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

// Posts an embed to the notify channel when a new ticket comes in. Best
// effort - a Discord outage should never block someone's application from
// being saved.
async function notifyDiscordNewTicket(ticket) {
    if (!DISCORD_BOT_TOKEN || !DISCORD_NOTIFY_CHANNEL_ID) return;
    try {
        await discordApi(`/channels/${DISCORD_NOTIFY_CHANNEL_ID}/messages`, {
            method: 'POST',
            body: JSON.stringify({
                embeds: [{
                    title: 'New recruitment application',
                    color: 0x3730D9,
                    fields: [
                        { name: 'Roblox', value: ticket.roblox_username, inline: true },
                        { name: 'Discord', value: `<@${ticket.discord_user_id}>`, inline: true },
                        { name: 'Position', value: ticket.position || 'Not specified', inline: true },
                        { name: 'Referred by', value: ticket.referred_by_username || 'None', inline: true },
                        { name: 'Why they want to join', value: (ticket.why_join || '').slice(0, 500) || 'N/A' }
                    ],
                    footer: { text: `Ticket ${ticket.id}` },
                    timestamp: new Date().toISOString()
                }],
                // These custom_ids are handled by the companion discord-bot -
                // see discord-bot/index.js. The dashboard link always works
                // even if the bot is offline.
                components: [{
                    type: 1,
                    components: [
                        { type: 2, style: 3, label: 'Accept', custom_id: `recruit_accept_${ticket.id}` },
                        { type: 2, style: 4, label: 'Reject', custom_id: `recruit_reject_${ticket.id}` },
                        { type: 2, style: 2, label: 'Claim', custom_id: `recruit_claim_${ticket.id}` },
                        { type: 2, style: 5, label: 'Open dashboard', url: `${APP_ORIGIN}/#/recruitment` }
                    ]
                }]
            })
        });
    } catch (e) {
        console.error('notifyDiscordNewTicket failed:', e.message);
    }
}

async function notifyDiscordStatusChange(ticket, newStatus, byUsername) {
    if (!DISCORD_BOT_TOKEN || !DISCORD_NOTIFY_CHANNEL_ID) return;
    try {
        await discordApi(`/channels/${DISCORD_NOTIFY_CHANNEL_ID}/messages`, {
            method: 'POST',
            body: JSON.stringify({
                content: `**${ticket.roblox_username}**'s application was marked **${newStatus}** by ${byUsername}. <@${ticket.discord_user_id}>`
            })
        });
    } catch (e) {
        console.error('notifyDiscordStatusChange failed:', e.message);
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

async function getBaseAccessConfig() {
    const { data, error } = await supabase
        .from('app_settings')
        .select('base_group_id, base_min_rank')
        .eq('id', 1)
        .maybeSingle();
    if (error) throw error;
    return {
        groupId: data && data.base_group_id != null ? Number(data.base_group_id) : null,
        minRank: data && data.base_min_rank != null ? Number(data.base_min_rank) : null
    };
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

// When someone sets their payout method to PayPal or Venmo, any of their
// still-pending Robux requests can't actually be paid out that way, so we
// convert them to a USD amount (using the current DevEx rate) automatically
// instead of leaving them stuck in a currency that no longer matches how
// they get paid. Symmetrically, if they switch back to the Robux/DevEx
// payout method, any still-pending USD requests get converted back to
// Robux. Requests that are already paid/rejected, or already in the
// matching currency, are left alone.
async function convertPendingRobuxOnMethodChange(robloxUserId, robloxUsername, method) {
    let fromCurrency, toCurrency;
    if (method === 'PAYPAL' || method === 'VENMO') {
        fromCurrency = 'ROBUX'; toCurrency = 'USD';
    } else if (method === 'DEVEX_ROBUX') {
        fromCurrency = 'USD'; toCurrency = 'ROBUX';
    } else {
        return;
    }
    try {
        let query = supabase
            .from('payment_requests')
            .select('id, payment, currency, status, paid')
            .eq('currency', fromCurrency)
            .eq('paid', false);
        if (robloxUserId != null) {
            query = query.eq('roblox_user_id', robloxUserId);
        } else if (robloxUsername) {
            query = query.is('roblox_user_id', null).ilike('roblox_username', robloxUsername);
        } else {
            return;
        }
        const { data: rows, error } = await query;
        if (error || !rows || !rows.length) return;

        const pendingRows = rows.filter(r => (r.status || 'pending') === 'pending');
        if (!pendingRows.length) return;

        const rate = await getDevexRate();
        if (!(rate > 0)) return;

        await Promise.all(pendingRows.map(row => {
            const amount = toCurrency === 'USD'
                ? Math.round((Number(row.payment) || 0) * rate * 100) / 100
                : Math.round((Number(row.payment) || 0) / rate);
            return supabase.from('payment_requests').update({ payment: amount, currency: toCurrency }).eq('id', row.id);
        }));
    } catch (e) {
        // Best-effort - if this fails, the payment method itself was still saved successfully.
    }
}

// Sweep for any pending Robux request whose owner's *currently saved*
// payment method is PayPal or Venmo, and convert it to USD. This catches
// cases the point-in-time conversion (above) can miss - e.g. a request
// logged before the person ever set a payment method, or a method that
// was set through a path that predates this feature. Called on every
// dashboard/"My payments" load so it self-heals over time.
async function convertPendingRobuxForCashMethodUsers(filter) {
    try {
        let query = supabase
            .from('payment_requests')
            .select('id, roblox_user_id, roblox_username, payment, currency, status, paid')
            .eq('currency', 'ROBUX')
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

        const toConvert = pendingRows.filter(r => {
            const method = (r.roblox_user_id != null ? methodByUserId[r.roblox_user_id] : null)
                || (r.roblox_username ? methodByUsername[(r.roblox_username || '').toLowerCase()] : null);
            return method === 'PAYPAL' || method === 'VENMO';
        });
        if (!toConvert.length) return;

        const rate = await getDevexRate();
        if (!(rate > 0)) return;

        await Promise.all(toConvert.map(row => {
            const usdAmount = Math.round((Number(row.payment) || 0) * rate * 100) / 100;
            return supabase.from('payment_requests').update({ payment: usdAmount, currency: 'USD' }).eq('id', row.id);
        }));
    } catch (e) {
        // Best-effort - a failure here shouldn't block loading the requests.
    }
}

async function checkBaseAccess(robloxUserId) {
    const base = await getBaseAccessConfig();
    if (!base.groupId) return { allowed: true, base };

    // A manual role assignment overrides the base group/rank requirement,
    // same as it does in computeAccess().
    const { data: manualRows, error: manualErr } = await supabase
        .from('user_role_assignments')
        .select('id')
        .eq('roblox_user_id', robloxUserId)
        .limit(1);
    if (manualErr) throw manualErr;
    if (manualRows && manualRows.length > 0) return { allowed: true, base };

    const groupRoles = await fetchRobloxGroupRoles(robloxUserId);
    const membership = groupRoles.find(g => g.group && g.group.id === base.groupId);
    if (!membership) return { allowed: false, base };
    if (base.minRank != null && membership.role.rank < base.minRank) return { allowed: false, base };
    return { allowed: true, base };
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
        // Link-only roles never auto-grant off group rank. They can only be
        // picked up through a manual assignment, which includes claiming an
        // onboarding link. min_rank still applies at claim time as a
        // safeguard, but it does not grant the role on its own.
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

    // The highest hierarchy value among a user's matched roles. This is used to
    // gate "configure" and "moderate" actions so someone can only manage roles,
    // role assignments, or staff (warn/ban) that sit strictly below their own
    // level - never at or above it.
    const maxHierarchy = matchedRoles.reduce((max, role) => Math.max(max, Number(role.hierarchy) || 0), 0);

    return {
        roleNames: matchedRoles.map(r => r.name),
        permissions: Array.from(permissionSet),
        maxHierarchy
    };
}

// Hierarchy level (0 if none) of a specific Roblox user, based on the roles
// they currently qualify for (manual assignment or group rank).
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

    // Onboarding must be fully completed - this includes accepting the
    // Terms of Service and Acceptable Use Policy, which are required steps.
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

    // A payment method must be on file so a payout can actually be sent.
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

async function claimOnboardingLink(robloxUserId, robloxUsername, token) {
    if (!token) return null;
    const { data: link } = await supabase.from('onboarding_links').select('*').eq('token', token).maybeSingle();
    if (!link) return null;
    // Each row is one team membership for this user, keyed on (roblox_user_id,
    // team_id), so claiming a link for a new team adds to their existing
    // teams instead of replacing them. Re-claiming a link for a team they're
    // already on just refreshes the skillset/source on that same row.
    await supabase.from('user_assignments').upsert({
        roblox_user_id: robloxUserId,
        roblox_username: robloxUsername,
        team_id: link.team_id,
        skillset_id: link.skillset_id,
        source_link_token: link.token,
        assigned_at: new Date().toISOString()
    }, { onConflict: 'roblox_user_id,team_id' });
    if (link.role_id) {
        const { data: role, error: roleErr } = await supabase.from('roles').select('*').eq('id', link.role_id).maybeSingle();
        if (roleErr) throw roleErr;
        // For a link-only role, min_rank is a safeguard on the link itself:
        // the person still has to actually be at that exact rank before the
        // link can hand out the role. It never grants the role on its own
        // at login, only here at claim time, and only on an exact match.
        let meetsRankSafeguard = true;
        if (role && role.link_only && role.min_rank != null && role.roblox_group_id != null) {
            const groupRoles = await fetchRobloxGroupRoles(robloxUserId);
            const membership = groupRoles.find(g => g.group && g.group.id === role.roblox_group_id);
            const rank = membership ? membership.role.rank : null;
            meetsRankSafeguard = rank != null && rank === role.min_rank;
        }
        if (role && meetsRankSafeguard) {
            const { error: roleAssignErr } = await supabase.from('user_role_assignments').insert({
                roblox_user_id: robloxUserId,
                role_id: link.role_id,
                roblox_username: robloxUsername
            });
            if (roleAssignErr && roleAssignErr.code !== '23505') throw roleAssignErr;
        }
    }
    await supabase.from('onboarding_links').update({ uses: (link.uses || 0) + 1 }).eq('token', link.token);
    return link;
}

// Every team a given user belongs to, with the team and skillset details
// resolved. Replaces the old "single assignment" model - a user can now be
// on any number of teams at once.
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

// Ensures the acting session's hierarchy is strictly higher than the
// hierarchy of whatever they're trying to configure or moderate (a role, a
// role assignment, or another staff member). Equal or lower hierarchy is
// rejected, so a role can never be used to manage itself or anything above it.
function requireHigherHierarchy(res, session, targetHierarchy) {
    const actorHierarchy = Number(session && session.max_hierarchy) || 0;
    if (actorHierarchy > (Number(targetHierarchy) || 0)) return true;
    res.status(403).json({ ok: false, error: 'insufficient_hierarchy' });
    return false;
}

// ---------------------------------------------------------------------------
// Audit log
//
// Every meaningful write (payments, moderation, backups) is recorded to the
// `audit_logs` table. `revert` (when provided) describes how to undo the
// action - it's interpreted by revertAuditLog() below. Logging is
// best-effort: a logging failure never blocks the underlying action.
//
// Expected schema (create in Supabase):
//   create table audit_logs (
//     id uuid primary key default gen_random_uuid(),
//     category text not null,           -- 'payments' | 'moderation' | 'backups'
//     action text not null,             -- e.g. 'mark_paid', 'add_user_warning'
//     actor_user_id bigint,
//     actor_username text,
//     target_user_id bigint,
//     target_username text,
//     details jsonb,
//     revert_data jsonb,
//     reverted boolean not null default false,
//     reverted_by text,
//     reverted_at timestamptz,
//     created_at timestamptz not null default now()
//   );
// ---------------------------------------------------------------------------
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

// Applies the inverse of a previously logged action. Returns { ok, error? }.
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

// ---------------------------------------------------------------------------
// Backups
//
// Expected schema (create in Supabase):
//   create table backups (
//     id uuid primary key default gen_random_uuid(),
//     created_by text,
//     trigger text not null,           -- 'manual' | 'scheduled'
//     tables jsonb,
//     row_counts jsonb,
//     size_bytes integer,
//     data_gz text,                    -- gzip+base64 compact JSON dump
//     created_at timestamptz not null default now()
//   );
// ---------------------------------------------------------------------------
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

// Runs a scheduled backup every 6 hours. A first scheduled backup runs
// shortly after startup so a recent snapshot always exists.
const BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
setTimeout(() => {
    runBackup('scheduled', 'system').catch(e => console.error('scheduled backup failed:', e.message));
}, 60 * 1000);
setInterval(() => {
    runBackup('scheduled', 'system').catch(e => console.error('scheduled backup failed:', e.message));
}, BACKUP_INTERVAL_MS);

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
        // Not eligible for the HR tool itself - instead of a dead end, hand
        // them a short-lived recruit session and send them to the
        // recruitment gate, where the frontend offers to start an
        // application (which then also requires linking Discord).
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

    if (stateRow.ref_token) {
        try { await claimOnboardingLink(robloxUserId, robloxUsername, stateRow.ref_token); } catch (e) { }
    }

    res.redirect(`${APP_ORIGIN}/#/auth-callback?session=${encodeURIComponent(token)}`);
});

// ---------------------------------------------------------------------------
// Recruitment: recruit-session lookup + Discord OAuth
// ---------------------------------------------------------------------------

app.get('/recruit-session', async (req, res) => {
    const session = await getRecruitSession(req);
    if (!session) { res.status(401).json({ ok: false, error: 'not_found_or_expired' }); return; }
    res.json({
        ok: true,
        robloxUserId: session.roblox_user_id,
        robloxUsername: session.roblox_username,
        discordLinked: !!session.discord_user_id,
        discordUsername: session.discord_username || null,
        discordConfigured: DISCORD_CONFIGURED
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
    res.redirect(authorizeUrl.toString());
});

app.get('/discord-auth-callback', async (req, res) => {
    const code = req.query.code;
    const state = req.query.state;

    function fail(rt, reason) {
        res.redirect(`${APP_ORIGIN}/#/recruit/apply?rt=${encodeURIComponent(rt || '')}&error=${encodeURIComponent(reason)}`);
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
    if (!tokenRes.ok) { fail(stateRow.rt, 'token_exchange_failed'); return; }
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

    await supabase.from('recruit_sessions').update({
        discord_user_id: discordUserId,
        discord_username: discordUsername,
        discord_avatar: discordAvatar
    }).eq('token', recruitSession.token);

    res.redirect(`${APP_ORIGIN}/#/recruit/apply?rt=${encodeURIComponent(recruitSession.token)}`);
});

// Ticket submission - requires a recruit session with Discord already linked.
// Intentionally not gated by any hr permission: the whole point is that the
// applicant doesn't have HR access yet.
app.post('/recruitment/apply', async (req, res) => {
    const recruitSession = await getRecruitSession(req);
    if (!recruitSession) { res.status(401).json({ ok: false, error: 'session_expired' }); return; }
    if (!recruitSession.discord_user_id) { res.status(400).json({ ok: false, error: 'discord_not_linked' }); return; }

    try {
        if (await isUserBanned(recruitSession.roblox_user_id)) { res.status(403).json({ ok: false, error: 'account_banned' }); return; }
    } catch (e) { }

    const body = req.body || {};
    const experience = body.experience ? String(body.experience).trim() : '';
    const whyJoin = body.whyJoin ? String(body.whyJoin).trim() : '';
    const portfolioUrl = body.portfolioUrl ? String(body.portfolioUrl).trim() : null;
    const position = body.position ? String(body.position).trim() : null;
    const referredByUserId = body.referredByUserId != null && body.referredByUserId !== '' ? Number(body.referredByUserId) : null;

    if (!experience) { res.status(400).json({ ok: false, error: 'missing_experience' }); return; }
    if (!whyJoin) { res.status(400).json({ ok: false, error: 'missing_why_join' }); return; }

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
        const match = recruiters.find(r => r.robloxUserId === referredByUserId);
        if (match) referredByUsername = match.robloxUsername;
    }

    // Keep a standing Discord<->Roblox link for this person too - useful once
    // they're hired and become staff.
    await supabase.from('discord_links').upsert({
        roblox_user_id: recruitSession.roblox_user_id,
        roblox_username: recruitSession.roblox_username,
        discord_user_id: recruitSession.discord_user_id,
        discord_username: recruitSession.discord_username,
        discord_avatar: recruitSession.discord_avatar,
        linked_at: new Date().toISOString()
    }, { onConflict: 'roblox_user_id' });

    const { data: ticket, error } = await supabase.from('recruitment_tickets').insert({
        roblox_user_id: recruitSession.roblox_user_id,
        roblox_username: recruitSession.roblox_username,
        discord_user_id: recruitSession.discord_user_id,
        discord_username: recruitSession.discord_username,
        portfolio_url: portfolioUrl,
        experience,
        why_join: whyJoin,
        position,
        referred_by_user_id: referredByUserId,
        referred_by_username: referredByUsername,
        status: 'pending'
    }).select('*').maybeSingle();

    if (error) { res.status(500).json({ ok: false, error: error.message }); return; }

    notifyDiscordNewTicket(ticket);
    res.json({ ok: true, data: { id: ticket.id } });
});

// Public (no auth) - just names, used to populate the "who referred you?"
// select on the application form itself.
app.get('/recruitment/recruiters', async (req, res) => {
    try {
        const recruiters = await listRecruiters();
        res.json({ ok: true, data: recruiters });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
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
    res.json({
        ok: true,
        robloxUserId: session.roblox_user_id,
        robloxUsername: session.roblox_username,
        roles: session.roles || [],
        permissions: session.permissions || [],
        maxHierarchy: session.max_hierarchy || 0
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

        const id = generateRequestId();

        const { error } = await supabase.from('payment_requests').insert({
            id,
            requested_by: session.roblox_username,
            roblox_username: robloxUsername,
            roblox_user_id: recipientUserId,
            task_name: taskName,
            game,
            work_raw: workRaw,
            time_worked: timeWorked,
            payment,
            currency,
            paid: false,
            paid_at: null,
            created_at: new Date().toISOString()
        });

        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        logAudit(session, {
            category: 'payments', action: 'submit_request',
            targetUserId: recipientUserId, targetUsername: robloxUsername,
            details: { id, taskName, game, payment, currency },
            revert: { type: 'delete_payment_request', id }
        });
        res.json({ ok: true, id });
        return;
    }

    if (action === 'list_requests') {
        if (!requirePermission(res, session, 'dashboard.view')) return;
        await convertPendingRobuxForCashMethodUsers();
        const { data, error } = await supabase
            .from('payment_requests')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }

        const rows = data || [];
        const userIds = [...new Set(rows.filter(r => r.roblox_user_id != null).map(r => r.roblox_user_id))];
        const usernames = [...new Set(rows.filter(r => r.roblox_user_id == null && r.roblox_username).map(r => r.roblox_username))];

        // All four of these only depend on userIds/usernames (already known),
        // not on each other, so fetch them together instead of waterfalling.
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
            // A requester can belong to several teams now, so join their team
            // names/skillset names together rather than picking just one.
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
        // Same "match by user id, fall back to username" pattern used
        // elsewhere - a person can have some older requests logged before
        // they had a roblox_user_id on file, or under a since-changed
        // username, so matching on username alone would miss those.
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
        await Promise.all([
            convertPendingRobuxForCashMethodUsers({ robloxUserId: session.roblox_user_id }),
            convertPendingRobuxForCashMethodUsers({ robloxUsername: session.roblox_username })
        ]);

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
        // Lets staff manually put a payment method on file for someone else,
        // e.g. when the person can't or hasn't added their own yet.
        if (!requirePermission(res, session, 'staff.moderate')) return;
        const robloxUserId = Number(payload.robloxUserId);
        if (!robloxUserId) { res.status(400).json({ ok: false, error: 'missing_user_id' }); return; }

        const method = payload.method;
        const details = payload.details && typeof payload.details === 'object' ? payload.details : {};
        const methodDef = PAYMENT_METHOD_TYPES[method];
        if (!methodDef) { res.status(400).json({ ok: false, error: 'invalid_method' }); return; }
        const missing = methodDef.fields.find(f => !String(details[f] || '').trim());
        if (missing) { res.status(400).json({ ok: false, error: 'missing_field' }); return; }

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
        await convertPendingRobuxOnMethodChange(robloxUserId, username, method);
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
        await convertPendingRobuxOnMethodChange(session.roblox_user_id, session.roblox_username, method);
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

            // When "Ignore Eligibility for All Requests" is enabled, requests can be
            // submitted regardless of group membership, onboarding/ToS status, or
            // payment method on file. The real underlying status stays in each entry
            // (isMember/metaLabel) for transparency, but `eligible` is forced true so
            // the submit flow does not block on it.
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

    if (action === 'get_base_access') {
        try {
            const base = await getBaseAccessConfig();
            res.json({ ok: true, data: base });
        } catch (e) {
            res.status(500).json({ ok: false, error: 'Could not load the sign-in access requirement.' });
        }
        return;
    }

    if (action === 'save_base_access') {
        if (!requirePermission(res, session, 'settings.manage_base_access')) return;
        const groupId = payload.groupId === '' || payload.groupId == null ? null : Number(payload.groupId);
        const minRank = payload.minRank === '' || payload.minRank == null ? null : Number(payload.minRank);
        if (groupId != null && !(groupId > 0)) { res.status(400).json({ ok: false, error: 'invalid_group_id' }); return; }
        const { error } = await supabase
            .from('app_settings')
            .upsert({ id: 1, base_group_id: groupId, base_min_rank: minRank, updated_at: new Date().toISOString() });
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
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
        // A role can't be created at or above the creator's own hierarchy -
        // otherwise someone could hand out a role more senior than themselves.
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
        // Can't edit a role that's already at or above your own level...
        if (!requireHigherHierarchy(res, session, existingRole.hierarchy)) return;
        const name = payload.name != null ? String(payload.name).trim() : null;
        if (payload.name != null && !name) { res.status(400).json({ ok: false, error: 'missing_name' }); return; }
        const robloxGroupId = payload.robloxGroupId === '' || payload.robloxGroupId == null ? null : Number(payload.robloxGroupId);
        const minRank = payload.minRank === '' || payload.minRank == null ? null : Number(payload.minRank);
        const hierarchy = payload.hierarchy === '' || payload.hierarchy == null ? 0 : Number(payload.hierarchy);
        const linkOnly = !!payload.linkOnly;
        // ...and can't promote it to or above your own level either.
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
        // Can't hand out a role that's at or above your own level.
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
        // Can't revoke a role assignment that's at or above your own level either -
        // otherwise a lower role could strip a higher one from someone else.
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

            // Used by the client to grey out warn/ban/assign actions against staff
            // whose highest role sits at or above the viewer's own hierarchy level.
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
                // Kept for backward compatibility with anything still reading
                // a single team/skillset off a staff row (e.g. quick display).
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

    // ---- Teams & skillsets (onboarding customization) ----

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
            const link = await claimOnboardingLink(session.roblox_user_id, session.roblox_username, token);
            if (!link) { res.status(404).json({ ok: false, error: 'link_not_found' }); return; }
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ ok: false, error: 'Could not apply that invite link.' });
        }
        return;
    }

    if (action === 'get_my_assignment') {
        // Returns an array now - a user can be on any number of teams, each
        // with its own skillset, instead of just one.
        try {
            const assignments = await getUserTeamAssignments(session.roblox_user_id);
            res.json({ ok: true, data: assignments });
        } catch (e) {
            res.status(500).json({ ok: false, error: 'Could not load your team assignments.' });
        }
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
        // Adds (or updates the skillset on) one team membership for the
        // user. Since a user can now be on multiple teams at once, this no
        // longer touches their other team memberships - it only ever
        // upserts the single (user, team) row identified by teamId.
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
        // Can't warn (or, via the 3-warning auto-ban, effectively ban) staff
        // whose own role sits at or above the moderator's hierarchy level.
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

    // -----------------------------------------------------------------------
    // Audit logs
    // -----------------------------------------------------------------------
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

    // -----------------------------------------------------------------------
    // Backups
    // -----------------------------------------------------------------------
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
        if (!requirePermission(res, session, 'roles.manage')) return; // extra guard: destructive action
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

        // Restore is an additive upsert per table (matched on primary key) -
        // it never deletes rows that exist now but weren't in the backup,
        // to avoid silently wiping newer data.
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

    // -----------------------------------------------------------------------
    // Recruitment (staff side - everything here requires an hr_session)
    // -----------------------------------------------------------------------
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
        const [{ data: ticket, error: ticketErr }, { data: messages, error: msgErr }] = await Promise.all([
            supabase.from('recruitment_tickets').select('*').eq('id', id).maybeSingle(),
            supabase.from('recruitment_messages').select('*').eq('ticket_id', id).order('created_at', { ascending: true })
        ]);
        if (ticketErr) { res.status(500).json({ ok: false, error: ticketErr.message }); return; }
        if (!ticket) { res.status(404).json({ ok: false, error: 'ticket_not_found' }); return; }
        if (msgErr) { res.status(500).json({ ok: false, error: msgErr.message }); return; }
        res.json({ ok: true, data: { ticket, messages: messages || [] } });
        return;
    }

    if (action === 'recruitment_add_message') {
        if (!requirePermission(res, session, 'recruitment.respond')) return;
        const id = payload.id;
        const body = payload.body ? String(payload.body).trim() : '';
        if (!id) { res.status(400).json({ ok: false, error: 'missing_id' }); return; }
        if (!body) { res.status(400).json({ ok: false, error: 'missing_body' }); return; }

        const { data: ticket, error: ticketErr } = await supabase.from('recruitment_tickets').select('*').eq('id', id).maybeSingle();
        if (ticketErr) { res.status(500).json({ ok: false, error: ticketErr.message }); return; }
        if (!ticket) { res.status(404).json({ ok: false, error: 'ticket_not_found' }); return; }

        const { error: msgErr } = await supabase.from('recruitment_messages').insert({
            ticket_id: id,
            author_type: 'staff',
            author_user_id: session.roblox_user_id,
            author_username: session.roblox_username,
            body,
            internal_note: !!payload.internalNote
        });
        if (msgErr) { res.status(500).json({ ok: false, error: msgErr.message }); return; }

        // First staff reply on a ticket sets the response-time clock used by
        // analytics; later replies don't move it.
        const updates = { updated_at: new Date().toISOString() };
        if (!ticket.first_response_at) {
            updates.first_response_at = new Date().toISOString();
            updates.first_response_by_username = session.roblox_username;
        }
        await supabase.from('recruitment_tickets').update(updates).eq('id', id);

        logAudit(session, { category: 'recruitment', action: 'message', targetUserId: ticket.roblox_user_id, targetUsername: ticket.roblox_username, details: { ticketId: id } });
        res.json({ ok: true });
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
            updates.close_reason = reason;
        } else {
            updates.closed_at = null; updates.closed_by_username = null; updates.close_reason = null;
        }

        const { error: updateErr } = await supabase.from('recruitment_tickets').update(updates).eq('id', id);
        if (updateErr) { res.status(500).json({ ok: false, error: updateErr.message }); return; }

        if (reason) {
            await supabase.from('recruitment_messages').insert({
                ticket_id: id, author_type: 'staff', author_user_id: session.roblox_user_id,
                author_username: session.roblox_username, body: reason, internal_note: true
            });
        }

        logAudit(session, {
            category: 'recruitment', action: 'status_change',
            targetUserId: ticket.roblox_user_id, targetUsername: ticket.roblox_username,
            details: { ticketId: id, from: ticket.status, to: status }
        });
        notifyDiscordStatusChange({ ...ticket, status }, status, session.roblox_username);
        res.json({ ok: true });
        return;
    }

    if (action === 'recruitment_assign') {
        if (!requirePermission(res, session, 'recruitment.manage')) return;
        const id = payload.id;
        if (!id) { res.status(400).json({ ok: false, error: 'missing_id' }); return; }
        const assignToUserId = payload.assignToUserId != null ? Number(payload.assignToUserId) : null;
        const assignToUsername = payload.assignToUsername ? String(payload.assignToUsername) : null;
        const { error } = await supabase.from('recruitment_tickets').update({
            assigned_to_user_id: assignToUserId,
            assigned_to_username: assignToUsername,
            updated_at: new Date().toISOString()
        }).eq('id', id);
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true });
        return;
    }

    // Analytics: response leaderboard per staff member, funnel totals, and a
    // simple time series of applications received per day.
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
                byReferrer[t.referred_by_username] = (byReferrer[t.referred_by_username] || 0) + 1;
            }
        });
        const referrerLeaderboard = Object.entries(byReferrer).map(([username, count]) => ({ username, count })).sort((a, b) => b.count - a.count);

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

        res.json({ ok: true, data: { totals, staffLeaderboard, referrerLeaderboard, timeline, avgResponseMinutes } });
        return;
    }

    res.status(400).json({ ok: false, error: 'unknown_action' });
});

app.listen(PORT, () => {
    console.log(`HR auth server listening on port ${PORT}`);
});