'use strict';
// Licence keys: which tier and add-ons a deployment has paid for.
//
// A key is   base64url(JSON payload) + "." + base64url(Ed25519 signature of that payload)
// signed with the seller's private key (scripts/license.js). The matching public key lives
// below. The payload looks like:
//
//   { "v": 1, "id": "lic_...", "licensee": "Acme Games", "tier": "pro", "addons": ["discord"],
//     "domains": ["panel.acme.gg", "*.acme.gg"], "issued": "2026-11-23", "expires": "2027-11-23" }
//
// Until a public key is set (SELLER_PUBLIC_KEY empty) licensing is in "unmanaged" mode:
// everything is unlocked, which is what you want on your own deployment before you start
// selling. Run `node scripts/license.js keygen` to set it up.
//
// This deters casual sharing. Anyone with the source can remove the check, so pair it with
// a licence agreement (and hosting it yourself if you need hard protection).

const crypto = require('crypto');

// Set by `node scripts/license.js keygen`. PEM, SPKI, Ed25519.
const SELLER_PUBLIC_KEY = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA+P3y/2Eri4C2epPVfoAebhMCdAzMgJ43DzzLdJm4IEk=\n-----END PUBLIC KEY-----";

const TIERS = ['core', 'pro'];

// Which features each tier unlocks. Anything not listed is part of Core.
const PRO_FEATURES = ['analytics', 'paymentRuns', 'revenueShare', 'contracts', 'taxForms', 'accountingExport', 'budgets', 'multiCurrency'];

// Add-ons and the features they unlock.
const ADDON_FEATURES = { discord: ['discord', 'recruitment'] };

function b64urlDecode(s) {
    return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function hostMatches(host, pattern) {
    host = String(host || '').toLowerCase();
    pattern = String(pattern || '').toLowerCase().trim();
    if (!host || !pattern) return false;
    if (pattern.startsWith('*.')) return host.endsWith(pattern.slice(1)) && host.length > pattern.length - 1;
    return host === pattern;
}

function hostOf(origin) {
    try { return new URL(origin).hostname.toLowerCase(); } catch (e) { return ''; }
}

// Returns { ok, payload, reason }. Pure: no environment access, so it can be tested.
function verifyKey(key, publicKeyPem, { origin, now } = {}) {
    if (!publicKeyPem) return { ok: false, reason: 'no_public_key' };
    if (!key || typeof key !== 'string' || !key.includes('.')) return { ok: false, reason: 'missing' };
    const [body, sig] = key.trim().split('.');
    let payload;
    try {
        const valid = crypto.verify(null, Buffer.from(body), crypto.createPublicKey(publicKeyPem), b64urlDecode(sig));
        if (!valid) return { ok: false, reason: 'bad_signature' };
        payload = JSON.parse(b64urlDecode(body).toString('utf8'));
    } catch (e) {
        return { ok: false, reason: 'malformed' };
    }
    if (!payload || payload.v !== 1 || !TIERS.includes(payload.tier)) return { ok: false, reason: 'malformed' };
    const today = now ? new Date(now) : new Date();
    if (payload.expires && new Date(payload.expires + 'T23:59:59Z') < today) return { ok: false, reason: 'expired', payload };
    if (Array.isArray(payload.domains) && payload.domains.length && origin) {
        const host = hostOf(origin);
        const local = /^(localhost|127\.0\.0\.1)$/.test(host);
        if (!local && !payload.domains.some(d => hostMatches(host, d))) return { ok: false, reason: 'wrong_domain', payload };
    }
    return { ok: true, payload };
}

function evaluate() {
    const publicKey = SELLER_PUBLIC_KEY;
    if (!publicKey) {
        return { managed: false, valid: true, tier: 'pro', addons: Object.keys(ADDON_FEATURES), licensee: null, expires: null, reason: null };
    }
    const r = verifyKey(process.env.LICENSE_KEY, publicKey, { origin: process.env.APP_ORIGIN });
    if (!r.ok) {
        return { managed: true, valid: false, tier: 'core', addons: [], licensee: r.payload ? r.payload.licensee : null, expires: r.payload ? r.payload.expires : null, reason: r.reason };
    }
    const p = r.payload;
    return {
        managed: true, valid: true, tier: p.tier,
        addons: (Array.isArray(p.addons) ? p.addons : []).filter(a => ADDON_FEATURES[a]),
        licensee: p.licensee || null, expires: p.expires || null, id: p.id || null, reason: null
    };
}

const STATE = evaluate();

function state() { return STATE; }
function tier() { return STATE.tier; }
function hasAddon(name) { return STATE.addons.includes(name); }

// Features this licence doesn't cover.
function lockedFeatures() {
    const out = [];
    if (STATE.tier !== 'pro') out.push(...PRO_FEATURES);
    for (const [addon, feats] of Object.entries(ADDON_FEATURES)) if (!hasAddon(addon)) out.push(...feats);
    return out;
}

// Safe to show to signed-in admins.
function publicState() {
    return { managed: STATE.managed, valid: STATE.valid, tier: STATE.tier, addons: STATE.addons.slice(), licensee: STATE.licensee, expires: STATE.expires, reason: STATE.reason };
}

module.exports = { TIERS, PRO_FEATURES, ADDON_FEATURES, verifyKey, hostMatches, state, tier, hasAddon, lockedFeatures, publicState, SELLER_PUBLIC_KEY };
