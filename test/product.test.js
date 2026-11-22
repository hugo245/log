'use strict';
// End-to-end checks for the sellable defaults: Discord add-on off, public legal pages, and
// database-backed branding that only the right people can change and that can't carry markup.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const path = require('path');
const { createFakePostgrest } = require('./fake-postgrest');
const { hashToken } = require('../lib/security');
const studio = require('../lib/studio');

const future = new Date(Date.now() + 86400000).toISOString();
const now = new Date().toISOString();
const OWNER = 'o'.repeat(64);
const STAFF = 's'.repeat(64);

let db, api, base;

test.before(async () => {
    db = createFakePostgrest({
        hr_sessions: [
            { token: hashToken(OWNER), roblox_user_id: 1, roblox_username: 'Owner', roles: ['Owner'], permissions: ['settings.manage_branding', 'dashboard.view'], max_hierarchy: 100, expires_at: future, last_synced_at: now, last_seen_at: now },
            { token: hashToken(STAFF), roblox_user_id: 2, roblox_username: 'Staffer', roles: ['Staff'], permissions: ['teams.view'], max_hierarchy: 10, expires_at: future, last_synced_at: now, last_seen_at: now }
        ],
        app_settings: [{ id: 1, security_level: 'normal', devex_rate: 0.0035, closed: false, branding: {} }],
        roles: [], accounts: [], games: []
    });
    await new Promise(r => db.server.listen(0, r));
    const port = 4700 + Math.floor(Math.random() * 500);
    base = `http://127.0.0.1:${port}`;
    const env = { ...process.env };
    delete env.ADDON_DISCORD;
    api = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
        env: {
            ...env, PORT: String(port), APP_ORIGIN: 'http://localhost:5500',
            SUPABASE_URL: `http://127.0.0.1:${db.server.address().port}`, SUPABASE_SERVICE_ROLE_KEY: 'test',
            ROBLOX_CLIENT_ID: '1', ROBLOX_CLIENT_SECRET: 'x', ROBLOX_REDIRECT_URI: 'http://localhost/cb', SESSION_SECRET: 'x'.repeat(40),
            // Discord credentials present, but the add-on is not bought: they must be ignored.
            DISCORD_CLIENT_ID: '1', DISCORD_CLIENT_SECRET: 'x', DISCORD_REDIRECT_URI: 'http://localhost/dcb', DISCORD_BOT_TOKEN: 'bot',
            AUTH_PROVIDERS: 'roblox'
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

test('Discord add-on is off by default: routes, actions and features are gone', async () => {
    const boot = await fetch(`${base}/public/bootstrap`).then(r => r.json());
    assert.strictEqual(boot.config.features.discord, false);
    assert.strictEqual(boot.config.features.recruitment, false);
    assert.strictEqual(boot.config.addons.discord, false);
    for (const p of ['/discord-auth-start', '/discord-auth-start-staff', '/recruit-session', '/recruitment/positions']) {
        const r = await fetch(base + p, { redirect: 'manual' });
        assert.strictEqual(r.status, 404, p);
    }
    const r = await call('list_base_access_discord_servers', {}, OWNER);
    assert.strictEqual(r.status, 404);
    assert.strictEqual(r.body.error, 'feature_disabled');
    const s = await fetch(`${base}/hr-session`, { headers: { Authorization: `Bearer ${STAFF}` } }).then(x => x.json());
    assert.strictEqual(s.discordLinked, true, 'nobody is asked to link Discord');
    assert.strictEqual(s.discordRequired, false);
});

test('legal pages are public and use the studio name', async () => {
    const r = await fetch(`${base}/public/legal`);
    assert.strictEqual(r.status, 200);
    const body = await r.json();
    for (const k of ['terms', 'privacy', 'aup']) {
        assert.ok(body.data[k].content.length > 500, k);
        assert.ok(!body.data[k].content.includes('{studio}'), k);
        assert.ok(!body.data[k].content.includes('{contact}'), k);
    }
    assert.match(body.data.privacy.title, /Privacy/);
});

test('only people with the branding permission can read or change branding', async () => {
    const r = await call('get_branding', {}, STAFF);
    assert.strictEqual(r.status, 403);
    const w = await call('save_branding', { branding: { studio: { name: 'Hacked' } } }, STAFF);
    assert.strictEqual(w.status, 403);
    assert.deepStrictEqual(db.tables.app_settings[0].branding, {});
});

test('saved branding is cleaned, stored and served to everyone', async () => {
    const r = await call('save_branding', {
        branding: {
            studio: { name: 'Northwind <script>', logoUrl: 'javascript:alert(1)', contactEmail: 'ops@northwind.gg' },
            theme: { accent: '#0E9F6E', accentDark: 'red; background:url(x)' },
            signIn: { headline: 'Ship it.', backgroundImage: 'data:image/svg+xml;base64,PHN2Zz4=' },
            features: { recruitment: true, discord: true, analytics: false },
            legal: { privacy: 'Our own privacy text for {studio}.' }
        }
    }, OWNER);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const saved = db.tables.app_settings[0].branding;
    assert.strictEqual(saved.studio.name, 'Northwind script');
    assert.strictEqual(saved.studio.logoUrl, undefined, 'javascript: URLs are dropped');
    assert.strictEqual(saved.theme.accent, '#0E9F6E');
    assert.strictEqual(saved.theme.accentDark, undefined);
    assert.strictEqual(saved.signIn.backgroundImage, undefined, 'SVG data URLs are refused');
    assert.strictEqual(saved.features.recruitment, undefined, 'add-on features cannot be switched on');
    assert.strictEqual(saved.features.discord, undefined);

    const boot = await fetch(`${base}/public/bootstrap`).then(x => x.json());
    assert.strictEqual(boot.config.studio.name, 'Northwind script');
    assert.strictEqual(boot.config.theme.accent, '#0E9F6E');
    assert.strictEqual(boot.config.signIn.headline, 'Ship it.');
    assert.strictEqual(boot.config.features.analytics, false);
    assert.strictEqual(boot.config.features.recruitment, false);
    assert.ok(!JSON.stringify(boot).includes('ops@northwind.gg'), 'contact email stays server-side');

    const legal = await fetch(`${base}/public/legal`).then(x => x.json());
    assert.strictEqual(legal.data.privacy.content, 'Our own privacy text for Northwind script.');
    assert.ok(legal.data.terms.content.includes('ops@northwind.gg'));
});

test('an uploaded raster logo is accepted, an oversized one is not', () => {
    const small = 'data:image/png;base64,' + 'A'.repeat(1000);
    const big = 'data:image/png;base64,' + 'A'.repeat(400 * 1024);
    assert.strictEqual(studio.sanitizeBranding({ studio: { logoUrl: small } }).studio.logoUrl, small);
    assert.strictEqual((studio.sanitizeBranding({ studio: { logoUrl: big } }).studio || {}).logoUrl, undefined);
});
