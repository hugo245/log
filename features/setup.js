'use strict';
// First-run setup wizard for the person who owns the panel.
//
// The wizard itself (#/setup in the web app) saves each step through the actions the rest
// of Settings already uses (branding, sign-in groups, DevEx rate, invite links), so every
// permission check and validation stays in one place. This module only reports how far
// setup has got and remembers when it was finished or skipped.

module.exports = function setup(ctx) {
    const { supabase, studio, hasPermission, requirePermission, logAudit } = ctx;

    const canRunSetup = (session) => hasPermission(session, 'roles.manage') && hasPermission(session, 'settings.manage_branding');

    async function state() {
        const [settingsRes, groupsRes, serversRes, linksRes, rolesRes, teamsRes, roleAssignRes, requestsRes] = await Promise.all([
            supabase.from('app_settings').select('devex_rate, setup_completed_at, setup_completed_by, setup_skipped, branding').eq('id', 1).maybeSingle(),
            supabase.from('base_access_groups').select('id, roblox_group_id, min_rank, name'),
            supabase.from('base_access_discord_servers').select('id'),
            supabase.from('onboarding_links').select('token', { count: 'exact', head: true }),
            supabase.from('roles').select('id, name, hierarchy').order('hierarchy', { ascending: false }),
            supabase.from('teams').select('id, name').order('name', { ascending: true }),
            supabase.from('user_role_assignments').select('id', { count: 'exact', head: true }),
            supabase.from('payment_requests').select('id', { count: 'exact', head: true })
        ]);
        const s = settingsRes.data || {};
        const cfg = studio.get();
        const saved = (s.branding && typeof s.branding === 'object') ? s.branding : {};
        const groups = groupsRes.data || [];
        // A studio that is clearly already running (people paid, roles handed out, or a sign-in
        // group in place) never needs the first-run guide: mark it done once, for good.
        const established = (requestsRes.count || 0) > 0 || (roleAssignRes.count || 0) > 1 || groups.length > 0;
        if (!settingsRes.error && !s.setup_completed_at && established) {
            const at = new Date().toISOString();
            const { error } = await supabase.from('app_settings').update({ setup_completed_at: at, setup_completed_by: 'Existing studio', setup_skipped: true }).eq('id', 1);
            if (!error) { s.setup_completed_at = at; s.setup_completed_by = 'Existing studio'; s.setup_skipped = true; }
        }
        return {
            available: !settingsRes.error || !/setup_/.test(settingsRes.error.message || ''),
            completed: !!s.setup_completed_at,
            completedAt: s.setup_completed_at || null,
            completedBy: s.setup_completed_by || null,
            skipped: !!s.setup_skipped,
            checks: {
                studio: !!(saved.studio && saved.studio.name) || cfg.studio.name !== 'Studio Panel',
                signin: groups.length > 0 || (serversRes.data || []).length > 0,
                payouts: s.devex_rate != null && Number(s.devex_rate) > 0,
                invite: (linksRes.count || 0) > 0 || (roleAssignRes.count || 0) > 1
            },
            values: {
                studio: { name: cfg.studio.name, productName: cfg.studio.productName || '', logoUrl: cfg.studio.logoUrl || '', website: cfg.studio.website || '' },
                theme: { accent: cfg.theme.accent },
                payments: { currencies: cfg.payments.currencies, methods: cfg.payments.methods, cashCurrency: cfg.payments.cashCurrency || 'USD' },
                devexRate: s.devex_rate != null ? Number(s.devex_rate) : null,
                groups: groups.map(g => ({ id: g.id, robloxGroupId: g.roblox_group_id, minRank: g.min_rank, name: g.name })),
                roles: (rolesRes.data || []).map(r => ({ id: r.id, name: r.name, hierarchy: r.hierarchy })),
                teams: (teamsRes.data || []).map(t => ({ id: t.id, name: t.name })),
                multiCurrency: studio.feature('multiCurrency')
            }
        };
    }

    return {
        actions: {
            get_setup_state: {
                run: async ({ session, res }) => {
                    if (!canRunSetup(session)) {
                        // People who can't run setup simply never see it.
                        res.json({ ok: true, data: { canRun: false, completed: true } });
                        return;
                    }
                    res.json({ ok: true, data: { canRun: true, ...(await state()) } });
                }
            },
            finish_setup: {
                run: async ({ session, payload, res }) => {
                    if (!requirePermission(res, session, 'roles.manage')) return;
                    const skipped = payload.skipped === true;
                    const { error } = await supabase.from('app_settings').update({
                        setup_completed_at: new Date().toISOString(),
                        setup_completed_by: session.roblox_username,
                        setup_skipped: skipped
                    }).eq('id', 1);
                    if (error) {
                        console.error('[setup] could not save (run sql/upgrade.sql?):', error.message);
                        res.status(500).json({ ok: false, error: 'setup_columns_missing' });
                        return;
                    }
                    logAudit(session, { category: 'settings', action: skipped ? 'skip_setup' : 'finish_setup', details: {} });
                    res.json({ ok: true });
                }
            },
            reopen_setup: {
                run: async ({ session, res }) => {
                    if (!requirePermission(res, session, 'roles.manage')) return;
                    await supabase.from('app_settings').update({ setup_completed_at: null, setup_skipped: false }).eq('id', 1);
                    res.json({ ok: true });
                }
            }
        }
    };
};
