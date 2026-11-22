'use strict';
// Minimal in-memory stand-in for Supabase's REST API, enough for the session tests.
const http = require('http');

function createFakePostgrest(seed) {
    const tables = JSON.parse(JSON.stringify(seed || {}));
    const log = [];
    const parseFilters = (params) => {
        const filters = [];
        for (const [k, v] of params) {
            if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
            const m = /^(eq|neq|in|is|gte|lte|gt|lt|ilike)\.(.*)$/.exec(v);
            if (m) filters.push([k, m[1], m[2]]);
        }
        return filters;
    };
    const match = (row, [col, op, val]) => {
        const cell = row[col];
        if (op === 'eq') return String(cell) === decodeURIComponent(val);
        if (op === 'neq') return String(cell) !== decodeURIComponent(val);
        if (op === 'in') return decodeURIComponent(val).replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/^"|"$/g, '')).includes(String(cell));
        if (op === 'is') return val === 'null' ? cell == null : String(cell) === val;
        return true;
    };
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
            const url = new URL(req.url, 'http://x');
            const table = url.pathname.replace('/rest/v1/', '');
            log.push(`${req.method} ${table} ${url.search}`);
            const rows = tables[table] || (tables[table] = []);
            const filters = parseFilters(url.searchParams);
            const hits = rows.filter(r => filters.every(f => match(r, f)));
            const wantsObject = String(req.headers.accept || '').includes('vnd.pgrst.object');
            const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
            const reply = (data) => {
                if (wantsObject) {
                    if (data.length === 1) return send(200, data[0]);
                    return send(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `${data.length} rows` });
                }
                send(200, data);
            };
            if (req.method === 'GET' || req.method === 'HEAD') return reply(hits);
            if (req.method === 'POST') {
                const input = JSON.parse(body || '[]');
                const list = Array.isArray(input) ? input : [input];
                list.forEach(r => rows.push({ created_at: new Date().toISOString(), ...r }));
                return reply(list);
            }
            if (req.method === 'PATCH') {
                const patch = JSON.parse(body || '{}');
                hits.forEach(r => Object.assign(r, patch));
                return reply(hits);
            }
            if (req.method === 'DELETE') {
                tables[table] = rows.filter(r => !hits.includes(r));
                return reply(hits);
            }
            send(405, {});
        });
    });
    return { server, tables, log };
}

module.exports = { createFakePostgrest };
