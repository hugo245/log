'use strict';

// Studio configuration: everything that makes this deployment "yours".
//
// Resolution order (later wins):
//   1. Built-in defaults (below)
//   2. studio.config.json in the project root (committed per deployment)
//   3. Environment variables STUDIO_NAME, STUDIO_SHORT_NAME, STUDIO_WEBSITE, ...
//   4. Branding saved from the admin panel (app_settings.branding, if the column exists)
//
// Only the public part of this config is ever sent to browsers (see publicConfig()).

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
    studio: {
        name: 'Your Studio',
        shortName: 'YS',
        productName: 'Hub',
        website: '',
        websiteLabel: '',
        logoUrl: 'favicon.ico',
        requestIdPrefix: 'REQ',
        contactEmail: '',
        discordInviteUrl: ''
    },
    theme: {
        accent: '#6366F1',
        accentDark: '#8B87FF',
        radius: 18,
        defaultMode: 'light'
    },
    signIn: {
        title: 'Sign in',
        subtitle: "Use your Roblox account. You'll get in if you have a role in the {studio} group.",
        buttonLabel: 'Sign in with Roblox',
        headline: 'Paid for what you build.',
        tagline: 'Log your work, get it approved and see every payout from {studio} in one place.',
        backgroundImage: '',
        footerNote: 'Staff only. Not on the team yet? DM one of our recruiters on Discord.',
        showPreview: true,
        termsUrl: '#/tos',
        privacyUrl: '#/aup'
    },
    features: {
        payments: true,
        claims: true,
        paymentRuns: true,
        analytics: true,
        teams: true,
        recruitment: true,
        staffDatabase: true,
        security: true,
        audit: true,
        backups: true,
        broadcasts: true,
        discord: true,
        pushNotifications: true
    },
    payments: {
        currencies: ['ROBUX', 'USD'],
        methods: ['PAYPAL', 'DEVEX_ROBUX', 'VENMO', 'BANK_TRANSFER']
    },
    legal: {
        tos: '',
        aup: ''
    }
};

const ALL_CURRENCIES = ['ROBUX', 'USD'];
const ALL_METHODS = ['PAYPAL', 'DEVEX_ROBUX', 'VENMO', 'BANK_TRANSFER'];

function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, extra) {
    if (!isPlainObject(extra)) return base;
    const out = { ...base };
    for (const key of Object.keys(extra)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
        const val = extra[key];
        if (isPlainObject(val) && isPlainObject(base[key])) out[key] = deepMerge(base[key], val);
        else if (val !== undefined && val !== null) out[key] = val;
    }
    return out;
}

function readFileConfig() {
    const file = process.env.STUDIO_CONFIG_PATH || path.join(__dirname, '..', 'studio.config.json');
    try {
        if (!fs.existsSync(file)) return {};
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        return isPlainObject(parsed) ? parsed : {};
    } catch (e) {
        console.error(`[studio] could not read ${file}: ${e.message}. Falling back to defaults.`);
        return {};
    }
}

function envConfig() {
    const e = process.env;
    const studio = {};
    if (e.STUDIO_NAME) studio.name = e.STUDIO_NAME;
    if (e.STUDIO_SHORT_NAME) studio.shortName = e.STUDIO_SHORT_NAME;
    if (e.STUDIO_WEBSITE) studio.website = e.STUDIO_WEBSITE;
    if (e.STUDIO_WEBSITE_LABEL) studio.websiteLabel = e.STUDIO_WEBSITE_LABEL;
    if (e.STUDIO_LOGO_URL) studio.logoUrl = e.STUDIO_LOGO_URL;
    if (e.STUDIO_REQUEST_PREFIX) studio.requestIdPrefix = e.STUDIO_REQUEST_PREFIX;
    if (e.STUDIO_CONTACT_EMAIL) studio.contactEmail = e.STUDIO_CONTACT_EMAIL;
    const features = {};
    if (e.STUDIO_DISABLED_FEATURES) {
        e.STUDIO_DISABLED_FEATURES.split(',').map(s => s.trim()).filter(Boolean).forEach(f => { features[f] = false; });
    }
    return { studio, features };
}

