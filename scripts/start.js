'use strict';
// Starts the API, plus the Discord bot when the Discord add-on is on.
// If either process exits with an error, the other is stopped too so your host restarts both.
require('dotenv').config();
const path = require('path');
const { spawn } = require('child_process');
const studio = require('../lib/studio');

const root = path.join(__dirname, '..');
const children = [];
let stopping = false;

function run(file) {
    const child = spawn(process.execPath, [path.join(root, file)], { stdio: 'inherit', env: process.env });
    child.on('exit', (code, signal) => {
        if (stopping) return;
        if (file === 'bot.js' && code === 0) return; // bot chose not to run
        console.error(`[start] ${file} exited (${signal || code}). Stopping.`);
        stop(code || 1);
    });
    children.push(child);
}

function stop(code) {
    stopping = true;
    children.forEach(c => { try { c.kill('SIGTERM'); } catch (e) { } });
    setTimeout(() => process.exit(code), 500).unref();
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

run('server.js');
if (studio.addon('discord')) run('bot.js');
