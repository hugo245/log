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
    'roles.manage'
];

const PAYMENT_METHOD_TYPES = {
    PAYPAL: { fields: ['paypalEmail'] },
    DEVEX_ROBUX: { fields: ['robloxUsername'] },
    VENMO: { fields: ['venmoUsername'] }
};

const app = express();
app.use(express.json());
app.use(cors({
    origin: APP_ORIGIN,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'ngrok-skip-browser-warning']
}));

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

async function checkBaseAccess(robloxUserId) {
    const base = await getBaseAccessConfig();
    if (!base.groupId) return { allowed: true, base };

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

    return {
        roleNames: matchedRoles.map(r => r.name),
        permissions: Array.from(permissionSet)
    };
}

async function computeGroupEligibility(robloxUserId) {
    const { data: requiredGroups, error: groupsErr } = await supabase
        .from('required_groups')
        .select('*')
        .order('name', { ascending: true });
    if (groupsErr) throw groupsErr;
    if (!requiredGroups || requiredGroups.length === 0) return [];

    const memberships = await fetchRobloxGroupRoles(robloxUserId);
    const groupIdsJoined = new Set(memberships.map(m => String(m.group.id)));

    const results = [];
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

    return results;
}

function hasPermission(session, permission) {
    return !!session && Array.isArray(session.permissions) && session.permissions.includes(permission);
}

function requirePermission(res, session, permission) {
    if (hasPermission(session, permission)) return true;
    res.status(403).json({ ok: false, error: 'missing_permission' });
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
                last_synced_at: new Date().toISOString()
            };
            await supabase.from('hr_sessions').update({
                roles: updated.roles,
                permissions: updated.permissions,
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

    const { error } = await supabase.from('oauth_states').insert({
        state,
        code_verifier: codeVerifier
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
        last_synced_at: new Date().toISOString(),
        expires_at: expiresAt
    });

    if (sessionErr) { fail('session_create_failed'); return; }

    res.redirect(`${APP_ORIGIN}/#/auth-callback?session=${encodeURIComponent(token)}`);
});

app.get('/hr-session', async (req, res) => {
    const session = await getSession(req);
    if (!session) { res.status(401).json({ ok: false }); return; }
    res.json({
        ok: true,
        robloxUserId: session.roblox_user_id,
        robloxUsername: session.roblox_username,
        roles: session.roles || [],
        permissions: session.permissions || []
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
        const { data, error } = await supabase
            .from('payment_requests')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }

        const rows = data || [];
        const userIds = [...new Set(rows.filter(r => r.roblox_user_id != null).map(r => r.roblox_user_id))];
        const usernames = [...new Set(rows.filter(r => r.roblox_user_id == null && r.roblox_username).map(r => r.roblox_username))];

        let methodRows = [];
        if (userIds.length) {
            const { data: byId } = await supabase.from('payment_methods').select('*').in('roblox_user_id', userIds);
            methodRows = methodRows.concat(byId || []);
        }
        if (usernames.length) {
            const { data: byUsername } = await supabase.from('payment_methods').select('*').in('roblox_username', usernames);
            methodRows = methodRows.concat(byUsername || []);
        }

        const methodByUserId = {};
        const methodByUsername = {};
        methodRows.forEach(m => {
            methodByUserId[m.roblox_user_id] = m;
            if (m.roblox_username) methodByUsername[m.roblox_username.toLowerCase()] = m;
        });

        rows.forEach(r => {
            const m = (r.roblox_user_id != null ? methodByUserId[r.roblox_user_id] : null)
                || (r.roblox_username ? methodByUsername[r.roblox_username.toLowerCase()] : null)
                || null;
            r.payment_method = m ? { method: m.method, details: m.details || {} } : null;
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

    if (action === 'get_my_summary') {
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
        if (!requirePermission(res, session, 'dashboard.submit_request')) return;
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
            const data = await computeGroupEligibility(userId);
            res.json({ ok: true, data });
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
        const permissions = Array.isArray(payload.permissions) ? payload.permissions.filter(p => PERMISSIONS.includes(p)) : [];
        const { error } = await supabase.from('roles').insert({
            name,
            roblox_group_id: robloxGroupId,
            min_rank: minRank,
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
        const robloxGroupId = payload.robloxGroupId === '' || payload.robloxGroupId == null ? null : Number(payload.robloxGroupId);
        const minRank = payload.minRank === '' || payload.minRank == null ? null : Number(payload.minRank);
        const permissions = Array.isArray(payload.permissions) ? payload.permissions.filter(p => PERMISSIONS.includes(p)) : [];
        const { error } = await supabase.from('roles').update({
            roblox_group_id: robloxGroupId,
            min_rank: minRank,
            permissions
        }).eq('id', id);
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true });
        return;
    }

    if (action === 'delete_role') {
        if (!requirePermission(res, session, 'roles.manage')) return;
        const id = payload.id;
        if (!id) { res.status(400).json({ ok: false, error: 'missing_id' }); return; }
        const { error } = await supabase.from('roles').delete().eq('id', id);
        if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
        res.json({ ok: true });
        return;
    }

    if (action === 'list_role_assignments') {
        if (!requirePermission(res, session, 'roles.manage')) return;
        const { data, error } = await supabase
            .from('user_role_assignments')
            .select('id, roblox_user_id, role_id, roblox_username, roles(name)')
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
                last_synced_at: new Date().toISOString()
            }).eq('token', getBearerToken(req));
            res.json({ ok: true, roles: access.roleNames, permissions: access.permissions });
        } catch (e) {
            res.status(500).json({ ok: false, error: 'refresh_failed' });
        }
        return;
    }

    res.status(400).json({ ok: false, error: 'unknown_action' });
});

app.listen(PORT, () => {
    console.log(`HR auth server listening on port ${PORT}`);
});