// ---------------------------------------------------------------------------
// Validation of anything that can be edited from the admin panel. The output only
// contains known keys with values of the right shape, so a compromised admin account
// can't use branding to inject script or break the page for everyone.
// ---------------------------------------------------------------------------
const HEX = /^#[0-9a-fA-F]{6}$/;

function cleanText(v, max) {
    if (typeof v !== 'string') return undefined;
    // Strip control characters and angle brackets: branding is plain text, never markup.
    return v.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
}

function cleanUrl(v) {
    if (typeof v !== 'string') return undefined;
    const s = v.trim().slice(0, 500);
    if (!s) return '';
    if (/^https:\/\/[^\s"'<>]+$/i.test(s)) return s;
    if (/^(#\/|\/|\.\/)?[a-zA-Z0-9._\-/#?=&%]+$/.test(s) && !/^\/\//.test(s) && !/:/.test(s)) return s;
    return undefined;
}

function cleanLongText(v, max) {
    if (typeof v !== 'string') return undefined;
    return v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max);
}

function sanitizeBranding(input) {
    const out = { studio: {}, theme: {}, signIn: {}, features: {}, payments: {}, legal: {} };
    if (!isPlainObject(input)) return out;
    const s = isPlainObject(input.studio) ? input.studio : {};
    const t = isPlainObject(input.theme) ? input.theme : {};
    const g = isPlainObject(input.signIn) ? input.signIn : {};
    const f = isPlainObject(input.features) ? input.features : {};
    const p = isPlainObject(input.payments) ? input.payments : {};
    const l = isPlainObject(input.legal) ? input.legal : {};

    const set = (obj, key, val) => { if (val !== undefined) obj[key] = val; };

    set(out.studio, 'name', cleanText(s.name, 60));
    set(out.studio, 'shortName', cleanText(s.shortName, 4));
    set(out.studio, 'productName', cleanText(s.productName, 40));
    set(out.studio, 'website', cleanUrl(s.website));
    set(out.studio, 'websiteLabel', cleanText(s.websiteLabel, 60));
    set(out.studio, 'logoUrl', cleanUrl(s.logoUrl));
    set(out.studio, 'contactEmail', cleanText(s.contactEmail, 120));
    set(out.studio, 'discordInviteUrl', cleanUrl(s.discordInviteUrl));
    if (typeof s.requestIdPrefix === 'string' && /^[A-Z0-9]{1,6}$/.test(s.requestIdPrefix)) out.studio.requestIdPrefix = s.requestIdPrefix;

    if (typeof t.accent === 'string' && HEX.test(t.accent)) out.theme.accent = t.accent.toUpperCase();
    if (typeof t.accentDark === 'string' && HEX.test(t.accentDark)) out.theme.accentDark = t.accentDark.toUpperCase();
    if (Number.isFinite(Number(t.radius)) && t.radius !== '' && t.radius !== null) out.theme.radius = Math.max(4, Math.min(28, Math.round(Number(t.radius))));
    if (t.defaultMode === 'light' || t.defaultMode === 'dark') out.theme.defaultMode = t.defaultMode;

    set(out.signIn, 'title', cleanText(g.title, 40));
    set(out.signIn, 'subtitle', cleanText(g.subtitle, 240));
    set(out.signIn, 'buttonLabel', cleanText(g.buttonLabel, 40));
    set(out.signIn, 'headline', cleanText(g.headline, 80));
    set(out.signIn, 'tagline', cleanText(g.tagline, 240));
    set(out.signIn, 'backgroundImage', cleanUrl(g.backgroundImage));
    set(out.signIn, 'footerNote', cleanText(g.footerNote, 240));
    set(out.signIn, 'termsUrl', cleanUrl(g.termsUrl));
    set(out.signIn, 'privacyUrl', cleanUrl(g.privacyUrl));
    if (typeof g.showPreview === 'boolean') out.signIn.showPreview = g.showPreview;

    for (const key of Object.keys(DEFAULTS.features)) {
        if (typeof f[key] === 'boolean') out.features[key] = f[key];
    }

    if (Array.isArray(p.currencies)) {
        const list = [...new Set(p.currencies.filter(c => ALL_CURRENCIES.includes(c)))];
        if (list.length) out.payments.currencies = list;
    }
    if (Array.isArray(p.methods)) {
        const list = [...new Set(p.methods.filter(m => ALL_METHODS.includes(m)))];
        if (list.length) out.payments.methods = list;
    }

    set(out.legal, 'tos', cleanLongText(l.tos, 20000));
    set(out.legal, 'aup', cleanLongText(l.aup, 20000));

    for (const k of Object.keys(out)) if (!Object.keys(out[k]).length) delete out[k];
    return out;
}

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------
const FILE_CONFIG = readFileConfig();
const BASE = deepMerge(deepMerge(DEFAULTS, sanitizeBranding(FILE_CONFIG)), envConfig());

// Server-only settings (internal IDs). These never leave the server.
const SERVER = {
    discord: {
        leadRoleId: process.env.DISCORD_LEAD_ROLE_ID || (FILE_CONFIG.discord && FILE_CONFIG.discord.leadRoleId) || '',
        ticketCategoryId: process.env.DISCORD_TICKET_CATEGORY_ID || (FILE_CONFIG.discord && FILE_CONFIG.discord.ticketCategoryId) || ''
    },
    // Money safety rails. Deliberately not editable from the admin panel: a compromised
    // admin account must not be able to switch them off.
    moneyRules: {
        allowSelfApproval: process.env.ALLOW_SELF_APPROVAL === 'true'
            || !!(FILE_CONFIG.moneyRules && FILE_CONFIG.moneyRules.allowSelfApproval === true),
        maxAmount: {
            ROBUX: Number(process.env.MAX_ROBUX_PER_REQUEST) || Number(FILE_CONFIG.moneyRules && FILE_CONFIG.moneyRules.maxAmount && FILE_CONFIG.moneyRules.maxAmount.ROBUX) || 10000000,
            USD: Number(process.env.MAX_USD_PER_REQUEST) || Number(FILE_CONFIG.moneyRules && FILE_CONFIG.moneyRules.maxAmount && FILE_CONFIG.moneyRules.maxAmount.USD) || 100000
        }
    }
};
let current = BASE;
let overrides = {};

function get() {
    return current;
}

function applyOverrides(raw) {
    overrides = sanitizeBranding(raw || {});
    current = deepMerge(BASE, overrides);
    return current;
}

function getOverrides() {
    return overrides;
}

function interpolate(text) {
    if (typeof text !== 'string') return text;
    const c = current.studio;
    return text.replace(/\{studio\}/g, c.name).replace(/\{website\}/g, c.websiteLabel || c.website || '');
}

function feature(name) {
    const f = current.features || {};
    return f[name] !== false;
}

// What browsers get. Never put secrets or internal IDs in here.
function publicConfig() {
    const c = current;
    return {
        studio: {
            name: c.studio.name,
            shortName: c.studio.shortName,
            productName: c.studio.productName,
            website: c.studio.website,
            websiteLabel: c.studio.websiteLabel,
            logoUrl: c.studio.logoUrl,
            discordInviteUrl: c.studio.discordInviteUrl
        },
        theme: { ...c.theme },
        signIn: {
            ...c.signIn,
            subtitle: interpolate(c.signIn.subtitle),
            tagline: interpolate(c.signIn.tagline),
            footerNote: interpolate(c.signIn.footerNote)
        },
        features: { ...c.features },
        payments: { currencies: [...c.payments.currencies], methods: [...c.payments.methods] }
    };
}

module.exports = {
    SERVER,
    DEFAULTS,
    ALL_CURRENCIES,
    ALL_METHODS,
    get,
    applyOverrides,
    getOverrides,
    sanitizeBranding,
    interpolate,
    feature,
    publicConfig
};
