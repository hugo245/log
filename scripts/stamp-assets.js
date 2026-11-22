#!/usr/bin/env node
// Rewrites the ?v= query on every local asset in index.html to a hash of the file's
// contents, so browsers cache assets forever but pick up changes on the next deploy.
// Run it before you publish the frontend:  npm run stamp
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const indexPath = path.join(root, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
let count = 0;
html = html.replace(/(src|href)="((?:assets\/)?[a-zA-Z0-9_\-./]+\.(?:js|css))\?v=[^"]*"/g, (all, attr, file) => {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) return all;
    const hash = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex').slice(0, 10);
    count++;
    return `${attr}="${file}?v=${hash}"`;
});
fs.writeFileSync(indexPath, html);
console.log(`Stamped ${count} asset(s) in index.html`);
