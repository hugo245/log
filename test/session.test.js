'use strict';
// End-to-end: boots server.js against the fake database and exercises the session paths.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const path = require('path');
const { createFakePostgrest } = require('./fake-postgrest');
const { hashToken } = require('../lib/security');

const LEGACY = 'a'.repeat(64);
const future = new Date(Date.now() + 86400000).toISOString();
const now = new Date().toISOString();
const perms = ['security.manage'];

let db, api, base;

test.before(async () => {
    db = createFakePostgrest({
        hr_sessions: [
            { token: LEGACY, roblox_user_id: 1, roblox_username: 'Owner', roles: ['Owner'], permissions: perms, max_hierarchy: 100, expires_at: future, last_synced_at: now, last_seen_at: now },
            { token: hashToken('b'.repeat(64)), roblox_user_id: 2, roblox_username: 'Other', roles: [], permissions: [], max_hierarchy: 1, expires_at: future, last_synced_at: now, last_seen_at: now }
        ],
        app_settings: [{ id: 1, security_level: 'normal', devex_rate: 0.0035, closed: false }],
        roles: [{ id: 1, name: 'Owner', hierarchy: 100, link_only: true, permissions: ['dashboard.view', 'roles.manage', 'security.manage'] }],
        accounts: [],
        games: [{ id: 1, name: 'Game A', producer_user_id: null }]
    });
    await new Promise(r => db.server.listen(0, r));
    const port = 4100 + Math.floor(Math.random() * 500);
    base = `http://127.0.0.1:${port}`;
    api = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
        env: {
            ...process.env, PORT: String(port), APP_ORIGIN: 'http://localhost:5500',
            SUPABASE_URL: `http://127.0.0.1:${db.server.address().port}`, SUPABASE_SERVICE_ROLE_KEY: 'test',
            ROBLOX_CLIENT_ID: '1', ROBLOX_CLIENT_SECRET: 'x', ROBLOX_REDIRECT_URI: 'http://localhost/cb', SESSION_SECRET: 'x'.repeat(40),
            DISCORD_CLIENT_ID: '1', DISCORD_CLIENT_SECRET: 'x', DISCORD_REDIRECT_URI: 'http://localhost/dcb',
            AUTH_PROVIDERS: 'roblox,google,test', ADDON_DISCORD: 'true'
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('server did not start')), 8000);
        api.stdout.on('data', d => { if (String(d).includes('listening')) { clearTimeout(t); resolve(); } });
    });
});

test.after(() => { if (api) api.kill(); if (db) db.server.close(); });

const call = (action, payload, token) => fetch(`${base}/hr-data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, payload: payload || {} })
}).then(async r => ({ status: r.status, body: await r.json() }));

test('legacy plaintext session keeps working and is migrated to a hash', async () => {
    const r = await fetch(`${base}/hr-session`, { headers: { Authorization: `Bearer ${LEGACY}` } });
    const body = await r.json();
    assert.strictEqual(r.status, 200);
    assert.strictEqual(body.robloxUsername, 'Owner');
    assert.strictEqual(body.security.level, 'normal');
    assert.ok(db.tables.hr_sessions.some(s => s.token === hashToken(LEGACY)));
    assert.ok(!db.tables.hr_sessions.some(s => s.token === LEGACY));
});

test('a stored hash cannot be used as a bearer token', async () => {
    const r = await fetch(`${base}/hr-session`, { headers: { Authorization: `Bearer ${hashToken(LEGACY)}` } });
    assert.strictEqual(r.status, 401);
});

test('session lists never contain usable tokens', async () => {
    const r = await call('list_sessions', {}, LEGACY);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const dump = JSON.stringify(r.body);
    assert.ok(!dump.includes('b'.repeat(64)));
    assert.ok(!dump.includes(LEGACY));
    assert.ok(r.body.data.find(s => s.isYou));
});

test('signing out revokes the session immediately despite caching', async () => {
    const token = 'c'.repeat(64);
    db.tables.hr_sessions.push({ token: hashToken(token), roblox_user_id: 3, roblox_username: 'Temp', roles: [], permissions: [], max_hierarchy: 0, expires_at: future, last_synced_at: now, last_seen_at: now });
    assert.strictEqual((await fetch(`${base}/hr-session`, { headers: { Authorization: `Bearer ${token}` } })).status, 200);
    await fetch(`${base}/hr-session`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    assert.strictEqual((await fetch(`${base}/hr-session`, { headers: { Authorization: `Bearer ${token}` } })).status, 401);
});

test('bootstrap serves branding, site state and games without auth', async () => {
    const r = await fetch(`${base}/public/bootstrap`);
    const body = await r.json();
    assert.strictEqual(body.config.studio.name, 'Studio Panel');
    // google is dropped because its client id/secret are not configured
    assert.deepStrictEqual(body.auth.providers, ['roblox', 'test']);
    assert.deepStrictEqual(body.auth.testRoles, ['Owner', 'Manager', 'Staff']);
    assert.strictEqual(body.devexRate, 0.0035);
    assert.deepStrictEqual(body.games, [{ id: 1, name: 'Game A' }]);
    assert.strictEqual(body.site.closed, false);
    assert.ok(!JSON.stringify(body).includes('security_level'));
});

test('requests from other origins get no CORS grant; bad input is rejected', async () => {
    const r = await fetch(`${base}/public/bootstrap`, { headers: { Origin: 'https://evil.example' } });
    assert.strictEqual(r.headers.get('access-control-allow-origin'), null);
    const ok = await fetch(`${base}/public/bootstrap`, { headers: { Origin: 'http://localhost:5500' } });
    assert.strictEqual(ok.headers.get('access-control-allow-origin'), 'http://localhost:5500');
    const bad = await fetch(`${base}/hr-data`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"action":"list_requests","payload":{"__proto__":{"a":1}}}' });
    assert.strictEqual(bad.status, 400);
});

test('discord link ticket is required and signed', async () => {
    const r = await fetch(`${base}/discord-auth-start-staff?token=${LEGACY}`, { redirect: 'manual' });
    assert.strictEqual(r.status, 302);
    assert.ok(!String(r.headers.get('location')).includes('discord.com'));
});

test('a valid ticket for a live session starts the Discord flow', async () => {
    const t = await fetch(`${base}/auth/discord-link-ticket`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LEGACY}` }, body: JSON.stringify({ return: '#/my' })
    }).then(r => r.json());
    assert.ok(t.ok && t.url.startsWith('/discord-auth-start-staff?ticket='));
    assert.ok(!t.url.includes(LEGACY));
    const r = await fetch(base + t.url, { redirect: 'manual' });
    assert.strictEqual(r.status, 302);
    assert.ok(String(r.headers.get('location')).startsWith('https://discord.com/oauth2/authorize'));
    const state = db.tables.discord_oauth_states.at(-1);
    assert.strictEqual(state.rt, hashToken(LEGACY));
    assert.strictEqual(state.return_hash, '#/my');
});

