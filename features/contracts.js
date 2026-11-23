'use strict';
// Contracts: commissioned work with terms, a typed signature and paid milestones.
//
//   draft -> sent -> active (signed) -> completed
//                \-> cancelled (any time before completed)
//
// The contractor marks a milestone done; someone who manages contracts approves it, which
// creates a pending payment request. Nobody can approve their own milestone.

module.exports = function contracts(ctx) {
    const { supabase, requirePermission, hasPermission, logAudit, generateRequestId, notify, studioEvent, amountOk, isOwnMoney, logSecurityEvent, money } = ctx;
    const FEATURE = 'contracts';
    const MAX_MILESTONES = 30;

    const canManage = (session) => hasPermission(session, 'contracts.manage');
    const isContractor = (session, c) => c && String(c.roblox_user_id) === String(session.roblox_user_id);
    const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
    const cleanDate = (v) => (v && !isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

    async function load(id) {
        const { data: c } = await supabase.from('contracts').select('*').eq('id', id).maybeSingle();
        if (!c) return null;
        const { data: ms } = await supabase.from('contract_milestones').select('*').eq('contract_id', id).order('position', { ascending: true });
        c.milestones = ms || [];
        c.total = c.milestones.reduce((t, m) => t + Number(m.amount || 0), 0);
        c.paidTotal = 0;
        const reqIds = c.milestones.map(m => m.payment_request_id).filter(Boolean);
        if (reqIds.length) {
            const { data: reqs } = await supabase.from('payment_requests').select('id, status, paid').in('id', reqIds);
            const byId = {};
            (reqs || []).forEach(r => { byId[r.id] = r; });
            c.milestones.forEach(m => {
                const r = m.payment_request_id ? byId[m.payment_request_id] : null;
                m.paymentStatus = r ? (r.paid || r.status === 'paid' ? 'paid' : r.status) : null;
                if (m.paymentStatus === 'paid') c.paidTotal += Number(m.amount || 0);
            });
        }
        return c;
    }

    function readMilestones(list, currency) {
        if (!Array.isArray(list) || !list.length || list.length > MAX_MILESTONES) return null;
        const out = [];
        for (let i = 0; i < list.length; i++) {
            const m = list[i] || {};
            const title = clean(m.title, 160);
            const amount = currency === 'ROBUX' ? Math.round(Number(m.amount)) : Math.round(Number(m.amount) * 100) / 100;
            if (!title || !amountOk(amount, currency)) return null;
            out.push({ position: i, title, details: clean(m.details, 1000) || null, amount, due_at: cleanDate(m.dueAt) });
        }
        return out;
    }

    function shape(c, session) {
        return { ...c, canManage: canManage(session), isContractor: isContractor(session, c) };
    }

    const actions = {
        ct_list: {
            feature: FEATURE,
            run: async ({ session, res }) => {
                let q = supabase.from('contracts').select('*').order('created_at', { ascending: false }).limit(300);
                if (!canManage(session)) q = q.eq('roblox_user_id', session.roblox_user_id).neq('status', 'draft');
                const { data, error } = await q;
                if (error) { res.status(500).json({ ok: false, error: 'database_update_needed' }); return; }
                const ids = (data || []).map(c => c.id);
                const totals = {};
                if (ids.length) {
                    const { data: ms } = await supabase.from('contract_milestones').select('contract_id, amount, status').in('contract_id', ids);
                    (ms || []).forEach(m => {
                        const t = totals[m.contract_id] || (totals[m.contract_id] = { total: 0, count: 0, approved: 0, submitted: 0 });
                        t.total += Number(m.amount || 0); t.count++;
                        if (m.status === 'approved') t.approved++;
                        if (m.status === 'submitted') t.submitted++;
                    });
                }
                res.json({ ok: true, canManage: canManage(session), data: (data || []).map(c => ({ ...c, ...(totals[c.id] || { total: 0, count: 0, approved: 0, submitted: 0 }) })) });
            }
        },
        ct_get: {
            feature: FEATURE,
            run: async ({ session, payload, res }) => {
                const c = await load(Number(payload.id));
                if (!c || (!canManage(session) && (!isContractor(session, c) || c.status === 'draft'))) { res.status(404).json({ ok: false, error: 'not_found' }); return; }
                res.json({ ok: true, data: shape(c, session) });
            }
        },
        ct_save: {
            feature: FEATURE,
            run: async ({ session, payload, res }) => {
                if (!requirePermission(res, session, 'contracts.manage')) return;
                const id = payload.id ? Number(payload.id) : null;
                const currency = payload.currency === 'USD' ? 'USD' : 'ROBUX';
                const title = clean(payload.title, 160);
                const userId = Number(payload.robloxUserId);
                const username = clean(payload.robloxUsername, 60);
                const milestones = readMilestones(payload.milestones, currency);
                if (!title || !userId || !username || !milestones) { res.status(400).json({ ok: false, error: 'invalid_fields' }); return; }
                if (String(userId) === String(session.roblox_user_id) && !ctx.studio.SERVER.moneyRules.allowSelfApproval) { res.status(403).json({ ok: false, error: 'own_payment' }); return; }
                const row = {
                    title, roblox_user_id: userId, roblox_username: username, currency,
                    game_id: payload.gameId ? Number(payload.gameId) : null,
                    terms: clean(payload.terms, 20000) || null,
                    due_at: cleanDate(payload.dueAt)
                };
                let contractId = id;
                if (id) {
                    const { data: existing } = await supabase.from('contracts').select('status').eq('id', id).maybeSingle();
                    if (!existing) { res.status(404).json({ ok: false, error: 'not_found' }); return; }
                    if (existing.status !== 'draft') { res.status(409).json({ ok: false, error: 'not_draft' }); return; }
                    const { error } = await supabase.from('contracts').update(row).eq('id', id);
                    if (error) { res.status(500).json({ ok: false, error: 'server_error' }); return; }
                    await supabase.from('contract_milestones').delete().eq('contract_id', id);
                } else {
                    const { data, error } = await supabase.from('contracts').insert({ ...row, status: 'draft', created_by: session.roblox_username, created_by_user_id: session.roblox_user_id, created_at: new Date().toISOString() }).select('id').single();
                    if (error || !data) { res.status(500).json({ ok: false, error: 'database_update_needed' }); return; }
                    contractId = data.id;
                }
                const { error: msErr } = await supabase.from('contract_milestones').insert(milestones.map(m => ({ ...m, contract_id: contractId, status: 'open' })));
                if (msErr) { res.status(500).json({ ok: false, error: 'server_error' }); return; }
                logAudit(session, { category: 'contracts', action: id ? 'edit_contract' : 'create_contract', targetUserId: userId, targetUsername: username, details: { id: contractId, title, milestones: milestones.length, total: milestones.reduce((t, m) => t + m.amount, 0), currency } });
                if (payload.send === true) {
                    await supabase.from('contracts').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', contractId);
                    notify(userId, { kind: 'contract', title: 'A contract is waiting for you', body: `${session.roblox_username} sent you "${title}" to review and sign.`, link: `#/contract/${contractId}` });
                }
                res.json({ ok: true, id: contractId });
            }
        },
        ct_send: {
            feature: FEATURE,
            run: async ({ session, payload, res }) => {
                if (!requirePermission(res, session, 'contracts.manage')) return;
                const c = await load(Number(payload.id));
                if (!c) { res.status(404).json({ ok: false, error: 'not_found' }); return; }
                if (c.status !== 'draft') { res.status(409).json({ ok: false, error: 'not_draft' }); return; }
                await supabase.from('contracts').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', c.id);
                notify(c.roblox_user_id, { kind: 'contract', title: 'A contract is waiting for you', body: `${session.roblox_username} sent you "${c.title}" to review and sign.`, link: `#/contract/${c.id}` });
                logAudit(session, { category: 'contracts', action: 'send_contract', targetUserId: c.roblox_user_id, targetUsername: c.roblox_username, details: { id: c.id } });
                res.json({ ok: true });
            }
        },
        ct_sign: {
            feature: FEATURE,
            run: async ({ req, session, payload, res }) => {
                const c = await load(Number(payload.id));
                if (!c || !isContractor(session, c) || c.status === 'draft') { res.status(404).json({ ok: false, error: 'not_found' }); return; }
                if (c.status !== 'sent') { res.status(409).json({ ok: false, error: 'not_waiting_for_signature' }); return; }
                const name = clean(payload.name, 120);
                if (name.length < 2 || payload.agree !== true) { res.status(400).json({ ok: false, error: 'signature_required' }); return; }
                const now = new Date().toISOString();
                await supabase.from('contracts').update({
                    status: 'active', signed_at: now, signed_name: name,
                    signed_meta: { userAgent: String((req.headers && req.headers['user-agent']) || '').slice(0, 200), ip: ctx.security.clientIp(req) }
                }).eq('id', c.id);
                logAudit(session, { category: 'contracts', action: 'sign_contract', targetUserId: c.roblox_user_id, targetUsername: c.roblox_username, details: { id: c.id, signedName: name } });
                if (c.created_by_user_id) notify(c.created_by_user_id, { kind: 'contract', title: `${c.roblox_username} signed "${c.title}"`, body: 'The contract is active. Milestones can now be marked done.', link: `#/contract/${c.id}` });
                studioEvent('contract_signed', `${c.roblox_username} signed "${c.title}" (${money(c.total, c.currency)}).`, `#/contract/${c.id}`);
                res.json({ ok: true });
            }
        },
        ct_cancel: {
            feature: FEATURE,
            run: async ({ session, payload, res }) => {
                if (!requirePermission(res, session, 'contracts.manage')) return;
                const c = await load(Number(payload.id));
                if (!c) { res.status(404).json({ ok: false, error: 'not_found' }); return; }
                if (['completed', 'cancelled'].includes(c.status)) { res.status(409).json({ ok: false, error: 'already_closed' }); return; }
                if (c.status === 'draft') {
                    await supabase.from('contract_milestones').delete().eq('contract_id', c.id);
                    await supabase.from('contracts').delete().eq('id', c.id);
                    logAudit(session, { category: 'contracts', action: 'delete_contract', details: { id: c.id, title: c.title } });
                    res.json({ ok: true, deleted: true });
                    return;
                }
                const reason = clean(payload.reason, 500) || null;
                await supabase.from('contracts').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_reason: reason }).eq('id', c.id);
                logAudit(session, { category: 'contracts', action: 'cancel_contract', targetUserId: c.roblox_user_id, targetUsername: c.roblox_username, details: { id: c.id, reason } });
                notify(c.roblox_user_id, { kind: 'contract', title: `"${c.title}" was cancelled`, body: `${reason ? `Reason: ${reason}\n` : ''}Milestones that were already approved still get paid.`, link: `#/contract/${c.id}` });
                res.json({ ok: true });
            }
        },
        ct_submit_milestone: {
            feature: FEATURE,
            run: async ({ session, payload, res }) => {
                const { data: m } = await supabase.from('contract_milestones').select('*').eq('id', Number(payload.milestoneId)).maybeSingle();
                const c = m ? await load(m.contract_id) : null;
                if (!c || !isContractor(session, c)) { res.status(404).json({ ok: false, error: 'not_found' }); return; }
                if (c.status !== 'active') { res.status(409).json({ ok: false, error: 'contract_not_active' }); return; }
                if (m.status !== 'open') { res.status(409).json({ ok: false, error: 'already_submitted' }); return; }
                await supabase.from('contract_milestones').update({ status: 'submitted', submitted_at: new Date().toISOString(), submitted_note: clean(payload.note, 2000) || null }).eq('id', m.id);
                if (c.created_by_user_id) notify(c.created_by_user_id, { kind: 'contract', title: `Milestone ready for review`, body: `${c.roblox_username} marked "${m.title}" on "${c.title}" as done.`, link: `#/contract/${c.id}` });
                logAudit(session, { category: 'contracts', action: 'submit_milestone', details: { contractId: c.id, milestoneId: m.id } });
                res.json({ ok: true });
            }
        },
        ct_decide_milestone: {
            feature: FEATURE,
            money: true,
            run: async ({ session, payload, res }) => {
                if (!requirePermission(res, session, 'contracts.manage')) return;
                const { data: m } = await supabase.from('contract_milestones').select('*').eq('id', Number(payload.milestoneId)).maybeSingle();
                const c = m ? await load(m.contract_id) : null;
                if (!c) { res.status(404).json({ ok: false, error: 'not_found' }); return; }
                if (c.status !== 'active') { res.status(409).json({ ok: false, error: 'contract_not_active' }); return; }
                if (!['open', 'submitted'].includes(m.status)) { res.status(409).json({ ok: false, error: 'already_decided' }); return; }
                if (isOwnMoney(session, { roblox_user_id: c.roblox_user_id, roblox_username: c.roblox_username })) {
                    logSecurityEvent({ kind: 'self_approval_blocked', severity: 'notice', session, targetUserId: c.roblox_user_id, detail: 'Tried to approve their own contract milestone', context: { contractId: c.id } });
                    res.status(403).json({ ok: false, error: 'own_payment' });
                    return;
                }
                const note = clean(payload.note, 1000) || null;
                const now = new Date().toISOString();
                if (payload.decision === 'reject') {
                    await supabase.from('contract_milestones').update({ status: 'open', decided_at: now, decided_by: session.roblox_username, decision_note: note }).eq('id', m.id);
                    notify(c.roblox_user_id, { kind: 'contract', title: `"${m.title}" needs changes`, body: note || 'Your milestone was sent back. Check the contract for details.', link: `#/contract/${c.id}` });
                    logAudit(session, { category: 'contracts', action: 'reject_milestone', targetUserId: c.roblox_user_id, targetUsername: c.roblox_username, details: { contractId: c.id, milestoneId: m.id, note } });
                    res.json({ ok: true });
                    return;
                }
                const requestId = generateRequestId();
                const { error: reqErr } = await supabase.from('payment_requests').insert({
                    id: requestId,
                    requested_by: session.roblox_username,
                    requested_by_user_id: session.roblox_user_id,
                    roblox_username: c.roblox_username,
                    roblox_user_id: c.roblox_user_id,
                    task_name: `${c.title}: ${m.title}`,
                    game_id: c.game_id || null,
                    game: null,
                    work_raw: m.submitted_note || m.details || '',
                    time_worked: '',
                    payment: Number(m.amount),
                    currency: c.currency,
                    currency_locked: true,
                    paid: false,
                    status: 'pending',
                    created_at: now
                });
                if (reqErr) { res.status(500).json({ ok: false, error: 'server_error' }); return; }
                await supabase.from('contract_milestones').update({ status: 'approved', decided_at: now, decided_by: session.roblox_username, decision_note: note, payment_request_id: requestId }).eq('id', m.id);
                const remaining = c.milestones.filter(x => x.id !== m.id && x.status !== 'approved').length;
                if (!remaining) await supabase.from('contracts').update({ status: 'completed', completed_at: now }).eq('id', c.id);
                notify(c.roblox_user_id, { kind: 'contract', title: `Milestone approved: ${money(m.amount, c.currency)}`, body: `"${m.title}" on "${c.title}" was approved and is waiting to be paid out.`, link: '#/my' });
                logAudit(session, { category: 'contracts', action: 'approve_milestone', targetUserId: c.roblox_user_id, targetUsername: c.roblox_username, details: { contractId: c.id, milestoneId: m.id, requestId, amount: m.amount, currency: c.currency } });
                res.json({ ok: true, requestId, completed: !remaining });
            }
        }
    };

    if (Array.isArray(ctx.BACKUP_TABLES)) ['contracts', 'contract_milestones'].forEach(t => { if (!ctx.BACKUP_TABLES.includes(t)) ctx.BACKUP_TABLES.push(t); });

    return { actions };
};
