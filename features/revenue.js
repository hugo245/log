'use strict';
// Revenue share: people who are paid a percentage of a game's earnings.
//
// A manager sets who gets what share of each game. Once a month they record the game's
// revenue; that creates one pending payment request per share, which then goes through the
// normal approve-and-pay flow (so nobody pays out their own share).

module.exports = function revenue(ctx) {
    const { supabase, requirePermission, hasPermission, logAudit, generateRequestId, notify, studioEvent, amountOk } = ctx;
    const FEATURE = 'revenueShare';
    const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

    const money = ctx.money;

    async function loadOverview() {
        const [games, shares, periods] = await Promise.all([
            supabase.from('games').select('id, name, icon_url').order('name', { ascending: true }),
            supabase.from('revenue_shares').select('*').eq('active', true),
            supabase.from('revenue_periods').select('*').order('period', { ascending: false }).limit(60)
        ]);
        if (shares.error) throw new Error('revenue_tables_missing');
        return { games: games.data || [], shares: shares.data || [], periods: periods.data || [] };
    }

    const actions = {
        rs_overview: {
            feature: FEATURE,
            run: async ({ session, res }) => {
                if (!requirePermission(res, session, 'revenue.manage')) return;
                try { res.json({ ok: true, data: await loadOverview() }); }
                catch (e) { res.status(500).json({ ok: false, error: 'database_update_needed' }); }
            }
        },
        rs_save_share: {
            feature: FEATURE,
            run: async ({ session, payload, res }) => {
                if (!requirePermission(res, session, 'revenue.manage')) return;
                const gameId = Number(payload.gameId);
                const userId = Number(payload.robloxUserId);
                const username = String(payload.robloxUsername || '').trim().slice(0, 60);
                const percent = Math.round(Number(payload.percent) * 100) / 100;
                if (!gameId || !userId || !username || !(percent > 0 && percent <= 100)) { res.status(400).json({ ok: false, error: 'invalid_fields' }); return; }
                const { data: existing } = await supabase.from('revenue_shares').select('*').eq('game_id', gameId).eq('active', true);
                const others = (existing || []).filter(s => Number(s.roblox_user_id) !== userId);
                const total = others.reduce((t, s) => t + Number(s.percent || 0), 0) + percent;
                if (total > 100.0001) { res.status(400).json({ ok: false, error: 'share_over_100', allocated: total - percent }); return; }
                const mine = (existing || []).find(s => Number(s.roblox_user_id) === userId);
                const row = { game_id: gameId, roblox_user_id: userId, roblox_username: username, percent, note: payload.note ? String(payload.note).slice(0, 200) : null, active: true };
                const q = mine
                    ? supabase.from('revenue_shares').update(row).eq('id', mine.id)
                    : supabase.from('revenue_shares').insert({ ...row, created_by: session.roblox_username, created_at: new Date().toISOString() });
                const { error } = await q;
                if (error) { res.status(500).json({ ok: false, error: 'database_update_needed' }); return; }
                logAudit(session, { category: 'payments', action: 'save_revenue_share', targetUserId: userId, targetUsername: username, details: { gameId, percent, from: mine ? Number(mine.percent) : null } });
                if (!mine) notify(userId, { kind: 'revenue', title: `You have a ${percent}% revenue share`, body: `${session.roblox_username} gave you a ${percent}% share of a game's revenue. It's paid each month once revenue is recorded.`, link: '#/my' });
                res.json({ ok: true });
            }
        },
        rs_remove_share: {
            feature: FEATURE,
            run: async ({ session, payload, res }) => {
                if (!requirePermission(res, session, 'revenue.manage')) return;
                const id = Number(payload.id);
                const { data: row } = await supabase.from('revenue_shares').select('*').eq('id', id).maybeSingle();
                if (!row) { res.status(404).json({ ok: false, error: 'not_found' }); return; }
                await supabase.from('revenue_shares').update({ active: false }).eq('id', id);
                logAudit(session, { category: 'payments', action: 'remove_revenue_share', targetUserId: row.roblox_user_id, targetUsername: row.roblox_username, details: { gameId: row.game_id, percent: row.percent } });
                res.json({ ok: true });
            }
        },
        rs_record_period: {
            feature: FEATURE,
            money: true,
            run: async ({ session, payload, res }) => {
                if (!requirePermission(res, session, 'revenue.manage')) return;
                const gameId = Number(payload.gameId);
                const period = String(payload.period || '');
                const currency = payload.currency === 'USD' ? 'USD' : 'ROBUX';
                const revenueAmount = Number(payload.revenue);
                if (!gameId || !PERIOD.test(period) || !(revenueAmount > 0) || !Number.isFinite(revenueAmount)) { res.status(400).json({ ok: false, error: 'invalid_fields' }); return; }
                const { data: game } = await supabase.from('games').select('id, name').eq('id', gameId).maybeSingle();
                if (!game) { res.status(404).json({ ok: false, error: 'not_found' }); return; }
                const { data: dupe } = await supabase.from('revenue_periods').select('id').eq('game_id', gameId).eq('period', period).maybeSingle();
                if (dupe) { res.status(409).json({ ok: false, error: 'period_exists' }); return; }
                const { data: shares } = await supabase.from('revenue_shares').select('*').eq('game_id', gameId).eq('active', true);
                if (!shares || !shares.length) { res.status(400).json({ ok: false, error: 'no_shares' }); return; }

                const now = new Date().toISOString();
                const rows = shares.map(s => {
                    const raw = revenueAmount * Number(s.percent) / 100;
                    const payment = currency === 'ROBUX' ? Math.round(raw) : Math.round(raw * 100) / 100;
                    return {
                        id: generateRequestId(),
                        requested_by: session.roblox_username,
                        requested_by_user_id: session.roblox_user_id,
                        roblox_username: s.roblox_username,
                        roblox_user_id: s.roblox_user_id,
                        task_name: `Revenue share: ${game.name} ${period} (${Number(s.percent)}%)`,
                        game: game.name,
                        game_id: game.id,
                        work_raw: `${Number(s.percent)}% of ${money(revenueAmount, currency)} recorded for ${period}.`,
                        time_worked: '',
                        payment,
                        currency,
                        currency_locked: true,
                        paid: false,
                        status: 'pending',
                        created_at: now
                    };
                }).filter(r => r.payment > 0);
                for (const r of rows) {
                    if (!amountOk(r.payment, r.currency)) { res.status(400).json({ ok: false, error: 'invalid_amount' }); return; }
                }
                const { error: reqErr } = await supabase.from('payment_requests').insert(rows);
                if (reqErr) { res.status(500).json({ ok: false, error: 'server_error' }); return; }
                const { error } = await supabase.from('revenue_periods').insert({
                    game_id: gameId, period, revenue: revenueAmount, currency,
                    note: payload.note ? String(payload.note).slice(0, 300) : null,
                    recorded_by: session.roblox_username, recorded_by_user_id: session.roblox_user_id,
                    request_ids: rows.map(r => r.id), created_at: now
                });
                if (error) {
                    await supabase.from('payment_requests').delete().in('id', rows.map(r => r.id));
                    res.status(500).json({ ok: false, error: 'database_update_needed' });
                    return;
                }
                rows.forEach(r => notify(r.roblox_user_id, { kind: 'revenue', title: `Revenue share for ${period}`, body: `Your share of ${game.name} for ${period} is ${money(r.payment, r.currency)}. It's waiting to be paid out.`, link: '#/my' }));
                logAudit(session, { category: 'payments', action: 'record_revenue', details: { gameId, game: game.name, period, revenue: revenueAmount, currency, requests: rows.map(r => r.id) } });
                studioEvent('revenue_recorded', `${session.roblox_username} recorded ${game.name} revenue for ${period}: ${money(revenueAmount, currency)} across ${rows.length} share${rows.length === 1 ? '' : 's'}.`, '#/revenue');
                res.json({ ok: true, created: rows.length });
            }
        },
        rs_delete_period: {
            feature: FEATURE,
            money: true,
            run: async ({ session, payload, res }) => {
                if (!requirePermission(res, session, 'revenue.manage')) return;
                const id = Number(payload.id);
                const { data: period } = await supabase.from('revenue_periods').select('*').eq('id', id).maybeSingle();
                if (!period) { res.status(404).json({ ok: false, error: 'not_found' }); return; }
                const ids = Array.isArray(period.request_ids) ? period.request_ids : [];
                if (ids.length) {
                    const { data: reqs } = await supabase.from('payment_requests').select('id, paid, status').in('id', ids);
                    if ((reqs || []).some(r => r.paid || r.status === 'paid')) { res.status(409).json({ ok: false, error: 'already_paid' }); return; }
                    await supabase.from('payment_requests').delete().in('id', ids);
                }
                await supabase.from('revenue_periods').delete().eq('id', id);
                logAudit(session, { category: 'payments', action: 'delete_revenue_period', details: { gameId: period.game_id, period: period.period, removedRequests: ids.length } });
                res.json({ ok: true });
            }
        },
        rs_my_shares: {
            feature: FEATURE,
            run: async ({ session, res }) => {
                const [shares, games] = await Promise.all([
                    supabase.from('revenue_shares').select('game_id, percent, created_at').eq('roblox_user_id', session.roblox_user_id).eq('active', true),
                    supabase.from('games').select('id, name')
                ]);
                const names = {};
                (games.data || []).forEach(g => { names[g.id] = g.name; });
                res.json({ ok: true, data: (shares.data || []).map(s => ({ game: names[s.game_id] || 'Game', percent: Number(s.percent), since: s.created_at })) });
            }
        }
    };

    // Keep revenue-share data in backups.
    if (Array.isArray(ctx.BACKUP_TABLES)) ['revenue_shares', 'revenue_periods'].forEach(t => { if (!ctx.BACKUP_TABLES.includes(t)) ctx.BACKUP_TABLES.push(t); });

    return { actions };
};
