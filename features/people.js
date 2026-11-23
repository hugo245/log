'use strict';
// A light list of everyone the panel knows (id + name), for pickers in Revenue share,
// Contracts and similar screens. Only for people who manage those areas.

module.exports = function people(ctx) {
    const { supabase, hasPermission } = ctx;
    const ALLOWED = ['revenue.manage', 'contracts.manage', 'dashboard.submit_request', 'staff.view_database', 'tax.view'];

    async function knownPeople() {
        const [sessions, assigns, roles, methods, accounts] = await Promise.all([
            supabase.from('hr_sessions').select('roblox_user_id, roblox_username'),
            supabase.from('user_assignments').select('roblox_user_id, roblox_username'),
            supabase.from('user_role_assignments').select('roblox_user_id, roblox_username'),
            supabase.from('payment_methods').select('roblox_user_id, roblox_username'),
            supabase.from('accounts').select('id, display_name')
        ]);
        const byId = new Map();
        const add = (id, name) => {
            if (id == null) return;
            const key = String(id);
            const cur = byId.get(key);
            if (!cur) byId.set(key, { id: Number(id), name: name || null });
            else if (!cur.name && name) cur.name = name;
        };
        (accounts.data || []).forEach(a => add(a.id, a.display_name));
        [sessions, assigns, roles, methods].forEach(r => (r.data || []).forEach(x => add(x.roblox_user_id, x.roblox_username)));
        return [...byId.values()].filter(p => p.name).sort((a, b) => a.name.localeCompare(b.name));
    }

    return {
        knownPeople,
        actions: {
            list_known_people: {
                run: async ({ session, res }) => {
                    if (!ALLOWED.some(p => hasPermission(session, p))) { res.status(403).json({ ok: false, error: 'missing_permission' }); return; }
                    res.json({ ok: true, data: await knownPeople() });
                }
            }
        }
    };
};
