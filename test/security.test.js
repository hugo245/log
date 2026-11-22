'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const security = require('../lib/security');
const studio = require('../lib/studio');
const { TtlCache } = require('../lib/cache');

test('session tokens are hashed, stable and recognisable', () => {
    const h = security.hashToken('abc');
    assert.strictEqual(h, security.hashToken('abc'));
    assert.notStrictEqual(h, security.hashToken('abd'));
    assert.ok(security.isHashedToken(h));
    assert.ok(!security.isHashedToken('abc'));
});

test('signed tickets verify, expire and reject tampering', async () => {
    security.setTicketSecret('test-secret');
    const t = security.signTicket({ h: 'x', k: 'discord_link' }, 60000);
    assert.strictEqual(security.verifyTicket(t).h, 'x');
    const [body, mac] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ h: 'admin', k: 'discord_link', exp: Date.now() + 1e6 })).toString('base64url');
    assert.strictEqual(security.verifyTicket(`${forged}.${mac}`), null);
    assert.strictEqual(security.verifyTicket(body + '.AAAA'), null);
    const expired = security.signTicket({ h: 'x' }, -1);
    assert.strictEqual(security.verifyTicket(expired), null);
    security.setTicketSecret('other-secret');
    assert.strictEqual(security.verifyTicket(t), null);
});

test('payload guard blocks prototype pollution and huge inputs', () => {
    assert.ok(security.isSafePayload({ a: [1, 2, { b: 'c' }] }));
    assert.ok(!security.isSafePayload(JSON.parse('{"__proto__": {"x": 1}}')));
    assert.ok(!security.isSafePayload({ constructor: { prototype: {} } }));
    assert.ok(!security.isSafePayload({ s: 'x'.repeat(200001) }));
    let deep = {}; let cur = deep;
    for (let i = 0; i < 20; i++) { cur.n = {}; cur = cur.n; }
    assert.ok(!security.isSafePayload(deep));
});

test('internal errors are hidden, codes pass through', () => {
    const quiet = console.error; console.error = () => { };
    try {
        assert.strictEqual(security.publicError({ message: 'duplicate key value violates unique constraint "x"' }), 'server_error');
        assert.strictEqual(security.publicError({ message: 'x', code: '23505' }), 'already_exists');
        assert.strictEqual(security.publicError({ message: 'discord_api_blocked: Discord is blocking' }), 'discord_api_blocked');
        assert.strictEqual(security.publicError('missing_fields'), 'missing_fields');
    } finally { console.error = quiet; }
});

test('rate limiter cuts off after the limit and resets per window', () => {
    const key = 'test:' + Math.random();
    for (let i = 0; i < 5; i++) assert.ok(security.limiter.hit(key, 5, 1000).ok);
    const r = security.limiter.hit(key, 5, 1000);
    assert.ok(!r.ok);
    assert.ok(r.retryAfterSec >= 1);
});

test('branding sanitizer rejects script, bad URLs and bad colours', () => {
    const clean = studio.sanitizeBranding({
        studio: { name: '<script>alert(1)</script>Acme', logoUrl: 'javascript:alert(1)', website: 'https://acme.dev', requestIdPrefix: 'acme!' },
        theme: { accent: 'red;background:url(x)', accentDark: '#abcdef', radius: 999 },
        signIn: { backgroundImage: 'https://cdn.acme.dev/bg.jpg', termsUrl: '//evil.com', showPreview: 'yes' },
        features: { recruitment: false, notAFeature: false },
        payments: { currencies: ['USD', 'EUR'], methods: ['PAYPAL', 'CRYPTO'] },
        __proto__: { polluted: true }
    });
    assert.strictEqual(clean.studio.name, 'scriptalert(1)/scriptAcme');
    assert.strictEqual(clean.studio.logoUrl, undefined);
    assert.strictEqual(clean.studio.website, 'https://acme.dev');
    assert.strictEqual(clean.studio.requestIdPrefix, undefined);
    assert.strictEqual(clean.theme.accent, undefined);
    assert.strictEqual(clean.theme.accentDark, '#ABCDEF');
    assert.strictEqual(clean.theme.radius, 28);
    assert.strictEqual(clean.signIn.backgroundImage, 'https://cdn.acme.dev/bg.jpg');
    assert.strictEqual(clean.signIn.termsUrl, undefined);
    assert.strictEqual(clean.signIn.showPreview, undefined);
    assert.deepStrictEqual(clean.features, { recruitment: false });
    assert.deepStrictEqual(clean.payments, { currencies: ['USD'], methods: ['PAYPAL'] });
    assert.strictEqual({}.polluted, undefined);
});

test('public config never exposes server-only settings', () => {
    const pub = JSON.stringify(studio.publicConfig());
    assert.ok(!pub.includes('leadRoleId'));
    assert.ok(!pub.includes('moneyRules'));
    assert.ok(!pub.includes('contactEmail'));
});

test('cache coalesces concurrent loads and expires', async () => {
    const c = new TtlCache({ ttlMs: 30 });
    let calls = 0;
    const load = () => new Promise(r => setTimeout(() => { calls++; r('v'); }, 10));
    const [a, b] = await Promise.all([c.wrap('k', load), c.wrap('k', load)]);
    assert.strictEqual(a, 'v'); assert.strictEqual(b, 'v'); assert.strictEqual(calls, 1);
    await new Promise(r => setTimeout(r, 40));
    await c.wrap('k', load);
    assert.strictEqual(calls, 2);
});

test('supabase delete builder keeps chaining after then() is wrapped', async () => {
    // Mirrors hrSessionsDelete() in server.js against the real supabase-js client.
    const seen = [];
    const server = http.createServer((req, res) => { seen.push(req.method + ' ' + req.url); res.setHeader('Content-Type', 'application/json'); res.end('[]'); });
    await new Promise(r => server.listen(0, r));
    const { createClient } = require('@supabase/supabase-js');
    const sb = createClient(`http://127.0.0.1:${server.address().port}`, 'key', { auth: { persistSession: false } });
    let invalidated = 0;
    const builder = sb.from('hr_sessions').delete();
    const originalThen = builder.then.bind(builder);
    builder.then = (ok, err) => originalThen((r) => { invalidated++; return r; }).then(ok, err);
    const result = await builder.eq('token', 'h1_abc');
    server.close();
    assert.strictEqual(result.error, null);
    assert.strictEqual(invalidated, 1);
    assert.ok(seen[0].startsWith('DELETE /rest/v1/hr_sessions?token=eq.h1_abc'), seen[0]);
});
