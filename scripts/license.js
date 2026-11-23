#!/usr/bin/env node
'use strict';
// Seller tool for licence keys. Keep license-private.pem somewhere safe and never ship it.
//
//   node scripts/license.js keygen
//       Creates license-private.pem and writes the public key into lib/license.js.
//       From then on, deployments without a valid LICENSE_KEY run as Core with no add-ons.
//
//   node scripts/license.js issue --to "Acme Games" --domain panel.acme.gg [--domain "*.acme.gg"]
//                                 [--tier pro|core] [--addon discord] [--months 12 | --expires 2027-12-31]
//       Prints a licence key. The buyer sets it as LICENSE_KEY on their API.
//
//   node scripts/license.js inspect <key>
//       Shows what a key contains and whether it verifies against lib/license.js.
//
//   npm run license:demo   (node scripts/license.js demo [--to NAME] [--days 30] [--domain HOST] [--no-push])
//       One command: creates the signing key if there isn't one, issues a Pro key with every
//       add-on (30 days, any domain unless --domain is given), and commits + pushes
//       lib/license.js if it changed. The private key is never added to git.
//
// Every key issued is also appended to issued-licenses.log (git-ignored) as your record.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const privPath = process.env.LICENSE_PRIVATE_KEY_PATH || path.join(root, 'license-private.pem');
const libPath = path.join(root, 'lib', 'license.js');

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function args(list) {
    const out = { _: [] };
    for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (a.startsWith('--')) {
            const k = a.slice(2);
            const v = list[i + 1] && !list[i + 1].startsWith('--') ? list[++i] : true;
            if (out[k] === undefined) out[k] = v;
            else out[k] = [].concat(out[k], v);
        } else out._.push(a);
    }
    return out;
}

function die(msg) { console.error(msg); process.exit(1); }

function existingPublicKey() {
    const m = /const SELLER_PUBLIC_KEY = ([^;]*);/.exec(fs.readFileSync(libPath, 'utf8'));
    try { return m ? JSON.parse(m[1].replace(/^'(.*)'$/, '"$1"')) : ''; } catch (e) { return m && m[1] !== "''" ? 'set' : ''; }
}

