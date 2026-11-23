'use strict';
// Time-based one-time passwords (RFC 6238), the 6-digit codes authenticator apps show.
// SHA-1, 30-second steps, 6 digits: what Google Authenticator, 1Password, Authy etc. expect.

const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
    let bits = 0, value = 0, out = '';
    for (const byte of buf) {
        value = (value << 8) | byte; bits += 8;
        while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
    }
    if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
    return out;
}

function base32Decode(str) {
    const clean = String(str || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
    let bits = 0, value = 0;
    const out = [];
    for (const ch of clean) {
        value = (value << 5) | ALPHABET.indexOf(ch); bits += 5;
        if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
    }
    return Buffer.from(out);
}

function generateSecret() { return base32Encode(crypto.randomBytes(20)); }

function codeAt(secret, step) {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step));
    const h = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
    const o = h[h.length - 1] & 15;
    const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
    return String(n % 1000000).padStart(6, '0');
}

function currentStep(now) { return Math.floor((now || Date.now()) / 30000); }

// Returns the matching step (to stop the same code being used twice) or -1.
function verify(secret, code, { now, window = 1, lastStep = -1 } = {}) {
    const c = String(code || '').replace(/\D/g, '');
    if (c.length !== 6) return -1;
    const step = currentStep(now);
    for (let i = -window; i <= window; i++) {
        const s = step + i;
        if (s <= lastStep) continue;
        const expected = codeAt(secret, s);
        if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(c))) return s;
    }
    return -1;
}

function otpauthUri(secret, account, issuer) {
    const label = encodeURIComponent(`${issuer}:${account}`);
    return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

function recoveryCodes(n) {
    return Array.from({ length: n || 10 }, () => {
        const raw = base32Encode(crypto.randomBytes(7)).slice(0, 10).toLowerCase();
        return `${raw.slice(0, 5)}-${raw.slice(5)}`;
    });
}

module.exports = { generateSecret, codeAt, verify, otpauthUri, recoveryCodes, base32Encode, base32Decode, currentStep };
