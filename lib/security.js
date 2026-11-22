'use strict';

// Security primitives shared by the API: hashing of session tokens, signed short-lived
// tickets, response headers, rate limiting and request sanity checks. Everything here is
// dependency-free so the server keeps a small, auditable supply chain.

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Session tokens are only ever stored hashed. A database leak (or an admin listing
// sessions) can no longer be turned into a working login.
// ---------------------------------------------------------------------------
function hashToken(raw) {
    if (!raw) return '';
    return 'h1_' + crypto.createHash('sha256').update(String(raw)).digest('hex');
}

function isHashedToken(value) {
    return typeof value === 'string' && value.startsWith('h1_') && value.length === 67;
}

// A short public identifier for a stored session (safe to show in the UI).
function sessionPublicId(storedToken) {
    return String(storedToken || '').slice(-10);
}

function safeEqual(a, b) {
    const ab = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
}

// ---------------------------------------------------------------------------
// Signed tickets: stateless, tamper-proof, expiring blobs. Used so we never have to put a
// session token in a URL (for example when sending someone off to link Discord).
// ---------------------------------------------------------------------------
let ticketSecret = null;
function setTicketSecret(secret) {
    ticketSecret = crypto.createHash('sha256').update('ticket:' + String(secret || '')).digest();
}

function b64u(buf) {
    return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64u(str) {
    return Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function signTicket(payload, ttlMs) {
    if (!ticketSecret) throw new Error('ticket secret not configured');
    const body = b64u(JSON.stringify({ ...payload, exp: Date.now() + (ttlMs || 120000) }));
    const mac = b64u(crypto.createHmac('sha256', ticketSecret).update(body).digest());
    return `${body}.${mac}`;
}

function verifyTicket(ticket) {
    if (!ticketSecret || typeof ticket !== 'string' || ticket.length > 2048) return null;
    const [body, mac] = ticket.split('.');
    if (!body || !mac) return null;
    const expected = b64u(crypto.createHmac('sha256', ticketSecret).update(body).digest());
    if (!safeEqual(mac, expected)) return null;
    try {
        const payload = JSON.parse(fromB64u(body).toString('utf8'));
        if (!payload || typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
        return payload;
    } catch (e) {
        return null;
    }
}

// ---------------------------------------------------------------------------
// HTTP hardening
// ---------------------------------------------------------------------------
function securityHeaders(req, res, next) {
    res.removeHeader('X-Powered-By');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    // API responses carry personal data: never let a shared cache keep them.
    if (!res.getHeader('Cache-Control')) res.setHeader('Cache-Control', 'no-store');
    next();
}

function clientIp(req) {
    // `trust proxy` is configured on the app, so req.ip is the real client address
    // when running behind Render/Cloudflare/NGINX, and the socket address otherwise.
    return String(req.ip || (req.socket && req.socket.remoteAddress) || 'unknown');
}

// ---------------------------------------------------------------------------
// Rate limiting: fixed-window counters held in memory. Cheap, and good enough for a
// single API instance. Buckets are swept regularly so memory stays bounded.
// ---------------------------------------------------------------------------
class RateLimiter {
    constructor() {
        this.buckets = new Map();
        const sweep = setInterval(() => this.sweep(), 60 * 1000);
        if (sweep.unref) sweep.unref();
    }

    // Returns { ok, retryAfterSec }.
    hit(key, limit, windowMs) {
        const now = Date.now();
        let bucket = this.buckets.get(key);
        if (!bucket || bucket.resetAt <= now) {
            bucket = { count: 0, resetAt: now + windowMs };
            this.buckets.set(key, bucket);
        }
        bucket.count += 1;
        if (bucket.count > limit) {
            return { ok: false, retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
        }
        return { ok: true, retryAfterSec: 0 };
    }

    sweep() {
        const now = Date.now();
        for (const [key, bucket] of this.buckets) if (bucket.resetAt <= now) this.buckets.delete(key);
    }
}

const limiter = new RateLimiter();

function rejectRateLimited(res, retryAfterSec) {
    res.setHeader('Retry-After', String(retryAfterSec));
    res.status(429).json({ ok: false, error: 'rate_limited', retryAfter: retryAfterSec });
}

// Express middleware factory: limit by client IP.
function rateLimitByIp(name, limit, windowMs) {
    return (req, res, next) => {
        const r = limiter.hit(`${name}:${clientIp(req)}`, limit, windowMs);
        if (!r.ok) return rejectRateLimited(res, r.retryAfterSec);
        next();
    };
}

// Imperative check for use inside handlers (for example per user, per action group).
function checkRate(res, key, limit, windowMs) {
    const r = limiter.hit(key, limit, windowMs);
    if (!r.ok) { rejectRateLimited(res, r.retryAfterSec); return false; }
    return true;
}

// Only accept JSON bodies on JSON endpoints. Blocks "simple" cross-site form posts.
function requireJson(req, res, next) {
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
        const type = String(req.headers['content-type'] || '').toLowerCase();
        if (!type.startsWith('application/json')) {
            res.status(415).json({ ok: false, error: 'unsupported_media_type' });
            return;
        }
    }
    next();
}

// Rejects payloads that are absurdly deep or contain prototype-polluting keys.
function isSafePayload(value, depth) {
    depth = depth || 0;
    if (depth > 12) return false;
    if (value === null || typeof value !== 'object') {
        return typeof value !== 'string' || value.length <= 200000;
    }
    if (Array.isArray(value)) {
        if (value.length > 5000) return false;
        return value.every(v => isSafePayload(v, depth + 1));
    }
    const keys = Object.keys(value);
    if (keys.length > 500) return false;
    for (const k of keys) {
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') return false;
        if (!isSafePayload(value[k], depth + 1)) return false;
    }
    return true;
}

// Strips internal database wording from error strings before they reach a browser.
// Machine-readable codes (snake_case, optionally followed by ": detail") pass through as
// just the code; anything else (Postgres messages, stack-ish text) becomes server_error
// and is logged server-side instead.
function publicError(err) {
    const msg = err && typeof err === 'object' ? err.message : err;
    if (typeof msg === 'string') {
        const m = /^([a-z][a-z0-9_]{1,63})(?::|$)/.exec(msg);
        if (m) return m[1];
        if (err && typeof err === 'object' && err.code === '23505') return 'already_exists';
    }
    console.error('[api] hid internal error from client:', msg);
    return 'server_error';
}

module.exports = {
    hashToken,
    isHashedToken,
    sessionPublicId,
    safeEqual,
    setTicketSecret,
    signTicket,
    verifyTicket,
    securityHeaders,
    clientIp,
    limiter,
    rateLimitByIp,
    checkRate,
    rejectRateLimited,
    requireJson,
    isSafePayload,
    publicError
};
