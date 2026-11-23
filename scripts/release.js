#!/usr/bin/env node
// Bumps the release version (patch by default) and re-stamps the website so the API and the
// website agree on it. Usage: npm run release            -> 2.1.0 -> 2.1.1
//                             npm run release -- minor   -> 2.1.0 -> 2.2.0
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const part = (process.argv[2] || 'patch').toLowerCase();
const [major, minor, patch] = String(pkg.version || '0.0.0').split('.').map(n => parseInt(n, 10) || 0);
const next = part === 'major' ? `${major + 1}.0.0` : part === 'minor' ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
pkg.version = next;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 4) + '\n');
console.log(`Version ${major}.${minor}.${patch} -> ${next}`);
execFileSync(process.execPath, [path.join(__dirname, 'build-manifest.js')], { stdio: 'inherit' });
execFileSync(process.execPath, [path.join(__dirname, 'stamp-assets.js')], { stdio: 'inherit' });
console.log('Deploy the API and the website together; the site shows a maintenance screen until both are live.');
