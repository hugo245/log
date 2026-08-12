const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
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
    'broadcasts.manage'
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
    const auth = req.headers.authorization || '';
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
// they get paid. Requests that are already paid/rejected, or already in
// USD, are left alone.
async function convertPendingRobuxOnMethodChange(robloxUserId, robloxUsername, method) {
    if (method !== 'PAYPAL' && method !== 'VENMO') return;
    try {
        let query = supabase
            .from('payment_requests')
            .select('id, payment, currency, status, paid')
            .eq('currency', 'ROBUX')
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
            const usdAmount = Math.round((Number(row.payment) || 0) * rate * 100) / 100;
            return supabase.from('payment_requests').update({ payment: usdAmount, currency: 'USD' }).eq('id', row.id);
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
        if (role.roblox_group_id != null) {
            const rank = rankByGroupId[role.roblox_group_id];
            if (rank == null) return false;
            if (role.min_rank == null) return true;
            return rank >= role.min_rank;
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
    await supabase.from('user_assignments').upsert({
        roblox_user_id: robloxUserId,
        roblox_username: robloxUsername,
        team_id: link.team_id,
        skillset_id: link.skillset_id,
        source_link_token: link.token,
        assigned_at: new Date().toISOString()
    }, { onConflict: 'roblox_user_id' });
    if (link.role_id) {
        const { error: roleAssignErr } = await supabase.from('user_role_assignments').insert({
            roblox_user_id: robloxUserId,
            role_id: link.role_id,
            roblox_username: robloxUsername
        });
        if (roleAssignErr && roleAssignErr.code !== '23505') throw roleAssignErr;
    }
    await supabase.from('onboarding_links').update({ uses: (link.uses || 0) + 1 }).eq('token', link.token);
    return link;
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
    if (!baseCheck.allowed) { fail('not_eligible'); return; }

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
        let assignByUserId = {};
        let teamNameById = {};
        let skillsetNameById = {};
        if (userIds.length) {
            (sessionRolesRes.data || []).forEach(s => { rolesByUserId[s.roblox_user_id] = s.roles || []; });
            (assignmentsRes.data || []).forEach(a => { assignByUserId[a.roblox_user_id] = a; });

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
            const assign = r.roblox_user_id != null ? assignByUserId[r.roblox_user_id] : null;
            r.requester_team = assign && assign.team_id != null ? (teamNameById[assign.team_id] || null) : null;
            r.requester_skillset = assign && assign.skillset_id != null ? (skillsetNameById[assign.skillset_id] || null) : null;
        });

        res.json({ ok: true, data: rows });
        return;
    }

    if (action === 'mark_paid') {
        if (!requirePermission(res, session, 'dashboard.mark_paid')) return;
        const id = payload.id;
        if (!id) { res.status(400).json({ ok: false, error: 'missing_id' }); return; }
        const { error } = await supabase
            .from('payment_requests')
            .update({ paid: true, paid_at: new Date().toISOString(), status: 'paid', status_note: null })
            .eq('id', id);
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true });
        return;
    }

    if (action === 'reject_request') {
        if (!requirePermission(res, session, 'dashboard.mark_paid')) return;
        const id = payload.id;
        const note = payload.note ? String(payload.note).trim() : '';
        if (!id) { res.status(400).json({ ok: false, error: 'missing_id' }); return; }
        const { error } = await supabase
            .from('payment_requests')
            .update({ paid: false, paid_at: null, status: 'rejected', status_note: note || null })
            .eq('id', id);
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true });
        return;
    }

    if (action === 'reopen_request') {
        if (!requirePermission(res, session, 'dashboard.mark_paid')) return;
        const id = payload.id;
        if (!id) { res.status(400).json({ ok: false, error: 'missing_id' }); return; }
        const { error } = await supabase
            .from('payment_requests')
            .update({ paid: false, paid_at: null, status: 'pending', status_note: null })
            .eq('id', id);
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true });
        return;
    }

    if (action === 'delete_request') {
        if (!requirePermission(res, session, 'dashboard.mark_paid')) return;
        const id = payload.id;
        if (!id) { res.status(400).json({ ok: false, error: 'missing_id' }); return; }
        const { error } = await supabase.from('payment_requests').delete().eq('id', id);
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
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
        const permissions = Array.isArray(payload.permissions) ? payload.permissions.filter(p => PERMISSIONS.includes(p)) : [];
        // A role can't be created at or above the creator's own hierarchy -
        // otherwise someone could hand out a role more senior than themselves.
        if (!requireHigherHierarchy(res, session, hierarchy)) return;
        const { error } = await supabase.from('roles').insert({
            name,
            roblox_group_id: robloxGroupId,
            min_rank: minRank,
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
        // ...and can't promote it to or above your own level either.
        if (!requireHigherHierarchy(res, session, hierarchy)) return;
        const permissions = Array.isArray(payload.permissions) ? payload.permissions.filter(p => PERMISSIONS.includes(p)) : [];
        const update = {
            roblox_group_id: robloxGroupId,
            min_rank: minRank,
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
            const teamAssignByUserId = {}; (teamAssignRes.data || []).forEach(a => { teamAssignByUserId[a.roblox_user_id] = a; });

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
                const ta = row.robloxUserId != null ? teamAssignByUserId[row.robloxUserId] : null;
                if (ta) {
                    row.team = ta.team_id != null ? (teamNameById[ta.team_id] || null) : null;
                    row.skillset = ta.skillset_id != null ? (skillsetNameById[ta.skillset_id] || null) : null;
                }
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
            const { data: ua } = await supabase
                .from('user_assignments')
                .select('team_id')
                .eq('roblox_user_id', session.roblox_user_id)
                .maybeSingle();
            const teamId = ua && ua.team_id != null ? ua.team_id : null;

            const orParts = ["type.eq.global"];
            if (teamId != null) orParts.push(`and(type.eq.team,team_id.eq.${teamId})`);

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
        try {
            const { data: ua } = await supabase.from('user_assignments').select('*').eq('roblox_user_id', session.roblox_user_id).maybeSingle();
            if (!ua) { res.json({ ok: true, data: null }); return; }
            let team = null, skillset = null;
            if (ua.team_id) { const { data } = await supabase.from('teams').select('*').eq('id', ua.team_id).maybeSingle(); team = data || null; }
            if (ua.skillset_id) { const { data } = await supabase.from('skillsets').select('*').eq('id', ua.skillset_id).maybeSingle(); skillset = data || null; }
            res.json({ ok: true, data: { team, skillset } });
        } catch (e) {
            res.status(500).json({ ok: false, error: 'Could not load your team assignment.' });
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
        if (!requirePermission(res, session, 'settings.manage_onboarding')) return;
        const robloxUserId = Number(payload.robloxUserId);
        if (!robloxUserId) { res.status(400).json({ ok: false, error: 'missing_user_id' }); return; }
        const teamId = payload.teamId === '' || payload.teamId == null ? null : Number(payload.teamId);
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
        }, { onConflict: 'roblox_user_id' });
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
        // Can't warn (or, via the 3-warning auto-ban, effectively ban) staff
        // whose own role sits at or above the moderator's hierarchy level.
        const targetHierarchy = await getUserHierarchy(robloxUserId);
        if (!requireHigherHierarchy(res, session, targetHierarchy)) return;
        let username = payload.robloxUsername ? String(payload.robloxUsername).trim() : null;
        if (!username) {
            const lookupRes = await fetch(`https://users.roblox.com/v1/users/${robloxUserId}`);
            if (lookupRes.ok) username = (await lookupRes.json()).name;
        }
        const { error } = await supabase.from('staff_warnings').insert({
            roblox_user_id: robloxUserId,
            roblox_username: username,
            reason,
            warned_by: session.roblox_username,
            created_at: new Date().toISOString()
        });
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
        }
        res.json({ ok: true, warnCount: count, banned });
        return;
    }

    if (action === 'unban_user') {
        if (!requirePermission(res, session, 'staff.moderate')) return;
        const robloxUserId = Number(payload.robloxUserId);
        if (!robloxUserId) { res.status(400).json({ ok: false, error: 'missing_user_id' }); return; }
        const targetHierarchy = await getUserHierarchy(robloxUserId);
        if (!requireHigherHierarchy(res, session, targetHierarchy)) return;
        await supabase.from('banned_users').delete().eq('roblox_user_id', robloxUserId);
        res.json({ ok: true });
        return;
    }

    res.status(400).json({ ok: false, error: 'unknown_action' });
});

app.listen(PORT, () => {
    console.log(`HR auth server listening on port ${PORT}`);
});