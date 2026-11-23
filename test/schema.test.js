'use strict';
// A database that hasn't had sql/upgrade.sql applied is reported, so the website can hold
// everyone on its maintenance screen instead of letting them use a half-updated panel.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const path = require('path');
const { createFakePostgrest } = require('./fake-postgrest');

let db, api, base;
test.before(async () => {
    db = createFakePostgrest({ app_settings: [{ id: 1, security_level: 'normal' }], games: [], __missing: ['error_events', 'user_mfa'] });
    await new Promise(r => db.server.listen(0, r));
    const port = 5800 + Math.floor(Math.random() * 300);
    base = `http://127.0.0.1:${port}`;
    api = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
        env: { ...process.env, PORT: String(port), APP_ORIGIN: 'http://localhost:5500', SUPABASE_URL: `http://127.0.0.1:${db.server.address().port}`, SUPABASE_SERVICE_ROLE_KEY: 'test', ROBLOX_CLIENT_ID: '1', ROBLOX_CLIENT_SECRET: 'x', ROBLOX_REDIRECT_URI: 'http://localhost/cb', SESSION_SECRET: 'x'.repeat(40) },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('server did not start')), 8000);
        api.stdout.on('data', d => { if (String(d).includes('listening')) { clearTimeout(t); resolve(); } });
    });
});
test.after(() => { if (api) api.kill(); if (db) db.server.close(); });

test('missing upgrade tables mark the database as not ready', async () => {
    const b = await fetch(`${base}/public/bootstrap`).then(r => r.json());
    assert.strictEqual(b.schema.ok, false);
    assert.strictEqual(b.schema.pending, 2);
});
