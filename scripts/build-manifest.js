#!/usr/bin/env node
// Writes manifest.webmanifest (what phones and desktops use when someone installs the
// panel as an app) from studio.config.json, so the installed app has the studio's name
// and colours. Run by `npm run stamp`; run it on its own after changing the config.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(path.join(root, 'studio.config.json'), 'utf8')); } catch (e) { }
const studio = cfg.studio || {};
const theme = cfg.theme || {};
const name = [studio.name || 'Studio Panel', studio.productName].filter(Boolean).join(' ');
const hex = (v, d) => (/^#[0-9a-fA-F]{6}$/.test(v || '') ? v : d);

const manifest = {
    name,
    short_name: (studio.name || 'Studio Panel').slice(0, 12),
    description: `${name}: work, approvals and payouts.`,
    start_url: './#/home',
    scope: './',
    display: 'standalone',
    background_color: theme.defaultMode === 'dark' ? '#0C0D10' : '#F6F6F7',
    theme_color: hex(theme.accent, '#5B5FEF'),
    icons: [
        { src: 'assets/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'assets/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: 'assets/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
};
fs.writeFileSync(path.join(root, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Wrote manifest.webmanifest for "${name}"`);
