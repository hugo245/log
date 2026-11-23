'use strict';
// Settings > Plan: which tier and add-ons this deployment's licence covers.

module.exports = function plan(ctx) {
    const { license, studio, requirePermission, hasPermission } = ctx;

    const FEATURE_LABELS = {
        analytics: 'Analytics', paymentRuns: 'Payment runs', revenueShare: 'Revenue share', contracts: 'Contracts',
        taxForms: 'Tax forms & receipts', accountingExport: 'Accounting exports', budgets: 'Game budgets',
        multiCurrency: 'Your own cash currency', discord: 'Discord linking & bot', recruitment: 'Recruitment'
    };

    // Logged once at start-up so the host's logs say what's running.
    const st = license.state();
    if (!st.managed) console.log('[license] licensing not set up (no seller key) - everything is unlocked.');
    else if (st.valid) console.log(`[license] ${st.tier} licence for ${st.licensee || 'unknown'}${st.addons.length ? ` + ${st.addons.join(', ')}` : ''}${st.expires ? `, expires ${st.expires}` : ''}.`);
    else console.warn(`[license] licence not valid (${st.reason}) - running as Core with no add-ons.`);

    return {
        actions: {
            get_plan: {
                run: async ({ session, res }) => {
                    if (!hasPermission(session, 'settings.manage_branding') && !requirePermission(res, session, 'roles.manage')) return;
                    const locked = new Set(license.lockedFeatures());
                    const all = [...license.PRO_FEATURES, ...Object.values(license.ADDON_FEATURES).flat()];
                    res.json({
                        ok: true,
                        data: {
                            ...license.publicState(),
                            features: all.map(f => ({
                                key: f,
                                label: FEATURE_LABELS[f] || f,
                                group: license.PRO_FEATURES.includes(f) ? 'Pro' : 'Add-on',
                                included: !locked.has(f),
                                on: studio.feature(f)
                            }))
                        }
                    });
                }
            }
        }
    };
};
