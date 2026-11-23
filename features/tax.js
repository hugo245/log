'use strict';
// Tax details, receipts and year-end totals.
//
// People fill in the details a studio needs to pay contractors properly: a W-9 (US persons)
// or W-8BEN (everyone else) style form, signed with their typed name. Tax IDs and dates of
// birth are encrypted with AES-256-GCM using TAX_ENCRYPTION_KEY before they're stored, and
// only the last 4 digits are shown unless someone with tax.view reveals them (which is
// logged). Without TAX_ENCRYPTION_KEY, tax IDs can't be saved at all.
//
// This collects information; it doesn't file anything. Studios should check their own
// obligations with an accountant.

const crypto = require('crypto');

module.exports = function tax(ctx) {
    const { supabase, requirePermission, hasPermission, logAudit, logSecurityEvent, security, studio } = ctx;
    const FEATURE = 'taxForms';
    const FORMS = ['W9', 'W8BEN'];
    const CLASSIFICATIONS = ['individual', 'sole_proprietor', 'llc', 'c_corp', 's_corp', 'partnership', 'trust', 'other'];

    function keyBuf() {
        const hex = String(process.env.TAX_ENCRYPTION_KEY || '').trim();
        return /^[0-9a-fA-F]{64}$/.test(hex) ? Buffer.from(hex, 'hex') : null;
    }
    function encrypt(obj) {
        const key = keyBuf();
        if (!key) return null;
        const iv = crypto.randomBytes(12);
        const c = crypto.createCipheriv('aes-256-gcm', key, iv);
        const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
        return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
    }
    function decrypt(blob) {
        const key = keyBuf();
        if (!key || !blob) return null;
        try {
            const [v, iv, tag, data] = String(blob).split('.');
            if (v !== 'v1') return null;
            const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
            d.setAuthTag(Buffer.from(tag, 'base64'));
            return JSON.parse(Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8'));
        } catch (e) { return null; }
    }

    const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);

    function publicProfile(p) {
        if (!p) return null;
        return {
            formType: p.form_type, legalName: p.legal_name, businessName: p.business_name, classification: p.tax_classification,
            country: p.country, address1: p.address_line1, address2: p.address_line2, city: p.city, region: p.region, postalCode: p.postal_code,
            tinType: p.tin_type, tinLast4: p.tin_last4, hasDob: !!p.has_dob, signedName: p.signed_name, signedAt: p.signed_at, updatedAt: p.updated_at
        };
    }

    async function paidTotals(year) {
        const from = `${year}-01-01T00:00:00Z`;
        const to = `${Number(year) + 1}-01-01T00:00:00Z`;
        const { data } = await supabase.from('payment_requests').select('roblox_user_id, roblox_username, payment, currency, paid_at, status, paid')
            .gte('paid_at', from).lt('paid_at', to);
        const byUser = new Map();
        (data || []).filter(r => r.paid || r.status === 'paid').forEach(r => {
            const key = String(r.roblox_user_id || r.roblox_username);
            const row = byUser.get(key) || { robloxUserId: r.roblox_user_id, username: r.roblox_username, cash: 0, robux: 0, payments: 0 };
            if (r.currency === 'ROBUX') row.robux += Number(r.payment) || 0; else row.cash += Number(r.payment) || 0;
            row.payments++;
            byUser.set(key, row);
        });
        return [...byUser.values()];
    }

    const actions = {
        tax_get_mine: {
            feature: FEATURE,
            run: async ({ session, res }) => {
                const { data, error } = await supabase.from('tax_profiles').select('*').eq('roblox_user_id', session.roblox_user_id).maybeSingle();
                if (error) { res.status(500).json({ ok: false, error: 'database_update_needed' }); return; }
                res.json({ ok: true, data: publicProfile(data), encryptionReady: !!keyBuf() });
            }
        },
        tax_save_mine: {
            feature: FEATURE,
            run: async ({ session, payload, res }) => {
                if (!security.checkRate(res, `tax-save:${session.roblox_user_id}`, 10, 60 * 60 * 1000)) return;
                const formType = FORMS.includes(payload.formType) ? payload.formType : null;
                const legalName = clean(payload.legalName, 120);
                const country = clean(payload.country, 60);
                const address1 = clean(payload.address1, 160);
                const city = clean(payload.city, 80);
                const signedName = clean(payload.signedName, 120);
                const tin = String(payload.tin || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 30);
                const dob = String(payload.dob || '').trim();
                if (!formType || !legalName || !country || !address1 || !city || signedName.length < 2 || payload.certify !== true) {
                    res.status(400).json({ ok: false, error: 'invalid_fields' }); return;
                }
                if (formType === 'W9' && tin && !/^\d{9}$/.test(tin)) { res.status(400).json({ ok: false, error: 'invalid_tin' }); return; }
                if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) { res.status(400).json({ ok: false, error: 'invalid_fields' }); return; }
                const { data: existing } = await supabase.from('tax_profiles').select('tin_encrypted, tin_last4, tin_type, has_dob').eq('roblox_user_id', session.roblox_user_id).maybeSingle();
                const row = {
                    roblox_user_id: session.roblox_user_id,
                    roblox_username: session.roblox_username,
                    form_type: formType,
                    legal_name: legalName,
                    business_name: clean(payload.businessName, 120) || null,
                    tax_classification: CLASSIFICATIONS.includes(payload.classification) ? payload.classification : 'individual',
                    country,
                    address_line1: address1,
                    address_line2: clean(payload.address2, 160) || null,
                    city,
                    region: clean(payload.region, 80) || null,
                    postal_code: clean(payload.postalCode, 20) || null,
                    signed_name: signedName,
                    signed_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };
                if (tin || dob) {
                    const prev = existing && existing.tin_encrypted ? decrypt(existing.tin_encrypted) || {} : {};
                    const blob = encrypt({ tin: tin || prev.tin || null, dob: dob || prev.dob || null });
                    if (!blob) { res.status(400).json({ ok: false, error: 'tax_key_missing' }); return; }
                    row.tin_encrypted = blob;
                    if (tin) {
                        row.tin_last4 = tin.slice(-4);
                        row.tin_type = formType === 'W9' ? (payload.tinType === 'EIN' ? 'EIN' : 'SSN') : 'FOREIGN';
                    }
                    if (dob) row.has_dob = true;
                } else if (formType === 'W9' && !(existing && existing.tin_last4)) {
                    res.status(400).json({ ok: false, error: 'tin_required' }); return;
                }
                const { error } = await supabase.from('tax_profiles').upsert(row, { onConflict: 'roblox_user_id' });
                if (error) { res.status(500).json({ ok: false, error: 'database_update_needed' }); return; }
                logAudit(session, { category: 'tax', action: 'save_tax_details', targetUserId: session.roblox_user_id, targetUsername: session.roblox_username, details: { formType, country, tinChanged: !!tin } });
                if (tin) logSecurityEvent({ kind: 'tax_id_changed', severity: 'info', session, targetUserId: session.roblox_user_id, targetUsername: session.roblox_username, detail: 'Updated their tax ID' });
                res.json({ ok: true });
            }
        },
        tax_list: {
            feature: FEATURE,
            run: async ({ session, payload, res }) => {
                if (!requirePermission(res, session, 'tax.view')) return;
                const year = Number(payload.year) || new Date().getUTCFullYear();
                const [{ data, error }, totals] = await Promise.all([
                    supabase.from('tax_profiles').select('*').order('legal_name', { ascending: true }),
                    paidTotals(year)
                ]);
                if (error) { res.status(500).json({ ok: false, error: 'database_update_needed' }); return; }
                const profiles = (data || []).map(p => ({ robloxUserId: p.roblox_user_id, username: p.roblox_username, ...publicProfile(p) }));
                const known = new Set(profiles.map(p => String(p.robloxUserId)));
                res.json({
                    ok: true,
                    data: {
                        profiles,
                        missing: totals.filter(t => t.robloxUserId != null && !known.has(String(t.robloxUserId))).map(t => ({ robloxUserId: t.robloxUserId, username: t.username, cash: t.cash, robux: t.robux })),
                        encryptionReady: !!keyBuf()
                    }
                });
            }
        },
        tax_reveal: {
            feature: FEATURE,
            run: async ({ session, payload, res }) => {
                if (!requirePermission(res, session, 'tax.view')) return;
                if (!security.checkRate(res, `tax-reveal:${session.roblox_user_id}`, 30, 60 * 60 * 1000)) return;
                const userId = Number(payload.robloxUserId);
                const { data } = await supabase.from('tax_profiles').select('roblox_username, tin_encrypted').eq('roblox_user_id', userId).maybeSingle();
                if (!data || !data.tin_encrypted) { res.status(404).json({ ok: false, error: 'not_found' }); return; }
                const plain = decrypt(data.tin_encrypted);
                if (!plain) { res.status(500).json({ ok: false, error: 'tax_key_mismatch' }); return; }
                logSecurityEvent({ kind: 'tax_id_viewed', severity: 'notice', session, targetUserId: userId, targetUsername: data.roblox_username, detail: 'Viewed a full tax ID' });
                logAudit(session, { category: 'tax', action: 'view_tax_id', targetUserId: userId, targetUsername: data.roblox_username, details: {} });
                res.json({ ok: true, data: { tin: plain.tin || null, dob: plain.dob || null } });
            }
        },
        tax_year_summary: {
            feature: FEATURE,
            run: async ({ session, payload, res }) => {
                if (!requirePermission(res, session, 'tax.view')) return;
                const year = Number(payload.year);
                if (!(year >= 2000 && year <= 2100)) { res.status(400).json({ ok: false, error: 'invalid_fields' }); return; }
                const totals = await paidTotals(year);
                const ids = totals.map(t => t.robloxUserId).filter(id => id != null);
                const { data: profiles } = ids.length ? await supabase.from('tax_profiles').select('*').in('roblox_user_id', ids) : { data: [] };
                const byId = {};
                (profiles || []).forEach(p => { byId[String(p.roblox_user_id)] = p; });
                const includeTin = payload.includeTin === true;
                const rows = totals.map(t => {
                    const p = byId[String(t.robloxUserId)];
                    const plain = includeTin && p && p.tin_encrypted ? decrypt(p.tin_encrypted) : null;
                    return {
                        ...t,
                        legalName: p ? p.legal_name : null,
                        formType: p ? p.form_type : null,
                        country: p ? p.country : null,
                        address: p ? [p.address_line1, p.address_line2, p.city, p.region, p.postal_code].filter(Boolean).join(', ') : null,
                        tinType: p ? p.tin_type : null,
                        tinLast4: p ? p.tin_last4 : null,
                        tin: plain ? plain.tin : undefined
                    };
                }).sort((a, b) => b.cash - a.cash);
                if (includeTin) {
                    logSecurityEvent({ kind: 'tax_ids_exported', severity: 'notice', session, detail: `Exported year-end totals with full tax IDs for ${year}`, context: { year, people: rows.length } });
                    logAudit(session, { category: 'tax', action: 'export_year_end', details: { year, withTaxIds: true, people: rows.length } });
                }
                res.json({ ok: true, data: { year, cashCurrency: ctx.cashCurrency(), rows } });
            }
        },
        receipt_get: {
            feature: FEATURE,
            run: async ({ session, payload, res }) => {
                const { data: r } = await supabase.from('payment_requests').select('*').eq('id', String(payload.id || '')).maybeSingle();
                const mine = r && String(r.roblox_user_id) === String(session.roblox_user_id);
                if (!r || (!mine && !hasPermission(session, 'dashboard.view'))) { res.status(404).json({ ok: false, error: 'not_found' }); return; }
                if (!(r.paid || r.status === 'paid')) { res.status(409).json({ ok: false, error: 'not_paid' }); return; }
                const [{ data: profile }, { data: method }] = await Promise.all([
                    r.roblox_user_id != null ? supabase.from('tax_profiles').select('legal_name, business_name, country, address_line1, address_line2, city, region, postal_code').eq('roblox_user_id', r.roblox_user_id).maybeSingle() : { data: null },
                    r.roblox_user_id != null ? supabase.from('payment_methods').select('method').eq('roblox_user_id', r.roblox_user_id).maybeSingle() : { data: null }
                ]);
                const st = studio.get().studio;
                res.json({
                    ok: true,
                    data: {
                        id: r.id, task: r.task_name, game: r.game, details: r.work_raw || '', amount: Number(r.payment), currency: r.currency,
                        paidAt: r.paid_at, createdAt: r.created_at, approvedBy: r.requested_by,
                        payee: { username: r.roblox_username, legalName: profile ? profile.legal_name : null, businessName: profile ? profile.business_name : null, address: profile ? [profile.address_line1, profile.address_line2, profile.city, profile.region, profile.postal_code, profile.country].filter(Boolean).join(', ') : null },
                        method: r.payment_method || (method ? method.method : null),
                        payer: { name: st.name, website: st.website || '', email: st.contactEmail || '' },
                        cashCurrency: ctx.cashCurrency()
                    }
                });
            }
        }
    };

    if (Array.isArray(ctx.BACKUP_TABLES) && !ctx.BACKUP_TABLES.includes('tax_profiles')) ctx.BACKUP_TABLES.push('tax_profiles');

    return { actions };
};