test('nobody can pay out or re-price their own request', async () => {
    const token = 'd'.repeat(64);
    db.tables.hr_sessions.push({ token: hashToken(token), roblox_user_id: 50, roblox_username: 'Payer', roles: ['Finance'], permissions: ['dashboard.mark_paid', 'dashboard.view', 'roles.manage'], max_hierarchy: 50, expires_at: future, last_synced_at: now, last_seen_at: now });
    db.tables.payment_requests = [
        { id: 'REQ_1', roblox_user_id: 50, roblox_username: 'Payer', payment: 100, currency: 'USD', paid: false, status: 'pending' },
        { id: 'REQ_2', roblox_user_id: 60, roblox_username: 'Dev', payment: 100, currency: 'USD', paid: false, status: 'pending' }
    ];
    const own = await call('mark_paid', { id: 'REQ_1' }, token);
    assert.strictEqual(own.status, 403);
    assert.strictEqual(own.body.error, 'own_payment');
    assert.strictEqual(db.tables.payment_requests[0].paid, false);
    const edit = await call('edit_request_amount', { id: 'REQ_1', payment: 500, currency: 'USD' }, token);
    assert.strictEqual(edit.body.error, 'own_payment');
    const huge = await call('edit_request_amount', { id: 'REQ_2', payment: 1e12, currency: 'USD' }, token);
    assert.strictEqual(huge.body.error, 'invalid_amount');
    const other = await call('mark_paid', { id: 'REQ_2' }, token);
    assert.strictEqual(other.status, 200, JSON.stringify(other.body));
    assert.strictEqual(db.tables.payment_requests[1].paid, true);
});

test('role managers cannot grant permissions they do not hold', async () => {
    const token = 'd'.repeat(64);
    const r = await call('add_role', { name: 'Sneaky', hierarchy: 1, permissions: ['security.manage', 'payouts.view_bank_details'] }, token);
    assert.strictEqual(r.status, 403);
    assert.strictEqual(r.body.error, 'cannot_grant_permission');
    assert.ok(!(db.tables.roles || []).some(x => x.name === 'Sneaky'));
});

test('test mode signs in as a seeded role with that role\'s permissions', async () => {
    const r = await fetch(`${base}/auth/test-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'Owner' }) });
    const body = await r.json();
    assert.strictEqual(r.status, 200, JSON.stringify(body));
    const me = await fetch(`${base}/hr-session`, { headers: { Authorization: `Bearer ${body.session}` } }).then(x => x.json());
    assert.strictEqual(me.robloxUsername, 'Test Owner');
    assert.ok(me.robloxUserId >= 1000000000000000);
    assert.ok(me.permissions.includes('roles.manage'));
    assert.strictEqual(db.tables.hr_sessions.at(-1).provider, 'test');
    const bad = await fetch(`${base}/auth/test-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'God' }) });
    assert.strictEqual(bad.status, 400);
});

test('disabled providers refuse to start', async () => {
    const g = await fetch(`${base}/google-auth-start`, { redirect: 'manual' });
    assert.strictEqual(g.status, 302);
    assert.ok(String(g.headers.get('location')).includes('error=provider_disabled'));
});
