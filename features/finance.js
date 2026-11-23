'use strict';
// Game budgets and accounting exports.
//
// Budgets: each game can have a budget in the studio's cash currency. Spend counts every
// approved or paid request for the game; Robux is converted at the DevEx rate. When a game
// reaches 90% and again at 100%, its producer is told and the studio webhook gets a message.
//
// Exports: one action returns payment rows for a date range; the browser turns them into
// QuickBooks / Xero / PayPal Payouts / Wise / plain CSV files.

module.exports = function finance(ctx) {
    const { supabase, requirePermission, hasPermission, logAudit, notify, studioEvent, getDevexRate, money } = ctx;
    const THRESHOLDS = [90, 100];

    async function spendByGame(gameIds) {
        const rate = Number(await getDevexRate()) || 0;
        let q = supabase.from('payment_requests').select('game_id, payment, currency, status, paid');
        if (gameIds) q = q.in('game_id', gameIds);
        const { data } = await q;
        const out = {};
        (data || []).forEach(r => {
            if (r.game_id == null || r.status === 'rejected' || r.status === 'proposed') return;
            const g = out[r.game_id] || (out[r.game_id] = { cash: 0, robux: 0, paidCash: 0, total: 0 });
            const amount = Number(r.payment) || 0;
            const asCash = r.currency === 'ROBUX' ? amount * rate : amount;
            if (r.currency === 'ROBUX') g.robux += amount; else g.cash += amount;
            g.total += asCash;
            if (r.paid || r.status === 'paid') g.paidCash += asCash;
        });
        return { byGame: out, rate };
    }

    async function overview() {
        const { data: games, error } = await supabase.from('games').select('id, name, icon_url, producer_username, producer_user_id, budget_amount, budget_warned_pct').order('name', { ascending: true });
        if (error) throw error;
        const { byGame, rate } = await spendByGame(null);
        return {
            devexRate: rate,
            games: (games || []).map(g => {
                const s = byGame[g.id] || { cash: 0, robux: 0, paidCash: 0, total: 0 };
                const budget = g.budget_amount != null ? Number(g.budget_amount) : null;
                return {
                    id: g.id, name: g.name, iconUrl: g.icon_url || null, producer: g.producer_username || null,
                    budget, spent: Math.round(s.total * 100) / 100, paid: Math.round(s.paidCash * 100) / 100,
                    cash: s.cash, robux: s.robux, pct: budget > 0 ? Math.round(s.total / budget * 100) : null
                };
            })
        };
    }

    // Tell people once when a game crosses 90% and once at 100%.
    async function checkBudgets() {
        try {
            const data = await overview();
            for (const g of data.games) {
                if (!(g.budget > 0)) continue;
                const { data: row } = await supabase.from('games').select('budget_warned_pct, producer_user_id').eq('id', g.id).maybeSingle();
                const warned = Number(row && row.budget_warned_pct) || 0;
                const hit = THRESHOLDS.filter(t => g.pct >= t && warned < t).pop();
                if (!hit) {
                    if (g.pct < 90 && warned > 0) await supabase.from('games').update({ budget_warned_pct: 0 }).eq('id', g.id);
                    continue;
                }
                await supabase.from('games').update({ budget_warned_pct: hit }).eq('id', g.id);
                const text = hit >= 100
                    ? `${g.name} is over budget: ${money(g.spent, 'USD')} of ${money(g.budget, 'USD')}.`
                    : `${g.name} has used ${g.pct}% of its budget (${money(g.spent, 'USD')} of ${money(g.budget, 'USD')}).`;
                studioEvent('budget_warning', text, '#/exports?tab=budgets');
                if (row && row.producer_user_id) notify(row.producer_user_id, { kind: 'payment', title: hit >= 100 ? `${g.name} is over budget` : `${g.name} is at ${g.pct}% of its budget`, body: text, link: '#/exports?tab=budgets' });
            }
        } catch (e) { }
    }

    const actions = {
        budgets_overview: {
            feature: 'budgets',
            run: async ({ session, res }) => {
                if (!hasPermission(session, 'settings.manage_games') && !requirePermission(res, session, 'dashboard.view')) return;
                try { res.json({ ok: true, data: { ...(await overview()), canEdit: hasPermission(session, 'settings.manage_games') } }); }
                catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
            }
        },
        set_game_budget: {
            feature: 'budgets',
            run: async ({ session, payload, res }) => {
                if (!requirePermission(res, session, 'settings.manage_games')) return;
                const id = Number(payload.gameId);
                const amount = payload.amount === null || payload.amount === '' ? null : Math.round(Number(payload.amount) * 100) / 100;
                if (!id || (amount !== null && !(amount > 0 && amount < 1e9))) { res.status(400).json({ ok: false, error: 'invalid_amount' }); return; }
                const { data: before } = await supabase.from('games').select('name, budget_amount').eq('id', id).maybeSingle();
                if (!before) { res.status(404).json({ ok: false, error: 'not_found' }); return; }
                const { error } = await supabase.from('games').update({ budget_amount: amount, budget_currency: 'USD', budget_warned_pct: 0 }).eq('id', id);
                if (error) { res.status(500).json({ ok: false, error: 'database_update_needed' }); return; }
                logAudit(session, { category: 'settings', action: 'set_game_budget', details: { gameId: id, game: before.name, from: before.budget_amount, to: amount } });
                checkBudgets();
                res.json({ ok: true });
            }
        },
        export_payments: {
            feature: 'accountingExport',
            run: async ({ session, payload, res }) => {
                if (!requirePermission(res, session, 'dashboard.export')) return;
                const from = payload.from && !isNaN(Date.parse(payload.from)) ? new Date(payload.from).toISOString() : null;
                const to = payload.to && !isNaN(Date.parse(payload.to)) ? new Date(Date.parse(payload.to) + 86400000).toISOString() : null;
                const scope = ['paid', 'unpaid', 'all'].includes(payload.scope) ? payload.scope : 'paid';
                let q = supabase.from('payment_requests').select('*').order('created_at', { ascending: true }).limit(5000);
                if (scope === 'paid') {
                    q = q.eq('status', 'paid');
                    if (from) q = q.gte('paid_at', from);
                    if (to) q = q.lt('paid_at', to);
                } else {
                    q = scope === 'unpaid' ? q.eq('status', 'pending') : q.in('status', ['pending', 'paid']);
                    if (from) q = q.gte('created_at', from);
                    if (to) q = q.lt('created_at', to);
                }
                const { data, error } = await q;
                if (error) { res.status(500).json({ ok: false, error: 'server_error' }); return; }
                const rows = data || [];
                const userIds = [...new Set(rows.map(r => r.roblox_user_id).filter(v => v != null))];
                const [methodsRes, taxRes] = userIds.length ? await Promise.all([
                    supabase.from('payment_methods').select('*').in('roblox_user_id', userIds),
                    supabase.from('tax_profiles').select('roblox_user_id, legal_name, business_name, country').in('roblox_user_id', userIds)
                ]) : [{ data: [] }, { data: [] }];
                const seeBank = hasPermission(session, 'payouts.view_bank_details');
                const methods = {}; (methodsRes.data || []).forEach(m => { methods[String(m.roblox_user_id)] = m; });
                const tax = {}; ((taxRes && taxRes.data) || []).forEach(t => { tax[String(t.roblox_user_id)] = t; });
                const out = rows.map(r => {
                    const m = methods[String(r.roblox_user_id)];
                    const d = (m && m.details) || {};
                    const t = tax[String(r.roblox_user_id)];
                    return {
                        id: r.id, task: r.task_name, game: r.game || '', status: r.status, amount: Number(r.payment), currency: r.currency,
                        createdAt: r.created_at, paidAt: r.paid_at, approvedBy: r.requested_by || '',
                        payee: r.roblox_username || '', robloxUserId: r.roblox_user_id, legalName: t ? t.legal_name : '', businessName: t ? (t.business_name || '') : '', country: t ? t.country : '',
                        method: (m && m.method) || '',
                        paypalEmail: d.paypalEmail || '', venmoUsername: d.venmoUsername || '', robloxPayee: d.robloxUsername || '',
                        bank: m && m.method === 'BANK_TRANSFER' && seeBank ? { fullName: d.fullName || '', iban: d.iban || '', swift: d.swift || '', country: d.country || '', city: d.city || '', address: d.address || '', postalCode: d.postalCode || '' } : null
                    };
                });
                logAudit(session, { category: 'payments', action: 'export_payments', details: { scope, from: payload.from || null, to: payload.to || null, rows: out.length, format: String(payload.format || '').slice(0, 20) } });
                res.json({ ok: true, data: { rows: out, cashCurrency: ctx.cashCurrency(), bankDetailsIncluded: seeBank } });
            }
        }
    };

    return {
        actions,
        start() {
            setTimeout(checkBudgets, 75 * 1000).unref();
            setInterval(checkBudgets, 15 * 60 * 1000).unref();
        }
    };
};
