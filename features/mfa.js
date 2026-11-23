'use strict';
// Two-factor sign-in with an authenticator app, plus recovery codes.
//
// After someone with 2FA signs in, their session is "pending" until they enter a code: the
// API refuses everything except mfa_verify_login. A studio can also require 2FA for anyone
// whose role can move money or see sensitive data (Security > Two-factor sign-in); those
// people can only set up 2FA until they've done it.
//
// Secrets are encrypted with a key derived from SESSION_SECRET. Changing SESSION_SECRET
// means everyone has to set 2FA up again (an admin can reset people from Security).

const crypto = require('crypto');
const totp = require('../lib/totp');

module.exports = function mfa(ctx) {
    const { supabase, requirePermission, hasPermission, logAudit, logSecurityEvent, security, studio } = ctx;
    const SENSITIVE = ['dashboard.mark_paid', 'payouts.view_bank_details', 'security.manage', 'roles.manage', 'tax.view', 'backups.manage'];
    const PENDING_OK = new Set(['mfa_verify_login', 'mfa_status']);
    const SETUP_OK = new Set(['list_my_sessions', 'revoke_my_session', 'mfa_status', 'mfa_begin_setup', 'mfa_confirm_setup', 'mfa_verify_login', 'get_tour_state', 'mark_tour_seen', 'list_onboarding_steps', 'get_my_onboarding', 'complete_onboarding_step', 'count_unread_notifications', 'list_notifications']);

    const key = crypto.createHash('sha256').update('studio-mfa:' + (process.env.SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '')).digest();
    function encrypt(text) {
        const iv = crypto.randomBytes(12);
        const c = crypto.createCipheriv('aes-256-gcm', key, iv);
        const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
        return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
    }
    function decrypt(blob) {
        try {
            const [v, iv, tag, data] = String(blob || '').split('.');
            if (v !== 'v1') return null;
            const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
            d.setAuthTag(Buffer.from(tag, 'base64'));
            return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
        } catch (e) { return null; }
    }
    const hashRc = (code) => security.hashToken('mfa-rc:' + String(code || '').toLowerCase().replace(/[^a-z0-9]/g, ''));

    const enrolledCache = new Map();
    async function isEnabledFor(userId) {
        const hit = enrolledCache.get(String(userId));
        if (hit && Date.now() - hit.at < 30000) return hit.on;
        let on = false;
        try {
            const { data, error } = await supabase.from('user_mfa').select('enabled').eq('roblox_user_id', userId).maybeSingle();
            on = !error && !!(data && data.enabled);
        } catch (e) { on = false; }
        enrolledCache.set(String(userId), { on, at: Date.now() });
        return on;
    }
    let policyCache = { at: 0, on: false };
    async function policyOn() {
        if (Date.now() - policyCache.at < 30000) return policyCache.on;
        let on = false;
        try {
            const { data, error } = await supabase.from('app_settings').select('mfa_required').eq('id', 1).maybeSingle();
            on = !error && !!(data && data.mfa_required);
        } catch (e) { on = false; }
        policyCache = { at: Date.now(), on };
        return on;
    }
    const isSensitive = (session) => SENSITIVE.some(p => hasPermission(session, p));

    async function statusFor(session) {
        const [enrolled, policy] = await Promise.all([isEnabledFor(session.roblox_user_id), policyOn()]);
        return { enrolled, pending: !!session.mfa_pending, policy, required: policy && isSensitive(session), setupRequired: policy && isSensitive(session) && !enrolled };
    }

    // Called for every /hr-data request. Returns an error code to refuse with, or null.
    async function gate(session, action) {
        if (session.mfa_pending && !PENDING_OK.has(action)) return 'mfa_required';
        if (SETUP_OK.has(action)) return null;
        if (!isSensitive(session) || !(await policyOn())) return null;
        return (await isEnabledFor(session.roblox_user_id)) ? null : 'mfa_setup_required';
    }

    async function loadRow(userId) {
        const { data } = await supabase.from('user_mfa').select('*').eq('roblox_user_id', userId).maybeSingle();
        return data || null;
    }

    async function checkCode(row, code) {
        const secret = decrypt(row.secret_encrypted);
        if (!secret) return { ok: false };
        const step = totp.verify(secret, code, { lastStep: Number(row.last_step) || -1 });
        if (step > 0) {
            await supabase.from('user_mfa').update({ last_step: step, last_used_at: new Date().toISOString() }).eq('roblox_user_id', row.roblox_user_id);
            return { ok: true, method: 'code' };
        }
        const hashes = Array.isArray(row.recovery_hashes) ? row.recovery_hashes : [];
        const h = hashRc(code);
        if (String(code || '').replace(/[^a-z0-9]/gi, '').length >= 10 && hashes.includes(h)) {
            await supabase.from('user_mfa').update({ recovery_hashes: hashes.filter(x => x !== h), last_used_at: new Date().toISOString() }).eq('roblox_user_id', row.roblox_user_id);
            return { ok: true, method: 'recovery', left: hashes.length - 1 };
        }
        return { ok: false };
    }

    const issuer = () => [studio.get().studio.name, studio.get().studio.productName].filter(Boolean).join(' ') || 'Studio Panel';

    const actions = {
        mfa_status: {
            run: async ({ session, res }) => {
                const st = await statusFor(session);
                const row = st.enrolled ? await loadRow(session.roblox_user_id) : null;
                res.json({ ok: true, data: { ...st, recoveryLeft: row && Array.isArray(row.recovery_hashes) ? row.recovery_hashes.length : 0, enabledAt: row ? row.enabled_at : null } });
            }
        },
        mfa_begin_setup: {
            run: async ({ session, res }) => {
                if (await isEnabledFor(session.roblox_user_id)) { res.status(409).json({ ok: false, error: 'already_enabled' }); return; }
                const secret = totp.generateSecret();
                const { error } = await supabase.from('user_mfa').upsert({
                    roblox_user_id: session.roblox_user_id, roblox_username: session.roblox_username,
                    secret_encrypted: encrypt(secret), enabled: false, recovery_hashes: [], last_step: -1, created_at: new Date().toISOString()
                }, { onConflict: 'roblox_user_id' });
                if (error) { res.status(500).json({ ok: false, error: 'database_update_needed' }); return; }
                res.json({ ok: true, data: { secret, uri: totp.otpauthUri(secret, session.roblox_username || String(session.roblox_user_id), issuer()) } });
            }
        },
        mfa_confirm_setup: {
            run: async ({ session, payload, res }) => {
                if (!security.checkRate(res, `mfa:${session.roblox_user_id}`, 10, 10 * 60 * 1000)) return;
                const row = await loadRow(session.roblox_user_id);
                if (!row || row.enabled) { res.status(409).json({ ok: false, error: 'start_again' }); return; }
                const secret = decrypt(row.secret_encrypted);
                const step = secret ? totp.verify(secret, payload.code) : -1;
                if (step < 0) { res.status(400).json({ ok: false, error: 'code_wrong' }); return; }
                const codes = totp.recoveryCodes(10);
                await supabase.from('user_mfa').update({ enabled: true, enabled_at: new Date().toISOString(), last_step: step, recovery_hashes: codes.map(hashRc) }).eq('roblox_user_id', session.roblox_user_id);
                enrolledCache.delete(String(session.roblox_user_id));
                logSecurityEvent({ kind: 'mfa_enabled', severity: 'info', session, targetUserId: session.roblox_user_id, targetUsername: session.roblox_username, detail: 'Turned on two-factor sign-in' });
                logAudit(session, { category: 'security', action: 'mfa_enabled', targetUserId: session.roblox_user_id, targetUsername: session.roblox_username, details: {} });
                res.json({ ok: true, data: { recoveryCodes: codes } });
            }
        },
        mfa_verify_login: {
            run: async ({ session, payload, res }) => {
                if (!security.checkRate(res, `mfa:${session.roblox_user_id}`, 10, 10 * 60 * 1000)) return;
                const row = await loadRow(session.roblox_user_id);
                if (!row || !row.enabled) { await supabase.from('hr_sessions').update({ mfa_pending: false }).eq('token', session.token); ctx.invalidateSessions(); res.json({ ok: true }); return; }
                const r = await checkCode(row, payload.code);
                if (!r.ok) {
                    logSecurityEvent({ kind: 'mfa_failed', severity: 'notice', session, targetUserId: session.roblox_user_id, targetUsername: session.roblox_username, detail: 'Wrong two-factor code at sign-in' });
                    res.status(400).json({ ok: false, error: 'code_wrong' }); return;
                }
                await supabase.from('hr_sessions').update({ mfa_pending: false }).eq('token', session.token);
                ctx.invalidateSessions();
                if (r.method === 'recovery') logSecurityEvent({ kind: 'mfa_recovery_used', severity: 'notice', session, targetUserId: session.roblox_user_id, targetUsername: session.roblox_username, detail: `Signed in with a recovery code (${r.left} left)` });
                res.json({ ok: true, usedRecovery: r.method === 'recovery', recoveryLeft: r.left });
            }
        },
        mfa_disable: {
            run: async ({ session, payload, res }) => {
                if (!security.checkRate(res, `mfa:${session.roblox_user_id}`, 10, 10 * 60 * 1000)) return;
                const st = await statusFor(session);
                if (st.required) { res.status(403).json({ ok: false, error: 'mfa_required_by_policy' }); return; }
                const row = await loadRow(session.roblox_user_id);
                if (!row || !row.enabled) { res.json({ ok: true }); return; }
                const r = await checkCode(row, payload.code);
                if (!r.ok) { res.status(400).json({ ok: false, error: 'code_wrong' }); return; }
                await supabase.from('user_mfa').delete().eq('roblox_user_id', session.roblox_user_id);
                enrolledCache.delete(String(session.roblox_user_id));
                logSecurityEvent({ kind: 'mfa_disabled', severity: 'notice', session, targetUserId: session.roblox_user_id, targetUsername: session.roblox_username, detail: 'Turned off two-factor sign-in' });
                res.json({ ok: true });
            }
        },
        mfa_new_recovery_codes: {
            run: async ({ session, payload, res }) => {
                if (!security.checkRate(res, `mfa:${session.roblox_user_id}`, 10, 10 * 60 * 1000)) return;
                const row = await loadRow(session.roblox_user_id);
                if (!row || !row.enabled) { res.status(409).json({ ok: false, error: 'not_enabled' }); return; }
                const r = await checkCode(row, payload.code);
                if (!r.ok) { res.status(400).json({ ok: false, error: 'code_wrong' }); return; }
                const codes = totp.recoveryCodes(10);
                await supabase.from('user_mfa').update({ recovery_hashes: codes.map(hashRc) }).eq('roblox_user_id', session.roblox_user_id);
                res.json({ ok: true, data: { recoveryCodes: codes } });
            }
        },
        mfa_admin_overview: {
            run: async ({ session, res }) => {
                if (!requirePermission(res, session, 'security.manage')) return;
                const [{ data: rows, error }, policy] = await Promise.all([
                    supabase.from('user_mfa').select('roblox_user_id, roblox_username, enabled, enabled_at, last_used_at').eq('enabled', true),
                    policyOn()
                ]);
                if (error) { res.status(500).json({ ok: false, error: 'database_update_needed' }); return; }
                res.json({ ok: true, data: { policy, enrolled: rows || [] } });
            }
        },
        mfa_set_policy: {
            run: async ({ session, payload, res }) => {
                if (!requirePermission(res, session, 'security.manage')) return;
                const on = payload.required === true;
                if (on && !(await isEnabledFor(session.roblox_user_id))) { res.status(409).json({ ok: false, error: 'enable_yours_first' }); return; }
                const { error } = await supabase.from('app_settings').update({ mfa_required: on }).eq('id', 1);
                if (error) { res.status(500).json({ ok: false, error: 'database_update_needed' }); return; }
                policyCache.at = 0;
                logSecurityEvent({ kind: 'mfa_policy_changed', severity: 'notice', session, detail: on ? 'Required two-factor sign-in for sensitive roles' : 'Stopped requiring two-factor sign-in' });
                logAudit(session, { category: 'security', action: 'mfa_policy', details: { required: on } });
                res.json({ ok: true });
            }
        },
        mfa_reset_user: {
            run: async ({ session, payload, res }) => {
                if (!requirePermission(res, session, 'security.manage')) return;
                const userId = Number(payload.robloxUserId);
                if (!userId || String(userId) === String(session.roblox_user_id)) { res.status(400).json({ ok: false, error: 'invalid_fields' }); return; }
                const { data: row } = await supabase.from('user_mfa').select('roblox_username').eq('roblox_user_id', userId).maybeSingle();
                await supabase.from('user_mfa').delete().eq('roblox_user_id', userId);
                await supabase.from('hr_sessions').delete().eq('roblox_user_id', userId);
                ctx.invalidateSessions();
                enrolledCache.delete(String(userId));
                logSecurityEvent({ kind: 'mfa_reset', severity: 'warning', session, targetUserId: userId, targetUsername: row ? row.roblox_username : null, detail: 'Reset two-factor sign-in and signed them out' });
                logAudit(session, { category: 'security', action: 'mfa_reset', targetUserId: userId, targetUsername: row ? row.roblox_username : null, details: {} });
                res.json({ ok: true });
            }
        }
    };

    return { actions, gate, statusFor, isEnabledFor };
};
