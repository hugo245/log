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

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

function keygen(opts) {
    if (fs.existsSync(privPath) && !opts.force) die(`${privPath} already exists. Pass --force to replace it (every licence you issued stops working).`);
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
    const body = b64url(JSON.stringify(payload));
    const sig = crypto.sign(null, Buffer.from(body), crypto.createPrivateKey(fs.readFileSync(privPath)));
    console.log(JSON.stringify(payload, null, 2));
    console.log('\nLICENSE_KEY=' + body + '.' + b64url(sig));
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
else {
    console.log('Usage: node scripts/license.js keygen | issue --to NAME --domain HOST [--tier pro] [--addon discord] [--months 12] | inspect KEY');
    process.exit(cmd ? 1 : 0);
}
