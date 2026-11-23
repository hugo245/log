'use strict';
// Setup wizard state, error monitoring, backup retention and the public status page.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const path = require('path');
const { createFakePostgrest } = require('./fake-postgrest');
const { hashToken } = require('../lib/security');

const future = new Date(Date.now() + 86400000).toISOString();
const now = new Date().toISOString();
const OWNER = 'w'.repeat(64);
const STAFF = 'f'.repeat(64);
const ownerPerms = ['roles.manage', 'settings.manage_branding', 'audit.view', 'security.manage', 'backups.manage', 'settings.manage_base_access', 'settings.manage_rate', 'settings.manage_onboarding'];

let db, api, base;

test.before(async () => {
    const old = (days) => new Date(Date.now() - days * 86400000).toISOString();
    db = createFakePostgrest({
        hr_sessions: [
            { token: hashToken(OWNER), roblox_user_id: 1, roblox_username: 'Owner', roles: ['Owner'], permissions: ownerPerms, max_hierarchy: 100, expires_at: future, last_synced_at: now, last_seen_at: now },
            { token: hashToken(STAFF), roblox_user_id: 2, roblox_username: 'Staffer', roles: ['Staff'], permissions: ['teams.view'], max_hierarchy: 10, expires_at: future, last_synced_at: now, last_seen_at: now }
        ],
        app_settings: [{ id: 1, security_level: 'normal', devex_rate: 0.0035, closed: false, branding: {}, setup_completed_at: null, setup_skipped: false }],
        roles: [{ id: 5, name: 'Staff', hierarchy: 10, permissions: [] }], accounts: [], games: [], teams: [],
        base_access_groups: [], base_access_discord_servers: [], onboarding_links: [], user_role_assignments: [],
        error_events: [],
        // 15 backups: 12 older than the 30-day retention. The newest 10 must survive regardless.
        backups: Array.from({ length: 15 }, (_, i) => ({ id: i + 1, created_at: old(i < 3 ? i : 40 + i), size_bytes: 1000, trigger: 'scheduled' }))
    });
    await new Promise(r => db.server.listen(0, r));
    const port = 5300 + Math.floor(Math.random() * 400);
    base = `http://127.0.0.1:${port}`;
    api = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
        env: {
            ...process.env, PORT: String(port), APP_ORIGIN: 'http://localhost:5500',
            SUPABASE_URL: `http://127.0.0.1:${db.server.address().port}`, SUPABASE_SERVICE_ROLE_KEY: 'test',
            ROBLOX_CLIENT_ID: '1', ROBLOX_CLIENT_SECRET: 'x', ROBLOX_REDIRECT_URI: 'http://localhost/cb', SESSION_SECRET: 'x'.repeat(40),
            AUTH_PROVIDERS: 'roblox', ALERT_WEBHOOK_URL: ''
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

test('setup state is only offered to owners and can be finished', async () => {
    const staff = await call('get_setup_state', {}, STAFF);
    assert.strictEqual(staff.body.data.canRun, false);
    const owner = await call('get_setup_state', {}, OWNER);
    assert.strictEqual(owner.status, 200, JSON.stringify(owner.body));
    assert.strictEqual(owner.body.data.canRun, true);
    assert.strictEqual(owner.body.data.completed, false);
    assert.strictEqual(owner.body.data.checks.payouts, true);
    assert.strictEqual(owner.body.data.checks.signin, false);
    assert.deepStrictEqual(owner.body.data.values.roles.map(r => r.name), ['Staff']);
    const denied = await call('finish_setup', {}, STAFF);
    assert.strictEqual(denied.status, 403);
    const done = await call('finish_setup', { skipped: true }, OWNER);
    assert.strictEqual(done.status, 200);
    assert.ok(db.tables.app_settings[0].setup_completed_at);
    assert.strictEqual(db.tables.app_settings[0].setup_skipped, true);
    assert.strictEqual((await call('get_setup_state', {}, OWNER)).body.data.completed, true);
});

test('browser errors are recorded once per kind, scrubbed, and only from the app origin', async () => {
    const send = (body, origin) => fetch(`${base}/public/client-error`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin || 'http://localhost:5500' }, body: JSON.stringify(body)
    });
    const stack = 'TypeError: x is undefined\n    at paint (http://localhost:5500/assets/app.js:100:5)';
    assert.strictEqual((await send({ message: 'x is undefined', stack, url: '/index.html?session=abcdef123', route: '#/auth-callback?session=secret' })).status, 204);
    await send({ message: 'x is undefined', stack });
    await send({ message: 'from elsewhere', stack: '' }, 'https://evil.example');
    await new Promise(r => setTimeout(r, 300));
    const rows = db.tables.error_events;
    assert.strictEqual(rows.length, 1, JSON.stringify(rows));
    assert.strictEqual(rows[0].count, 2);
    assert.strictEqual(rows[0].source, 'browser');
    assert.ok(!JSON.stringify(rows[0]).includes('secret'));
    assert.ok(!JSON.stringify(rows[0]).includes('abcdef123'));
});

test('health view is limited to people who run the panel, and errors can be marked fixed', async () => {
    assert.strictEqual((await call('get_health', {}, STAFF)).status, 403);
    const h = await call('get_health', {}, OWNER);
    assert.strictEqual(h.status, 200, JSON.stringify(h.body));
    assert.strictEqual(h.body.data.errors.length, 1);
    assert.strictEqual(h.body.data.retention.days, 30);
    const id = h.body.data.errors[0].id;
    assert.strictEqual((await call('resolve_error', { ids: [id] }, OWNER)).status, 200);
    assert.ok(db.tables.error_events[0].resolved_at);
});

test('backup retention keeps the newest ones and deletes only old extras', async () => {
    const r = await call('prune_backups_now', {}, OWNER);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.deleted, 5);
    assert.strictEqual(db.tables.backups.length, 10);
    assert.strictEqual((await call('prune_backups_now', {}, STAFF)).status, 403);
});

