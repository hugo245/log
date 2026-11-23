'use strict';
// Operations: error monitoring, backup retention and the public status page.
//
//   - Server errors (unhandled action errors, crashes) and browser errors are grouped by
//     fingerprint into error_events, so one bug shows up once with a count, not 500 times.
//   - A new kind of error (or one that keeps happening) raises an alert: ALERT_WEBHOOK_URL
//     if set (for whoever runs the deployment), otherwise the studio's own webhook
//     (Settings > Notifications, event "system_alert").
//   - Backups older than BACKUP_RETENTION_DAYS are deleted, always keeping the newest
//     BACKUP_KEEP_MIN. If scheduled backups stop happening, that raises an alert too.
//   - /public/status gives a coarse, safe health summary for the #/status page.

const crypto = require('crypto');

const STARTED_AT = Date.now();
const RETENTION_DAYS = Math.max(1, Number(process.env.BACKUP_RETENTION_DAYS) || 30);
const KEEP_MIN = Math.max(1, Number(process.env.BACKUP_KEEP_MIN) || 10);
const BACKUP_STALE_HOURS = Math.max(1, Number(process.env.BACKUP_STALE_HOURS) || 14);
const ALERT_WEBHOOK_URL = /^https:\/\/[^\s"'<>]+$/i.test(process.env.ALERT_WEBHOOK_URL || '') ? process.env.ALERT_WEBHOOK_URL : null;
const ALERT_REPEAT_MS = 60 * 60 * 1000;

// Never store anything that looks like a credential, even if it ends up in an error.
function scrub(text, max) {
    return String(text == null ? '' : text)
        .replace(/(session|token|rt|ticket|code|state|key|secret|password|authorization)=([^&\s#"']+)/gi, '$1=[removed]')
        .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [removed]')
        .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g, '[jwt removed]')
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
        .slice(0, max || 2000);
}

function fingerprintOf(source, message, stack) {
    // Group by the error message (numbers stripped) and the first line of our own code.
    const firstFrame = String(stack || '').split('\n').find(l => /\.js:\d+/.test(l) && !/node_modules|node:internal/.test(l)) || '';
    const normalised = String(message || '').replace(/\d+/g, 'N').replace(/["'][^"']{0,80}["']/g, '"…"').slice(0, 300);
    return crypto.createHash('sha1').update(`${source}|${normalised}|${firstFrame.replace(/:\d+:\d+\)?$/, '').trim()}`).digest('hex').slice(0, 20);
}

module.exports = function monitor(ctx) {
    const { supabase, requirePermission, hasPermission, studio, runBackup } = ctx;
    const lastAlertAt = new Map();
    let tableMissingLogged = false;

    async function alert(text) {
        const brand = [studio.get().studio.name, studio.get().studio.productName].filter(Boolean).join(' ');
        const message = `[${brand}] ${text}`;
        try {
            if (ALERT_WEBHOOK_URL) {
                const body = /discord(app)?\.com\/api\/webhooks/.test(ALERT_WEBHOOK_URL) ? { content: message.slice(0, 1900) } : { text: message.slice(0, 3000) };
                await fetch(ALERT_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
                return true;
            }
            if (ctx.studioEvent) return await ctx.studioEvent('system_alert', message, '#/manage?tab=health');
        } catch (e) { /* alerts must never throw */ }
        return false;
    }

    // Records one error occurrence. Safe to call from anywhere: it never throws.
    // Occurrences of the same error are queued so simultaneous ones are counted, not raced.
    const queues = new Map();
    function capture(err, info) {
        const source = (info && info.source) || 'server';
        const key = fingerprintOf(source, scrub(err && err.message ? err.message : err, 500), scrub(err && err.stack ? err.stack : '', 4000));
        const prev = queues.get(key) || Promise.resolve();
        const next = prev.then(() => captureNow(err, info)).catch(() => { });
        queues.set(key, next);
        next.then(() => { if (queues.get(key) === next) queues.delete(key); });
        return next;
    }

    async function captureNow(err, info) {
        try {
            const source = (info && info.source) || 'server';
            const message = scrub(err && err.message ? err.message : err, 500) || 'Unknown error';
            const stack = scrub(err && err.stack ? err.stack : '', 4000);
            const context = {};
            if (info) {
                ['action', 'url', 'userAgent', 'route', 'line'].forEach(k => { if (info[k] != null) context[k] = scrub(info[k], 300); });
            }
            const fingerprint = fingerprintOf(source, message, stack);
            const now = new Date().toISOString();
            const { data: existing, error: readErr } = await supabase.from('error_events')
                .select('id, count, resolved_at').eq('fingerprint', fingerprint).maybeSingle();
            if (readErr) {
                if (!tableMissingLogged) { tableMissingLogged = true; console.warn('[monitor] error_events table missing - run sql/upgrade.sql to keep an error log.'); }
                return;
            }
            let isNew = false;
            if (existing) {
                await supabase.from('error_events').update({
                    count: (Number(existing.count) || 0) + 1, last_seen_at: now, message, stack, context,
                    // A bug that comes back after being marked fixed is open again.
                    resolved_at: null
                }).eq('id', existing.id);
                isNew = !!existing.resolved_at;
            } else {
                const { error: insErr } = await supabase.from('error_events').insert({ fingerprint, source, message, stack, context, count: 1, first_seen_at: now, last_seen_at: now });
                if (insErr && insErr.code === '23505') {
                    // Another server instance recorded it first: count this one on that row.
                    const { data: row } = await supabase.from('error_events').select('id, count').eq('fingerprint', fingerprint).maybeSingle();
                    if (row) await supabase.from('error_events').update({ count: (Number(row.count) || 0) + 1, last_seen_at: now }).eq('id', row.id);
                } else {
                    isNew = true;
                }
            }
            const last = lastAlertAt.get(fingerprint) || 0;
            if (isNew || Date.now() - last > ALERT_REPEAT_MS) {
                lastAlertAt.set(fingerprint, Date.now());
                if (source === 'server' || isNew) await alert(`${isNew ? 'New error' : 'Error still happening'} (${source}): ${message}${context.action ? ` [${context.action}]` : ''}`);
            }
        } catch (e) {
            console.error('[monitor] could not record error:', e && e.message);
        }
    }

    // ---------------------------------------------------------------------------------
    // Backups: retention and a dead-man's switch
    // ---------------------------------------------------------------------------------
    async function pruneBackups() {
        const { data: rows, error } = await supabase.from('backups').select('id, created_at').order('created_at', { ascending: false });
        if (error || !rows) return { deleted: 0 };
        const cutoff = Date.now() - RETENTION_DAYS * 86400000;
        const toDelete = rows.slice(KEEP_MIN).filter(r => new Date(r.created_at).getTime() < cutoff).map(r => r.id);
        if (toDelete.length) {
            const { error: delErr } = await supabase.from('backups').delete().in('id', toDelete);
            if (delErr) { console.error('[monitor] backup cleanup failed:', delErr.message); return { deleted: 0 }; }
            console.log(`[monitor] deleted ${toDelete.length} backup(s) older than ${RETENTION_DAYS} days`);
        }
        return { deleted: toDelete.length };
    }

    async function lastBackup() {
        const { data } = await supabase.from('backups').select('id, created_at, size_bytes, "trigger"').order('created_at', { ascending: false }).limit(1).maybeSingle();
        return data || null;
    }

    async function checkBackupsFresh() {
        // Give a freshly started deployment time to take its first backup.
        if (Date.now() - STARTED_AT < BACKUP_STALE_HOURS * 3600000) return;
        const last = await lastBackup();
        const age = last ? Date.now() - new Date(last.created_at).getTime() : Infinity;
        if (age > BACKUP_STALE_HOURS * 3600000) {
            const key = 'backup_stale';
            if (Date.now() - (lastAlertAt.get(key) || 0) > 6 * 3600000) {
                lastAlertAt.set(key, Date.now());
                await alert(last ? `No backup in the last ${BACKUP_STALE_HOURS} hours (last one ${last.created_at}).` : 'There are no backups yet.');
            }
        }
    }

    // ---------------------------------------------------------------------------------
    // Status
    // ---------------------------------------------------------------------------------
    let statusCache = { at: 0, data: null };
    async function status() {
        if (statusCache.data && Date.now() - statusCache.at < 15000) return statusCache.data;
        const started = Date.now();
        const { data: settings, error } = await supabase.from('app_settings')
            .select('closed, indev, services_down, status_message, status_started_at, status_eta').eq('id', 1).maybeSingle();
        const dbMs = Date.now() - started;
        const last = error ? null : await lastBackup();
        const backupAgeH = last ? (Date.now() - new Date(last.created_at).getTime()) / 3600000 : null;
        const components = [
            { key: 'api', name: 'Panel & sign-in', status: 'operational' },
            { key: 'database', name: 'Database', status: error ? 'down' : dbMs > 2500 ? 'degraded' : 'operational' },
            { key: 'backups', name: 'Backups', status: error ? 'unknown' : backupAgeH == null ? 'pending' : backupAgeH > BACKUP_STALE_HOURS ? 'degraded' : 'operational' }
        ];
        let overall = components.some(c => c.status === 'down') ? 'down' : components.some(c => c.status === 'degraded') ? 'degraded' : 'operational';
        if (settings && (settings.closed || settings.services_down)) overall = 'down';
        else if (settings && settings.indev && overall === 'operational') overall = 'maintenance';
        const data = {
            ok: true,
            overall,
            message: (settings && settings.status_message) || '',
            since: (settings && settings.status_started_at) || null,
            eta: (settings && settings.status_eta) || null,
            components,
            lastBackupAt: last ? last.created_at : null,
            uptimeSeconds: Math.round((Date.now() - STARTED_AT) / 1000),
            checkedAt: new Date().toISOString()
        };
        statusCache = { at: Date.now(), data };
        return data;
    }

    const canSeeHealth = (session) => hasPermission(session, 'audit.view') || hasPermission(session, 'security.manage') || hasPermission(session, 'backups.manage');

    return {
        capture,
        alert,
        start() {
            setTimeout(() => pruneBackups().catch(() => { }), 5 * 60 * 1000).unref();
            setInterval(() => pruneBackups().catch(() => { }), 24 * 3600000).unref();
            setInterval(() => checkBackupsFresh().catch(() => { }), 60 * 60 * 1000).unref();
        },
        routes(app) {
            app.get('/public/status', async (req, res) => {
                try {
                    res.setHeader('Cache-Control', 'no-cache');
                    res.json(await status());
                } catch (e) {
                    res.json({ ok: true, overall: 'degraded', components: [{ key: 'api', name: 'Panel & sign-in', status: 'operational' }, { key: 'database', name: 'Database', status: 'unknown' }], checkedAt: new Date().toISOString() });
                }
            });

            // Browser errors. Small, rate limited (the /public limiter plus a tight one here),
            // scrubbed of anything token-like, and only accepted from the app's own origin.
            app.post('/public/client-error', async (req, res) => {
                res.status(204).end();
                const origin = String(req.headers.origin || '');
                if (origin && origin !== ctx.APP_ORIGIN) return;
                const r = ctx.security.limiter.hit(`client-error:${ctx.security.clientIp(req)}`, 10, 60 * 1000);
                if (!r.ok) return;
                const b = req.body || {};
                if (typeof b.message !== 'string' || !b.message.trim()) return;
                await capture({ message: b.message, stack: typeof b.stack === 'string' ? b.stack : '' }, {
                    source: 'browser',
                    url: typeof b.url === 'string' ? b.url.split('?')[0] : null,
                    route: typeof b.route === 'string' ? b.route.split('?')[0] : null,
                    userAgent: req.headers['user-agent'] || null,
                    line: b.line != null ? String(b.line) : null
                });
            });
        },
        actions: {
            get_health: {
                run: async ({ session, res }) => {
                    if (!canSeeHealth(session)) { requirePermission(res, session, 'audit.view'); return; }
                    const [st, errorsRes, backupsRes] = await Promise.all([
                        status(),
                        supabase.from('error_events').select('*').order('last_seen_at', { ascending: false }).limit(50),
                        supabase.from('backups').select('id, created_at, size_bytes, "trigger", created_by').order('created_at', { ascending: false }).limit(10)
                    ]);
                    res.json({
                        ok: true,
                        data: {
                            status: st,
                            errors: errorsRes.error ? null : (errorsRes.data || []).map(e => ({
                                id: e.id, source: e.source, message: e.message, count: e.count, context: e.context || {},
                                firstSeenAt: e.first_seen_at, lastSeenAt: e.last_seen_at, resolvedAt: e.resolved_at,
                                stack: hasPermission(session, 'security.manage') ? e.stack : null
                            })),
                            backups: backupsRes.data || [],
                            retention: { days: RETENTION_DAYS, keepMin: KEEP_MIN, staleHours: BACKUP_STALE_HOURS },
                            alerts: { destination: ALERT_WEBHOOK_URL ? 'operator' : 'studio_webhook' }
                        }
                    });
                }
            },
            resolve_error: {
                run: async ({ session, payload, res }) => {
                    if (!canSeeHealth(session)) { requirePermission(res, session, 'audit.view'); return; }
                    const ids = (Array.isArray(payload.ids) ? payload.ids : [payload.id]).map(Number).filter(n => n > 0).slice(0, 200);
                    if (!ids.length) { res.status(400).json({ ok: false, error: 'missing_id' }); return; }
                    const { error } = await supabase.from('error_events').update({ resolved_at: new Date().toISOString() }).in('id', ids);
                    if (error) { res.status(500).json({ ok: false, error: 'server_error' }); return; }
                    res.json({ ok: true });
                }
            },
            prune_backups_now: {
                run: async ({ session, res }) => {
                    if (!requirePermission(res, session, 'backups.manage')) return;
                    const result = await pruneBackups();
                    res.json({ ok: true, ...result });
                }
            },
            send_test_alert: {
                run: async ({ session, res }) => {
                    if (!requirePermission(res, session, 'security.manage')) return;
                    const sent = await alert(`Test alert from ${session.roblox_username}. If you can read this, alerts work.`);
                    res.json({ ok: true, sent });
                }
            }
        },
        _internals: { scrub, fingerprintOf, pruneBackups, status }
    };
};