function keygen(opts) {
    if (fs.existsSync(privPath) && !opts.force) die(`${privPath} already exists. Pass --force to replace it (every licence you issued stops working).`);
    if (existingPublicKey() && !opts.force) die(`lib/license.js already has a seller public key, so you already made a signing key somewhere.\nCopy that license-private.pem into ${root} instead. Making a new one (--force) breaks every licence you've issued.`);
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    fs.writeFileSync(privPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    const pub = publicKey.export({ type: 'spki', format: 'pem' }).trim();
    const src = fs.readFileSync(libPath, 'utf8');
    const next = src.replace(/const SELLER_PUBLIC_KEY = [^;]*;/, `const SELLER_PUBLIC_KEY = ${JSON.stringify(pub)};`);
    fs.writeFileSync(libPath, next);
    console.log(`Private key: ${privPath}  (keep it secret, back it up, never commit it)`);
    console.log('Public key written to lib/license.js. Licensing is now enforced.');
    console.log('Issue yourself a licence next, or your own deployment drops to Core:');
    console.log('  node scripts/license.js issue --to "Your studio" --domain your.domain --tier pro --addon discord --months 1200');
}

function issue(opts) {
    if (!fs.existsSync(privPath)) die(`No private key at ${privPath}. Run: node scripts/license.js keygen`);
    if (!opts.to) die('Missing --to "Licensee name"');
    const domains = [].concat(opts.domain || []).filter(d => d && d !== true);
    if (!domains.length) die('Missing --domain (the website host, e.g. panel.acme.gg). Repeat it for several.');
    const tier = opts.tier || 'pro';
    if (!['core', 'pro'].includes(tier)) die('--tier must be core or pro');
    const addons = [].concat(opts.addon || []).filter(a => a && a !== true);
    let expires = null;
    if (opts.expires && opts.expires !== true) expires = String(opts.expires);
    else if (opts.months) { const d = new Date(); d.setUTCMonth(d.getUTCMonth() + Number(opts.months)); expires = d.toISOString().slice(0, 10); }
    const payload = {
        v: 1,
        id: 'lic_' + crypto.randomBytes(6).toString('hex'),
        licensee: String(opts.to),
        tier,
        addons,
        domains,
        issued: new Date().toISOString().slice(0, 10),
        expires
    };
    const key = sign(payload);
    console.log(JSON.stringify(payload, null, 2));
    console.log('\nLICENSE_KEY=' + key);
}

function readPrivateKey() {
    try {
        return crypto.createPrivateKey(fs.readFileSync(privPath));
    } catch (e) {
        if (e.code === 'EACCES') die(`Can't read ${privPath} (it belongs to another user, usually because keygen ran with sudo).\nFix it with:\n  sudo chown $(whoami) "${privPath}"`);
        if (e.code === 'ENOENT') die(`No private key at ${privPath}. Run: node scripts/license.js keygen`);
        throw e;
    }
}

function sign(payload) {
    const body = b64url(JSON.stringify(payload));
    const sig = crypto.sign(null, Buffer.from(body), readPrivateKey());
    const key = body + '.' + b64url(sig);
    try {
        fs.appendFileSync(path.join(root, 'issued-licenses.log'),
            `${new Date().toISOString()}\t${payload.id}\t${payload.licensee}\t${payload.tier}\t${(payload.addons || []).join(',') || '-'}\t${(payload.domains || []).join(',') || 'any domain'}\t${payload.expires || 'never'}\t${key}\n`, { mode: 0o600 });
    } catch (e) { }
    return key;
}

const git = (...argv) => execFileSync('git', argv, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// Commit and push lib/license.js (the public key) if it changed. Never touches anything else.
function pushPublicKey() {
    try { git('rev-parse', '--is-inside-work-tree'); } catch (e) { console.log('\n(Not a git checkout, so nothing was pushed.)'); return; }
    try { git('check-ignore', '-q', path.relative(root, privPath)); } catch (e) {
        if (privPath.startsWith(root)) die(`Refusing to push: ${path.relative(root, privPath)} is not git-ignored. Add it to .gitignore first.`);
    }
    const changed = git('status', '--porcelain', '--', 'lib/license.js');
    if (!changed) { console.log('\nlib/license.js is already up to date on git. Nothing to push.'); return; }
    git('add', '--', 'lib/license.js');
    git('commit', '-m', 'Enable licence checks', '--', 'lib/license.js');
    const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
    console.log(`\nPushing the public key to ${branch}...`);
    try {
        execFileSync('git', ['push', 'origin', branch], { cwd: root, stdio: 'inherit' });
        console.log('Pushed. Licensing is enforced once the API redeploys: set LICENSE_KEY first.');
    } catch (e) {
        console.log(`Push failed. The commit is saved locally; fix the problem above and run: git push origin ${branch}`);
    }
}

// Pro + every add-on, short-lived, for trying the full product. Any domain unless given.
function demo(opts) {
    if (!fs.existsSync(privPath)) {
        if (existingPublicKey()) die(`No private key at ${privPath}, but lib/license.js already has your public key.\nCopy your license-private.pem into ${root} and run this again.`);
        keygen({});
    }
    const days = Math.max(1, Math.min(3650, Number(opts.days) || 30));
    const domains = [].concat(opts.domain || []).filter(d => d && d !== true);
    const expires = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    const { ADDON_FEATURES } = require('../lib/license');
    const payload = {
        v: 1,
        id: 'lic_demo_' + crypto.randomBytes(5).toString('hex'),
        licensee: opts.to && opts.to !== true ? String(opts.to) : 'Demo',
        tier: 'pro',
        addons: Object.keys(ADDON_FEATURES),
        domains,
        issued: new Date().toISOString().slice(0, 10),
        expires
    };
    const key = sign(payload);
    console.log(`\nPro demo licence for "${payload.licensee}": every feature and add-on, valid until ${expires}${domains.length ? ` on ${domains.join(', ')}` : ' on any domain'}.`);
    console.log('\nLICENSE_KEY=' + key);
    console.log('\nPut it in LICENSE_KEY on the API (e.g. Render > Environment) and restart. For Discord, also set ADDON_DISCORD=true.');
    if (opts['no-push']) console.log('(--no-push: nothing was committed.)');
    else pushPublicKey();
}

function inspect(key) {
    if (!key) die('Usage: node scripts/license.js inspect <key>');
    const lic = require('../lib/license');
    try {
        const payload = JSON.parse(Buffer.from(key.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
        console.log(JSON.stringify(payload, null, 2));
    } catch (e) { die('That is not a licence key.'); }
    const r = lic.verifyKey(key, lic.SELLER_PUBLIC_KEY, {});
    console.log(r.ok ? '\nValid.' : `\nNot valid: ${r.reason}`);
}

const a = args(process.argv.slice(2));
const cmd = a._[0];
if (cmd === 'keygen') keygen(a);
else if (cmd === 'issue') issue(a);
else if (cmd === 'inspect') inspect(a._[1]);
else if (cmd === 'demo') demo(a);
else {
    console.log('Usage: node scripts/license.js keygen | issue --to NAME --domain HOST [--tier pro] [--addon discord] [--months 12] | demo [--to NAME] [--days 30] [--domain HOST] [--no-push] | inspect KEY');
    process.exit(cmd ? 1 : 0);
}
