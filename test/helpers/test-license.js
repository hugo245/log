'use strict';
// Test-only licensing. Preloaded into the server by tests (node -r ./test/helpers/test-license.js)
// so they can run with a real, signed licence without the seller's private key: the licence
// module is loaded with a throwaway public key that only the test knows the private half of.
// Nothing in production reads TEST_LICENSE_PUBLIC_KEY; this file is never loaded there.
const Module = require('module');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const LICENSE_FILE = path.join(__dirname, '..', '..', 'lib', 'license.js');

if (require.main !== module && process.env.TEST_LICENSE_PUBLIC_KEY) {
    const src = fs.readFileSync(LICENSE_FILE, 'utf8')
        .replace(/const SELLER_PUBLIC_KEY = [^;]*;/, `const SELLER_PUBLIC_KEY = ${JSON.stringify(process.env.TEST_LICENSE_PUBLIC_KEY)};`);
    const m = new Module(LICENSE_FILE, null);
    m.filename = LICENSE_FILE;
    m.paths = Module._nodeModulePaths(path.dirname(LICENSE_FILE));
    m._compile(src, LICENSE_FILE);
    m.loaded = true;
    require.cache[LICENSE_FILE] = m;
}

// Returns { execArgv, env } for spawning server.js with a licence of the given shape.
function licensedServer({ tier = 'pro', addons = ['discord'], domains = [] } = {}) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const b64 = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const body = b64(JSON.stringify({ v: 1, id: 'lic_test', licensee: 'Test', tier, addons, domains, issued: '2026-01-01', expires: null }));
    const sig = crypto.sign(null, Buffer.from(body), privateKey);
    return {
        execArgv: ['-r', __filename],
        env: { TEST_LICENSE_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }).trim(), LICENSE_KEY: `${body}.${b64(sig)}` }
    };
}

module.exports = { licensedServer };
