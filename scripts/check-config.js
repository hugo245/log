#!/usr/bin/env node
// Validates a deployment before you start it: required environment variables, the studio
// config file, and the frontend config. Run with `npm run check`.
'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let problems = 0;
let warnings = 0;
const bad = (m) => { problems++; console.log('  ✗ ' + m); };
const warn = (m) => { warnings++; console.log('  ! ' + m); };
const ok = (m) => console.log('  ✓ ' + m);

console.log('\nEnvironment');
const usesRoblox = String(process.env.AUTH_PROVIDERS || 'roblox').split(',').map(x => x.trim()).includes('roblox');
['APP_ORIGIN', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', ...(usesRoblox ? ['ROBLOX_CLIENT_ID', 'ROBLOX_CLIENT_SECRET', 'ROBLOX_REDIRECT_URI'] : [])]
    .forEach(k => (process.env[k] ? ok(k) : bad(`${k} is missing (required)`)));
if (!process.env.SESSION_SECRET) warn('SESSION_SECRET is not set: generate one with  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
else if (process.env.SESSION_SECRET.length < 32) bad('SESSION_SECRET should be at least 32 characters');
else ok('SESSION_SECRET');
if (process.env.APP_ORIGIN && /\/$/.test(process.env.APP_ORIGIN)) bad('APP_ORIGIN must not end with a slash');
if (process.env.APP_ORIGIN && !/^https:\/\//.test(process.env.APP_ORIGIN) && !/localhost|127\.0\.0\.1/.test(process.env.APP_ORIGIN)) warn('APP_ORIGIN should be https in production');

console.log('\nAdd-ons');
const studioLib = require('../lib/studio');
if (studioLib.addon('discord')) {
    ok('Discord add-on: on');
    ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_REDIRECT_URI', 'DISCORD_BOT_TOKEN', 'DISCORD_GUILD_ID']
        .forEach(k => (process.env[k] ? ok(k) : bad(`${k} is missing (needed by the Discord add-on)`)));
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) warn('VAPID keys not set (applicants get no browser notifications)');
} else {
    ok('Discord add-on: off (Discord linking, the bot and Recruitment are hidden)');
}

if (process.env.ALERT_WEBHOOK_URL && !/^https:\/\//.test(process.env.ALERT_WEBHOOK_URL)) bad('ALERT_WEBHOOK_URL must be an https:// webhook URL');

console.log('\nSign-in');
const providers = String(process.env.AUTH_PROVIDERS || 'roblox').split(',').map(x => x.trim()).filter(Boolean);
ok(`providers: ${providers.join(', ')}`);
if (providers.includes('test')) warn('TEST MODE is on: anyone can sign in as a test Owner. Remove "test" from AUTH_PROVIDERS before going live.');
if (providers.includes('google') && !(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI)) bad('google is in AUTH_PROVIDERS but GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI are not all set');
if (!process.env.OWNER_ROBLOX_IDS && !process.env.OWNER_EMAILS && !providers.includes('test')) warn('No OWNER_ROBLOX_IDS or OWNER_EMAILS: on a fresh database nobody will be able to sign in to set things up');
else ok('owner bootstrap configured');

console.log('\nstudio.config.json');
try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, 'studio.config.json'), 'utf8'));
    const studio = require('../lib/studio');
    const cfg = studio.get();
    ok(`studio name: ${cfg.studio.name}`);
    if (cfg.studio.name === 'Studio Panel') warn('studio.name is still the default "Studio Panel" (you can also set it in Settings > Branding)');
    if (!/^#[0-9a-fA-F]{6}$/.test((raw.theme || {}).accent || cfg.theme.accent)) bad('theme.accent must be a #RRGGBB colour');
    const dropped = JSON.stringify(raw).length - JSON.stringify(studio.sanitizeBranding(raw)).length;
    if (dropped > 200 && !raw.discord && !raw.moneyRules && !raw.addons) warn('some values in studio.config.json were ignored as invalid (check URLs and colours)');
    const locked = new Set(studio.lockedFeatures());
    const off = Object.entries(cfg.features).filter(([k, v]) => v === false && !locked.has(k)).map(([k]) => k);
    ok(`features off: ${off.length ? off.join(', ') : 'none'}`);
    ok(`self-approval of payments: ${studio.SERVER.moneyRules.allowSelfApproval ? 'ALLOWED' : 'blocked'}`);
} catch (e) {
    bad('could not read studio.config.json: ' + e.message);
}

console.log('\nconfig.js (frontend)');
try {
    const src = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
    const m = /apiBase:\s*'([^']*)'/.exec(src);
    if (!m || !m[1]) bad('apiBase is not set in config.js');
    else if (/\/$/.test(m[1])) bad('apiBase must not end with a slash');
    else if (/yourstudio\.com|example\.com/.test(m[1])) warn(`apiBase still points at ${m[1]}: change it to your own API's URL`);
    else ok(`apiBase: ${m[1]}`);
} catch (e) {
    bad('could not read config.js');
}

console.log(`\n${problems ? `${problems} problem(s)` : 'No problems'}${warnings ? `, ${warnings} warning(s)` : ''}.\n`);
process.exit(problems ? 1 : 0);
