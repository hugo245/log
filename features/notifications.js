'use strict';
// Notifications: the bell in the app, email, and an optional studio-wide webhook.
//
// notify(userId, ...) is how the rest of the API tells a person something. It always
// stores an in-app notification, emails them if they've confirmed an address (or signed in
// with Google), and sends a Discord DM too when the Discord add-on is on.
//
// studioEvent(...) posts studio-wide events (new requests, runs closed, security changes) to
// a webhook URL set in Settings. Discord and Slack webhook URLs both work; anything else gets
// a JSON body. This needs no bot, so it's part of the base product.

const crypto = require('crypto');
const mailer = require('../lib/mailer');

const KINDS = ['payment', 'request', 'task', 'contract', 'revenue', 'security', 'account', 'general'];
const WEBHOOK_EVENTS = ['request_submitted', 'request_approved', 'request_paid', 'run_closed', 'security_changed', 'budget_warning', 'contract_signed', 'revenue_recorded', 'system_alert'];

module.exports = function notifications(ctx) {
    const { supabase, studio, requirePermission, logAudit, security } = ctx;
    const studioName = () => studio.get().studio.name;
    const brand = () => [studio.get().studio.name, studio.get().studio.productName].filter(Boolean).join(' ');
    const appLink = (hash) => `${ctx.APP_ORIGIN}/${hash && hash.startsWith('#') ? hash : '#/home'}`;

    async function emailFor(userId) {
        const { data: prefs } = await supabase.from('notify_prefs').select('*').eq('roblox_user_id', userId).maybeSingle();
        if (prefs && prefs.email_enabled === false) return null;
        if (prefs && prefs.email && prefs.email_verified) return prefs.email;
        // People who sign in with Google already have a verified address.
        if (Number(userId) >= 1000000000000000) {
            const { data: acct } = await supabase.from('accounts').select('email, provider').eq('id', userId).maybeSingle();
            if (acct && acct.provider === 'google' && acct.email) return acct.email;
        }
        return null;
    }

    function firstLine(text) {
        const t = String(text || '').trim();
        const nl = t.indexOf('\n');
        return (nl > 0 ? t.slice(0, nl) : t).slice(0, 140);
    }

    // Tell one person something. Never throws.
    async function notify(userId, { kind, title, body, link } = {}) {
        if (userId == null || userId === '') return false;
        const row = {
            roblox_user_id: Number(userId),
            kind: KINDS.includes(kind) ? kind : 'general',
            title: String(title || firstLine(body) || 'Update').slice(0, 160),
            body: String(body || '').slice(0, 2000),
            link: typeof link === 'string' && /^#\/[a-zA-Z0-9/_\-?=&%.]*$/.test(link) ? link : null,
            created_at: new Date().toISOString()
        };
        let stored = false;
        try {
            const { error } = await supabase.from('notifications').insert(row);
            stored = !error;
            if (error && !/notifications/.test(error.message || '')) console.error('[notify] insert failed:', error.message);
        } catch (e) { }
        // Email and Discord happen in the background so callers never wait on them.
        (async () => {
            try {
                const to = await emailFor(row.roblox_user_id);
                if (to) {
                    const text = `${row.body || row.title}${row.link ? `\n\n${appLink(row.link)}` : ''}`;
                    await mailer.send({
                        to,
                        subject: `${row.title} · ${brand()}`,
                        text,
                        html: mailer.layout({ studioName: brand(), title: row.title, text: row.body && row.body !== row.title ? row.body : '', link: row.link ? appLink(row.link) : null, linkLabel: 'Open in the panel', accent: studio.get().theme.accent })
                    });
                }
            } catch (e) { }
            try { if (ctx.discordDM) await ctx.discordDM(row.roblox_user_id, row.body || row.title); } catch (e) { }
        })();
        return stored;
    }

    let webhookCache = { at: 0, url: null, events: null };
    async function webhookConfig() {
        if (Date.now() - webhookCache.at < 30000) return webhookCache;
        try {
            const { data } = await supabase.from('app_settings').select('notify_webhook_url, notify_webhook_events').eq('id', 1).maybeSingle();
            webhookCache = { at: Date.now(), url: (data && data.notify_webhook_url) || null, events: (data && Array.isArray(data.notify_webhook_events)) ? data.notify_webhook_events : WEBHOOK_EVENTS };
        } catch (e) { webhookCache = { at: Date.now(), url: null, events: [] }; }
        return webhookCache;
    }

    async function postWebhook(url, text, event) {
        const isDiscord = /^https:\/\/(?:\w+\.)?discord(?:app)?\.com\/api\/webhooks\//.test(url);
        const isSlack = /^https:\/\/hooks\.slack\.com\//.test(url);
        const body = isDiscord ? { content: text.slice(0, 1900), allowed_mentions: { parse: [] }, username: brand().slice(0, 80) }
            : isSlack ? { text }
                : { event, text, studio: studioName(), at: new Date().toISOString() };
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        return r.ok;
    }

    // Studio-wide event to the webhook, if one is set and this event is switched on.
    async function studioEvent(event, text, link) {
        try {
            const cfg = await webhookConfig();
            if (!cfg.url || !(cfg.events || []).includes(event)) return false;
            return await postWebhook(cfg.url, link ? `${text}\n${appLink(link)}` : text, event);
        } catch (e) { return false; }
    }

    function cleanWebhookUrl(v) {
        const s = String(v || '').trim();
        if (!s) return '';
        if (!/^https:\/\/[^\s"'<>]+$/i.test(s) || s.length > 500) return null;
        return s;
    }

    const hashCode = (userId, code) => security.hashToken(`notify-email:${userId}:${code}`);

    const actions = {
        list_notifications: {
            run: async ({ session, payload, res }) => {
                const limit = Math.max(1, Math.min(50, Number(payload.limit) || 30));
                const [listRes, countRes] = await Promise.all([
                    supabase.from('notifications').select('*').eq('roblox_user_id', session.roblox_user_id).order('created_at', { ascending: false }).limit(limit),
                    supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('roblox_user_id', session.roblox_user_id).is('read_at', null)
                ]);
                if (listRes.error) { res.json({ ok: true, data: [], unread: 0, unavailable: true }); return; }
                res.json({ ok: true, data: listRes.data || [], unread: countRes.count || 0 });
            }
        },
        count_unread_notifications: {
            run: async ({ session, res }) => {
                const { count, error } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('roblox_user_id', session.roblox_user_id).is('read_at', null);
                res.json({ ok: true, unread: error ? 0 : (count || 0) });
            }
        },
        mark_notifications_read: {
            run: async ({ session, payload, res }) => {
                let q = supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('roblox_user_id', session.roblox_user_id).is('read_at', null);
                if (Array.isArray(payload.ids) && payload.ids.length) q = q.in('id', payload.ids.slice(0, 100).map(Number).filter(Boolean));
                await q;
                res.json({ ok: true });
            }
        },
        get_notify_prefs: {
            run: async ({ session, res }) => {
                const { data } = await supabase.from('notify_prefs').select('email, email_verified, email_enabled').eq('roblox_user_id', session.roblox_user_id).maybeSingle();
                let googleEmail = null;
                if (Number(session.roblox_user_id) >= 1000000000000000) {
                    const { data: acct } = await supabase.from('accounts').select('email, provider').eq('id', session.roblox_user_id).maybeSingle();
                    if (acct && acct.provider === 'google') googleEmail = acct.email || null;
                }
                res.json({
                    ok: true,
                    data: {
                        email: (data && data.email) || null,
                        verified: !!(data && data.email_verified),
                        enabled: !data || data.email_enabled !== false,
                        googleEmail,
                        emailAvailable: mailer.configured()
                    }
                });
            }
        },
        set_notify_email: {
            run: async ({ session, payload, res }) => {
                if (!mailer.configured()) { res.status(400).json({ ok: false, error: 'email_not_configured' }); return; }
                const email = String(payload.email || '').trim().toLowerCase();
                if (!/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(email) || email.length > 160) { res.status(400).json({ ok: false, error: 'invalid_email' }); return; }
                if (!security.checkRate(res, `notify-email:${session.roblox_user_id}`, 4, 15 * 60 * 1000)) return;
                const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
                const expires = new Date(Date.now() + 20 * 60 * 1000).toISOString();
                const { error } = await supabase.from('notify_prefs').upsert({
                    roblox_user_id: session.roblox_user_id, email, email_verified: false,
                    email_code_hash: hashCode(session.roblox_user_id, code), email_code_expires: expires,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'roblox_user_id' });
                if (error) { res.status(500).json({ ok: false, error: 'server_error' }); return; }
                const sent = await mailer.send({
                    to: email,
                    subject: `Your code: ${code} · ${brand()}`,
                    text: `Your confirmation code is ${code}. It expires in 20 minutes. If you didn't ask for this, ignore this email.`,
                    html: mailer.layout({ studioName: brand(), title: `Your code is ${code}`, text: "Enter it in the panel to start getting emails. It expires in 20 minutes. If you didn't ask for this, you can ignore this email.", accent: studio.get().theme.accent })
                });
                if (!sent.sent) { res.status(502).json({ ok: false, error: 'email_send_failed' }); return; }
                res.json({ ok: true });
            }
        },
        verify_notify_email: {
            run: async ({ session, payload, res }) => {
                if (!security.checkRate(res, `notify-verify:${session.roblox_user_id}`, 10, 15 * 60 * 1000)) return;
                const code = String(payload.code || '').replace(/\D/g, '');
                const { data } = await supabase.from('notify_prefs').select('*').eq('roblox_user_id', session.roblox_user_id).maybeSingle();
                if (!data || !data.email_code_hash || new Date(data.email_code_expires).getTime() < Date.now()) { res.status(400).json({ ok: false, error: 'code_expired' }); return; }
                const a = Buffer.from(hashCode(session.roblox_user_id, code)); const b = Buffer.from(data.email_code_hash);
                if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) { res.status(400).json({ ok: false, error: 'code_wrong' }); return; }
                await supabase.from('notify_prefs').update({ email_verified: true, email_enabled: true, email_code_hash: null, email_code_expires: null, updated_at: new Date().toISOString() }).eq('roblox_user_id', session.roblox_user_id);
                res.json({ ok: true });
            }
        },
        set_notify_prefs: {
            run: async ({ session, payload, res }) => {
                const patch = { roblox_user_id: session.roblox_user_id, updated_at: new Date().toISOString() };
                if (typeof payload.enabled === 'boolean') patch.email_enabled = payload.enabled;
                if (payload.removeEmail === true) { patch.email = null; patch.email_verified = false; }
                const { error } = await supabase.from('notify_prefs').upsert(patch, { onConflict: 'roblox_user_id' });
                if (error) { res.status(500).json({ ok: false, error: 'server_error' }); return; }
                res.json({ ok: true });
            }
        },
        get_notify_webhook: {
            run: async ({ session, res }) => {
                if (!requirePermission(res, session, 'settings.manage_branding')) return;
                const { data } = await supabase.from('app_settings').select('notify_webhook_url, notify_webhook_events').eq('id', 1).maybeSingle();
                res.json({
                    ok: true,
                    data: {
                        url: (data && data.notify_webhook_url) || '',
                        events: (data && Array.isArray(data.notify_webhook_events)) ? data.notify_webhook_events : WEBHOOK_EVENTS,
                        allEvents: WEBHOOK_EVENTS,
                        emailConfigured: mailer.configured(),
                        emailProvider: mailer.provider()
                    }
                });
            }
        },
        save_notify_webhook: {
            run: async ({ session, payload, res }) => {
                if (!requirePermission(res, session, 'settings.manage_branding')) return;
                const url = cleanWebhookUrl(payload.url);
                if (url === null) { res.status(400).json({ ok: false, error: 'invalid_webhook' }); return; }
                const events = Array.isArray(payload.events) ? [...new Set(payload.events.filter(e => WEBHOOK_EVENTS.includes(e)))] : WEBHOOK_EVENTS;
                const { error } = await supabase.from('app_settings').update({ notify_webhook_url: url || null, notify_webhook_events: events }).eq('id', 1);
                if (error) { res.status(500).json({ ok: false, error: 'database_update_needed' }); return; }
                webhookCache.at = 0;
                logAudit(session, { category: 'settings', action: 'save_notify_webhook', details: { set: !!url, events } });
                res.json({ ok: true });
            }
        },
        test_notify_webhook: {
            run: async ({ session, payload, res }) => {
                if (!requirePermission(res, session, 'settings.manage_branding')) return;
                const url = cleanWebhookUrl(payload.url);
                if (!url) { res.status(400).json({ ok: false, error: 'invalid_webhook' }); return; }
                if (!security.checkRate(res, `webhook-test:${session.roblox_user_id}`, 5, 60 * 1000)) return;
                let ok = false;
                try { ok = await postWebhook(url, `Test message from ${brand()}. Notifications will arrive here.`, 'test'); } catch (e) { ok = false; }
                res.json({ ok: true, delivered: ok });
            }
        }
    };

    return { notify, studioEvent, actions, WEBHOOK_EVENTS };
};