test('public status is coarse and safe', async () => {
    const s = await fetch(`${base}/public/status`).then(r => r.json());
    assert.strictEqual(s.overall, 'operational');
    assert.deepStrictEqual(s.components.map(c => c.key), ['api', 'database', 'backups']);
    const dump = JSON.stringify(s);
    assert.ok(!/fingerprint|stack|roblox_user_id|service/i.test(dump));
    db.tables.app_settings[0].services_down = true;
    await new Promise(r => setTimeout(r, 16000));
    const down = await fetch(`${base}/public/status`).then(r => r.json());
    assert.strictEqual(down.overall, 'down');
});

test('scrubbing removes credentials from error text', () => {
    const { _internals } = require('../features/monitor')({ supabase: {}, studio: { get: () => ({ studio: { name: 'X' } }) }, requirePermission() { }, hasPermission() { } });
    const out = _internals.scrub('GET /x?session=abc&ok=1 Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.sig token=zzz');
    assert.ok(!/abc|zzz|eyJhbGci/.test(out), out);
    assert.strictEqual(_internals.fingerprintOf('server', 'id 12 missing', 'at a (/x/server.js:1:2)'), _internals.fingerprintOf('server', 'id 99 missing', 'at a (/x/server.js:5:9)'));
});

test('every response carries the release version, and bootstrap reports version and database state', async () => {
    const pkg = require('../package.json');
    const r = await fetch(`${base}/public/bootstrap`, { headers: { Origin: 'http://localhost:5500' } });
    assert.strictEqual(r.headers.get('x-app-version'), pkg.version);
    assert.match(String(r.headers.get('access-control-expose-headers')), /X-App-Version/i);
    const b = await r.json();
    assert.strictEqual(b.version, pkg.version);
    assert.strictEqual(b.schema.ok, true);
    assert.ok(!JSON.stringify(b.schema).includes('error_events'), 'table names are not public');
    const ping = await fetch(`${base}/ping`).then(x => x.json());
    assert.strictEqual(ping.version, pkg.version);
});

test('the website and package.json agree on the version', () => {
    const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
    const m = /<meta name="app-version" content="([^"]*)">/.exec(html);
    assert.ok(m, 'index.html has an app-version meta tag (run npm run stamp)');
    assert.strictEqual(m[1], require('../package.json').version);
});

test('an established studio never gets the first-run guide', async () => {
    db.tables.app_settings[0].setup_completed_at = null;
    db.tables.app_settings[0].setup_skipped = false;
    db.tables.payment_requests = [{ id: 'REQ_1', roblox_user_id: 9, payment: 10, currency: 'USD', status: 'paid' }];
    const r = await call('get_setup_state', {}, OWNER);
    assert.strictEqual(r.body.data.completed, true);
    assert.strictEqual(db.tables.app_settings[0].setup_completed_by, 'Existing studio');
});
