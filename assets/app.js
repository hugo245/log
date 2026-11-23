    // ---------------------------------------------------------------------------------
    // Deployment + branding. EDGE_BASE comes from config.js; everything else about the
    // studio (name, logo, colours, copy, features) comes from the API's /public/bootstrap
    // and is cached so repeat visits paint instantly.
    // ---------------------------------------------------------------------------------
    const DEPLOY = window.STUDIO_CONFIG || {};
    const EDGE_BASE = String(DEPLOY.apiBase || '').replace(/\/+$/, '');
    const BOOTSTRAP_CACHE_KEY = 'studio_bootstrap_v2';
    const DEFAULT_BRANDING = {
      studio: { name: 'Studio Panel', shortName: 'SP', productName: '', logoUrl: 'assets/logo.svg', website: '', websiteLabel: '' },
      theme: { accent: '#6366F1', accentDark: '#8B87FF', radius: 18, defaultMode: 'light' },
      signIn: {
        title: 'Sign in', subtitle: '', buttonLabel: 'Sign in with Roblox', headline: 'Paid for what you build.',
        tagline: '', backgroundImage: '', footerNote: '', showPreview: true, termsUrl: '#/terms', privacyUrl: '#/privacy'
      },
      // Add-on features stay hidden until the API says they're on.
      features: { discord: false, recruitment: false },
      payments: { currencies: ['ROBUX', 'USD'], methods: ['PAYPAL', 'DEVEX_ROBUX', 'VENMO', 'BANK_TRANSFER'] }
    };

    function mergeBranding(base, extra) {
      const out = { ...base };
      if (!extra || typeof extra !== 'object') return out;
      Object.keys(extra).forEach(k => {
        const v = extra[k];
        if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) out[k] = mergeBranding(base[k], v);
        else if (v !== undefined && v !== null) out[k] = v;
      });
      return out;
    }

    function readCachedBootstrap() {
      try { return JSON.parse(localStorage.getItem(BOOTSTRAP_CACHE_KEY) || 'null'); } catch (e) { return null; }
    }

    let BOOTSTRAP = readCachedBootstrap();
    let STUDIO = mergeBranding(mergeBranding(DEFAULT_BRANDING, DEPLOY.branding), BOOTSTRAP && BOOTSTRAP.config);

    function studioName() { return STUDIO.studio.name || 'Studio Panel'; }
    // Full product name, e.g. "Acme" + "Panel". The suffix is optional in studio.config.json.
    function brandName() { return [studioName(), STUDIO.studio.productName].filter(Boolean).join(' '); }
    function studioShort() { return STUDIO.studio.shortName || studioName().slice(0, 2).toUpperCase(); }
    function studioLogo() { return STUDIO.studio.logoUrl || 'assets/logo.svg'; }
    function featureOn(name) { return !name || !STUDIO.features || STUDIO.features[name] !== false; }
    // Discord (linking, roles, servers, the bot) is a paid add-on and off unless the API says otherwise.
    function discordOn() { return !!(STUDIO.features && STUDIO.features.discord === true); }
    // Colours set by admins (team/skillset colours) are only ever used if they are a plain
    // hex/rgb value, so they can't be used to smuggle extra CSS into a style attribute.
    function safeColor(c, fallback) {
      const v = String(c || '').trim();
      return /^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\))$/.test(v) ? v : (fallback || 'var(--ink)');
    }

    function gateMark() {
      return STUDIO.studio.logoUrl ? `<img src="${esc(STUDIO.studio.logoUrl)}" alt="">` : esc(studioShort());
    }
    function studioWebsiteLink(cls) {
      if (!STUDIO.studio.website) return '';
      return `<a class="${cls || 'link'}" href="${esc(STUDIO.studio.website)}" target="_blank" rel="noopener noreferrer">${esc(STUDIO.studio.websiteLabel || STUDIO.studio.website.replace(/^https?:\/\/(www\.)?/, ''))}</a>`;
    }

    function applyBranding() {
      const root = document.documentElement;
      const hex = /^#[0-9a-fA-F]{6}$/;
      const t = STUDIO.theme || {};
      if (hex.test(t.accent || '')) root.style.setProperty('--brand', t.accent);
      if (hex.test(t.accentDark || '')) root.style.setProperty('--brand-dark', t.accentDark);
      if (t.radius) root.style.setProperty('--radius-lg', Math.max(4, Math.min(28, Number(t.radius) || 18)) + 'px');
      document.title = brandName();
      const icon = document.querySelector('link[rel="icon"]');
      if (icon && STUDIO.studio.logoUrl && icon.getAttribute('href') !== STUDIO.studio.logoUrl) icon.setAttribute('href', STUDIO.studio.logoUrl);
    }
    applyBranding();

    // Fetches branding, site status, games and the DevEx rate in one round trip.
    async function fetchBootstrap() {
      const res = await fetchWithTimeout(EDGE_BASE + '/public/bootstrap', { headers: { 'ngrok-skip-browser-warning': 'true' } }, 12000);
      const json = await res.json().catch(() => null);
      if (!json || !json.config) throw new Error('bootstrap_failed');
      BOOTSTRAP = json;
      STUDIO = mergeBranding(mergeBranding(DEFAULT_BRANDING, DEPLOY.branding), json.config);
      try { localStorage.setItem(BOOTSTRAP_CACHE_KEY, JSON.stringify({ config: json.config, games: json.games, devexRate: json.devexRate, savedAt: Date.now() })); } catch (e) { }
      applyBranding();
      return json;
    }

    function fetchWithTimeout(url, options, ms) {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), ms || 15000) : null;
      return fetch(url, { ...(options || {}), signal: ctrl ? ctrl.signal : undefined })
        .finally(() => { if (timer) clearTimeout(timer); });
    }

    // Heavy libraries are only downloaded the first time a screen needs them.
    const lazyScripts = {};
    function loadScriptOnce(src) {
      if (!lazyScripts[src]) {
        lazyScripts[src] = new Promise((resolve, reject) => {
          const el = document.createElement('script');
          el.src = src;
          el.async = true;
          el.crossOrigin = 'anonymous';
          el.onload = () => resolve();
          el.onerror = () => { delete lazyScripts[src]; reject(new Error('Could not load ' + src)); };
          document.head.appendChild(el);
        });
      }
      return lazyScripts[src];
    }
    const CHART_JS_URL = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js';
    const EXCELJS_URL = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
    function ensureChartJs() { return window.Chart ? Promise.resolve() : loadScriptOnce(CHART_JS_URL); }
    function ensureExcelJs() { return window.ExcelJS ? Promise.resolve() : loadScriptOnce(EXCELJS_URL); }

    const SESSION_STORAGE_KEY = 'pv_hr_session_token';
    const RETURN_HASH_KEY = 'pv_return_hash';
    const THEME_STORAGE_KEY = 'pv_theme';
    const RECRUIT_TOKEN_KEY = 'pv_recruit_token';

    function getTheme() {
      return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    }
    function setTheme(theme) {
      document.documentElement.setAttribute('data-theme', theme);
      try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch (e) { }
    }
    function toggleTheme() {
      setTheme(getTheme() === 'dark' ? 'light' : 'dark');
      document.querySelectorAll('#themeToggleBtn').forEach(btn => {
        const svg = btn.querySelector('svg');
        if (svg) svg.outerHTML = themeToggleIcon(); else btn.innerHTML = themeToggleIcon();
        btn.setAttribute('aria-label', getTheme() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
      });
    }
    function themeToggleIcon() {
      return getTheme() === 'dark'
        ? '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.2"></circle><path d="M12 2.5v2.6M12 18.9v2.6M4.4 4.4l1.85 1.85M17.75 17.75l1.85 1.85M2.5 12h2.6M18.9 12h2.6M4.4 19.6l1.85-1.85M17.75 6.25l1.85-1.85"></path></svg>'
        : '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a7 7 0 0 0 10.7 10.7Z"></path></svg>';
    }

    const PERMISSION_GROUPS = [
      { id: 'payments', label: 'Payments', hint: 'Logging and paying out work', match: p => p.startsWith('dashboard.') },
      { id: 'people', label: 'People', hint: 'Staff records and moderation', match: p => p.startsWith('staff.') || p.startsWith('payouts.') },
      { id: 'teams', label: 'Teams & games', hint: 'Teams, games, boards and deadlines', match: p => p.startsWith('teams.') },
      { id: 'recruitment', label: 'Recruitment', hint: 'Applications and hiring', match: p => p.startsWith('recruitment.') },
      { id: 'settings', label: 'Settings', hint: 'Configuration that affects everyone', match: p => p.startsWith('settings.') || p.startsWith('roles.') || p.startsWith('broadcasts.') || p.startsWith('security.') },
      { id: 'records', label: 'Records', hint: 'Audit log and backups', match: p => p.startsWith('audit.') || p.startsWith('backups.') }
    ];

    const PERMISSION_PRESETS = {
      Developer: ['teams.view'],
      Lead: ['dashboard.view', 'dashboard.submit_request', 'staff.view_database', 'teams.view', 'teams.manage'],
      Producer: ['dashboard.view', 'dashboard.submit_request', 'dashboard.mark_paid', 'dashboard.export', 'staff.view_database', 'staff.moderate', 'teams.view', 'teams.manage', 'recruitment.view', 'audit.view'],
      Everything: null
    };

    const PERMISSION_LABELS = {
      'dashboard.view': 'View dashboard',
      'dashboard.mark_paid': 'Mark requests paid',
      'dashboard.export': 'Export / copy data',
      'dashboard.submit_request': 'Submit payment requests (on behalf of a developer)',
      'settings.manage_games': 'Manage games',
      'settings.manage_rate': 'Manage DevEx rate',
      'settings.manage_groups': 'Manage payout eligibility groups',
      'settings.manage_base_access': 'Manage sign-in access requirement',
      'settings.manage_onboarding': 'Manage teams, skillsets & invite links',
      'settings.manage_branding': 'Edit branding (name, logo, colours, sign-in page, legal text)',
      'roles.manage': 'Manage roles and access',
      'staff.view_database': 'View staff database',
      'staff.moderate': 'Warn and ban staff',
      'broadcasts.manage': 'Send broadcasts',
      'audit.view': 'View audit logs',
      'audit.revert': 'Revert audit log actions',
      'backups.manage': 'Create, load, and restore database backups',
      'recruitment.view': 'View recruitment tickets',
      'recruitment.respond': 'Show up as a recruiter (referral list)',
      'recruitment.manage': 'Manage recruitment tickets (accept, reject, assign, place teams)',
      'recruitment.signoff': 'Sign off recruitment placements as ready',
      'recruitment.finalise': 'Finalise recruitment placements (grant roles/access)',
      'recruitment.analytics': 'View recruitment analytics',
      'payouts.view_bank_details': 'View full bank transfer details (name, address, SWIFT and IBAN)',
      'security.manage': 'Manage security (raise the protocol, hold accounts, sign people out)',
      'teams.view': 'View teams, their games and deadlines',
      'teams.manage': 'Assign games to teams and manage team deadlines',
      'revenue.manage': 'Manage revenue shares and record game revenue',
      'contracts.manage': 'Create and manage contracts and milestones',
      'tax.view': 'View tax details (legal names, addresses, tax IDs) and year-end totals'
    };
    const ALL_PERMISSIONS = Object.keys(PERMISSION_LABELS);

    function groupPermissions(list) {
      const seen = new Set();
      const groups = PERMISSION_GROUPS.map(g => {
        const items = list.filter(p => !seen.has(p) && g.match(p));
        items.forEach(p => seen.add(p));
        return { ...g, items };
      }).filter(g => g.items.length);
      const rest = list.filter(p => !seen.has(p));
      if (rest.length) groups.push({ id: 'other', label: 'Other', hint: '', items: rest });
      return groups;
    }

    function permissionPickerHtml(cls, chosen, roleId) {
      const has = (p) => (chosen || []).includes(p);
      // Permissions for features this studio doesn't have are hidden, but kept on the role.
      const hiddenPerm = (p) => /^recruitment\./.test(p) && !featureOn('recruitment');
      const all = ALL_PERMISSIONS.concat((chosen || []).filter(p => p && !ALL_PERMISSIONS.includes(p)));
      const known = all.filter(p => !hiddenPerm(p));
      const kept = all.filter(p => hiddenPerm(p) && has(p));
      return `
        ${kept.map(p => `<input type="checkbox" hidden class="${esc(cls)}" ${roleId ? `data-role-id="${esc(roleId)}"` : ''} value="${esc(p)}" checked>`).join('')}
        <div class="perm-presets">
          <span class="hint">Quick set:</span>
          ${Object.keys(PERMISSION_PRESETS).map(name => `<button type="button" class="chip-filter" data-perm-preset="${esc(name)}" data-perm-target="${esc(cls)}" data-role-id="${esc(roleId || '')}">${esc(name)}</button>`).join('')}
          <button type="button" class="chip-filter" data-perm-preset="None" data-perm-target="${esc(cls)}" data-role-id="${esc(roleId || '')}">Clear</button>
        </div>
        ${groupPermissions(known).map(g => `
          <div class="perm-group">
            <div class="perm-group-head">
              <strong>${esc(g.label)}</strong>
              ${g.hint ? `<span class="hint">${esc(g.hint)}</span>` : ''}
              <button type="button" class="pp-linkbtn" data-perm-group="${esc(g.id)}" data-perm-target="${esc(cls)}" data-role-id="${esc(roleId || '')}">${g.items.every(has) ? 'None' : 'All'}</button>
            </div>
            <div class="perm-check-grid">
              ${g.items.map(p => `
                <label class="perm-check-item" title="${esc(p)}"><input type="checkbox" class="${esc(cls)}" ${roleId ? `data-role-id="${esc(roleId)}"` : ''} data-perm-group-id="${esc(g.id)}" value="${p}" ${has(p) ? 'checked' : ''}> ${esc(PERMISSION_LABELS[p] || p)}</label>`).join('')}
            </div>
          </div>`).join('')}`;
    }


    const ONBOARDING_TYPE_LABELS = {
      intro: 'Getting started',
      team_info: 'Team & skillset',
      tos: 'Terms of Service',
      aup: 'Acceptable Use Policy'
    };
    const REF_STORAGE_KEY = 'pv_pending_ref';

    const PAYMENT_METHODS = {
      PAYPAL: { label: 'PayPal', sub: 'Paid to your PayPal email address', fields: [{ key: 'paypalEmail', label: 'PayPal email', type: 'text', placeholder: 'you@example.com' }] },
      DEVEX_ROBUX: { label: 'Robux', sub: 'Paid in Robux via the Roblox group(s)', fields: [{ key: 'robloxUsername', label: 'Roblox username to receive Robux', type: 'text', placeholder: 'Builderman' }] },
      VENMO: { label: 'Venmo', sub: 'Paid to your Venmo username', fields: [{ key: 'venmoUsername', label: 'Venmo username', type: 'text', placeholder: '@your-venmo' }] },
      BANK_TRANSFER: {
        label: 'Bank transfer',
        sub: 'Paid straight into your bank account',
        confidential: true,
        fields: [
          { key: 'fullName', label: 'First and last name', type: 'text', placeholder: 'As it appears on the account' },
          { key: 'country', label: 'Country', type: 'text', placeholder: 'United States of America' },
          { key: 'city', label: 'City', type: 'text', placeholder: 'Los Angeles' },
          { key: 'address', label: 'Address', type: 'text', placeholder: 'Street and house number' },
          { key: 'postalCode', label: 'Postal code', type: 'text', placeholder: 'e.g. 90012' },
          { key: 'swift', label: 'SWIFT / BIC', type: 'text', placeholder: 'Your SWIFT / BIC' },
          { key: 'iban', label: 'IBAN or account number', type: 'text', placeholder: 'e.g. GB33 BUKB 2020 1555 5555 55' }
        ]
      }
    };

    const PAYOUT_PRIVACY_NOTE = 'Your personal details are strictly confidential. Regular staff cannot see them; only roles with the bank details permission can.';

    // Payout methods and currencies this studio actually offers (studio.config.json "payments").
    function methodEnabled(key) {
      const list = (STUDIO.payments && STUDIO.payments.methods) || [];
      return !list.length || list.includes(key);
    }
    function currencyEnabled(code) {
      const list = (STUDIO.payments && STUDIO.payments.currencies) || [];
      return !list.length || list.includes(code);
    }

    let configError = null;
    if (!EDGE_BASE || EDGE_BASE.indexOf('YOUR-SERVER-DOMAIN') !== -1) {
      configError = 'The API address is not configured yet. Set apiBase in config.js to your server URL.';
    }

    const ROBUX_IMG = 'https://devforum-uploads.s3.dualstack.us-east-2.amazonaws.com/uploads/original/4X/e/a/9/ea98f8c6c438d2d8136a6751282a153c6b28b892.png';
    const CURRENCY_SYMBOL = { USD: '$' };

    let DEVEX_RATE = 0.0038;
    let GAMES = [];

    let isHrAuthed = false;
    let hrUsername = '';
    let hrUserId = null;
    let hrRoles = [];
    let hrPermissions = [];
    let siteLocked = false;
    let lockdownNote = '';
    let securityLevel = 'normal';
    const REVAMP_TOUR_VERSION = 1;
    let tourState = null;
    let tourRunning = false;
    let tourRequested = false;
    let hrMaxHierarchy = 0;
    let authReady = false;
    let appDataReady = false;
    let needsOnboarding = false;
    let needsDiscordLink = false;
    let teamRemoved = false;
    let hrTeamState = 'ok';

    let renderGen = 0;

    function hasPermission(permission) {
      return hrPermissions.includes(permission);
    }

    function canSubmitRequests() {
      return isHrAuthed && hasPermission('dashboard.submit_request');
    }

    function devexLabel() {
      const per10k = DEVEX_RATE * 10000;
      return `DevEx rate: $${per10k.toFixed(2)} per 10,000 Robux (${DEVEX_RATE})`;
    }

    function fmtAmount(data) {
      const isRobux = data.currency === 'ROBUX';
      const n = isRobux
        ? Number(data.payment || 0).toLocaleString()
        : Number(data.payment || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      if (isRobux) return `<img class="robux-icon" src="${ROBUX_IMG}" alt="Robux">${n}`;
      return `${CURRENCY_SYMBOL[data.currency] || ''}${n} ${data.currency}`;
    }

    function devexEquivalent(data) {
      if (data.currency !== 'ROBUX') return '';
      const usd = (Number(data.payment) || 0) * DEVEX_RATE;
      return `&asymp; $${usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD at DevEx`;
    }

    function robuxEquivalentLabel(data) {
      if (data.currency !== 'USD') return '';
      const usd = Number(data.payment) || 0;
      if (usd <= 0 || !DEVEX_RATE) return '';
      const robux = usd / DEVEX_RATE;
      return `Equal to ${Math.round(robux).toLocaleString()} Robux`;
    }

    function esc(str) {
      return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function safeUrl(str) {
      const s = String(str ?? '').trim();
      if (!s) return null;
      try {
        const u = new URL(s, window.location.origin);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
        return u.href;
      } catch (e) {
        return null;
      }
    }

    function fmtDate(ts) {
      const d = new Date(ts);
      return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
    }

    const ROLING_BATCH_INTERVAL_MS = 6 * 60 * 60 * 1000;

    function formatCountdown(ms) {
      if (ms <= 0) return 'Any moment now';
      const totalMinutes = Math.floor(ms / 60000);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      if (hours > 0) return `${hours}h ${minutes}m`;
      const totalSeconds = Math.floor(ms / 1000);
      if (minutes > 0) return `${minutes}m ${totalSeconds % 60}s`;
      return `${totalSeconds}s`;
    }

    function fmtDateTime(ts) {
      const d = new Date(ts);
      return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) + ', ' +
        d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }

    function debounce(fn, wait) {
      let timer = null;
      return function debounced() {
        const args = arguments;
        const ctx = this;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { timer = null; fn.apply(ctx, args); }, wait);
      };
    }

    function userLink(userId, username) {
      const label = esc(username || (userId ? `ID ${userId}` : 'Unknown'));
      if (!userId && !username) return `<span class="hint">Unknown</span>`;
      return `<button type="button" class="user-link" data-user-link data-user-id="${esc(userId || '')}" data-user-name="${esc(username || '')}">${label}</button>`;
    }

    function hslToHex(h, s, l) {
      s /= 100; l /= 100;
      const k = n => (n + h / 30) % 12;
      const a = s * Math.min(l, 1 - l);
      const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
      const toHex = x => Math.round(255 * x).toString(16).padStart(2, '0');
      return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
    }
    function gameColor(name) {
      const s = String(name || '');
      let hash = 0;
      for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
      const hue = Math.abs(hash) % 360;
      return hslToHex(hue, 65, 45);
    }

    function copyText(text, btn, label) {
      const done = () => flashBtn(btn, label || 'Copied!');
      const legacyCopy = () => {
        try {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.top = '0';
          ta.style.left = '-9999px';
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          const ok = document.execCommand('copy');
          document.body.removeChild(ta);
          if (ok) done(); else flashBtn(btn, 'Select and copy');
        } catch (e) { flashBtn(btn, 'Select and copy'); }
      };
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(done).catch(legacyCopy);
      } else {
        legacyCopy();
      }
    }

    function flashBtn(btn, msg) {
      if (!btn) return;
      const original = btn.textContent;
      btn.textContent = msg;
      setTimeout(() => { btn.textContent = original; }, 1500);
    }

    function parseWorkLines(raw) {
      return String(raw || '')
        .split('\n')
        .map(l => l.trim().replace(/^->\s*/, '').replace(/^-\s*/, ''))
        .filter(Boolean)
        .map(text => {
          let lead = text, rest = '';
          const periodIdx = text.indexOf('. ');
          if (periodIdx !== -1) { lead = text.slice(0, periodIdx + 1); rest = text.slice(periodIdx + 2); }
          return { lead, rest };
        });
    }

    function renderInvoice(data) {
      const items = parseWorkLines(data.workRaw || '');
      const isPaid = !!data.paid;
      const listHtml = items.length
        ? `<ol class="items-list">${items.map(item => `
        <li><span class="lead">${esc(item.lead)}</span>${item.rest ? ` ${esc(item.rest)}` : ''}</li>`).join('')}</ol>`
        : `<div class="empty-note">No work items added yet.</div>`;

      return `
    <div class="invoice">
      <div class="invoice-top">
        <div class="brand"><img class="pv-logo" src="${esc(studioLogo())}" alt="">${esc(studioName())}</div>
        <div class="doc-type">
          <div class="doc-label">Payment Request</div>
          <div class="doc-id mono">${esc(data.id)}</div>
        </div>
      </div>
      <hr class="divider">
      <div class="parties">
        <div><div class="party-label">Requested by</div><div class="party-value">${esc(data.requestedBy || '-')}</div></div>
        <div><div class="party-label">Roblox account</div><div class="party-value mono">${esc(data.robloxUsername || '-')}</div></div>
        <div><div class="party-label">Date logged</div><div class="party-value mono">${esc(fmtDate(data.createdAt || Date.now()))}</div></div>
      </div>
      <div class="task-block">
        <div class="task-label">Task</div>
        <div class="task-title">${esc(data.taskName || 'Untitled task')}</div>
        ${data.game ? `<div style="margin-top:9px;"><span class="game-badge" style="background:${gameColor(data.game)};">${esc(data.game)}</span></div>` : ''}
        ${data.skillsetNames && data.skillsetNames.length ? `<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px;">${data.skillsetNames.map(name => `<span class="skill-badge">${esc(name)}</span>`).join('')}</div>` : ''}
      </div>
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-label">Time worked</div><div class="stat-value">${esc(data.timeWorked || '-')}</div></div>
        <div class="stat-card"><div class="stat-label">Work items</div><div class="stat-value">${items.length}</div></div>
        <div class="stat-card stat-status${isPaid ? ' is-paid' : ''}"><div class="stat-label">Status</div><div class="stat-value">${isPaid ? `Paid ${esc(fmtDate(data.paidAt || Date.now()))}` : 'Pending'}</div></div>
      </div>
      <div class="items-block">
        <div class="items-head">Work completed</div>
        ${listHtml}
      </div>
      <div class="total-row">
        <div class="total-label">${isPaid ? 'Total Paid' : 'Total Due'}</div>
        <div style="text-align:right;">
          <div class="total-value">${fmtAmount(data)}</div>
          ${data.currency === 'ROBUX' ? `<div style="font-size:11.5px;color:var(--muted);margin-top:3px;">${devexEquivalent(data)}</div>` : ''}
        </div>
      </div>
      <div class="invoice-foot"><span class="foot-contact">${devexLabel()}</span></div>
    </div>`;
    }

    function rowToClient(row) {
      return {
        id: row.id,
        requestedBy: row.requested_by || '',
        requestedByUserId: row.requested_by_user_id != null ? row.requested_by_user_id : null,
        split: row.split || null,
        robloxUserId: row.roblox_user_id != null ? row.roblox_user_id : null,
        robloxUsername: row.roblox_username || '',
        taskName: row.task_name || '',
        game: row.game || '',
        workRaw: row.work_raw || '',
        timeWorked: row.time_worked || '',
        payment: row.payment,
        currency: row.currency || 'ROBUX',
        paid: !!row.paid,
        status: row.status || (row.paid ? 'paid' : 'pending'),
        statusNote: row.status_note || '',
        paidAt: row.paid_at ? new Date(row.paid_at).getTime() : null,
        createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
        paymentMethod: row.payment_method || null,
        requesterRoles: row.requester_roles || [],
        requesterTeam: row.requester_team || null,
        requesterSkillset: row.requester_skillset || null,
        skillsetNames: Array.isArray(row.skillset_names) && row.skillset_names.length
          ? row.skillset_names
          : (row.skillset_name ? [row.skillset_name] : [])
      };
    }

    let bankDetailsFor = null;

    function bankDetailsModalHtml() {
      const info = bankDetailsFor;
      if (!info) return '';
      const def = PAYMENT_METHODS.BANK_TRANSFER;
      const d = info.details || {};
      const rows = def.fields.map(f => ({ label: f.label, key: f.key, value: String(d[f.key] || '').trim() })).filter(r => r.value);
      const plain = [`Pay ${info.amount}`, `Reference: ${info.reference}`].concat(rows.map(r => `${r.label}: ${r.value}`)).join('\n');
      return `
      <div class="pp-scrim" id="bankScrim">
        <aside class="pp" role="dialog" aria-modal="true" aria-labelledby="bankTitle">
          <div class="pp-head">
            <div style="flex:1;min-width:0;">
              <h2 id="bankTitle">Pay ${esc(info.name)}</h2>
              <div class="pp-sub">${esc(info.amount)} &middot; bank transfer</div>
            </div>
            <button type="button" class="modal-close" id="bankClose" aria-label="Close">&times;</button>
          </div>
          <div class="pp-body">
            <div class="bank-amount">
              <span class="hint">Amount to send</span>
              <strong>${esc(info.amount)}</strong>
            </div>
            <div class="bank-rows">
              ${rows.map(r => `
                <div class="bank-row">
                  <span class="hint">${esc(r.label)}</span>
                  <code>${esc(r.value)}</code>
                  <button type="button" class="btn btn-ghost btn-sm" data-copy-value="${esc(r.value)}">Copy</button>
                </div>`).join('')}
              <div class="bank-row">
                <span class="hint">Reference</span>
                <code>${esc(info.reference)}</code>
                <button type="button" class="btn btn-ghost btn-sm" data-copy-value="${esc(info.reference)}">Copy</button>
              </div>
            </div>
            <p class="hint" style="margin:14px 0 0;">Put the reference on the transfer so it can be matched back to this request. These details are confidential.</p>
          </div>
          <div class="pp-foot">
            <button type="button" class="btn btn-primary btn-sm" data-copy-value="${esc(plain)}">Copy everything</button>
            <button type="button" class="btn btn-ghost btn-sm" id="bankCloseFoot">Close</button>
          </div>
        </aside>
      </div>`;
    }

    function wireBankDetails(rowsById) {
      document.querySelectorAll('[data-bank-details]').forEach(el => el.addEventListener('click', (e) => {
        e.stopPropagation();
        const r = rowsById(el.dataset.bankDetails);
        if (!r || !r.paymentMethod) return;
        bankDetailsFor = {
          name: r.robloxUsername || 'them',
          amount: r.currency === 'ROBUX' ? `R$ ${Number(r.payment).toLocaleString()}` : `$${Number(r.payment).toFixed(2)}`,
          reference: r.id,
          details: r.paymentMethod.details || {}
        };
        paintBankModal();
      }));
    }

    function paintBankModal() {
      let root = document.getElementById('bankModalRoot');
      if (!root) { root = document.createElement('div'); root.id = 'bankModalRoot'; document.body.appendChild(root); }
      root.innerHTML = bankDetailsModalHtml();
      const close = () => { bankDetailsFor = null; paintBankModal(); };
      ['bankClose', 'bankCloseFoot'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', close);
      });
      const scrim = document.getElementById('bankScrim');
      if (scrim) scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
      root.querySelectorAll('[data-copy-value]').forEach(el => el.addEventListener('click', () => {
        if (navigator.clipboard) navigator.clipboard.writeText(el.dataset.copyValue);
        toast('Copied');
      }));
    }

    function methodDisplayLabel(pm) {
      if (!pm) return null;
      const def = PAYMENT_METHODS[pm.method];
      if (!def) return null;
      if (def.confidential) {
        const who = (pm.details || {}).fullName;
        return pm.detailsHidden || !who ? `${def.label} (details hidden)` : `${def.label}: ${who}`;
      }
      if (!def.fields || !def.fields.length) return def.label;
      const key = def.fields[0].key;
      const val = (pm.details || {})[key] || '';
      return `${def.label}: ${val}`;
    }

    function methodHiddenTitle(pm) {
      if (!pm || !pm.detailsHidden) return '';
      return ' title="Bank details are only shown to roles with the &quot;View full bank transfer details&quot; permission. A role manager can turn that on in Settings, Roles."';
    }

    // Games, DevEx rate and site status all come from the single /public/bootstrap call.
    let bootstrapPromise = null;
    function ensureBootstrap(force) {
      if (!bootstrapPromise || force) {
        bootstrapPromise = fetchBootstrap().catch(err => { bootstrapPromise = null; throw err; });
      }
      return bootstrapPromise;
    }

    function applyBootstrapData(b) {
      if (!b) return;
      if (Array.isArray(b.games)) GAMES = b.games;
      if (b.devexRate != null && Number.isFinite(Number(b.devexRate))) DEVEX_RATE = Number(b.devexRate);
    }

    async function loadGames() {
      try { applyBootstrapData(await ensureBootstrap(true)); } catch (e) { console.error('loadGames failed:', e.message); }
    }

    async function loadDevexRate() {
      try { applyBootstrapData(await ensureBootstrap(true)); } catch (e) { }
    }

    async function loadAppData() {
      // Paint from cache straight away; the live values land as soon as the API answers.
      applyBootstrapData(BOOTSTRAP);
      try { applyBootstrapData(await ensureBootstrap()); } catch (e) { }
      appDataReady = true;
    }

    const INDEV_PREVIEW_KEY = 'pv_indev_preview';
    const BYPASS_TTL_MS = 6 * 60 * 60 * 1000;
    const STATUS_POLL_MS = 15000;
    const SITE_WATCH_MS = 30000;

    function stParseList(v) {
      if (Array.isArray(v)) return v;
      if (typeof v === 'string' && v.trim()) {
        try {
          const parsed = JSON.parse(v);
          return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
          return [];
        }
      }
      return [];
    }

    async function checkSiteState(force) {
      const failed = { ok: false, closed: false, unreachable: true, indev: false, servicesDown: false, message: '', startedAt: null, eta: null, timeline: [], services: [] };
      if (configError) return failed;
      try {
        const b = await ensureBootstrap(force);
        const d = b.site || {};
        if (d.readable === false) return failed;
        return {
          ok: true,
          closed: !!d.closed,
          indev: !!d.indev,
          servicesDown: !!d.servicesDown,
          message: d.message || '',
          startedAt: d.startedAt || null,
          eta: d.eta || null,
          timeline: stParseList(d.timeline),
          services: stParseList(d.services)
        };
      } catch (e) {
        return failed;
      }
    }

    // Removes currencies this studio doesn't pay in from every currency picker, wherever it
    // is rendered. (The API refuses them regardless; this just keeps the UI honest.)
    (function watchCurrencyPickers() {
      const prune = (root) => {
        const off = ['ROBUX', 'USD'].filter(c => !currencyEnabled(c));
        if (!off.length || !root.querySelectorAll) return;
        root.querySelectorAll('select').forEach(sel => {
          const values = Array.from(sel.options).map(o => o.value);
          if (!values.includes('ROBUX') || !values.includes('USD')) return;
          Array.from(sel.options).forEach(o => { if (off.includes(o.value)) o.remove(); });
        });
      };
      const start = () => {
        const target = document.getElementById('app');
        if (!target || typeof MutationObserver === 'undefined') return;
        new MutationObserver(() => prune(target)).observe(target, { childList: true, subtree: true });
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
    })();

    function hasIndevPreview() {
      try {
        const url = String(window.location.href);
        if (/[?&#]preview=1\b/.test(url)) localStorage.setItem(INDEV_PREVIEW_KEY, String(Date.now() + BYPASS_TTL_MS));
        if (/[?&#]preview=0\b/.test(url)) localStorage.removeItem(INDEV_PREVIEW_KEY);
        const expiry = Number(localStorage.getItem(INDEV_PREVIEW_KEY));
        if (expiry > Date.now()) return true;
        localStorage.removeItem(INDEV_PREVIEW_KEY);
        return false;
      } catch (e) {
        return false;
      }
    }

    function enableBypass() {
      try { localStorage.setItem(INDEV_PREVIEW_KEY, String(Date.now() + BYPASS_TTL_MS)); } catch (e) { }
      window.location.href = window.location.pathname + '#/';
      window.location.reload();
    }

    function disableBypass() {
      try { localStorage.removeItem(INDEV_PREVIEW_KEY); } catch (e) { }
      window.location.href = window.location.pathname + '#/';
      window.location.reload();
    }


    let statusState = null;
    let statusTimer = null;
    let statusNextAt = 0;
    let statusLastCheck = 0;
    let statusChecking = false;
    let statusLeaving = false;
    let statusSig = '';
    let siteWatchTimer = null;

    function stEsc(v) {
      return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function stDur(ms) {
      const s = Math.max(0, Math.floor(ms / 1000));
      if (s < 60) return s + 's';
      const m = Math.floor(s / 60);
      if (m < 60) return m + 'm ' + String(s % 60).padStart(2, '0') + 's';
      const h = Math.floor(m / 60);
      if (h < 24) return h + 'h ' + String(m % 60).padStart(2, '0') + 'm';
      return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
    }

    function stIsDate(v) {
      return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) && !isNaN(Date.parse(v));
    }

    function stStamp(v) {
      if (!v) return '';
      if (stIsDate(String(v)) || v instanceof Date) {
        return new Date(v).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      }
      return String(v);
    }

    function stFirstSeen(mode) {
      const key = 'pv_status_seen_' + mode;
      try {
        const saved = Number(localStorage.getItem(key));
        if (saved > 0) return saved;
        const now = Date.now();
        localStorage.setItem(key, String(now));
        return now;
      } catch (e) {
        return Date.now();
      }
    }

    function stClearSeen() {
      try {
        localStorage.removeItem('pv_status_seen_down');
        localStorage.removeItem('pv_status_seen_dev');
      } catch (e) { }
    }

    function stNormStatus(v) {
      const s = String(v || 'ok').toLowerCase();
      if (['down', 'outage', 'offline', 'major'].includes(s)) return 'down';
      if (['degraded', 'partial', 'slow', 'issues', 'warn'].includes(s)) return 'degraded';
      return 'ok';
    }

    function stServices(state) {
      if (state.services.length) {
        return state.services.map(sv => ({ name: sv.name || sv.label || 'Service', status: stNormStatus(sv.status), note: sv.note || sv.text || '' }));
      }
      if (!state.servicesDown) return [];
      return [
        { name: 'Authentication', status: 'down', note: 'Roblox sign-in is failing' },
        { name: 'Database', status: 'ok', note: '' },
        { name: 'Roblox', status: 'ok', note: '' },
        { name: 'Hosting', status: 'ok', note: '' },
        { name: 'Payments & requests', status: 'ok', note: '' },
        { name: 'Teams & tasks', status: 'ok', note: '' }
      ];
    }

    function stTimeline(state) {
      if (state.timeline.length) {
        return state.timeline.map(t => ({
          time: stStamp(t.time || t.at || ''),
          title: t.title || t.label || '',
          text: t.text || t.note || '',
          state: ['done', 'active', 'pending'].includes(t.state) ? t.state : 'pending'
        }));
      }
      if (state.servicesDown) {
        return [
          { time: stStamp(new Date(state._start)), title: 'Issue detected', text: 'Monitoring flagged the problem and the status page went live.', state: 'done' },
          { time: '', title: 'Investigating', text: 'The team is finding the root cause.', state: 'active' },
          { time: '', title: 'Fix in progress', text: 'A fix is being built and verified.', state: 'pending' },
          { time: '', title: 'Back online', text: 'Services return and this page redirects you automatically.', state: 'pending' }
        ];
      }
      return [
        { time: stStamp(new Date(state._start)), title: 'Planning', text: `Scope and structure of the new ${studioName()} are locked in.`, state: 'done' },
        { time: '', title: 'Rebuilding', text: 'Payments, teams, tasks and the rest are being rebuilt.', state: 'active' },
        { time: '', title: 'Testing', text: 'Everything is checked end to end before launch.', state: 'pending' },
        { time: '', title: 'Launch', text: 'This page refreshes on its own and takes you straight in.', state: 'pending' }
      ];
    }

    function stEtaText(eta) {
      if (!eta) return 'To be announced';
      if (stIsDate(String(eta))) {
        const diff = Date.parse(eta) - Date.now();
        return diff > 60000 ? 'About ' + stDur(diff).replace(/ \d+s$/, '') : 'Any moment now';
      }
      return String(eta);
    }

    function stView(state) {
      const services = stServices(state);
      const down = services.filter(sv => sv.status === 'down');
      const degraded = services.filter(sv => sv.status === 'degraded');
      let tone = 'build';
      let pill = 'Revamp in progress';
      let title = `We're rebuilding ${studioName()}`;
      let msg = 'The internal tool is closed while we rebuild it from the ground up. Payments, teams, tasks and everything else are coming back in better shape than before.';
      if (state.servicesDown) {
        tone = down.length ? 'down' : 'warn';
        pill = down.length && services.length > 1 && down.length === services.length ? 'Major outage' : down.length ? 'Partial outage' : 'Service disruption';
        if (down.length === 1) title = down[0].name + ' is down';
        else if (down.length > 1) title = 'Several services are down';
        else if (degraded.length) title = 'Some services are degraded';
        else title = 'We are fixing an issue';
        msg = 'We are working on a fix. Anything not listed below as down is running normally, and this page updates on its own.';
      }
      if (state.message) msg = state.message;
      return { services, down, degraded, tone, pill, title, msg };
    }

    const ST_CHECK = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 12.5 10 17.5 19 7.5"></polyline></svg>';
    const ST_KEY = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"></circle><path d="M11 12l9-9"></path><path d="M16 7l3 3"></path></svg>';
    const ST_REFRESH = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"></path><polyline points="21 3 21 9 15 9"></polyline></svg>';

    function paintStatus() {
      const state = statusState;
      if (!state) return;
      const v = stView(state);
      const timeline = stTimeline(state);
      const sig = JSON.stringify([v, timeline, state.eta, state.startedAt, state.indev, state.servicesDown]);
      const shell = document.getElementById('stShell');
      if (!shell) return;
      shell.dataset.tone = v.tone;
      document.getElementById('stPillText').textContent = v.pill;
      document.getElementById('stTitle').textContent = v.title;
      document.getElementById('stMsg').textContent = v.msg;
      document.getElementById('stStarted').textContent = stStamp(new Date(state._start));
      document.getElementById('stEtaLabel').textContent = state.servicesDown ? 'Estimated fix' : 'Expected';
      if (sig === statusSig) return;
      statusSig = sig;
      const done = timeline.filter(t => t.state === 'done').length;
      const active = timeline.some(t => t.state === 'active') ? 0.5 : 0;
      const pct = timeline.length ? Math.max(6, Math.min(100, ((done + active) / timeline.length) * 100)) : 6;
      document.getElementById('stProgBar').style.width = pct + '%';
      const svcHost = document.getElementById('stSvc');
      if (v.services.length) {
        const summary = v.down.length ? v.down.length + ' of ' + v.services.length + ' down' : v.degraded.length ? v.degraded.length + ' degraded' : 'All operational';
        svcHost.style.display = '';
        svcHost.innerHTML = `
        <div class="st-card-h"><span>Services</span><span>${stEsc(summary)}</span></div>
        <ul class="st-svc-list">${v.services.map(sv => `
          <li class="st-svc is-${sv.status}">
            <span class="st-dot"></span>
            <span class="st-svc-name">${stEsc(sv.name)}${sv.note ? `<small>${stEsc(sv.note)}</small>` : ''}</span>
            <span class="st-chip">${sv.status === 'down' ? 'Down' : sv.status === 'degraded' ? 'Degraded' : 'Operational'}</span>
          </li>`).join('')}
        </ul>`;
      } else {
        svcHost.style.display = 'none';
        svcHost.innerHTML = '';
      }
      document.getElementById('stTl').innerHTML = `
        <div class="st-card-h"><span>Timeline</span><span>${done} of ${timeline.length} complete</span></div>
        <ol class="st-tl">${timeline.map(t => `
          <li class="st-tl-item is-${t.state}">
            <span class="st-tl-dot">${t.state === 'done' ? ST_CHECK : ''}</span>
            <div class="st-tl-body">
              <div class="st-tl-row"><b>${stEsc(t.title)}</b>${t.time ? `<time>${stEsc(t.time)}</time>` : ''}</div>
              ${t.text ? `<p>${stEsc(t.text)}</p>` : ''}
            </div>
          </li>`).join('')}
        </ol>`;
    }

    function tickStatus() {
      const state = statusState;
      if (!state || statusLeaving) return;
      const elapsed = document.getElementById('stElapsed');
      if (!elapsed) { stopStatusLoop(); return; }
      elapsed.textContent = stDur(Date.now() - state._start);
      document.getElementById('stEta').textContent = stEtaText(state.eta);
      const live = document.getElementById('stLive');
      const label = document.getElementById('stLiveText');
      live.classList.toggle('is-busy', statusChecking);
      if (statusChecking) {
        label.textContent = 'Checking now';
      } else {
        const ago = statusLastCheck ? Math.round((Date.now() - statusLastCheck) / 1000) : 0;
        const left = Math.max(0, Math.ceil((statusNextAt - Date.now()) / 1000));
        label.textContent = 'Live · updated ' + (ago < 2 ? 'just now' : ago + 's ago') + ' · next check in ' + left + 's';
      }
      if (!statusChecking && Date.now() >= statusNextAt && !document.hidden) pollStatus();
    }

    function stopStatusLoop() {
      if (statusTimer) clearInterval(statusTimer);
      statusTimer = null;
      document.removeEventListener('visibilitychange', onStatusVisible);
    }

    function onStatusVisible() {
      if (!document.hidden && statusState && !statusChecking && Date.now() >= statusNextAt - STATUS_POLL_MS + 3000) pollStatus();
    }

    function showBackOnline() {
      statusLeaving = true;
      stopStatusLoop();
      stClearSeen();
      const shell = document.getElementById('stShell');
      if (!shell) { window.location.reload(); return; }
      shell.dataset.tone = 'ok';
      shell.querySelector('.st-wrap').classList.add('is-done');
      document.getElementById('stPillText').textContent = 'Back online';
      document.getElementById('stTitle').textContent = "We're back";
      document.getElementById('stMsg').textContent = 'Everything is running again. Taking you in now.';
      document.getElementById('stLiveText').textContent = 'Redirecting';
      document.getElementById('stLive').classList.remove('is-busy');
      setTimeout(() => window.location.reload(), 2200);
    }

    function applyStatus(next) {
      const mode = next.servicesDown ? 'down' : 'dev';
      const parsed = next.startedAt ? Date.parse(next.startedAt) : NaN;
      next._start = isNaN(parsed) ? stFirstSeen(mode) : parsed;
      statusState = next;
      paintStatus();
    }

    async function pollStatus() {
      if (statusChecking || statusLeaving) return;
      statusChecking = true;
      tickStatus();
      const next = await checkSiteState(true);
      statusChecking = false;
      statusLastCheck = Date.now();
      statusNextAt = Date.now() + STATUS_POLL_MS;
      if (next.ok) {
        if (next.closed) { stopStatusLoop(); renderClosedScreen(); return; }
        if (!next.servicesDown && !next.indev) { showBackOnline(); return; }
        applyStatus(next);
      }
      tickStatus();
    }

    function renderStatusScreen(state) {
      stopStatusLoop();
      statusLeaving = false;
      statusSig = '';
      document.documentElement.style.background = '#F7F8FB';
      document.body.style.background = '#F7F8FB';
      app.innerHTML = `
    <div class="st-shell" id="stShell" data-tone="down">
      <div class="st-wrap">
        <div class="st-hero">
          <div class="indev-mark"><img src="${esc(studioLogo())}" alt="${esc(studioName())}" width="64" height="64"></div>
          <span class="st-pill"><i></i><span id="stPillText"></span></span>
          <h1 class="st-title" id="stTitle"></h1>
          <p class="st-msg" id="stMsg"></p>
          <div class="st-prog"><span id="stProgBar"></span></div>
        </div>
        <div class="st-meta">
          <div class="st-stat"><small>Started</small><b id="stStarted"></b></div>
          <div class="st-stat"><small>Elapsed</small><b id="stElapsed"></b></div>
          <div class="st-stat"><small id="stEtaLabel"></small><b id="stEta"></b></div>
        </div>
        <div class="st-card" id="stSvc"></div>
        <div class="st-card" id="stTl"></div>
        <div class="st-foot">
          <span class="st-live" id="stLive"><i></i><span id="stLiveText">Live</span></span>
          <div class="st-actions">
            <button type="button" class="st-btn st-btn-main" id="stNow">${ST_REFRESH}Check now</button>
            <button type="button" class="st-btn st-bypass" id="stBypass">${ST_KEY}Staff bypass</button>
          </div>
          <div class="st-note">Nothing you submitted has been lost.<br><strong>This page reloads by itself as soon as it's back.</strong></div>
        </div>
      </div>
    </div>`;
      document.getElementById('stNow').addEventListener('click', () => pollStatus());
      document.getElementById('stBypass').addEventListener('click', enableBypass);
      applyStatus(state);
      statusLastCheck = Date.now();
      statusNextAt = Date.now() + STATUS_POLL_MS;
      tickStatus();
      statusTimer = setInterval(tickStatus, 1000);
      document.addEventListener('visibilitychange', onStatusVisible);
    }

    function unmountBypassPill() {
      const el = document.getElementById('stFloat');
      if (el) el.remove();
    }

    function mountBypassPill(state) {
      unmountBypassPill();
      const el = document.createElement('div');
      el.id = 'stFloat';
      el.className = 'st-float';
      el.innerHTML = `<i></i><span>Bypass on</span><em>${state.servicesDown ? 'Services down' : 'In development'}</em><button type="button">Exit</button>`;
      el.querySelector('button').addEventListener('click', disableBypass);
      document.body.appendChild(el);
    }

    async function watchSiteState() {
      if (document.hidden) return;
      const s = await checkSiteState(true);
      if (s.ok) applyBootstrapData(BOOTSTRAP);
      if (!s.ok) return;
      if (s.closed) { window.location.reload(); return; }
      const blocking = s.servicesDown || s.indev;
      if (blocking && !hasIndevPreview()) { window.location.reload(); return; }
      if (blocking) mountBypassPill(s);
      else unmountBypassPill();
    }

    function startSiteWatch() {
      if (siteWatchTimer) clearInterval(siteWatchTimer);
      siteWatchTimer = setInterval(watchSiteState, SITE_WATCH_MS);
    }

    function renderClosedScreen() {
      app.innerHTML = `
    <div class="closed-shell">
      <div class="lock-card">
        <div class="closed-icon">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2.5l7.5 3v5.2c0 4.86-3.2 8.9-7.5 10.3-4.3-1.4-7.5-5.44-7.5-10.3V5.5l7.5-3z"></path>
            <line x1="12" y1="8" x2="12" y2="13"></line>
            <circle cx="12" cy="16.3" r="0.9" fill="currentColor" stroke="none"></circle>
          </svg>
        </div>
        <h2>Site temporarily closed</h2>
        <p>A Administrator has temporarily closed down the website this could be for development purposes, so access has been disabled until they're resolved.</p>
        <div class="closed-note">We're sorry for the inconvenience!</div>
      </div>
    </div>`;
    }

    function getStoredToken() {
      try { return localStorage.getItem(SESSION_STORAGE_KEY); } catch (e) { return null; }
    }
    function storeToken(token) {
      try { localStorage.setItem(SESSION_STORAGE_KEY, token); } catch (e) { }
    }
    function clearToken() {
      try { localStorage.removeItem(SESSION_STORAGE_KEY); } catch (e) { }
    }

    function storePendingRef(token) {
      try { localStorage.setItem(REF_STORAGE_KEY, token); } catch (e) { }
    }
    function getPendingRef() {
      try { return localStorage.getItem(REF_STORAGE_KEY); } catch (e) { return null; }
    }
    function clearPendingRef() {
      try { localStorage.removeItem(REF_STORAGE_KEY); } catch (e) { }
    }

    function beginLogin(returnHash, refToken, provider) {
      try { sessionStorage.setItem(RETURN_HASH_KEY, returnHash || window.location.hash || '#/'); } catch (e) { }
      const ref = refToken || getPendingRef() || getPendingInvite();
      const start = provider === 'google' ? '/google-auth-start' : '/roblox-auth-start';
      window.location.href = EDGE_BASE + start + (ref ? ('?ref=' + encodeURIComponent(ref)) : '');
    }

    function takeReturnHash() {
      let target = '#/';
      try {
        const stored = sessionStorage.getItem(RETURN_HASH_KEY);
        if (stored) target = stored;
        sessionStorage.removeItem(RETURN_HASH_KEY);
      } catch (e) { }
      return target;
    }

    let securityKnown = false;
    async function checkSecurityProtocol() {
      try {
        const json = await callHrData('get_security_state');
        const data = json.data || {};
        securityLevel = data.level || 'normal';
        lockdownNote = data.note || '';
        siteLocked = securityLevel === 'lockdown' && !data.canManage;
      } catch (e) {
        if (e && e.code === 'locked_down') siteLocked = true;
      }
    }

    async function verifySession() {
      const token = getStoredToken();
      if (!token) { isHrAuthed = false; hrUsername = ''; hrRoles = []; hrPermissions = []; hrMaxHierarchy = 0; teamRemoved = false; return; }
      try {
        const [res, onboardingResult] = await Promise.all([
          fetch(EDGE_BASE + '/hr-session', {
            headers: {
              Authorization: 'Bearer ' + token,
              'ngrok-skip-browser-warning': 'true'
            }
          }),
          loadMyOnboarding().catch(() => null)
        ]);
        const json = await res.json().catch(() => ({}));
        if (res.ok && json.ok) {
          isHrAuthed = true;
          hrUsername = json.robloxUsername || '';
          hrUserId = json.robloxUserId || null;
          hrRoles = json.roles || [];
          hrPermissions = json.permissions || [];
          hrMaxHierarchy = json.maxHierarchy || 0;
          teamRemoved = json.teamRemoved === true;
          hrTeamState = json.teamState || (json.teamRemoved ? 'removed' : 'ok');
          needsDiscordLink = discordOn() && json.discordLinked === false;
          if (json.security) {
            securityLevel = json.security.level || 'normal';
            lockdownNote = json.security.note || '';
            siteLocked = securityLevel === 'lockdown' && !json.security.canManage;
            securityKnown = true;
          }
          needsOnboarding = teamRemoved ? false : (onboardingResult ? onboardingResult.some(s => s.required && !s.completedAt) : false);
        } else {
          isHrAuthed = false;
          hrUsername = '';
          hrRoles = [];
          hrPermissions = [];
          hrMaxHierarchy = 0;
          needsOnboarding = false;
          needsDiscordLink = false;
          teamRemoved = false;
          clearToken();
        }
      } catch (e) {
        isHrAuthed = false;
        hrUsername = '';
        hrRoles = [];
        hrPermissions = [];
        hrMaxHierarchy = 0;
        needsOnboarding = false;
        needsDiscordLink = false;
        teamRemoved = false;
      }
    }

    async function refreshOnboardingNeed() {
      try {
        const steps = await loadMyOnboarding();
        needsOnboarding = steps.some(s => s.required && !s.completedAt);
      } catch (e) {
        needsOnboarding = false;
      }
    }

    // Identical read requests fired at the same moment (common when several widgets render at
    // once) share one network call instead of hitting the API repeatedly.
    const inflightReads = new Map();
    const READ_ACTION = /^(get_|list_|load_)/;

    async function callHrData(action, payload) {
      const body = JSON.stringify({ action, payload: payload || {} });
      if (READ_ACTION.test(action)) {
        const key = body;
        if (inflightReads.has(key)) return inflightReads.get(key);
        const p = callHrDataNow(action, body).finally(() => inflightReads.delete(key));
        inflightReads.set(key, p);
        return p;
      }
      return callHrDataNow(action, body);
    }

    async function callHrDataNow(action, body) {
      const token = getStoredToken();
      let res;
      try {
        res = await fetchWithTimeout(EDGE_BASE + '/hr-data', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + (token || ''),
            'ngrok-skip-browser-warning': 'true'
          },
          body
        }, 30000);
      } catch (e) {
        const err = new Error(friendlyError('network_error'));
        err.code = 'network_error';
        throw err;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        if (res.status === 401) { clearToken(); isHrAuthed = false; hrUsername = ''; hrRoles = []; hrPermissions = []; hrMaxHierarchy = 0; }
        const code = (json && json.error) || '';
        if (code === 'team_removed' && !teamRemoved) {
          teamRemoved = true;
          if (currentPath() !== '#/team-removed') window.location.hash = '#/team-removed';
        }
        if (code === 'locked_down') {
          lockdownNote = (json.security && json.security.note) || '';
          if (!siteLocked) {
            siteLocked = true;
            if (currentPath() !== '#/locked') window.location.hash = '#/locked';
            else route();
          }
        }
        const err = new Error(friendlyError(code));
        err.code = code;
        throw err;
      }
      return json;
    }

    const ERROR_MESSAGES = {
      own_payment: "You can't approve, change or pay out your own payment. Someone else has to do it.",
      invalid_amount: 'That amount is not allowed. Check it is above zero and below the per-request limit.',
      cannot_grant_permission: "You can only give a role permissions that you have yourself.",
      rate_limited: "You're going a bit fast. Wait a few seconds and try again.",
      feature_disabled: 'That part of the panel is turned off for this studio.',
      branding_column_missing: 'Your database needs a quick update first. Run sql/upgrade.sql in the Supabase SQL editor, then save again.',
      branding_unavailable: "Couldn't read the branding settings. If you just updated, run sql/upgrade.sql in Supabase.",
      branding_too_large: 'That is too much to save at once. Use a smaller logo or background image.',
      addon_disabled: 'That add-on is not included in this panel.',
      method_disabled: 'This studio does not pay out with that method.',
      request_not_found: 'That request no longer exists. The list has been refreshed.',
      already_exists: 'That already exists.',
      network_error: 'Could not reach the server. Check your connection and try again.',
      payload_too_large: 'That is too much data to send in one go.',
      missing_permission: "You don't have permission to do that. Ask someone with a higher role if you need it.",
      insufficient_hierarchy: "Their role is at or above yours, so you can't change their account.",
      not_authenticated: 'Your session ended. Sign in again to continue.',
      session_expired: 'Your session ended. Sign in again to continue.',
      missing_reason: 'Add a reason first.',
      missing_user_id: "This person doesn't have a linked Roblox account, so this isn't available.",
      cannot_moderate_self: "You can't warn or ban your own account.",
      already_banned: 'This account is already banned. Lift the ban first if you want to issue a warning.',
      already_reverted: 'That change was already reverted.',
      not_revertible: "That change can't be reverted automatically.",
      warning_not_found: 'That warning was already removed.',
      invalid_fields: 'Some fields are missing or invalid. Check the form and try again.',
      missing_fields: 'Some required fields are empty.',
      roblox_user_not_found: "That Roblox username doesn't exist.",
      discord_not_linked: "This person hasn't linked a Discord account yet.",
      discord_not_in_server: "This person isn't in the Discord server.",
      server_error: 'Something went wrong on our side. Try again in a moment, and tell an admin if it keeps happening.',
      task_not_found: 'That task no longer exists.',
      task_not_done: 'Mark the task done before logging its payment.',
      task_has_no_payment: "That task doesn't have a payment set on it.",
      already_paid: 'A payment has already been logged for that task.',
      no_team_members: 'Nobody is on that team yet, so there is no one to give the task to.',
      team_not_found: 'That team no longer exists.',
      game_not_found: 'That game no longer exists.',
      missing_team_id: 'No team was chosen for that task.',
      missing_game_id: 'No game was chosen.',
      invalid_place_id: "That doesn't look like a Roblox place ID or game link.",
      roblox_game_not_found: "Roblox doesn't have a game with that place ID.",
      team_removed: 'Your team was removed, so this is on hold until a lead places you on another one.',
      claim_not_found: 'That request is no longer waiting for a decision. The list has been refreshed.',
      locked_down: 'The site is in lockdown, so that is on hold until leadership clears it.',
      account_held: 'That account has a payout hold on it, so this is paused until the hold is lifted.',
      cannot_hold_self: "You can't put a hold on your own account.",
      invalid_threshold: 'Pick a number of changes between 2 and 50.',
      invalid_window: 'Pick a window between 5 minutes and 24 hours.',
      security_hold: 'Payments are on hold while the security protocol is raised. Anything you were part way through is safe.',
      invalid_security_level: 'That is not one of the protocol levels.',
      security_note_required: 'Write a short reason before raising the level.',
      session_not_found: 'That session has already ended.',
      not_your_session: 'That session belongs to someone else.',
      claim_withdrawn: 'That request is gone. The person who sent it withdrew it, so there is nothing to decide.',
      claim_already_approved: 'That request was already approved by someone else. It is now in the pending list.',
      claim_already_paid: 'That request has already been paid out, so it cannot be changed here.',
      too_many_open_claims: 'You already have 10 requests waiting for a decision. Wait for those before sending another.',
      already_decided: 'That request has already been decided, so it cannot be changed any more.',
      not_your_request: 'That request belongs to someone else.',
      no_devex_rate: 'No DevEx rate is set yet, so amounts cannot be converted. Ask an admin to set one in Settings.',
      lookup_failed: 'Could not read that request from the database. Try again in a moment.',
      update_failed: 'The change did not save. Try again, and tell an admin if it keeps happening.',
      missing_id: 'Nothing was selected, so there is nothing to change.',
      unknown_action: 'The server did not recognise that action. Refresh the page to load the latest version.'
    };
    function friendlyError(code) {
      if (!code) return 'That request failed. Check your connection and try again.';
      return ERROR_MESSAGES[code] || code;
    }

    async function loadAllRequests(force) {
      const json = await callHrData('list_requests', force ? { force: true } : {});
      return (json.data || []).map(rowToClient);
    }

    async function updateRequest(data) {
      await callHrData('mark_paid', { id: data.id });
      return true;
    }

    async function rejectRequest(id, note) {
      await callHrData('reject_request', { id, note });
    }

    async function reopenRequest(id) {
      await callHrData('reopen_request', { id });
    }

    async function markAllPaid(robloxUserId, robloxUsername) {
      const json = await callHrData('mark_all_paid', { robloxUserId, robloxUsername });
      return json.count || 0;
    }

    async function editRequestAmount(id, payment, currency) {
      return await callHrData('edit_request_amount', { id, payment, currency });
    }

    async function deleteRequest(id) {
      await callHrData('delete_request', { id });
    }

    async function saveRequest(data) {
      const json = await callHrData('submit_request', {
        robloxUsername: data.robloxUsername,
        taskName: data.taskName,
        game: data.game,
        workRaw: data.workRaw,
        timeWorked: data.timeWorked,
        payment: data.payment,
        currency: data.currency,
        skillsetIds: data.skillsetIds || []
      });
      return json;
    }

    function getRecruitToken() {
      try { return localStorage.getItem(RECRUIT_TOKEN_KEY); } catch (e) { return null; }
    }
    function storeRecruitToken(token) {
      try { localStorage.setItem(RECRUIT_TOKEN_KEY, token); } catch (e) { }
    }
    function clearRecruitToken() {
      try { localStorage.removeItem(RECRUIT_TOKEN_KEY); } catch (e) { }
    }

    async function fetchRecruitSession(rt) {
      const res = await fetch(EDGE_BASE + '/recruit-session', {
        headers: { Authorization: 'Bearer ' + rt, 'ngrok-skip-browser-warning': 'true' }
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error((json && json.error) || 'session_expired');
      return json;
    }

    async function loadPublicRecruiters() {
      const res = await fetch(EDGE_BASE + '/recruitment/recruiters', { headers: { 'ngrok-skip-browser-warning': 'true' } });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) return [];
      return json.data || [];
    }

    async function loadPublicPositions() {
      const res = await fetch(EDGE_BASE + '/recruitment/positions', { headers: { 'ngrok-skip-browser-warning': 'true' } });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) return [];
      return json.data || [];
    }

    async function submitRecruitmentApplication(rt, data) {
      const res = await fetch(EDGE_BASE + '/recruitment/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + rt, 'ngrok-skip-browser-warning': 'true' },
        body: JSON.stringify(data)
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error((json && json.error) || 'submit_failed');
      return json;
    }

    async function fetchMyTicket(rt) {
      const res = await fetch(EDGE_BASE + '/recruitment/my-ticket', {
        headers: { Authorization: 'Bearer ' + rt, 'ngrok-skip-browser-warning': 'true' }
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error((json && json.error) || 'no_ticket');
      return json.data;
    }

    function urlBase64ToUint8Array(base64String) {
      const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
      const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
      const raw = atob(base64);
      const arr = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
      return arr;
    }

    async function fetchPushPublicKey() {
      const res = await fetch(EDGE_BASE + '/recruitment/push-public-key', { headers: { 'ngrok-skip-browser-warning': 'true' } });
      const json = await res.json().catch(() => ({}));
      return json.publicKey || null;
    }

    async function enableRecruitPushNotifications(rt) {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('unsupported');
      const publicKey = await fetchPushPublicKey();
      if (!publicKey) throw new Error('not_configured');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('permission_denied');
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });
      await fetch(EDGE_BASE + '/recruitment/push-subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + rt, 'ngrok-skip-browser-warning': 'true' },
        body: JSON.stringify({ subscription: subscription.toJSON() })
      });
      return true;
    }

    async function loadRecruitmentTickets(status) {
      const json = await callHrData('recruitment_list_tickets', { status: status || 'all' });
      return json.data || [];
    }
    async function loadRecruitmentTicket(id) {
      const json = await callHrData('recruitment_get_ticket', { id });
      return json.data;
    }
    async function updateRecruitmentStatus(id, status, reason) {
      await callHrData('recruitment_update_status', { id, status, reason: reason || null });
    }
    async function assignRecruitmentTicket(id, userId, username) {
      await callHrData('recruitment_assign', { id, assignToUserId: userId, assignToUsername: username });
    }
    async function nextPhaseRecruitmentTicket(id, skillsetId) {
      const json = await callHrData('recruitment_next_phase', { id, skillsetId });
      return json.data;
    }
    async function manualRolingRecruitmentTicket(id) {
      const json = await callHrData('recruitment_manual_roling', { id });
      return json.data;
    }
    async function signOffRecruitmentTicket(id) {
      const json = await callHrData('recruitment_sign_off', { id });
      return json.data;
    }
    async function loadSkillsetsForNextPhase() {
      const json = await callHrData('list_skillsets');
      return json.data || [];
    }
    async function loadTeamsForPlacement() {
      const json = await callHrData('list_teams');
      return json.data || [];
    }
    async function placeRecruitmentTicketTeam(id, teamId) {
      const json = await callHrData('recruitment_place_team', { id, teamId });
      return json.data;
    }
    async function loadRecruiters() {
      const json = await callHrData('recruitment_list_recruiters');
      return json.data || [];
    }
    async function loadRecruitmentAnalytics() {
      const json = await callHrData('recruitment_analytics');
      return json.data;
    }

    async function loadMyOnboarding() {
      const json = await callHrData('get_my_onboarding');
      return json.data || [];
    }

    async function completeOnboardingStep(stepId) {
      await callHrData('complete_onboarding_step', { stepId });
    }

    async function loadStaffDatabase() {
      const json = await callHrData('list_staff_database');
      return json.data || [];
    }

    async function loadMyWarnings() {
      const json = await callHrData('get_my_warnings');
      return json.data || [];
    }

    async function addGame(name) {
      await callHrData('add_game', { name });
      await loadGames();
    }

    async function deleteGame(id) {
      await callHrData('delete_game', { id });
      await loadGames();
    }

    async function saveDevexRate(rate) {
      await callHrData('save_rate', { rate });
      DEVEX_RATE = rate;
    }

    async function listRoles() {
      const json = await callHrData('list_roles');
      return json.data || [];
    }

    async function addRole(role) {
      await callHrData('add_role', role);
    }

    async function updateRole(id, role) {
      await callHrData('update_role', { id, ...role });
    }

    async function deleteRole(id) {
      await callHrData('delete_role', { id });
    }

    async function listRoleAssignments(robloxUserId) {
      const json = await callHrData('list_role_assignments', robloxUserId != null ? { robloxUserId } : {});
      return json.data || [];
    }

    async function addRoleAssignment(roleId, robloxUserId) {
      return await callHrData('add_role_assignment', { roleId, robloxUserId });
    }

    async function deleteRoleAssignment(id) {
      return await callHrData('delete_role_assignment', { id });
    }

    async function getMySummary() {
      const json = await callHrData('get_my_summary');
      return {
        requests: (json.data || []).map(rowToClient),
        totals: json.totals || {},
        split: json.split || null
      };
    }

    async function getMyPaymentMethod() {
      const json = await callHrData('get_payment_method');
      return json.data || null;
    }

    async function getUsdEligibility() {
      const json = await callHrData('get_usd_eligibility');
      return json.data || null;
    }

    async function getMyDiscordLink() {
      const json = await callHrData('get_my_discord_link');
      return json.data || null;
    }

    async function unlinkMyDiscord() {
      await callHrData('unlink_my_discord');
    }

    async function getMyAccessStatus() {
      const json = await callHrData('get_my_access_status');
      return json.data || null;
    }

    async function startAccessRelink(inviteToken, restart) {
      const json = await callHrData('start_access_relink', { inviteToken: inviteToken || null, restart: !!restart });
      return json.data || null;
    }

    function rejoinKey() { return 'pv_rejoin_' + (hrUserId || 'me'); }
    function getRejoinState() { try { return localStorage.getItem(rejoinKey()) || null; } catch (e) { return null; } }
    function setRejoinState(v) { try { if (v) localStorage.setItem(rejoinKey(), v); else localStorage.removeItem(rejoinKey()); } catch (e) { } }

    async function getUsdEligibilityForUser(robloxUserId, robloxUsername) {
      const json = await callHrData('get_usd_eligibility_for_user', { robloxUserId, robloxUsername });
      return json.data || null;
    }

    async function getPaymentMethodForUser(robloxUsername) {
      const json = await callHrData('get_payment_method_for_user', { robloxUsername });
      return json.data || null;
    }

    async function getUserSkillsets(robloxUsername, robloxUserId) {
      const json = await callHrData('list_user_skillsets', { robloxUsername, robloxUserId });
      return json.data || [];
    }

    async function addUserSkillsets(robloxUserId, robloxUsername, skillsetIds) {
      await callHrData('add_user_skillsets', { robloxUserId, robloxUsername, skillsetIds });
    }

    async function removeUserSkillset(robloxUserId, skillsetId) {
      await callHrData('remove_user_skillset', { robloxUserId, skillsetId });
    }

    async function savePaymentMethod(method, details) {
      await callHrData('save_payment_method', { method, details });
    }

    async function listRequiredGroups() {
      const json = await callHrData('list_required_groups');
      return json.data || [];
    }

    async function addRequiredGroup(group) {
      await callHrData('add_required_group', group);
    }

    async function deleteRequiredGroup(id) {
      await callHrData('delete_required_group', { id });
    }

    async function getMyEligibility() {
      const json = await callHrData('get_my_eligibility');
      return json.data || [];
    }

    async function getUserEligibility(robloxUsername) {
      const json = await callHrData('get_user_eligibility', { robloxUsername });
      return json.data || [];
    }

    async function getBaseAccessGroups() {
      const json = await callHrData('list_base_access_groups');
      return json.data || [];
    }

    async function addBaseAccessGroup(robloxGroupId, minRank, name) {
      await callHrData('add_base_access_group', { robloxGroupId, minRank, name });
    }

    async function deleteBaseAccessGroup(id) {
      await callHrData('delete_base_access_group', { id });
    }

    async function getBaseAccessDiscordServers() {
      const json = await callHrData('list_base_access_discord_servers');
      return json.data || [];
    }

    async function addBaseAccessDiscordServer(discordGuildId, name) {
      await callHrData('add_base_access_discord_server', { discordGuildId, name });
    }

    async function deleteBaseAccessDiscordServer(id) {
      await callHrData('delete_base_access_discord_server', { id });
    }

    async function getRecruitmentPositions() {
      const json = await callHrData('list_recruitment_positions');
      return json.data || [];
    }

    async function addRecruitmentPosition(name, discordRoleId) {
      await callHrData('add_recruitment_position', { name, discordRoleId });
    }

    async function deleteRecruitmentPosition(id) {
      await callHrData('delete_recruitment_position', { id });
    }

    async function getRecruitmentConfig() {
      const json = await callHrData('recruitment_get_config');
      return json.data || { autoRoleId: null, discordRoleId: null, gracePeriodHours: null, notifyRoleId: null };
    }

    async function saveRecruitmentConfig(autoRoleId, discordRoleId, gracePeriodHours, notifyRoleId) {
      await callHrData('recruitment_save_config', { autoRoleId, discordRoleId, gracePeriodHours, notifyRoleId });
    }

    async function getRecruitmentApprovalConfig() {
      const json = await callHrData('recruitment_get_approval_config');
      return json.data || { signoffRoleId: null, producerRoleId: null };
    }

    async function saveRecruitmentApprovalConfig(signoffRoleId, producerRoleId) {
      await callHrData('recruitment_save_approval_config', { signoffRoleId, producerRoleId });
    }

    async function getRecruitmentApprovalRoleNames() {
      const json = await callHrData('recruitment_get_approval_role_names');
      return json.data || { signoffRoleName: null, producerRoleName: null };
    }

    async function getOnboardingGroupConfig() {
      const json = await callHrData('get_onboarding_group_config');
      return json.data || { groupId: null, groupRoleId: null };
    }

    async function saveOnboardingGroupConfig(groupId, groupRoleId) {
      await callHrData('save_onboarding_group_config', { groupId, groupRoleId });
    }

    async function getRobloxGroupApiKeyStatus() {
      const json = await callHrData('get_roblox_group_api_key_status');
      return json.data || { configured: false };
    }

    async function getUsdMinimum() {
      const json = await callHrData('get_usd_minimum');
      return json.data || { threshold: 0 };
    }

    async function saveUsdMinimum(threshold) {
      await callHrData('save_usd_minimum', { threshold });
    }

    async function getIgnoreEligibility() {
      const json = await callHrData('get_ignore_eligibility');
      return !!(json.data && json.data.ignoreEligibility);
    }

    async function saveIgnoreEligibility(ignoreEligibility) {
      await callHrData('save_ignore_eligibility', { ignoreEligibility });
    }

    async function adminSetPaymentMethod(robloxUserId, robloxUsername, method, details) {
      await callHrData('admin_set_payment_method', { robloxUserId, robloxUsername, method, details });
    }

    async function listTeams() {
      const json = await callHrData('list_teams');
      return json.data || [];
    }
    async function addTeam(team) {
      const json = await callHrData('add_team', team);
      return json.data;
    }
    async function updateTeam(id, team) {
      await callHrData('update_team', { id, ...team });
    }
    async function deleteTeam(id) {
      await callHrData('delete_team', { id });
    }

    async function listSkillsets() {
      const json = await callHrData('list_skillsets');
      return json.data || [];
    }
    async function addSkillset(skillset) {
      await callHrData('add_skillset', skillset);
    }
    async function updateSkillset(id, skillset) {
      await callHrData('update_skillset', { id, ...skillset });
    }
    async function deleteSkillset(id) {
      await callHrData('delete_skillset', { id });
    }

    async function listBroadcasts() {
      const json = await callHrData('list_broadcasts');
      return json.data || [];
    }
    async function createBroadcast(broadcast) {
      await callHrData('create_broadcast', broadcast);
    }
    async function deleteBroadcast(id) {
      await callHrData('delete_broadcast', { id });
    }
    async function listMyBroadcasts() {
      const json = await callHrData('list_my_broadcasts');
      return json.data || [];
    }

    async function listOnboardingLinks() {
      const json = await callHrData('list_onboarding_links');
      return json.data || [];
    }
    async function createOnboardingLink(teamId, skillsetId, roleId, label, targetUsername) {
      const json = await callHrData('create_onboarding_link', { teamId, skillsetId, roleId, label, targetUsername });
      return json;
    }
    async function assignUserTeamSkillset(robloxUserId, robloxUsername, teamId, skillsetId) {
      await callHrData('assign_user_team_skillset', { robloxUserId, robloxUsername, teamId, skillsetId });
    }
    async function removeUserTeamAssignment(robloxUserId, teamId) {
      await callHrData('remove_user_team_assignment', { robloxUserId, teamId });
    }
    async function listUserTeamAssignments(robloxUserId) {
      const json = await callHrData('list_user_team_assignments', { robloxUserId });
      return json.data || [];
    }
    async function listUserWarnings(robloxUserId) {
      const json = await callHrData('list_user_warnings', { robloxUserId });
      return json;
    }
    async function addUserWarning(robloxUserId, robloxUsername, reason) {
      const json = await callHrData('add_user_warning', { robloxUserId, robloxUsername, reason });
      return json;
    }
    async function removeUserWarning(warningId) {
      const json = await callHrData('remove_user_warning', { warningId });
      return json;
    }
    async function unbanUser(robloxUserId) {
      await callHrData('unban_user', { robloxUserId });
    }
    async function deleteOnboardingLink(token) {
      await callHrData('delete_onboarding_link', { token });
    }
    async function getOnboardingLinkInfo(token) {
      const json = await callHrData('get_onboarding_link_info', { token });
      return json.data;
    }
    async function claimOnboardingLinkToken(token) {
      const json = await callHrData('claim_onboarding_link', { token });
      return json.data || null;
    }
    async function getMyOnboardingLinkFlowStatus(token) {
      const json = await callHrData('get_my_onboarding_link_flow_status', { token });
      return json.data || null;
    }
    async function getMyAssignment() {
      const json = await callHrData('get_my_assignment');
      return json.data || null;
    }
    async function searchRobloxUsernames(query) {
      const json = await callHrData('search_roblox_usernames', { query });
      return json.data || [];
    }

    async function listAuditLogs(category, search) {
      const json = await callHrData('list_audit_logs', { category, search });
      return json.data || [];
    }
    async function revertAuditLog(id) {
      await callHrData('revert_audit_log', { id });
    }
    async function quickModerateUser(robloxUserId, robloxUsername, type, reason) {
      return await callHrData('quick_moderate', { robloxUserId, robloxUsername, type, reason });
    }
    async function backupAllData() {
      const json = await callHrData('backup_all_data');
      return json.data;
    }
    async function listBackups() {
      const json = await callHrData('list_backups');
      return json.data || [];
    }
    async function loadBackupData(id) {
      const json = await callHrData('load_backup', { id });
      return json;
    }
    async function restoreBackupData(id) {
      const json = await callHrData('restore_backup', { id });
      return json;
    }

    // Discord linking for signed-in staff. The link only carries a harmless marker; on click we
    // swap our session (sent in a header) for a two-minute signed ticket and go from there, so
    // the session token itself never ends up in a URL.
    function staffDiscordLinkHref(returnHash) {
      return '#link-discord?return=' + encodeURIComponent(returnHash || '#/home');
    }
    async function startStaffDiscordLink(returnHash) {
      try {
        const res = await fetchWithTimeout(EDGE_BASE + '/auth/discord-link-ticket', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (getStoredToken() || ''), 'ngrok-skip-browser-warning': 'true' },
          body: JSON.stringify({ return: returnHash })
        }, 12000);
        const json = await res.json().catch(() => ({}));
        if (res.ok && json.ok && json.url) { window.location.href = EDGE_BASE + json.url; return; }
        toast(json.error === 'discord_not_configured' ? 'Discord linking is not set up on this server yet.' : friendlyError(json.error), 'err');
      } catch (e) {
        toast('Could not reach the server. Try again in a moment.', 'err');
      }
    }
    document.addEventListener('click', (e) => {
      const a = e.target && e.target.closest ? e.target.closest('a[href^="#link-discord"]') : null;
      if (!a) return;
      e.preventDefault();
      const ret = new URLSearchParams(a.getAttribute('href').split('?')[1] || '').get('return') || '#/home';
      a.setAttribute('aria-busy', 'true');
      startStaffDiscordLink(/^#\/[a-zA-Z0-9/_\-?=&]*$/.test(ret) ? ret : '#/home');
    }, true);

    // In-app replacement for window.confirm(). The first line of the message is the question;
    // anything after a blank line is shown underneath as detail. Resolves true / false.
    function askConfirm(message, opts) {
      const o = opts || {};
      const parts = String(message || '').split(/\n\s*\n/);
      let title = parts.shift();
      let detail = parts.join('\n\n');
      // "Remove this team? Anyone on it..." -> short question as the title, the rest underneath.
      const q = title.indexOf('? ');
      if (q > 0 && q < title.length - 2) { detail = (title.slice(q + 2) + (detail ? '\n\n' + detail : '')).trim(); title = title.slice(0, q + 1); }
      const danger = o.danger != null ? o.danger : /^(remove|delete|ban|revert|reset|restore|sign out|sign every|take this|withdraw|unlink|replace)/i.test(title);
      const okLabel = o.okLabel || (danger ? (/^(remove|delete)/i.test(title) ? title.split(/\s/)[0] : 'Continue') : 'Confirm');
      return new Promise(resolve => {
        const prevFocus = document.activeElement;
        const wrap = document.createElement('div');
        wrap.className = 'ask-scrim';
        wrap.innerHTML = `
          <div class="ask-box" role="alertdialog" aria-modal="true" aria-labelledby="askTitle"${detail ? ' aria-describedby="askDetail"' : ''}>
            <h2 id="askTitle">${esc(title)}</h2>
            ${detail ? `<p id="askDetail">${esc(detail)}</p>` : ''}
            <div class="ask-actions">
              <button type="button" class="btn btn-ghost" data-ask="no">${esc(o.cancelLabel || 'Cancel')}</button>
              <button type="button" class="btn ${danger ? 'btn-danger-solid' : 'btn-primary'}" data-ask="yes">${esc(okLabel)}</button>
            </div>
          </div>`;
        const done = (val) => {
          document.removeEventListener('keydown', onKey, true);
          wrap.classList.add('closing');
          setTimeout(() => wrap.remove(), 120);
          if (prevFocus && prevFocus.focus) try { prevFocus.focus({ preventScroll: true }); } catch (e) { }
          resolve(val);
        };
        const onKey = (e) => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
          else if (e.key === 'Tab') {
            const btns = wrap.querySelectorAll('button');
            const first = btns[0], last = btns[btns.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
          }
        };
        wrap.addEventListener('click', (e) => {
          if (e.target === wrap) return done(false);
          const b = e.target.closest('[data-ask]');
          if (b) done(b.dataset.ask === 'yes');
        });
        document.addEventListener('keydown', onKey, true);
        document.body.appendChild(wrap);
        wrap.querySelector(danger ? '[data-ask="no"]' : '[data-ask="yes"]').focus();
      });
    }

    function toast(text, kind) {
      let root = document.getElementById('toastRoot');
      if (!root) {
        root = document.createElement('div');
        root.id = 'toastRoot';
        root.setAttribute('role', 'status');
        root.setAttribute('aria-live', 'polite');
        document.body.appendChild(root);
      }
      const el = document.createElement('div');
      el.className = 'toast' + (kind === 'err' ? ' err' : '');
      el.textContent = text;
      root.appendChild(el);
      while (root.children.length > 2) root.firstChild.remove();
      setTimeout(() => el.remove(), kind === 'err' ? 6000 : 3500);
    }

    function askForText(opts) {
      const o = opts || {};
      return new Promise(resolve => {
        const scrim = document.createElement('div');
        scrim.className = 'modal-scrim';
        scrim.innerHTML = `
      <div class="modal-card" style="max-width:460px;">
        <div class="modal-body" style="padding:24px;">
          <h3 style="margin:0 0 6px;">${esc(o.title || 'Add a note')}</h3>
          ${o.hint ? `<p class="hint" style="margin:0 0 14px;">${esc(o.hint)}</p>` : ''}
          <textarea id="askForTextInput" rows="4" placeholder="${esc(o.placeholder || '')}" style="width:100%;resize:vertical;"></textarea>
          <div id="askForTextError" class="hint" style="color:var(--danger);margin-top:6px;display:none;"></div>
          <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px;">
            <button type="button" class="btn btn-ghost" id="askForTextCancel">Cancel</button>
            <button type="button" class="btn btn-primary" id="askForTextOk">${esc(o.confirmLabel || 'Save')}</button>
          </div>
        </div>
      </div>`;
        document.body.appendChild(scrim);
        const input = scrim.querySelector('#askForTextInput');
        const errBox = scrim.querySelector('#askForTextError');
        let settled = false;
        const close = value => {
          if (settled) return;
          settled = true;
          document.removeEventListener('keydown', onKey);
          scrim.remove();
          resolve(value);
        };
        const submit = () => {
          const value = input.value.trim();
          if (o.required && !value) {
            errBox.textContent = o.requiredMessage || 'Please write something first.';
            errBox.style.display = 'block';
            input.focus();
            return;
          }
          close(value);
        };
        function onKey(e) {
          if (e.key === 'Escape') close(null);
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
        }
        scrim.querySelector('#askForTextOk').addEventListener('click', submit);
        scrim.querySelector('#askForTextCancel').addEventListener('click', () => close(null));
        scrim.addEventListener('click', e => { if (e.target === scrim) close(null); });
        document.addEventListener('keydown', onKey);
        setTimeout(() => input.focus(), 30);
      });
    }

    const avatarCache = new Map();
    let avatarQueue = new Set();
    let avatarTimer = null;
    function avatarPlaceholder() {
      const dark = getTheme() === 'dark';
      return 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="${dark ? '#23222E' : '#EEEDFB'}"/><circle cx="20" cy="16" r="7" fill="${dark ? '#3A3850' : '#D6D3F5'}"/><rect x="8" y="26" width="24" height="14" rx="7" fill="${dark ? '#3A3850' : '#D6D3F5'}"/></svg>`);
    }
    function avatarSrc(userId) {
      if (!userId) return avatarPlaceholder();
      const hit = avatarCache.get(String(userId));
      if (hit) return hit;
      avatarQueue.add(String(userId));
      if (!avatarTimer) avatarTimer = setTimeout(flushAvatars, 30);
      return avatarPlaceholder();
    }
    function avatarImg(userId, alt, extra) {
      return `<img src="${avatarSrc(userId)}" data-avatar-id="${esc(userId || '')}" alt="${esc(alt || '')}" loading="lazy" ${extra || ''}>`;
    }
    async function flushAvatars() {
      avatarTimer = null;
      const ids = Array.from(avatarQueue).filter(id => !avatarCache.has(id));
      avatarQueue = new Set();
      for (let i = 0; i < ids.length; i += 200) {
        const batch = ids.slice(i, i + 200);
        try {
          const res = await fetch(`${EDGE_BASE}/api/roblox/avatars?ids=${batch.join(',')}`, { headers: { 'ngrok-skip-browser-warning': 'true' } });
          const json = await res.json();
          Object.entries((json && json.data) || {}).forEach(([id, url]) => avatarCache.set(String(id), url));
        } catch (e) { }
        batch.forEach(id => {
          const url = avatarCache.get(id);
          if (!url) return;
          document.querySelectorAll(`img[data-avatar-id="${id}"]`).forEach(img => { img.src = url; });
        });
      }
    }

    let peopleCache = { at: 0, rows: [], promise: null };
    function getPeople(force) {
      if (!hasPermission('staff.view_database')) return Promise.resolve([]);
      if (!force && peopleCache.rows.length && Date.now() - peopleCache.at < 2 * 60 * 1000) return Promise.resolve(peopleCache.rows);
      if (peopleCache.promise) return peopleCache.promise;
      peopleCache.promise = loadStaffDatabase().then(rows => {
        peopleCache = { at: Date.now(), rows, promise: null };
        return rows;
      }).catch(() => { peopleCache.promise = null; return peopleCache.rows; });
      return peopleCache.promise;
    }
    function rememberPeople(rows) { peopleCache = { at: Date.now(), rows, promise: null }; }

    let cmdkOpen = false;
    let cmdkQuery = '';
    let cmdkSel = 0;
    let cmdkPeople = [];
    let cmdkPeopleLoading = false;

    function cmdkResults() {
      const q = cmdkQuery.trim().toLowerCase();
      const pages = navItems().map(i => ({ kind: 'page', label: i.label, href: i.href, hay: (i.label + ' ' + (i.keywords || '')).toLowerCase() }));
      const actions = [
        { kind: 'action', label: getTheme() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode', run: toggleTheme, hay: 'theme dark light mode' },
        { kind: 'action', label: 'Sign out', run: hrSignOut, hay: 'sign out log out logout' }
      ];
      const matchPages = (q ? pages.filter(p => p.hay.includes(q)) : pages.filter(p => !p.label.startsWith('Manage:') && !['Terms of Service', 'Acceptable Use Policy', 'My teams & skillsets'].includes(p.label))).slice(0, q ? 8 : 12);
      const matchActions = q ? actions.filter(a => a.hay.includes(q) || a.label.toLowerCase().includes(q)) : [];
      let matchPeople = [];
      if (q) {
        matchPeople = cmdkPeople.filter(p =>
          (p.robloxUsername || '').toLowerCase().includes(q) ||
          String(p.robloxUserId || '') === q ||
          (p.roles || []).some(r => r.toLowerCase().includes(q)) ||
          (p.team || '').toLowerCase().includes(q)
        ).sort((a, b) => {
          const an = (a.robloxUsername || '').toLowerCase(), bn = (b.robloxUsername || '').toLowerCase();
          return (bn.startsWith(q) - an.startsWith(q)) || an.localeCompare(bn);
        }).slice(0, 8).map(p => ({ kind: 'person', label: p.robloxUsername || ('ID ' + p.robloxUserId), person: p }));
      }
      return [...matchPeople, ...matchPages, ...matchActions];
    }

    function cmdkHtml() {
      const results = cmdkResults();
      if (cmdkSel >= results.length) cmdkSel = Math.max(0, results.length - 1);
      let lastKind = null;
      const groupLabel = { person: 'People', page: 'Go to', action: 'Actions' };
      const body = results.map((r, i) => {
        const head = r.kind !== lastKind ? `<div class="cmdk-group">${groupLabel[r.kind]}</div>` : '';
        lastKind = r.kind;
        let meta = '';
        if (r.kind === 'person') {
          const p = r.person;
          meta = p.isBanned ? 'Banned' : (p.warnCount ? `${p.warnCount}/3 warnings` : ((p.roles || [])[0] || ''));
        }
        return `${head}<button type="button" class="cmdk-item ${i === cmdkSel ? 'sel' : ''}" data-cmdk-idx="${i}" role="option" aria-selected="${i === cmdkSel}">
          ${r.kind === 'person' ? avatarImg(r.person.robloxUserId, '') : ''}
          <span>${esc(r.label)}</span>${meta ? `<span class="cmdk-meta">${esc(meta)}</span>` : ''}
        </button>`;
      }).join('');
      const empty = !results.length
        ? `<div class="cmdk-empty">${cmdkPeopleLoading ? 'Loading people...' : `Nothing matches "${esc(cmdkQuery)}".${hasPermission('staff.view_database') ? ' Try a Roblox username, role, or team.' : ''}`}</div>`
        : '';
      return `
        <div class="cmdk-scrim" id="cmdkScrim">
          <div class="cmdk" role="dialog" aria-label="Search">
            <input type="text" id="cmdkInput" placeholder="${hasPermission('staff.view_database') ? 'Search people, pages and settings' : 'Search pages'}" value="${esc(cmdkQuery)}" autocomplete="off" role="combobox" aria-expanded="true">
            <div class="cmdk-list" role="listbox">${body}${empty}</div>
            <div class="cmdk-foot"><span><kbd>&uarr;</kbd> <kbd>&darr;</kbd> to move</span><span><kbd>Enter</kbd> to open</span><span><kbd>Esc</kbd> to close</span></div>
          </div>
        </div>`;
    }

    function paintCmdk(keepFocus) {
      let root = document.getElementById('cmdkRoot');
      if (!root) { root = document.createElement('div'); root.id = 'cmdkRoot'; document.body.appendChild(root); }
      if (!cmdkOpen) { root.innerHTML = ''; return; }
      const input = document.getElementById('cmdkInput');
      if (keepFocus && input) {
        const list = root.querySelector('.cmdk-list');
        const tmp = document.createElement('div');
        tmp.innerHTML = cmdkHtml();
        list.innerHTML = tmp.querySelector('.cmdk-list').innerHTML;
      } else {
        root.innerHTML = cmdkHtml();
        const inp = document.getElementById('cmdkInput');
        inp.focus();
        inp.setSelectionRange(inp.value.length, inp.value.length);
        inp.addEventListener('input', () => { cmdkQuery = inp.value; cmdkSel = 0; paintCmdk(true); });
        inp.addEventListener('keydown', (e) => {
          const n = cmdkResults().length;
          if (e.key === 'ArrowDown') { e.preventDefault(); cmdkSel = Math.min(n - 1, cmdkSel + 1); paintCmdk(true); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); cmdkSel = Math.max(0, cmdkSel - 1); paintCmdk(true); }
          else if (e.key === 'Enter') { e.preventDefault(); runCmdk(cmdkSel); }
        });
        document.getElementById('cmdkScrim').addEventListener('click', (e) => { if (e.target.id === 'cmdkScrim') closeCmdk(); });
      }
      root.querySelectorAll('[data-cmdk-idx]').forEach(el => el.addEventListener('click', () => runCmdk(Number(el.dataset.cmdkIdx))));
      const sel = root.querySelector('.cmdk-item.sel');
      if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' });
    }

    function runCmdk(idx) {
      const r = cmdkResults()[idx];
      if (!r) return;
      closeCmdk();
      if (r.kind === 'page') {
        if (window.location.hash === r.href) route(); else window.location.hash = r.href;
      } else if (r.kind === 'person') {
        openUserMenu(r.person.robloxUserId, r.person.robloxUsername);
      } else if (r.kind === 'action') {
        r.run();
      }
    }

    function openCmdk() {
      if (!isHrAuthed) return;
      cmdkOpen = true; cmdkQuery = ''; cmdkSel = 0;
      paintCmdk();
      if (hasPermission('staff.view_database')) {
        cmdkPeopleLoading = !peopleCache.rows.length;
        cmdkPeople = peopleCache.rows;
        getPeople().then(rows => {
          cmdkPeople = rows; cmdkPeopleLoading = false;
          if (cmdkOpen) paintCmdk(true);
        });
      }
    }
    function closeCmdk() { cmdkOpen = false; paintCmdk(); }

    document.addEventListener('keydown', (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '') || (e.target && e.target.isContentEditable);
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        cmdkOpen ? closeCmdk() : openCmdk();
      } else if (e.key === '/' && !typing && !cmdkOpen && !umTarget) {
        e.preventDefault();
        openCmdk();
      } else if (e.key === 'Escape') {
        if (cmdkOpen) closeCmdk();
        else if (umTarget) closeUserMenu();
      }
    });

    let umTarget = null;
    let umTab = 'overview';
    let umLoading = false;
    let umData = null;
    let umLoadError = null;
    let umBusy = false;
    let umReason = '';
    let umMode = 'note';
    let umDuration = '168';
    let umNotify = false;
    let umDirty = false;
    let umPendingKeys = new Set();
    let umAnimated = false;

    let umTeamsState = { loading: false, loaded: false, error: null, assignments: [], userSkillsets: [] };
    let umRolesState = { loading: false, loaded: false, error: null, assignments: [] };
    let umPayState = { loading: false, loaded: false, error: null, method: 'PAYPAL', details: {}, saved: null, eligibility: null, busy: false };
    let umAddTeamId = '';
    let umAddSkillId = '';

    const catalog = { teams: null, skillsets: null, roles: null };
    async function loadCatalog(kind) {
      if (catalog[kind]) return catalog[kind];
      const fn = { teams: listTeams, skillsets: listSkillsets, roles: listRoles }[kind];
      catalog[kind] = await fn();
      return catalog[kind];
    }

    const REASON_TEMPLATES = {
      note: ['Checked in about workload', 'Missed a deadline', 'Good work flagged by lead'],
      warn: ['Inflated or duplicate payment request', 'Missed deadline without notice', 'Disrespectful to other staff', 'Shared internal information'],
      ban: ['Fraudulent payment requests', 'Harassment of staff', 'Leaked internal information', 'Alt account used to bypass a ban']
    };
    const DISCORD_SYNC_REASONS = {
      discord_blocked: "Discord is blocking our server right now, so their Discord role didn't change",
      no_discord_linked: "they haven't linked Discord, so their Discord role didn't change",
      not_in_server: "they aren't in the Discord server, so their Discord role didn't change",
      already_gone: 'they already did not have that Discord role',
      bot_role_too_low: "the bot's role sits below that one in Discord, so it couldn't change it",
      discord_error: "Discord wouldn't apply the change"
    };

    const BAN_DURATIONS = [['24', '1 day'], ['72', '3 days'], ['168', '7 days'], ['720', '30 days'], ['0', 'Permanently']];

    function panelTabs() {
      const tabs = [{ id: 'overview', label: 'Overview' }];
      if (hasPermission('settings.manage_onboarding')) tabs.push({ id: 'teams', label: 'Teams & skills' });
      if (hasPermission('roles.manage')) tabs.push({ id: 'roles', label: 'Roles' });
      if (hasPermission('staff.moderate')) tabs.push({ id: 'payout', label: 'Payout' });
      if (hasPermission('staff.moderate') || hasPermission('staff.view_database')) tabs.push({ id: 'moderation', label: 'Moderation' });
      return tabs;
    }

    function openUserMenu(robloxUserId, robloxUsername, tab) {
      if (!robloxUserId && !robloxUsername) return;
      umAnimated = false;
      umTarget = { id: robloxUserId ? String(robloxUserId) : null, username: robloxUsername || null };
      umLoading = true; umData = null; umLoadError = null; umReason = ''; umBusy = false;
      umMode = 'note'; umDuration = '168'; umNotify = false; umPendingKeys = new Set();
      umTeamsState = { loading: false, loaded: false, error: null, assignments: [], userSkillsets: [] };
      umRolesState = { loading: false, loaded: false, error: null, assignments: [] };
      umPayState = { loading: false, loaded: false, error: null, method: 'PAYPAL', details: {}, saved: null, eligibility: null, busy: false };
      umAddTeamId = ''; umAddSkillId = '';
      const allowed = panelTabs().map(t => t.id);
      umTab = allowed.includes(tab) ? tab : 'overview';
      paintUserMenu();
      refreshUserMenuData();
      preloadPanelTabs();
      if (hasPermission('staff.view_database') && !peopleCache.rows.length) getPeople().then(() => { if (umTarget) paintUserMenu(); });
    }

    function closeUserMenu() {
      umTarget = null;
      paintUserMenu();
      if (umDirty) {
        umDirty = false;
        peopleCache.at = 0;
        window.dispatchEvent(new CustomEvent('pv:people-changed'));
      }
    }

    function setPanelTab(tab) {
      umTab = tab;
      paintUserMenu();
      ensureTabData();
      const body = document.querySelector('#umScrim .pp-body');
      if (body) body.scrollTop = 0;
    }

    function preloadPanelTabs() {
      if (!umTarget || !umTarget.id) return;
      const tabs = panelTabs().map(t => t.id);
      if (tabs.includes('teams')) loadTeamsTab();
      if (tabs.includes('roles')) loadRolesTab();
      if (tabs.includes('payout')) loadPayoutTab();
    }

    function ensureTabData() {
      if (!umTarget || !umTarget.id) return;
      if (umTab === 'teams' && !umTeamsState.loaded && !umTeamsState.loading) loadTeamsTab();
      if (umTab === 'roles' && !umRolesState.loaded && !umRolesState.loading) loadRolesTab();
      if (umTab === 'payout' && !umPayState.loaded && !umPayState.loading) loadPayoutTab();
    }

    async function refreshUserMenuData() {
      if (!umTarget || !umTarget.id) { umLoading = false; paintUserMenu(); return; }
      const target = umTarget;
      if (!hasPermission('staff.moderate') && !hasPermission('staff.view_database')) { umLoading = false; paintUserMenu(); return; }
      try {
        const json = await callHrData('get_user_moderation', { robloxUserId: target.id });
        if (umTarget !== target) return;
        const d = (json && json.data) || {};
        umData = {
          warnings: Array.isArray(d.warnings) ? d.warnings : [],
          history: Array.isArray(d.history) ? d.history : [],
          roles: Array.isArray(d.roles) ? d.roles : [],
          ban: d.ban || null,
          lastActive: d.lastActive || null,
          discordLinked: !!d.discordLinked,
          canAct: !!d.canAct
        };
        umLoadError = null;
      } catch (e) {
        if (umTarget !== target) return;
        umLoadError = e.message;
      }
      umLoading = false;
      paintUserMenu();
    }

    async function loadTeamsTab() {
      const target = umTarget;
      umTeamsState.loading = true; umTeamsState.error = null; paintUserMenu();
      try {
        const [assignments, userSkillsets] = await Promise.all([
          listUserTeamAssignments(target.id),
          getUserSkillsets(target.username, target.id),
          loadCatalog('teams'),
          loadCatalog('skillsets')
        ]);
        if (umTarget !== target) return;
        umTeamsState.assignments = assignments;
        umTeamsState.userSkillsets = userSkillsets;
        umTeamsState.loaded = true;
      } catch (e) {
        if (umTarget !== target) return;
        umTeamsState.error = e.message;
      }
      umTeamsState.loading = false;
      paintUserMenu();
    }

    async function reloadTeamsTab() {
      const target = umTarget;
      const [assignments, userSkillsets] = await Promise.all([
        listUserTeamAssignments(target.id),
        getUserSkillsets(target.username, target.id)
      ]);
      if (umTarget !== target) return;
      umTeamsState.assignments = assignments;
      umTeamsState.userSkillsets = userSkillsets;
    }

    async function loadRolesTab() {
      const target = umTarget;
      umRolesState.loading = true; umRolesState.error = null; paintUserMenu();
      try {
        const [assignments] = await Promise.all([listRoleAssignments(target.id), loadCatalog('roles')]);
        if (umTarget !== target) return;
        umRolesState.assignments = assignments;
        umRolesState.loaded = true;
      } catch (e) {
        if (umTarget !== target) return;
        umRolesState.error = e.message;
      }
      umRolesState.loading = false;
      paintUserMenu();
    }

    async function loadPayoutTab() {
      const target = umTarget;
      umPayState.loading = true; umPayState.error = null; paintUserMenu();
      try {
        const [existing, eligibility] = await Promise.all([
          target.username ? getPaymentMethodForUser(target.username) : null,
          getUsdEligibilityForUser(target.id, target.username)
        ]);
        if (umTarget !== target) return;
        umPayState.saved = existing || null;
        umPayState.method = existing ? existing.method : 'PAYPAL';
        umPayState.details = existing ? { ...(existing.details || {}) } : {};
        umPayState.eligibility = eligibility;
        umPayState.loaded = true;
      } catch (e) {
        if (umTarget !== target) return;
        umPayState.error = e.message;
      }
      umPayState.loading = false;
      paintUserMenu();
    }

    async function panelAction(key, fn, successText) {
      if (umPendingKeys.has(key)) return;
      umPendingKeys.add(key);
      paintUserMenu();
      try {
        await fn();
        umDirty = true;
        if (successText) toast(successText);
      } catch (e) {
        toast(e.message || 'That change did not save.', 'err');
      }
      umPendingKeys.delete(key);
      paintUserMenu();
    }

    function shortAgo(ts) {
      const mins = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 60000));
      if (mins < 60) return mins <= 1 ? 'now' : `${mins}m ago`;
      if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
      if (mins < 43200) return `${Math.round(mins / 1440)}d ago`;
      return fmtDate(ts);
    }

    function relTime(ts) {
      const diff = new Date(ts).getTime() - Date.now();
      const abs = Math.abs(diff);
      const units = [[86400000 * 30, 'month'], [86400000, 'day'], [3600000, 'hour'], [60000, 'minute']];
      for (const [ms, name] of units) {
        if (abs >= ms) {
          const n = Math.round(abs / ms);
          return diff > 0 ? `in ${n} ${name}${n === 1 ? '' : 's'}` : `${n} ${name}${n === 1 ? '' : 's'} ago`;
        }
      }
      return diff > 0 ? 'in under a minute' : 'just now';
    }

    const MOD_EVENT = {
      note: ['Note', 't-note'],
      quick_warn: ['Warning', 't-warn'],
      add_user_warning: ['Warning', 't-warn'],
      remove_user_warning: ['Warning removed', 't-good'],
      auto_ban: ['Banned automatically at 3 warnings', 't-ban'],
      quick_ban: ['Banned', 't-ban'],
      quick_unban: ['Ban lifted', 't-good'],
      unban_user: ['Ban lifted', 't-good'],
      ban_expired: ['Temporary ban ended', 't-good'],
      revert: ['Change reverted', '']
    };

    function modEventHtml(h) {
      const [title, cls] = MOD_EVENT[h.action] || [String(h.action || '').replace(/_/g, ' '), ''];
      const d = h.details || {};
      let label = title;
      if ((h.action === 'quick_warn' || h.action === 'add_user_warning') && d.warnCount) label = `Warning ${d.warnCount} of 3`;
      if (h.action === 'quick_ban') label = d.expiresAt ? `Banned for ${BAN_DURATIONS.find(b => Number(b[0]) === Number(d.durationHours))?.[1] || (d.durationHours + ' hours')}` : 'Banned permanently';
      if (h.action === 'revert' && d.original_action) label = `Reverted: ${(MOD_EVENT[d.original_action] || [d.original_action])[0].toLowerCase()}`;
      return `<li class="${cls}">
        <div class="t-title ${h.reverted ? 'reverted' : ''}">${esc(label)}${h.reverted ? ' (reverted)' : ''}</div>
        <div class="t-meta">by ${esc(h.actor_username || 'System')} &middot; <span title="${esc(fmtDateTime(h.created_at))}">${esc(relTime(h.created_at))}</span></div>
        ${d.reason ? `<div class="t-text">${esc(d.reason)}</div>` : ''}
      </li>`;
    }

    function strikesHtml(n) {
      return `<span class="pp-strikes ${n >= 3 ? 'full' : ''}" aria-label="${n} of 3 warnings">${[0, 1, 2].map(i => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
    }

    function colorDot(color) {
      return `<span class="pp-dot" style="background:${safeColor(color, 'var(--muted)')};" aria-hidden="true"></span>`;
    }

    function personRow() {
      if (!umTarget || !umTarget.id) return null;
      return peopleCache.rows.find(p => String(p.robloxUserId) === String(umTarget.id)) || null;
    }

    function overviewTabHtml() {
      const d = umData;
      const p = personRow();
      const tabs = panelTabs().map(t => t.id);
      const stat = (value, label) => `<div class="pp-stat"><b>${value}</b><span>${label}</span></div>`;
      const paid = p && Object.keys(p.paidTotals || {}).length
        ? Object.entries(p.paidTotals).map(([cur, amt]) => cur === 'ROBUX' ? `R$ ${Number(amt).toLocaleString()}` : `${CURRENCY_SYMBOL[cur] || ''}${Number(amt).toLocaleString(undefined, { maximumFractionDigits: 2 })}`).join(' + ')
        : '0';
      const teams = umTeamsState.loaded
        ? umTeamsState.assignments.map(a => ({ teamName: a.team ? a.team.name : null, skillsetName: a.skillset ? a.skillset.name : null }))
        : (p && p.teams && p.teams.length ? p.teams : (p && p.team ? p.team.split(', ').map(n => ({ teamName: n })) : []));
      const skillNames = umTeamsState.loaded ? umTeamsState.userSkillsets.map(k => k.name) : (p && p.skillset ? p.skillset.split(', ') : []);
      const summaryRow = (label, content, tab, cta) => `
        <div class="pp-summary">
          <div class="pp-summary-label">${label}</div>
          <div class="pp-summary-value">${content}</div>
          ${tab && tabs.includes(tab) ? `<button type="button" class="pp-linkbtn" data-goto-tab="${tab}">${cta}</button>` : ''}
        </div>`;
      return `
        ${p ? `<div class="pp-stats">
          ${stat(esc(p.requestCount || 0), 'Requests')}
          ${stat(esc(p.pendingCount || 0), 'Waiting on payment')}
          ${stat(esc(paid), 'Paid so far')}
          ${stat(p.onboardingRequired ? `${esc(p.onboardingCompleted)}/${esc(p.onboardingRequired)}` : '-', 'Onboarding')}
        </div>` : ''}
        <div class="pp-section">
          ${summaryRow('Teams', teams.length ? teams.map(t => `<span class="pp-tag">${esc(t.teamName || 'Team')}${t.skillsetName ? ` <span class="hint">as ${esc(t.skillsetName)}</span>` : ''}</span>`).join('') : '<span class="hint">Not on a team</span>', 'teams', 'Edit')}
          ${summaryRow('Roles', d && d.roles && d.roles.length ? d.roles.map(r => `<span class="perm-chip">${esc(r)}</span>`).join('') : '<span class="hint">No roles</span>', 'roles', 'Edit')}
          ${summaryRow('Skills', skillNames.length ? skillNames.map(n => `<span class="pp-tag">${esc(n)}</span>`).join('') : '<span class="hint">No skills</span>', 'teams', 'Edit')}
        </div>`;
    }

    function teamsTabHtml() {
      const st = umTeamsState;
      if (!st.loaded) return st.error ? '' : `<div class="pp-skeleton"><span></span><span></span><span></span></div>`;
      if (st.error) return `<div class="error-box"><span>${esc(st.error)}</span></div><button type="button" class="btn btn-ghost btn-sm" data-retry-tab="teams">Try again</button>`;
      const teams = catalog.teams || [];
      const skills = catalog.skillsets || [];
      const skillById = {}; skills.forEach(k => { skillById[String(k.id)] = k; });
      const skillsForTeam = (teamId) => {
        const team = teams.find(t => String(t.id) === String(teamId));
        const ids = team && team.skillsetIds && team.skillsetIds.length ? team.skillsetIds.map(String) : null;
        return ids ? skills.filter(k => ids.includes(String(k.id))) : skills;
      };
      const removedRows = st.assignments.filter(a => a.removed);
      const liveAssignments = st.assignments.filter(a => !a.removed);
      const joined = new Set(liveAssignments.map(a => String(a.teamId)));
      const available = teams.filter(t => !joined.has(String(t.id)));
      const teamSkillIds = new Set(st.assignments.map(a => a.skillset && String(a.skillset.id)).filter(Boolean));
      const hasSkill = new Set(st.userSkillsets.map(k => String(k.id)));
      const teamNameForSkill = (id) => {
        const a = st.assignments.find(x => x.skillset && String(x.skillset.id) === String(id));
        return a && a.team ? a.team.name : 'a team';
      };

      const removedHtml = removedRows.length ? `
        <div class="pp-item">
          ${colorDot('var(--err-text)')}
          <div class="pp-item-main">
            <div class="pp-item-title">${removedRows.length === 1 ? 'A team that was deleted' : `${removedRows.length} teams that were deleted`}</div>
            <div class="pp-role-meta">Left over from a team that no longer exists. Clearing it tidies their record.</div>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" data-clear-removed-teams="1" ${umPendingKeys.has('team:removed') ? 'disabled' : ''}>Clear</button>
        </div>` : '';

      const teamRows = liveAssignments.length ? liveAssignments.map(a => {
        const key = 'team:' + a.teamId;
        const busy = umPendingKeys.has(key);
        const opts = skillsForTeam(a.teamId);
        return `
          <div class="pp-item">
            ${colorDot(a.team && a.team.color)}
            <div class="pp-item-main">
              <div class="pp-item-title">${esc(a.team ? a.team.name : 'Unknown team')}</div>
              <label class="pp-inline-label" for="teamSkill_${esc(a.teamId)}">Works as</label>
              <select id="teamSkill_${esc(a.teamId)}" class="pp-select" data-team-skill="${esc(a.teamId)}" ${busy ? 'disabled' : ''}>
                <option value="">No specific skill</option>
                ${opts.map(k => `<option value="${esc(k.id)}" ${a.skillset && String(a.skillset.id) === String(k.id) ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}
              </select>
            </div>
            <button type="button" class="pp-icon-btn" data-remove-team="${esc(a.teamId)}" ${busy ? 'disabled' : ''} aria-label="Remove from ${esc(a.team ? a.team.name : 'team')}" title="Remove from team">&times;</button>
          </div>`;
      }).join('') : (removedRows.length ? '' : `<p class="hint" style="margin:0 0 4px;">Not on any team yet.</p>`);

      const addBusy = umPendingKeys.has('team:add');
      const addRow = teams.length ? (available.length ? `
        <div class="pp-add">
          <select id="ppAddTeam" class="pp-select" aria-label="Team to add" ${addBusy ? 'disabled' : ''}>
            <option value="">Add to a team...</option>
            ${available.map(t => `<option value="${esc(t.id)}" ${String(umAddTeamId) === String(t.id) ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
          </select>
          ${umAddTeamId ? `
          <select id="ppAddTeamSkill" class="pp-select" aria-label="Skill on that team" ${addBusy ? 'disabled' : ''}>
            <option value="">No specific skill</option>
            ${skillsForTeam(umAddTeamId).map(k => `<option value="${esc(k.id)}" ${String(umAddSkillId) === String(k.id) ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}
          </select>
          <button type="button" class="btn btn-primary btn-sm" id="ppAddTeamBtn" ${addBusy ? 'disabled' : ''}>${addBusy ? 'Adding...' : 'Add'}</button>` : ''}
        </div>` : `<p class="hint" style="margin:8px 0 0;">They're on every team.</p>`)
        : `<p class="hint" style="margin:8px 0 0;">No teams exist yet. Create them in Manage, Teams &amp; skills.</p>`;

      const skillChips = skills.length ? skills.map(k => {
        const fromTeam = teamSkillIds.has(String(k.id));
        const on = hasSkill.has(String(k.id));
        const busy = umPendingKeys.has('skill:' + k.id);
        return `<button type="button" class="pp-toggle ${on ? 'on' : ''}" data-skill-toggle="${esc(k.id)}" aria-pressed="${on}" ${fromTeam || busy ? 'disabled' : ''}
          title="${fromTeam ? `Comes from their ${esc(teamNameForSkill(k.id))} team. Change it above.` : on ? 'Click to remove' : 'Click to add'}">
          ${colorDot(k.color)}${esc(k.name)}${fromTeam ? ' <span class="pp-toggle-note">via team</span>' : ''}
        </button>`;
      }).join('') : `<p class="hint" style="margin:0;">No skills exist yet. Create them in Manage, Teams &amp; skills.</p>`;

      return `
        <div class="pp-section">
          <h3>Teams</h3>
          <div class="pp-list">${removedHtml}${teamRows}</div>
          ${addRow}
        </div>
        <div class="pp-section">
          <h3>Skills</h3>
          <p class="hint" style="margin:-4px 0 10px;">Click to add or remove. Skills tied to a team change with the team above. Payment requests use these to pick which skill a task used.</p>
          <div class="pp-toggles">${skillChips}</div>
        </div>`;
    }

    function rolesTabHtml() {
      const st = umRolesState;
      if (!st.loaded) return st.error ? '' : `<div class="pp-skeleton"><span></span><span></span><span></span></div>`;
      if (st.error) return `<div class="error-box"><span>${esc(st.error)}</span></div><button type="button" class="btn btn-ghost btn-sm" data-retry-tab="roles">Try again</button>`;
      const roles = [...(catalog.roles || [])].sort((a, b) => (Number(b.hierarchy) || 0) - (Number(a.hierarchy) || 0));
      const direct = {}; st.assignments.forEach(a => { direct[String(a.role_id)] = a; });
      const effective = new Set((umData && umData.roles) || []);
      const rows = roles.map(r => {
        const a = direct[String(r.id)];
        const locked = (Number(r.hierarchy) || 0) >= hrMaxHierarchy;
        const viaGroup = !a && effective.has(r.name);
        const busy = umPendingKeys.has('role:' + r.id);
        return `
          <label class="pp-role ${locked ? 'locked' : ''}">
            <input type="checkbox" class="pp-switch" data-role-toggle="${esc(r.id)}" ${a ? 'checked' : ''} ${locked || busy ? 'disabled' : ''}>
            <span class="pp-role-main">
              <span class="pp-item-title">${esc(r.name)}</span>
              <span class="pp-role-meta">Level ${esc(r.hierarchy || 0)}${viaGroup ? ' &middot; they already have this from a Roblox group' : ''}${locked ? ' &middot; at or above your level' : ''}</span>
            </span>
          </label>`;
      }).join('');
      const orphans = st.assignments.filter(a => !(catalog.roles || []).some(r => String(r.id) === String(a.role_id)));
      const orphanHtml = orphans.length ? `
        <div class="pp-section">
          <h3>Roles that no longer exist (${orphans.length})</h3>
          <p class="hint" style="margin:-4px 0 10px;">These roles were deleted, but the person still has the entry. Removing it tidies their record and takes away anything it still grants.</p>
          <div class="pp-list">
            ${orphans.map(a => `
              <div class="pp-item">
                <div class="pp-item-main">
                  <div class="pp-item-title">Deleted role</div>
                  <div class="pp-role-meta">Reference ${esc(a.role_id)}</div>
                </div>
                <button type="button" class="btn btn-ghost btn-sm" data-remove-orphan-role="${esc(a.id)}" ${umPendingKeys.has('role:' + a.id) ? 'disabled' : ''}>Remove</button>
              </div>`).join('')}
          </div>
        </div>` : '';

      return `
        ${orphanHtml}
        <div class="pp-section">
          <h3>Roles given directly</h3>
          <p class="hint" style="margin:-4px 0 10px;">Switch a role on to give it to them, on top of anything they get from Roblox groups. Changes save straight away. You can only change roles below your own level.</p>
          <div class="pp-list">${rows || '<p class="hint" style="margin:0;">No roles exist yet. Create them in Manage, Roles.</p>'}</div>
        </div>`;
    }

    function payoutTabHtml() {
      const st = umPayState;
      if (!PAYMENT_METHODS[st.method]) st.method = 'PAYPAL';
      if (!st.loaded) return st.error ? '' : `<div class="pp-skeleton"><span></span><span></span></div>`;
      if (st.error) return `<div class="error-box"><span>${esc(st.error)}</span></div><button type="button" class="btn btn-ghost btn-sm" data-retry-tab="payout">Try again</button>`;
      const elig = st.eligibility;
      const def = PAYMENT_METHODS[st.method] || PAYMENT_METHODS.PAYPAL;
      return `
        <div class="pp-section">
          <h3>How they get paid</h3>
          <p class="hint" style="margin:-4px 0 12px;">${st.saved ? `Currently ${esc(PAYMENT_METHODS[st.saved.method] ? PAYMENT_METHODS[st.saved.method].label : st.saved.method)}. Saving here replaces what they set themselves.` : 'Nothing on file yet. Their payment requests show as missing a payout method until this is set.'}</p>
          <div class="pp-methods" role="radiogroup" aria-label="Payout method">
            ${Object.entries(PAYMENT_METHODS).filter(([key]) => methodEnabled(key)).map(([key, m]) => {
        const blocked = ['PAYPAL', 'VENMO', 'BANK_TRANSFER'].includes(key) && elig && !elig.eligible;
        return `<label class="pp-method ${st.method === key ? 'on' : ''} ${blocked ? 'blocked' : ''}">
                <input type="radio" name="ppMethod" value="${esc(key)}" ${st.method === key ? 'checked' : ''} ${blocked ? 'disabled' : ''}>
                <span><strong>${esc(m.label)}</strong><span class="hint">${blocked ? `Needs $${Number(elig.amountNeeded || 0).toFixed(2)} more pending first` : esc(m.sub)}</span></span>
              </label>`;
      }).join('')}
          </div>
          ${def.confidential ? `<div class="privacy-note"><span class="privacy-icon" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></span><span>${esc(PAYOUT_PRIVACY_NOTE)}</span></div>` : ''}
          ${st.saved && st.saved.detailsHidden && st.method === st.saved.method ? `<div class="pp-banner neutral">These bank details are hidden from you. Only the Executive Team can see them, and saving here would replace what they entered.</div>` : ''}
          ${def.fields.map(f => `
          <div class="field" style="margin-top:12px;">
            <label for="ppField_${esc(f.key)}">${esc(f.label)}</label>
            <input id="ppField_${esc(f.key)}" type="${f.type}" data-pay-field="${esc(f.key)}" placeholder="${esc(f.placeholder || '')}" value="${esc(st.details[f.key] || '')}">
          </div>`).join('')}
          <button type="button" class="btn btn-primary btn-sm" id="ppSavePayout" ${st.busy ? 'disabled' : ''}>${st.busy ? 'Saving...' : 'Save payout method'}</button>
        </div>`;
    }

    function moderationTabHtml() {
      const t = umTarget;
      const d = umData;
      const canModerate = hasPermission('staff.moderate');
      const isSelf = t.id && String(t.id) === String(hrUserId || '');
      const warnCount = d ? d.warnings.length : 0;
      const ban = d ? d.ban : null;
      const canAct = !!(d && d.canAct && canModerate && t.id && !isSelf);
      if (!d) return umLoading ? `<div class="dash-loading">Loading their record...</div>` : '';

      const mode = umMode;
      const nextWarn = warnCount + 1;
      const submitLabel = mode === 'note' ? 'Add note'
        : mode === 'warn' ? (nextWarn >= 3 ? 'Issue 3rd warning and ban' : `Issue warning ${nextWarn} of 3`)
          : (umDuration === '0' ? 'Ban permanently' : `Ban for ${BAN_DURATIONS.find(b => b[0] === umDuration)[1]}`);
      const modeHelp = mode === 'note' ? 'Private to moderators. Nothing changes for them.'
        : mode === 'warn' ? (nextWarn >= 3 ? 'This is their third warning, so they will be banned and signed out.' : `Three warnings bans the account. This will be warning ${nextWarn}.`)
          : 'They are signed out straight away and cannot sign in until the ban ends or is lifted.';
      const danger = mode === 'ban' || (mode === 'warn' && nextWarn >= 3);

      const composer = canAct && !ban ? `
        <div class="pp-section">
          <h3>Take action</h3>
          <div class="seg" role="tablist" aria-label="Action type">
            ${[['note', 'Note'], ['warn', 'Warning'], ['ban', 'Ban']].map(([m, l]) => `<button type="button" data-mode="${m}" class="${mode === m ? 'on' : ''}" role="tab" aria-selected="${mode === m}">${l}</button>`).join('')}
          </div>
          <p class="hint" style="margin:0 0 10px;">${esc(modeHelp)}</p>
          <div class="field" style="margin-bottom:8px;">
            <label for="umReasonInput">${mode === 'note' ? 'Note' : 'Reason'}</label>
            <textarea id="umReasonInput" rows="3" placeholder="${mode === 'note' ? 'What should other moderators know?' : 'What happened?'}">${esc(umReason)}</textarea>
          </div>
          <div class="reason-chips">${REASON_TEMPLATES[mode].map(r => `<button type="button" data-reason-chip="${esc(r)}">${esc(r)}</button>`).join('')}</div>
          ${mode === 'ban' ? `
          <div class="field">
            <label for="umDurationSel">Length</label>
            <select id="umDurationSel">${BAN_DURATIONS.map(([v, l]) => `<option value="${v}" ${umDuration === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
          </div>` : ''}
          ${mode !== 'note' && discordOn() ? `
          <label class="pp-check"><input type="checkbox" id="umNotifyChk" ${umNotify && d.discordLinked ? 'checked' : ''} ${d.discordLinked ? '' : 'disabled'}> ${d.discordLinked ? 'Tell them on Discord (includes the reason)' : 'No Discord linked, so they won\'t be messaged'}</label>` : ''}
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'} btn-sm" id="umSubmitBtn" ${umBusy ? 'disabled' : ''} style="${danger ? 'background:var(--err-text);color:#fff;border-color:var(--err-text);' : ''}">${umBusy ? 'Saving...' : esc(submitLabel)}</button>
        </div>` : '';

      const banBanner = ban ? `
        <div class="pp-banner">
          <strong>${ban.expires_at ? `Banned until ${esc(fmtDateTime(ban.expires_at))} (${esc(relTime(ban.expires_at))})` : 'Banned permanently'}</strong>
          <span>${esc(ban.reason || 'No reason given')}${ban.banned_by ? ` &middot; by ${esc(ban.banned_by)}` : ''}${ban.banned_at ? `, ${esc(relTime(ban.banned_at))}` : ''}</span>
          ${canAct ? `<div class="pp-row"><button type="button" class="btn btn-ghost btn-sm" id="umUnbanBtn" ${umBusy ? 'disabled' : ''}>${umBusy ? 'Saving...' : 'Lift ban'}</button>
            ${discordOn() && d.discordLinked ? `<label class="pp-check" style="margin:0;"><input type="checkbox" id="umNotifyChk" ${umNotify ? 'checked' : ''}> Tell them on Discord</label>` : ''}</div>` : ''}
        </div>` : '';

      const cantActNote = canModerate && t.id && !canAct
        ? `<div class="pp-banner neutral">${isSelf ? 'This is your account. Someone else has to moderate it.' : "Their role is at or above yours, so you can see their record but can't take action."}</div>` : '';

      const activeWarnings = d.warnings.length ? `
        <div class="pp-section">
          <h3>Active warnings (${warnCount} of 3)</h3>
          <ul class="timeline">
            ${d.warnings.map(w => `<li class="t-warn">
              <div class="t-title">${esc(w.reason || 'No reason given')}</div>
              <div class="t-meta">by ${esc(w.warned_by || 'Unknown')} &middot; <span title="${esc(fmtDateTime(w.created_at))}">${esc(relTime(w.created_at))}</span>
              ${canAct ? ` &middot; <button type="button" class="pp-linkbtn" data-remove-warning="${esc(w.id)}">Remove</button>` : ''}</div>
            </li>`).join('')}
          </ul>
        </div>` : '';

      const history = `
        <div class="pp-section">
          <h3>History</h3>
          ${d.history.length ? `<ul class="timeline">${d.history.map(modEventHtml).join('')}</ul>` : `<p class="hint" style="margin:0;">Nothing on record. Notes, warnings and bans will show up here.</p>`}
        </div>`;

      return banBanner + cantActNote + composer + activeWarnings + history;
    }

    function userMenuHtml() {
      if (!umTarget) return '';
      const t = umTarget;
      const d = umData;
      let state = '';
      if (d) {
        if (d.ban) state = `<span class="pp-state ban">${d.ban.expires_at ? `Banned until ${esc(fmtDate(d.ban.expires_at))}` : 'Banned'}</span>`;
        else if (d.warnings.length) state = `<span class="pp-state warn">${strikesHtml(d.warnings.length)} ${d.warnings.length} of 3</span>`;
      }
      const tabs = panelTabs();
      let body = '';
      if (!t.id) body = `<div class="pp-banner neutral">This entry isn't linked to a Roblox account, so there's nothing to manage here.</div>`;
      else if (umTab === 'teams') body = teamsTabHtml();
      else if (umTab === 'roles') body = rolesTabHtml();
      else if (umTab === 'payout') body = payoutTabHtml();
      else if (umTab === 'moderation') body = moderationTabHtml();
      else body = (umLoadError ? `<div class="error-box"><span>${esc(umLoadError)}</span></div>` : '') + (umLoading && !personRow() ? `<div class="dash-loading">Loading...</div>` : overviewTabHtml());

      return `
    <div class="pp-scrim" id="umScrim">
      <aside class="pp${umAnimated ? ' pp-still' : ''}" role="dialog" aria-modal="true" aria-labelledby="ppName">
        <div class="pp-head">
          ${avatarImg(t.id, '')}
          <div style="min-width:0;flex:1;">
            <h2 id="ppName">${esc(t.username || 'Unknown user')}</h2>
            <div class="pp-sub">${t.id ? `<button type="button" id="umCopyId" title="Copy Roblox ID">ID ${esc(t.id)}</button>` : 'No linked Roblox account'}${d && d.lastActive ? ` &middot; active ${esc(relTime(d.lastActive))}` : ''}${t.id ? ` &middot; <a href="https://www.roblox.com/users/${encodeURIComponent(t.id)}/profile" target="_blank" rel="noopener">Roblox profile</a>` : ''}</div>
            ${state ? `<div class="pp-chips">${state}</div>` : ''}
          </div>
          <button type="button" class="modal-close" id="umClose" aria-label="Close">&times;</button>
        </div>
        ${t.id && tabs.length > 1 ? `
        <div class="pp-tabs" role="tablist" aria-label="Sections">
          ${tabs.map(x => `<button type="button" role="tab" aria-selected="${umTab === x.id}" class="${umTab === x.id ? 'on' : ''}" data-panel-tab="${x.id}">${esc(x.label)}</button>`).join('')}
        </div>` : ''}
        <div class="pp-body" role="tabpanel">${body}</div>
        ${t.id && hasPermission('audit.view') ? `
        <div class="pp-foot">
          <a class="pp-linkbtn" href="#/audit?search=${encodeURIComponent(t.username || t.id)}" data-pp-link>See everything in the audit log</a>
        </div>` : ''}
      </aside>
    </div>`;
    }

    function paintUserMenu() {
      const root = document.getElementById('globalUserMenuRoot');
      if (!root) return;
      const active = document.activeElement;
      const focusId = active && active.id && root.contains(active) ? active.id : null;
      const body = root.querySelector('.pp-body');
      const scroll = body ? body.scrollTop : 0;
      root.innerHTML = userMenuHtml();
      umAnimated = true;
      wireUserMenuEvents();
      const body2 = root.querySelector('.pp-body');
      if (body2) body2.scrollTop = scroll;
      if (focusId) {
        const el = document.getElementById(focusId);
        if (el) { el.focus(); if (el.setSelectionRange && el.value != null && el.type !== 'radio' && el.type !== 'checkbox') { try { el.setSelectionRange(el.value.length, el.value.length); } catch (e) { } } }
      }
    }

    function wireUserMenuEvents() {
      const q = (sel) => document.querySelectorAll('#umScrim ' + sel);
      const scrim = document.getElementById('umScrim');
      if (!scrim) return;
      scrim.addEventListener('click', (e) => { if (e.target === scrim) closeUserMenu(); });
      document.getElementById('umClose').addEventListener('click', closeUserMenu);
      q('[data-pp-link]').forEach(a => a.addEventListener('click', () => closeUserMenu()));
      q('[data-panel-tab]').forEach(b => b.addEventListener('click', () => setPanelTab(b.dataset.panelTab)));
      q('[data-goto-tab]').forEach(b => b.addEventListener('click', () => setPanelTab(b.dataset.gotoTab)));
      q('[role="tab"][data-panel-tab]').forEach((b, i, all) => b.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const next = all[(i + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length];
        setPanelTab(next.dataset.panelTab);
        const again = document.querySelector(`#umScrim [data-panel-tab="${next.dataset.panelTab}"]`); if (again) again.focus();
      }));
      q('[data-retry-tab]').forEach(b => b.addEventListener('click', () => {
        const tab = b.dataset.retryTab;
        if (tab === 'teams') loadTeamsTab(); else if (tab === 'roles') loadRolesTab(); else loadPayoutTab();
      }));
      const copyId = document.getElementById('umCopyId');
      if (copyId) copyId.addEventListener('click', () => { navigator.clipboard && navigator.clipboard.writeText(umTarget.id); toast('Roblox ID copied'); });

      q('[data-team-skill]').forEach(sel => sel.addEventListener('change', () => {
        const teamId = sel.dataset.teamSkill;
        panelAction('team:' + teamId, async () => {
          await assignUserTeamSkillset(umTarget.id, umTarget.username, teamId, sel.value || null);
          await reloadTeamsTab();
        }, 'Skill on team updated');
      }));
      q('[data-clear-removed-teams]').forEach(b => b.addEventListener('click', async () => {
        if (!(await askConfirm('Clear the leftover entries for teams that no longer exist?'))) return;
        panelAction('team:removed', async () => {
          await callHrData('remove_user_team_assignment', { robloxUserId: umTarget.id, teamId: null, clearRemoved: true });
          await reloadTeamsTab();
        }, 'Cleared');
      }));
      q('[data-remove-team]').forEach(b => b.addEventListener('click', async () => {
        const teamId = b.dataset.removeTeam;
        const a = umTeamsState.assignments.find(x => String(x.teamId) === String(teamId));
        if (!(await askConfirm(`Remove ${umTarget.username || 'them'} from ${a && a.team ? a.team.name : 'this team'}?`))) return;
        panelAction('team:' + teamId, async () => {
          await removeUserTeamAssignment(umTarget.id, teamId);
          await reloadTeamsTab();
        }, 'Removed from team');
      }));
      const addTeam = document.getElementById('ppAddTeam');
      if (addTeam) addTeam.addEventListener('change', () => { umAddTeamId = addTeam.value; umAddSkillId = ''; paintUserMenu(); const s = document.getElementById('ppAddTeamSkill'); if (s) s.focus(); });
      const addSkill = document.getElementById('ppAddTeamSkill');
      if (addSkill) addSkill.addEventListener('change', () => { umAddSkillId = addSkill.value; });
      const addTeamBtn = document.getElementById('ppAddTeamBtn');
      if (addTeamBtn) addTeamBtn.addEventListener('click', () => {
        const teamId = umAddTeamId, skillId = umAddSkillId;
        panelAction('team:add', async () => {
          await assignUserTeamSkillset(umTarget.id, umTarget.username, teamId, skillId || null);
          await reloadTeamsTab();
          umAddTeamId = ''; umAddSkillId = '';
        }, 'Added to team');
      });
      q('[data-skill-toggle]').forEach(b => b.addEventListener('click', () => {
        const id = b.dataset.skillToggle;
        const on = b.getAttribute('aria-pressed') === 'true';
        panelAction('skill:' + id, async () => {
          if (on) await removeUserSkillset(umTarget.id, id);
          else await addUserSkillsets(umTarget.id, umTarget.username, [id]);
          await reloadTeamsTab();
        }, on ? 'Skill removed' : 'Skill added');
      }));

      q('[data-remove-orphan-role]').forEach(b => b.addEventListener('click', () => {
        const id = b.dataset.removeOrphanRole;
        panelAction('role:' + id, async () => {
          await deleteRoleAssignment(id);
          umRolesState.assignments = await listRoleAssignments(umTarget.id);
          refreshUserMenuData();
        }, 'Deleted role removed from their record');
      }));
      q('[data-role-toggle]').forEach(cb => cb.addEventListener('change', () => {
        const roleId = cb.dataset.roleToggle;
        const existing = umRolesState.assignments.find(a => String(a.role_id) === String(roleId));
        const role = (catalog.roles || []).find(r => String(r.id) === String(roleId));
        panelAction('role:' + roleId, async () => {
          let res = null;
          if (cb.checked && !existing) res = await addRoleAssignment(roleId, umTarget.id);
          else if (!cb.checked && existing) res = await deleteRoleAssignment(existing.id);
          umRolesState.assignments = await listRoleAssignments(umTarget.id);
          refreshUserMenuData();
          const name = role ? role.name : 'Role';
          if (res && res.discordSynced) toast(`${name} ${cb.checked ? 'given' : 'removed'} here and in Discord.`);
          else if (res && res.discordReason && res.discordReason !== 'not_configured') toast(`${name} ${cb.checked ? 'given' : 'removed'} here, but ${DISCORD_SYNC_REASONS[res.discordReason] || "their Discord role didn't change"}.`, 'err');
          else toast(`${name} ${cb.checked ? 'given' : 'removed'}. It applies next time they load the site.`);
        });
      }));

      q('input[name="ppMethod"]').forEach(r => r.addEventListener('change', () => {
        umPayState.method = r.value;
        if (umPayState.saved && umPayState.saved.method === r.value) umPayState.details = { ...(umPayState.saved.details || {}) };
        else umPayState.details = {};
        paintUserMenu();
      }));
      q('[data-pay-field]').forEach(inp => inp.addEventListener('input', () => { umPayState.details[inp.dataset.payField] = inp.value; }));
      const savePay = document.getElementById('ppSavePayout');
      if (savePay) savePay.addEventListener('click', async () => {
        const def = PAYMENT_METHODS[umPayState.method];
        const missing = def.fields.find(f => !String(umPayState.details[f.key] || '').trim());
        if (missing) { toast(`Enter their ${missing.label.toLowerCase()}.`, 'err'); const el = document.getElementById('ppField_' + missing.key); if (el) el.focus(); return; }
        umPayState.busy = true; paintUserMenu();
        try {
          await adminSetPaymentMethod(umTarget.id, umTarget.username, umPayState.method, umPayState.details);
          umPayState.saved = { method: umPayState.method, details: { ...umPayState.details } };
          umDirty = true;
          toast('Payout method saved');
        } catch (e) { toast(e.message || 'Could not save the payout method.', 'err'); }
        umPayState.busy = false; paintUserMenu();
      });

      const reasonInput = document.getElementById('umReasonInput');
      if (reasonInput) reasonInput.addEventListener('input', () => { umReason = reasonInput.value; });
      q('[data-mode]').forEach(b => b.addEventListener('click', () => { umMode = b.dataset.mode; paintUserMenu(); }));
      q('[data-reason-chip]').forEach(b => b.addEventListener('click', () => {
        umReason = umReason.trim() ? `${umReason.trim()}. ${b.dataset.reasonChip}` : b.dataset.reasonChip;
        paintUserMenu();
        const r = document.getElementById('umReasonInput'); if (r) r.focus();
      }));
      const dur = document.getElementById('umDurationSel');
      if (dur) dur.addEventListener('change', () => { umDuration = dur.value; paintUserMenu(); });
      const notify = document.getElementById('umNotifyChk');
      if (notify) notify.addEventListener('change', () => { umNotify = notify.checked; });
      const submit = document.getElementById('umSubmitBtn');
      if (submit) submit.addEventListener('click', () => runQuickModeration(umMode));
      const unban = document.getElementById('umUnbanBtn');
      if (unban) unban.addEventListener('click', () => runQuickModeration('unban'));
      q('[data-remove-warning]').forEach(b => b.addEventListener('click', async () => {
        if (!(await askConfirm('Remove this warning? It stays in the history as removed.'))) return;
        umBusy = true; paintUserMenu();
        try {
          await removeUserWarning(b.dataset.removeWarning);
          toast('Warning removed');
          await afterModeration();
        } catch (e) { toast(e.message, 'err'); }
        umBusy = false; paintUserMenu();
      }));
    }

    async function afterModeration() {
      await refreshUserMenuData();
      if (umData && umTarget) {
        const detail = { robloxUserId: umTarget.id, warnCount: umData.warnings.length, isBanned: !!umData.ban };
        peopleCache.rows.forEach(p => { if (String(p.robloxUserId) === String(detail.robloxUserId)) { p.warnCount = detail.warnCount; p.isBanned = detail.isBanned; } });
        window.dispatchEvent(new CustomEvent('pv:moderated', { detail }));
      }
      if (typeof window.__refreshCurrentAuditPage === 'function') window.__refreshCurrentAuditPage();
    }

    async function runQuickModeration(type) {
      if (!umTarget || !umTarget.id) return;
      const reason = umReason.trim();
      if ((type === 'note' || type === 'warn') && !reason) { toast(type === 'note' ? 'Write the note first.' : 'Add a reason for the warning.', 'err'); const r = document.getElementById('umReasonInput'); if (r) r.focus(); return; }
      const name = umTarget.username || 'this person';
      if (type === 'ban' && !(await askConfirm(umDuration === '0' ? `Ban ${name} permanently?` : `Ban ${name} for ${BAN_DURATIONS.find(b => b[0] === umDuration)[1]}?`))) return;
      if (type === 'warn' && umData && umData.warnings.length >= 2 && !(await askConfirm(`This is ${name}'s third warning, so they will be banned. Continue?`))) return;
      if (type === 'unban' && !(await askConfirm(`Lift the ban on ${name}? Their warnings stay on record.`))) return;
      umBusy = true; paintUserMenu();
      try {
        const res = await callHrData('quick_moderate', {
          robloxUserId: umTarget.id, robloxUsername: umTarget.username, type, reason,
          durationHours: type === 'ban' ? Number(umDuration) : undefined,
          notify: type !== 'note' && umNotify
        });
        let msg = { note: 'Note added', warn: res.banned ? 'Warning issued. They reached 3 and were banned' : `Warning ${res.warnCount} of 3 issued`, ban: 'Banned', unban: 'Ban lifted' }[type];
        if (res.temporaryUnsupported) msg = 'Banned, but permanently: the database needs the expires_at column for timed bans (see MIGRATION.sql)';
        if (res.notified) msg += '. They were notified';
        toast(msg + '.', res.temporaryUnsupported ? 'err' : undefined);
        umReason = ''; umNotify = false; umMode = 'note';
        await afterModeration();
      } catch (e) {
        toast(e.message || 'That action failed.', 'err');
      }
      umBusy = false;
      paintUserMenu();
    }

    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-user-link]');
      if (!el) return;
      e.preventDefault();
      openUserMenu(el.dataset.userId || null, el.dataset.userName || null);
    });

    function rowToTSV(d) {
      const items = parseWorkLines(d.workRaw || '');
      const work = items.map(i => i.rest ? `${i.lead} ${i.rest}` : i.lead).join(' | ');
      return [
        d.id, d.requestedBy || '', d.robloxUsername || '', d.game || '', d.taskName || '',
        d.timeWorked || '', String(d.payment || 0), d.currency,
        d.paid ? 'Paid' : 'Pending', fmtDate(d.createdAt || Date.now()), work
      ].join('\t');
    }
    const TSV_HEADER = ['ID', 'Requested By', 'Roblox Username', 'Game', 'Task', 'Time Worked', 'Payment', 'Currency', 'Status', 'Date Logged', 'Work Completed'].join('\t');

    async function exportRequestsToXlsx(rows, sheetLabel) {
      await ensureExcelJs();
      const workbook = new ExcelJS.Workbook();
      workbook.creator = brandName();
      workbook.created = new Date();

      const sheetName = (sheetLabel || 'Payments').slice(0, 31);
      const sheet = workbook.addWorksheet(sheetName, { views: [{ showGridLines: false }] });

      sheet.columns = [
        { width: 5 },
        { width: 26 },
        { width: 22 },
        { width: 20 },
        { width: 52 },
        { width: 12 },
        { width: 12 },
        { width: 12 },
        { width: 12 },
        { width: 14 }
      ];

      sheet.mergeCells('A1:J3');
      const banner = sheet.getCell('A1');
      banner.value = `${studioName()} payments`;
      banner.font = { name: 'Arial', size: 20, bold: true, color: { argb: 'FFFFFFFF' } };
      banner.alignment = { vertical: 'middle', horizontal: 'left', indent: 2 };
      for (let r = 1; r <= 3; r++) {
        for (let c = 1; c <= 10; c++) {
          sheet.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF171A21' } };
        }
      }

      sheet.mergeCells('A4:J4');
      const sub = sheet.getCell('A4');
      sub.value = `Exported ${new Date().toLocaleString()}, DevEx rate ${(DEVEX_RATE * 10000).toFixed(2)} USD per 10,000 Robux`;
      sub.font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF5B616E' } };

      const headerRowNum = 6;
      const headers = ['#', 'DEV RBLX USERNAME', 'PRODUCER', 'GAME', 'TASK/BUG TITLE', 'APPROVED', 'PAID', 'R$', 'USD', 'DATE'];
      const headerRow = sheet.getRow(headerRowNum);
      headers.forEach((h, i) => { headerRow.getCell(i + 1).value = h; });
      headerRow.eachCell(cell => {
        cell.font = { name: 'Arial', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF171A21' } };
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
      });
      headerRow.height = 22;
      sheet.views = [{ state: 'frozen', ySplit: headerRowNum, showGridLines: false }];

      rows.forEach((d, i) => {
        const rowNum = headerRowNum + 1 + i;
        const isRobux = d.currency === 'ROBUX';
        const row = sheet.getRow(rowNum);
        row.getCell(1).value = i + 1;
        row.getCell(2).value = d.robloxUsername || '';
        row.getCell(3).value = d.requestedBy || '';
        row.getCell(4).value = d.game || '';
        row.getCell(5).value = d.taskName || '';
        row.getCell(6).value = true;
        row.getCell(7).value = !!d.paid;
        if (isRobux) {
          row.getCell(8).value = Number(d.payment) || 0;
          row.getCell(9).value = { formula: `IF(H${rowNum}="","",H${rowNum}*${DEVEX_RATE})` };
        } else {
          row.getCell(8).value = '';
          row.getCell(9).value = Number(d.payment) || 0;
        }
        row.getCell(10).value = new Date(d.createdAt || Date.now());
        row.getCell(10).numFmt = 'dd/mm/yyyy';
        row.getCell(8).numFmt = '#,##0';
        row.getCell(9).numFmt = '$#,##0.00';
        row.eachCell(cell => {
          cell.border = { bottom: { style: 'thin', color: { argb: 'FFE4E7ED' } } };
          cell.font = { name: 'Arial', size: 11 };
        });
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `${studioName().toLowerCase().replace(/[^a-z0-9]+/g, '-')}-payments-${(sheetLabel || 'all').toLowerCase()}-${stamp}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    async function fetchOnboardingLinkPreview(token) {
      const res = await fetch(EDGE_BASE + '/onboarding-link-preview?token=' + encodeURIComponent(token), {
        headers: { 'ngrok-skip-browser-warning': 'true' }
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error((json && json.error) || 'not_found');
      return json.data;
    }

    function parseHashQuery() {
      const hash = window.location.hash;
      const qIndex = hash.indexOf('?');
      const query = qIndex === -1 ? '' : hash.slice(qIndex + 1);
      return new URLSearchParams(query);
    }

    // Boot: site status, branding, games and the session are all fetched in parallel, so a
    // returning user waits for exactly one network round trip before seeing their page.
    async function initAuth() {
      const [siteState] = await Promise.all([checkSiteState(), verifySession(), loadAppData()]);
      if (siteState.unreachable && !configError) { renderUnreachableScreen(); return; }
      if (siteState.closed) { renderClosedScreen(); return; }
      const blocking = siteState.servicesDown || siteState.indev;
      if (blocking && !hasIndevPreview()) { renderStatusScreen(siteState); return; }
      if (blocking) mountBypassPill(siteState);
      if (isHrAuthed && !securityKnown) await checkSecurityProtocol();
      authReady = true;
      route();
      startSiteWatch();
      warmUpForUser();
    }

    // After the first paint, quietly fetch the libraries this user is likely to need.
    function warmUpForUser() {
      if (!isHrAuthed) return;
      const idle = window.requestIdleCallback || (fn => setTimeout(fn, 1500));
      idle(() => {
        if (hasPermission('dashboard.view') || hasPermission('recruitment.analytics') || hasPermission('teams.view')) ensureChartJs().catch(() => { });
      });
    }

    function renderUnreachableScreen() {
      app.innerHTML = `
    <div class="closed-shell">
      <div class="lock-card">
        <div class="closed-icon">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8.8a15 15 0 0 1 20 0"></path><path d="M5 12.5a10 10 0 0 1 14 0"></path><path d="M8.5 16.1a5 5 0 0 1 7 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg>
        </div>
        <h2>Can't reach ${esc(studioName())} right now</h2>
        <p>The server didn't answer. This is usually a short blip, so try again in a moment.</p>
        <button type="button" class="btn btn-primary" id="retryBootBtn">Try again</button>
      </div>
    </div>`;
      const btn = document.getElementById('retryBootBtn');
      if (btn) btn.addEventListener('click', () => {
        btn.disabled = true;
        btn.textContent = 'Connecting...';
        bootstrapPromise = null;
        initAuth();
      });
    }

    async function hrSignOut() {
      const token = getStoredToken();
      if (token) {
        try {
          await fetch(EDGE_BASE + '/hr-session', {
            method: 'DELETE',
            headers: {
              Authorization: 'Bearer ' + token,
              'ngrok-skip-browser-warning': 'true'
            }
          });
        } catch (e) { }
      }
      clearToken();
      isHrAuthed = false;
      hrUsername = '';
      hrRoles = [];
      hrPermissions = [];
      hrMaxHierarchy = 0;
      needsDiscordLink = false;
      teamRemoved = false;
      window.location.hash = '#/';
    }

    const app = document.getElementById('app');

    async function handleAuthCallback() {
      app.innerHTML = authShell(`
        <h1>Signing you in</h1>
        <div class="auth-status"><span class="boot-mark"></span>Confirming your Roblox account...</div>`);
      wireAuthShell();

      const params = parseHashQuery();
      const err = params.get('error');
      const token = params.get('session');
      // Scrub the token out of the address bar and history straight away.
      try { history.replaceState(null, '', window.location.pathname + window.location.search + '#/auth-callback'); } catch (e) { }

      if (token) {
        storeToken(token);
        await verifySession();
      }

      const go = (hash) => { try { history.replaceState(null, '', window.location.pathname + window.location.search + hash); } catch (e) { } route(); };
      if (isHrAuthed) {
        clearPendingRef();
        go(takeReturnHash());
      } else {
        const fallbackErr = err || (token ? 'session_invalid' : null);
        go('#/hr' + (fallbackErr ? ('?error=' + encodeURIComponent(fallbackErr)) : ''));
      }
    }

    const CHART_ROUTES = ['#/analytics', '#/recruitment-analytics', '#/teams'];
    let chartLoadAttempted = false;

    function route() {
      if (!authReady) return;
      renderGen++;
      if (cmdkOpen) closeCmdk();
      if (umTarget) closeUserMenu();
      const path = window.location.hash.split('?')[0];
      // The welcome tour only makes sense on Home: leaving the page ends it instead of
      // leaving an overlay that blocks every click on the next screen.
      if (tourRunning && !['#/home', '#/', ''].includes(path)) finishTour();
      if (path === '#/auth-callback') { handleAuthCallback(); return; }
      if (path === '#link-discord') { window.location.hash = '#/home'; return; }

      // Pages for features this studio switched off are not reachable by URL either.
      if (isHrAuthed && !featureOn(featureForHref(path))) { window.location.hash = '#/home'; return; }

      // Chart screens: fetch Chart.js first (usually already warm), then render once.
      if (CHART_ROUTES.includes(path) && !window.Chart && !chartLoadAttempted) {
        chartLoadAttempted = true;
        const gen = renderGen;
        ensureChartJs().catch(() => { }).finally(() => { if (gen === renderGen) route(); });
        return;
      }

      const routeQuery = new URLSearchParams(window.location.hash.split('?')[1] || '');
      if (routeQuery.get('discordLinked') === '1') needsDiscordLink = false;

      if (path.indexOf('#/contract/') === 0) {
        if (isHrAuthed) renderContractPage(decodeURIComponent(path.slice('#/contract/'.length))); else renderHrGate();
        return;
      }
      if (path.indexOf('#/receipt/') === 0) {
        if (isHrAuthed) renderReceipt(decodeURIComponent(path.slice('#/receipt/'.length))); else renderHrGate();
        return;
      }
      if (path === '#/status') { renderStatusPage(); return; }

      if (path.indexOf('#/task/') === 0) {
        renderTaskPage(decodeURIComponent(path.slice('#/task/'.length)));
        return;
      }

      if (path.indexOf('#/join/') === 0) {
        const token = decodeURIComponent(path.slice('#/join/'.length));
        handleJoinLink(token);
        return;
      }

      if (false && isHrAuthed && teamRemoved && path !== '#/team-removed') {
        window.location.hash = '#/team-removed';
        return;
      }
      if (isHrAuthed && !teamRemoved && path === '#/team-removed') {
        window.location.hash = '#/';
        return;
      }

      if (isHrAuthed && siteLocked && path !== '#/locked') {
        window.location.hash = '#/locked';
        return;
      }
      if (isHrAuthed && !siteLocked && path === '#/locked') {
        window.location.hash = '#/home';
        return;
      }

      const LEGAL_PATHS = ['#/terms', '#/privacy', '#/aup', '#/tos'];
      if (isHrAuthed && needsOnboarding && path !== '#/onboarding' && !LEGAL_PATHS.includes(path)) {
        window.location.hash = '#/onboarding';
        return;
      }

      const RECRUIT_ONLY_PATHS = ['#/recruit', '#/recruit/apply', '#/recruit/status'];
      if (isHrAuthed && RECRUIT_ONLY_PATHS.includes(path)) {
        window.location.hash = '#/';
        return;
      }

      if (LEGAL_PATHS.includes(path)) {
        renderPolicyPage(path.slice(2));
      } else if (path === '#/team-removed') {
        if (isHrAuthed) renderTeamRemovedPage(); else renderHrGate();
      } else if (path === '#/locked') {
        if (isHrAuthed) renderLockedOut(); else renderHrGate();
      } else if (path === '#/security') {
        if (isHrAuthed && (hasPermission('security.manage') || hasPermission('roles.manage'))) renderSecurity();
        else if (isHrAuthed) window.location.hash = '#/home';
        else renderHrGate();
      } else if (path === '#/home') {
        if (isHrAuthed) renderHome(); else renderHrGate();
      } else if (path === '#/revenue') {
        if (isHrAuthed) renderRevenue(); else renderHrGate();
      } else if (path === '#/contracts') {
        if (isHrAuthed) renderContracts(); else renderHrGate();
      } else if (path === '#/exports') {
        if (isHrAuthed) renderExports(); else renderHrGate();
      } else if (path === '#/tax') {
        if (isHrAuthed) renderTaxAdmin(); else renderHrGate();
      } else if (path === '#/setup') {
        if (isHrAuthed) renderSetupWizard(); else renderHrGate();
      } else if (path === '#/runs') {
        if (isHrAuthed && hasPermission('dashboard.view')) renderPaymentRuns();
        else if (isHrAuthed) window.location.hash = '#/home';
        else renderHrGate();
      } else if (path === '#/hr' || path === '#/dashboard') {
        if (isHrAuthed) renderDashboard(); else renderHrGate();
      } else if (path === '#/manage') {
        if (isHrAuthed) renderManagePanel(); else renderHrGate();
      } else if (path === '#/analytics') {
        if (isHrAuthed) renderAnalytics(); else renderHrGate();
      } else if (path === '#/my') {
        if (isHrAuthed) renderMyPayments(); else renderHrGate();
      } else if (path === '#/new') {
        if (isHrAuthed && canSubmitRequests()) renderCreateView(); else if (isHrAuthed) renderMyPayments(); else renderHrGate();
      } else if (path === '#/onboarding') {
        if (isHrAuthed) renderOnboarding(); else renderHrGate();
      } else if (path === '#/request') {
        if (isHrAuthed) renderClaimPage(); else renderHrGate();
      } else if (path === '#/teams') {
        if (isHrAuthed) renderTeams(); else renderHrGate();
      } else if (path === '#/staff') {
        if (isHrAuthed) renderStaffDatabase(); else renderHrGate();
      } else if (path === '#/audit') {
        if (isHrAuthed) renderAuditLogs(); else renderHrGate();
      } else if (['#/recruit', '#/recruit/apply', '#/recruit/status', '#/recruitment', '#/recruitment-analytics'].includes(path) && !featureOn('recruitment')) {
        window.location.hash = '#/';
      } else if (path === '#/recruit') {
        renderRecruitGate();
      } else if (path === '#/recruit/apply') {
        renderRecruitApply();
      } else if (path === '#/recruit/status') {
        renderRecruitStatus();
      } else if (path === '#/recruitment') {
        if (isHrAuthed && hasPermission('recruitment.view')) renderRecruitmentDashboard();
        else if (isHrAuthed) window.location.hash = '#/';
        else renderHrGate();
      } else if (path === '#/recruitment-analytics') {
        if (isHrAuthed && hasPermission('recruitment.analytics')) renderRecruitmentAnalytics();
        else if (isHrAuthed) window.location.hash = '#/';
        else renderHrGate();
      } else {
        if (isHrAuthed) {
          renderHome();
        } else {
          renderHrGate();
        }
      }

      renderDiscordLinkModal();
    }
    window.addEventListener('hashchange', route);
    initAuth();

    const DISCORD_LINK_ERROR_MESSAGES = {
      discord_already_linked: 'That Discord account is already linked to a different account. Each Discord account can only be linked to one account here - use a different Discord account, or contact an admin if this is a mistake.',
      link_save_failed: 'Something went wrong saving that link. Please try again.',
      token_exchange_failed: 'Discord did not confirm that sign-in. Please try again.',
      discord_rate_limited: 'Discord is limiting sign-ins from our server right now. Wait a minute, then press Link Discord again.',
      discord_blocked: "Discord is temporarily blocking our server, so Discord can't be linked right now. This isn't anything you did. Try again later.",
      discord_bad_credentials: "Discord sign-in isn't set up correctly on our server, so this can't work yet. Let an admin know (the Discord client secret needs checking).",
      discord_code_rejected: 'Discord rejected that sign-in, usually because it expired or was already used. Press Link Discord to try again.',
      discord_unavailable: "Couldn't reach Discord. Try again in a moment.",
      userinfo_failed: 'Could not read your Discord account details. Please try again.',
      session_expired: 'Your session expired before the link finished. Please refresh and try again.'
    };

    function renderDiscordLinkModal() {
      const el = document.getElementById('discordLinkModal');
      if (el) el.remove();
    }

    function canSeeAnalytics() {
      return isHrAuthed && hasPermission('dashboard.view');
    }

    function canSeeManage() {
      return isHrAuthed && ['settings.manage_games', 'settings.manage_rate', 'settings.manage_groups', 'settings.manage_base_access', 'roles.manage', 'settings.manage_onboarding', 'broadcasts.manage'].some(hasPermission);
    }

    function navItems() {
      if (!isHrAuthed) return [];
      return [
        { group: 'you', label: 'My payments', href: '#/my', match: ['#/my', '#/', ''] },
        { group: 'you', label: 'New request', href: '#/new', show: canSubmitRequests() },
        { group: 'you', label: 'Request payment', href: '#/request', keywords: 'claim ask paid owed' },
        { group: 'team', label: 'Dashboard', href: '#/dashboard', match: ['#/dashboard', '#/hr'], show: hasPermission('dashboard.view'), keywords: 'dashboard pay approve review' },
        { group: 'team', label: 'Teams', href: '#/teams', show: canSeeTeams(), keywords: 'team games deadlines analytics growth' },
        { group: 'team', label: 'Staff', href: '#/staff', show: hasPermission('staff.view_database'), keywords: 'people users members database profiles' },
        { group: 'team', label: 'Moderation', href: '#/staff?tab=moderation', navHidden: true, show: hasPermission('staff.moderate'), keywords: 'bans warnings warn ban notes' },
        { group: 'team', label: 'Recruitment', href: '#/recruitment', match: ['#/recruitment', '#/recruitment-analytics'], show: hasPermission('recruitment.view'), keywords: 'applications tickets applicants hiring' },
        { group: 'admin', label: 'Analytics', href: '#/analytics', show: canSeeAnalytics(), keywords: 'stats charts spend' },
        { group: 'admin', label: 'Recruitment analytics', href: '#/recruitment-analytics', navHidden: true, show: hasPermission('recruitment.analytics') },
        { group: 'admin', label: 'Audit logs', href: '#/audit', show: hasPermission('audit.view'), keywords: 'history revert logs' },
        { group: 'admin', label: 'Backups', href: '#/audit?tab=backups', navHidden: true, show: hasPermission('backups.manage'), keywords: 'restore snapshot' },
        { group: 'admin', label: 'Manage', href: '#/manage', show: canSeeManage(), keywords: 'manage configure' },
        { group: 'admin', label: 'Manage: Access', href: '#/manage?tab=access', navHidden: true, show: hasPermission('settings.manage_base_access') || hasPermission('settings.manage_groups'), keywords: 'sign in groups eligibility discord servers' },
        { group: 'admin', label: 'Manage: Games & rate', href: '#/manage?tab=games', navHidden: true, show: hasPermission('settings.manage_games') || hasPermission('settings.manage_rate'), keywords: 'devex usd minimum' },
        { group: 'admin', label: 'Manage: Roles', href: '#/manage?tab=roles', navHidden: true, show: hasPermission('roles.manage'), keywords: 'permissions hierarchy' },
        { group: 'admin', label: 'Manage: Teams & skills', href: '#/manage?tab=teams', navHidden: true, show: hasPermission('settings.manage_onboarding'), keywords: 'teams skillsets' },
        { group: 'admin', label: 'Manage: Onboarding', href: '#/manage?tab=onboarding', navHidden: true, show: hasPermission('settings.manage_onboarding'), keywords: 'onboarding invite links roblox group' },
        { group: 'admin', label: 'Manage: Recruitment', href: '#/manage?tab=recruitment', navHidden: true, show: hasPermission('settings.manage_onboarding'), keywords: 'positions auto-hire sign-off finalise' },
        { group: 'admin', label: 'Manage: Broadcasts', href: '#/manage?tab=broadcasts', navHidden: true, show: hasPermission('broadcasts.manage'), keywords: 'announcements message' },
        { group: 'you', label: 'Contracts', href: '#/contracts', keywords: 'contract milestone commission agreement' },
        { group: 'team', label: 'Revenue share', href: '#/revenue', show: hasPermission('revenue.manage'), keywords: 'revenue percent share royalties' },
        { group: 'team', label: 'Exports', href: '#/exports', show: hasPermission('dashboard.export'), keywords: 'quickbooks xero csv paypal wise accounting' },
        { group: 'admin', label: 'Tax & receipts', href: '#/tax', show: hasPermission('tax.view'), keywords: 'tax w9 w-8ben 1099 year end receipts' },
        { group: 'you', label: 'Tax details', href: '#/my?focus=tax', navHidden: true, keywords: 'tax w9 w-8ben' },
        { group: 'you', label: 'My teams & skillsets', href: '#/my', navHidden: true },
        { group: 'you', label: 'Terms of Service', href: '#/terms', navHidden: true },
        { group: 'you', label: 'Privacy Policy', href: '#/privacy', navHidden: true },
        { group: 'you', label: 'Acceptable Use Policy', href: '#/aup', navHidden: true }
      ].filter(i => i.show !== false && featureOn(featureForHref(i.href)));
    }

    // Which studio feature a page belongs to (see "features" in studio.config.json).
    function featureForHref(href) {
      const path = String(href || '').split('?')[0];
      return ({
        '#/request': 'claims', '#/runs': 'paymentRuns', '#/teams': 'teams', '#/analytics': 'analytics',
        '#/staff': 'staffDatabase', '#/recruitment': 'recruitment', '#/recruitment-analytics': 'recruitment',
        '#/security': 'security', '#/audit': 'audit',
        '#/revenue': 'revenueShare', '#/contracts': 'contracts', '#/exports': 'accountingExport', '#/tax': 'taxForms'
      })[path] || (path.indexOf('#/contract/') === 0 ? 'contracts' : path.indexOf('#/receipt/') === 0 ? 'taxForms' : null);
    }

    function currentPath() {
      return (window.location.hash.split('?')[0] || '');
    }

    // ---------------------------------------------------------------------------------
    // App shell: sidebar navigation for signed-in people, a slim header for everyone else.
    // Every page starts its markup with ${topbar()}, so this one function frames the app.
    // ---------------------------------------------------------------------------------
    const NAV_ICONS = {
      home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
      wallet: '<rect x="3" y="6" width="18" height="14" rx="2.5"/><path d="M3 10h18"/><path d="M16 15h2"/>',
      send: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
      pen: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="m13.5 6.5 4 4"/>',
      inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
      calendar: '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/>',
      grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
      chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
      users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.8.7 3 2.4 3.5 5.2"/>',
      userPlus: '<circle cx="10" cy="8" r="3.5"/><path d="M3.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M19 8v6M16 11h6"/>',
      settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
      shield: '<path d="M12 3l7.5 3v5.2c0 4.9-3.2 8.9-7.5 10.3-4.3-1.4-7.5-5.4-7.5-10.3V6z"/>',
      list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
      search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
      menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
      chevron: '<path d="m7 10 5 5 5-5"/>',
      contract: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10 13h6M10 17h4"/>',
      pie: '<path d="M12 3v9h9"/><path d="M21 12a9 9 0 1 1-9-9"/>',
      download: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
      receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>'
    };
    function navIcon(name, size) {
      return `<svg width="${size || 18}" height="${size || 18}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${NAV_ICONS[name] || ''}</svg>`;
    }

    function shellNavGroups() {
      const canSeeDashboard = hasPermission('dashboard.view');
      return [
        { label: null, items: [{ href: '#/home', label: 'Home', icon: 'home', paths: ['#/home', '#/', ''] }] },
        {
          label: 'Payments', items: [
            { href: '#/my', label: 'My payments', icon: 'wallet', paths: ['#/my'] },
            featureOn('claims') ? { href: '#/request', label: 'Request payment', icon: 'send', paths: ['#/request'] } : null,
            canSubmitRequests() ? { href: '#/new', label: 'Log work', icon: 'pen', paths: ['#/new'] } : null,
            canSeeDashboard ? { href: '#/dashboard', label: 'Review & pay', icon: 'inbox', paths: ['#/dashboard', '#/hr'] } : null,
            canSeeDashboard && featureOn('paymentRuns') ? { href: '#/runs', label: 'Payment runs', icon: 'calendar', paths: ['#/runs'] } : null,
            featureOn('contracts') ? { href: '#/contracts', label: 'Contracts', icon: 'contract', paths: ['#/contracts', '#/contract'] } : null,
            hasPermission('revenue.manage') && featureOn('revenueShare') ? { href: '#/revenue', label: 'Revenue share', icon: 'pie', paths: ['#/revenue'] } : null,
            hasPermission('dashboard.export') && featureOn('accountingExport') ? { href: '#/exports', label: 'Exports', icon: 'download', paths: ['#/exports'] } : null
          ]
        },
        {
          label: 'Studio', items: [
            canSeeTeams() && featureOn('teams') ? { href: '#/teams', label: 'Teams & games', icon: 'grid', paths: ['#/teams'] } : null,
            canSeeAnalytics() && featureOn('analytics') ? { href: '#/analytics', label: 'Analytics', icon: 'chart', paths: ['#/analytics'] } : null,
            hasPermission('staff.view_database') && featureOn('staffDatabase') ? { href: '#/staff', label: 'Staff', icon: 'users', paths: ['#/staff'] } : null,
            hasPermission('recruitment.view') && featureOn('recruitment') ? { href: '#/recruitment', label: 'Recruitment', icon: 'userPlus', paths: ['#/recruitment', '#/recruitment-analytics'] } : null
          ]
        },
        {
          label: 'Admin', items: [
            canSeeManage() ? { href: '#/manage', label: 'Settings', icon: 'settings', paths: ['#/manage'] } : null,
            canSeeSecurity() && featureOn('security') ? { href: '#/security', label: 'Security', icon: 'shield', paths: ['#/security'] } : null,
            hasPermission('tax.view') && featureOn('taxForms') ? { href: '#/tax', label: 'Tax & receipts', icon: 'receipt', paths: ['#/tax'] } : null,
            hasPermission('audit.view') && featureOn('audit') ? { href: '#/audit', label: 'Audit log', icon: 'list', paths: ['#/audit'] } : null
          ]
        }
      ].map(g => ({ ...g, items: g.items.filter(Boolean) })).filter(g => g.items.length);
    }

    function shellBrand() {
      const logo = STUDIO.studio.logoUrl ? `<img src="${esc(STUDIO.studio.logoUrl)}" alt="">` : `<span class="shell-mark">${esc(studioShort())}</span>`;
      return `<a class="shell-brand" href="#/home">${logo}<span>${esc(brandName())}</span></a>`;
    }

    function topbar() {
      if (!isHrAuthed) {
        return `
    <header class="pub-header">
      ${shellBrand()}
      <div class="pub-header-right">
        ${studioWebsiteLink('pub-link')}
        <button type="button" class="icon-btn" id="themeToggleBtn" aria-label="${getTheme() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}">${themeToggleIcon()}</button>
        <a class="btn btn-primary btn-sm" href="#/hr" style="width:auto;">Sign in</a>
      </div>
    </header>`;
      }
      const path = currentPath();
      const locked = teamRemoved;
      const role = (hrRoles && hrRoles[0]) || 'Member';
      const words = String(hrUsername || '').split(/[\s_\-.]+/).filter(w => /[a-zA-Z0-9]/.test(w));
      const initials = (words.length > 1 ? words[0][0] + words[1][0] : String(hrUsername || '?').replace(/[^a-zA-Z0-9]/g, '').slice(0, 2)).toUpperCase() || '?';
      const nav = locked ? '' : shellNavGroups().map(g => `
        <div class="shell-group">
          ${g.label ? `<div class="shell-group-label">${esc(g.label)}</div>` : ''}
          ${g.items.map(i => {
            const active = i.paths.includes(path);
            return `<a class="shell-link${active ? ' active' : ''}" href="${i.href}"${active ? ' aria-current="page"' : ''}>${navIcon(i.icon)}<span>${esc(i.label)}</span></a>`;
          }).join('')}
        </div>`).join('');
      return `
    <aside class="app-sidebar" id="appSidebar" aria-label="Main">
      <div class="shell-top">
        ${shellBrand()}
        <div class="shell-tools">
          <button type="button" class="shell-search" id="shellSearchBtn">${navIcon('search', 16)}<span>Search</span><kbd>${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'} K</kbd></button>
          ${locked ? '' : bellButtonHtml('notifBellBtn')}
        </div>
      </div>
      <nav class="shell-nav">${nav}</nav>
      <div class="shell-foot">
        <details class="shell-account">
          <summary>
            <span class="shell-avatar" data-avatar-user="${esc(hrUserId || '')}">${esc(initials)}</span>
            <span class="shell-who"><strong>${esc(hrUsername)}</strong><small>${esc(role)}</small></span>
            ${navIcon('chevron', 16)}
          </summary>
          <div class="shell-menu">
            <button type="button" id="themeToggleBtn">${themeToggleIcon()}<span>${getTheme() === 'dark' ? 'Light mode' : 'Dark mode'}</span></button>
            ${locked ? '' : `<button type="button" id="replayTourBtn"><span class="shell-menu-pad"></span><span>Take the tour</span></button>`}
            <a href="#/terms"><span class="shell-menu-pad"></span><span>Terms</span></a>
            <a href="#/privacy"><span class="shell-menu-pad"></span><span>Privacy</span></a>
            <a href="#/aup"><span class="shell-menu-pad"></span><span>Acceptable use</span></a>
            ${STUDIO.studio.website ? `<a href="${esc(STUDIO.studio.website)}" target="_blank" rel="noopener noreferrer"><span class="shell-menu-pad"></span><span>${esc(STUDIO.studio.websiteLabel || 'Website')}</span></a>` : ''}
            <div class="shell-menu-sep"></div>
            <button type="button" id="signOutBtn" class="danger"><span class="shell-menu-pad"></span><span>Sign out</span></button>
          </div>
        </details>
      </div>
    </aside>
    <header class="mobile-header">
      <button type="button" class="icon-btn" id="shellMenuBtn" aria-label="Open menu" aria-controls="appSidebar" aria-expanded="false">${navIcon('menu', 20)}</button>
      ${shellBrand()}
      <div class="mobile-header-tools">
        ${locked ? '' : bellButtonHtml('notifBellBtnMobile')}
        <button type="button" class="icon-btn" id="shellSearchBtnMobile" aria-label="Search">${navIcon('search', 18)}</button>
      </div>
    </header>
    <div class="shell-scrim" id="shellScrim"></div>${securityStrip()}`;
    }

    // ---------------------------------------------------------------------------------
    // Notification bell. The unread count is polled once a minute while signed in; the
    // list loads when the panel opens. Everything else about notifications (email, the
    // studio webhook) lives on the server.
    // ---------------------------------------------------------------------------------
    const notifState = { unread: 0, items: [], loaded: false, loading: false, open: false, timer: null };
    const BELL_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
    const NOTIF_KIND_ICON = {
      payment: '<path d="M3 7h18v10H3z"/><path d="M3 11h18"/>',
      request: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
      task: '<path d="M4 13l4 4L19 6"/>',
      contract: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10 13h6M10 17h4"/>',
      revenue: '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>',
      security: '<path d="M12 3l7.5 3v5.2c0 4.9-3.2 8.9-7.5 10.3-4.3-1.4-7.5-5.4-7.5-10.3V6z"/>',
      account: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
      general: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>'
    };

    function bellButtonHtml(id) {
      const n = notifState.unread;
      return `<button type="button" class="icon-btn notif-bell" id="${id}" aria-label="Notifications${n ? `, ${n} unread` : ''}" aria-haspopup="dialog">${BELL_ICON}<span class="notif-badge" data-notif-badge${n ? '' : ' hidden'}>${n > 9 ? '9+' : n}</span></button>`;
    }

    function paintNotifBadges() {
      document.querySelectorAll('[data-notif-badge]').forEach(el => {
        const n = notifState.unread;
        el.textContent = n > 9 ? '9+' : String(n);
        el.hidden = !n;
        const btn = el.closest('button');
        if (btn) btn.setAttribute('aria-label', `Notifications${n ? `, ${n} unread` : ''}`);
      });
    }

    async function refreshUnread() {
      if (!isHrAuthed || document.hidden) return;
      try {
        const json = await callHrData('count_unread_notifications');
        notifState.unread = Number(json.unread) || 0;
        paintNotifBadges();
      } catch (e) { }
    }

    function startNotifPolling() {
      if (notifState.timer) return;
      refreshUnread();
      notifState.timer = setInterval(refreshUnread, 60 * 1000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshUnread(); });
    }

    function notifPanelHtml() {
      const items = notifState.items;
      return `
        <div class="notif-panel" role="dialog" aria-label="Notifications">
          <div class="notif-head">
            <strong>Notifications</strong>
            ${notifState.unread ? `<button type="button" class="pp-linkbtn" id="notifReadAll">Mark all read</button>` : ''}
          </div>
          <div class="notif-list">
            ${notifState.loading && !notifState.loaded ? `<div class="notif-empty">Loading...</div>`
              : !items.length ? `<div class="notif-empty"><b>You're all caught up</b><span>Payments, approvals and anything else that needs you will show up here.</span></div>`
                : items.map(n => `
              <button type="button" class="notif-item${n.read_at ? '' : ' unread'}" data-notif-id="${esc(n.id)}" data-notif-link="${esc(n.link || '')}">
                <span class="notif-ic"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${NOTIF_KIND_ICON[n.kind] || NOTIF_KIND_ICON.general}</svg></span>
                <span class="notif-txt"><b>${esc(n.title)}</b>${n.body && n.body !== n.title ? `<span>${esc(n.body)}</span>` : ''}<small>${esc(relTime(n.created_at))}</small></span>
              </button>`).join('')}
          </div>
          <div class="notif-foot"><a href="#/my?focus=notifications">Email settings</a></div>
        </div>`;
    }

    function closeNotifPanel() {
      const el = document.getElementById('notifPanelRoot');
      if (el) el.remove();
      notifState.open = false;
      document.removeEventListener('mousedown', onNotifOutside, true);
      document.removeEventListener('keydown', onNotifKey, true);
    }
    function onNotifOutside(e) {
      const root = document.getElementById('notifPanelRoot');
      if (root && !root.contains(e.target) && !e.target.closest('.notif-bell')) closeNotifPanel();
    }
    function onNotifKey(e) { if (e.key === 'Escape') closeNotifPanel(); }

    function paintNotifPanel(anchor) {
      let root = document.getElementById('notifPanelRoot');
      if (!root) {
        root = document.createElement('div');
        root.id = 'notifPanelRoot';
        document.body.appendChild(root);
      }
      const r = anchor ? anchor.getBoundingClientRect() : null;
      root.className = 'notif-root';
      if (r) {
        const left = Math.min(Math.max(8, r.left), window.innerWidth - 368);
        root.style.left = left + 'px';
        root.style.top = (r.bottom + 8) + 'px';
      }
      root.innerHTML = notifPanelHtml();
      const readAll = root.querySelector('#notifReadAll');
      if (readAll) readAll.addEventListener('click', async () => {
        notifState.items.forEach(n => { if (!n.read_at) n.read_at = new Date().toISOString(); });
        notifState.unread = 0; paintNotifBadges(); paintNotifPanel(anchor);
        try { await callHrData('mark_notifications_read', {}); } catch (e) { }
      });
      root.querySelectorAll('[data-notif-id]').forEach(btn => btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.notifId);
        const n = notifState.items.find(x => Number(x.id) === id);
        if (n && !n.read_at) {
          n.read_at = new Date().toISOString();
          notifState.unread = Math.max(0, notifState.unread - 1);
          paintNotifBadges();
          callHrData('mark_notifications_read', { ids: [id] }).catch(() => { });
        }
        closeNotifPanel();
        if (btn.dataset.notifLink) window.location.hash = btn.dataset.notifLink;
      }));
    }

    async function openNotifPanel(anchor) {
      if (notifState.open) { closeNotifPanel(); return; }
      notifState.open = true;
      notifState.loading = true;
      paintNotifPanel(anchor);
      document.addEventListener('mousedown', onNotifOutside, true);
      document.addEventListener('keydown', onNotifKey, true);
      try {
        const json = await callHrData('list_notifications', { limit: 30 });
        notifState.items = json.data || [];
        notifState.unread = Number(json.unread) || 0;
        notifState.loaded = true;
      } catch (e) { }
      notifState.loading = false;
      paintNotifBadges();
      if (notifState.open) paintNotifPanel(anchor);
    }

    function wireNotifBell() {
      if (!isHrAuthed) return;
      ['notifBellBtn', 'notifBellBtnMobile'].forEach(id => {
        const b = document.getElementById(id);
        if (b) b.addEventListener('click', () => openNotifPanel(b));
      });
      if (notifState.open) closeNotifPanel();
      startNotifPolling();
    }

    function wireTopbarSignOut() {
      const btn = document.getElementById('signOutBtn');
      if (btn) btn.addEventListener('click', hrSignOut);
      wireNotifBell();
      const tourBtn = document.getElementById('replayTourBtn');
      if (tourBtn) tourBtn.addEventListener('click', () => {
        const onHome = currentPath() === '#/home' || currentPath() === '#/' || currentPath() === '';
        if (onHome) { startTour(); return; }
        tourRequested = true;
        window.location.hash = '#/home';
      });
      document.querySelectorAll('#themeToggleBtn').forEach(themeBtn => themeBtn.addEventListener('click', () => {
        toggleTheme();
        const label = themeBtn.querySelector('span');
        if (label) label.textContent = getTheme() === 'dark' ? 'Light mode' : 'Dark mode';
      }));
      ['shellSearchBtn', 'shellSearchBtnMobile'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', () => openCmdk());
      });
      const sidebar = document.getElementById('appSidebar');
      const scrim = document.getElementById('shellScrim');
      const menuBtn = document.getElementById('shellMenuBtn');
      const setOpen = (open) => {
        if (!sidebar) return;
        sidebar.classList.toggle('open', open);
        if (scrim) scrim.classList.toggle('open', open);
        if (menuBtn) menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      };
      if (menuBtn) menuBtn.addEventListener('click', () => setOpen(!sidebar.classList.contains('open')));
      if (scrim) scrim.addEventListener('click', () => setOpen(false));
      if (sidebar) sidebar.querySelectorAll('.shell-link').forEach(a => a.addEventListener('click', () => setOpen(false)));
      // Fill the account avatar with the real picture when we have one.
      const av = document.querySelector('.shell-avatar[data-avatar-user]');
      if (av && av.dataset.avatarUser && !av.dataset.loaded) {
        av.dataset.loaded = '1';
        const cached = shellAvatarCache[av.dataset.avatarUser];
        const paint = (url) => { if (url) av.innerHTML = `<img src="${esc(url)}" alt="">`; };
        if (cached) paint(cached);
        else fetchWithTimeout(EDGE_BASE + '/api/roblox/avatars?ids=' + encodeURIComponent(av.dataset.avatarUser), {}, 8000)
          .then(r => r.json()).then(j => { const url = j && j.data && j.data[av.dataset.avatarUser]; if (url) { shellAvatarCache[av.dataset.avatarUser] = url; paint(url); } })
          .catch(() => { });
      }
    }
    const shellAvatarCache = {};

    const ROBLOX_ICON = '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5.16 1.5 1.5 18.84 18.84 22.5 22.5 5.16Zm8.83 13.64-5.13-1.1 1.1-5.13 5.13 1.1Z"/></svg>';

    // Shared shell for every signed-out screen. Desktop: the form on the left, a studio panel on
    // the right, sized to exactly one screen (no page scroll). Phones: just the form.
    function authShell(innerHtml, opts) {
      const si = STUDIO.signIn || {};
      const st = STUDIO.studio || {};
      const bg = si.backgroundImage ? String(si.backgroundImage) : '';
      const safeBg = /^(https:\/\/|\.?\/|[a-zA-Z0-9_\-]+\/|data:image\/(png|jpeg|webp|gif);base64,)[^"'()\s<>]*$/.test(bg) ? bg : '';
      const logo = st.logoUrl
        ? `<img src="${esc(st.logoUrl)}" alt="">`
        : `<span class="auth-brand-mark">${esc(studioShort())}</span>`;
      const showPreview = si.showPreview !== false && !(opts && opts.noPreview);
      const year = new Date().getFullYear();
      return `
    <div class="auth">
      <section class="auth-side" aria-label="Sign in">
        <header class="auth-top">
          <a class="auth-brand" href="#/">${logo}<span>${esc(brandName())}</span></a>
          <button type="button" class="auth-icon-btn" id="themeToggleBtn" aria-label="${getTheme() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}">${themeToggleIcon()}</button>
        </header>
        <div class="auth-main">${innerHtml}</div>
        <footer class="auth-bottom">
          ${si.footerNote ? `<p class="auth-note">${esc(si.footerNote)}</p>` : ''}
          <nav class="auth-links" aria-label="Legal">
            <a href="#/terms">Terms</a><a href="#/privacy">Privacy</a><a href="#/aup">Acceptable use</a>${st.website ? studioWebsiteLink('') : ''}
          </nav>
          <span class="auth-copy">&copy; ${year} ${esc(studioName())}</span>
        </footer>
      </section>
      <aside class="auth-art${safeBg ? ' has-image' : ''}"${safeBg ? ` style="--hero-image:url('${esc(safeBg)}')"` : ''} aria-hidden="true">
        <div class="auth-art-copy">
          <span class="auth-eyebrow">${esc(studioName())}</span>
          <h2>${esc(si.headline || 'Paid for what you build.')}</h2>
          ${si.tagline ? `<p>${esc(si.tagline)}</p>` : ''}
        </div>
        ${showPreview ? authPreviewHtml() : ''}
      </aside>
    </div>`;
    }

    // A still of the product, so people know what they're signing in to. Example data only.
    function authPreviewHtml() {
      const rows = [
        ['MB', 'Map blockout', 'Building', 'R$ 12,500', 'approved', 'Approved'],
        ['CS', 'Combat system v2', 'Scripting', '$340.00', 'review', 'In review'],
        ['LU', 'Lobby UI pass', 'UI', 'R$ 8,000', 'paid', 'Paid'],
        ['VF', 'Victory VFX', 'Effects', '$120.00', 'paid', 'Paid']
      ];
      return `
        <div class="auth-preview">
          <div class="ap-head">
            <div><span class="ap-k">Owed to you</span><strong class="ap-v">R$ 20,500 <em>+ $340.00</em></strong></div>
            <span class="ap-pill">Next run Friday</span>
          </div>
          <div class="ap-table">
            ${rows.map(r => `<div class="ap-row"><span class="ap-av">${r[0]}</span><span class="ap-task"><b>${r[1]}</b><small>${r[2]}</small></span><span class="ap-amt">${r[3]}</span><span class="ap-st ${r[4]}">${r[5]}</span></div>`).join('')}
          </div>
        </div>`;
    }

    function wireAuthShell() {
      const themeBtn = document.getElementById('themeToggleBtn');
      if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
    }

    function authLegalHtml() {
      const si = STUDIO.signIn || {};
      // Older configs pointed "Privacy Policy" at the acceptable use page; send those to the real one.
      const terms = !si.termsUrl || si.termsUrl === '#/tos' ? '#/terms' : si.termsUrl;
      const privacy = !si.privacyUrl || si.privacyUrl === '#/aup' ? '#/privacy' : si.privacyUrl;
      const ext = (u) => /^https:/.test(u) ? ' target="_blank" rel="noopener noreferrer"' : '';
      return `<p class="auth-legal">By continuing you agree to the <a href="${esc(terms)}"${ext(terms)}>Terms of Service</a> and acknowledge the <a href="${esc(privacy)}"${ext(privacy)}>Privacy Policy</a>.</p>`;
    }

    function renderHrGate() {
      const params = parseHashQuery();
      const err = params.get('error');
      const errorMessages = {
        invalid_state: 'That sign-in attempt was invalid or expired, please try again.',
        state_expired: 'That sign-in attempt expired, please try again.',
        missing_code_or_state: 'Sign-in was incomplete, please try again.',
        token_exchange_failed: 'Roblox could not confirm your sign-in, please try again.',
        userinfo_failed: 'Could not read your Roblox profile, please try again.',
        hr_check_failed: 'Could not check your access, please try again.',
        session_create_failed: 'Could not start your session, please try again.',
        session_invalid: 'Your sign-in could not be confirmed, please try again.',
        base_access_check_failed: 'Could not verify your Roblox group membership, please try again.',
        not_eligible: "This account doesn't have access yet. Ask an admin for an invite link or a role.",
        account_banned: 'This account has been banned and cannot sign in.',
        provider_disabled: 'That sign-in method is turned off. Use one of the options below.',
        email_not_verified: 'Your Google account email is not verified, so it cannot be used to sign in.',
        rate_limited: 'Too many sign-in attempts. Wait a minute and try again.'
      };
      const message = err ? (errorMessages[err] || 'Could not sign you in, please try again.') : null;
      const si = STUDIO.signIn || {};

      app.innerHTML = authShell(`
        <h1>${esc(si.title || 'Sign in')}</h1>
        <p class="auth-sub">${esc(si.subtitle || 'Sign in to see your work, approvals and payouts.')}</p>
        ${configError ? `<div class="error-box"><span>${esc(configError)}</span></div>` : ''}
        ${message ? `<div class="error-box" role="alert"><span>${esc(message)}</span></div>` : ''}
        ${authProviderButtons('#/home')}
        ${authLegalHtml()}`);

      wireAuthShell();
      wireAuthProviderButtons('#/home');
    }

    // Which sign-in methods the API has switched on (AUTH_PROVIDERS on the server).
    function authProviders() {
      const list = BOOTSTRAP && BOOTSTRAP.auth && Array.isArray(BOOTSTRAP.auth.providers) ? BOOTSTRAP.auth.providers : ['roblox'];
      return list.length ? list : ['roblox'];
    }

    const GOOGLE_ICON = '<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

    function authProviderButtons(returnHash, refToken) {
      const providers = authProviders();
      const si = STUDIO.signIn || {};
      const dis = configError ? 'disabled' : '';
      const parts = [];
      if (providers.includes('roblox')) {
        parts.push(`<button type="button" class="btn btn-primary btn-roblox" data-auth="roblox" ${dis}>${ROBLOX_ICON}<span>${esc(si.buttonLabel || 'Sign in with Roblox')}</span></button>`);
      }
      if (providers.includes('google')) {
        parts.push(`<button type="button" class="btn btn-provider" data-auth="google" ${dis}>${GOOGLE_ICON}<span>Continue with Google</span></button>`);
      }
      const testRoles = (BOOTSTRAP && BOOTSTRAP.auth && BOOTSTRAP.auth.testRoles) || [];
      if (providers.includes('test') && testRoles.length) {
        parts.push(`
          <div class="auth-test">
            <div class="auth-test-head"><span class="auth-test-badge">Test mode</span><span>Sign in as a test account. Turn this off before going live.</span></div>
            <div class="auth-test-roles">${testRoles.map(r => `<button type="button" class="btn btn-provider" data-auth="test" data-role="${esc(r)}" ${dis}><span class="auth-test-dot" data-role="${esc(r)}"></span><span>${esc(r)}</span></button>`).join('')}</div>
          </div>`);
      }
      const html = parts.join('');
      return `<div class="auth-providers">${html.includes('btn-roblox') && parts.length > 1 ? html.replace('</button>', '</button><div class="auth-or"><span>or</span></div>') : html}</div>`;
    }

    function wireAuthProviderButtons(returnHash, refToken) {
      document.querySelectorAll('[data-auth]').forEach(btn => btn.addEventListener('click', async () => {
        const kind = btn.dataset.auth;
        document.querySelectorAll('[data-auth]').forEach(b => { b.disabled = true; });
        btn.setAttribute('aria-busy', 'true');
        const label = btn.querySelector('span:last-child');
        if (kind === 'roblox') { if (label) label.textContent = 'Redirecting to Roblox...'; beginLogin(returnHash, refToken); return; }
        if (kind === 'google') { if (label) label.textContent = 'Redirecting to Google...'; beginLogin(returnHash, refToken, 'google'); return; }
        if (kind === 'test') {
          try {
            const res = await fetchWithTimeout(EDGE_BASE + '/auth/test-login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
              body: JSON.stringify({ role: btn.dataset.role })
            }, 15000);
            const json = await res.json().catch(() => ({}));
            if (!res.ok || !json.session) throw new Error(json.error || 'failed');
            storeToken(json.session);
            await verifySession();
            if (isHrAuthed && !securityKnown) await checkSecurityProtocol();
            try { history.replaceState(null, '', window.location.pathname + returnHash); } catch (e) { }
            route();
          } catch (e) {
            document.querySelectorAll('[data-auth]').forEach(b => { b.disabled = false; });
            btn.removeAttribute('aria-busy');
            toast(e.message === 'test_role_missing' ? 'That test role is missing. Run sql/setup.sql to create the starter roles.' : 'Test sign-in failed. Is the API running with AUTH_PROVIDERS including test?', 'err');
          }
        }
      }));
    }

    async function handleJoinLink(token) {
      storePendingRef(token);

      if (!isHrAuthed) {
        app.innerHTML = authShell(`<h1>You've been invited</h1><div class="auth-status"><span class="boot-mark"></span>Loading your invite...</div>`);
        wireAuthShell();
      } else {
        app.innerHTML = `${topbar()}<div class="gate-shell"><div class="gate-card"><div class="gate-icon">${gateMark()}</div><h2>Loading your invite...</h2></div></div>`;
      }

      let info = null;
      let loadFailed = false;
      try {
        info = await fetchOnboardingLinkPreview(token);
      } catch (e) {
        loadFailed = true;
      }

      if (isHrAuthed) {
        if (!loadFailed) setPendingInvite(token);
        clearPendingRef();
        window.location.hash = '#/onboarding';
        return;
      }

      app.innerHTML = authShell(`
        <h1>You've been invited</h1>
        ${loadFailed
          ? `<div class="error-box"><span>This invite link is invalid or has expired. You can still sign in normally.</span></div>`
          : `<p class="auth-sub">Sign in to accept. There's no application: we'll take you straight through ${discordOn() ? 'linking Discord and ' : ''}joining the team.</p>
            ${info && (info.team || info.skillset) ? `<div class="auth-invite">
              ${info.team ? `<div><small>Team</small><strong style="color:${safeColor(info.team.color)};">${esc(info.team.name)}</strong></div>` : ''}
              ${info.skillset ? `<div><small>Skillset</small><strong style="color:${safeColor(info.skillset.color)};">${esc(info.skillset.name)}</strong></div>` : ''}
            </div>` : ''}`}
        ${configError ? `<div class="error-box"><span>${esc(configError)}</span></div>` : ''}
        ${authProviderButtons('#/join/' + encodeURIComponent(token), token)}
        ${authLegalHtml()}`, { noPreview: true });

      wireAuthShell();
      if (!loadFailed) setPendingInvite(token);
      wireAuthProviderButtons('#/join/' + encodeURIComponent(token), token);
    }

    const JOIN_LINK_ERROR_MESSAGES = {
      discord_not_linked: 'Link your Discord account first, then accept the invite.',
      discord_not_in_server: "You'll need to join our Discord server before you can claim this invite - once you're in, come back and try again.",
      link_not_found: 'This invite link is invalid or has expired.'
    };

    const RECRUIT_ERROR_MESSAGES = {
      session_expired: 'That took a little too long and your session expired. Please sign in with Roblox again.',
      invalid_state: 'That Discord sign-in attempt was invalid or expired, please try again.',
      token_exchange_failed: 'Discord could not confirm your sign-in, please try again.',
      discord_rate_limited: 'Discord is limiting sign-ins from our server right now. Wait a minute, then press Link Discord again.',
      discord_blocked: "Discord is temporarily blocking our server, so Discord can't be linked right now. This isn't anything you did. Try again later.",
      discord_bad_credentials: "Discord sign-in isn't set up correctly on our server, so this can't work yet. Let an admin know (the Discord client secret needs checking).",
      discord_code_rejected: 'Discord rejected that sign-in, usually because it expired or was already used. Press Link Discord to try again.',
      discord_unavailable: "Couldn't reach Discord. Try again in a moment.",
      userinfo_failed: 'Could not read your Discord profile, please try again.',
      missing_code_or_state: 'Discord sign-in was incomplete, please try again.',
      link_save_failed: "Discord confirmed your sign-in, but we couldn't save the link to your account. Please try again - if it keeps happening, this is a server-side issue.",
      account_banned: 'This Roblox account is banned and cannot apply.',
      application_already_open: "You already have an application in progress, sit tight - we'll get back to you.",
      discord_not_linked: 'Please link your Discord account first.',
      discord_not_in_server: "You'll need to join our Discord server before you can apply - once you're in, come back and try again."
    };

    function renderRecruitGate() {
      const params = parseHashQuery();
      const rtParam = params.get('rt');
      if (rtParam) storeRecruitToken(rtParam);
      const rt = rtParam || getRecruitToken();
      const err = params.get('error');

      if (!rt) {
        app.innerHTML = `${topbar()}<div class="gate-shell"><div class="gate-card"><div class="gate-icon">${gateMark()}</div><h2>Sign in required</h2><p>Sign in with Roblox first to start an application.</p><button type="button" class="btn btn-primary roblox-btn" id="recruitSignInBtn">Sign in with Roblox</button></div></div>`;
        wireTopbarSignOut();
        const btn = document.getElementById('recruitSignInBtn');
        if (btn) btn.addEventListener('click', () => beginLogin('#/'));
        return;
      }

      app.innerHTML = `${topbar()}<div class="gate-shell"><div class="gate-card"><div class="gate-icon">${gateMark()}</div><h2>Loading...</h2></div></div>`;
      wireTopbarSignOut();

      fetchRecruitSession(rt).then(info => {
        if (info.hasFullAccess) { clearRecruitToken(); beginLogin('#/'); return; }
        if (info.discordLinked) { window.location.hash = '#/recruit/apply'; return; }
        paintGate(info);
      }).catch(() => {
        app.innerHTML = `${topbar()}<div class="gate-shell"><div class="gate-card"><div class="gate-icon">${gateMark()}</div><h2>That link expired</h2><p>Please sign in with Roblox again to restart.</p><button type="button" class="btn btn-primary roblox-btn" id="recruitRetryBtn">Sign in with Roblox</button></div></div>`;
        wireTopbarSignOut();
        const btn = document.getElementById('recruitRetryBtn');
        if (btn) btn.addEventListener('click', () => beginLogin('#/'));
      });

      function paintGate(info) {
        app.innerHTML = `
    ${topbar()}
    <div class="gate-shell">
      <div class="modal-scrim" style="position:static;background:none;padding:0;display:block;">
        <div class="gate-card">
          <div class="gate-icon">${gateMark()}</div>
          <h2>Hey, ${esc(info.robloxUsername)}</h2>
          <p>You're not currently part of the ${esc(studioName())} team. Would you like to start the recruitment program?</p>
          ${err ? `<div class="error-box"><span>${esc(RECRUIT_ERROR_MESSAGES[err] || 'Something went wrong, please try again.')}</span></div>` : ''}
          ${info.discordConfigured
            ? `<p class="gate-note" style="margin-top:0;">You'll need to link your Discord account too - that's how staff working recruitment will reach you.</p>
               <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:6px;">
                 <button type="button" class="btn btn-primary" id="recruitYesBtn">Start recruitment application</button>
                 <button type="button" class="btn btn-ghost" id="recruitNoBtn">Not right now</button>
               </div>`
            : `<div class="error-box"><span>Recruitment applications aren't open right now.</span></div>`}
        </div>
      </div>
    </div>`;
        wireTopbarSignOut();
        const yesBtn = document.getElementById('recruitYesBtn');
        if (yesBtn) yesBtn.addEventListener('click', () => {
          window.location.href = EDGE_BASE + '/discord-auth-start?rt=' + encodeURIComponent(rt) + '&return=' + encodeURIComponent('#/recruit/apply');
        });
        const noBtn = document.getElementById('recruitNoBtn');
        if (noBtn) noBtn.addEventListener('click', () => { window.location.hash = '#/'; });
      }
    }

    function renderRecruitApply() {
      const params = parseHashQuery();
      const rtParam = params.get('rt');
      if (rtParam) storeRecruitToken(rtParam);
      const rt = rtParam || getRecruitToken();
      const err = params.get('error');

      if (!rt) { window.location.hash = '#/'; return; }

      const myGen = renderGen;
      let info = null;
      let recruiters = [];
      let positions = [];
      let loading = true;
      let loadFailed = false;
      let submitting = false;
      let submitError = err ? (RECRUIT_ERROR_MESSAGES[err] || 'Something went wrong, please try again.') : null;
      let fieldErrors = {};

      paint();
      Promise.all([fetchRecruitSession(rt), loadPublicRecruiters(), loadPublicPositions()]).then(([sessionInfo, recruiterList, positionList]) => {
        if (renderGen !== myGen) return;
        info = sessionInfo;
        recruiters = recruiterList;
        positions = positionList;
        fetchMyTicket(rt).then(() => {
          if (renderGen !== myGen) return;
          window.location.hash = '#/recruit/status';
        }).catch(() => {
          if (renderGen !== myGen) return;
          loading = false;
          paint();
        });
      }).catch(() => {
        if (renderGen !== myGen) return;
        loading = false; loadFailed = true; paint();
      });

      function paint() {
        app.innerHTML = `
    ${topbar()}
    <div class="gate-shell">
      <div class="gate-card" style="max-width:560px;">
        <div class="gate-icon">${gateMark()}</div>
        ${loading ? `<h2>Loading...</h2>` : loadFailed ? `
          <h2>That link expired</h2>
          <p>Please sign in with Roblox again to restart your application.</p>
          <button type="button" class="btn btn-primary roblox-btn" id="applyRetryBtn">Sign in with Roblox</button>
        ` : !info.discordLinked ? `
          <h2>Link your Discord</h2>
          <p>Recruitment applications need a linked Discord account.</p>
          ${submitError ? `<div class="error-box"><span>${esc(submitError)}</span></div>` : ''}
          <button type="button" class="btn btn-primary" id="applyLinkDiscordBtn">Link Discord account</button>
        ` : `
          <h2 style="text-align:left;">Apply to ${esc(studioName())}</h2>
          <p style="text-align:left;">Signed in as <strong>${esc(info.robloxUsername)}</strong> (Roblox) and <strong>${esc(info.discordUsername || 'Discord')}</strong>.</p>
          ${submitError ? `<div class="error-box"><span>${esc(submitError)}</span></div>` : ''}
          <div style="text-align:left;display:flex;flex-direction:column;gap:14px;margin-top:6px;">
            <div class="field">
              <label>Position you're applying for <span class="hint">(optional)</span></label>
              <select id="ap_position">
                <option value="">Not sure / general application</option>
                ${positions.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label>Portfolio link <span class="hint">(optional)</span></label>
              <input type="text" id="ap_portfolio" placeholder="https://...">
            </div>
            <div class="field">
              <label>Relevant experience</label>
              <textarea id="ap_experience" rows="4" placeholder="Games you've worked on, roles held, links to previous work..." class="${fieldErrors.experience ? 'field-invalid' : ''}"></textarea>
              ${fieldErrors.experience ? `<div class="err-hint">${esc(fieldErrors.experience)}</div>` : ''}
            </div>
            <div class="field">
              <label>Why do you want to join ${esc(studioName())}?</label>
              <textarea id="ap_why" rows="4" class="${fieldErrors.whyJoin ? 'field-invalid' : ''}"></textarea>
              ${fieldErrors.whyJoin ? `<div class="err-hint">${esc(fieldErrors.whyJoin)}</div>` : ''}
            </div>
            <div class="field">
              <label>Were you referred by a staff member? <span class="hint">(optional)</span></label>
              <select id="ap_referrer">
                <option value="">No one / not sure</option>
                ${recruiters.map(r => `<option value="${esc(r.robloxUserId)}">${esc(r.robloxUsername)}</option>`).join('')}
              </select>
            </div>
            <button type="button" class="btn btn-primary" id="applySubmitBtn" ${submitting ? 'disabled' : ''}>${submitting ? 'Submitting...' : 'Submit application'}</button>
          </div>
        `}
      </div>
    </div>`;
        wireTopbarSignOut();

        const retryBtn = document.getElementById('applyRetryBtn');
        if (retryBtn) retryBtn.addEventListener('click', () => beginLogin('#/'));

        const linkBtn = document.getElementById('applyLinkDiscordBtn');
        if (linkBtn) linkBtn.addEventListener('click', () => {
          window.location.href = EDGE_BASE + '/discord-auth-start?rt=' + encodeURIComponent(rt) + '&return=' + encodeURIComponent('#/recruit/apply');
        });

        const submitBtn = document.getElementById('applySubmitBtn');
        if (submitBtn) submitBtn.addEventListener('click', async () => {
          const experience = (document.getElementById('ap_experience').value || '').trim();
          const whyJoin = (document.getElementById('ap_why').value || '').trim();
          const portfolioUrl = (document.getElementById('ap_portfolio').value || '').trim() || null;
          const position = document.getElementById('ap_position').value || null;
          const referredByUserId = document.getElementById('ap_referrer').value || null;
          const errs = {};
          if (!experience) errs.experience = 'Please share a bit about your experience.';
          if (!whyJoin) errs.whyJoin = "Let us know why you'd like to join.";
          if (portfolioUrl && !safeUrl(portfolioUrl)) errs.portfolioUrl = 'Please enter a valid http:// or https:// link.';
          if (Object.keys(errs).length) { fieldErrors = errs; submitError = null; paint(); return; }
          fieldErrors = {};
          submitting = true; submitError = null; paint();
          try {
            await submitRecruitmentApplication(rt, {
              experience,
              whyJoin,
              portfolioUrl,
              positionId: position,
              referredByUserId
            });
            submitting = false;
            window.location.hash = '#/recruit/status';
          } catch (e) {
            submitting = false;
            if (e.message === 'application_already_open') { window.location.hash = '#/recruit/status'; return; }
            submitError = RECRUIT_ERROR_MESSAGES[e.message] || 'Could not submit your application. Please try again.';
            paint();
          }
        });
      }
    }

    function recruitmentStatusChip(status) {
      const map = {
        pending: ['Pending', '--warn-bg', '--warn-text', '--warn-line'],
        in_review: ['In review', '--accent-soft', '--accent', '--accent-soft-strong'],
        accepted: ['Accepted', '--ok-bg', '--ok-text', '--ok-line'],
        team_selection: ['Team selection', '--accent-soft', '--accent', '--accent-soft-strong'],
        signed_off: ['Signed off', '--accent-soft', '--accent', '--accent-soft-strong'],
        finalised: ['Finalised', '--ok-bg', '--ok-text', '--ok-line'],
        rejected: ['Rejected', '--err-bg', '--err-text', '--err-line'],
        withdrawn: ['Withdrawn', '--row-alt', '--muted', '--line']
      };
      const m = map[status] || map.pending;
      return `<span style="display:inline-flex;padding:3px 9px;border-radius:999px;font-size:12px;font-weight:600;background:var(${m[1]});color:var(${m[2]});border:1px solid var(${m[3]});">${m[0]}</span>`;
    }

    const RECRUIT_STATUS_BLURBS = {
      pending: "We've got your application - it's in the queue to be reviewed.",
      in_review: "Someone's actively looking at your application.",
      accepted: "You're in! Someone from the team will reach out here shortly.",
      team_selection: "You're in! Please wait for higher ups to put you in a team.",
      signed_off: "Your placement has been reviewed and is waiting on final approval.",
      finalised: "You're fully set up and roled onto your team. Welcome aboard!",
      rejected: "This one didn't work out, but you're welcome to apply again in the future.",
      withdrawn: 'This application was marked as withdrawn.'
    };

    function renderLockedModal(ticket) {
      if (ticket && ticket.placed_team_id) {
        const stageLabel = ticket.status === 'signed_off' ? 'Signed off, awaiting a producer' : 'Awaiting sign-off';
        return `
    <div class="modal-scrim" id="lockedModalScrim">
      <div class="modal-card" style="max-width:440px;text-align:center;">
        <div class="modal-body" style="padding-top:16px;">
          <div class="roling-steps">
            <div class="roling-step roling-step-done">
              <div class="roling-step-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--ok-text)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M20 6L9 17l-5-5"></path>
                </svg>
              </div>
              <div class="roling-step-label">Confirmed</div>
            </div>
            <div class="roling-step-connector"></div>
            <div class="roling-step roling-step-pending">
              <div class="roling-step-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--warn-text)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M6 2h12"></path>
                  <path d="M6 22h12"></path>
                  <path d="M6 2c0 5 4 6 6 8c2-2 6-3 6-8"></path>
                  <path d="M6 22c0-5 4-6 6-8c2 2 6 3 6 8"></path>
                </svg>
              </div>
              <div class="roling-step-label">Access granted</div>
            </div>
          </div>
          <h3 style="margin:14px 0 6px;">Placed on ${esc(ticket.placed_team_name)}${ticket.skillset_name ? ` as ${esc(ticket.skillset_name)}` : ''}</h3>
          <p style="color:var(--ink-soft);font-size:13px;margin-bottom:10px;">${stageLabel}. A producer on your team has to finalise this before your access is granted - there's no fixed timer for it.</p>
          <p style="color:var(--muted);font-size:12px;margin-top:14px;">Need it sooner? Contact your Recruiter or Lead for priority access.</p>
        </div>
      </div>
    </div>`;
      }
      return `
    <div class="modal-scrim" id="lockedModalScrim">
      <div class="modal-card" style="max-width:400px;text-align:center;">
        <div class="modal-body" style="padding-top:12px;">
          <div style="width:56px;height:56px;border-radius:50%;background:var(--ok-bg);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--ok-text)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 6L9 17l-5-5"></path>
            </svg>
          </div>
          <h3 style="margin:0 0 8px;">You're in!</h3>
          <p style="color:var(--ink-soft);font-size:13px;">Please wait for higher ups to put you in a team. You can still check back here anytime to see updates.</p>
        </div>
      </div>
    </div>`;
    }

    function renderRecruitStatus() {
      const rt = getRecruitToken();
      if (!rt) {
        app.innerHTML = `${topbar()}<div class="gate-shell"><div class="gate-card"><div class="gate-icon">${gateMark()}</div><h2>Sign in required</h2><p>Sign in with Roblox to check your application status.</p><button type="button" class="btn btn-primary roblox-btn" id="statusSignInBtn">Sign in with Roblox</button></div></div>`;
        wireTopbarSignOut();
        const btn = document.getElementById('statusSignInBtn');
        if (btn) btn.addEventListener('click', () => beginLogin('#/'));
        return;
      }

      const myGen = renderGen;
      let data = null;
      let loading = true;
      let loadError = null;
      let pollTimer = null;
      let rolingCountdownTimer = null;
      let notifyModalShown = false;
      let notifyBusy = false;
      let notifyError = null;

      load(true);

      async function load(showSpinner) {
        if (showSpinner) { loading = true; paint(); }
        const prevData = data;
        const prevLoadError = loadError;
        try {
          const [ticketData, sessionInfo] = await Promise.all([
            fetchMyTicket(rt),
            fetchRecruitSession(rt).catch(() => null)
          ]);
          if (sessionInfo && sessionInfo.hasFullAccess) {
            if (pollTimer) clearInterval(pollTimer);
            clearRecruitToken();
            beginLogin('#/');
            return;
          }
          data = ticketData;
          loading = false; loadError = null;
        } catch (e) {
          loading = false;
          loadError = e.message === 'no_ticket' ? 'no_ticket' : (e.message || 'Could not load your application.');
        }
        if (renderGen !== myGen) return;

        const changed = showSpinner || loadError !== prevLoadError || JSON.stringify(data) !== JSON.stringify(prevData);
        if (changed) paint();

        if (!pollTimer && data) {
          pollTimer = setInterval(() => { if (renderGen !== myGen) { clearInterval(pollTimer); return; } load(false); }, 4000);
        }
      }

      document.addEventListener('visibilitychange', () => {
        if (renderGen !== myGen) return;
        if (document.visibilityState === 'visible' && data) load(false);
      });

      function maybeShowNotifyModal() {
        if (notifyModalShown || !data) return;
        if (!('Notification' in window) || !data.pushConfigured) return;
        if (Notification.permission !== 'default') return;
        const key = 'pv_recruit_notify_asked_' + data.ticket.id;
        try { if (localStorage.getItem(key)) return; } catch (e) { }
        notifyModalShown = true;
        paint();
      }

      function paint() {
        if (renderGen !== myGen) return;
        const notifyKey = data ? 'pv_recruit_notify_asked_' + data.ticket.id : null;

        app.innerHTML = `
    ${topbar()}
    <div class="dash-shell" style="max-width:720px;">
      ${loading ? `<div class="panel" style="padding:40px;text-align:center;color:var(--muted);">Loading your application...</div>`
            : loadError === 'no_ticket' ? `
          <div class="dash-empty"><h3>No application found</h3><p>You haven't submitted an application yet.</p><a class="btn btn-primary" href="#/recruit">Start an application</a></div>`
              : loadError ? `<div class="dash-empty"><h3>Could not load your application</h3><p>${esc(loadError)}</p></div>`
                : `
        <div class="dash-head">
          <div>
            <h1 style="margin-bottom:4px;">${esc(data.ticket.position || (studioName() + ' application'))}</h1>
            <p class="sub">${esc(RECRUIT_STATUS_BLURBS[data.ticket.status] || '')}</p>
          </div>
          <div class="dash-toolbar">${recruitmentStatusChip(data.ticket.status)}</div>
        </div>

        <div class="panel" style="padding:20px;margin-bottom:16px;">
          <div class="preview-label" style="margin-bottom:10px;">Communication</div>
          ${data.discordChannelUrl ? `
          <p style="color:var(--ink-soft);font-size:13px;margin-bottom:10px;">We've opened a private ticket channel for your application on Discord - that's where staff will message you and where you can ask questions.</p>
          <a class="btn btn-primary btn-sm" href="${esc(data.discordChannelUrl)}" target="_blank" rel="noopener">Open your Discord ticket channel</a>
          ` : `<p style="color:var(--ink-soft);font-size:13px;">Your private Discord ticket channel is being set up - check your Discord server, staff will message you there.</p>`}
        </div>

        <div class="panel" style="padding:20px;">
          <div class="preview-label" style="margin-bottom:10px;">Application details</div>
          ${data.ticket.portfolio_url ? (() => { const pu = safeUrl(data.ticket.portfolio_url); return `<div class="modal-info-row"><strong>Portfolio:</strong> ${pu ? `<a href="${esc(pu)}" target="_blank" rel="noopener noreferrer nofollow">${esc(data.ticket.portfolio_url)}</a>` : `${esc(data.ticket.portfolio_url)} <span style="color:var(--danger,#e55);font-size:12px;">(unsafe link removed)</span>`}</div>`; })() : ''}
          <div class="modal-info-row"><strong>Referred by:</strong> ${esc(data.ticket.referred_by_username || 'No one')}</div>
          <div class="modal-info-row" style="white-space:pre-wrap;margin-top:8px;"><strong>Experience:</strong><br>${esc(data.ticket.experience)}</div>
          <div class="modal-info-row" style="white-space:pre-wrap;margin-top:8px;"><strong>Why you want to join:</strong><br>${esc(data.ticket.why_join)}</div>
          <div style="margin-top:10px;color:var(--muted);font-size:12px;">Submitted ${new Date(data.ticket.created_at).toLocaleString()}</div>
        </div>`}
    </div>
    ${data && (data.ticket.status === 'team_selection' || data.ticket.status === 'signed_off') ? renderLockedModal(data.ticket) : notifyModalShown ? `
    <div class="modal-scrim" id="notifyModalScrim">
      <div class="modal-card" style="max-width:420px;text-align:center;">
        <div class="modal-body" style="padding-top:8px;">
          <h3 style="margin-top:0;">Want a heads-up when something changes?</h3>
          <p style="color:var(--ink-soft);">We can notify you in your browser when your application status updates - no need to keep checking back.</p>
          ${notifyError ? `<div class="error-box"><span>${esc(notifyError)}</span></div>` : ''}
          <div style="display:flex;gap:10px;justify-content:center;margin-top:14px;">
            <button type="button" class="btn btn-primary" id="notifyEnableBtn" ${notifyBusy ? 'disabled' : ''}>${notifyBusy ? 'Enabling...' : 'Enable notifications'}</button>
            <button type="button" class="btn btn-ghost" id="notifyDismissBtn">Not now</button>
          </div>
        </div>
      </div>
    </div>` : ''}`;

        wireTopbarSignOut();

        const notifyEnableBtn = document.getElementById('notifyEnableBtn');
        if (notifyEnableBtn) notifyEnableBtn.addEventListener('click', async () => {
          notifyBusy = true; notifyError = null; paint();
          try {
            await enableRecruitPushNotifications(rt);
            try { localStorage.setItem(notifyKey, '1'); } catch (e) { }
            notifyModalShown = false;
          } catch (e) {
            notifyError = e.message === 'permission_denied'
              ? "Notifications were blocked - you can turn them on later from your browser's site settings."
              : "Couldn't enable notifications on this browser/device.";
          }
          notifyBusy = false; paint();
        });
        const notifyDismissBtn = document.getElementById('notifyDismissBtn');
        if (notifyDismissBtn) notifyDismissBtn.addEventListener('click', () => {
          try { localStorage.setItem(notifyKey, '1'); } catch (e) { }
          notifyModalShown = false; paint();
        });
      }

      const notifyCheckInterval = setInterval(() => {
        if (renderGen !== myGen) { clearInterval(notifyCheckInterval); return; }
        if (data) { maybeShowNotifyModal(); if (notifyModalShown) { paint(); clearInterval(notifyCheckInterval); } }
      }, 1000);
    }

    function renderRecruitmentDashboard() {
      const myGen = renderGen;
      let tickets = [];
      let group = 'review';
      let rSearch = '';
      const RECRUIT_GROUPS = [
        { id: 'review', label: 'To review', statuses: ['pending', 'in_review'] },
        { id: 'hiring', label: 'Being hired', statuses: ['accepted', 'team_selection', 'signed_off'] },
        { id: 'hired', label: 'Hired', statuses: ['finalised'] },
        { id: 'closed', label: 'Closed', statuses: ['rejected', 'withdrawn'] },
        { id: 'mine', label: 'Assigned to me', test: t => hrUserId != null && String(t.assigned_to_user_id) === String(hrUserId) },
        { id: 'all', label: 'All', test: () => true }
      ];
      function inGroup(t, g) { return g.test ? g.test(t) : g.statuses.includes(t.status); }
      function matchesRecruitSearch(t) {
        const q = rSearch.trim().toLowerCase();
        if (!q) return true;
        return [t.roblox_username, t.discord_username, t.position, t.referred_by_username].some(v => (v || '').toLowerCase().includes(q));
      }
      function visibleTickets() {
        const g = RECRUIT_GROUPS.find(x => x.id === group) || RECRUIT_GROUPS[0];
        return tickets.filter(t => inGroup(t, g) && matchesRecruitSearch(t));
      }
      let loading = true;
      let loadError = null;
      let openTicketId = null;
      let ticketDetail = null;
      let ticketDetailLoading = false;
      let recruiters = [];
      let busy = false;
      let ticketPollTimer = null;
      let listPollTimer = null;

      let nextPhaseModalOpen = false;
      let nextPhaseSkillsets = [];
      let nextPhaseSkillsetsLoading = false;
      let nextPhaseSelectedSkillsetId = '';
      let nextPhaseBusy = false;
      let nextPhaseError = null;
      let allSetModalOpen = false;
      let manualRolingBusy = false;
      let manualRolingMsg = null;
      let signOffBusy = false;
      let signOffMsg = null;

      let placeTeamOptions = [];
      let placeTeamSelectedId = '';
      let placeTeamBusy = false;
      let placeTeamError = null;

      let approvalRoleNames = { signoffRoleName: null, producerRoleName: null };

      const canManage = hasPermission('recruitment.manage');
      const canSeeAnalytics = hasPermission('recruitment.analytics');
      const hasSignoffPermission = hasPermission('recruitment.signoff');
      const hasFinalisePermission = hasPermission('recruitment.finalise');

      function canSignOffTicket() {
        return hasSignoffPermission || (approvalRoleNames.signoffRoleName && hrRoles.includes(approvalRoleNames.signoffRoleName));
      }
      function canFinaliseTicket() {
        return hasFinalisePermission || (approvalRoleNames.producerRoleName && hrRoles.includes(approvalRoleNames.producerRoleName));
      }

      load();
      if (canManage) loadRecruiters().then(r => { recruiters = r; if (openTicketId) paintModal(); }).catch(() => { });
      getRecruitmentApprovalRoleNames().then(names => { approvalRoleNames = names; if (openTicketId) paintModal(); }).catch(() => { });
      if (canManage) loadTeamsForPlacement().then(r => { placeTeamOptions = r; if (openTicketId) paintModal(); }).catch(() => { });

      async function load() {
        loading = true; loadError = null;
        if (!document.getElementById('recruitListArea')) paint(); else paintList();
        try {
          tickets = await loadRecruitmentTickets('all');
          loading = false; paintList();
        } catch (e) {
          loading = false; loadError = e.message || 'Could not load applications.'; paintList();
        }
      }

      function isModalInteractionActive() {
        const active = document.activeElement;
        if (!active || active === document.body) return false;
        const ticketContainer = document.getElementById('ticketModalContainer');
        const nextPhaseContainer = document.getElementById('nextPhaseOverlayContainer');
        return !!((ticketContainer && ticketContainer.contains(active)) || (nextPhaseContainer && nextPhaseContainer.contains(active)));
      }

      async function refreshTicketsQuiet() {
        try {
          const fresh = await loadRecruitmentTickets('all');
          if (JSON.stringify(fresh) === JSON.stringify(tickets)) return;
          tickets = fresh;
          paintList();
        } catch (e) { }
      }

      if (!listPollTimer) {
        listPollTimer = setInterval(() => {
          if (renderGen !== myGen) { clearInterval(listPollTimer); return; }
          refreshTicketsQuiet();
        }, 5000);
      }
      document.addEventListener('visibilitychange', () => {
        if (renderGen !== myGen) return;
        if (document.visibilityState === 'visible') {
          refreshTicketsQuiet();
          if (openTicketId) {
            loadRecruitmentTicket(openTicketId).then(d => { ticketDetail = d; paintModal(); }).catch(() => { });
          }
        }
      });

      async function openTicket(id) {
        openTicketId = id; ticketDetail = null; ticketDetailLoading = true;
        nextPhaseModalOpen = false; nextPhaseError = null; nextPhaseSelectedSkillsetId = ''; allSetModalOpen = false;
        manualRolingBusy = false; manualRolingMsg = null;
        signOffBusy = false; signOffMsg = null;
        placeTeamSelectedId = ''; placeTeamBusy = false; placeTeamError = null;
        paintModal(); paintNextPhaseOverlay();
        try {
          ticketDetail = await loadRecruitmentTicket(id);
        } catch (e) { }
        ticketDetailLoading = false; paintModal();
        if (ticketPollTimer) clearInterval(ticketPollTimer);
        ticketPollTimer = setInterval(async () => {
          if (renderGen !== myGen || openTicketId !== id) { clearInterval(ticketPollTimer); return; }
          if (isModalInteractionActive()) return;
          try {
            const fresh = await loadRecruitmentTicket(id);
            if (JSON.stringify(fresh) !== JSON.stringify(ticketDetail)) {
              ticketDetail = fresh;
              paintModal();
            }
          } catch (e) { }
        }, 4000);
      }


      const RECRUIT_STEPS = [['pending', 'Applied'], ['in_review', 'In review'], ['accepted', 'Accepted'], ['team_selection', 'Team'], ['signed_off', 'Signed off'], ['finalised', 'Finalised']];

      function groupChipsHtml() {
        const base = tickets.filter(matchesRecruitSearch);
        return RECRUIT_GROUPS.filter(g => g.id !== 'mine' || tickets.some(t => inGroup(t, g))).map(g => {
          const n = base.filter(t => inGroup(t, g)).length;
          return `<button type="button" class="chip-filter ${group === g.id ? 'on' : ''}" data-recruit-group="${g.id}" aria-pressed="${group === g.id}">${esc(g.label)} <b>${n}</b></button>`;
        }).join('');
      }

      function listHtml() {
        if (loading && !tickets.length) return `<div class="dash-loading">Loading applications...</div>`;
        if (loadError) return `<div class="dash-empty"><h3>Could not load applications</h3><p>${esc(loadError)}</p><button type="button" class="btn btn-ghost btn-sm" id="recruitRetryBtn">Try again</button></div>`;
        const rows = visibleTickets();
        if (!rows.length) {
          const emptyText = rSearch.trim() ? `No applications match "${esc(rSearch.trim())}" here.`
            : group === 'review' ? 'Nothing waiting for review. New applications show up here automatically.'
              : 'No applications in this list.';
          return `<div class="dash-empty"><h3>All clear</h3><p>${emptyText}</p></div>`;
        }
        return `<div class="table-scroll"><table class="req-table recruit-table">
          <thead><tr><th>Applicant</th><th>Position</th><th>Status</th><th>Assigned to</th><th>Submitted</th></tr></thead>
          <tbody>
            ${rows.map(t => {
          const assignee = recruiters.find(r => String(r.robloxUserId) === String(t.assigned_to_user_id));
          return `
            <tr data-open-ticket="${esc(t.id)}" tabindex="0" role="button" aria-label="Open application from ${esc(t.roblox_username)}">
              <td class="name-cell"><strong>${esc(t.roblox_username)}</strong><span>${esc(t.discord_username || '')}${t.referred_by_username ? ` &middot; referred by ${esc(t.referred_by_username)}` : ''}</span></td>
              <td>${esc(t.position || 'Not specified')}</td>
              <td>${recruitmentStatusChip(t.status)}</td>
              <td>${t.assigned_to_user_id ? (String(t.assigned_to_user_id) === String(hrUserId) ? '<strong>You</strong>' : esc(assignee ? assignee.robloxUsername : 'Another recruiter')) : '<span class="hint">Nobody</span>'}</td>
              <td title="${esc(new Date(t.created_at).toLocaleString())}" style="color:var(--ink-soft);white-space:nowrap;">${esc(relTime(t.created_at))}</td>
            </tr>`;
        }).join('')}
          </tbody>
        </table></div>`;
      }

      function paintList() {
        if (renderGen !== myGen) return;
        const area = document.getElementById('recruitListArea');
        const chips = document.getElementById('recruitChips');
        if (!area) { paint(); return; }
        const sc = area.querySelector('.table-scroll');
        const left = sc ? sc.scrollLeft : 0;
        area.innerHTML = listHtml();
        const sc2 = area.querySelector('.table-scroll'); if (sc2) sc2.scrollLeft = left;
        if (chips) chips.innerHTML = groupChipsHtml();
        wireList();
      }

      function wireList() {
        document.querySelectorAll('[data-recruit-group]').forEach(el => el.addEventListener('click', () => { group = el.dataset.recruitGroup; paintList(); }));
        document.querySelectorAll('[data-open-ticket]').forEach(el => {
          el.addEventListener('click', () => openTicket(el.dataset.openTicket));
          el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTicket(el.dataset.openTicket); } });
        });
        const retry = document.getElementById('recruitRetryBtn');
        if (retry) retry.addEventListener('click', load);
      }

      function paint() {
        if (renderGen !== myGen) return;
        app.innerHTML = `
    ${topbar()}
    <div class="dash-shell">
      <div class="dash-head">
        <div>
          <h1 style="margin-bottom:4px;">Applications</h1>
          <p class="sub">Review applications and move people through hiring. Chat with applicants in their Discord ticket channel.</p>
        </div>
        <div class="dash-toolbar">
          <button type="button" class="btn btn-ghost btn-sm" id="recruitRefreshBtn">Refresh</button>
          ${canSeeAnalytics ? `<a class="btn btn-ghost btn-sm" href="#/recruitment-analytics">Analytics</a>` : ''}
          ${hasPermission('settings.manage_onboarding') ? `<a class="btn btn-ghost btn-sm" href="#/manage?tab=recruitment">Recruitment settings</a>` : ''}
        </div>
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;align-items:center;">
        <div class="search-input-wrap">
          <input type="text" id="recruitSearchInput" placeholder="Search applicant, Discord, position or referrer" value="${esc(rSearch)}" aria-label="Search applications">
        </div>
      </div>
      <div class="chip-filters" id="recruitChips" style="margin-bottom:16px;">${groupChipsHtml()}</div>
      <div class="table-wrap" id="recruitListArea">${listHtml()}</div>
    </div>
    <div id="ticketModalContainer">${openTicketId ? renderTicketModal() : ''}</div>
    <div id="nextPhaseOverlayContainer"></div>`;

        wireTopbarSignOut();
        const refreshBtn = document.getElementById('recruitRefreshBtn');
        if (refreshBtn) refreshBtn.addEventListener('click', load);
        const si = document.getElementById('recruitSearchInput');
        if (si) si.addEventListener('input', debounce(() => { rSearch = si.value; paintList(); }, 120));
        wireList();
        wireTicketModal();
        paintNextPhaseOverlay();
      }

      function paintModal() {
        if (renderGen !== myGen) return;
        const container = document.getElementById('ticketModalContainer');
        if (!container) { paint(); return; }
        container.innerHTML = openTicketId ? renderTicketModal() : '';
        wireTicketModal();
      }

      function paintNextPhaseOverlay() {
        if (renderGen !== myGen) return;
        const container = document.getElementById('nextPhaseOverlayContainer');
        if (!container) return;
        const t = ticketDetail ? ticketDetail.ticket : null;
        container.innerHTML = (nextPhaseModalOpen && t) ? renderNextPhaseModal(t) : (allSetModalOpen ? renderAllSetModal() : '');
        wireNextPhaseModal();
        wireAllSetModal();
      }

      function renderTicketModal() {
        if (ticketDetailLoading || !ticketDetail) {
          return `<div class="modal-scrim" id="ticketModalScrim"><div class="modal-card"><button type="button" class="modal-close" id="ticketModalClose">&times;</button><div class="modal-body" style="text-align:center;padding:40px;color:var(--muted);">Loading...</div></div></div>`;
        }
        const t = ticketDetail.ticket;
        const discordChannelUrl = ticketDetail.discordChannelUrl;
        return `
    <div class="modal-scrim" id="ticketModalScrim">
      <div class="modal-card" style="max-width:640px;">
        <button type="button" class="modal-close" id="ticketModalClose">&times;</button>
        <div class="modal-header">
          <h3 style="margin:0;">${esc(t.roblox_username)}</h3>
          <div class="modal-id">${esc(t.discord_username)} &middot; Roblox ID ${esc(t.roblox_user_id)} &middot; applied ${esc(relTime(t.created_at))}</div>
          ${['rejected', 'withdrawn'].includes(t.status) ? `<div style="margin-top:10px;">${recruitmentStatusChip(t.status)}</div>` : (() => {
            const idx = RECRUIT_STEPS.findIndex(s => s[0] === t.status);
            return `<ol class="recruit-steps" aria-label="Hiring progress">${RECRUIT_STEPS.map((st, i) => `<li class="${i < idx ? 'done' : i === idx ? 'now' : ''}" ${i === idx ? 'aria-current="step"' : ''}>${st[1]}</li>`).join('')}</ol>`;
          })()}
        </div>
        <div class="modal-body">
          <div class="modal-section">
            <div class="modal-section-title">Application</div>
            ${t.position ? `<div class="modal-info-row"><span class="label">Position</span><span class="value">${esc(t.position)}</span></div>` : ''}
            ${t.portfolio_url ? (() => { const pu = safeUrl(t.portfolio_url); return `<div class="modal-info-row"><strong>Portfolio:</strong> ${pu ? `<a href="${esc(pu)}" target="_blank" rel="noopener noreferrer nofollow">${esc(t.portfolio_url)}</a>` : `${esc(t.portfolio_url)} <span style="color:var(--danger,#e55);font-size:12px;">(unsafe link removed)</span>`}</div>`; })() : ''}
            <div class="modal-info-row"><span class="label">Referred by</span><span class="value">${esc(t.referred_by_username || 'No one')}</span></div>
            <div class="ticket-answer"><h4>Experience</h4><p>${esc(t.experience || 'Not answered')}</p></div>
            <div class="ticket-answer"><h4>Why they want to join</h4><p>${esc(t.why_join || 'Not answered')}</p></div>
          </div>

          ${canManage ? `
          <div class="modal-section">
            <div class="modal-section-title">Next step</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              ${t.status !== 'in_review' ? `<button type="button" class="btn btn-ghost btn-sm" data-set-status="in_review" ${busy ? 'disabled' : ''}>Mark in review</button>` : ''}
              ${t.status !== 'accepted' && t.status !== 'team_selection' && t.status !== 'signed_off' && t.status !== 'finalised' ? `<button type="button" class="btn btn-ok btn-sm" data-set-status="accepted" ${busy ? 'disabled' : ''}>Accept &amp; hire</button>` : ''}
              ${t.status !== 'rejected' ? `<button type="button" class="btn btn-danger btn-sm" data-set-status="rejected" style="background:var(--err-bg);color:var(--err-text);border:1px solid var(--err-line);" ${busy ? 'disabled' : ''}>Reject</button>` : ''}
              ${t.status !== 'withdrawn' ? `<button type="button" class="btn btn-ghost btn-sm" data-set-status="withdrawn" ${busy ? 'disabled' : ''}>Mark withdrawn</button>` : ''}
            </div>
            ${t.status === 'accepted' ? `
            <div style="margin-top:12px;padding:12px;border-radius:10px;background:var(--accent-soft);border:1px solid var(--accent-soft-strong);">
              <div style="font-size:13px;color:var(--ink);margin-bottom:8px;">Ready to move them into team selection? Pick a skillset and we'll notify the leads.</div>
              <button type="button" class="btn btn-primary btn-sm" id="nextPhaseBtn">Move to team selection</button>
            </div>` : ''}
            ${t.status === 'team_selection' && !t.placed_team_id ? `
            <div style="margin-top:12px;padding:12px;border-radius:10px;background:var(--accent-soft);border:1px solid var(--accent-soft-strong);font-size:13px;">
              <div style="margin-bottom:8px;">In team selection${t.skillset_name ? ` as <strong>${esc(t.skillset_name)}</strong>` : ''}. Leads were notified on Discord${t.next_phase_by_username ? ` by ${esc(t.next_phase_by_username)}` : ''} - or place them on a team here:</div>
              ${placeTeamError ? `<div class="error-box" style="margin-bottom:8px;"><span>${esc(placeTeamError)}</span></div>` : ''}
              <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                <select id="placeTeamSelect" ${placeTeamBusy ? 'disabled' : ''}>
                  <option value="">${placeTeamOptions.length ? 'Choose a team...' : 'Loading teams...'}</option>
                  ${placeTeamOptions.map(team => `<option value="${esc(team.id)}" ${String(placeTeamSelectedId) === String(team.id) ? 'selected' : ''}>${esc(team.name)}</option>`).join('')}
                </select>
                <button type="button" class="btn btn-primary btn-sm" id="placeTeamBtn" ${placeTeamBusy ? 'disabled' : ''}>${placeTeamBusy ? 'Placing...' : 'Place on team'}</button>
              </div>
            </div>` : ''}
            ${t.placed_team_id && t.status === 'team_selection' ? `
            <div style="margin-top:12px;padding:12px;border-radius:10px;background:var(--ok-bg);border:1px solid var(--ok-line);font-size:13px;">
              <div style="margin-bottom:8px;">Placed on <strong>${esc(t.placed_team_name)}</strong>${t.skillset_name ? ` as <strong>${esc(t.skillset_name)}</strong>` : ''}. Sign off once this is ready for a producer to finalise.</div>
              ${canSignOffTicket() ? `
              <button type="button" class="btn btn-primary btn-sm" id="signOffBtn" ${signOffBusy ? 'disabled' : ''}>${signOffBusy ? 'Signing off...' : 'Sign off'}</button>
              ` : `
              <button type="button" class="btn btn-primary btn-sm" disabled title="Only ${esc(approvalRoleNames.signoffRoleName || 'a recruiter/senior developer')} can sign this off">Sign off</button>
              <div style="margin-top:6px;color:var(--muted);font-size:12px;">${esc(approvalRoleNames.signoffRoleName || 'A recruiter/senior developer')} has to sign this off.</div>
              `}
              ${signOffMsg ? `<div style="margin-top:8px;font-weight:600;color:${signOffMsg.ok ? 'var(--ok-text)' : 'var(--err-text)'};">${esc(signOffMsg.text)}</div>` : ''}
            </div>` : ''}
            ${t.placed_team_id && t.status === 'signed_off' ? `
            <div style="margin-top:12px;padding:12px;border-radius:10px;background:var(--ok-bg);border:1px solid var(--ok-line);font-size:13px;">
              <div style="margin-bottom:8px;">Placed on <strong>${esc(t.placed_team_name)}</strong>${t.skillset_name ? ` as <strong>${esc(t.skillset_name)}</strong>` : ''}. Signed off by ${esc(t.signed_off_by_username || 'a recruiter')}. A producer for this team can finalise and grant access below.</div>
              ${canFinaliseTicket() ? `
              <button type="button" class="btn btn-primary btn-sm" id="manualRolingBtn" ${manualRolingBusy ? 'disabled' : ''}>${manualRolingBusy ? 'Finalising...' : 'Finalise'}</button>
              ` : `
              <button type="button" class="btn btn-primary btn-sm" disabled title="Only ${esc(approvalRoleNames.producerRoleName || 'a producer')} can finalise this">Finalise</button>
              <div style="margin-top:6px;color:var(--muted);font-size:12px;">${esc(approvalRoleNames.producerRoleName || 'A producer')} has to finalise this.</div>
              `}
              ${manualRolingMsg ? `<div style="margin-top:8px;font-weight:600;color:${manualRolingMsg.ok ? 'var(--ok-text)' : 'var(--err-text)'};">${esc(manualRolingMsg.text)}</div>` : ''}
            </div>` : ''}
            ${t.status === 'finalised' ? `
            <div style="margin-top:12px;padding:12px;border-radius:10px;background:var(--ok-bg);border:1px solid var(--ok-line);font-size:13px;">
              <div>Finalised - placed on <strong>${esc(t.placed_team_name)}</strong>${t.skillset_name ? ` as <strong>${esc(t.skillset_name)}</strong>` : ''} and roled. Their Discord ticket channel ${t.channel_deleted ? 'has been deleted.' : t.channel_delete_at ? `will be auto-deleted ${new Date(t.channel_delete_at).toLocaleString()}.` : 'will be auto-deleted 12 hours after finalising.'}</div>
            </div>` : ''}
            ${recruiters.length ? `
            <div style="margin-top:12px;">
              <label for="ticketAssignSelect" style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Assigned to</label>
              <select id="ticketAssignSelect">
                <option value="">Unassigned</option>
                ${recruiters.map(r => `<option value="${esc(r.robloxUserId)}" ${t.assigned_to_user_id === r.robloxUserId ? 'selected' : ''}>${esc(r.robloxUsername)}</option>`).join('')}
              </select>
            </div>` : ''}
          </div>` : ''}

          <div class="modal-section">
            <div class="modal-section-title">Talk to them</div>
            ${discordChannelUrl ? `
            <p style="color:var(--ink-soft);font-size:13px;margin-bottom:10px;">This applicant has a private ticket channel on Discord - chat with them there.</p>
            <a class="btn btn-primary btn-sm" href="${esc(discordChannelUrl)}" target="_blank" rel="noopener">Open Discord ticket channel</a>
            ` : `<p style="color:var(--ink-soft);font-size:13px;">No Discord ticket channel yet for this application - it may still be getting created, or the bot isn't configured.</p>`}
          </div>
        </div>
      </div>
    </div>`;
      }

      function renderNextPhaseModal(t) {
        return `
    <div class="modal-scrim" id="nextPhaseModalScrim" style="z-index:110;">
      <div class="modal-card" style="max-width:420px;">
        <button type="button" class="modal-close" id="nextPhaseModalClose">&times;</button>
        <div class="modal-body" style="padding-top:8px;">
          <h3 style="margin-top:0;">Move to team selection</h3>
          <p style="color:var(--ink-soft);font-size:13px;">Pick the skillset ${esc(t.roblox_username)} will join as. Leads will be notified on Discord to finish placing them into a team.</p>
          ${nextPhaseError ? `<div class="error-box"><span>${esc(nextPhaseError)}</span></div>` : ''}
          ${nextPhaseSkillsetsLoading ? `<div style="text-align:center;color:var(--muted);padding:16px 0;">Loading skillsets...</div>` : `
          <div class="field" style="text-align:left;">
            <label>Skillset</label>
            <select id="nextPhaseSkillsetSelect">
              <option value="">Choose one...</option>
              ${nextPhaseSkillsets.map(s => `<option value="${esc(s.id)}" ${String(nextPhaseSelectedSkillsetId) === String(s.id) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
            </select>
          </div>`}
          <div style="display:flex;gap:10px;justify-content:center;margin-top:16px;">
            <button type="button" class="btn btn-primary" id="nextPhaseConfirmBtn" ${nextPhaseBusy || nextPhaseSkillsetsLoading ? 'disabled' : ''}>${nextPhaseBusy ? 'Sending...' : 'Move to team selection'}</button>
            <button type="button" class="btn btn-ghost" id="nextPhaseCancelBtn">Cancel</button>
          </div>
        </div>
      </div>
    </div>`;
      }

      function renderAllSetModal() {
        return `
    <div class="modal-scrim" id="allSetModalScrim" style="z-index:120;">
      <div class="modal-card" style="max-width:380px;text-align:center;">
        <div class="modal-body" style="padding-top:12px;">
          <div style="width:56px;height:56px;border-radius:50%;background:var(--accent-soft);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="9"></circle>
              <polyline points="12 7 12 12 15.5 14"></polyline>
            </svg>
          </div>
          <h3 style="margin:0 0 8px;">You're all set for now.</h3>
          <p style="color:var(--ink-soft);font-size:13px;margin-bottom:18px;">Leads have been notified on Discord to finish placing them into a team.</p>
          <button type="button" class="btn btn-primary" id="allSetOkBtn">Got it</button>
        </div>
      </div>
    </div>`;
      }

      function wireTicketModal() {
        const scrim = document.getElementById('ticketModalScrim');
        if (!scrim) return;
        const close = () => { if (ticketPollTimer) clearInterval(ticketPollTimer); openTicketId = null; ticketDetail = null; nextPhaseModalOpen = false; allSetModalOpen = false; paint(); };
        document.getElementById('ticketModalClose').addEventListener('click', close);
        scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });

        document.querySelectorAll('[data-set-status]').forEach(el => {
          el.addEventListener('click', async () => {
            busy = true; paintModal();
            try {
              await updateRecruitmentStatus(openTicketId, el.dataset.setStatus);
              const [detail, freshTickets] = await Promise.all([
                loadRecruitmentTicket(openTicketId),
                loadRecruitmentTickets('all')
              ]);
              ticketDetail = detail;
              tickets = freshTickets;
            } catch (e) { }
            busy = false; paintModal();
          });
        });

        const assignSelect = document.getElementById('ticketAssignSelect');
        if (assignSelect) assignSelect.addEventListener('change', async () => {
          const val = assignSelect.value;
          const match = recruiters.find(r => String(r.robloxUserId) === val);
          try {
            await assignRecruitmentTicket(openTicketId, match ? match.robloxUserId : null, match ? match.robloxUsername : null);
            ticketDetail = await loadRecruitmentTicket(openTicketId);
          } catch (e) { }
          paintModal();
        });

        const nextPhaseBtn = document.getElementById('nextPhaseBtn');
        if (nextPhaseBtn) nextPhaseBtn.addEventListener('click', async () => {
          nextPhaseModalOpen = true; nextPhaseError = null; nextPhaseSelectedSkillsetId = '';
          nextPhaseSkillsetsLoading = true; paintNextPhaseOverlay();
          try {
            nextPhaseSkillsets = await loadSkillsetsForNextPhase();
          } catch (e) {
            nextPhaseError = 'Could not load skillsets.';
          }
          nextPhaseSkillsetsLoading = false; paintNextPhaseOverlay();
        });

        const placeTeamSelect = document.getElementById('placeTeamSelect');
        if (placeTeamSelect) placeTeamSelect.addEventListener('change', () => { placeTeamSelectedId = placeTeamSelect.value; });

        const placeTeamBtn = document.getElementById('placeTeamBtn');
        if (placeTeamBtn) placeTeamBtn.addEventListener('click', async () => {
          const teamId = (document.getElementById('placeTeamSelect') || {}).value || placeTeamSelectedId;
          if (!teamId) { placeTeamError = 'Please choose a team.'; paintModal(); return; }
          placeTeamBusy = true; placeTeamError = null; paintModal();
          try {
            await placeRecruitmentTicketTeam(openTicketId, teamId);
            const [detail, freshTickets] = await Promise.all([
              loadRecruitmentTicket(openTicketId),
              loadRecruitmentTickets('all')
            ]);
            ticketDetail = detail;
            tickets = freshTickets;
            placeTeamSelectedId = '';
          } catch (e) {
            placeTeamError = e.message || 'Could not place them on that team.';
          }
          placeTeamBusy = false; paintModal();
        });

        const manualRolingBtn = document.getElementById('manualRolingBtn');
        if (manualRolingBtn) manualRolingBtn.addEventListener('click', async () => {
          manualRolingBusy = true; manualRolingMsg = null; paintModal();
          try {
            const data = await manualRolingRecruitmentTicket(openTicketId);
            manualRolingMsg = { ok: true, text: data && data.mode === 'inserted' ? 'Finalised - access granted just now.' : 'Already up to date - roled in.' };
            try { ticketDetail = await loadRecruitmentTicket(openTicketId); } catch (e) { }
          } catch (e) {
            manualRolingMsg = { ok: false, text: e.message || 'Could not finalise this recruit.' };
          }
          manualRolingBusy = false; paintModal();
        });

        const signOffBtn = document.getElementById('signOffBtn');
        if (signOffBtn) signOffBtn.addEventListener('click', async () => {
          signOffBusy = true; signOffMsg = null; paintModal();
          try {
            const data = await signOffRecruitmentTicket(openTicketId);
            signOffMsg = { ok: true, text: data && data.producersNotified ? `Signed off - notified ${data.producersNotified} producer(s).` : 'Signed off.' };
            try { ticketDetail = await loadRecruitmentTicket(openTicketId); } catch (e) { }
          } catch (e) {
            signOffMsg = { ok: false, text: e.message || 'Could not sign this off.' };
          }
          signOffBusy = false; paintModal();
        });
      }

      function wireNextPhaseModal() {
        const scrim = document.getElementById('nextPhaseModalScrim');
        if (!scrim) return;
        const close = () => { nextPhaseModalOpen = false; nextPhaseError = null; paintNextPhaseOverlay(); };
        document.getElementById('nextPhaseModalClose').addEventListener('click', close);
        document.getElementById('nextPhaseCancelBtn').addEventListener('click', close);
        scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });

        const select = document.getElementById('nextPhaseSkillsetSelect');
        if (select) select.addEventListener('change', () => { nextPhaseSelectedSkillsetId = select.value; });

        const confirmBtn = document.getElementById('nextPhaseConfirmBtn');
        if (confirmBtn) confirmBtn.addEventListener('click', async () => {
          const skillsetId = (document.getElementById('nextPhaseSkillsetSelect') || {}).value || nextPhaseSelectedSkillsetId;
          if (!skillsetId) { nextPhaseError = 'Please choose a skillset.'; paintNextPhaseOverlay(); return; }
          nextPhaseBusy = true; nextPhaseError = null; paintNextPhaseOverlay();
          try {
            await nextPhaseRecruitmentTicket(openTicketId, skillsetId);
            const [detail, freshTickets] = await Promise.all([
              loadRecruitmentTicket(openTicketId),
              loadRecruitmentTickets('all')
            ]);
            ticketDetail = detail;
            tickets = freshTickets;
            nextPhaseModalOpen = false;
            nextPhaseBusy = false;
            allSetModalOpen = true;
            paint();
            return;
          } catch (e) {
            nextPhaseError = e.message || 'Could not move this application to team selection.';
          }
          nextPhaseBusy = false; paintNextPhaseOverlay();
        });
      }

      function wireAllSetModal() {
        const scrim = document.getElementById('allSetModalScrim');
        if (!scrim) return;
        const close = () => { allSetModalOpen = false; paintNextPhaseOverlay(); };
        document.getElementById('allSetOkBtn').addEventListener('click', close);
        scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
      }
    }

    function renderRecruitmentAnalytics() {
      const myGen = renderGen;
      let data = null;
      let loading = true;
      let loadError = null;

      loadRecruitmentAnalytics().then(d => {
        if (renderGen !== myGen) return;
        data = d; loading = false; paint();
      }).catch(e => {
        if (renderGen !== myGen) return;
        loadError = e.message || 'Could not load analytics.'; loading = false; paint();
      });

      paint();

      function paint() {
        app.innerHTML = `
    ${topbar()}
    <div class="dash-shell">
      <div class="dash-head">
        <div>
          <h1 style="margin-bottom:4px;">Analytics</h1>
          <p class="sub">How the recruitment pipeline is performing.</p>
        </div>
        <div class="dash-toolbar"><a class="btn btn-ghost btn-sm" href="#/recruitment">Back to applications</a></div>
      </div>

      ${loading ? `<div class="panel" style="padding:40px;text-align:center;color:var(--muted);">Loading...</div>`
            : loadError ? `<div class="dash-empty"><h3>Could not load analytics</h3><p>${esc(loadError)}</p></div>`
              : `
      <div class="stat-strip">
        <div class="strip-card"><div class="strip-label">Total applications</div><div class="strip-value">${data.totals.total}</div></div>
        <div class="strip-card"><div class="strip-label">Devs hired</div><div class="strip-value" style="color:var(--ok-text);">${data.totals.accepted}</div></div>
        <div class="strip-card"><div class="strip-label">Awaiting review</div><div class="strip-value">${data.totals.pending + data.totals.inReview}</div></div>
        <div class="strip-card"><div class="strip-label">Hire rate (of decided)</div><div class="strip-value">${data.conversionRate != null ? data.conversionRate + '%' : '-'}</div></div>
        <div class="strip-card"><div class="strip-label">Avg / median response</div><div class="strip-value">${data.avgResponseMinutes != null ? data.avgResponseMinutes + 'm' : '-'}${data.medianResponseMinutes != null ? ` <span style="font-size:13px;color:var(--muted);font-weight:500;">/ ${data.medianResponseMinutes}m</span>` : ''}</div></div>
        <div class="strip-card">
          <div class="strip-label">This week vs last</div>
          <div class="strip-value" style="display:flex;align-items:baseline;gap:6px;">
            ${data.last7}
            <span style="font-size:13px;font-weight:600;color:${data.weekOverWeekChangePct > 0 ? 'var(--ok-text)' : data.weekOverWeekChangePct < 0 ? 'var(--err-text)' : 'var(--muted)'};">
              ${data.weekOverWeekChangePct > 0 ? '↑' : data.weekOverWeekChangePct < 0 ? '↓' : ''}${Math.abs(data.weekOverWeekChangePct)}%
            </span>
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1.3fr 1fr;gap:20px;margin-top:20px;align-items:start;">
        <div class="panel" style="padding:20px;">
          <div class="preview-label" style="margin-bottom:10px;">Applications over time</div>
          <canvas id="recruitTimelineChart" height="140"></canvas>
        </div>
        <div class="panel" style="padding:20px;">
          <div class="preview-label" style="margin-bottom:10px;">Status breakdown</div>
          <canvas id="recruitStatusChart" height="140"></canvas>
        </div>
      </div>

      <div class="panel" style="padding:20px;margin-top:20px;">
        <div class="preview-label" style="margin-bottom:14px;">Pipeline funnel</div>
        <div style="display:flex;align-items:stretch;gap:2px;">
          ${(() => {
                const stages = [
                  { label: 'Submitted', value: data.totals.total, color: '#8A93A3' },
                  { label: 'In review', value: data.totals.inReview + data.totals.accepted + data.totals.rejected + data.totals.withdrawn - data.totals.withdrawn, color: '#7C76E8' },
                  { label: 'Accepted', value: data.totals.accepted, color: '#178A4C' }
                ];
                const max = Math.max(1, stages[0].value);
                return stages.map(s => `
              <div style="flex:1;text-align:center;">
                <div style="height:90px;display:flex;align-items:flex-end;justify-content:center;">
                  <div style="width:60%;min-height:4px;height:${Math.max(4, Math.round((s.value / max) * 90))}px;background:${s.color};border-radius:6px 6px 0 0;"></div>
                </div>
                <div style="font-weight:700;font-size:18px;margin-top:6px;">${s.value}</div>
                <div style="font-size:12px;color:var(--muted);">${s.label}</div>
              </div>`).join('');
              })()}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:20px;">
        <div class="panel" style="padding:0;overflow:hidden;">
          <div class="preview-label" style="padding:16px 16px 0;">Staff response leaderboard</div>
          <table style="width:100%;border-collapse:collapse;margin-top:10px;">
            <thead><tr style="text-align:left;border-bottom:1px solid var(--line);">
              <th style="padding:10px 16px;font-size:12px;color:var(--muted);">Staff</th>
              <th style="padding:10px 16px;font-size:12px;color:var(--muted);">Responded</th>
              <th style="padding:10px 16px;font-size:12px;color:var(--muted);">Hired</th>
              <th style="padding:10px 16px;font-size:12px;color:var(--muted);">Avg response</th>
            </tr></thead>
            <tbody>
              ${data.staffLeaderboard.length ? data.staffLeaderboard.map(s => `
                <tr style="border-bottom:1px solid var(--line);">
                  <td style="padding:10px 16px;">${esc(s.username)}</td>
                  <td style="padding:10px 16px;">${s.responded}</td>
                  <td style="padding:10px 16px;color:var(--ok-text);">${s.accepted}</td>
                  <td style="padding:10px 16px;">${s.avgResponseMinutes != null ? s.avgResponseMinutes + 'm' : '-'}</td>
                </tr>`).join('') : `<tr><td style="padding:16px;color:var(--muted);" colspan="4">No responses yet.</td></tr>`}
            </tbody>
          </table>
        </div>
        <div class="panel" style="padding:0;overflow:hidden;">
          <div class="preview-label" style="padding:16px 16px 0;">Top referrers</div>
          <table style="width:100%;border-collapse:collapse;margin-top:10px;">
            <thead><tr style="text-align:left;border-bottom:1px solid var(--line);">
              <th style="padding:10px 16px;font-size:12px;color:var(--muted);">Staff</th>
              <th style="padding:10px 16px;font-size:12px;color:var(--muted);">Referrals</th>
              <th style="padding:10px 16px;font-size:12px;color:var(--muted);">Hired</th>
            </tr></thead>
            <tbody>
              ${data.referrerLeaderboard.length ? data.referrerLeaderboard.map(r => `
                <tr style="border-bottom:1px solid var(--line);">
                  <td style="padding:10px 16px;">${esc(r.username)}</td>
                  <td style="padding:10px 16px;">${r.count}</td>
                  <td style="padding:10px 16px;color:var(--ok-text);">${r.hired}</td>
                </tr>`).join('') : `<tr><td style="padding:16px;color:var(--muted);" colspan="3">No referrals recorded yet.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel" style="padding:0;overflow:hidden;margin-top:20px;">
        <div class="preview-label" style="padding:16px 16px 0;">Applications by position</div>
        <table style="width:100%;border-collapse:collapse;margin-top:10px;">
          <thead><tr style="text-align:left;border-bottom:1px solid var(--line);">
            <th style="padding:10px 16px;font-size:12px;color:var(--muted);">Position</th>
            <th style="padding:10px 16px;font-size:12px;color:var(--muted);">Applications</th>
            <th style="padding:10px 16px;font-size:12px;color:var(--muted);">Hired</th>
            <th style="padding:10px 16px;font-size:12px;color:var(--muted);">Hire rate</th>
          </tr></thead>
          <tbody>
            ${data.positionBreakdown.length ? data.positionBreakdown.map(p => `
              <tr style="border-bottom:1px solid var(--line);">
                <td style="padding:10px 16px;">${esc(p.position)}</td>
                <td style="padding:10px 16px;">${p.applications}</td>
                <td style="padding:10px 16px;color:var(--ok-text);">${p.accepted}</td>
                <td style="padding:10px 16px;">${p.applications ? Math.round((p.accepted / p.applications) * 1000) / 10 + '%' : '-'}</td>
              </tr>`).join('') : `<tr><td style="padding:16px;color:var(--muted);" colspan="4">No applications yet.</td></tr>`}
          </tbody>
        </table>
      </div>`}
    </div>`;

        wireTopbarSignOut();
        if (!loading && !loadError && window.Chart) {
          const timelineEl = document.getElementById('recruitTimelineChart');
          if (timelineEl) {
            new Chart(timelineEl, {
              type: 'line',
              data: {
                labels: data.timeline.map(p => p.date),
                datasets: [{ label: 'Applications', data: data.timeline.map(p => p.count), borderColor: '#3730D9', backgroundColor: 'rgba(55,48,217,0.12)', tension: 0.3, fill: true }]
              },
              options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
            });
          }
          const statusEl = document.getElementById('recruitStatusChart');
          if (statusEl) {
            new Chart(statusEl, {
              type: 'doughnut',
              data: {
                labels: ['Pending', 'In review', 'Accepted', 'Rejected', 'Withdrawn'],
                datasets: [{
                  data: [data.totals.pending, data.totals.inReview, data.totals.accepted, data.totals.rejected, data.totals.withdrawn],
                  backgroundColor: ['#F1C453', '#7C76E8', '#178A4C', '#B3311C', '#8A93A3']
                }]
              },
              options: { plugins: { legend: { position: 'bottom' } } }
            });
          }
        }
      }
    }

    function moneyUsd(n) {
      return '$' + (Number(n) || 0).toFixed(2);
    }

    function moneyRobux(n) {
      return 'R$ ' + Math.round(Number(n) || 0).toLocaleString();
    }

    function homeDue(dueAt) {
      if (!dueAt) return 'No due date';
      const diff = new Date(dueAt).getTime() - Date.now();
      const days = Math.round(diff / 86400000);
      if (diff < 0) return `<span class="late">${days === 0 ? 'Due today' : Math.abs(days) + (Math.abs(days) === 1 ? ' day late' : ' days late')}</span>`;
      if (days === 0) return 'Due today';
      if (days === 1) return 'Due tomorrow';
      return 'Due in ' + days + ' days';
    }

    function homeTaskMoney(t) {
      if (!t.payment) return '';
      return t.currency === 'USD' ? moneyUsd(t.payment) : moneyRobux(t.payment);
    }

    function statCard(label, value, sub, flag) {
      return `<div class="home-stat${flag ? ' flag' : ''}"><div class="k">${esc(label)}</div><div class="v">${value}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
    }

    function renderHome() {
      const myGen = renderGen;
      let data = null;
      let loading = true;
      let loadError = null;
      const busy = new Set();

      function taskRow(t, actions) {
        return `
          <div class="home-row">
            <div class="home-row-main">
              <div class="home-row-title"><a href="#/task/${esc(t.id)}">${esc(t.title)}</a></div>
              <div class="home-row-meta">
                <span>${t.submittedAt ? 'Submitted ' + esc(relTime(t.submittedAt)) : homeDue(t.dueAt)}</span>
                ${t.assignedTo ? `<span>${esc(t.assignedTo)}</span>` : ''}
                ${homeTaskMoney(t) ? `<span>${esc(homeTaskMoney(t))}</span>` : ''}
                ${t.status === 'review' && !t.submittedAt ? '<span>With your producer</span>' : ''}
              </div>
            </div>
            <div class="home-row-actions">${actions || ''}</div>
          </div>`;
      }

      function developerView() {
        const open = data.myTasks.filter(t => t.status !== 'review');
        const inReview = data.myTasks.filter(t => t.status === 'review');
        const sentBack = open.filter(t => t.reviewNote);
        return `
      ${data.owed.hasMethod ? '' : `<div class="home-stat flag" style="margin-bottom:12px;"><div class="k">Before you can be paid</div><div class="v" style="font-size:15px;">Add a payout method</div><div class="s"><a href="#/my?focus=payout">Open My payments</a> and save how you want to be paid.</div></div>`}
      <div class="home-stats">
        ${statCard('Owed to you', data.owed.usd > 0 || data.owed.robux <= 0 ? moneyUsd(data.owed.usd) : moneyRobux(data.owed.robux), data.owed.usd > 0 && data.owed.robux > 0 ? 'plus ' + moneyRobux(data.owed.robux) : (data.openRun ? 'Next run: ' + esc(data.openRun.label) : 'No run open yet'))}
        ${statCard('Open tasks', open.length, open.length ? 'Oldest first below' : 'Nothing assigned')}
        ${statCard('Waiting on review', inReview.length, inReview.length ? 'Your producer has these' : 'Nothing submitted')}
        ${statCard('Requests pending', data.owed.awaitingDecision, data.owed.awaitingDecision ? 'Not decided yet' : 'All decided')}
      </div>
      <div class="home-grid">
        <div class="home-card">
          <div class="home-card-head"><h2>Your work</h2><span class="count">${open.length} open</span></div>
          ${sentBack.length ? `<div class="home-note">${sentBack.length === 1 ? 'One task came back' : sentBack.length + ' tasks came back'} with notes. Open it to see what to change.</div>` : ''}
          ${open.length ? open.map(t => taskRow(t, `<button type="button" class="btn btn-ok btn-sm" data-home-submit="${esc(t.id)}">Mark done</button>`)).join('') : '<div class="home-empty">Nothing assigned to you right now.</div>'}
        </div>
        <div class="home-card">
          <div class="home-card-head"><h2>With your producer</h2><span class="count">${inReview.length}</span></div>
          ${inReview.length ? inReview.map(t => taskRow(t, '')).join('') : '<div class="home-empty">Nothing waiting on review.</div>'}
          ${data.producer ? `<div class="home-row"><div class="home-row-main"><div class="home-row-title">Your producer</div><div class="home-row-meta"><span>${userLink(data.producer.robloxUserId, data.producer.robloxUsername)}</span></div></div></div>` : ''}
        </div>
      </div>`;
      }

      function producerView() {
        const games = data.games || [];
        return `
      <div class="home-stats">
        ${statCard('Waiting on you', data.reviewQueue.length, data.reviewQueue.length ? 'Review these first' : 'Nothing to review', data.reviewQueue.length > 0)}
        ${statCard('Overdue', data.overdue.length, data.overdue.length ? 'Across your teams' : 'Nothing late', data.overdue.length > 0)}
        ${statCard('Nobody assigned', data.idleMembers.length, data.idleMembers.length ? 'People with no open task' : 'Everyone has work')}
        ${statCard('Your games', games.length, data.openRun ? 'Run: ' + esc(data.openRun.label) : 'No run open')}
      </div>
      <div class="home-grid">
        <div class="home-card">
          <div class="home-card-head"><h2>Waiting on your review</h2><span class="count">${data.reviewQueue.length}</span></div>
          ${data.reviewQueue.length ? data.reviewQueue.map(t => taskRow(t, `<button type="button" class="btn btn-ok btn-sm" data-home-approve="${esc(t.id)}">Approve</button><button type="button" class="btn btn-ghost btn-sm" data-home-sendback="${esc(t.id)}">Send back</button>`)).join('') : '<div class="home-empty">Nothing is waiting on you.</div>'}
        </div>
        <div class="home-card">
          <div class="home-card-head"><h2>Running late</h2><span class="count">${data.overdue.length}</span></div>
          ${data.overdue.length ? data.overdue.slice(0, 8).map(t => taskRow(t, '')).join('') : '<div class="home-empty">Nothing is overdue.</div>'}
        </div>
      </div>
      <div class="home-grid single" style="margin-top:16px;">
        <div class="home-card">
          <div class="home-card-head"><h2>Your games</h2><span class="count">${games.length}</span></div>
          ${games.length ? `<div class="home-games">${games.map(gameCard).join('')}</div>` : '<div class="home-empty">No games assigned to you yet.</div>'}
        </div>
      </div>
      ${data.idleMembers.length ? `
      <div class="home-grid single" style="margin-top:16px;">
        <div class="home-card">
          <div class="home-card-head"><h2>Nobody assigned</h2><span class="count">${data.idleMembers.length}</span></div>
          ${data.idleMembers.map(m => `<div class="home-row"><div class="home-row-main"><div class="home-row-title">${userLink(m.robloxUserId, m.robloxUsername)}</div><div class="home-row-meta"><span>No open task</span></div></div></div>`).join('')}
        </div>
      </div>` : ''}`;
      }

      function gameCard(g) {
        const budget = g.budgetAmount;
        const spentUsd = g.spent.usd;
        const pct = budget > 0 ? Math.min(100, Math.round((spentUsd / budget) * 100)) : 0;
        const over = budget > 0 && spentUsd > budget;
        return `
          <div class="home-game">
            <div class="home-game-top">
              ${g.iconUrl ? `<img src="${esc(g.iconUrl)}" alt="">` : ''}
              <div style="min-width:0;">
                <div class="home-game-name">${esc(g.name)}</div>
                ${g.producerUsername ? `<div class="home-row-meta"><span>${esc(g.producerUsername)}</span></div>` : ''}
              </div>
            </div>
            ${budget > 0
            ? `<div class="home-meter"><span class="${over ? 'over' : ''}" style="width:${pct}%;"></span></div>
                 <div class="home-row-meta"><span>${esc(moneyUsd(spentUsd))} of ${esc(moneyUsd(budget))}</span>${over ? '<span class="late">over budget</span>' : ''}</div>`
            : `<div class="home-row-meta"><span>Spent ${esc(moneyUsd(spentUsd))}${g.spent.robux ? ' and ' + esc(moneyRobux(g.spent.robux)) : ''}</span><span>No budget set</span></div>`}
          </div>`;
      }

      function executiveView() {
        const s = data.studio || {};
        const runs = s.recentRuns || [];
        const openRun = data.openRun;
        return `
      <div class="home-stats">
        ${statCard('Staff requests', s.openClaims || 0, (s.openClaims || 0) ? 'Waiting for a decision' : 'None open', (s.openClaims || 0) > 0)}
        ${statCard('Work to review', s.reviewWaiting || 0, (s.reviewWaiting || 0) ? 'Across your teams' : 'Nothing waiting')}
        ${statCard('Owed in cash', moneyUsd(s.pendingUsd || 0), 'Approved, not paid')}
        ${statCard('Owed in Robux', moneyRobux(s.pendingRobux || 0), 'Approved, not paid')}
        ${statCard('People on teams', s.headcount || 0, 'With an assignment')}
      </div>
      <div class="home-grid">
        <div class="home-card">
          <div class="home-card-head"><h2>Payment runs</h2><a class="pp-linkbtn" href="#/runs">Open runs</a></div>
          ${openRun
            ? `<div class="home-row"><div class="home-row-main"><div class="home-row-title">${esc(openRun.label)}</div><div class="home-row-meta"><span>${esc(openRun.period_start)} to ${esc(openRun.period_end)}</span><span>Open, collecting approved work</span></div></div><div class="home-row-actions"><a class="btn btn-ghost btn-sm" href="#/runs">Manage</a></div></div>`
            : '<div class="home-note">No run is open, so approved work is not being collected anywhere. Open one from the runs page.</div>'}
          ${runs.filter(r => r.status !== 'open').slice(0, 4).map(r => `
            <div class="home-row">
              <div class="home-row-main">
                <div class="home-row-title">${esc(r.label)}</div>
                <div class="home-row-meta"><span>${esc(r.period_start)} to ${esc(r.period_end)}</span><span>${esc(r.status)}</span></div>
              </div>
            </div>`).join('')}
        </div>
        <div class="home-card">
          <div class="home-card-head"><h2>Waiting on your review</h2><span class="count">${data.reviewQueue.length}</span></div>
          ${data.reviewQueue.length ? data.reviewQueue.slice(0, 8).map(t => taskRow(t, `<button type="button" class="btn btn-ok btn-sm" data-home-approve="${esc(t.id)}">Approve</button><button type="button" class="btn btn-ghost btn-sm" data-home-sendback="${esc(t.id)}">Send back</button>`)).join('') : '<div class="home-empty">Nothing is waiting on you.</div>'}
        </div>
      </div>
      ${(data.games || []).length ? `
      <div class="home-grid single" style="margin-top:16px;">
        <div class="home-card">
          <div class="home-card-head"><h2>Games and spend</h2><span class="count">${data.games.length}</span></div>
          <div class="home-games">${data.games.map(gameCard).join('')}</div>
        </div>
      </div>` : ''}`;
      }

      function paint() {
        const hour = new Date().getHours();
        const part = hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
        const greeting = hrUsername ? `${part}, ${esc(String(hrUsername).split(' ')[0])}` : part;
        const roleLabel = data ? (data.view === 'executive' ? 'Studio' : data.view === 'producer' ? 'Producer' : 'Developer') : '';
        app.innerHTML = `
    ${topbar()}
    <div class="home-shell">
      <div class="home-head">
        <div>
          <h1>${greeting}${roleLabel ? `<span class="home-role">${esc(roleLabel)}</span>` : ''}</h1>
          <p class="sub" style="margin:0;">${data ? (data.view === 'developer' ? 'Your work and your pay, in one place.' : data.view === 'producer' ? 'What needs you today across your games and teams.' : 'How the studio is doing right now.') : 'Loading your day.'}</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="homeRefresh">Refresh</button>
      </div>
      ${needsDiscordLink ? `<div class="warn-box" style="flex-wrap:wrap;"><span><strong>Link your Discord account.</strong> ${parseHashQuery().get('discordLinkError') ? esc(DISCORD_LINK_ERROR_MESSAGES[parseHashQuery().get('discordLinkError')] || 'Could not link that Discord account. Try again.') : "It's required so we can reach you about your team and payments."}</span><a class="btn btn-primary btn-sm" href="${staffDiscordLinkHref('#/home')}">Link Discord</a></div>` : ''}
      ${loadError
            ? `<div class="error-box"><span>${esc(loadError)}</span></div>`
            : loading
              ? '<div class="home-stats">' + [0, 1, 2, 3].map(() => '<div class="home-stat"><div class="k">Loading</div><div class="v">&nbsp;</div></div>').join('') + '</div>'
              : data.view === 'developer' ? developerView() : data.view === 'producer' ? producerView() : executiveView()}
    </div>`;

        wireTopbarSignOut();
        const refresh = document.getElementById('homeRefresh');
        if (refresh) refresh.addEventListener('click', () => load());

        document.querySelectorAll('[data-home-submit]').forEach(el => el.addEventListener('click', async () => {
          const id = el.dataset.homeSubmit;
          if (busy.has(id)) return;
          busy.add(id);
          el.disabled = true;
          el.textContent = 'Sending...';
          try {
            await callHrData('submit_task_for_review', { id });
            toast('Sent to your producer to review');
            await load();
          } catch (e) {
            busy.delete(id);
            el.disabled = false;
            el.textContent = 'Mark done';
            toast(e.message || 'That did not go through.', 'err');
          }
        }));

        document.querySelectorAll('[data-home-approve]').forEach(el => el.addEventListener('click', async () => {
          const id = el.dataset.homeApprove;
          if (busy.has(id)) return;
          busy.add(id);
          el.disabled = true;
          el.textContent = 'Approving...';
          try {
            await callHrData('decide_task_review', { id, decision: 'approve' });
            toast('Approved and queued for payment');
            await load();
          } catch (e) {
            busy.delete(id);
            el.disabled = false;
            el.textContent = 'Approve';
            toast(e.message || 'That did not go through.', 'err');
          }
        }));

        document.querySelectorAll('[data-home-sendback]').forEach(el => el.addEventListener('click', async () => {
          const id = el.dataset.homeSendback;
          if (busy.has(id)) return;
          const note = await askForText({
            title: 'Send this back',
            hint: 'They see this, so say what needs changing.',
            placeholder: 'For example: the doors clip through the wall on the left side.',
            confirmLabel: 'Send it back',
            required: true,
            requiredMessage: 'Write what needs changing.'
          });
          if (note === null) return;
          busy.add(id);
          el.disabled = true;
          el.textContent = 'Sending...';
          try {
            await callHrData('decide_task_review', { id, decision: 'send_back', note });
            toast('Sent back with your notes');
            await load();
          } catch (e) {
            busy.delete(id);
            el.disabled = false;
            el.textContent = 'Send back';
            toast(e.message || 'That did not go through.', 'err');
          }
        }));
      }

      async function load() {
        loadError = null;
        if (!data) loading = true;
        paint();
        try {
          const json = await callHrData('get_home');
          const raw = json && json.data && typeof json.data === 'object' && !Array.isArray(json.data) ? json.data : null;
          if (!raw) {
            data = null;
            loadError = 'Could not read your home screen.';
          } else {
            data = {
              ...raw,
              view: raw.view === 'executive' || raw.view === 'producer' ? raw.view : 'developer',
              myTasks: Array.isArray(raw.myTasks) ? raw.myTasks : [],
              reviewQueue: Array.isArray(raw.reviewQueue) ? raw.reviewQueue : [],
              overdue: Array.isArray(raw.overdue) ? raw.overdue : [],
              idleMembers: Array.isArray(raw.idleMembers) ? raw.idleMembers : [],
              games: Array.isArray(raw.games) ? raw.games : [],
              owed: raw.owed && typeof raw.owed === 'object' ? raw.owed : { usd: 0, robux: 0, awaitingDecision: 0, hasMethod: true },
              studio: raw.studio && typeof raw.studio === 'object' ? raw.studio : {}
            };
          }
        } catch (e) {
          loadError = e.message || 'Could not load your home screen.';
        }
        if (myGen !== renderGen) return;
        busy.clear();
        loading = false;
        paint();
        maybeOfferTour();
      }

      load();
    }

    function runStatusLabel(status) {
      return { open: 'Open', frozen: 'Frozen', paying: 'Paying out', closed: 'Closed' }[status] || status;
    }

    function renderPaymentRuns() {
      const myGen = renderGen;
      let runs = [];
      let active = null;
      let sheet = null;
      let loading = true;
      let loadError = null;
      let selectedId = null;
      let creating = false;
      const canPay = hasPermission('dashboard.mark_paid');
      const busy = new Set();

      function defaultPeriod() {
        const now = new Date();
        const y = now.getUTCFullYear(), m = now.getUTCMonth();
        const firstHalf = now.getUTCDate() <= 14;
        const pad = n => String(n).padStart(2, '0');
        const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
        const start = firstHalf ? `${y}-${pad(m + 1)}-01` : `${y}-${pad(m + 1)}-15`;
        const end = firstHalf ? `${y}-${pad(m + 1)}-14` : `${y}-${pad(m + 1)}-${pad(lastDay)}`;
        const month = new Date(Date.UTC(y, m, 1)).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });
        return { label: `${month} ${firstHalf ? '1 to 14' : '15 to ' + lastDay}`, start, end };
      }

      function sheetRow(p) {
        const allPaid = p.lines.length > 0 && p.paidLines === p.lines.length;
        const methodLabel = p.method ? methodDisplayLabel(p.method) : 'No payout method set';
        const key = p.robloxUserId != null ? 'id:' + p.robloxUserId : 'name:' + p.robloxUsername;
        return `
          <div class="home-row">
            <div class="home-row-main">
              <div class="home-row-title">${userLink(p.robloxUserId, p.robloxUsername)}</div>
              <div class="home-row-meta">
                <span>${p.usd > 0 ? esc(moneyUsd(p.usd)) : ''}${p.usd > 0 && p.robux > 0 ? ' plus ' : ''}${p.robux > 0 ? esc(moneyRobux(p.robux)) : ''}${!p.usd && !p.robux ? 'Nothing owed' : ''}</span>
                <span>${p.lines.length} ${p.lines.length === 1 ? 'item' : 'items'}</span>
                <span${p.method ? '' : ' class="late"'}>${esc(methodLabel)}</span>
              </div>
            </div>
            <div class="home-row-actions">
              ${allPaid
            ? '<span class="pp-tag">Paid</span>'
            : canPay && active && active.status !== 'open' && active.status !== 'closed'
              ? `<button type="button" class="btn btn-ok btn-sm" data-run-pay="${esc(key)}"${frozenAttrs()}>Mark paid</button>`
              : ''}
            </div>
          </div>`;
      }

      function paint() {
        app.innerHTML = `
    ${topbar()}
    <div class="home-shell">
      <div class="home-head">
        <div>
          <h1>Payment runs</h1>
          <p class="sub" style="margin:0;">Approved work collects in the open run. Freeze it on the cut-off, pay it out, then close it.</p>
        </div>
        ${canPay && !runs.some(r => r.status === 'open') ? '<button type="button" class="btn btn-primary btn-sm" id="runNewBtn">Open a run</button>' : ''}
      </div>
      ${loadError ? `<div class="error-box"><span>${esc(loadError)}</span></div>` : ''}
      ${creating ? (() => {
            const d = defaultPeriod();
            return `
      <div class="home-card" style="margin-bottom:16px;">
        <div class="home-card-head"><h2>Open a new run</h2></div>
        <div style="padding:14px 16px;display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;">
          <div class="field"><label for="runLabel">Name</label><input type="text" id="runLabel" value="${esc(d.label)}"></div>
          <div class="field"><label for="runStart">Covers from</label><input type="date" id="runStart" value="${esc(d.start)}"></div>
          <div class="field"><label for="runEnd">Covers to</label><input type="date" id="runEnd" value="${esc(d.end)}"></div>
          <div class="field"><label for="runPayDate">Pay date</label><input type="date" id="runPayDate" value=""></div>
        </div>
        <div style="padding:0 16px 14px;display:flex;gap:8px;">
          <button type="button" class="btn btn-primary btn-sm" id="runCreateBtn">Open it</button>
          <button type="button" class="btn btn-ghost btn-sm" id="runCancelBtn">Cancel</button>
        </div>
      </div>`;
          })() : ''}
      ${loading
            ? '<div class="home-empty">Loading runs...</div>'
            : !runs.length
              ? '<div class="home-card"><div class="home-empty">No runs yet. Open one and approved work will start collecting in it.</div></div>'
              : `
      <div class="home-grid">
        <div class="home-card">
          <div class="home-card-head"><h2>All runs</h2><span class="count">${runs.length}</span></div>
          ${runs.map(r => `
            <div class="home-row" style="${String(r.id) === String(selectedId) ? 'background:var(--row-alt);' : ''}">
              <div class="home-row-main">
                <div class="home-row-title">${esc(r.label)}</div>
                <div class="home-row-meta">
                  <span>${esc(r.period_start)} to ${esc(r.period_end)}</span>
                  <span>${esc(runStatusLabel(r.status))}</span>
                  <span>${r.totals.lines} ${r.totals.lines === 1 ? 'item' : 'items'}</span>
                  ${r.totals.lines ? `<span>${r.totals.paidLines} paid</span>` : ''}
                </div>
              </div>
              <div class="home-row-actions">
                <button type="button" class="btn btn-ghost btn-sm" data-run-open="${esc(r.id)}">${String(r.id) === String(selectedId) ? 'Showing' : 'Show'}</button>
              </div>
            </div>`).join('')}
        </div>
        <div class="home-card">
          ${!active
                ? '<div class="home-empty">Pick a run to see who gets paid what.</div>'
                : `
          <div class="home-card-head">
            <h2>${esc(active.label)}</h2>
            <span class="count">${esc(runStatusLabel(active.status))}</span>
          </div>
          <div class="home-note">
            ${active.status === 'open' ? 'Collecting approved work. Freeze it when the period ends and nothing more will go in.'
                  : active.status === 'frozen' ? 'Frozen. Pay each person, then close it.'
                    : active.status === 'paying' ? 'Part paid. Finish the rest, then close it.'
                      : 'Closed. This is the permanent record for the period.'}
          </div>
          ${sheet ? `
          <div class="home-stats" style="padding:14px 16px;margin:0;">
            ${statCard('People', sheet.totals.people, '')}
            ${statCard('Cash', moneyUsd(sheet.totals.usd), '')}
            ${statCard('Robux', moneyRobux(sheet.totals.robux), '')}
            ${statCard('Paid', sheet.totals.paidLines + ' of ' + sheet.totals.lines, '')}
          </div>
          ${sheet.sheet.length ? sheet.sheet.map(sheetRow).join('') : '<div class="home-empty">Nothing in this run yet.</div>'}` : '<div class="home-empty">Loading the payout sheet...</div>'}
          ${canPay ? `
          <div style="padding:14px 16px;display:flex;gap:8px;flex-wrap:wrap;border-top:1px solid var(--line);">
            ${active.status === 'open' ? `<button type="button" class="btn btn-primary btn-sm" id="runFreezeBtn"${frozenAttrs()}>Freeze this run</button>` : ''}
            ${active.status === 'frozen' || active.status === 'paying' ? `<button type="button" class="btn btn-ok btn-sm" id="runCloseBtn"${frozenAttrs()}>Close the run</button>` : ''}
            ${sheet && sheet.sheet.length ? '<button type="button" class="btn btn-ghost btn-sm" id="runCopyBtn">Copy payout sheet</button>' : ''}
          </div>` : ''}`}
        </div>
      </div>`}
    </div>`;

        wireTopbarSignOut();

        const newBtn = document.getElementById('runNewBtn');
        if (newBtn) newBtn.addEventListener('click', () => { creating = true; paint(); });
        const cancelBtn = document.getElementById('runCancelBtn');
        if (cancelBtn) cancelBtn.addEventListener('click', () => { creating = false; paint(); });

        const createBtn = document.getElementById('runCreateBtn');
        if (createBtn) createBtn.addEventListener('click', async () => {
          const label = (document.getElementById('runLabel') || {}).value || '';
          const periodStart = (document.getElementById('runStart') || {}).value || '';
          const periodEnd = (document.getElementById('runEnd') || {}).value || '';
          const payDate = (document.getElementById('runPayDate') || {}).value || null;
          if (!label.trim() || !periodStart || !periodEnd) { toast('Fill in the name and both dates.', 'err'); return; }
          createBtn.disabled = true;
          createBtn.textContent = 'Opening...';
          try {
            const json = await callHrData('create_payment_run', { label: label.trim(), periodStart, periodEnd, payDate });
            creating = false;
            selectedId = json.id;
            toast('Run opened');
            await load();
          } catch (e) {
            createBtn.disabled = false;
            createBtn.textContent = 'Open it';
            toast(e.message || 'Could not open that run.', 'err');
          }
        });

        document.querySelectorAll('[data-run-open]').forEach(el => el.addEventListener('click', () => {
          selectedId = el.dataset.runOpen;
          sheet = null;
          paint();
          loadSheet();
        }));

        const freezeBtn = document.getElementById('runFreezeBtn');
        if (freezeBtn) freezeBtn.addEventListener('click', async () => {
          freezeBtn.disabled = true;
          freezeBtn.textContent = 'Freezing...';
          try {
            const json = await callHrData('freeze_payment_run', { id: selectedId });
            toast(json.lines ? `Frozen with ${json.lines} ${json.lines === 1 ? 'item' : 'items'}` : 'Frozen, nothing was waiting');
            await load();
          } catch (e) {
            freezeBtn.disabled = false;
            freezeBtn.textContent = 'Freeze this run';
            toast(e.message || 'Could not freeze that run.', 'err');
          }
        });

        const closeBtn = document.getElementById('runCloseBtn');
        if (closeBtn) closeBtn.addEventListener('click', async () => {
          closeBtn.disabled = true;
          closeBtn.textContent = 'Closing...';
          try {
            await callHrData('close_payment_run', { id: selectedId });
            toast('Run closed');
            await load();
          } catch (e) {
            closeBtn.disabled = false;
            closeBtn.textContent = 'Close the run';
            toast(e.message || 'Could not close that run.', 'err');
          }
        });

        const copyBtn = document.getElementById('runCopyBtn');
        if (copyBtn && sheet) copyBtn.addEventListener('click', () => {
          const header = ['Name', 'Method', 'Cash USD', 'Robux', 'Items'].join('\t');
          const body = sheet.sheet.map(p => [
            p.robloxUsername || '',
            p.method ? methodDisplayLabel(p.method) : 'None set',
            p.usd ? p.usd.toFixed(2) : '',
            p.robux ? String(p.robux) : '',
            String(p.lines.length)
          ].join('\t')).join('\n');
          copyText(header + '\n' + body, copyBtn, 'Copied the sheet');
        });

        document.querySelectorAll('[data-run-pay]').forEach(el => el.addEventListener('click', async () => {
          const key = el.dataset.runPay;
          if (busy.has(key)) return;
          busy.add(key);
          el.disabled = true;
          el.textContent = 'Saving...';
          const payload = { id: selectedId };
          if (key.indexOf('id:') === 0) payload.robloxUserId = Number(key.slice(3));
          else payload.robloxUsername = key.slice(5);
          try {
            const json = await callHrData('mark_run_person_paid', payload);
            toast(json.count ? `Marked ${json.count} ${json.count === 1 ? 'item' : 'items'} paid` : 'Nothing left to pay');
            await load();
          } catch (e) {
            busy.delete(key);
            el.disabled = false;
            el.textContent = 'Mark paid';
            toast(e.message || 'That did not save.', 'err');
          }
        }));
      }

      async function loadSheet() {
        if (!selectedId) return;
        try {
          const json = await callHrData('get_payment_run', { id: selectedId });
          if (myGen !== renderGen) return;
          const payload = json.data;
          if (!payload || !payload.run || !Array.isArray(payload.sheet) || !payload.totals) {
            sheet = null;
            toast('That run came back in a shape we did not expect. Try refreshing.', 'err');
          } else {
            sheet = payload;
            active = payload.run;
          }
        } catch (e) {
          sheet = null;
          toast(e.message || 'Could not read that run.', 'err');
        }
        if (myGen === renderGen) paint();
      }

      async function load() {
        loadError = null;
        try {
          const json = await callHrData('list_payment_runs');
          runs = json.data || [];
          if (!selectedId || !runs.some(r => String(r.id) === String(selectedId))) {
            const open = runs.find(r => r.status === 'open');
            selectedId = open ? open.id : (runs[0] ? runs[0].id : null);
          }
          active = runs.find(r => String(r.id) === String(selectedId)) || null;
        } catch (e) {
          loadError = e.message || 'Could not load the runs.';
        }
        if (myGen !== renderGen) return;
        busy.clear();
        loading = false;
        paint();
        if (selectedId) await loadSheet();
      }

      load();
    }

    const SECURITY_LEVELS = [
      {
        id: 'normal', name: 'Normal', tone: '',
        blurb: 'Everything works the way it normally does.',
        points: ['Everyone signs in as usual', 'Payments and requests run normally', 'Bank details follow the usual permission']
      },
      {
        id: 'heightened', name: 'Heightened', tone: 'amber',
        blurb: 'The site stays open, but money stops moving until someone clears it.',
        points: ['No payouts can be marked paid', 'No new requests or approvals', 'Payout methods cannot be changed', 'Everything else keeps working']
      },
      {
        id: 'lockdown', name: 'Lockdown', tone: 'red',
        blurb: 'Only people who can manage security get in. Everyone else sees a notice.',
        points: ['Everyone else is locked out of the site', 'All money actions stop', 'You can sign every other device out', 'Use this if an account may be compromised']
      }
    ];

    function securityLevelName(level) {
      const found = SECURITY_LEVELS.find(l => l.id === level);
      return found ? found.name : level;
    }

    function renderSecurity() {
      const myGen = renderGen;
      let state = null;
      let events = [];
      let sessions = [];
      let holds = [];
      let posture = null;
      let loading = true;
      let loadError = null;
      let working = false;
      let tab = 'protocol';
      const canManage = hasPermission('security.manage');

      function eventRow(e) {
        return `
          <div class="sec-ev">
            <span class="sec-ev-dot ${esc(e.severity || 'info')}"></span>
            <div class="sec-ev-main">
              <div>${esc(e.detail || e.kind)}</div>
              <div class="home-row-meta">
                <span>${esc(e.actor_username || 'system')}</span>
                ${e.target_username && e.target_username !== e.actor_username ? `<span>about ${esc(e.target_username)}</span>` : ''}
                <span>${esc(String(e.kind).replace(/_/g, ' '))}</span>
              </div>
            </div>
            <span class="sec-ev-when">${esc(relTime(e.created_at))}</span>
          </div>`;
      }

      function sessionRow(sn) {
        return `
          <div class="home-row">
            <div class="home-row-main">
              <div class="home-row-title">${userLink(sn.robloxUserId, sn.robloxUsername)}${sn.isYou ? ' <span class="pp-tag">this device</span>' : ''}</div>
              <div class="home-row-meta">
                <span>${(sn.roles || []).join(', ') || 'No roles'}</span>
                <span>Last used ${esc(relTime(sn.lastSeenAt || sn.createdAt))}</span>
                ${sn.userAgent ? `<span>${esc(String(sn.userAgent).slice(0, 40))}</span>` : ''}
              </div>
            </div>
            <div class="home-row-actions">
              ${sn.isYou ? '' : `<button type="button" class="btn btn-ghost btn-sm" data-sec-revoke="${esc(sn.token)}">Sign out</button>`}
            </div>
          </div>`;
      }

      function paint() {
        const level = state ? state.level : 'normal';
        const def = SECURITY_LEVELS.find(l => l.id === level) || SECURITY_LEVELS[0];
        app.innerHTML = `
    ${topbar()}
    <div class="home-shell">
      <div class="home-head">
        <div>
          <h1>Security</h1>
          <p class="sub" style="margin:0;">The protocol decides what the whole site will let people do. Raise it the moment something looks wrong, drop it when you are sure.</p>
        </div>
      </div>

      ${loadError ? `<div class="error-box"><span>${esc(loadError)}</span></div>` : ''}

      ${level !== 'normal' ? `
      <div class="sec-banner ${def.tone === 'red' ? 'red' : ''}">
        <div>
          <strong>${esc(def.name)} is active</strong>
          <span>${state && state.note ? esc(state.note.replace(/[.!?]*$/, '')) + '.' : 'No reason was recorded.'}${state && state.setBy ? ` Set by ${esc(state.setBy)}${state.setAt ? ' ' + esc(relTime(state.setAt)) : ''}.` : ''}</span>
        </div>
      </div>` : ''}

      <div class="filter-bar">
        <div class="tabs">
          <button type="button" class="tab-btn ${tab === 'protocol' ? 'active' : ''}" data-sec-tab="protocol">Protocol</button>
          <button type="button" class="tab-btn ${tab === 'sessions' ? 'active' : ''}" data-sec-tab="sessions">Signed in (${sessions.length})</button>
          <button type="button" class="tab-btn ${tab === 'holds' ? 'active' : ''}" data-sec-tab="holds">Holds (${holds.length})</button>
          <button type="button" class="tab-btn ${tab === 'log' ? 'active' : ''}" data-sec-tab="log">Security log</button>
        </div>
      </div>

      ${loading ? '<div class="home-card"><div class="home-empty">Loading...</div></div>' : tab === 'protocol' ? `
      <div class="home-card">
        <div class="home-card-head"><h2>Protocol level</h2><span class="count">Now: ${esc(def.name)}</span></div>
        <div class="sec-level-grid">
          ${SECURITY_LEVELS.map(l => `
            <button type="button" class="sec-level ${esc(l.tone)} ${l.id === level ? 'current' : ''}" data-sec-level="${esc(l.id)}" ${!canManage || working || l.id === level ? 'disabled' : ''}>
              <div class="sec-level-name">${esc(l.name)}${l.id === level ? '<span class="sec-level-now">Active</span>' : ''}</div>
              <p>${esc(l.blurb)}</p>
              <ul>${l.points.map(pt => `<li>${esc(pt)}</li>`).join('')}</ul>
            </button>`).join('')}
        </div>
        ${canManage ? `
        <div style="padding:0 16px 16px;display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" class="btn btn-ghost btn-sm" id="secSignOutAll" ${working ? 'disabled' : ''}>Sign out everyone below me</button>
        </div>`
              : '<div class="home-note">You can see the level but not change it. Someone with the security permission can.</div>'}
      </div>
      ${canManage && posture ? `
      <div class="home-grid" style="margin-top:16px;">
        <div class="home-card">
          <div class="home-card-head"><h2>Where you stand</h2></div>
          <div class="home-stats" style="padding:14px 16px;margin:0;">
            ${statCard('Signed in', posture.sessions, posture.staleSessions ? posture.staleSessions + ' not used in a week' : 'All recent', posture.staleSessions > 0)}
            ${statCard('Accounts on hold', posture.holds, posture.holds ? 'Payouts paused' : 'None', posture.holds > 0)}
            ${statCard('Bank payouts', posture.bankAccounts, 'People you hold details for')}
            ${discordOn() ? statCard('No Discord linked', posture.unlinkedWithMethod, posture.unlinkedWithMethod ? 'But has a payout method' : 'All linked', posture.unlinkedWithMethod > 0) : statCard('Payout methods', posture.withMethod != null ? posture.withMethod : posture.bankAccounts, 'People who can be paid')}
          </div>
          <div class="home-row"><div class="home-row-main"><div class="home-row-title">Roles that can pay people</div><div class="home-row-meta"><span>${esc(posture.rolesThatCanPay.join(', ') || 'None')}</span></div></div></div>
          <div class="home-row"><div class="home-row-main"><div class="home-row-title">Roles that see bank details</div><div class="home-row-meta"><span>${esc(posture.rolesThatSeeBank.join(', ') || 'None')}</span></div></div></div>
          <div class="home-row"><div class="home-row-main"><div class="home-row-title">Roles that can change this page</div><div class="home-row-meta"><span>${esc(posture.rolesThatManageSecurity.join(', ') || 'None')}</span></div></div></div>
        </div>
        <div class="home-card">
          <div class="home-card-head"><h2>Raise itself automatically</h2></div>
          <div class="home-note">If a lot of payout methods change in a short window, that is what an account takeover looks like. The site can go to Heightened on its own and wait for a human.</div>
          <div style="padding:14px 16px;">
            <label class="perm-check-item" style="margin-bottom:12px;">
              <input type="checkbox" id="secAutoRaise" ${posture.autoRaise.enabled ? 'checked' : ''}>
              Raise to Heightened on a burst of payout changes
            </label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="field"><label for="secThreshold">Changes</label><input type="number" id="secThreshold" min="2" max="50" value="${esc(posture.autoRaise.threshold)}"></div>
              <div class="field"><label for="secWindow">Within (minutes)</label><input type="number" id="secWindow" min="5" max="1440" value="${esc(posture.autoRaise.windowMinutes)}"></div>
            </div>
            <button type="button" class="btn btn-primary btn-sm" id="secSaveSettings" ${working ? 'disabled' : ''}>Save</button>
          </div>
        </div>
      </div>` : ''}` : tab === 'holds' ? `
      <div class="home-card">
        <div class="home-card-head"><h2>Payout holds</h2><span class="count">${holds.length}</span></div>
        <div class="home-note">A hold freezes one person without touching anyone else. They cannot be paid, change their payout details or send new requests until it is lifted. Nothing they are owed is removed.</div>
        ${holds.length ? holds.map(h => `
          <div class="home-row">
            <div class="home-row-main">
              <div class="home-row-title">${userLink(h.roblox_user_id, h.roblox_username || h.roblox_user_id)}</div>
              <div class="home-row-meta">
                <span>${esc(h.reason || 'No reason recorded')}</span>
                <span>by ${esc(h.placed_by || 'someone')} ${esc(relTime(h.placed_at))}</span>
              </div>
            </div>
            <div class="home-row-actions">
              <button type="button" class="btn btn-ghost btn-sm" data-hold-lift="${esc(h.roblox_user_id)}">Lift</button>
            </div>
          </div>`).join('') : '<div class="home-empty">No accounts are on hold.</div>'}
        ${canManage ? `
        <div style="padding:16px;border-top:1px solid var(--line);">
          <h3 style="margin:0 0 12px;font-size:14px;">Put an account on hold</h3>
          <div style="display:grid;grid-template-columns:1fr 2fr;gap:12px;">
            <div class="field"><label for="holdUserId">Roblox user ID</label><input type="number" id="holdUserId" placeholder="e.g. 1234567"></div>
            <div class="field"><label for="holdReason">Reason <span class="hint">(they see this)</span></label><input type="text" id="holdReason" placeholder="e.g. payout email changed from a new country"></div>
          </div>
          <label class="perm-check-item" style="margin-bottom:10px;"><input type="checkbox" id="holdSignOut"> Sign their devices out as well</label>
          <button type="button" class="btn btn-primary btn-sm" id="holdPlaceBtn" ${working ? 'disabled' : ''}>Place the hold</button>
        </div>` : ''}
      </div>` : tab === 'sessions' ? `
      <div class="home-card">
        <div class="home-card-head"><h2>Signed in right now</h2><span class="count">${sessions.length}</span></div>
        ${sessions.length ? sessions.map(sessionRow).join('') : '<div class="home-empty">Nobody is signed in.</div>'}
      </div>` : `
      <div class="home-card">
        <div class="home-card-head"><h2>Security log</h2><span class="count">${events.length}</span></div>
        ${events.length ? events.map(eventRow).join('') : '<div class="home-empty">Nothing recorded yet.</div>'}
      </div>`}
    </div>`;

        wireTopbarSignOut();

        document.querySelectorAll('[data-sec-tab]').forEach(el => el.addEventListener('click', () => {
          tab = el.dataset.secTab;
          paint();
        }));

        document.querySelectorAll('[data-sec-level]').forEach(el => el.addEventListener('click', async () => {
          const next = el.dataset.secLevel;
          const target = SECURITY_LEVELS.find(l => l.id === next);
          let note = '';
          if (next !== 'normal') {
            note = await askForText({
              title: `Turn on ${target.name}`,
              hint: 'Say what prompted this. It shows on the security log and to anyone who gets locked out.',
              placeholder: 'For example: two payout methods changed overnight from an unfamiliar device.',
              confirmLabel: `Turn on ${target.name}`,
              required: true,
              requiredMessage: 'Write a short reason first.'
            });
            if (note === null) return;
          } else {
            note = await askForText({
              title: 'Back to normal',
              hint: 'Optional, but useful later: what resolved it?',
              placeholder: 'For example: it was a staff member on a new laptop.',
              confirmLabel: 'Back to normal'
            });
            if (note === null) return;
          }
          let signEveryoneOut = false;
          if (next === 'lockdown') {
            signEveryoneOut = (await askConfirm('Sign every other device out as well?\n\nEveryone else will have to sign in again. Your own session stays.', { okLabel: 'Sign everyone out', cancelLabel: 'Leave them signed in', danger: true }));
          }
          working = true; paint();
          try {
            const json = await callHrData('set_security_level', { level: next, note, signEveryoneOut });
            toast(json.revoked ? `${target.name} on, ${json.revoked} signed out` : `${target.name} is on`);
            await load();
          } catch (e) {
            toast(e.message || 'Could not change the level.', 'err');
          }
          working = false;
          paint();
        }));

        const saveSettings = document.getElementById('secSaveSettings');
        if (saveSettings) saveSettings.addEventListener('click', async () => {
          const autoRaise = (document.getElementById('secAutoRaise') || {}).checked === true;
          const threshold = Number((document.getElementById('secThreshold') || {}).value);
          const windowMinutes = Number((document.getElementById('secWindow') || {}).value);
          working = true; paint();
          try {
            await callHrData('save_security_settings', { autoRaise, threshold, windowMinutes });
            toast('Saved');
            await load();
          } catch (e) {
            toast(e.message || 'Could not save that.', 'err');
          }
          working = false;
          paint();
        });

        const holdPlace = document.getElementById('holdPlaceBtn');
        if (holdPlace) holdPlace.addEventListener('click', async () => {
          const robloxUserId = Number((document.getElementById('holdUserId') || {}).value);
          const reason = ((document.getElementById('holdReason') || {}).value || '').trim();
          const signThemOut = (document.getElementById('holdSignOut') || {}).checked === true;
          if (!(robloxUserId > 0) || !reason) { toast('Need a Roblox user ID and a reason.', 'err'); return; }
          working = true; paint();
          try {
            const json = await callHrData('place_account_hold', { robloxUserId, reason, signThemOut });
            toast(json.signedOut ? `Hold placed, ${json.signedOut} signed out` : 'Hold placed');
            await load();
          } catch (e) {
            toast(e.message || 'Could not place that hold.', 'err');
          }
          working = false;
          paint();
        });

        document.querySelectorAll('[data-hold-lift]').forEach(el => el.addEventListener('click', async () => {
          el.disabled = true;
          el.textContent = 'Lifting...';
          try {
            await callHrData('lift_account_hold', { robloxUserId: Number(el.dataset.holdLift) });
            toast('Hold lifted');
            await load();
          } catch (e) {
            el.disabled = false;
            el.textContent = 'Lift';
            toast(e.message || 'Could not lift that hold.', 'err');
          }
        }));

        const signOutAll = document.getElementById('secSignOutAll');
        if (signOutAll) signOutAll.addEventListener('click', async () => {
          if (!(await askConfirm('Sign out everyone whose role is below yours?\n\nThey will need to sign in again. Your own session stays.'))) return;
          working = true; paint();
          try {
            const json = await callHrData('revoke_all_sessions');
            toast(json.count ? `Signed out ${json.count}` : 'Nobody to sign out');
            await load();
          } catch (e) {
            toast(e.message || 'That did not go through.', 'err');
          }
          working = false;
          paint();
        });

        document.querySelectorAll('[data-sec-revoke]').forEach(el => el.addEventListener('click', async () => {
          el.disabled = true;
          el.textContent = 'Signing out...';
          try {
            await callHrData('revoke_session', { token: el.dataset.secRevoke });
            toast('Signed out');
            await load();
          } catch (e) {
            el.disabled = false;
            el.textContent = 'Sign out';
            toast(e.message || 'Could not sign them out.', 'err');
          }
        }));
      }

      async function load() {
        loadError = null;
        try {
          const results = await Promise.all([
            callHrData('get_security_state', { force: true }),
            canManage ? callHrData('list_sessions') : Promise.resolve({ data: [] }),
            canManage ? callHrData('list_security_events', { limit: 80 }) : Promise.resolve({ data: [] }),
            canManage ? callHrData('list_account_holds') : Promise.resolve({ data: [] }),
            canManage ? callHrData('get_security_posture') : Promise.resolve({ data: null })
          ]);
          const asList = v => (Array.isArray(v) ? v : []);
          const raw = results[0].data;
          state = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
          sessions = asList(results[1].data);
          events = asList(results[2].data);
          holds = asList(results[3].data);
          const rawPosture = results[4].data;
          posture = rawPosture && typeof rawPosture === 'object' && !Array.isArray(rawPosture)
            ? {
              sessions: Number(rawPosture.sessions) || 0,
              staleSessions: Number(rawPosture.staleSessions) || 0,
              holds: Number(rawPosture.holds) || 0,
              unlinkedWithMethod: Number(rawPosture.unlinkedWithMethod) || 0,
              bankAccounts: Number(rawPosture.bankAccounts) || 0,
              rolesThatCanPay: asList(rawPosture.rolesThatCanPay),
              rolesThatSeeBank: asList(rawPosture.rolesThatSeeBank),
              rolesThatManageSecurity: asList(rawPosture.rolesThatManageSecurity),
              autoRaise: rawPosture.autoRaise && typeof rawPosture.autoRaise === 'object'
                ? rawPosture.autoRaise
                : { enabled: true, windowMinutes: 60, threshold: 3 }
            }
            : null;
          if (state) {
            securityLevel = state.level || 'normal';
            lockdownNote = state.note || '';
          }
        } catch (e) {
          loadError = e.message || 'Could not load the security centre.';
        }
        if (myGen !== renderGen) return;
        loading = false;
        paint();
      }

      load();
    }

    function renderLockedOut() {
      const note = lockdownNote;
      app.innerHTML = `
    <div class="lock-screen">
      <div class="lock-inner">
        <div class="closed-icon">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="4" y="10.5" width="16" height="10.5" rx="2.5"></rect>
            <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"></path>
          </svg>
        </div>
        <h1>The site is locked</h1>
        <p>${esc(studioName())} has been put into lockdown while something is looked into. Nobody is being paid or charged during this, and nothing you submitted has been lost.</p>
        <p>It will open again once leadership clears it.</p>
        ${note ? `<div class="lock-why"><strong>Reason given:</strong><br>${esc(note)}</div>` : ''}
        <div style="margin-top:18px;"><button type="button" class="btn btn-ghost btn-sm" id="lockSignOut">Sign out</button></div>
      </div>
    </div>`;
      const out = document.getElementById('lockSignOut');
      if (out) out.addEventListener('click', hrSignOut);
    }


    function tourSteps() {
      const steps = [
        {
          find: () => document.querySelector('.shell-link[href="#/home"]'),
          title: 'Home is your starting point',
          body: 'It shows what needs you today, and it changes depending on whether you build, run a team, or run the studio.',
          place: 'right'
        },
        {
          find: () => document.querySelector('.shell-search'),
          title: 'Search jumps anywhere',
          body: 'Press Ctrl K (or Cmd K) to find any page, person or setting without hunting through the menu.',
          place: 'right'
        }
      ];

      if (hasPermission('dashboard.submit_request') || hasPermission('teams.view')) {
        steps.push({
          find: () => document.querySelector('[data-home-submit]') || document.querySelector('.home-card'),
          title: 'Work gets reviewed before it gets paid',
          body: 'Mark a task done, your producer checks it, then it counts towards pay. If it comes back, the note says what to change.',
          place: 'right'
        });
      }

      if (hasPermission('dashboard.view')) {
        steps.push({
          find: () => document.querySelector('.shell-link[href="#/runs"]') || document.querySelector('.shell-link[href="#/dashboard"]'),
          title: 'Payments go out in runs',
          body: 'Approved work collects in one open run. Freeze it on the cut-off, pay the sheet, close it.',
          place: 'right'
        });
      }

      if (hasPermission('settings.manage_rate')) {
        steps.push({
          find: () => document.querySelector('.shell-link[href="#/manage"]'),
          title: 'Pay rates are written down',
          body: 'Set a standard amount per kind of job once in Settings. Same work, same pay, whoever assigns it.',
          place: 'right'
        });
      }

      if (hasPermission('security.manage') || hasPermission('roles.manage')) {
        steps.push({
          find: () => document.querySelector('.shell-link[href="#/security"]'),
          title: 'Security has a switch',
          body: 'Raising the protocol stops every payment, including your own. Lockdown also shuts everyone else out.',
          place: 'right'
        });
      }

      steps.push({
        find: () => null,
        title: "That's the tour",
        body: 'You can take this tour again any time from the menu under your name.',
        place: 'centre'
      });

      return steps;
    }

    function inkArrow(from, to) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const bow = Math.min(46, len * 0.22);
      const p1 = { x: from.x + dx * 0.32 + nx * bow, y: from.y + dy * 0.32 + ny * bow };
      const p2 = { x: from.x + dx * 0.68 + nx * bow * 0.72, y: from.y + dy * 0.68 + ny * bow * 0.72 };
      const shaft = `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} C ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}, ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;

      const tx = to.x - p2.x;
      const ty = to.y - p2.y;
      const tl = Math.sqrt(tx * tx + ty * ty) || 1;
      const ux = tx / tl;
      const uy = ty / tl;
      const head = 11;
      const spread = 0.46;
      const a1 = {
        x: to.x - head * (ux * Math.cos(spread) - uy * Math.sin(spread)),
        y: to.y - head * (uy * Math.cos(spread) + ux * Math.sin(spread))
      };
      const a2 = {
        x: to.x - head * (ux * Math.cos(-spread) - uy * Math.sin(-spread)),
        y: to.y - head * (uy * Math.cos(-spread) + ux * Math.sin(-spread))
      };
      const tip = `M ${a1.x.toFixed(1)} ${a1.y.toFixed(1)} L ${to.x.toFixed(1)} ${to.y.toFixed(1)} L ${a2.x.toFixed(1)} ${a2.y.toFixed(1)}`;
      return { shaft, tip };
    }

    function paintTourStep(index, steps) {
      const existing = document.getElementById('tourRoot');
      if (existing) existing.remove();
      const step = steps[index];
      if (!step) return;

      const root = document.createElement('div');
      root.id = 'tourRoot';
      root.className = 'tour-veil';
      document.body.appendChild(root);

      const target = step.find ? step.find() : null;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let box = null;
      if (target) {
        const r = target.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < vh) {
          box = { x: r.left - 5, y: r.top - 5, w: r.width + 10, h: r.height + 10 };
        }
      }

      root.innerHTML = `
        <svg class="tour-dim" aria-hidden="true">
          <defs>
            <mask id="tourMask">
              <rect width="100%" height="100%" fill="white"></rect>
              ${box ? `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="12" fill="black"></rect>` : ''}
            </mask>
          </defs>
          <rect width="100%" height="100%" fill="rgba(12,14,20,.58)" mask="url(#tourMask)"></rect>
        </svg>`;

      if (box) {
        const ring = document.createElement('div');
        ring.className = 'tour-ring';
        ring.style.left = box.x + 'px';
        ring.style.top = box.y + 'px';
        ring.style.width = box.w + 'px';
        ring.style.height = box.h + 'px';
        root.appendChild(ring);
      }

      const note = document.createElement('div');
      note.className = 'tour-note';
      note.setAttribute('role', 'dialog');
      note.setAttribute('aria-modal', 'true');
      note.setAttribute('aria-label', step.title);
      note.setAttribute('tabindex', '-1');
      note.innerHTML = `
        <h3>${esc(step.title)}</h3>
        <p>${esc(step.body)}</p>
        <div class="tour-note-foot">
          <span class="tour-dots" aria-label="Step ${index + 1} of ${steps.length}">${steps.map((s, i) => `<i class="${i === index ? 'on' : ''}"></i>`).join('')}</span>
          ${index > 0
          ? '<button type="button" class="btn btn-ghost btn-sm" id="tourBack">Back</button>'
          : '<button type="button" class="btn btn-ghost btn-sm" id="tourSkip">Skip</button>'}
          <button type="button" class="btn btn-primary btn-sm" id="tourNext">${index === steps.length - 1 ? 'Done' : 'Next'}</button>
        </div>`;
      root.appendChild(note);

      const noteBox = note.getBoundingClientRect();
      const gap = 44;
      let nx, ny;
      if (!box) {
        nx = Math.max(16, vw / 2 - noteBox.width / 2);
        ny = Math.max(16, vh / 2 - noteBox.height / 2);
      } else if (step.place === 'right' && box.x + box.w + noteBox.width + gap + 16 < vw) {
        nx = box.x + box.w + gap;
        ny = Math.min(vh - noteBox.height - 16, Math.max(16, box.y - 8));
      } else {
        nx = Math.min(vw - noteBox.width - 16, Math.max(16, box.x + box.w / 2 - noteBox.width / 2));
        ny = box.y + box.h + gap;
        if (ny + noteBox.height > vh - 12) ny = Math.max(16, box.y - noteBox.height - gap);
      }
      note.style.left = Math.round(nx) + 'px';
      note.style.top = Math.round(ny) + 'px';

      if (box) {
        const n = note.getBoundingClientRect();
        const above = n.top > box.y + box.h;
        const beside = n.left > box.x + box.w;
        let start, end;
        if (beside) {
          start = { x: n.left - 10, y: n.top + 30 };
          end = { x: box.x + box.w + 8, y: box.y + box.h / 2 };
        } else if (above) {
          start = { x: Math.min(Math.max(n.left + 44, box.x), n.right - 44), y: n.top - 10 };
          end = { x: box.x + box.w / 2, y: box.y + box.h + 8 };
        } else {
          start = { x: Math.min(Math.max(n.left + 44, box.x), n.right - 44), y: n.bottom + 10 };
          end = { x: box.x + box.w / 2, y: box.y - 8 };
        }
        const path = inkArrow(start, end);
        const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        arrow.setAttribute('class', 'tour-arrow');
        arrow.setAttribute('width', String(vw));
        arrow.setAttribute('height', String(vh));
        arrow.style.left = '0';
        arrow.style.top = '0';
        arrow.innerHTML = `
          <g fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="${path.shaft}"></path>
            <path d="${path.tip}"></path>
          </g>`;
        root.appendChild(arrow);
      }

      const next = document.getElementById('tourNext');
      const back = document.getElementById('tourBack');
      const skip = document.getElementById('tourSkip');
      if (next) next.addEventListener('click', () => {
        if (index === steps.length - 1) finishTour();
        else paintTourStep(index + 1, steps);
      });
      if (back) back.addEventListener('click', () => paintTourStep(index - 1, steps));
      if (skip) skip.addEventListener('click', finishTour);
      note.focus({ preventScroll: true });
    }

    async function finishTour() {
      tourRunning = false;
      const root = document.getElementById('tourRoot');
      if (root) root.remove();
      const badge = document.getElementById('tourBadge');
      if (badge) badge.remove();
      document.removeEventListener('keydown', tourKey);
      try {
        await callHrData('mark_tour_seen', { version: REVAMP_TOUR_VERSION });
        if (tourState) tourState.seen = REVAMP_TOUR_VERSION;
      } catch (e) { }
    }

    function tourKey(e) {
      if (e.key === 'Escape') finishTour();
    }

    function startTour() {
      if (tourRunning) return;
      const steps = tourSteps();
      if (!steps.length) return;
      tourRunning = true;
      document.addEventListener('keydown', tourKey);
      paintTourStep(0, steps);
    }

    async function maybeOfferTour() {
      if (tourRunning || siteLocked || !isHrAuthed) return;
      if (tourRequested) {
        tourRequested = false;
        setTimeout(() => { if (!tourRunning && document.querySelector('.home-shell')) startTour(); }, 250);
        return;
      }
      if (!tourState) {
        try {
          const json = await callHrData('get_tour_state');
          tourState = json.data || null;
        } catch (e) {
          return;
        }
      }
      if (!tourState || Number(tourState.seen) >= REVAMP_TOUR_VERSION) return;
      if (currentPath() !== '#/home' && currentPath() !== '#/' && currentPath() !== '') return;
      setTimeout(() => { if (!tourRunning && document.querySelector('.home-shell')) startTour(); }, 650);
    }

    function renderDashboard() {
      if (!hasPermission('dashboard.view')) { window.location.hash = canSeeManage() ? '#/manage' : '#/'; return; }
      const myGen = renderGen;
      let allRequests = [];
      let filter = 'pending';
      let search = '';
      let missingOnly = false;
      let archiveResult = 'all';
      let ageFilter = 'any';
      let minAmount = '';
      let maxAmount = '';
      let methodFilter = 'all';
      let sortBy = 'newest';
      let amountSaving = new Set();
      let claims = [];
      let claimsLoading = false;
      const claimsBusy = new Set();
      let roleFilter = 'all';
      let teamFilter = 'all';
      let skillsetFilter = 'all';
      let expanded = new Set();
      let loading = true;
      let loadError = null;
      let eligibilityCache = {};
      let eligibilityLoading = new Set();

      const canExport = hasPermission('dashboard.export');
      const discordLocked = needsDiscordLink;
      const canMarkPaid = hasPermission('dashboard.mark_paid') && !discordLocked;

      function getAllRoles() {
        const roles = new Set();
        allRequests.forEach(r => (r.requesterRoles || []).forEach(role => roles.add(role)));
        return Array.from(roles).sort();
      }

      function getAllTeams() {
        const teams = new Set();
        allRequests.forEach(r => { if (r.requesterTeam) teams.add(r.requesterTeam); });
        return Array.from(teams).sort();
      }

      function getAllSkillsets() {
        const skillsets = new Set();
        allRequests.forEach(r => { if (r.requesterSkillset) skillsets.add(r.requesterSkillset); });
        return Array.from(skillsets).sort();
      }

      function getRows() {
        let rows = allRequests.filter(r => filter === 'archive'
          ? (r.status === 'paid' || r.status === 'rejected') && (archiveResult === 'all' || r.status === archiveResult)
          : filter === 'all' ? true : r.status === filter);
        if (filter !== 'archive' && ageFilter !== 'any') {
          const minAge = Number(ageFilter) * 86400000;
          rows = rows.filter(r => r.status === 'pending' && r.createdAt && (Date.now() - new Date(r.createdAt).getTime()) >= minAge);
        }
        const usdValue = r => r.currency === 'USD' ? (Number(r.payment) || 0) : (Number(r.payment) || 0) * DEVEX_RATE;
        if (String(minAmount).trim() !== '' && Number.isFinite(Number(minAmount))) rows = rows.filter(r => usdValue(r) >= Number(minAmount));
        if (String(maxAmount).trim() !== '' && Number.isFinite(Number(maxAmount))) rows = rows.filter(r => usdValue(r) <= Number(maxAmount));
        if (methodFilter === 'none') rows = rows.filter(r => !r.paymentMethod);
        else if (methodFilter !== 'all') rows = rows.filter(r => r.paymentMethod && r.paymentMethod.method === methodFilter);
        if (missingOnly) rows = rows.filter(r => r.status === 'pending' && !r.paymentMethod);
        if (roleFilter !== 'all') {
          rows = rows.filter(r => (r.requesterRoles || []).includes(roleFilter));
        }
        if (teamFilter !== 'all') {
          rows = rows.filter(r => r.requesterTeam === teamFilter);
        }
        if (skillsetFilter !== 'all') {
          rows = rows.filter(r => r.requesterSkillset === skillsetFilter);
        }
        if (search.trim()) {
          const q = search.trim().toLowerCase();
          rows = rows.filter(r => (r.robloxUsername || '').toLowerCase().includes(q) || (r.taskName || '').toLowerCase().includes(q) || (r.game || '').toLowerCase().includes(q) || (r.requestedBy || '').toLowerCase().includes(q));
        }
        const when = r => new Date((filter === 'archive' && r.paidAt) ? r.paidAt : (r.createdAt || 0)).getTime();
        rows = rows.slice().sort((a, b) => sortBy === 'oldest' ? when(a) - when(b)
          : sortBy === 'high' ? usdValue(b) - usdValue(a)
          : sortBy === 'low' ? usdValue(a) - usdValue(b)
          : when(b) - when(a));
        return rows;
      }

      function renderRow(r) {
        const items = parseWorkLines(r.workRaw || '');
        const isOpen = expanded.has(r.id);
        const statusLabel = r.status === 'paid' ? `Paid ${esc(fmtDate(r.paidAt || Date.now()))}` : r.status === 'rejected' ? 'Rejected' : 'Pending';
        const rowHtml = `
            <tr>
              <td><button type="button" class="expand-toggle" data-toggle="${esc(r.id)}">${isOpen ? '&minus;' : '+'}</button></td>
              <td class="name-cell"><strong>${userLink(r.robloxUserId, r.robloxUsername)}</strong><span>Logged by ${r.requestedBy ? userLink(r.requestedByUserId, r.requestedBy) : '-'}</span>${(r.requesterTeam || r.requesterSkillset) ? `<div class="role-meta" style="margin-top:2px;">${[r.requesterTeam, r.requesterSkillset].filter(Boolean).map(esc).join(' &middot; ')}</div>` : ''}${r.split ? `<div class="method-note has-method">Split: $${Number(r.split.cashUsd).toFixed(2)} + R$ ${Number(r.split.robux).toLocaleString()}</div>` : ''}${r.paymentMethod ? `<div class="method-note has-method"${methodHiddenTitle(r.paymentMethod)}>${esc(methodDisplayLabel(r.paymentMethod))}${r.paymentMethod.method === 'BANK_TRANSFER' && !r.paymentMethod.detailsHidden ? ` <button type="button" class="pp-linkbtn" data-bank-details="${esc(r.id)}">Payment details</button>` : ''}</div>` : `<div class="method-note missing-method">No payment method set</div>`}</td>
              <td class="task-cell">
                <div class="task-name">${esc(r.taskName || 'Untitled task')}</div>
                ${r.skillsetNames && r.skillsetNames.length ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">${r.skillsetNames.map(name => `<span class="skill-badge">${esc(name)}</span>`).join('')}</div>` : ''}
                <div class="task-count">${items.length} item${items.length === 1 ? '' : 's'}${r.game ? ` &middot; <span class="game-badge" style="background:${gameColor(r.game)};">${esc(r.game)}</span>` : ''}${r.timeWorked ? ` &middot; ${esc(r.timeWorked)}` : ''}</div>
              </td>
              <td class="pay-cell">${fmtAmount(r)}${r.currency === 'ROBUX' ? `<div style="font-weight:500;color:var(--muted);font-size:11px;margin-top:2px;">${devexEquivalent(r)}</div>` : ''}</td>
              <td><span class="status-chip ${r.status}">${statusLabel}</span>${r.status === 'rejected' && r.statusNote ? `<div class="status-note">${esc(r.statusNote)}</div>` : ''}</td>
              <td class="mono" style="white-space:nowrap;color:var(--muted);font-size:11.5px;">${esc(fmtDate(r.createdAt || Date.now()))}${r.status === 'pending' && r.createdAt ? `<div style="font-size:10.5px;margin-top:2px;">${Math.max(0, Math.floor((Date.now() - new Date(r.createdAt).getTime()) / 86400000))}d pending</div>` : ''}</td>
              <td class="actions-cell">
                <div class="actions-group">
                  ${r.status === 'pending' && canMarkPaid ? `<button type="button" class="btn btn-ok btn-xs" data-paid="${esc(r.id)}"${frozenAttrs()}>Paid</button>` : ''}
                  ${r.status === 'pending' && canMarkPaid ? `<button type="button" class="btn btn-ghost btn-xs" data-reject="${esc(r.id)}">Reject</button>` : ''}
                  ${r.status !== 'pending' && canMarkPaid ? `<button type="button" class="btn btn-ghost btn-xs" data-reopen="${esc(r.id)}">Reopen</button>` : ''}
                  ${canMarkPaid ? `<button type="button" class="btn btn-danger-ghost btn-xs" data-delete-request="${esc(r.id)}">Delete</button>` : ''}
                </div>
              </td>
            </tr>`;
        const cacheEntry = eligibilityCache[r.robloxUsername];
        const isElLoading = eligibilityLoading.has(r.robloxUsername);
        const detailHtml = isOpen ? `
            <tr class="detail-row">
              <td colspan="7">
                <div class="role-meta" style="margin-bottom:10px;">ID: <span class="mono">${esc(r.id)}</span></div>
                ${r.status !== 'paid' && canMarkPaid ? `<div class="claim-edit" style="margin-bottom:12px;">
                  <label class="hint" for="editAmt_${esc(r.id)}">Change amount</label>
                  <input type="number" id="editAmt_${esc(r.id)}" value="${esc(r.payment)}" min="0.01" step="any">
                  <select id="editCur_${esc(r.id)}">
                    <option value="ROBUX" ${r.currency === 'ROBUX' ? 'selected' : ''}>Robux</option>
                    <option value="USD" ${r.currency === 'USD' ? 'selected' : ''}>USD</option>
                  </select>
                  <button type="button" class="btn btn-ok btn-sm" data-save-amount="${esc(r.id)}" ${amountSaving.has(r.id) ? 'disabled' : ''}>${amountSaving.has(r.id) ? 'Saving...' : 'Save amount'}</button>
                </div>` : ''}
                ${items.length ? `<ol class="detail-list">${items.map(i => `<li>${esc(i.lead)}${i.rest ? ' ' + esc(i.rest) : ''}</li>`).join('')}</ol>` : `<div class="detail-empty">No work items listed.</div>`}
                <div style="margin-top:12px;border-top:1px solid var(--line);padding-top:12px;">
                  <div style="font-size:10.5px;text-transform:uppercase;color:var(--muted);font-weight:700;letter-spacing:.6px;margin-bottom:8px;">Payout eligibility</div>
                  ${cacheEntry ? renderEligibilityList(cacheEntry) : (canSubmitRequests() ? `<button type="button" class="btn btn-ghost btn-sm" data-check-elig="${esc(r.robloxUsername)}" ${isElLoading ? 'disabled' : ''}>${isElLoading ? 'Checking...' : 'Check eligibility'}</button>` : `<div class="empty-note">You don't have permission to check eligibility.</div>`)}
                </div>
              </td>
            </tr>` : '';
        return rowHtml + detailHtml;
      }

      function renderEligibilityList(list) {
        if (!list.length) return `<div class="empty-note">No eligibility groups configured yet.</div>`;
        const allEligible = list.every(g => g.eligible);
        const isOverridden = list.some(g => g.overridden);
        return `
            ${isOverridden ? `<div class="hint" style="display:block;margin-bottom:8px;color:var(--muted);">"Ignore Eligibility for All Requests" is on, everyone is treated as eligible regardless of the status below.</div>` : ''}
            <div class="elig-summary ${allEligible ? 'is-ok' : ''}">${allEligible ? 'Eligible' : 'Not yet eligible'}</div>
            ${list.map(g => `
              <div class="elig-row">
                <div class="elig-left">
                  <div class="elig-check ${g.eligible ? 'is-ok' : ''}">${g.eligible ? '&#10003;' : '&middot;'}</div>
                  <div>
                    <div class="elig-name">${esc(g.name)}</div>
                    <div class="elig-meta">${g.metaLabel ? esc(g.metaLabel) : (g.isMember ? 'Member' : 'Not a member')}</div>
                  </div>
                </div>
              </div>`).join('')}`;
      }

      function tableHtml() {
        const rows = getRows();
        return loading ? `<div class="dash-loading">Loading payment requests...</div>` : loadError ? `
          <div class="dash-empty"><h3>Could not load requests</h3><p>${esc(loadError)}</p><button type="button" class="btn btn-ghost btn-sm" id="retryBtn">Try again</button></div>
        ` : rows.length === 0 ? `
          <div class="dash-empty"><h3>Nothing here</h3><p>No matching payment requests.</p></div>
        ` : `
        <div class="table-scroll">
          <table class="req-table">
            <thead>
              <tr>
                <th style="width:32px;"></th>
                <th style="width:19%;">Requested by</th>
                <th style="width:27%;">Task</th>
                <th style="width:11%;">Payment</th>
                <th style="width:12%;">Status</th>
                <th style="width:92px;">Date</th>
                <th style="width:190px;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(r => renderRow(r)).join('')}
            </tbody>
          </table>
        </div>`;
      }

      function wireTableEvents() {
        const retryBtn = document.getElementById('retryBtn');
        if (retryBtn) retryBtn.addEventListener('click', () => { load(); });

        wireBankDetails((id) => allRequests.find(r => String(r.id) === String(id)));

        document.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', () => {
          const id = b.dataset.toggle;
          if (expanded.has(id)) expanded.clear(); else { expanded.clear(); expanded.add(id); }
          paintTable();
        }));

        document.querySelectorAll('[data-save-amount]').forEach(b => b.addEventListener('click', async () => {
          const id = b.dataset.saveAmount;
          const r = allRequests.find(x => String(x.id) === String(id));
          if (!r) return;
          const amt = Number((document.getElementById('editAmt_' + id) || {}).value);
          const cur = (document.getElementById('editCur_' + id) || {}).value;
          if (!(amt > 0) || !cur) { toast('Enter an amount above zero.', 'err'); return; }
          amountSaving.add(id); paintTable();
          try {
            const res = await editRequestAmount(id, amt, cur);
            r.payment = res.payment; r.currency = res.currency;
            toast('Amount updated.');
            updateStatsAndTabs();
          } catch (err) {
            toast(err.message || 'Could not change that amount.', 'err');
          }
          amountSaving.delete(id); paintTable();
        }));

        document.querySelectorAll('[data-check-elig]').forEach(b => b.addEventListener('click', async (e) => {
          const username = b.dataset.checkElig;
          eligibilityLoading.add(username);
          paintTable();
          try {
            const data = await getUserEligibility(username);
            eligibilityCache[username] = data;
          } catch (err) {
            eligibilityCache[username] = [];
          }
          eligibilityLoading.delete(username);
          paintTable();
        }));

        document.querySelectorAll('[data-paid]').forEach(b => b.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const id = b.dataset.paid;
          const r = allRequests.find(x => x.id === id);
          if (!r) return;
          const before = { status: r.status, paid: r.paid, paidAt: r.paidAt };
          const btn = b;
          btn.disabled = true;
          btn.textContent = 'Saving...';
          try {
            r.paid = true;
            r.status = 'paid';
            r.paidAt = Date.now();
            await updateRequest(r);
            updateStatsAndTabs();
            paintTable();
          } catch (err) {
            r.status = before.status;
            r.paid = before.paid;
            r.paidAt = before.paidAt;
            btn.disabled = false;
            btn.textContent = 'Mark paid';
            toast(err.message || 'Could not save. Check your connection and try again.', 'err');
          }
        }));

        document.querySelectorAll('[data-reject]').forEach(b => b.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const id = b.dataset.reject;
          const r = allRequests.find(x => x.id === id);
          if (!r) return;
          const note = await askForText({
            title: 'Reject this request',
            hint: 'The person who was going to be paid sees this reason.',
            placeholder: 'For example: this work was already covered by another payment.',
            confirmLabel: 'Reject it'
          });
          if (note === null) return;
          const before = { status: r.status, statusNote: r.statusNote, paid: r.paid, paidAt: r.paidAt };
          const btn = b;
          btn.disabled = true;
          btn.textContent = 'Saving...';
          try {
            r.status = 'rejected';
            r.statusNote = note;
            r.paid = false;
            r.paidAt = null;
            await rejectRequest(id, note);
            updateStatsAndTabs();
            paintTable();
          } catch (err) {
            r.status = before.status;
            r.statusNote = before.statusNote;
            r.paid = before.paid;
            r.paidAt = before.paidAt;
            btn.disabled = false;
            btn.textContent = 'Reject';
            toast(err.message || 'Could not save. Check your connection and try again.', 'err');
          }
        }));

        document.querySelectorAll('[data-reopen]').forEach(b => b.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const id = b.dataset.reopen;
          const r = allRequests.find(x => x.id === id);
          if (!r) return;
          const before = { status: r.status, statusNote: r.statusNote, paid: r.paid, paidAt: r.paidAt };
          const btn = b;
          btn.disabled = true;
          btn.textContent = 'Saving...';
          try {
            r.status = 'pending';
            r.statusNote = '';
            r.paid = false;
            r.paidAt = null;
            await reopenRequest(id);
            updateStatsAndTabs();
            paintTable();
          } catch (err) {
            r.status = before.status;
            r.statusNote = before.statusNote;
            r.paid = before.paid;
            r.paidAt = before.paidAt;
            btn.disabled = false;
            btn.textContent = 'Reopen';
            toast(err.message || 'Could not save. Check your connection and try again.', 'err');
          }
        }));

        document.querySelectorAll('[data-delete-request]').forEach(b => b.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const id = b.dataset.deleteRequest;
          const r = allRequests.find(x => x.id === id);
          if (!r) return;
          if (!(await askConfirm('Permanently delete this payment request? This cannot be undone.'))) return;
          const btn = b;
          btn.disabled = true;
          btn.textContent = 'Deleting...';
          try {
            await deleteRequest(id);
            allRequests = allRequests.filter(x => x.id !== id);
            updateStatsAndTabs();
            paintTable();
          } catch (err) {
            btn.disabled = false;
            btn.textContent = 'Delete Request';
            toast(err.message || 'Could not delete that request. Check your connection and try again.', 'err');
          }
        }));
      }

      function paintTable() {
        const area = document.getElementById('reqTableArea');
        if (!area) return;
        const existingScroll = area.querySelector('.table-scroll');
        const scrollLeft = existingScroll ? existingScroll.scrollLeft : 0;
        area.innerHTML = tableHtml();
        wireTableEvents();
        const newScroll = area.querySelector('.table-scroll');
        if (newScroll) newScroll.scrollLeft = scrollLeft;
      }

      function updateStatsAndTabs() {
        const counts = {
          all: allRequests.length,
          pending: allRequests.filter(r => r.status === 'pending').length,
          paid: allRequests.filter(r => r.status === 'paid').length,
          rejected: allRequests.filter(r => r.status === 'rejected').length,
          archive: allRequests.filter(r => r.status === 'paid' || r.status === 'rejected').length
        };
        const pendingRows = allRequests.filter(r => r.status === 'pending');
        const missingMethodCount = pendingRows.filter(r => !r.paymentMethod).length;
        const pendingRobux = pendingRows.filter(r => r.currency === 'ROBUX').reduce((sum, r) => sum + (Number(r.payment) || 0), 0);
        const pendingUsd = pendingRows.filter(r => r.currency === 'USD').reduce((sum, r) => sum + (Number(r.payment) || 0), 0);
        const now = new Date();
        const paidThisMonth = allRequests.filter(r => r.status === 'paid' && r.paidAt && new Date(r.paidAt).getMonth() === now.getMonth() && new Date(r.paidAt).getFullYear() === now.getFullYear()).length;

        const pendingRobuxEl = document.getElementById('statPendingRobux');
        if (pendingRobuxEl) pendingRobuxEl.innerHTML = `<img src="${ROBUX_IMG}" alt="Robux">${pendingRobux.toLocaleString()}`;
        const pendingUsdEl = document.getElementById('statPendingUsd');
        if (pendingUsdEl) pendingUsdEl.textContent = `$${pendingUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        const paidThisMonthEl = document.getElementById('statPaidThisMonth');
        if (paidThisMonthEl) paidThisMonthEl.textContent = String(paidThisMonth);
        const missingMethodEl = document.getElementById('statMissingMethod');
        if (missingMethodEl) {
          missingMethodEl.textContent = String(missingMethodCount);
          missingMethodEl.style.color = missingMethodCount > 0 ? 'var(--warn-text)' : '';
        }
        document.querySelectorAll('[data-count-for]').forEach(el => {
          const key = el.dataset.countFor;
          if (counts[key] != null) el.textContent = counts[key];
        });
      }

      function paintShell() {
        const counts = {
          all: allRequests.length,
          pending: allRequests.filter(r => r.status === 'pending').length,
          paid: allRequests.filter(r => r.status === 'paid').length,
          rejected: allRequests.filter(r => r.status === 'rejected').length,
          archive: allRequests.filter(r => r.status === 'paid' || r.status === 'rejected').length
        };
        const pendingRows = allRequests.filter(r => r.status === 'pending');
        const missingMethodCount = pendingRows.filter(r => !r.paymentMethod).length;
        const pendingRobux = pendingRows.filter(r => r.currency === 'ROBUX').reduce((sum, r) => sum + (Number(r.payment) || 0), 0);
        const pendingUsd = pendingRows.filter(r => r.currency === 'USD').reduce((sum, r) => sum + (Number(r.payment) || 0), 0);
        const now = new Date();
        const paidThisMonth = allRequests.filter(r => r.status === 'paid' && r.paidAt && new Date(r.paidAt).getMonth() === now.getMonth() && new Date(r.paidAt).getFullYear() === now.getFullYear()).length;

        app.innerHTML = `
    ${topbar()}
    <div class="dash-shell">
      <div class="dash-head">
        <div>
          <h1 style="margin-bottom:4px;">Payment requests</h1>
          <p class="sub">Shared with everyone who reviews payments. Changes save as you make them.</p>
        </div>
        <div class="dash-toolbar">
          <button type="button" class="btn btn-ghost btn-sm" id="refreshBtn">Refresh</button>
          ${canExport ? `<button type="button" class="btn btn-ghost btn-sm" id="copyAllBtn" title="Copies the rows currently shown, ready to paste into a spreadsheet">Copy rows</button><button type="button" class="btn btn-ok btn-sm" id="exportXlsxBtn" title="Downloads the rows currently shown">Download .xlsx</button>` : ''}
          ${canSubmitRequests() ? `<a class="btn btn-primary btn-sm" href="#/new">New request</a>` : ''}
        </div>
      </div>

      ${discordLocked ? `<div class="warn-box" style="padding:18px 20px;font-size:14px;align-items:flex-start;margin-bottom:20px;">
        <div>
          <strong style="display:block;font-size:15px;margin-bottom:4px;">Discord isn't linked yet</strong>
          <span>You can look around, but you can't mark anything paid, reject, reopen or delete a request until Discord is linked. It's view only until then.</span>
        </div>
        <a class="btn btn-primary btn-sm" href="#/onboarding" style="flex-shrink:0;">Link Discord</a>
      </div>` : ''}

      <div class="stat-strip">
        <div class="strip-card">
          <div class="strip-label">Pending Robux</div>
          <div class="strip-value" id="statPendingRobux"><img src="${ROBUX_IMG}" alt="Robux">${pendingRobux.toLocaleString()}</div>
        </div>
        <div class="strip-card">
          <div class="strip-label">Pending USD</div>
          <div class="strip-value" id="statPendingUsd">$${pendingUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        </div>
        <div class="strip-card">
          <div class="strip-label">Paid this month</div>
          <div class="strip-value" id="statPaidThisMonth">${paidThisMonth}</div>
        </div>
        <div class="strip-card ${missingMethodCount ? 'clickable' : ''}" ${missingMethodCount ? 'id="missingMethodCard" role="button" tabindex="0" title="Show only these requests"' : ''}>
          <div class="strip-label">Missing payment method</div>
          <div class="strip-value" id="statMissingMethod" style="${missingMethodCount > 0 ? 'color:var(--warn-text);' : ''}">${missingMethodCount}</div>
        </div>
      </div>

      <div class="filter-bar">
        <div class="tabs" id="dashFilterTabs">
          <button type="button" class="tab-btn ${filter === 'pending' ? 'active' : ''}" data-filter="pending">Pending (<span class="tab-count" data-count-for="pending">${counts.pending}</span>)</button>
          <button type="button" class="tab-btn ${filter === 'archive' ? 'active' : ''}" data-filter="archive">Archive (<span class="tab-count" data-count-for="archive">${counts.archive}</span>)</button>
          <button type="button" class="tab-btn ${filter === 'claims' ? 'active' : ''}" data-filter="claims">Staff requests (${claims.length})</button>
        </div>
        <div class="search-input-wrap">
          <input type="text" id="searchInput" placeholder="Search by username, task, or game" value="${esc(search)}">
        </div>
        <div class="filter-select-group">
          ${getAllTeams().length ? `
          <select id="teamFilterSelect" class="filter-select">
            <option value="all" ${teamFilter === 'all' ? 'selected' : ''}>All teams</option>
            ${getAllTeams().map(t => `<option value="${esc(t)}" ${teamFilter === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
          </select>` : ''}
          ${getAllSkillsets().length ? `
          <select id="skillsetFilterSelect" class="filter-select">
            <option value="all" ${skillsetFilter === 'all' ? 'selected' : ''}>All skillsets</option>
            ${getAllSkillsets().map(s => `<option value="${esc(s)}" ${skillsetFilter === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
          </select>` : ''}
          ${getAllRoles().length ? `
          <select id="roleFilterSelect" class="filter-select">
            <option value="all" ${roleFilter === 'all' ? 'selected' : ''}>All roles</option>
            ${getAllRoles().map(r => `<option value="${esc(r)}" ${roleFilter === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}
          </select>` : ''}
        </div>
      </div>

      ${filter !== 'claims' ? `
      <div class="filter-bar" id="payFilterRow" style="margin-top:-6px;">
        <div class="filter-select-group">
          ${filter === 'archive' ? `
          <select id="archiveResultSelect" class="filter-select" aria-label="Result">
            <option value="all" ${archiveResult === 'all' ? 'selected' : ''}>Paid and rejected</option>
            <option value="paid" ${archiveResult === 'paid' ? 'selected' : ''}>Paid only</option>
            <option value="rejected" ${archiveResult === 'rejected' ? 'selected' : ''}>Rejected only</option>
          </select>` : `
          <select id="ageFilterSelect" class="filter-select" aria-label="Time pending">
            ${[['any', 'Any time pending'], ['1', 'Pending 1+ days'], ['3', 'Pending 3+ days'], ['7', 'Pending 7+ days'], ['14', 'Pending 14+ days'], ['30', 'Pending 30+ days']].map(([v, l]) => `<option value="${v}" ${ageFilter === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>`}
          <select id="methodFilterSelect" class="filter-select" aria-label="Payment method">
            <option value="all" ${methodFilter === 'all' ? 'selected' : ''}>Any method</option>
            ${Object.keys(PAYMENT_METHODS).map(k => `<option value="${k}" ${methodFilter === k ? 'selected' : ''}>${esc(PAYMENT_METHODS[k].label)}</option>`).join('')}
            <option value="none" ${methodFilter === 'none' ? 'selected' : ''}>No method set</option>
          </select>
          <input type="number" id="minAmountInput" class="filter-select" placeholder="Min $" min="0" step="any" value="${esc(minAmount)}" style="width:92px;" title="Minimum amount in USD (Robux converted at DevEx rate)">
          <input type="number" id="maxAmountInput" class="filter-select" placeholder="Max $" min="0" step="any" value="${esc(maxAmount)}" style="width:92px;" title="Maximum amount in USD (Robux converted at DevEx rate)">
          <select id="sortSelect" class="filter-select" aria-label="Sort">
            <option value="newest" ${sortBy === 'newest' ? 'selected' : ''}>Newest first</option>
            <option value="oldest" ${sortBy === 'oldest' ? 'selected' : ''}>Oldest first</option>
            <option value="high" ${sortBy === 'high' ? 'selected' : ''}>Amount: high to low</option>
            <option value="low" ${sortBy === 'low' ? 'selected' : ''}>Amount: low to high</option>
          </select>
        </div>
      </div>` : ''}

      ${filter === 'claims' ? `
      <div class="table-wrap" style="padding:0;">
        ${claimsLoading ? `<div class="dash-loading">Loading staff requests...</div>`
              : !claims.length ? `<div class="dash-empty"><h3>Nothing to review</h3><p>When someone asks to be paid, it turns up here.</p></div>`
                : `<div class="task-list">${claims.map(c => `
            <div class="task-row">
              <div style="flex:1;min-width:0;">
                <div class="task-title">${esc(c.task_name || 'Work')}</div>
                <div class="task-meta">
                  <span>${userLink(c.roblox_user_id, c.roblox_username)}</span>
                  <span class="pp-tag">asked for ${esc(c.currency === 'USD' ? '$' + Number(c.payment).toFixed(2) : 'R$ ' + Number(c.payment).toLocaleString())}</span>
                  ${c.game ? `<span>${esc(c.game)}</span>` : ''}
                  <span>${esc(relTime(c.created_at))}</span>
                </div>
                ${c.work_raw ? `<div class="task-details">${esc(c.work_raw)}</div>` : ''}
                <div class="claim-edit">
                  <label class="hint" for="claimAmt_${esc(c.id)}">Approve for</label>
                  <input type="number" id="claimAmt_${esc(c.id)}" value="${esc(c.payment)}" min="1" step="1">
                  <select id="claimCur_${esc(c.id)}">
                    <option value="ROBUX" ${c.currency === 'ROBUX' ? 'selected' : ''}>Robux</option>
                    <option value="USD" ${c.currency === 'USD' ? 'selected' : ''}>USD</option>
                  </select>
                  <button type="button" class="btn btn-ok btn-sm" data-claim-decide="${esc(c.id)}" data-decision="approve"${frozenAttrs()}>Approve</button>
                  <button type="button" class="btn btn-ghost btn-sm" data-claim-decide="${esc(c.id)}" data-decision="reject">Turn down</button>
                </div>
              </div>
            </div>`).join('')}</div>`}
      </div>` : ''}
      ${missingOnly ? `<div class="filter-notice">Showing pending requests with no payout method. Click a name, then the Payout tab, to add one.<button type="button" class="btn btn-ghost btn-sm" id="clearMissingBtn">Show all</button></div>` : ''}
      <div class="table-wrap" id="reqTableArea" ${filter === 'claims' ? 'hidden' : ''}>${tableHtml()}</div>
    </div>`;

        wireTopbarSignOut();
        wireTableEvents();

        document.querySelectorAll('[data-claim-decide]').forEach(el => el.addEventListener('click', async () => {
          const id = el.dataset.claimDecide;
          const decision = el.dataset.decision;
          if (!id || claimsBusy.has(id)) return;
          const amountField = document.getElementById('claimAmt_' + id);
          const curField = document.getElementById('claimCur_' + id);
          const payment = amountField ? amountField.value : null;
          const currency = curField ? curField.value : null;
          let note = null;
          if (decision === 'reject') {
            note = await askForText({
              title: 'Turn down this request',
              hint: 'The person who sent it sees this reason, so keep it clear and kind.',
              placeholder: 'For example: this was already paid under last week\'s task.',
              confirmLabel: 'Turn it down',
              required: true,
              requiredMessage: 'Write a short reason so they know what to fix.'
            });
            if (note === null) return;
          }
          claimsBusy.add(id);
          const siblings = Array.from(document.querySelectorAll('[data-claim-decide]')).filter(b => b.dataset.claimDecide === id);
          const originalLabel = el.textContent;
          siblings.forEach(b => { b.disabled = true; });
          el.textContent = decision === 'approve' ? 'Approving...' : 'Turning down...';
          const drop = () => { claims = claims.filter(c => String(c.id) !== String(id)); };
          try {
            const r = await callHrData('decide_claim', { id, decision, payment, currency, note });
            drop();
            toast(decision === 'approve' ? (r.changed ? 'Approved at the amount you set' : 'Approved') : 'Turned down');
            claimsBusy.delete(id);
            await loadClaims();
            await load(true);
          } catch (e) {
            claimsBusy.delete(id);
            const stale = e.code === 'claim_withdrawn' || e.code === 'claim_not_found'
              || e.code === 'claim_already_approved' || e.code === 'claim_already_paid';
            toast(e.message || 'That did not go through.', 'err');
            if (stale) {
              drop();
              await loadClaims();
              await load(true);
            } else {
              siblings.forEach(b => { b.disabled = false; });
              el.textContent = originalLabel;
            }
          }
        }));
        document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => {
          const wasClaims = filter === 'claims';
          filter = b.dataset.filter;
          if (missingOnly || filter === 'claims' || wasClaims) { missingOnly = false; paintShell(); return; }
          document.querySelectorAll('#dashFilterTabs .tab-btn').forEach(t => t.classList.toggle('active', t.dataset.filter === filter));
          paintTable();
        }));

        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
          searchInput.addEventListener('input', () => { search = searchInput.value; paintTable(); });
        }

        const roleFilterSelect = document.getElementById('roleFilterSelect');
        if (roleFilterSelect) {
          roleFilterSelect.addEventListener('change', () => { roleFilter = roleFilterSelect.value; paintTable(); });
        }

        const teamFilterSelect = document.getElementById('teamFilterSelect');
        if (teamFilterSelect) {
          teamFilterSelect.addEventListener('change', () => { teamFilter = teamFilterSelect.value; paintTable(); });
        }

        const skillsetFilterSelect = document.getElementById('skillsetFilterSelect');
        if (skillsetFilterSelect) {
          skillsetFilterSelect.addEventListener('change', () => { skillsetFilter = skillsetFilterSelect.value; paintTable(); });
        }

        [['archiveResultSelect', v => { archiveResult = v; }], ['ageFilterSelect', v => { ageFilter = v; }],
         ['methodFilterSelect', v => { methodFilter = v; }], ['sortSelect', v => { sortBy = v; }]].forEach(([id, set]) => {
          const el = document.getElementById(id);
          if (el) el.addEventListener('change', () => { set(el.value); paintTable(); });
        });
        [['minAmountInput', v => { minAmount = v; }], ['maxAmountInput', v => { maxAmount = v; }]].forEach(([id, set]) => {
          const el = document.getElementById(id);
          if (el) el.addEventListener('input', () => { set(el.value); paintTable(); });
        });

        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) refreshBtn.addEventListener('click', () => { load(true); });

        const missingCard = document.getElementById('missingMethodCard');
        const showMissing = () => { missingOnly = true; filter = 'pending'; paintShell(); };
        if (missingCard) {
          missingCard.addEventListener('click', showMissing);
          missingCard.addEventListener('keydown', (e) => { if (e.key === 'Enter') showMissing(); });
        }
        const clearMissingBtn = document.getElementById('clearMissingBtn');
        if (clearMissingBtn) clearMissingBtn.addEventListener('click', () => { missingOnly = false; paintShell(); });

        const copyAllBtn = document.getElementById('copyAllBtn');
        if (copyAllBtn) copyAllBtn.addEventListener('click', (e) => {
          const tsv = [TSV_HEADER, ...getRows().map(rowToTSV)].join('\n');
          copyText(tsv, e.currentTarget, 'Copied table!');
        });

        const exportXlsxBtn = document.getElementById('exportXlsxBtn');
        if (exportXlsxBtn) exportXlsxBtn.addEventListener('click', async (e) => {
          const btn = e.currentTarget;
          const original = btn.textContent;
          btn.disabled = true;
          btn.textContent = 'Building file...';
          try {
            await exportRequestsToXlsx(getRows(), filter);
          } catch (err) {
            toast("Couldn't build the spreadsheet. Check your connection (the export library loads on demand) and try again.", 'err');
          } finally {
            btn.disabled = false;
            btn.textContent = original;
          }
        });
      }

      loadClaims();

      async function loadClaims() {
        if (!hasPermission('dashboard.view')) return;
        claimsLoading = !claims.length;
        try {
          const json = await callHrData('list_claims');
          claims = json.data || [];
        } catch (e) {
          claims = [];
        }
        claimsLoading = false;
        if (myGen === renderGen) paintShell();
      }

      async function load(force) {
        loading = true; loadError = null; paintShell();
        try {
          allRequests = await loadAllRequests(force);
        } catch (err) {
          loadError = (err && err.message) ? err.message : 'Something went wrong while reading the shared request list.';
        }
        if (myGen !== renderGen) return;
        loading = false;
        paintShell();
      }

      load();
    }

    const AN_PALETTE = ['#3730D9', '#178A4C', '#B3311C', '#8A6300', '#0EA5E9', '#DB2777', '#65A30D', '#7C3AED', '#EA580C', '#0D9488'];

    function renderAnalytics() {
      if (!canSeeAnalytics()) { window.location.hash = hasPermission('dashboard.view') ? '#/dashboard' : '#/'; return; }
      const myGen = renderGen;

      let allRequests = [];
      let loading = true;
      let loadError = null;
      let lastOwedRows = [];
      const selectedOwed = new Set();
      let owedOpen = null;
      let owedBusy = false;
      const owedSaving = new Set();

      const canMarkPaid = hasPermission('dashboard.mark_paid');

      function fmtOwedTotal(usd, robux) {
        const parts = [];
        if (usd > 0) parts.push(fmtUsd(usd));
        if (robux > 0) parts.push('R$ ' + fmtRobux(robux));
        return parts.join(' + ') || '-';
      }

      let statusFilter = 'all';
      let gameFilter = 'all';
      let teamFilter = 'all';
      let skillsetFilter = 'all';
      let roleFilter = 'all';
      let currencyFilter = 'all';
      let personFilter = '';
      let dateFrom = '';
      let dateTo = '';
      let search = '';
      let groupBy = 'game';

      let exploreChartInstance = null;

      let chartMetric = 'paid_usd';
      let chartInterval = 'day';
      let chartBreakdown = 'none';
      let chartType = 'line';
      let chartSmoothing = 'none';
      let chartOverlay = 'none';
      let chartRange = '56';

      const METRICS = {
        paid_usd: { label: 'Paid amount (USD equiv.)', unit: 'usd', dateField: 'paidAt', match: r => r.status === 'paid', value: r => usdEquivalent(r) },
        paid_usd_only: { label: 'Paid amount ($ requests only)', unit: 'usd', dateField: 'paidAt', match: r => r.status === 'paid' && r.currency === 'USD', value: r => Number(r.payment) || 0 },
        paid_robux: { label: 'Paid amount (Robux requests only)', unit: 'robux', dateField: 'paidAt', match: r => r.status === 'paid' && r.currency === 'ROBUX', value: r => Number(r.payment) || 0 },
        pending_usd: { label: 'Pending amount (USD equiv.)', unit: 'usd', dateField: 'createdAt', match: r => r.status === 'pending', value: r => usdEquivalent(r) },
        pending_usd_only: { label: 'Pending amount ($ requests only)', unit: 'usd', dateField: 'createdAt', match: r => r.status === 'pending' && r.currency === 'USD', value: r => Number(r.payment) || 0 },
        pending_robux: { label: 'Pending amount (Robux requests only)', unit: 'robux', dateField: 'createdAt', match: r => r.status === 'pending' && r.currency === 'ROBUX', value: r => Number(r.payment) || 0 },
        tasks_completed: { label: 'Tasks completed', unit: 'count', dateField: 'paidAt', match: r => r.status === 'paid', value: () => 1 },
        requests_submitted: { label: 'Requests submitted', unit: 'count', dateField: 'createdAt', match: () => true, value: () => 1 },
        avg_payment: { label: 'Average payment (USD equiv.)', unit: 'usd', dateField: 'paidAt', match: r => r.status === 'paid', value: r => usdEquivalent(r), isAverage: true }
      };

      const BREAKDOWN_DIMS = {
        none: { label: 'None', fn: null },
        game: { label: 'Game', fn: r => [r.game || '(no game)'] },
        team: { label: 'Team', fn: r => splitList(r.requesterTeam).length ? splitList(r.requesterTeam) : ['(no team)'] },
        skillset: { label: 'Skillset', fn: r => splitList(r.requesterSkillset).length ? splitList(r.requesterSkillset) : ['(no skillset)'] },
        role: { label: 'Role', fn: r => (r.requesterRoles && r.requesterRoles.length) ? r.requesterRoles : ['(no role)'] },
        user: { label: 'Person', fn: r => [r.robloxUsername || '(unknown)'] }
      };

      const CHART_TYPES = [
        { key: 'line', label: 'Line chart' },
        { key: 'hbar', label: 'Horizontal bar' },
        { key: 'stacked', label: 'Stacked column' },
        { key: 'pie', label: 'Pie chart' },
        { key: 'table', label: 'Table' }
      ];

      const CHART_RANGES = [
        { key: '7', label: 'Last 7 days' },
        { key: '14', label: 'Last 14 days' },
        { key: '30', label: 'Last 30 days' },
        { key: '56', label: 'Last 56 days' },
        { key: '90', label: 'Last 90 days' },
        { key: 'all', label: 'All time' }
      ];

      function usdEquivalent(r) {
        const amt = Number(r.payment) || 0;
        return r.currency === 'USD' ? amt : amt * DEVEX_RATE;
      }

      function fmtUsd(n) {
        return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }

      function fmtRobux(n) {
        return Math.round(n).toLocaleString();
      }

      function splitList(str) {
        return str ? String(str).split(',').map(s => s.trim()).filter(Boolean) : [];
      }

      function getAllGames() {
        return Array.from(new Set(allRequests.map(r => r.game).filter(Boolean))).sort();
      }
      function getAllTeams() {
        const set = new Set();
        allRequests.forEach(r => splitList(r.requesterTeam).forEach(t => set.add(t)));
        return Array.from(set).sort();
      }
      function getAllSkillsets() {
        const set = new Set();
        allRequests.forEach(r => splitList(r.requesterSkillset).forEach(s => set.add(s)));
        return Array.from(set).sort();
      }
      function getAllRoles() {
        const set = new Set();
        allRequests.forEach(r => (r.requesterRoles || []).forEach(role => set.add(role)));
        return Array.from(set).sort();
      }
      function getAllUsers() {
        return Array.from(new Set(allRequests.map(r => r.robloxUsername).filter(Boolean))).sort((a, b) => a.localeCompare(b));
      }

      function getFilteredRows() {
        let rows = allRequests.slice();
        if (statusFilter !== 'all') rows = rows.filter(r => r.status === statusFilter);
        if (gameFilter !== 'all') rows = rows.filter(r => r.game === gameFilter);
        if (teamFilter !== 'all') rows = rows.filter(r => splitList(r.requesterTeam).includes(teamFilter));
        if (skillsetFilter !== 'all') rows = rows.filter(r => splitList(r.requesterSkillset).includes(skillsetFilter));
        if (roleFilter !== 'all') rows = rows.filter(r => (r.requesterRoles || []).includes(roleFilter));
        if (currencyFilter !== 'all') rows = rows.filter(r => r.currency === currencyFilter);
        if (personFilter.trim()) { const pq = personFilter.trim().toLowerCase(); rows = rows.filter(r => (r.robloxUsername || '').toLowerCase().includes(pq)); }
        if (dateFrom) { const from = new Date(dateFrom).getTime(); rows = rows.filter(r => (r.createdAt || 0) >= from); }
        if (dateTo) { const to = new Date(dateTo).getTime() + 24 * 60 * 60 * 1000 - 1; rows = rows.filter(r => (r.createdAt || 0) <= to); }
        if (search.trim()) {
          const q = search.trim().toLowerCase();
          rows = rows.filter(r => (r.robloxUsername || '').toLowerCase().includes(q) || (r.taskName || '').toLowerCase().includes(q) || (r.game || '').toLowerCase().includes(q) || (r.requestedBy || '').toLowerCase().includes(q));
        }
        return rows;
      }

      function computeBreakdown(rows, dimension) {
        const map = new Map();
        rows.forEach(r => {
          let labels;
          if (dimension === 'game') labels = [r.game || '(no game)'];
          else if (dimension === 'user') labels = [r.robloxUsername || '(unknown)'];
          else if (dimension === 'team') labels = splitList(r.requesterTeam).length ? splitList(r.requesterTeam) : ['(no team)'];
          else if (dimension === 'skillset') labels = splitList(r.requesterSkillset).length ? splitList(r.requesterSkillset) : ['(no skillset)'];
          else labels = (r.requesterRoles && r.requesterRoles.length) ? r.requesterRoles : ['(no role)'];
          const amt = usdEquivalent(r);
          const robuxAmt = r.currency === 'ROBUX' ? (Number(r.payment) || 0) : 0;
          const usdAmt = r.currency === 'USD' ? (Number(r.payment) || 0) : 0;
          labels.forEach(l => {
            const cur = map.get(l) || { amount: 0, robux: 0, usd: 0, count: 0 };
            cur.amount += amt;
            cur.robux += robuxAmt;
            cur.usd += usdAmt;
            cur.count += 1;
            map.set(l, cur);
          });
        });
        return Array.from(map.entries()).map(([label, v]) => ({ label, ...v })).sort((a, b) => b.amount - a.amount);
      }

      function ownerKey(r) {
        return r.robloxUserId != null ? ('id:' + r.robloxUserId) : ('name:' + (r.robloxUsername || '').toLowerCase());
      }

      function computeOwed(rows) {
        const map = new Map();
        rows.filter(r => r.status === 'pending').forEach(r => {
          const key = ownerKey(r);
          const cur = map.get(key) || { key, reqs: [], robloxUserId: r.robloxUserId, robloxUsername: null, robux: 0, usd: 0, count: 0, paymentMethod: null, sampleRequestId: null };
          cur.reqs.push(r);
          if (r.currency === 'ROBUX') cur.robux += Number(r.payment) || 0; else cur.usd += Number(r.payment) || 0;
          cur.count += 1;
          if (!cur.robloxUsername && r.robloxUsername) cur.robloxUsername = r.robloxUsername;
          if (!cur.paymentMethod && r.paymentMethod) { cur.paymentMethod = r.paymentMethod; cur.sampleRequestId = r.id; }
          if (cur.robloxUserId == null && r.robloxUserId != null) cur.robloxUserId = r.robloxUserId;
          map.set(key, cur);
        });
        return Array.from(map.values()).map(v => ({ ...v, user: v.robloxUsername || '(unknown)', total: v.robux * DEVEX_RATE + v.usd })).sort((a, b) => b.total - a.total);
      }

      function computeEarnings(rows) {
        const map = new Map();
        rows.filter(r => r.status === 'paid').forEach(r => {
          const key = ownerKey(r);
          const cur = map.get(key) || { robloxUserId: r.robloxUserId, robloxUsername: null, robux: 0, usd: 0, tasks: 0 };
          if (r.currency === 'ROBUX') cur.robux += Number(r.payment) || 0; else cur.usd += Number(r.payment) || 0;
          cur.tasks += 1;
          if (!cur.robloxUsername && r.robloxUsername) cur.robloxUsername = r.robloxUsername;
          if (cur.robloxUserId == null && r.robloxUserId != null) cur.robloxUserId = r.robloxUserId;
          map.set(key, cur);
        });
        return Array.from(map.values()).map(v => ({ ...v, user: v.robloxUsername || '(unknown)', total: v.robux * DEVEX_RATE + v.usd })).sort((a, b) => b.total - a.total);
      }

      const GROUP_LABELS = { game: 'game', skillset: 'skillset', role: 'role', team: 'team', user: 'person' };

      function bucketDate(ts, interval) {
        const d = new Date(ts);
        if (interval === 'week') {
          const monday = new Date(d);
          monday.setHours(0, 0, 0, 0);
          monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
          return { key: monday.toISOString().slice(0, 10), sort: monday.getTime(), label: monday.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) };
        }
        if (interval === 'month') {
          const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
          return { key, sort: d.getFullYear() * 12 + d.getMonth(), label: d.toLocaleString(undefined, { month: 'short', year: '2-digit' }) };
        }
        const day = new Date(d); day.setHours(0, 0, 0, 0);
        return { key: day.toISOString().slice(0, 10), sort: day.getTime(), label: day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) };
      }

      function fmtMetric(metric, n) {
        if (metric.unit === 'usd') return fmtUsd(n);
        if (metric.unit === 'robux') return fmtRobux(n) + ' R$';
        return Math.round(n).toLocaleString();
      }

      function movingAverage(data, window) {
        return data.map((_, i) => {
          const start = Math.max(0, i - window + 1);
          const slice = data.slice(start, i + 1);
          return slice.reduce((a, b) => a + b, 0) / slice.length;
        });
      }

      function chartRangeWindow() {
        if (chartRange === 'all') return null;
        const days = Number(chartRange);
        const to = Date.now();
        return { from: to - days * 24 * 60 * 60 * 1000, to };
      }

      function buildChartData(rows) {
        const metric = METRICS[chartMetric];
        const dim = BREAKDOWN_DIMS[chartBreakdown];
        let eligible = rows.filter(metric.match).filter(r => r[metric.dateField]);
        const win = chartRangeWindow();
        if (win) eligible = eligible.filter(r => r[metric.dateField] >= win.from && r[metric.dateField] <= win.to);

        let categories;
        if (!dim.fn) {
          categories = ['Total'];
        } else {
          const totals = new Map();
          eligible.forEach(r => dim.fn(r).forEach(l => totals.set(l, (totals.get(l) || 0) + metric.value(r))));
          const sorted = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]).map(([l]) => l);
          categories = sorted.slice(0, 6);
          if (sorted.length > 6) categories = [...categories, 'Other'];
        }

        const bucketMap = new Map();
        eligible.forEach(r => {
          const b = bucketDate(r[metric.dateField], chartInterval);
          let entry = bucketMap.get(b.key);
          if (!entry) { entry = { sort: b.sort, label: b.label, cats: new Map() }; bucketMap.set(b.key, entry); }
          const labels = dim.fn ? dim.fn(r) : ['Total'];
          const val = metric.value(r);
          labels.forEach(l => {
            const catKey = categories.includes(l) ? l : (categories.includes('Other') ? 'Other' : null);
            if (!catKey) return;
            const cur = entry.cats.get(catKey) || { sum: 0, count: 0 };
            cur.sum += val; cur.count += 1;
            entry.cats.set(catKey, cur);
          });
        });

        const buckets = Array.from(bucketMap.values()).sort((a, b) => a.sort - b.sort);
        const labels = buckets.map(b => b.label);
        const series = categories.map(cat => ({
          label: cat,
          data: buckets.map(b => {
            const c = b.cats.get(cat);
            if (!c) return 0;
            return metric.isAverage ? (c.count ? c.sum / c.count : 0) : c.sum;
          })
        }));

        const totalsPerCat = categories.map(cat => {
          let sum = 0, count = 0;
          buckets.forEach(b => { const c = b.cats.get(cat); if (c) { sum += c.sum; count += c.count; } });
          return { label: cat, value: metric.isAverage ? (count ? sum / count : 0) : sum, count };
        });

        const overallValue = metric.isAverage
          ? (eligible.length ? eligible.reduce((s, r) => s + metric.value(r), 0) / eligible.length : 0)
          : eligible.reduce((s, r) => s + metric.value(r), 0);

        return { labels, series, categories, totalsPerCat, overallValue, eligibleCount: eligible.length };
      }

      function computePreviousPeriodSeries(bucketCount) {
        const win = chartRangeWindow();
        if (!win) return null;
        const span = win.to - win.from;
        const prevTo = win.from - 1;
        const prevFrom = prevTo - span;
        const metric = METRICS[chartMetric];
        const prevRows = allRequests.filter(metric.match).filter(r => r[metric.dateField] && r[metric.dateField] >= prevFrom && r[metric.dateField] <= prevTo);
        const bucketMap = new Map();
        prevRows.forEach(r => {
          const b = bucketDate(r[metric.dateField], chartInterval);
          const cur = bucketMap.get(b.key) || { sort: b.sort, sum: 0, count: 0 };
          cur.sum += metric.value(r); cur.count += 1;
          bucketMap.set(b.key, cur);
        });
        const buckets = Array.from(bucketMap.values()).sort((a, b) => a.sort - b.sort);
        const values = buckets.map(b => metric.isAverage ? (b.count ? b.sum / b.count : 0) : b.sum);
        const aligned = [];
        for (let i = 0; i < bucketCount; i++) aligned.push(values[i] !== undefined ? values[i] : 0);
        return aligned;
      }

      function renderChartTableHtml(chartData) {
        if (!chartData.labels.length) return `<div class="chart-empty">No data for this metric in the selected range.</div>`;
        const metric = METRICS[chartMetric];
        return `<div class="table-wrap an-table-wrap explore-table-wrap"><div class="table-scroll"><table class="an-table">
          <thead><tr><th>Period</th>${chartData.series.map(s => `<th class="num-cell">${esc(s.label)}</th>`).join('')}</tr></thead>
          <tbody>${chartData.labels.map((lab, i) => `<tr><td>${esc(lab)}</td>${chartData.series.map(s => `<td class="num-cell">${fmtMetric(metric, s.data[i])}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div></div>`;
      }

      function renderExplorePanelHtml(chartData) {
        const metric = METRICS[chartMetric];
        return `
      <div class="explore-panel">
        <div class="explore-sidebar">
          <div class="explore-panel-title">Configure chart</div>
          <div class="explore-field">
            <label>Metric</label>
            <select id="chartMetricSelect" class="explore-select">
              ${Object.entries(METRICS).map(([k, m]) => `<option value="${k}" ${chartMetric === k ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}
            </select>
          </div>
          <div class="explore-field">
            <label>Time interval</label>
            <select id="chartIntervalSelect" class="explore-select">
              <option value="day" ${chartInterval === 'day' ? 'selected' : ''}>Days</option>
              <option value="week" ${chartInterval === 'week' ? 'selected' : ''}>Weeks</option>
              <option value="month" ${chartInterval === 'month' ? 'selected' : ''}>Months</option>
            </select>
          </div>
          <div class="explore-field">
            <label>Breakdown by</label>
            <select id="chartBreakdownSelect" class="explore-select">
              ${Object.entries(BREAKDOWN_DIMS).map(([k, d]) => `<option value="${k}" ${chartBreakdown === k ? 'selected' : ''}>${esc(d.label)}</option>`).join('')}
            </select>
          </div>
          <div class="explore-field">
            <label>Chart type</label>
            <div class="explore-chart-types">
              ${CHART_TYPES.filter(c => c.key !== 'table').map(c => `<button type="button" class="explore-chart-type-btn ${chartType === c.key ? 'active' : ''}" data-chart-type="${c.key}">${esc(c.label)}</button>`).join('')}
            </div>
            <button type="button" class="explore-chart-type-btn explore-chart-type-full ${chartType === 'table' ? 'active' : ''}" data-chart-type="table">Table</button>
          </div>
          <div class="explore-field">
            <label>Smoothing</label>
            <div class="explore-radio-group">
              <label class="explore-radio"><input type="radio" name="chartSmoothing" value="none" ${chartSmoothing === 'none' ? 'checked' : ''}> None</label>
              <label class="explore-radio"><input type="radio" name="chartSmoothing" value="ma7" ${chartSmoothing === 'ma7' ? 'checked' : ''}> 7-period moving avg</label>
            </div>
          </div>
          <div class="explore-field">
            <label>Overlay</label>
            <div class="explore-radio-group">
              <label class="explore-radio"><input type="radio" name="chartOverlay" value="none" ${chartOverlay === 'none' ? 'checked' : ''}> None</label>
              <label class="explore-radio ${chartBreakdown !== 'none' ? 'explore-radio-disabled' : ''}"><input type="radio" name="chartOverlay" value="previous" ${chartOverlay === 'previous' ? 'checked' : ''} ${chartBreakdown !== 'none' ? 'disabled' : ''}> Previous period</label>
            </div>
          </div>
        </div>
        <div class="explore-main">
          <div class="explore-main-head">
            <div>
              <div class="explore-metric-title">${esc(metric.label)}${chartBreakdown !== 'none' ? ` by ${esc(BREAKDOWN_DIMS[chartBreakdown].label.toLowerCase())}` : ''}</div>
              <div class="explore-metric-sub">Total over selected period</div>
              <div class="explore-big-number">${fmtMetric(metric, chartData.overallValue)}</div>
            </div>
            <select id="chartRangeSelect" class="explore-select explore-range-select">
              ${CHART_RANGES.map(o => `<option value="${o.key}" ${chartRange === o.key ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
            </select>
          </div>
          ${chartType === 'table' ? renderChartTableHtml(chartData) : (chartData.eligibleCount ? `<div class="explore-chart-area"><canvas id="exploreChart"></canvas></div>` : `<div class="chart-empty">No data for this metric in the selected range.</div>`)}
        </div>
      </div>`;
      }

      function renderLoadingOrError() {
        app.innerHTML = `
    ${topbar()}
    <div class="dash-shell">
      <div class="dash-head">
        <div>
          <h1 style="margin-bottom:4px;">Analytics</h1>
          <p class="sub">Payment activity, filterable and broken down any way you need.</p>
        </div>
      </div>
      ${loading ? `<div class="dash-loading">Loading payment requests...</div>` : `
      <div class="dash-empty"><h3>Could not load requests</h3><p>${esc(loadError)}</p><button type="button" class="btn btn-ghost btn-sm" id="retryBtn">Try again</button></div>`}
    </div>`;
        wireTopbarSignOut();
        const retryBtn = document.getElementById('retryBtn');
        if (retryBtn) retryBtn.addEventListener('click', () => { load(); });
      }

      function renderShell() {
        app.innerHTML = `
    ${topbar()}
    <div class="dash-shell">
      <div class="dash-head">
        <div>
          <h1 style="margin-bottom:4px;">Analytics</h1>
          <p class="sub">Payment activity, filterable and broken down any way you need.</p>
        </div>
        <div class="dash-toolbar">
          <button type="button" class="btn btn-ghost btn-sm" id="refreshBtn">Refresh</button>
        </div>
      </div>

      <div class="filter-bar">
        <div class="search-input-wrap person-input-wrap">
          <input type="text" id="personFilterInput" list="personListDatalist" placeholder="Filter by person" value="${esc(personFilter)}" autocomplete="off">
          <datalist id="personListDatalist">
            ${getAllUsers().map(u => `<option value="${esc(u)}"></option>`).join('')}
          </datalist>
        </div>
        <div class="search-input-wrap">
          <input type="text" id="searchInput" placeholder="Search by task or game" value="${esc(search)}">
        </div>
        <div class="filter-select-group">
          <select id="statusFilterSelect" class="filter-select">
            <option value="all" ${statusFilter === 'all' ? 'selected' : ''}>All statuses</option>
            <option value="pending" ${statusFilter === 'pending' ? 'selected' : ''}>Pending</option>
            <option value="paid" ${statusFilter === 'paid' ? 'selected' : ''}>Paid</option>
            <option value="rejected" ${statusFilter === 'rejected' ? 'selected' : ''}>Rejected</option>
          </select>
          <select id="currencyFilterSelect" class="filter-select">
            <option value="all" ${currencyFilter === 'all' ? 'selected' : ''}>All currencies</option>
            <option value="ROBUX" ${currencyFilter === 'ROBUX' ? 'selected' : ''}>Robux</option>
            <option value="USD" ${currencyFilter === 'USD' ? 'selected' : ''}>USD</option>
          </select>
          ${getAllGames().length ? `
          <select id="gameFilterSelect" class="filter-select">
            <option value="all" ${gameFilter === 'all' ? 'selected' : ''}>All games</option>
            ${getAllGames().map(g => `<option value="${esc(g)}" ${gameFilter === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}
          </select>` : ''}
          ${getAllTeams().length ? `
          <select id="teamFilterSelect" class="filter-select">
            <option value="all" ${teamFilter === 'all' ? 'selected' : ''}>All teams</option>
            ${getAllTeams().map(t => `<option value="${esc(t)}" ${teamFilter === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
          </select>` : ''}
          ${getAllSkillsets().length ? `
          <select id="skillsetFilterSelect" class="filter-select">
            <option value="all" ${skillsetFilter === 'all' ? 'selected' : ''}>All skillsets</option>
            ${getAllSkillsets().map(s => `<option value="${esc(s)}" ${skillsetFilter === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
          </select>` : ''}
          ${getAllRoles().length ? `
          <select id="roleFilterSelect" class="filter-select">
            <option value="all" ${roleFilter === 'all' ? 'selected' : ''}>All roles</option>
            ${getAllRoles().map(r => `<option value="${esc(r)}" ${roleFilter === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}
          </select>` : ''}
          <input type="date" id="dateFromInput" class="filter-select date-select" value="${esc(dateFrom)}" title="From date">
          <input type="date" id="dateToInput" class="filter-select date-select" value="${esc(dateTo)}" title="To date">
        </div>
      </div>

      <div id="anContent"></div>

      <div class="footer-note">Robux amounts are converted to USD for charts and totals using the current DevEx rate (${(DEVEX_RATE * 10000).toFixed(2)} USD per 10,000 Robux). Tables show raw amounts per currency.</div>
    </div>`;

        wireTopbarSignOut();
        wireShellEvents();
        paintContent();
      }

      function buildContentHtml(data) {
        const { pendingRobux, pendingUsd, paidRobux, paidUsd, paidUsdEquiv, paidCount, chartData, breakdownRows, owedRows, earningsRows } = data;
        return `
      <div class="stat-strip">
        <div class="strip-card">
          <div class="strip-label">Pending Robux</div>
          <div class="strip-value"><img src="${ROBUX_IMG}" alt="Robux">${fmtRobux(pendingRobux)}</div>
        </div>
        <div class="strip-card">
          <div class="strip-label">Pending USD</div>
          <div class="strip-value">${fmtUsd(pendingUsd)}</div>
        </div>
        <div class="strip-card">
          <div class="strip-label">Paid Robux</div>
          <div class="strip-value"><img src="${ROBUX_IMG}" alt="Robux">${fmtRobux(paidRobux)}</div>
        </div>
        <div class="strip-card">
          <div class="strip-label">Paid USD</div>
          <div class="strip-value">${fmtUsd(paidUsd)}</div>
        </div>
        <div class="strip-card">
          <div class="strip-label">Paid out (USD equiv.)</div>
          <div class="strip-value">${fmtUsd(paidUsdEquiv)}</div>
        </div>
        <div class="strip-card">
          <div class="strip-label">Tasks completed</div>
          <div class="strip-value">${paidCount}</div>
        </div>
      </div>

      ${renderExplorePanelHtml(chartData)}

      <div class="an-section-title">Who's owed what (pending requests)</div>
      ${canMarkPaid && owedRows.length ? (() => {
        const sel = owedRows.filter(o => selectedOwed.has(o.key));
        const selUsd = sel.reduce((s, o) => s + o.usd, 0);
        const selRobux = sel.reduce((s, o) => s + o.robux, 0);
        return `<div class="filter-notice" id="owedBar" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px;">
          <span>${sel.length ? `<strong>${sel.length}</strong> selected, owed <strong>${esc(fmtOwedTotal(selUsd, selRobux))}</strong> in total` : 'Tick the people you are paying, then press Pay selected.'}</span>
          ${sel.length ? `<button type="button" class="btn btn-ghost btn-sm" id="owedClear">Clear</button>` : ''}
          <button type="button" class="btn btn-ok btn-sm" id="paySelectedBtn" ${sel.length && !owedBusy ? '' : 'disabled'}${frozenAttrs()}>${owedBusy ? 'Paying...' : 'Pay selected'}</button>
        </div>`;
      })() : ''}
      <div class="table-wrap an-table-wrap">
        <div class="table-scroll">
          ${owedRows.length ? `
          <table class="an-table">
            <thead><tr>${canMarkPaid ? `<th style="width:34px;"><input type="checkbox" id="owedSelectAll" aria-label="Select everyone" ${owedRows.length && owedRows.every(o => selectedOwed.has(o.key)) ? 'checked' : ''}></th>` : ''}<th>Person</th><th>Payment method</th><th class="num-cell">Owed in total</th><th class="num-cell">Requests</th>${canMarkPaid ? '<th></th>' : ''}</tr></thead>
            <tbody>
              ${owedRows.map((o, i) => `<tr class="${selectedOwed.has(o.key) ? 'owed-selected' : ''}">${canMarkPaid ? `<td><input type="checkbox" data-owed-select="${i}" aria-label="Select ${esc(o.user)}" ${selectedOwed.has(o.key) ? 'checked' : ''}></td>` : ''}<td>${esc(o.user || '-')}</td><td>${o.paymentMethod ? `<div class="method-note has-method"${methodHiddenTitle(o.paymentMethod)}>${esc(methodDisplayLabel(o.paymentMethod))}${o.paymentMethod.method === 'BANK_TRANSFER' && !o.paymentMethod.detailsHidden ? ` <button type="button" class="pp-linkbtn" data-bank-details="${esc(o.sampleRequestId)}">Payment details</button>` : ''}</div>` : `<span class="method-note missing-method">Not set</span>`}</td><td class="num-cell"><strong>${esc(fmtOwedTotal(o.usd, o.robux))}</strong></td><td class="num-cell">${o.count}</td>${canMarkPaid ? `<td style="white-space:nowrap;"><button type="button" class="btn btn-ghost btn-sm" data-owed-open="${i}">${owedOpen === o.key ? 'Close' : 'Edit'}</button> <button type="button" class="btn btn-ok btn-sm" data-mark-all-paid="${i}"${frozenAttrs()}>Mark all paid</button></td>` : ''}</tr>${owedOpen === o.key ? `<tr class="detail-row"><td colspan="${canMarkPaid ? 6 : 4}">
                ${o.reqs.map(r => `<div class="claim-edit" style="margin:6px 0;align-items:center;">
                  <span style="flex:1;min-width:140px;"><strong>${esc(r.taskName || 'Untitled task')}</strong>${r.game ? ` <span class="hint">${esc(r.game)}</span>` : ''}</span>
                  <input type="number" id="owedAmt_${esc(r.id)}" value="${esc(r.payment)}" min="0.01" step="any" aria-label="Amount">
                  <select id="owedCur_${esc(r.id)}" aria-label="Currency">
                    <option value="ROBUX" ${r.currency === 'ROBUX' ? 'selected' : ''}>Robux</option>
                    <option value="USD" ${r.currency === 'USD' ? 'selected' : ''}>USD</option>
                  </select>
                  <button type="button" class="btn btn-ghost btn-sm" data-owed-save="${esc(r.id)}" ${owedSaving.has(r.id) ? 'disabled' : ''}>${owedSaving.has(r.id) ? 'Saving...' : 'Save amount'}</button>
                  <button type="button" class="btn btn-ok btn-sm" data-owed-pay="${esc(r.id)}" ${owedSaving.has(r.id) ? 'disabled' : ''}${frozenAttrs()}>Paid</button>
                </div>`).join('')}
              </td></tr>` : ''}`).join('')}
            </tbody>
          </table>` : `<div class="dash-empty"><h3>Nothing owed</h3><p>No pending requests match these filters.</p></div>`}
        </div>
      </div>

      <div class="an-section-title">Earnings &amp; tasks completed by person</div>
      <div class="table-wrap an-table-wrap">
        <div class="table-scroll">
          ${earningsRows.length ? `
          <table class="an-table">
            <thead><tr><th>Person</th><th class="num-cell">Total earned (USD equiv.)</th><th class="num-cell">Paid Robux</th><th class="num-cell">Paid USD</th><th class="num-cell">Tasks completed</th></tr></thead>
            <tbody>
              ${earningsRows.map(o => `<tr><td>${esc(o.user || '-')}</td><td class="num-cell"><strong>${fmtUsd(o.total)}</strong></td><td class="num-cell">${fmtRobux(o.robux)}</td><td class="num-cell">${fmtUsd(o.usd)}</td><td class="num-cell">${o.tasks}</td></tr>`).join('')}
            </tbody>
          </table>` : `<div class="dash-empty"><h3>No paid requests</h3><p>No paid requests match these filters.</p></div>`}
        </div>
      </div>

      <div class="an-section-title">Breakdown by ${esc(GROUP_LABELS[groupBy])}</div>
      <div class="table-wrap an-table-wrap">
        <div class="table-scroll">
          ${breakdownRows.length ? `
          <table class="an-table">
            <thead><tr><th>${esc(GROUP_LABELS[groupBy].charAt(0).toUpperCase() + GROUP_LABELS[groupBy].slice(1))}</th><th class="num-cell">Total (USD equiv.)</th><th class="num-cell">Robux</th><th class="num-cell">USD</th><th class="num-cell">Requests</th></tr></thead>
            <tbody>
              ${breakdownRows.map(b => `<tr><td>${esc(b.label)}</td><td class="num-cell"><strong>${fmtUsd(b.amount)}</strong></td><td class="num-cell">${b.robux ? fmtRobux(b.robux) : '-'}</td><td class="num-cell">${b.usd ? fmtUsd(b.usd) : '-'}</td><td class="num-cell">${b.count}</td></tr>`).join('')}
            </tbody>
          </table>` : `<div class="dash-empty"><h3>Nothing to show</h3><p>No requests match these filters.</p></div>`}
        </div>
      </div>`;
      }

      function paintContent() {
        const contentEl = document.getElementById('anContent');
        if (!contentEl) return;

        const rows = getFilteredRows();
        const pendingRows = rows.filter(r => r.status === 'pending');
        const paidRows = rows.filter(r => r.status === 'paid');
        const pendingRobux = pendingRows.filter(r => r.currency === 'ROBUX').reduce((s, r) => s + (Number(r.payment) || 0), 0);
        const pendingUsd = pendingRows.filter(r => r.currency === 'USD').reduce((s, r) => s + (Number(r.payment) || 0), 0);
        const paidRobux = paidRows.filter(r => r.currency === 'ROBUX').reduce((s, r) => s + (Number(r.payment) || 0), 0);
        const paidUsd = paidRows.filter(r => r.currency === 'USD').reduce((s, r) => s + (Number(r.payment) || 0), 0);
        const paidUsdEquiv = paidRows.reduce((s, r) => s + usdEquivalent(r), 0);

        const owedRows = computeOwed(rows);
        const earningsRows = computeEarnings(rows);
        const breakdownRows = computeBreakdown(rows, groupBy);
        const chartData = buildChartData(rows);
        lastOwedRows = owedRows;

        contentEl.innerHTML = buildContentHtml({ pendingRobux, pendingUsd, paidRobux, paidUsd, paidUsdEquiv, paidCount: paidRows.length, chartData, breakdownRows, owedRows, earningsRows });

        document.querySelectorAll('.an-toggle-btn').forEach(b => b.addEventListener('click', () => { groupBy = b.dataset.group; paintContent(); }));
        document.querySelectorAll('[data-mark-all-paid]').forEach(b => b.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const idx = Number(b.dataset.markAllPaid);
          const o = lastOwedRows[idx];
          if (!o) return;
          const btn = e.currentTarget;
          btn.disabled = true;
          btn.textContent = 'Saving...';
          try {
            await markAllPaid(o.robloxUserId, o.robloxUsername);
            allRequests = await loadAllRequests();
            if (myGen !== renderGen) return;
            paintContent();
          } catch (err) {
            btn.disabled = false;
            btn.textContent = 'Mark all paid';
            toast((err && err.message) || 'Could not save.', 'err');
          }
        }));
        const reloadAfter = async () => {
          allRequests = await loadAllRequests();
        };
        const selAll = document.getElementById('owedSelectAll');
        if (selAll) selAll.addEventListener('change', () => {
          lastOwedRows.forEach(o => { if (selAll.checked) selectedOwed.add(o.key); else selectedOwed.delete(o.key); });
          paintContent();
        });
        document.querySelectorAll('[data-owed-select]').forEach(c => c.addEventListener('change', () => {
          const o = lastOwedRows[Number(c.dataset.owedSelect)];
          if (!o) return;
          if (c.checked) selectedOwed.add(o.key); else selectedOwed.delete(o.key);
          paintContent();
        }));
        const owedClear = document.getElementById('owedClear');
        if (owedClear) owedClear.addEventListener('click', () => { selectedOwed.clear(); paintContent(); });
        document.querySelectorAll('[data-owed-open]').forEach(b => b.addEventListener('click', () => {
          const o = lastOwedRows[Number(b.dataset.owedOpen)];
          if (!o) return;
          owedOpen = owedOpen === o.key ? null : o.key;
          paintContent();
        }));
        document.querySelectorAll('[data-owed-save]').forEach(b => b.addEventListener('click', async () => {
          const id = b.dataset.owedSave;
          const amt = Number((document.getElementById('owedAmt_' + id) || {}).value);
          const cur = (document.getElementById('owedCur_' + id) || {}).value;
          if (!(amt > 0) || !cur) { toast('Enter an amount above zero.', 'err'); return; }
          owedSaving.add(id); paintContent();
          try {
            const res = await editRequestAmount(id, amt, cur);
            const r = allRequests.find(x => String(x.id) === String(id));
            if (r) { r.payment = res.payment; r.currency = res.currency; }
            toast('Amount updated.');
          } catch (err) {
            toast(err.message || 'Could not change that amount.', 'err');
          }
          owedSaving.delete(id);
          if (myGen === renderGen) paintContent();
        }));
        document.querySelectorAll('[data-owed-pay]').forEach(b => b.addEventListener('click', async () => {
          const id = b.dataset.owedPay;
          owedSaving.add(id); paintContent();
          try {
            await updateRequest({ id });
            await reloadAfter();
            toast('Marked paid.');
          } catch (err) {
            toast(err.message || 'Could not save. Check your connection and try again.', 'err');
          }
          owedSaving.delete(id);
          if (myGen === renderGen) paintContent();
        }));
        const paySel = document.getElementById('paySelectedBtn');
        if (paySel) paySel.addEventListener('click', async () => {
          const sel = lastOwedRows.filter(o => selectedOwed.has(o.key));
          if (!sel.length || owedBusy) return;
          const totalUsd = sel.reduce((s, o) => s + o.usd, 0);
          const totalRobux = sel.reduce((s, o) => s + o.robux, 0);
          if (!(await askConfirm(`Mark ${sel.length} ${sel.length === 1 ? 'person' : 'people'} as paid (${fmtOwedTotal(totalUsd, totalRobux)} in total)?`))) return;
          owedBusy = true; paintContent();
          let done = 0; const failed = [];
          for (const o of sel) {
            try { await markAllPaid(o.robloxUserId, o.robloxUsername); done++; selectedOwed.delete(o.key); }
            catch (err) { failed.push(o.user); }
          }
          try { await reloadAfter(); } catch (e) { }
          owedBusy = false;
          if (myGen !== renderGen) return;
          toast(failed.length ? `Paid ${done}. Could not pay: ${failed.join(', ')}.` : `Marked ${done} ${done === 1 ? 'person' : 'people'} as paid.`, failed.length ? 'err' : undefined);
          paintContent();
        });
        wireBankDetails((id) => allRequests.find(r => String(r.id) === String(id)));
        wireExploreEvents();

        drawExploreChart(chartData);
      }

      function wireShellEvents() {
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) refreshBtn.addEventListener('click', () => { load(true); });

        const searchInput = document.getElementById('searchInput');
        if (searchInput) searchInput.addEventListener('input', () => { search = searchInput.value; paintContent(); });

        const personFilterInput = document.getElementById('personFilterInput');
        if (personFilterInput) personFilterInput.addEventListener('input', () => { personFilter = personFilterInput.value; paintContent(); });

        const bind = (id, setter) => {
          const el = document.getElementById(id);
          if (el) el.addEventListener('change', () => { setter(el.value); paintContent(); });
        };
        bind('statusFilterSelect', v => statusFilter = v);
        bind('gameFilterSelect', v => gameFilter = v);
        bind('teamFilterSelect', v => teamFilter = v);
        bind('skillsetFilterSelect', v => skillsetFilter = v);
        bind('roleFilterSelect', v => roleFilter = v);
        bind('currencyFilterSelect', v => currencyFilter = v);
        bind('dateFromInput', v => dateFrom = v);
        bind('dateToInput', v => dateTo = v);
      }

      function wireExploreEvents() {
        const bindChart = (id, setter) => {
          const el = document.getElementById(id);
          if (el) el.addEventListener('change', () => { setter(el.value); paintContent(); });
        };
        bindChart('chartMetricSelect', v => chartMetric = v);
        bindChart('chartIntervalSelect', v => chartInterval = v);
        bindChart('chartBreakdownSelect', v => { chartBreakdown = v; if (v !== 'none') chartOverlay = 'none'; });
        bindChart('chartRangeSelect', v => chartRange = v);

        document.querySelectorAll('.explore-chart-type-btn').forEach(b => b.addEventListener('click', () => { chartType = b.dataset.chartType; paintContent(); }));
        document.querySelectorAll('input[name="chartSmoothing"]').forEach(r => r.addEventListener('change', () => { chartSmoothing = r.value; paintContent(); }));
        document.querySelectorAll('input[name="chartOverlay"]').forEach(r => r.addEventListener('change', () => { if (!r.disabled) { chartOverlay = r.value; paintContent(); } }));
      }

      function drawExploreChart(chartData) {
        if (exploreChartInstance) { exploreChartInstance.destroy(); exploreChartInstance = null; }
        if (chartType === 'table' || typeof Chart === 'undefined') return;

        const canvas = document.getElementById('exploreChart');
        if (!canvas || !chartData.eligibleCount) return;

        const metric = METRICS[chartMetric];
        const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--line').trim() || '#E4E7ED';
        const inkColor = getComputedStyle(document.documentElement).getPropertyValue('--ink-soft').trim() || '#5B616E';
        const valueTick = v => metric.unit === 'usd' ? '$' + v : (metric.unit === 'robux' ? v + ' R$' : v);

        if (chartType === 'pie') {
          const top = chartData.totalsPerCat;
          exploreChartInstance = new Chart(canvas, {
            type: 'pie',
            data: {
              labels: top.map(t => t.label),
              datasets: [{
                data: top.map(t => Number(t.value.toFixed(2))),
                backgroundColor: top.map((_, i) => AN_PALETTE[i % AN_PALETTE.length])
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { position: 'bottom', labels: { color: inkColor, boxWidth: 11, font: { size: 11 } } } }
            }
          });
          return;
        }

        if (chartType === 'hbar') {
          const top = chartData.totalsPerCat.slice(0, 12);
          exploreChartInstance = new Chart(canvas, {
            type: 'bar',
            data: {
              labels: top.map(t => t.label),
              datasets: [{
                data: top.map(t => Number(t.value.toFixed(2))),
                backgroundColor: top.map((_, i) => AN_PALETTE[i % AN_PALETTE.length]),
                borderRadius: 6,
                maxBarThickness: 26
              }]
            },
            options: {
              indexAxis: 'y',
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: {
                x: { grid: { color: gridColor }, ticks: { color: inkColor, callback: valueTick } },
                y: { grid: { display: false }, ticks: { color: inkColor } }
              }
            }
          });
          return;
        }

        const stacked = chartType === 'stacked';
        const datasets = chartData.series.map((s, i) => ({
          label: s.label,
          data: chartSmoothing === 'ma7' && chartType === 'line' ? movingAverage(s.data, 7) : s.data,
          borderColor: AN_PALETTE[i % AN_PALETTE.length],
          backgroundColor: stacked ? AN_PALETTE[i % AN_PALETTE.length] : AN_PALETTE[i % AN_PALETTE.length] + (chartData.series.length === 1 ? '33' : '00'),
          fill: chartType === 'line' ? chartData.series.length === 1 : true,
          tension: .3,
          borderWidth: 2,
          pointRadius: chartData.labels.length > 40 ? 0 : 3,
          maxBarThickness: 46
        }));

        if (chartType === 'line' && chartOverlay === 'previous' && chartBreakdown === 'none') {
          const prev = computePreviousPeriodSeries(chartData.labels.length);
          if (prev) {
            datasets.push({
              label: 'Previous period',
              data: prev,
              borderColor: inkColor,
              backgroundColor: 'transparent',
              borderDash: [5, 4],
              fill: false,
              tension: .3,
              borderWidth: 2,
              pointRadius: 0
            });
          }
        }

        exploreChartInstance = new Chart(canvas, {
          type: chartType === 'stacked' ? 'bar' : 'line',
          data: { labels: chartData.labels, datasets },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: datasets.length > 1, position: 'bottom', labels: { color: inkColor, boxWidth: 11, font: { size: 11 } } } },
            scales: {
              x: { grid: { color: gridColor }, ticks: { color: inkColor }, stacked },
              y: { grid: { color: gridColor }, ticks: { color: inkColor, callback: valueTick }, stacked }
            }
          }
        });
      }

      async function load() {
        loading = true; loadError = null; renderLoadingOrError();
        try {
          allRequests = await loadAllRequests();
        } catch (err) {
          loadError = (err && err.message) ? err.message : 'Something went wrong while reading the shared request list.';
        }
        if (myGen !== renderGen) return;
        loading = false;
        if (loadError) { renderLoadingOrError(); } else { renderShell(); }
      }

      load();
    }

    function renderMyPayments() {
      const myGen = renderGen;
      let summary = null;
      let summarySplit = null;
      let loading = true;
      let loadError = null;

      let method = null;
      let methodLoading = true;
      let selectedMethod = 'PAYPAL';
      let methodDetails = {};
      let savingMethod = false;
      let methodError = null;
      let methodSaved = false;
      let splitPercent = 0;
      let splitSaving = false;

      let eligibility = [];
      let eligibilityLoading = true;
      let eligibilityError = null;

      let usdEligibility = null;

      let discordLink = null;
      let discordLinkLoading = true;
      let unlinkingDiscord = false;
      let discordLinkMsg = null;

      let warnings = [];
      let warningsLoading = true;
      let warningsError = null;

      let myBroadcasts = [];
      let myBroadcastsLoading = true;
      let myTasks = [];
      let myTasksLoading = true;

      let myTeams = [];
      let myTeamsLoading = true;

      const landingQuery = parseHashQuery();
      const discordLinkError = landingQuery.get('discordLinkError');
      // Links like "Add payout method" land here with ?focus=payout: scroll to the form once it's loaded.
      let pendingPayoutFocus = landingQuery.get('focus') === 'payout';
      let pendingNotifFocus = landingQuery.get('focus') === 'notifications';
      if (pendingPayoutFocus || pendingNotifFocus) history.replaceState(null, '', '#/my');

      function focusPayout() {
        const panel = document.getElementById('payoutPanel');
        if (!panel) return;
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        panel.classList.remove('flash-focus');
        void panel.offsetWidth;
        panel.classList.add('flash-focus');
        const first = panel.querySelector('input[name="methodChoice"]:checked') || panel.querySelector('input');
        if (first) setTimeout(() => first.focus({ preventScroll: true }), 350);
      }
      if ((discordLinkError || landingQuery.get('discordLinked')) && window.location.hash.split('?')[0] === '#/my') {
        history.replaceState(null, '', '#/my');
      }

      let access = null;
      let accessLoading = true;
      let checkingAccess = false;
      let starting = false;
      let startAttempted = false;
      let startError = null;
      let pollTimer = null;

      function isLocked() {
        return false;
      }

      function isLockedLegacy() {
        if (hrTeamState === 'none' || hrTeamState === 'removed') return true;
        if (needsDiscordLink) return true;
        if (getRejoinState()) return true;
        return !!(access && access.open);
      }

      function stopPoll() { if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; } }

      function schedulePoll() {
        stopPoll();
        if (myGen !== renderGen || needsDiscordLink || hrTeamState === 'none' || hrTeamState === 'removed' || !isLocked()) return;
        pollTimer = setTimeout(() => syncAccess(false), 5000);
      }

      function noTeamBannerHtml() {
        return `
      <div class="lock-banner" role="alert">
        <div class="lock-banner-head">
          <div class="lock-icon" aria-hidden="true">!</div>
          <div>
            <h2>You're not on a team</h2>
            <p>${hrTeamState === 'removed'
            ? 'Your team was removed, so payments are on hold until someone puts you on another one.'
            : 'Payments stay locked until a lead puts you on a team. Nothing is needed from you.'}</p>
          </div>
        </div>
        <ol class="lock-steps">
          <li class="lock-step wait">
            <span class="lock-mark" aria-hidden="true">1</span>
            <div class="lock-step-body">
              <strong>Wait to be placed</strong>
              <span class="sub">A lead will move you onto a team, or let you know if you're leaving ${esc(studioName())}. There's nothing you need to do here.</span>
            </div>
          </li>
          <li class="lock-step wait">
            <span class="lock-mark" aria-hidden="true">2</span>
            <div class="lock-step-body">
              <strong>Nothing is lost</strong>
              <span class="sub">Payments already logged for you are still paid out, and your record stays exactly as it is.</span>
            </div>
          </li>
        </ol>
        <div class="lock-note">Signed in as ${esc(hrUsername)}. Ask a lead if you think this is wrong, or <button type="button" class="inline-link-btn" id="noTeamSignOutBtn">sign out</button> if this isn't your account.</div>
      </div>`;
      }

      function lockBannerHtml() {
        const linked = !needsDiscordLink;
        const flows = (access && access.flows) || [];
        const linkUrl = staffDiscordLinkHref('#/my');
        const linkErr = discordLinkError && !linked ? (DISCORD_LINK_ERROR_MESSAGES[discordLinkError] || 'Could not link that Discord account. Try again.') : null;
        const mainGroupId = access && access.mainGroupId;

        let step2 = '';
        if (!linked) {
          step2 = `<span class="sub">Available once Discord is linked.</span>`;
        } else if (starting || (accessLoading && !flows.length)) {
          step2 = `<span class="sub">Loading...</span>`;
        } else if (startError) {
          step2 = `<div class="error-box"><span>${esc(startError)}</span></div>
            <div class="lock-actions"><button type="button" class="btn btn-primary btn-sm" id="lockRestartBtn">Try again</button></div>`;
        } else if (!flows.length) {
          step2 = `<span class="sub">Waiting for the bot's Discord message.</span>
            <div class="lock-actions"><button type="button" class="btn btn-ghost btn-sm" id="lockCheckBtn" ${checkingAccess ? 'disabled' : ''}>${checkingAccess ? 'Checking...' : 'Check now'}</button><button type="button" class="btn btn-ghost btn-sm" id="lockRestartBtn">Resend Discord message</button></div>`;
        } else {
          const teamFlows = flows.filter(f => f.team && f.team.robloxGroupId);
          const readyAll = flows.every(f => f.step === 'group_joined');
          step2 = `
            <span class="sub">${readyAll
              ? 'Press Continue in the Discord message to finish.'
              : `Check your Discord DMs. Join the ${esc(studioName())} Roblox group${teamFlows.length ? ' and request to join your team\'s group' : ''}, then press Continue in the message.`}</span>
            <div class="lock-actions">
              ${mainGroupId ? `<a class="btn btn-ghost btn-sm" href="https://www.roblox.com/groups/${esc(mainGroupId)}" target="_blank" rel="noopener">Join ${esc(studioName())} group</a>` : ''}
              ${teamFlows.map(f => `<a class="btn btn-ghost btn-sm" href="https://www.roblox.com/groups/${esc(f.team.robloxGroupId)}" target="_blank" rel="noopener">Request to join ${esc(f.team.name)}</a>`).join('')}
            </div>
            ${flows.some(f => f.step === 'main_ranked_awaiting_team') ? `<span class="sub">Request to join your team's group, then press Continue again.</span>` : ''}
            <div class="lock-actions"><button type="button" class="btn btn-ghost btn-sm" id="lockCheckBtn" ${checkingAccess ? 'disabled' : ''}>${checkingAccess ? 'Checking...' : 'Check now'}</button><button type="button" class="btn btn-ghost btn-sm" id="lockRestartBtn">Resend Discord message</button></div>`;
        }

        return `
      <div class="lock-banner" role="alert">
        <div class="lock-banner-head">
          <div class="lock-icon" aria-hidden="true">!</div>
          <div>
            <h2>My payments is locked</h2>
            <p>${linked
            ? 'Join your team\'s Roblox groups below and this page unlocks on its own.'
            : 'Link your Discord account and join your team\'s Roblox groups to unlock this page.'}</p>
          </div>
        </div>
        ${linkErr ? `<div class="error-box"><span>${esc(linkErr)}</span></div>` : ''}
        <ol class="lock-steps">
          <li class="lock-step ${linked ? 'done' : ''}">
            <span class="lock-mark" aria-hidden="true">${linked ? '&#10003;' : '1'}</span>
            <div class="lock-step-body">
              <strong>Link your Discord account</strong>
              ${linked
            ? `<span class="sub">Discord is linked${discordLink && discordLink.discord_username ? ' as ' + esc(discordLink.discord_username) : ''}.</span>`
            : `<span class="sub">Used to message you about your team and payments.</span>
                   <div class="lock-actions"><a class="btn btn-primary btn-sm" id="lockLinkDiscordBtn" href="${linkUrl}">${linkErr ? 'Try again' : 'Link Discord'}</a></div>`}
            </div>
          </li>
          <li class="lock-step ${linked ? '' : 'wait'}">
            <span class="lock-mark" aria-hidden="true">2</span>
            <div class="lock-step-body">
              <strong>Join your team's Roblox groups</strong>
              ${step2}
            </div>
          </li>
        </ol>
      </div>`;
      }

      function paint() {
        const locked = isLocked();
        const totals = (summary && summary.totals) || {};
        const pendingRequests = summary ? summary.requests.filter(r => r.status === 'pending') : [];
        const paidRequests = summary ? summary.requests.filter(r => r.status === 'paid') : [];
        const currencies = Object.keys(totals);

        app.innerHTML = `
    ${topbar()}
    <div class="shell">
      <div class="heading-block">
        <h1>My payments</h1>
        <p class="sub">What you're owed, how you get paid, and whether you're ready to be paid.</p>
      </div>

      ${!myTasksLoading && myTasks.length ? `
      <div class="panel" style="margin-bottom:24px;">
        <h2 class="sec-title" style="font-size:16px;">Your tasks</h2>
        <p class="sub" style="margin:0 0 12px;">Work your team lead has set for you. Open one to see the details and mark it done.</p>
        <div class="task-list">
          ${myTasks.map(t => {
          const st = taskState(t);
          const pay = t.payment ? (t.currency === 'USD' ? '$' + Number(t.payment).toFixed(2) : 'R$ ' + Number(t.payment).toLocaleString()) : null;
          return `
            <a class="task-row my-task-row" href="#/task/${encodeURIComponent(t.id)}">
              ${t.game && t.game.icon_url ? `<img src="${esc(t.game.icon_url)}" alt="" class="game-icon" style="width:38px;height:38px;border-radius:8px;">` : ''}
              <div style="flex:1;min-width:0;">
                <div class="task-title ${t.status === 'done' ? 'done' : ''}">${esc(t.title)}</div>
                <div class="task-meta">
                  <span class="pp-state ${st.cls}">${esc(st.label)}</span>
                  ${t.team ? `<span>${esc(t.team.name)}</span>` : ''}
                  ${t.game ? `<span>${esc(t.game.name)}</span>` : ''}
                  ${pay ? `<span class="pp-tag">${esc(pay)}</span>` : ''}
                  ${t.payment_request_id ? `<span class="pp-state ok">Payment logged</span>` : ''}
                </div>
              </div>
              <span class="pp-linkbtn">Open</span>
            </a>`;
        }).join('')}
        </div>
      </div>` : ''}

      ${locked ? ((hrTeamState === 'none' || hrTeamState === 'removed') ? noTeamBannerHtml() : lockBannerHtml()) : ''}
      <div class="${locked ? 'locked-zone' : ''}" ${locked ? 'inert aria-disabled="true"' : ''}>

      ${!myBroadcastsLoading && myBroadcasts.length > 0 ? `
      <div style="margin-bottom:24px;display:flex;flex-direction:column;gap:10px;">
        ${myBroadcasts.map(b => `
          <div class="confirm-box">
            <div class="icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1z"/><path d="M16 9a3 3 0 0 1 0 6"/><path d="M18.5 6.5a7 7 0 0 1 0 11"/></svg></div>
            <div class="txt">
              <strong>${b.type === 'global' ? 'Announcement' : `Team announcement${(b.teams && b.teams.name) ? ' &middot; ' + esc(b.teams.name) : ''}`}</strong>
              <span>${esc(b.message)}</span>
            </div>
          </div>`).join('')}
      </div>` : ''}

      ${loading ? `<div class="dash-loading">Loading your payment info...</div>` : loadError ? `
        <div class="error-box"><span>${esc(loadError)}</span></div>
      ` : `
        <div class="owed-hero">
          <div class="owed-label">Total currently owed to you</div>
          ${currencies.length === 0 ? `<div style="color:var(--ink-soft);font-size:14px;">No pending payment requests logged for you yet.</div>` : `
          <div class="owed-amounts">
            ${currencies.map(cur => `
              <div class="owed-amount">
                <span class="val">${cur === 'ROBUX' ? `<img src="${ROBUX_IMG}" alt="Robux">${Number(totals[cur].pending || 0).toLocaleString()}` : `$${Number(totals[cur].pending || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</span>
                <span class="cur-label">${cur === 'ROBUX' ? 'Robux pending' : 'USD pending'}</span>
              </div>`).join('')}
          </div>`}
          <div class="owed-sub">${pendingRequests.length} pending request${pendingRequests.length === 1 ? '' : 's'}, ${paidRequests.length} paid to date, ${devexLabel()}</div>
          ${summarySplit ? `<div class="owed-sub">Split on: ${100 - summarySplit.percentRobux}% through ${esc(PAYMENT_METHODS[summarySplit.cashMethod] ? PAYMENT_METHODS[summarySplit.cashMethod].label : summarySplit.cashMethod)}, ${summarySplit.percentRobux}% in Robux. The figures above already follow your split.</div>` : ''}
        </div>
      `}

      <div class="manage-grid">
        <div class="panel">
          <div class="preview-label">Payout eligibility</div>
          ${eligibilityLoading ? `<div class="dash-loading">Checking eligibility...</div>` : eligibilityError ? `<div class="error-box"><span>${esc(eligibilityError)}</span></div>` : eligibility.length === 0 ? `<div class="empty-note">No eligibility requirements have been configured. You're clear to be paid.</div>` : `
            <div class="elig-summary ${eligibility.every(g => g.eligible) ? 'is-ok' : ''}">${eligibility.every(g => g.eligible) ? 'You meet the requirements to be paid' : 'You do not meet all requirements yet'}</div>
            ${eligibility.map(g => `
              <div class="elig-row">
                <div class="elig-left">
                  <div class="elig-check ${g.eligible ? 'is-ok' : ''}">${g.eligible ? '&#10003;' : '&middot;'}</div>
                  <div>
                    <div class="elig-name">${esc(g.name)}</div>
                    <div class="elig-meta">${g.metaLabel ? esc(g.metaLabel) : (g.isMember ? 'You are a member' : 'Not a member yet')}</div>
                  </div>
                </div>
                ${!g.isMember && g.robloxGroupId != null ? `<a class="btn btn-ghost btn-sm" href="https://www.roblox.com/groups/${esc(g.robloxGroupId)}" target="_blank" rel="noopener">Join group</a>` : (!g.isMember && g.id === 'payment_method' ? `<button type="button" class="btn btn-ghost btn-sm" data-focus-payout>Add payout method</button>` : '')}
              </div>`).join('')}
          `}
        </div>

        ${discordOn() ? `<div class="panel">
          <div class="preview-label">Discord account</div>
          ${discordLinkMsg ? `<div class="error-box" style="${discordLinkMsg.ok ? 'background:var(--ok-bg);border-color:var(--ok-line);color:var(--ok-text);' : ''}"><span>${esc(discordLinkMsg.text)}</span></div>` : ''}
          ${discordLinkLoading ? `<div class="dash-loading">Loading...</div>` : discordLink ? `
            <p style="color:var(--ink-soft);font-size:13px;margin-bottom:14px;">Linked to <strong>${esc(discordLink.discord_username)}</strong>.</p>
            <button type="button" class="btn btn-ghost btn-sm" id="unlinkDiscordBtn" ${unlinkingDiscord ? 'disabled' : ''}>${unlinkingDiscord ? 'Unlinking...' : 'Unlink Discord account'}</button>
            <p class="sub" style="margin:10px 0 0;">Unlinking locks My payments until you relink and rejoin your team's Roblox groups.</p>
          ` : `
            ${discordLinkError ? `<div class="error-box"><span>${esc(DISCORD_LINK_ERROR_MESSAGES[discordLinkError] || 'Could not link that Discord account. Try again.')}</span></div>` : ''}
            <p style="color:var(--ink-soft);font-size:13px;margin-bottom:14px;">No Discord account linked. Link it so we can message you about your team and payments.</p>
            <a class="btn btn-primary btn-sm" id="myLinkDiscordBtn" href="${staffDiscordLinkHref('#/my')}">${discordLinkError ? 'Try again' : 'Link Discord account'}</a>
          `}
        </div>` : ''}

        <div class="panel" id="payoutPanel">
          <div class="preview-label">Payout method</div>
          ${methodError ? `<div class="error-box"><span>${esc(methodError)}</span></div>` : ''}
          ${methodSaved ? `<div class="confirm-box"><div class="icon">&#10003;</div><div class="txt"><strong>Payout method saved</strong><span>Your next payout goes here.</span></div></div>` : ''}
          ${methodLoading ? `<div class="dash-loading">Loading your saved details...</div>` : `
            <div class="field">
              <label>How would you like to be paid?</label>
              ${Object.keys(PAYMENT_METHODS).filter(methodEnabled).map(key => {
          const isUsdMethod = key === 'PAYPAL' || key === 'VENMO' || key === 'BANK_TRANSFER';
          const blocked = isUsdMethod && usdEligibility && usdEligibility.eligible === false;
          const stillNeeded = blocked ? Number(usdEligibility.amountNeeded || 0) : 0;
          return `
                <label class="method-option ${selectedMethod === key ? 'active' : ''}" style="${blocked ? 'opacity:0.5;cursor:not-allowed;' : ''}">
                  <input type="radio" name="methodChoice" value="${key}" ${selectedMethod === key ? 'checked' : ''} ${blocked ? 'disabled' : ''}>
                  <div>
                    <div class="mo-label">${esc(PAYMENT_METHODS[key].label)}</div>
                    <div class="mo-sub">${esc(PAYMENT_METHODS[key].sub)}</div>
                    ${blocked ? `<div class="mo-sub" style="color:var(--warn-text);margin-top:4px;">You need $${stillNeeded.toFixed(2)} more in pending requests to select this.</div>` : ''}
                  </div>
                </label>`;
        }).join('')}
            </div>
            <div id="methodFieldsSlot"></div>
            ${(() => {
              const saved = method ? method.method : null;
              const savedLabel = saved && PAYMENT_METHODS[saved] ? PAYMENT_METHODS[saved].label : null;
              const canSplit = !!saved && saved !== 'DEVEX_ROBUX';
              return `
            <div class="split-box">
              <div style="font-weight:600;font-size:13.5px;margin-bottom:4px;">Split your payments</div>
              ${!saved
                  ? `<p class="hint" style="margin:0;">Save a payment method first, then you can have part of every payment sent in Robux instead.</p>`
                  : !canSplit
                    ? `<p class="hint" style="margin:0;">You're paid in Robux, so there's nothing to split. Pick PayPal, Venmo or bank transfer above and save it, then you can send part of each payment to Robux instead.</p>`
                    : `
              <label class="pp-check" style="margin:0 0 8px;"><input type="checkbox" id="splitToggle" ${splitPercent > 0 ? 'checked' : ''}> Pay part of every payment in Robux instead of ${esc(savedLabel)}</label>
              ${splitPercent > 0 ? `
              <div class="split-row">
                <input type="range" id="splitRange" min="5" max="95" step="5" value="${esc(splitPercent)}" aria-label="Share paid in Robux">
                <span class="split-value"><b>${esc(100 - splitPercent)}%</b> ${esc(savedLabel)} &middot; <b>${esc(splitPercent)}%</b> Robux</span>
              </div>
              <p class="hint" style="margin:8px 0 0;">${(() => {
                        const robuxShare = 100 * (splitPercent / 100);
                        const robux = DEVEX_RATE ? Math.round(robuxShare / DEVEX_RATE) : 0;
                        return `On a $100 payment that is $${(100 - robuxShare).toFixed(2)} through ${savedLabel} plus about R$ ${robux.toLocaleString()}.`;
                      })()}</p>
              <p class="hint" style="margin:6px 0 0;">While a split is on, your pending requests keep the currency they were logged in.</p>`
                      : `<p class="hint" style="margin:0;">Everything goes through ${esc(savedLabel)} right now.</p>`}`}
              ${splitSaving ? '<p class="hint">Saving...</p>' : ''}
            </div>`;
            })()}
            <button type="button" class="btn btn-primary" id="saveMethodBtn" ${savingMethod ? 'disabled' : ''}>${savingMethod ? 'Saving...' : 'Save payout method'}</button>
          `}
        </div>
      </div>

      <div class="panel np-panel" id="notifPrefsPanel"></div>

      <div class="heading-block section-head">
        <h2 class="sec-title">My teams &amp; skillsets</h2>
      </div>
      <div class="panel">
        ${myTeamsLoading ? `<div class="dash-loading">Loading your teams...</div>` : myTeams.length === 0 ? `<div class="empty-note">${hrTeamState === 'removed' ? "Your team was removed, so you're not on one at the moment. A lead will place you on another team or let you know what's happening." : hrTeamState === 'none' ? "You're not on a team yet. A lead will add you, or send you an invite link." : "You haven't joined any teams yet. Ask whoever invited you for an invite link."}</div>` : `
          <div class="team-chip-grid">
            ${myTeams.map(a => `
              <div class="team-chip-card">
                ${a.team ? `<span class="team-chip" style="border-color:${safeColor(a.team.color, 'var(--line)')};color:${safeColor(a.team.color, 'var(--ink)')};">${esc(a.team.name)}</span>` : `<span class="team-chip">No team</span>`}
                ${a.skillset ? `<span class="skillset-chip" style="border-color:${safeColor(a.skillset.color, 'var(--line)')};color:${safeColor(a.skillset.color, 'var(--ink)')};">${esc(a.skillset.name)}</span>` : ''}
              </div>`).join('')}
          </div>
        `}
      </div>

      <div class="heading-block section-head">
        <h2 class="sec-title">Warnings received</h2>
      </div>
      <div class="panel">
        ${warningsError ? `<div class="error-box"><span>${esc(warningsError)}</span></div>` : ''}
        ${warningsLoading ? `<div class="dash-loading">Loading your warnings...</div>` : warnings.length === 0 ? `<div class="empty-note">No warnings on file for you.</div>` : warnings.map(w => `
          <div class="role-row">
            <div class="role-row-top">
              <div>
                <strong>${esc(w.reason || 'No reason given')}</strong>
                <div class="role-meta">Warned by ${esc(w.warned_by || 'Unknown')} on ${esc(fmtDate(w.created_at || Date.now()))}</div>
              </div>
            </div>
          </div>`).join('')}
      </div>

      ${!loading && !loadError ? `
      <div class="heading-block section-head">
        <h2 class="sec-title">Your requests</h2>
      </div>
      <div class="table-wrap">
        ${summary.requests.length === 0 ? `<div class="dash-empty"><h3>Nothing here yet</h3><p>Once a producer logs a request for you, it'll show up here.</p></div>` : `
        <div class="table-scroll">
          <table class="req-table">
            <thead><tr><th style="width:16%;">ID</th><th style="width:34%;">Task</th><th style="width:16%;">Game</th><th style="width:14%;">Payment</th><th style="width:12%;">Status</th><th style="width:100px;">Date</th></tr></thead>
            <tbody>
              ${summary.requests.map(r => `
                <tr>
                  <td class="id-cell mono">${esc(r.id)}</td>
                  <td class="task-cell"><div class="task-name">${esc(r.taskName || 'Untitled task')}</div>${r.skillsetNames && r.skillsetNames.length ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">${r.skillsetNames.map(name => `<span class="skill-badge">${esc(name)}</span>`).join('')}</div>` : ''}</td>
                  <td>${r.game ? `<span class="game-badge" style="background:${gameColor(r.game)};">${esc(r.game)}</span>` : `<span class="empty-note">-</span>`}</td>
                  <td class="pay-cell">${fmtAmount(r)}${r.status === 'pending' ? `<button type="button" class="pp-linkbtn convert-btn" data-convert="${esc(r.id)}" title="Swap this request to the other currency at the current DevEx rate">Convert to ${r.currency === 'USD' ? 'Robux' : 'USD'}</button>` : ''}</td>
                  <td><span class="status-chip ${r.status}">${r.status === 'paid' ? `Paid ${esc(fmtDate(r.paidAt || Date.now()))}` : r.status === 'rejected' ? 'Rejected' : 'Pending'}</span>${r.status === 'rejected' && r.statusNote ? `<div class="status-note">${esc(r.statusNote)}</div>` : ''}</td>
                  <td class="mono" style="white-space:nowrap;color:var(--muted);font-size:11.5px;">${esc(fmtDate(r.createdAt || Date.now()))}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`}
      </div>` : ''}
      </div>
    </div>`;

        wireTopbarSignOut();
        paintMethodFields();
        document.querySelectorAll('[data-focus-payout]').forEach(b => b.addEventListener('click', focusPayout));
        const npHost = document.getElementById('notifPrefsPanel');
        if (npHost) mountNotifPrefs(npHost);
        if (pendingNotifFocus && npHost) { pendingNotifFocus = false; setTimeout(() => { npHost.scrollIntoView({ behavior: 'smooth', block: 'start' }); npHost.classList.add('flash-focus'); }, 80); }
        if (pendingPayoutFocus && !methodLoading) { pendingPayoutFocus = false; setTimeout(focusPayout, 60); }
        document.querySelectorAll('[data-convert]').forEach(el => el.addEventListener('click', async () => {
          const id = el.dataset.convert;
          const r = (summary ? summary.requests : []).find(x => String(x.id) === String(id));
          if (!r) return;
          const to = r.currency === 'USD' ? 'Robux' : 'USD';
          const estimate = r.currency === 'USD'
            ? `about R$ ${Math.round(Number(r.payment) / (DEVEX_RATE || 0.0038)).toLocaleString()}`
            : `about $${(Number(r.payment) * (DEVEX_RATE || 0.0038)).toFixed(2)}`;
          if (!(await askConfirm(`Switch this request to ${to}? It becomes ${estimate} at today's DevEx rate, and it stays in ${to} from then on.`))) return;
          el.disabled = true;
          try {
            const res = await callHrData('convert_my_request', { id });
            toast(`Switched to ${res.currency === 'USD' ? '$' + Number(res.payment).toFixed(2) : 'R$ ' + Number(res.payment).toLocaleString()}.`);
            await loadSummary();
          } catch (e) {
            el.disabled = false;
            toast(e.code === 'already_decided' ? 'That request has already been decided.' : (e.message || 'Could not convert that.'), 'err');
          }
        }));

        const lockLinkBtn = document.getElementById('lockLinkDiscordBtn');
        if (lockLinkBtn) lockLinkBtn.addEventListener('click', () => setRejoinState('linking'));
        const noTeamSignOut = document.getElementById('noTeamSignOutBtn');
        if (noTeamSignOut) noTeamSignOut.addEventListener('click', hrSignOut);
        const lockCheckBtn = document.getElementById('lockCheckBtn');
        if (lockCheckBtn) lockCheckBtn.addEventListener('click', () => syncAccess(true));
        const lockRestartBtn = document.getElementById('lockRestartBtn');
        if (lockRestartBtn) lockRestartBtn.addEventListener('click', () => startRelink(true));

        document.querySelectorAll('input[name="methodChoice"]').forEach(el => el.addEventListener('change', () => {
          selectedMethod = el.value;
          const remembered = method && method.details && method.details.savedMethods && method.details.savedMethods[selectedMethod];
          methodDetails = remembered ? { ...remembered } : {};
          paint();
        }));

        const splitToggle = document.getElementById('splitToggle');
        if (splitToggle) splitToggle.addEventListener('change', () => saveSplit(splitToggle.checked ? (splitPercent || 50) : 0));
        const splitRange = document.getElementById('splitRange');
        if (splitRange) {
          splitRange.addEventListener('input', () => {
            splitPercent = Number(splitRange.value);
            const label = document.querySelector('.split-value');
            if (label) label.innerHTML = `<b>${100 - splitPercent}%</b> cash &middot; <b>${splitPercent}%</b> Robux`;
          });
          splitRange.addEventListener('change', () => saveSplit(Number(splitRange.value)));
        }
        const saveMethodBtn = document.getElementById('saveMethodBtn');
        if (saveMethodBtn) saveMethodBtn.addEventListener('click', handleSaveMethod);

        const unlinkDiscordBtn = document.getElementById('unlinkDiscordBtn');
        if (unlinkDiscordBtn) unlinkDiscordBtn.addEventListener('click', async () => {
          if (!(await askConfirm('Unlink Discord? My payments will lock until you link it again and rejoin your team\'s Roblox groups.'))) return;
          unlinkingDiscord = true; discordLinkMsg = null; paint();
          try {
            await unlinkMyDiscord();
            discordLink = null;
            unlinkingDiscord = false;
            needsDiscordLink = true;
            startError = null; startAttempted = false;
            if (access) access = { ...access, discordLinked: false, open: false, flows: [] };
            stopPoll();
            discordLinkMsg = { ok: true, text: 'Discord account unlinked.' };
            paint();
          } catch (err) {
            unlinkingDiscord = false;
            discordLinkMsg = { ok: false, text: (err && err.message) ? err.message : 'Could not unlink your Discord account.' };
            paint();
          }
        });
      }

      function paintMethodFields() {
        const slot = document.getElementById('methodFieldsSlot');
        if (!slot) return;
        const def = PAYMENT_METHODS[selectedMethod] || PAYMENT_METHODS.PAYPAL;
        slot.innerHTML = (def.confidential ? `<div class="privacy-note"><span class="privacy-icon" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></span><span>${esc(PAYOUT_PRIVACY_NOTE)}</span></div>` : '') + def.fields.map(f => `
          <div class="field">
            <label>${esc(f.label)}</label>
            <input type="${f.type}" data-method-field="${f.key}" placeholder="${esc(f.placeholder || '')}" value="${esc(methodDetails[f.key] || '')}">
          </div>`).join('');
        slot.querySelectorAll('[data-method-field]').forEach(el => el.addEventListener('input', () => {
          methodDetails[el.dataset.methodField] = el.value;
        }));
      }

      async function handleSaveMethod() {
        const def = PAYMENT_METHODS[selectedMethod];
        const missing = def.fields.find(f => !String(methodDetails[f.key] || '').trim());
        if (missing) { methodError = `Enter a value for "${missing.label}".`; methodSaved = false; paint(); return; }
        savingMethod = true; methodError = null; methodSaved = false; paint();
        try {
          await savePaymentMethod(selectedMethod, methodDetails);
          savingMethod = false; methodSaved = true; paint();
          loadEligibility();
          getMyPaymentMethod().then(m => { if (myGen !== renderGen) return; method = m; paint(); }).catch(() => { });
        } catch (err) {
          savingMethod = false;
          methodError = (err && err.message) ? err.message : 'Could not save your payment method. Check your connection and try again.';
          paint();
        }
      }

      async function loadSummary() {
        loading = true; loadError = null; paint();
        try {
          summary = await getMySummary();
          summarySplit = summary.split || null;
        } catch (err) {
          loadError = (err && err.message) ? err.message : 'Could not load your payment summary.';
        }
        if (myGen !== renderGen) return;
        loading = false;
        paint();
      }

      async function loadMethod() {
        methodLoading = true; paint();
        try {
          method = await getMyPaymentMethod();
          splitPercent = Number(((method && method.details) || {}).splitRobuxPercent) || 0;
          if (method) { selectedMethod = method.method; methodDetails = method.details || {}; }
        } catch (err) { }
        if (myGen !== renderGen) return;
        methodLoading = false;
        paint();
      }

      async function loadUsdEligibility() {
        try {
          usdEligibility = await getUsdEligibility();
        } catch (err) { }
        if (myGen !== renderGen) return;
        paint();
      }

      async function loadDiscordLink() {
        if (!discordOn()) { discordLinkLoading = false; return; }
        discordLinkLoading = true; paint();
        try {
          discordLink = await getMyDiscordLink();
        } catch (err) { }
        if (myGen !== renderGen) return;
        discordLinkLoading = false;
        paint();
      }

      async function loadEligibility() {
        eligibilityLoading = true; eligibilityError = null; paint();
        try {
          eligibility = await getMyEligibility();
        } catch (err) {
          eligibilityError = (err && err.message) ? err.message : 'Could not check your group eligibility.';
        }
        if (myGen !== renderGen) return;
        eligibilityLoading = false;
        paint();
      }

      async function loadWarnings() {
        warningsLoading = true; warningsError = null; paint();
        try {
          warnings = await loadMyWarnings();
        } catch (err) {
          warningsError = (err && err.message) ? err.message : 'Could not load your warnings.';
        }
        if (myGen !== renderGen) return;
        warningsLoading = false;
        paint();
      }

      async function saveSplit(percent) {
        if (!method) { toast('Save a payment method first.', 'err'); return; }
        splitSaving = true; paint();
        try {
          const r = await callHrData('set_payout_split', { percentRobux: percent });
          splitPercent = r.percentRobux || 0;
          try {
            method = await getMyPaymentMethod();
            splitPercent = Number(((method && method.details) || {}).splitRobuxPercent) || 0;
          } catch (e) { }
          toast(splitPercent ? `Split saved: ${100 - splitPercent}% cash, ${splitPercent}% Robux.` : 'Split turned off.');
        } catch (e) {
          toast(e.message || 'Could not save the split.', 'err');
        }
        splitSaving = false;
        paint();
      }

      async function loadMyTasksData() {
        myTasksLoading = true;
        try {
          const json = await callHrData('my_tasks');
          myTasks = json.data || [];
        } catch (err) {
          myTasks = [];
        }
        if (myGen !== renderGen) return;
        myTasksLoading = false;
        paint();
      }

      async function loadMyBroadcastsData() {
        myBroadcastsLoading = true; paint();
        try {
          myBroadcasts = await listMyBroadcasts();
        } catch (err) {
          myBroadcasts = [];
        }
        if (myGen !== renderGen) return;
        myBroadcastsLoading = false;
        paint();
      }

      async function loadMyTeamsData() {
        myTeamsLoading = true; paint();
        try {
          myTeams = await getMyAssignment();
        } catch (err) {
          myTeams = [];
        }
        if (myGen !== renderGen) return;
        myTeamsLoading = false;
        paint();
      }

      function unlockNow() {
        setRejoinState(null);
        stopPoll();
        toast('My payments is unlocked.');
        paint();
        loadDiscordLink();
        loadEligibility();
        loadMyTeamsData();
      }

      async function startRelink(restart) {
        starting = true; startAttempted = true; startError = null; paint();
        try {
          const s = await startAccessRelink(getPendingInvite(), restart);
          if (myGen !== renderGen) return;
          access = s;
          needsDiscordLink = discordOn() && !s.discordLinked;
          if (s.inviteInvalid || s.inviteStarted) clearPendingInvite();
          if (s.open) setRejoinState('started');
          if (s.startFailed) {
            startError = "Couldn't send the Discord message. Join our Discord server and allow DMs from server members, then try again.";
          } else if (!s.open) {
            unlockNow();
            starting = false;
            return;
          }
        } catch (e) {
          if (myGen !== renderGen) return;
          startError = e.code === 'discord_not_in_server'
            ? 'Join our Discord server first, then press Try again.'
            : (e.message || 'Could not start the Discord setup. Try again.');
        }
        starting = false;
        paint();
        schedulePoll();
      }

      async function syncAccess(manual) {
        if (manual) { checkingAccess = true; paint(); }
        if (manual) {
          try {
            const check = await callHrData('check_access_now');
            const d = check.data || {};
            if (d.finishing) {
              toast("You're in the group already. Finishing your access off now, this takes a few seconds.");
            } else if (!d.hasFlow) {
              toast('Nothing is waiting on you here. Refreshing your access.');
            } else if (!d.mainJoined) {
              toast(d.groupId
                ? `We can't see you in the ${esc(studioName())} group (${d.groupId}) yet. Join it, then press Check now again.`
                : 'No Roblox group has been set up for onboarding yet. A lead needs to set one in Manage.', 'err');
            } else if (!d.teamJoined) {
              toast(`You're in the main group. Still waiting on your request to join ${d.teamName || "your team's"} group.`, 'err');
            }
          } catch (e) {
            toast(e.message || 'Could not check your group membership.', 'err');
          }
        }
        try {
          const s = await getMyAccessStatus();
          if (myGen !== renderGen) return;
          const before = JSON.stringify(access);
          const wasOpen = !!(access && access.open);
          access = s;
          needsDiscordLink = discordOn() && !s.discordLinked;
          checkingAccess = false;
          accessLoading = false;

          let st = getRejoinState();
          if (st === 'linking' && s.open) { setRejoinState('started'); st = 'started'; }

          if (s.discordLinked && st === 'linking' && !startAttempted) { await startRelink(false); return; }
          if (s.discordLinked && !s.open && (st === 'started' || wasOpen)) { unlockNow(); return; }

          if (manual || before !== JSON.stringify(access)) paint();
        } catch (e) {
          if (myGen !== renderGen) return;
          checkingAccess = false;
          accessLoading = false;
          if (manual) { toast((e && e.message) || 'Could not check right now.', 'err'); paint(); }
        }
        schedulePoll();
      }

      paint();
      loadSummary();
      loadMethod();
      loadUsdEligibility();
      loadDiscordLink();
      loadEligibility();
      loadWarnings();
      loadMyBroadcastsData();
      loadMyTasksData();
      loadMyTeamsData();
      syncAccess(false);
    }

    function renderManagePanel() {
      const myGen = renderGen;
      const canManageGames = hasPermission('settings.manage_games');
      const canManageRate = hasPermission('settings.manage_rate');
      const canManageGroups = hasPermission('settings.manage_groups');
      const canManageBaseAccess = hasPermission('settings.manage_base_access');
      const canManageRoles = hasPermission('roles.manage');
      const canManageOnboarding = hasPermission('settings.manage_onboarding');
      const canManageBroadcasts = hasPermission('broadcasts.manage');
      const canManageBranding = hasPermission('settings.manage_branding');

      if (!canManageGames && !canManageRate && !canManageGroups && !canManageBaseAccess && !canManageRoles && !canManageOnboarding && !canManageBroadcasts && !canManageBranding) { window.location.hash = hasPermission('dashboard.view') ? '#/dashboard' : '#/'; return; }

      const manageTabDefs = [
        { id: 'branding', group: 'Studio', label: 'Branding', desc: 'Name, logo, colours, sign-in', enabled: canManageBranding },
        { id: 'notifications', group: 'Studio', label: 'Notifications', desc: 'Email and channel alerts', enabled: canManageBranding },
        { id: 'plan', group: 'Studio', label: 'Plan', desc: 'Licence and features', enabled: canManageBranding || canManageRoles },
        { id: 'access', group: 'Access', label: 'Sign-in', desc: 'Who can get in', enabled: canManageBaseAccess || canManageGroups },
        { id: 'roles', group: 'Access', label: 'Roles', desc: 'Permissions and rank', enabled: canManageRoles },
        { id: 'games', group: 'Payments', label: 'Games & DevEx', desc: 'Games, DevEx rate, minimums', enabled: canManageGames || canManageRate },
        { id: 'rates', group: 'Payments', label: 'Rate card', desc: 'Standard pay per job', enabled: canManageRate },
        { id: 'teams', group: 'Team', label: 'Teams & skills', desc: 'Structure of the studio', enabled: canManageOnboarding },
        { id: 'onboarding', group: 'Team', label: 'Invites', desc: 'Links that bring people in', enabled: canManageOnboarding },
        { id: 'recruitment', group: 'Team', label: 'Recruitment', desc: 'Positions and hiring', enabled: canManageOnboarding && featureOn('recruitment') },
        { id: 'broadcasts', group: 'Team', label: 'Announcements', desc: 'Messages to everyone', enabled: canManageBroadcasts && featureOn('broadcasts') }
      ].filter(t => t.enabled);
      const requestedManageTab = parseHashQuery().get('tab');
      let manageTab = manageTabDefs.some(t => t.id === requestedManageTab) ? requestedManageTab : (manageTabDefs.length ? manageTabDefs[0].id : null);

      let savingRate = false;
      let rateError = null;
      let rateSuccess = false;

      let rateBands = [];
      let rateBandsLoaded = false;
      let bandError = null;
      let savingBand = false;
      let editingBandId = null;

      let usdMinimum = null;
      let savingUsdMin = false;
      let usdMinError = null;
      let usdMinSuccess = false;
      let addingGame = false;
      let gameError = null;

      let requiredGroups = [];
      let groupsLoading = canManageGroups;
      let groupsError = null;
      let addingGroup = false;
      let addGroupError = null;

      let ignoreEligibility = false;
      let ignoreEligibilityLoading = canManageGroups;
      let ignoreEligibilitySaving = false;
      let ignoreEligibilityError = null;

      let baseAccessGroups = [];
      let baseAccessGroupsLoading = canManageBaseAccess;
      let baseAccessGroupsError = null;
      let addingBaseAccessGroup = false;
      let addBaseAccessGroupError = null;

      let baseAccessDiscordServers = [];
      let baseAccessDiscordServersLoading = canManageBaseAccess && discordOn();
      let baseAccessDiscordServersError = null;
      let addingBaseAccessDiscordServer = false;
      let addBaseAccessDiscordServerError = null;

      let roles = [];
      let assignments = [];
      let rolesLoading = canManageRoles;
      let rolesError = null;
      let addingRole = false;
      let addRoleError = null;
      let addingAssignment = false;
      let addAssignmentError = null;
      let editingRoleId = null;
      let savingRoleEdit = false;
      let editRoleError = null;

      let teams = [];
      let skillsets = [];
      let onboardingLinks = [];
      let teamsLoading = canManageOnboarding;
      let teamsError = null;
      let addingTeam = false;
      let addTeamError = null;
      let addingSkillset = false;
      let addSkillsetError = null;
      let editingTeamId = null;
      let savingTeamEdit = false;
      let editTeamError = null;
      let addingLink = false;
      let addLinkError = null;
      let lastCreatedLink = null;

      let positions = [];
      let positionsLoading = canManageOnboarding && featureOn('recruitment');
      let positionsError = null;
      let addingPosition = false;
      let addPositionError = null;

      let recruitmentConfig = { autoRoleId: null, discordRoleId: null, gracePeriodHours: null, notifyRoleId: null };
      let recruitmentConfigLoading = canManageOnboarding && featureOn('recruitment');
      let recruitmentConfigError = null;
      let savingRecruitmentConfig = false;
      let recruitmentConfigSuccess = false;

      let approvalConfig = { signoffRoleId: null, producerRoleId: null };
      let approvalConfigLoading = canManageOnboarding && featureOn('recruitment');
      let approvalConfigError = null;
      let savingApprovalConfig = false;
      let approvalConfigSuccess = false;

      let onboardingGroupConfig = { groupId: null, groupRoleId: null };
      let onboardingGroupConfigLoading = canManageOnboarding && discordOn();
      let onboardingGroupConfigError = null;
      let savingOnboardingGroupConfig = false;
      let onboardingGroupConfigSuccess = false;

      let robloxGroupApiKeyStatus = { configured: false };
      let robloxGroupApiKeyStatusLoading = canManageOnboarding;

      let broadcasts = [];
      let broadcastTeams = [];
      let broadcastsLoading = canManageBroadcasts;
      let broadcastsError = null;
      let addingBroadcast = false;
      let addBroadcastError = null;
      let newBroadcastType = 'global';

      function paint() {
        const subsectionsByTab = {
          access: [
            ...(canManageBaseAccess ? [{ id: 'sec-signin', label: 'Who can sign in' }] : []),
            ...(canManageGroups ? [{ id: 'sec-eligibility', label: 'Eligibility groups' }] : [])
          ],
          games: [],
          roles: [],
          teams: [],
          onboarding: [
            { id: 'sec-ob-overview', label: 'How it works' },
            { id: 'sec-invites', label: 'Invite links' },
            { id: 'sec-onboarding-flow', label: 'Roblox group step' }
          ],
          recruitment: [
            { id: 'sec-positions', label: 'Positions' },
            { id: 'sec-autohire', label: 'Auto-hire' },
            { id: 'sec-signoff', label: 'Sign-off & finalise' }
          ],
          broadcasts: [
            { id: 'sec-broadcasts', label: 'Broadcasts' },
            { id: 'sec-broadcast-history', label: 'Sent broadcasts' }
          ]
        };

        app.innerHTML = `
    ${topbar()}
    <div class="shell">
      <div class="heading-block">
        <h1>Settings</h1>
        <p class="sub">How your studio runs. Changes apply to everyone as soon as they're saved.</p>
      </div>

      <div class="manage-layout">
        ${manageTabDefs.length > 1 ? `
        <nav class="manage-side" aria-label="Settings sections">
          ${manageTabDefs.map((t, i) => `${i === 0 || manageTabDefs[i - 1].group !== t.group ? `<div class="ms-group">${esc(t.group)}</div>` : ''}
            <button type="button" data-manage-tab="${t.id}" class="${manageTab === t.id ? 'on' : ''}"${manageTab === t.id ? ' aria-current="page"' : ''}><span>${esc(t.label)}</span><small>${esc(t.desc)}</small></button>`).join('')}
        </nav>` : ''}

        <div style="flex:1;min-width:0;">

      ${manageTab === 'branding' && canManageBranding ? '<div id="brandingMount"></div>' : ''}
      ${manageTab === 'notifications' && canManageBranding ? '<div id="webhookMount"></div>' : ''}
      ${manageTab === 'plan' ? '<div id="planMount"></div>' : ''}

      ${manageTab === 'access' ? `
      ${canManageBaseAccess ? `
      <div class="heading-block" id="sec-signin">
        <h2 class="sec-title">Who can sign in</h2>
        <p class="sub">People get in if they're in one of these Roblox groups (at the minimum rank, if set)${discordOn() ? ' or one of these Discord servers' : ''}. Anyone given a role, a team or an invite link also gets in. ${featureOn('recruitment') ? 'Everyone else is sent to the application form.' : 'Everyone else is turned away.'}</p>
      </div>
      <div class="panel" style="max-width:640px;margin-bottom:20px;">
        ${baseAccessGroupsError ? `<div class="error-box"><span>${esc(baseAccessGroupsError)}</span></div>` : ''}
        ${baseAccessGroupsLoading ? `<div class="dash-loading">Loading groups...</div>` : baseAccessGroups.length === 0 ? `<div class="empty-note">No sign-in groups yet. Until you add one, only people with a role, a team or an invite link can sign in.</div>` : baseAccessGroups.map(g => `
          <div class="role-row">
            <div class="role-row-top">
              <div>
                <strong>${esc(g.name || 'Sign-in group')}</strong>
                <div class="role-meta">Group ID ${esc(g.roblox_group_id)}${g.min_rank != null ? ` &middot; min rank ${esc(g.min_rank)}` : ''}</div>
              </div>
              <button type="button" class="btn btn-ghost btn-sm" data-del-base-group="${esc(g.id)}">Remove</button>
            </div>
          </div>`).join('')}

        <div style="margin-top:18px;border-top:1px solid var(--line);padding-top:18px;">
          <div class="preview-label">Add a sign-in group</div>
          ${addBaseAccessGroupError ? `<div class="error-box"><span>${esc(addBaseAccessGroupError)}</span></div>` : ''}
          <div class="row2">
            <div class="field"><label>Roblox group ID</label><input type="number" id="newBaseGroupId" placeholder="e.g. 123456"></div>
            <div class="field"><label>Minimum rank <span class="hint">(optional, 0-255)</span></label><input type="number" id="newBaseGroupMinRank" min="0" max="255" placeholder="e.g. 1"></div>
          </div>
          <div class="field"><label>Display name <span class="hint">(optional)</span></label><input type="text" id="newBaseGroupName" placeholder="e.g. ${esc(studioName())} Studio, Testers"></div>
          <button type="button" class="btn btn-ok" id="addBaseGroupBtn" ${addingBaseAccessGroup ? 'disabled' : ''}>${addingBaseAccessGroup ? 'Adding...' : 'Add group'}</button>
        </div>
      </div>

      ${discordOn() ? `<div class="panel" style="max-width:640px;margin-bottom:36px;">
        ${baseAccessDiscordServersError ? `<div class="error-box"><span>${esc(baseAccessDiscordServersError)}</span></div>` : ''}
        ${baseAccessDiscordServersLoading ? `<div class="dash-loading">Loading Discord servers...</div>` : baseAccessDiscordServers.length === 0 ? `<div class="empty-note">No sign-in Discord servers configured yet.</div>` : baseAccessDiscordServers.map(s => `
          <div class="role-row">
            <div class="role-row-top">
              <div>
                <strong>${esc(s.name || 'Sign-in Discord server')}</strong>
                <div class="role-meta">Server ID ${esc(s.discord_guild_id)}</div>
              </div>
              <button type="button" class="btn btn-ghost btn-sm" data-del-base-discord="${esc(s.id)}">Remove</button>
            </div>
          </div>`).join('')}

        <div style="margin-top:18px;border-top:1px solid var(--line);padding-top:18px;">
          <div class="preview-label">Add a sign-in Discord server</div>
          ${addBaseAccessDiscordServerError ? `<div class="error-box"><span>${esc(addBaseAccessDiscordServerError)}</span></div>` : ''}
          <div class="row2">
            <div class="field"><label>Discord server (guild) ID</label><input type="text" id="newBaseDiscordId" placeholder="e.g. 123456789012345678"></div>
            <div class="field"><label>Display name <span class="hint">(optional)</span></label><input type="text" id="newBaseDiscordName" placeholder="e.g. Testers server"></div>
          </div>
          <p class="sub" style="margin:0 0 12px;">This only works for someone who has already linked a Discord account (e.g. by going through the application flow once) - checked via their linked account, not a live Discord login.</p>
          <button type="button" class="btn btn-ok" id="addBaseDiscordBtn" ${addingBaseAccessDiscordServer ? 'disabled' : ''}>${addingBaseAccessDiscordServer ? 'Adding...' : 'Add server'}</button>
        </div>
      </div>` : ''}` : ''}
      ` : ''}

      ${manageTab === 'rates' ? `
      <div class="heading-block">
        <h2 class="sec-title">Rate card</h2>
        <p class="sub">Standard pay for a piece of work, so the same job is worth the same whoever assigns it. Producers pick a band when they set a task, and anything else has to be typed in by hand.</p>
      </div>
      ${bandError ? `<div class="error-box"><span>${esc(bandError)}</span></div>` : ''}
      <div class="panel" style="padding:0;overflow:hidden;">
        <div class="home-card-head"><h2>Bands</h2><span class="count">${rateBands.length}</span></div>
        ${!rateBandsLoaded
              ? '<div class="home-empty">Loading the rate card...</div>'
              : !rateBands.length
                ? '<div class="home-empty">No bands yet. Add the first one below.</div>'
                : rateBands.map(band => `
          <div class="home-row">
            <div class="home-row-main">
              <div class="home-row-title">${esc(band.name)}</div>
              <div class="home-row-meta">
                <span>${band.currency === 'USD' ? esc(moneyUsd(band.amount)) : esc(moneyRobux(band.amount))}</span>
                ${band.notes ? `<span>${esc(band.notes)}</span>` : ''}
              </div>
            </div>
            <div class="home-row-actions">
              <button type="button" class="btn btn-ghost btn-sm" data-band-edit="${esc(band.id)}">Edit</button>
              <button type="button" class="btn btn-ghost btn-sm" data-band-retire="${esc(band.id)}">Retire</button>
            </div>
          </div>`).join('')}
        <div style="padding:16px;border-top:1px solid var(--line);">
          <h3 style="margin:0 0 12px;font-size:14px;">${editingBandId ? 'Edit band' : 'Add a band'}</h3>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;">
            <div class="field"><label for="bandName">What it covers</label><input type="text" id="bandName" placeholder="e.g. Small script, under a day" value="${esc((rateBands.find(x => String(x.id) === String(editingBandId)) || {}).name || '')}"></div>
            <div class="field"><label for="bandAmount">Pay</label><input type="number" id="bandAmount" min="1" step="1" value="${esc((rateBands.find(x => String(x.id) === String(editingBandId)) || {}).amount || '')}"></div>
            <div class="field"><label for="bandCurrency">Currency</label><select id="bandCurrency">
              <option value="USD" ${((rateBands.find(x => String(x.id) === String(editingBandId)) || {}).currency || 'USD') === 'USD' ? 'selected' : ''}>USD</option>
              <option value="ROBUX" ${((rateBands.find(x => String(x.id) === String(editingBandId)) || {}).currency || '') === 'ROBUX' ? 'selected' : ''}>Robux</option>
            </select></div>
            <div class="field"><label for="bandNotes">Note <span class="hint">(optional)</span></label><input type="text" id="bandNotes" placeholder="When to use this one" value="${esc((rateBands.find(x => String(x.id) === String(editingBandId)) || {}).notes || '')}"></div>
          </div>
          <div style="display:flex;gap:8px;margin-top:4px;">
            <button type="button" class="btn btn-primary btn-sm" id="bandSaveBtn" ${savingBand ? 'disabled' : ''}>${savingBand ? 'Saving...' : editingBandId ? 'Save changes' : 'Add band'}</button>
            ${editingBandId ? '<button type="button" class="btn btn-ghost btn-sm" id="bandCancelBtn">Cancel</button>' : ''}
          </div>
        </div>
      </div>
      ` : ''}

      ${manageTab === 'games' ? `
      <div class="heading-block" id="sec-payroll">
        <h2 class="sec-title">Games &amp; DevEx</h2>
        <p class="sub">Set the DevEx conversion rate and keep the list of games people can log work against.</p>
      </div>
      <div class="manage-grid">
        ${canManageRate ? `
        <div class="panel">
          <div class="preview-label">DevEx rate</div>
          <div class="rate-display">$<span id="rateBig">${(DEVEX_RATE * 10000).toFixed(2)}</span><span class="rate-sub">per 10,000 Robux</span></div>
          <p class="sub" style="margin:0 0 18px;">Stored as USD per Robux: <span class="mono">${DEVEX_RATE}</span></p>
          ${rateError ? `<div class="error-box"><span>${esc(rateError)}</span></div>` : ''}
          ${rateSuccess ? `<div class="confirm-box"><div class="icon">&#10003;</div><div class="txt"><strong>Rate updated</strong><span>New requests and exports now use this rate.</span></div></div>` : ''}
          <div class="field">
            <label>USD per 10,000 Robux</label>
            <input type="number" id="ratePer10k" min="0" step="0.01" value="${(DEVEX_RATE * 10000).toFixed(2)}">
          </div>
          <button type="button" class="btn btn-primary" id="saveRateBtn" ${savingRate ? 'disabled' : ''}>${savingRate ? 'Saving...' : 'Save rate'}</button>
        </div>` : ''}

        ${canManageRate ? `
        <div class="panel">
          <div class="preview-label">USD minimum pending</div>
          <p class="sub" style="margin:0 0 18px;">PayPal and Venmo can only be selected once someone has this much pending (in USD equivalent). Leave at 0 to disable the requirement.</p>
          ${usdMinError ? `<div class="error-box"><span>${esc(usdMinError)}</span></div>` : ''}
          ${usdMinSuccess ? `<div class="confirm-box"><div class="icon">&#10003;</div><div class="txt"><strong>Threshold updated</strong></div></div>` : ''}
          <div class="field">
            <label>Minimum pending (USD)</label>
            <input type="number" id="usdMinInput" min="0" step="0.01" value="${usdMinimum != null ? usdMinimum : 0}">
          </div>
          <button type="button" class="btn btn-primary" id="saveUsdMinBtn" ${savingUsdMin ? 'disabled' : ''}>${savingUsdMin ? 'Saving...' : 'Save threshold'}</button>
        </div>` : ''}

        ${canManageGames ? `
        <div class="panel">
          <div class="preview-label">Games</div>
          ${gameError ? `<div class="error-box"><span>${esc(gameError)}</span></div>` : ''}
          <div class="game-chip-wrap">
            ${GAMES.length ? GAMES.map(g => `
              <span class="game-chip" style="background:${gameColor(g.name)}1F;color:${gameColor(g.name)};border:1px solid ${gameColor(g.name)}55;">
                ${esc(g.name)}
                <span class="del" data-del-game="${esc(g.id)}" title="Remove game">&times;</span>
              </span>`).join('')
                : `<div class="empty-note">No games yet. Add the first one below.</div>`}
          </div>
          <div class="field">
            <label>Add a game</label>
            <input type="text" id="newGameName" placeholder="e.g. Tower Defense Tycoon">
          </div>
          <button type="button" class="btn btn-ok" id="addGameBtn" ${addingGame ? 'disabled' : ''}>${addingGame ? 'Adding...' : 'Add game'}</button>
        </div>` : ''}
      </div>
      ` : ''}

      ${manageTab === 'access' ? `
      ${canManageGroups ? `
      <details class="advanced"${requiredGroups.length ? ' open' : ''}><summary>Payout eligibility <small>Optional: groups people must be in to be paid</small></summary><div class="advanced-body">
      <div class="heading-block" id="sec-eligibility">
        <h2 class="sec-title">Eligibility groups</h2>
        <p class="sub">Someone must be in every group listed here to be marked eligible for payout.</p>
      </div>
      <div class="panel" style="max-width:640px;margin-bottom:20px;">
        ${ignoreEligibilityError ? `<div class="error-box"><span>${esc(ignoreEligibilityError)}</span></div>` : ''}
        <label style="display:flex;align-items:flex-start;gap:10px;cursor:${ignoreEligibilityLoading || ignoreEligibilitySaving ? 'default' : 'pointer'};">
          <input type="checkbox" id="ignoreEligibilityCheckbox" style="margin-top:3px;" ${ignoreEligibility ? 'checked' : ''} ${ignoreEligibilityLoading || ignoreEligibilitySaving ? 'disabled' : ''}>
          <span>
            <strong>Ignore Eligibility for All Requests</strong>
            <p class="sub" style="margin:4px 0 0;">When on, submitting a payment request skips every eligibility check for the recipient, required groups, onboarding/Terms of Service acceptance, and payment method on file. Use with care.</p>
          </span>
        </label>
        ${ignoreEligibilityLoading ? `<div class="dash-loading" style="margin-top:10px;">Loading current setting...</div>` : ''}
        ${ignoreEligibilitySaving ? `<div class="hint" style="display:block;margin-top:10px;">Saving...</div>` : ''}
      </div>
      <div class="panel" style="max-width:640px;">
        ${groupsError ? `<div class="error-box"><span>${esc(groupsError)}</span></div>` : ''}
        ${groupsLoading ? `<div class="dash-loading">Loading groups...</div>` : requiredGroups.length === 0 ? `<div class="empty-note">No eligibility groups configured yet, everyone is currently treated as eligible.</div>` : requiredGroups.map(g => `
          <div class="role-row">
            <div class="role-row-top">
              <div>
                <strong>${esc(g.name)}</strong>
                <div class="role-meta">Group ID ${esc(g.roblox_group_id)}</div>
              </div>
              <button type="button" class="btn btn-ghost btn-sm" data-del-group="${esc(g.id)}">Remove</button>
            </div>
          </div>`).join('')}

        <div style="margin-top:18px;border-top:1px solid var(--line);padding-top:18px;">
          <div class="preview-label">Add a required group</div>
          ${addGroupError ? `<div class="error-box"><span>${esc(addGroupError)}</span></div>` : ''}
          <div class="row2">
            <div class="field"><label>Roblox group ID</label><input type="number" id="newGroupId" placeholder="e.g. 123456"></div>
            <div class="field"><label>Display name</label><input type="text" id="newGroupName" placeholder="e.g. ${esc(studioName())} Studio"></div>
          </div>
          <button type="button" class="btn btn-ok" id="addGroupBtn" ${addingGroup ? 'disabled' : ''}>${addingGroup ? 'Adding...' : 'Add group'}</button>
        </div>
      </div></div></details>` : ''}
      ` : ''}

      ${manageTab === 'roles' && canManageRoles ? `
      <div class="heading-block" id="sec-roles">
        <h2 class="sec-title">Roles and permissions</h2>
        <p class="sub">Roles can tie to a Roblox group and rank, or get assigned to a specific account. A user gets every permission from every role they qualify for. Give "Submit payment requests" to the people who log work on behalf of others. Roles are separate from sign-in access: someone can sign in with no roles, and will only see their own payments until a role is granted.</p>
      </div>

      <div class="manage-grid">
        <div class="panel">
          <div class="preview-label">Roles</div>
          ${rolesError ? `<div class="error-box"><span>${esc(rolesError)}</span></div>` : ''}
          ${rolesLoading ? `<div class="dash-loading">Loading roles...</div>` : roles.length === 0 ? `<div class="empty-note">No roles yet. Create the first one below.</div>` : roles.map(r => {
                  const roleHierarchy = Number(r.hierarchy) || 0;
                  const canManageThisRole = roleHierarchy < hrMaxHierarchy;
                  const isEditing = editingRoleId != null && String(editingRoleId) === String(r.id);
                  return `
            <div class="role-row">
              <div class="role-row-top">
                <div>
                  <strong>${esc(r.name)}</strong>
                  <div class="role-meta">${discordOn() && r.discord_role_id ? `Discord role ${esc(r.discord_role_id)} &middot; ` : ''}${r.link_only ? `Link only${r.min_rank != null ? `, rank must equal ${esc(r.min_rank)}` : ''}` : r.roblox_group_id ? `Group ${esc(r.roblox_group_id)}${r.min_rank != null ? `, rank must equal ${esc(r.min_rank)}` : ', any rank'}` : 'Manual assignment only'} &middot; Hierarchy ${esc(roleHierarchy)}</div>
                </div>
                <div style="display:flex;gap:6px;">
                  <button type="button" class="btn btn-ghost btn-sm" data-edit-role="${esc(r.id)}" ${canManageThisRole ? '' : 'disabled'} title="${canManageThisRole ? '' : "You can't manage a role at or above your own hierarchy level"}">${isEditing ? 'Close' : 'Edit'}</button>
                  <button type="button" class="btn btn-ghost btn-sm" data-del-role="${esc(r.id)}" ${canManageThisRole ? '' : 'disabled'} title="${canManageThisRole ? '' : "You can't manage a role at or above your own hierarchy level"}">Remove</button>
                </div>
              </div>
              <div class="perm-chip-wrap">
                ${(r.permissions || []).length ? r.permissions.map(p => `<span class="perm-chip">${esc(PERMISSION_LABELS[p] || p)}</span>`).join('') : `<span class="empty-note">No permissions granted</span>`}
              </div>
              ${isEditing ? `
              <div style="margin-top:12px;border-top:1px solid var(--line);padding-top:12px;">
                ${editRoleError ? `<div class="error-box"><span>${esc(editRoleError)}</span></div>` : ''}
                <div class="field"><label>Role name</label><input type="text" class="editRoleName" data-role-id="${esc(r.id)}" value="${esc(r.name)}"></div>
                <div class="row2">
                  <div class="field"><label>Roblox group ID <span class="hint">(optional)</span></label><input type="number" class="editRoleGroupId" data-role-id="${esc(r.id)}" value="${r.roblox_group_id != null ? esc(r.roblox_group_id) : ''}"></div>
                  <div class="field"><label>Rank <span class="hint">(optional, must match exactly)</span></label><input type="number" class="editRoleMinRank" data-role-id="${esc(r.id)}" min="0" max="255" value="${r.min_rank != null ? esc(r.min_rank) : ''}"></div>
                </div>
                <div class="field">
                  <label class="perm-check-item link-only-item" title="If on, this role is never handed out just from meeting the group and rank above. It only gets given through an onboarding link. Rank above still applies at that point as a safeguard, so the link can only grant the role to someone who is at that exact rank.">
                    <input type="checkbox" class="editRoleLinkOnly" data-role-id="${esc(r.id)}" ${r.link_only ? 'checked' : ''}>
                    Link only <span class="hint">(only given via onboarding link, rank above becomes a safeguard on that link)</span>
                  </label>
                </div>
                <div class="field"><label>Hierarchy level <span class="hint">(must be lower than your own, currently ${esc(hrMaxHierarchy)})</span></label><input type="number" class="editRoleHierarchy" data-role-id="${esc(r.id)}" min="0" max="${Math.max(hrMaxHierarchy - 1, 0)}" value="${esc(roleHierarchy)}"></div>
                ${discordOn() ? `<div class="field"><label>Discord role ID <span class="hint">(optional, given and taken away automatically)</span></label><input type="text" class="editRoleDiscordRoleId" data-role-id="${esc(r.id)}" placeholder="e.g. 123456789012345678" value="${r.discord_role_id ? esc(r.discord_role_id) : ''}"></div>` : ''}
                <div class="field">
                  <label>Permissions</label>
                  ${permissionPickerHtml('editRolePerm', r.permissions || [], r.id)}
                </div>
                <button type="button" class="btn btn-primary btn-sm" data-save-role="${esc(r.id)}" ${savingRoleEdit ? 'disabled' : ''}>${savingRoleEdit ? 'Saving...' : 'Save role'}</button>
              </div>` : ''}
            </div>`;
                }).join('')}

          <div style="margin-top:18px;border-top:1px solid var(--line);padding-top:18px;">
            <div class="preview-label">Add a role</div>
            ${addRoleError ? `<div class="error-box"><span>${esc(addRoleError)}</span></div>` : ''}
            <div class="field"><label>Role name</label><input type="text" id="newRoleName" placeholder="e.g. Producer"></div>
            <div class="row2">
              <div class="field"><label>Roblox group ID <span class="hint">(optional)</span></label><input type="number" id="newRoleGroupId" placeholder="e.g. 123456"></div>
              <div class="field"><label>Rank <span class="hint">(optional, must match exactly)</span></label><input type="number" id="newRoleMinRank" placeholder="e.g. 100" min="0" max="255"></div>
            </div>
            <div class="field">
              <label class="perm-check-item link-only-item" title="If on, this role is never handed out just from meeting the group and rank above. It only gets given through an onboarding link. Rank above still applies at that point as a safeguard, so the link can only grant the role to someone who is at that exact rank.">
                <input type="checkbox" id="newRoleLinkOnly">
                Link only <span class="hint">(only given via onboarding link, rank above becomes a safeguard on that link)</span>
              </label>
            </div>
            <div class="field"><label>Hierarchy level <span class="hint">(must be lower than your own, currently ${esc(hrMaxHierarchy)})</span></label><input type="number" id="newRoleHierarchy" placeholder="e.g. 10" min="0" max="${Math.max(hrMaxHierarchy - 1, 0)}"></div>
            ${discordOn() ? `<div class="field"><label>Discord role ID <span class="hint">(optional, given and taken away automatically)</span></label><input type="text" id="newRoleDiscordRoleId" placeholder="e.g. 123456789012345678"></div>` : ''}
            <div class="field">
              <label>Permissions</label>
              ${permissionPickerHtml('newRolePerm', [], '')}
            </div>
            <button type="button" class="btn btn-ok" id="addRoleBtn" ${addingRole ? 'disabled' : ''}>${addingRole ? 'Adding...' : 'Add role'}</button>
          </div>
        </div>

        <div class="panel">
          <div class="preview-label">Manual assignments</div>
          <p class="sub" style="margin:0 0 14px;">Give a role to one Roblox account, regardless of group rank.</p>
          ${assignments.length === 0 ? `<div class="empty-note">No manual assignments yet.</div>` : assignments.map(a => {
                  const roleHierarchy = Number(a.roles && a.roles.hierarchy) || 0;
                  const canManageThisAssignment = roleHierarchy < hrMaxHierarchy;
                  return `
            <div class="assignment-row">
              <span>${userLink(a.roblox_user_id, a.roblox_username)} &rarr; <strong>${esc((a.roles && a.roles.name) || 'Unknown role')}</strong></span>
              <button type="button" class="btn btn-ghost btn-sm" data-del-assignment="${esc(a.id)}" ${canManageThisAssignment ? '' : 'disabled'} title="${canManageThisAssignment ? '' : "You can't manage a role at or above your own hierarchy level"}">Remove</button>
            </div>`;
                }).join('')}

          <div style="margin-top:18px;border-top:1px solid var(--line);padding-top:18px;">
            <div class="preview-label">Assign a role</div>
            ${addAssignmentError ? `<div class="error-box"><span>${esc(addAssignmentError)}</span></div>` : ''}
            <div class="field"><label>Roblox user ID</label><input type="number" id="newAssignmentUserId" placeholder="e.g. 1234567"></div>
            <div class="field">
              <label>Role</label>
              <select id="newAssignmentRoleId" ${roles.filter(r => (Number(r.hierarchy) || 0) < hrMaxHierarchy).length === 0 ? 'disabled' : ''}>
                <option value="">${roles.length === 0 ? 'No roles available' : 'Select a role'}</option>
                ${roles.filter(r => (Number(r.hierarchy) || 0) < hrMaxHierarchy).map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}
              </select>
            </div>
            <button type="button" class="btn btn-primary" id="addAssignmentBtn" ${addingAssignment || roles.filter(r => (Number(r.hierarchy) || 0) < hrMaxHierarchy).length === 0 ? 'disabled' : ''}>${addingAssignment ? 'Assigning...' : 'Assign role'}</button>
          </div>
        </div>
      </div>` : ''}

      ${manageTab === 'teams' && canManageOnboarding ? `
      <div class="heading-block" id="sec-teams">
        <h2 class="sec-title">Teams &amp; skillsets</h2>
        <p class="sub">Create a team for each group of people that works together, tag it with the skillsets that apply to it, then create an invite link under Invites. Anyone who signs in through that link is put on that team and skillset automatically.</p>
      </div>

      <div class="manage-grid">
        <div class="panel">
          <div class="preview-label">Teams</div>
          ${teamsError ? `<div class="error-box"><span>${esc(teamsError)}</span></div>` : ''}
          ${teamsLoading ? `<div class="dash-loading">Loading teams...</div>` : teams.length === 0 ? `<div class="empty-note">No teams yet. Add the first one below.</div>` : teams.map(t => {
                  const teamSkillsets = skillsets.filter(s => (t.skillsetIds || []).includes(s.id));
                  const isEditing = editingTeamId === t.id;
                  return `
          <div class="role-row">
            <div class="role-row-top">
              <div>
                <strong style="color:${safeColor(t.color, 'var(--ink)')};">${esc(t.name)}</strong>
                <div class="role-meta">${[discordOn() ? (t.discord_url ? 'Discord linked' : 'No Discord linked') : '', t.roblox_group_url || t.roblox_group_id ? 'Roblox group linked' : 'No Roblox group'].filter(Boolean).join(' &middot; ')}</div>
              </div>
              <div style="display:flex;gap:6px;">
                <button type="button" class="btn btn-ghost btn-sm" data-edit-team="${esc(t.id)}">${isEditing ? 'Close' : 'Edit'}</button>
                <button type="button" class="btn btn-ghost btn-sm" data-del-team="${esc(t.id)}">Remove</button>
              </div>
            </div>
            <div class="perm-chip-wrap">
              ${teamSkillsets.length ? teamSkillsets.map(s => `<span class="perm-chip">${esc(s.name)}</span>`).join('') : `<span class="empty-note">No skillsets tagged</span>`}
            </div>
            ${isEditing ? `
            <div style="margin-top:12px;border-top:1px solid var(--line);padding-top:12px;">
              ${editTeamError ? `<div class="error-box"><span>${esc(editTeamError)}</span></div>` : ''}
              <div class="row2">
                <div class="field"><label>Team name</label><input type="text" class="editTeamName" data-team-id="${esc(t.id)}" value="${esc(t.name)}"></div>
                <div class="field"><label>Color <span class="hint">(optional, hex)</span></label><input type="text" class="editTeamColor" data-team-id="${esc(t.id)}" value="${esc(t.color || '')}"></div>
              </div>
              ${discordOn() ? `<div class="field"><label>Discord invite URL</label><input type="text" class="editTeamDiscord" data-team-id="${esc(t.id)}" value="${esc(t.discord_url || '')}"></div>` : ''}
              <div class="field"><label>Roblox group URL</label><input type="text" class="editTeamGroupUrl" data-team-id="${esc(t.id)}" value="${esc(t.roblox_group_url || '')}"></div>
              <div class="row2">
                <div class="field"><label>Roblox group ID</label><input type="number" class="editTeamGroupId" data-team-id="${esc(t.id)}" placeholder="e.g. 1090702452" value="${t.roblox_group_id != null ? esc(t.roblox_group_id) : ''}"></div>
                <div class="field"><label>Default group role ID <span class="hint">(assigned when someone joins this team)</span></label><input type="number" class="editTeamGroupRoleId" data-team-id="${esc(t.id)}" placeholder="e.g. 5" value="${t.default_group_role_id != null ? esc(t.default_group_role_id) : ''}"></div>
              </div>
              <div class="field"><label>Custom info <span class="hint">(shown to them during onboarding)</span></label><textarea class="editTeamInfo" data-team-id="${esc(t.id)}">${esc(t.info || '')}</textarea></div>
              <div class="field">
                <label>Skillsets on this team</label>
                <div class="perm-check-grid">
                  ${skillsets.length ? skillsets.map(s => `<label class="perm-check-item"><input type="checkbox" class="editTeamSkillset" data-team-id="${esc(t.id)}" value="${esc(s.id)}" ${(t.skillsetIds || []).includes(s.id) ? 'checked' : ''}> ${esc(s.name)}</label>`).join('') : `<span class="empty-note">No skillsets created yet.</span>`}
                </div>
              </div>
              <button type="button" class="btn btn-primary btn-sm" data-save-team="${esc(t.id)}" ${savingTeamEdit ? 'disabled' : ''}>${savingTeamEdit ? 'Saving...' : 'Save team'}</button>
            </div>` : ''}
          </div>`;
                }).join('')}

          <div style="margin-top:18px;border-top:1px solid var(--line);padding-top:18px;">
            <div class="preview-label">Add a team</div>
            ${addTeamError ? `<div class="error-box"><span>${esc(addTeamError)}</span></div>` : ''}
            <div class="row2">
              <div class="field"><label>Team name</label><input type="text" id="newTeamName" placeholder="e.g. Team Alpha"></div>
              <div class="field"><label>Color <span class="hint">(optional, hex)</span></label><input type="text" id="newTeamColor" placeholder="#3730D9"></div>
            </div>
            ${discordOn() ? `<div class="field"><label>Discord invite URL</label><input type="text" id="newTeamDiscord" placeholder="https://discord.gg/..."></div>` : ''}
            <div class="field"><label>Roblox group URL</label><input type="text" id="newTeamGroupUrl" placeholder="https://www.roblox.com/groups/..."></div>
            <div class="row2">
              <div class="field"><label>Roblox group ID</label><input type="number" id="newTeamGroupId" placeholder="e.g. 1090702452"></div>
              <div class="field"><label>Default group role ID <span class="hint">(assigned when someone joins this team)</span></label><input type="number" id="newTeamGroupRoleId" placeholder="e.g. 5"></div>
            </div>
            <div class="field"><label>Custom info <span class="hint">(shown to them during onboarding)</span></label><textarea id="newTeamInfo" placeholder="Anything this team should know when they join"></textarea></div>
            <div class="field">
              <label>Skillsets on this team <span class="hint">(optional)</span></label>
              <div class="perm-check-grid">
                ${skillsets.length ? skillsets.map(s => `<label class="perm-check-item"><input type="checkbox" class="newTeamSkillset" value="${esc(s.id)}"> ${esc(s.name)}</label>`).join('') : `<span class="empty-note">No skillsets yet, add one on the right first (optional).</span>`}
              </div>
            </div>
            <button type="button" class="btn btn-ok" id="addTeamBtn" ${addingTeam ? 'disabled' : ''}>${addingTeam ? 'Adding...' : 'Add team'}</button>
          </div>
        </div>

        <div class="panel">
          <div class="preview-label">Skillsets</div>
          ${addSkillsetError && !teamsLoading ? `<div class="error-box"><span>${esc(addSkillsetError)}</span></div>` : ''}
          ${teamsLoading ? `<div class="dash-loading">Loading skillsets...</div>` : skillsets.length === 0 ? `<div class="empty-note">No skillsets yet. Add the first one below.</div>` : skillsets.map(s => `
            <div class="role-row">
              <div class="role-row-top">
                <div>
                  <strong style="color:${safeColor(s.color, 'var(--ink)')};">${esc(s.name)}</strong>
                  ${s.description ? `<div class="role-meta">${esc(s.description)}</div>` : ''}
                </div>
                <button type="button" class="btn btn-ghost btn-sm" data-del-skillset="${esc(s.id)}">Remove</button>
              </div>
            </div>`).join('')}

          <div style="margin-top:18px;border-top:1px solid var(--line);padding-top:18px;">
            <div class="preview-label">Add a skillset</div>
            <div class="row2">
              <div class="field"><label>Skillset name</label><input type="text" id="newSkillsetName" placeholder="e.g. Builder"></div>
              <div class="field"><label>Color <span class="hint">(optional, hex)</span></label><input type="text" id="newSkillsetColor" placeholder="#178A4C"></div>
            </div>
            <div class="field"><label>Description <span class="hint">(optional)</span></label><input type="text" id="newSkillsetDescription" placeholder="What this skillset covers"></div>
            <button type="button" class="btn btn-ok" id="addSkillsetBtn" ${addingSkillset ? 'disabled' : ''}>${addingSkillset ? 'Adding...' : 'Add skillset'}</button>
          </div>
        </div>
      </div>

      ` : ''}
      ${manageTab === 'onboarding' && canManageOnboarding ? `
      <details class="advanced"><summary>How onboarding works <small>The steps every new person goes through</small></summary><div class="advanced-body">
      <div class="heading-block" id="sec-ob-overview">
        <h2 class="sec-title">How onboarding works</h2>
        <p class="sub">Everyone new goes through the same setup page after signing in. It shows one step at a time and remembers where they got to.</p>
      </div>
      <div class="panel" style="max-width:640px;">
        <ol class="ob-overview">
          ${discordOn() ? `<li><strong>Link Discord.</strong> Required for everyone.</li>
          <li><strong>Join their team.</strong> Only if they came in through an invite link below. The bot DMs them the Roblox group step, and the team, skill and role are added once they finish.</li>` : `<li><strong>Join their team.</strong> Only if they came in through an invite link below. The team, skill and role are added as soon as they sign in.</li>`}
          <li><strong>Welcome, team info, Terms of Service and Acceptable Use Policy.</strong> They read and accept each one.</li>
          <li><strong>Add a payout method.</strong> Optional, they can skip it.</li>
        </ol>
        ${featureOn('recruitment') ? `<p class="hint" style="margin:10px 0 0;">Recruits hired through Recruitment go through the same Roblox group step after they're finalised.</p>` : ''}
      </div>

      </div></details>
      <div class="heading-block" id="sec-invites" style="margin-top:20px;">
        <h2 class="sec-title">Invite links</h2>
        <p class="sub">Pick a team, skill and optional role, then send the link to the person you're bringing in. They sign in through it and the setup page takes them through the rest.</p>
      </div>
      <div class="panel" style="max-width:760px;">
        ${teamsLoading ? `<div class="dash-loading">Loading links...</div>` : onboardingLinks.length === 0 ? `<div class="empty-note">No invite links yet. Create one below.</div>` : onboardingLinks.map(l => `
          <div class="role-row">
            <div class="role-row-top">
              <div>
                <strong>${esc(l.label || 'Untitled link')}</strong>
                <div class="role-meta">${l.targetUsername ? '<strong style="color:var(--ink);">For ' + esc(l.targetUsername) + '</strong> &middot; ' : ''}${l.teamName ? esc(l.teamName) : 'No team'}${l.skillsetName ? ' &middot; ' + esc(l.skillsetName) : ''}${l.roleName ? ' &middot; role: ' + esc(l.roleName) : ''} &middot; used ${esc(l.uses || 0)} time${(l.uses || 0) === 1 ? '' : 's'}</div>
                <div class="mono" style="font-size:11.5px;color:var(--muted);margin-top:4px;word-break:break-all;">${esc(l.url)}</div>
              </div>
              <div style="display:flex;gap:6px;">
                <button type="button" class="btn btn-ghost btn-sm" data-copy-link="${esc(l.url)}">Copy link</button>
                <button type="button" class="btn btn-ghost btn-sm" data-del-link="${esc(l.token)}">Remove</button>
              </div>
            </div>
          </div>`).join('')}

        <div style="margin-top:18px;border-top:1px solid var(--line);padding-top:18px;">
          <div class="preview-label">Create a link</div>
          ${addLinkError ? `<div class="error-box"><span>${esc(addLinkError)}</span></div>` : ''}
          ${lastCreatedLink ? `<div class="confirm-box"><div class="icon">&#10003;</div><div class="txt"><strong>Link created</strong><span class="mono" style="word-break:break-all;">${esc(lastCreatedLink)}</span></div></div>` : ''}
          <div class="row3">
            <div class="field">
              <label>Team</label>
              <select id="newLinkTeam">
                <option value="">No team</option>
                ${teams.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label>Skillset</label>
              <select id="newLinkSkillset">
                <option value="">No skillset</option>
                ${skillsets.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label>Role <span class="hint">(optional)</span></label>
              <select id="newLinkRole">
                <option value="">No role</option>
                ${roles.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="field"><label>Label <span class="hint">(optional)</span></label><input type="text" id="newLinkLabel" placeholder="e.g. August builders batch"></div>
          <button type="button" class="btn btn-primary" id="createLinkBtn" ${addingLink ? 'disabled' : ''}>${addingLink ? 'Creating...' : 'Create link'}</button>
        </div>
      </div>

      ${discordOn() ? `
      <details class="advanced" style="margin-top:28px;"><summary>Roblox group step <small>Auto-join and rank new people in a Roblox group</small></summary><div class="advanced-body">
      <div class="heading-block" id="sec-onboarding-flow">
        <h2 class="sec-title">Roblox group step</h2>
        <p class="sub">Both invite links and finalised recruits go through this. The bot DMs them to join this Roblox group, then ranks them automatically. Ranking needs a Roblox Open Cloud API key (ROBLOX_GROUP_API_KEY) on the bot, created under your own account with read/write access to this group. Without it, they're asked to see a lead instead.</p>
      </div>
      <div class="panel" style="max-width:640px;margin-bottom:20px;">
        <div class="preview-label">Roblox group API key</div>
        ${robloxGroupApiKeyStatusLoading ? `<div class="dash-loading">Checking...</div>` : robloxGroupApiKeyStatus.configured ? `
          <p style="color:var(--ok-text);font-size:13px;">ROBLOX_GROUP_API_KEY is set - auto-ranking is ready to go.</p>
        ` : `
          <p style="color:var(--warn-text);font-size:13px;">ROBLOX_GROUP_API_KEY is not set on the bot yet - the "Get Ranked" step will fail until it is.</p>
        `}
      </div>
      <div class="panel" style="max-width:640px;">
        ${onboardingGroupConfigError ? `<div class="error-box"><span>${esc(onboardingGroupConfigError)}</span></div>` : ''}
        ${onboardingGroupConfigSuccess ? `<div class="confirm-box"><div class="icon">&#10003;</div><div class="txt"><strong>Onboarding group settings updated</strong></div></div>` : ''}
        ${onboardingGroupConfigLoading ? `<div class="dash-loading">Loading settings...</div>` : `
        <div class="field">
          <label>Roblox group ID</label>
          <input type="number" id="onboardingGroupId" placeholder="e.g. 123456" value="${onboardingGroupConfig.groupId != null ? esc(onboardingGroupConfig.groupId) : ''}">
        </div>
        <div class="field">
          <label>Group role ID to assign <span class="hint">(the numeric role/rank id, not its name)</span></label>
          <input type="number" id="onboardingGroupRoleId" placeholder="e.g. 5" value="${onboardingGroupConfig.groupRoleId != null ? esc(onboardingGroupConfig.groupRoleId) : ''}">
          <p class="sub" style="margin:6px 0 0;">Find this in the group's role management page - it's not the same as the rank number shown to members.</p>
        </div>
        <button type="button" class="btn btn-primary" id="saveOnboardingGroupConfigBtn" style="width:auto;" ${savingOnboardingGroupConfig ? 'disabled' : ''}>${savingOnboardingGroupConfig ? 'Saving...' : 'Save settings'}</button>
        `}
      </div></div></details>` : ''}` : ''}
      ${manageTab === 'recruitment' && canManageOnboarding ? `
      <div class="heading-block" id="sec-positions">
        <h2 class="sec-title">Positions</h2>
        <p class="sub">These show up as a dropdown on the application form. Attach a Discord role to a position to ping and give channel access to that specific team instead of the general HR role(s) whenever someone applies for it.</p>
      </div>
      <div class="panel" style="max-width:640px;">
        ${positionsError ? `<div class="error-box"><span>${esc(positionsError)}</span></div>` : ''}
        ${positionsLoading ? `<div class="dash-loading">Loading positions...</div>` : positions.length === 0 ? `<div class="empty-note">No positions configured yet - the application form will just show a general "Not sure" option.</div>` : positions.map(p => `
          <div class="role-row">
            <div class="role-row-top">
              <div>
                <strong>${esc(p.name)}</strong>
                <div class="role-meta">${p.discord_role_id ? `Pings Discord role ${esc(p.discord_role_id)}` : 'No Discord role attached - pings the general HR role(s)'}</div>
              </div>
              <button type="button" class="btn btn-ghost btn-sm" data-del-position="${esc(p.id)}">Remove</button>
            </div>
          </div>`).join('')}

        <div style="margin-top:18px;border-top:1px solid var(--line);padding-top:18px;">
          <div class="preview-label">Add a position</div>
          ${addPositionError ? `<div class="error-box"><span>${esc(addPositionError)}</span></div>` : ''}
          <div class="field"><label>Name</label><input type="text" id="newPositionName" placeholder="e.g. Scripter, Builder, UI Designer"></div>
          <div class="field"><label>Discord role ID <span class="hint">(optional)</span></label><input type="text" id="newPositionRoleId" placeholder="e.g. 123456789012345678"></div>
          <button type="button" class="btn btn-ok" id="addPositionBtn" ${addingPosition ? 'disabled' : ''}>${addingPosition ? 'Adding...' : 'Add position'}</button>
        </div>
      </div>

      <details class="advanced" style="margin-top:28px;"><summary>Hiring automation <small>Auto-hire roles, grace period, sign-off and finalise</small></summary><div class="advanced-body">
      <div class="heading-block" id="sec-autohire">
        <h2 class="sec-title">Auto-hire settings</h2>
        <p class="sub">Control what happens automatically when someone is hired: which role(s) they're given, and how long HR has to respond before an application accepts itself.</p>
      </div>
      <div class="panel" style="max-width:640px;">
        ${recruitmentConfigError ? `<div class="error-box"><span>${esc(recruitmentConfigError)}</span></div>` : ''}
        ${recruitmentConfigSuccess ? `<div class="confirm-box"><div class="icon">&#10003;</div><div class="txt"><strong>Auto-hire settings updated</strong></div></div>` : ''}
        ${recruitmentConfigLoading ? `<div class="dash-loading">Loading auto-hire settings...</div>` : `
        <div class="field">
          <label>Auto-assigned tool role <span class="hint">(optional)</span></label>
          <select id="recruitAutoRole">
            <option value="">No automatic role</option>
            ${roles.map(r => `<option value="${esc(r.id)}" ${recruitmentConfig.autoRoleId === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}
          </select>
          <p class="sub" style="margin:6px 0 0;">Granted automatically in the Tool the moment an application is accepted.</p>
        </div>
        <div class="field">
          <label>Auto-assigned Discord role ID <span class="hint">(optional)</span></label>
          <input type="text" id="recruitDiscordRole" placeholder="e.g. 123456789012345678" value="${recruitmentConfig.discordRoleId ? esc(recruitmentConfig.discordRoleId) : ''}">
          <p class="sub" style="margin:6px 0 0;">The bot needs a role above this one in the server's role list to be able to grant it.</p>
        </div>
        <div class="field">
          <label>Grace period before auto-accept <span class="hint">(hours, blank to disable)</span></label>
          <input type="number" id="recruitGraceHours" min="0" step="0.5" placeholder="e.g. 6" value="${recruitmentConfig.gracePeriodHours != null ? esc(recruitmentConfig.gracePeriodHours) : ''}">
          <p class="sub" style="margin:6px 0 0;">If nobody accepts, rejects, or claims an application within this window, it's automatically accepted and gets the role(s) above. Leave blank to always require a human decision.</p>
        </div>
        <div class="field">
          <label>Notify role on accept <span class="hint">(optional)</span></label>
          <select id="recruitNotifyRole">
            <option value="">No notification</option>
            ${roles.map(r => `<option value="${esc(r.id)}" ${recruitmentConfig.notifyRoleId === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}
          </select>
          <p class="sub" style="margin:6px 0 0;">Every member of this role is DMed on Discord the moment an application is accepted (manually or automatically). They need a linked Discord account to receive it.</p>
        </div>
        <button type="button" class="btn btn-primary" id="saveRecruitConfigBtn" ${savingRecruitmentConfig ? 'disabled' : ''}>${savingRecruitmentConfig ? 'Saving...' : 'Save auto-hire settings'}</button>
        `}
      </div>

      <div class="heading-block" id="sec-signoff" style="margin-top:36px;">
        <h2 class="sec-title">Sign-off &amp; finalise settings</h2>
        <p class="sub">Once a recruit is placed on a team, the sign-off role confirms it's ready, then a producer on that team finalises it and grants access. Pick which roles do each step. These are separate from "Manage recruitment tickets" - someone with that permission alone cannot sign off or finalise unless they also hold the role picked here (or the dedicated recruitment.signoff / recruitment.finalise permission).</p>
      </div>
      <div class="panel" style="max-width:640px;">
        ${approvalConfigError ? `<div class="error-box"><span>${esc(approvalConfigError)}</span></div>` : ''}
        ${approvalConfigSuccess ? `<div class="confirm-box"><div class="icon">&#10003;</div><div class="txt"><strong>Sign-off &amp; finalise settings updated</strong></div></div>` : ''}
        ${approvalConfigLoading ? `<div class="dash-loading">Loading settings...</div>` : `
        <div class="field">
          <label>Sign-off role <span class="hint">(recruiter / senior developer)</span></label>
          <select id="signoffRoleSelect">
            <option value="">No role - only recruitment.signoff permission holders</option>
            ${roles.map(r => `<option value="${esc(r.id)}" ${approvalConfig.signoffRoleId === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}
          </select>
          <p class="sub" style="margin:6px 0 0;">Only this role, or anyone granted the recruitment.signoff permission directly, can sign off a placement as ready.</p>
        </div>
        <div class="field">
          <label>Producer role</label>
          <select id="producerRoleSelect">
            <option value="">No role - only recruitment.finalise permission holders</option>
            ${roles.map(r => `<option value="${esc(r.id)}" ${approvalConfig.producerRoleId === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}
          </select>
          <p class="sub" style="margin:6px 0 0;">Only members with this role who are also assigned to the recruit's team (via team assignments), or anyone granted the recruitment.finalise permission directly, get notified and can finalise.</p>
        </div>
        <button type="button" class="btn btn-primary" id="saveApprovalConfigBtn" style="width:auto;" ${savingApprovalConfig ? 'disabled' : ''}>${savingApprovalConfig ? 'Saving...' : 'Save settings'}</button>
        `}
      </div>
      </div></details>
` : ''}

      ${manageTab === 'broadcasts' && canManageBroadcasts ? `
      <div class="heading-block" id="sec-broadcasts">
        <h2 class="sec-title">Broadcasts</h2>
        <p class="sub">Send a message to everyone (global) or to just one team. Broadcasts show up at the top of everyone's "My payments" tab.</p>
      </div>

      <div class="panel" style="max-width:640px;">
        ${addBroadcastError ? `<div class="error-box"><span>${esc(addBroadcastError)}</span></div>` : ''}
        <div class="field">
          <label>Audience</label>
          <div class="row2">
            <label class="method-option ${newBroadcastType === 'global' ? 'active' : ''}">
              <input type="radio" name="broadcastType" value="global" ${newBroadcastType === 'global' ? 'checked' : ''}>
              <div>
                <div class="mo-label">Global</div>
                <div class="mo-sub">Everyone sees this</div>
              </div>
            </label>
            <label class="method-option ${newBroadcastType === 'team' ? 'active' : ''}">
              <input type="radio" name="broadcastType" value="team" ${newBroadcastType === 'team' ? 'checked' : ''}>
              <div>
                <div class="mo-label">Team only</div>
                <div class="mo-sub">Just one team</div>
              </div>
            </label>
          </div>
        </div>
        ${newBroadcastType === 'team' ? `
        <div class="field">
          <label>Team</label>
          <select id="newBroadcastTeam">
            <option value="">${broadcastTeams.length === 0 ? 'No teams available' : 'Select a team'}</option>
            ${broadcastTeams.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}
          </select>
        </div>` : ''}
        <div class="field"><label>Message</label><textarea id="newBroadcastMessage" placeholder="What do you want people to see?"></textarea></div>
        <button type="button" class="btn btn-ok" id="addBroadcastBtn" ${addingBroadcast ? 'disabled' : ''}>${addingBroadcast ? 'Sending...' : 'Send broadcast'}</button>
      </div>

      <div class="heading-block" id="sec-broadcast-history" style="margin-top:36px;">
        <h2 class="sec-title">Sent broadcasts</h2>
      </div>
      <div class="panel" style="max-width:640px;">
        ${broadcastsError ? `<div class="error-box"><span>${esc(broadcastsError)}</span></div>` : ''}
        ${broadcastsLoading ? `<div class="dash-loading">Loading broadcasts...</div>` : broadcasts.length === 0 ? `<div class="empty-note">No broadcasts sent yet.</div>` : broadcasts.map(b => `
          <div class="role-row">
            <div class="role-row-top">
              <div>
                <div class="role-meta">${b.type === 'global' ? 'Global' : `Team &middot; ${esc((b.teams && b.teams.name) || 'Unknown team')}`} &middot; ${esc(b.created_by || 'Unknown')} &middot; ${esc(fmtDate(b.created_at || Date.now()))}</div>
                <div style="margin-top:4px;">${esc(b.message)}</div>
              </div>
              <button type="button" class="btn btn-ghost btn-sm" data-del-broadcast="${esc(b.id)}">Remove</button>
            </div>
          </div>`).join('')}
      </div>
      ` : ''}


        </div>
      </div>
    </div>`;

        wireTopbarSignOut();

        const brandingMount = document.getElementById('brandingMount');
        if (brandingMount) mountBrandingEditor(brandingMount);
        const webhookMount = document.getElementById('webhookMount');
        if (webhookMount) mountWebhookSettings(webhookMount);
        const planMount = document.getElementById('planMount');
        if (planMount) mountPlan(planMount);
        document.querySelectorAll('[data-manage-tab]').forEach(b => b.addEventListener('click', async () => { if (manageTab === 'branding' && b.dataset.manageTab !== 'branding' && brandingState.dirty && !(await askConfirm('You have unsaved branding changes. Leave without saving?'))) return; manageTab = b.dataset.manageTab; history.replaceState(null, '', '#/manage?tab=' + manageTab); paint(); window.scrollTo(0, 0); if (manageTab === 'rates' && !rateBandsLoaded) loadRateBands(); }));

        const bandSaveBtn = document.getElementById('bandSaveBtn');
        if (bandSaveBtn) bandSaveBtn.addEventListener('click', async () => {
          const name = (document.getElementById('bandName') || {}).value || '';
          const amount = (document.getElementById('bandAmount') || {}).value || '';
          const currency = (document.getElementById('bandCurrency') || {}).value || 'USD';
          const notes = (document.getElementById('bandNotes') || {}).value || '';
          if (!name.trim() || !(Number(amount) > 0)) { toast('Give it a name and a pay amount above zero.', 'err'); return; }
          savingBand = true; bandError = null; paint();
          try {
            await callHrData('save_rate_band', { id: editingBandId || undefined, name: name.trim(), amount: Number(amount), currency, notes: notes.trim() });
            editingBandId = null;
            toast('Rate card saved');
            await loadRateBands();
          } catch (e) {
            bandError = e.message || 'Could not save that band.';
          }
          savingBand = false;
          paint();
        });

        const bandCancelBtn = document.getElementById('bandCancelBtn');
        if (bandCancelBtn) bandCancelBtn.addEventListener('click', () => { editingBandId = null; paint(); });

        document.querySelectorAll('[data-band-edit]').forEach(el => el.addEventListener('click', () => {
          editingBandId = el.dataset.bandEdit;
          paint();
          const field = document.getElementById('bandName');
          if (field) field.focus();
        }));

        document.querySelectorAll('[data-band-retire]').forEach(el => el.addEventListener('click', async () => {
          el.disabled = true;
          try {
            await callHrData('delete_rate_band', { id: el.dataset.bandRetire });
            toast('Band retired');
            if (String(editingBandId) === String(el.dataset.bandRetire)) editingBandId = null;
            await loadRateBands();
          } catch (e) {
            el.disabled = false;
            toast(e.message || 'Could not retire that band.', 'err');
          }
        }));
        document.querySelectorAll('[data-manage-jump]').forEach(b => b.addEventListener('click', () => {
          const target = document.getElementById(b.dataset.manageJump);
          if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }));

        if (canManageBaseAccess) {
          const addBaseGroupBtn = document.getElementById('addBaseGroupBtn');
          if (addBaseGroupBtn) addBaseGroupBtn.addEventListener('click', async () => {
            const groupId = document.getElementById('newBaseGroupId').value;
            const minRankRaw = document.getElementById('newBaseGroupMinRank').value;
            const minRank = minRankRaw === '' ? null : Number(minRankRaw);
            const name = document.getElementById('newBaseGroupName').value.trim();
            if (!groupId || !(Number(groupId) > 0)) { addBaseAccessGroupError = 'Enter a valid Roblox group ID.'; paint(); return; }
            addingBaseAccessGroup = true; addBaseAccessGroupError = null; paint();
            try {
              await addBaseAccessGroup(groupId, minRank, name || null);
              addingBaseAccessGroup = false;
              await loadBaseAccessGroups();
            } catch (err) {
              addingBaseAccessGroup = false;
              addBaseAccessGroupError = (err && err.message) ? err.message : 'Could not add that group.';
              paint();
            }
          });

          document.querySelectorAll('[data-del-base-group]').forEach(el => el.addEventListener('click', async () => {
            const id = el.dataset.delBaseGroup;
            if (!(await askConfirm('Remove this sign-in group?'))) return;
            try {
              await deleteBaseAccessGroup(id);
              await loadBaseAccessGroups();
            } catch (err) {
              toast((err && err.message) || 'Could not remove that group.', 'err');
            }
          }));

          const addBaseDiscordBtn = document.getElementById('addBaseDiscordBtn');
          if (addBaseDiscordBtn) addBaseDiscordBtn.addEventListener('click', async () => {
            const guildId = document.getElementById('newBaseDiscordId').value.trim();
            const name = document.getElementById('newBaseDiscordName').value.trim();
            if (!guildId) { addBaseAccessDiscordServerError = 'Enter a Discord server ID.'; paint(); return; }
            addingBaseAccessDiscordServer = true; addBaseAccessDiscordServerError = null; paint();
            try {
              await addBaseAccessDiscordServer(guildId, name || null);
              addingBaseAccessDiscordServer = false;
              await loadBaseAccessDiscordServers();
            } catch (err) {
              addingBaseAccessDiscordServer = false;
              addBaseAccessDiscordServerError = (err && err.message) ? err.message : 'Could not add that server.';
              paint();
            }
          });

          document.querySelectorAll('[data-del-base-discord]').forEach(el => el.addEventListener('click', async () => {
            const id = el.dataset.delBaseDiscord;
            if (!(await askConfirm('Remove this sign-in Discord server?'))) return;
            try {
              await deleteBaseAccessDiscordServer(id);
              await loadBaseAccessDiscordServers();
            } catch (err) {
              toast((err && err.message) || 'Could not remove that server.', 'err');
            }
          }));
        }

        if (canManageOnboarding) {
          const addPositionBtn = document.getElementById('addPositionBtn');
          if (addPositionBtn) addPositionBtn.addEventListener('click', async () => {
            const name = document.getElementById('newPositionName').value.trim();
            const discordRoleId = document.getElementById('newPositionRoleId').value.trim() || null;
            if (!name) { addPositionError = 'Enter a position name.'; paint(); return; }
            addingPosition = true; addPositionError = null; paint();
            try {
              await addRecruitmentPosition(name, discordRoleId);
              addingPosition = false;
              await loadPositions();
            } catch (err) {
              addingPosition = false;
              addPositionError = (err && err.message) ? err.message : 'Could not add that position.';
              paint();
            }
          });

          document.querySelectorAll('[data-del-position]').forEach(el => el.addEventListener('click', async () => {
            const id = el.dataset.delPosition;
            if (!(await askConfirm('Remove this position? It will disappear from the application dropdown.'))) return;
            try {
              await deleteRecruitmentPosition(id);
              await loadPositions();
            } catch (err) {
              toast((err && err.message) || 'Could not remove that position.', 'err');
            }
          }));

          const saveRecruitConfigBtn = document.getElementById('saveRecruitConfigBtn');
          if (saveRecruitConfigBtn) saveRecruitConfigBtn.addEventListener('click', async () => {
            const autoRoleRaw = document.getElementById('recruitAutoRole').value;
            const discordRoleId = document.getElementById('recruitDiscordRole').value.trim() || null;
            const graceRaw = document.getElementById('recruitGraceHours').value.trim();
            const notifyRoleRaw = document.getElementById('recruitNotifyRole').value;
            const autoRoleId = autoRoleRaw === '' ? null : autoRoleRaw;
            const gracePeriodHours = graceRaw === '' ? null : Number(graceRaw);
            const notifyRoleId = notifyRoleRaw === '' ? null : notifyRoleRaw;
            if (gracePeriodHours != null && !(gracePeriodHours >= 0)) { recruitmentConfigError = 'Enter a valid, non-negative number of hours, or leave it blank to disable auto-accept.'; recruitmentConfigSuccess = false; paint(); return; }
            savingRecruitmentConfig = true; recruitmentConfigError = null; recruitmentConfigSuccess = false; paint();
            try {
              await saveRecruitmentConfig(autoRoleId, discordRoleId, gracePeriodHours, notifyRoleId);
              recruitmentConfig = { autoRoleId, discordRoleId, gracePeriodHours, notifyRoleId };
              savingRecruitmentConfig = false; recruitmentConfigSuccess = true; paint();
            } catch (err) {
              savingRecruitmentConfig = false;
              recruitmentConfigError = (err && err.message) ? err.message : 'Could not save auto-hire settings. Check your connection and try again.';
              paint();
            }
          });

          const saveApprovalConfigBtn = document.getElementById('saveApprovalConfigBtn');
          if (saveApprovalConfigBtn) saveApprovalConfigBtn.addEventListener('click', async () => {
            const signoffRoleId = document.getElementById('signoffRoleSelect').value || null;
            const producerRoleId = document.getElementById('producerRoleSelect').value || null;
            savingApprovalConfig = true; approvalConfigError = null; approvalConfigSuccess = false; paint();
            try {
              await saveRecruitmentApprovalConfig(signoffRoleId, producerRoleId);
              approvalConfig = { signoffRoleId, producerRoleId };
              savingApprovalConfig = false; approvalConfigSuccess = true; paint();
            } catch (err) {
              savingApprovalConfig = false;
              approvalConfigError = (err && err.message) ? err.message : 'Could not save these settings. Check your connection and try again.';
              paint();
            }
          });

          const saveOnboardingGroupConfigBtn = document.getElementById('saveOnboardingGroupConfigBtn');
          if (saveOnboardingGroupConfigBtn) saveOnboardingGroupConfigBtn.addEventListener('click', async () => {
            const groupIdRaw = document.getElementById('onboardingGroupId').value;
            const groupRoleIdRaw = document.getElementById('onboardingGroupRoleId').value;
            const groupId = groupIdRaw === '' ? null : Number(groupIdRaw);
            const groupRoleId = groupRoleIdRaw === '' ? null : Number(groupRoleIdRaw);
            savingOnboardingGroupConfig = true; onboardingGroupConfigError = null; onboardingGroupConfigSuccess = false; paint();
            try {
              await saveOnboardingGroupConfig(groupId, groupRoleId);
              onboardingGroupConfig = { groupId, groupRoleId };
              savingOnboardingGroupConfig = false; onboardingGroupConfigSuccess = true; paint();
            } catch (err) {
              savingOnboardingGroupConfig = false;
              onboardingGroupConfigError = (err && err.message) ? err.message : 'Could not save these settings. Check your connection and try again.';
              paint();
            }
          });
        }

        if (canManageRate) {
          const saveRateBtn = document.getElementById('saveRateBtn');
          if (saveRateBtn) saveRateBtn.addEventListener('click', async () => {
            const input = document.getElementById('ratePer10k');
            const per10k = Number(input.value);
            if (!(per10k >= 0)) { rateError = 'Enter a valid, non-negative number.'; rateSuccess = false; paint(); return; }
            savingRate = true; rateError = null; rateSuccess = false; paint();
            try {
              await saveDevexRate(per10k / 10000);
              savingRate = false; rateSuccess = true; paint();
            } catch (err) {
              savingRate = false;
              rateError = (err && err.message) ? err.message : 'Could not save the rate. Check your connection and try again.';
              paint();
            }
          });

          const saveUsdMinBtn = document.getElementById('saveUsdMinBtn');
          if (saveUsdMinBtn) saveUsdMinBtn.addEventListener('click', async () => {
            const input = document.getElementById('usdMinInput');
            const threshold = Number(input.value);
            if (!(threshold >= 0)) { usdMinError = 'Enter a valid, non-negative number.'; usdMinSuccess = false; paint(); return; }
            savingUsdMin = true; usdMinError = null; usdMinSuccess = false; paint();
            try {
              await saveUsdMinimum(threshold);
              usdMinimum = threshold;
              savingUsdMin = false; usdMinSuccess = true; paint();
            } catch (err) {
              savingUsdMin = false;
              usdMinError = (err && err.message) ? err.message : 'Could not save the threshold. Check your connection and try again.';
              paint();
            }
          });
        }

        if (canManageGames) {
          const addGameBtn = document.getElementById('addGameBtn');
          if (addGameBtn) addGameBtn.addEventListener('click', async () => {
            const input = document.getElementById('newGameName');
            const name = input.value.trim();
            if (!name) { gameError = 'Enter a game name.'; paint(); return; }
            addingGame = true; gameError = null; paint();
            try {
              await addGame(name);
              addingGame = false; paint();
            } catch (err) {
              addingGame = false;
              gameError = (err && err.message) ? err.message : 'Could not add that game, it may already exist.';
              paint();
            }
          });

          document.querySelectorAll('[data-del-game]').forEach(el => el.addEventListener('click', async () => {
            const id = el.dataset.delGame;
            if (!(await askConfirm('Remove this game from the list? Existing requests keep the game name they were logged with.'))) return;
            try {
              await deleteGame(id);
              paint();
            } catch (err) {
              toast((err && err.message) || 'Could not remove that game.', 'err');
            }
          }));
        }

        if (canManageGroups) {
          const ignoreEligibilityCheckbox = document.getElementById('ignoreEligibilityCheckbox');
          if (ignoreEligibilityCheckbox) ignoreEligibilityCheckbox.addEventListener('change', async () => {
            const next = ignoreEligibilityCheckbox.checked;
            ignoreEligibility = next;
            ignoreEligibilitySaving = true; ignoreEligibilityError = null; paint();
            try {
              await saveIgnoreEligibility(next);
              ignoreEligibilitySaving = false; paint();
            } catch (err) {
              ignoreEligibility = !next;
              ignoreEligibilitySaving = false;
              ignoreEligibilityError = (err && err.message) ? err.message : 'Could not save this setting. Check your connection and try again.';
              paint();
            }
          });

          const addGroupBtn = document.getElementById('addGroupBtn');
          if (addGroupBtn) addGroupBtn.addEventListener('click', async () => {
            const groupId = document.getElementById('newGroupId').value;
            const name = document.getElementById('newGroupName').value.trim();
            if (!groupId || !name) { addGroupError = 'Enter a group ID and a display name.'; paint(); return; }
            addingGroup = true; addGroupError = null; paint();
            try {
              await addRequiredGroup({ robloxGroupId: groupId, name });
              addingGroup = false;
              await loadGroups();
            } catch (err) {
              addingGroup = false;
              addGroupError = (err && err.message) ? err.message : 'Could not add that group.';
              paint();
            }
          });

          document.querySelectorAll('[data-del-group]').forEach(el => el.addEventListener('click', async () => {
            const id = el.dataset.delGroup;
            if (!(await askConfirm('Remove this eligibility requirement?'))) return;
            try {
              await deleteRequiredGroup(id);
              await loadGroups();
            } catch (err) {
              toast((err && err.message) || 'Could not remove that group.', 'err');
            }
          }));
        }

        if (canManageRoles) {
          const addRoleBtn = document.getElementById('addRoleBtn');
          if (addRoleBtn) addRoleBtn.addEventListener('click', async () => {
            const name = document.getElementById('newRoleName').value.trim();
            const groupId = document.getElementById('newRoleGroupId').value;
            const minRank = document.getElementById('newRoleMinRank').value;
            const hierarchy = document.getElementById('newRoleHierarchy').value;
            const linkOnly = document.getElementById('newRoleLinkOnly').checked;
            const discordRoleId = (document.getElementById('newRoleDiscordRoleId') || { value: '' }).value.trim();
            const permissions = Array.from(document.querySelectorAll('.newRolePerm:checked')).map(el => el.value);
            if (!name) { addRoleError = 'Enter a role name.'; paint(); return; }
            if (hierarchy !== '' && Number(hierarchy) >= hrMaxHierarchy) { addRoleError = 'Hierarchy level must be lower than your own.'; paint(); return; }
            addingRole = true; addRoleError = null; paint();
            try {
              await addRole({ name, robloxGroupId: groupId, minRank, hierarchy, linkOnly, permissions, discordRoleId });
              addingRole = false;
              await loadRoles();
            } catch (err) {
              addingRole = false;
              addRoleError = (err && err.message) ? err.message : 'Could not add that role.';
              paint();
            }
          });

          document.querySelectorAll('[data-del-role]').forEach(el => el.addEventListener('click', async () => {
            const id = el.dataset.delRole;
            if (!(await askConfirm('Remove this role? Anyone who only had access through it will lose access.'))) return;
            try {
              await deleteRole(id);
              await loadRoles();
            } catch (err) {
              toast((err && err.message) || 'Could not remove that role.', 'err');
            }
          }));

          document.querySelectorAll('[data-edit-role]').forEach(el => el.addEventListener('click', () => {
            const id = el.dataset.editRole;
            editingRoleId = editingRoleId === id ? null : id;
            editRoleError = null;
            paint();
          }));

          const permBoxes = (cls, roleId) => [...document.querySelectorAll('.' + cls + (roleId ? `[data-role-id="${roleId}"]` : ''))];
          document.querySelectorAll('[data-perm-preset]').forEach(el => el.addEventListener('click', () => {
            const preset = el.dataset.permPreset;
            const boxes = permBoxes(el.dataset.permTarget, el.dataset.roleId);
            const list = preset === 'None' ? [] : (PERMISSION_PRESETS[preset] || ALL_PERMISSIONS);
            boxes.forEach(b => { b.checked = preset === 'Everything' ? true : list.includes(b.value); });
          }));
          document.querySelectorAll('[data-perm-group]').forEach(el => el.addEventListener('click', () => {
            const boxes = permBoxes(el.dataset.permTarget, el.dataset.roleId).filter(b => b.dataset.permGroupId === el.dataset.permGroup);
            const allOn = boxes.every(b => b.checked);
            boxes.forEach(b => { b.checked = !allOn; });
            el.textContent = allOn ? 'All' : 'None';
          }));
          document.querySelectorAll('[data-save-role]').forEach(el => el.addEventListener('click', async () => {
            const id = el.dataset.saveRole;
            const name = document.querySelector(`.editRoleName[data-role-id="${id}"]`).value.trim();
            const groupId = document.querySelector(`.editRoleGroupId[data-role-id="${id}"]`).value;
            const minRank = document.querySelector(`.editRoleMinRank[data-role-id="${id}"]`).value;
            const hierarchy = document.querySelector(`.editRoleHierarchy[data-role-id="${id}"]`).value;
            const linkOnly = document.querySelector(`.editRoleLinkOnly[data-role-id="${id}"]`).checked;
            const discordRoleId = (document.querySelector(`.editRoleDiscordRoleId[data-role-id="${id}"]`) || { value: '' }).value.trim();
            const permissions = Array.from(document.querySelectorAll(`.editRolePerm[data-role-id="${id}"]:checked`)).map(x => x.value);
            if (!name) { editRoleError = 'Enter a role name.'; paint(); return; }
            if (hierarchy !== '' && Number(hierarchy) >= hrMaxHierarchy) { editRoleError = 'Hierarchy level must be lower than your own.'; paint(); return; }
            savingRoleEdit = true; editRoleError = null; paint();
            try {
              await updateRole(id, { name, robloxGroupId: groupId, minRank, hierarchy, linkOnly, permissions, discordRoleId });
              savingRoleEdit = false;
              editingRoleId = null;
              await loadRoles();
            } catch (err) {
              savingRoleEdit = false;
              editRoleError = (err && err.message) ? err.message : 'Could not save that role.';
              paint();
            }
          }));

          const addAssignmentBtn = document.getElementById('addAssignmentBtn');
          if (addAssignmentBtn) addAssignmentBtn.addEventListener('click', async () => {
            const userId = document.getElementById('newAssignmentUserId').value;
            const roleId = document.getElementById('newAssignmentRoleId').value;
            if (!userId || !roleId) { addAssignmentError = 'Enter a Roblox user ID and pick a role.'; paint(); return; }
            addingAssignment = true; addAssignmentError = null; paint();
            try {
              await addRoleAssignment(roleId, userId);
              addingAssignment = false;
              await loadAssignments();
            } catch (err) {
              addingAssignment = false;
              addAssignmentError = (err && err.message) ? err.message : 'Could not assign that role.';
              paint();
            }
          });

          document.querySelectorAll('[data-del-assignment]').forEach(el => el.addEventListener('click', async () => {
            const id = el.dataset.delAssignment;
            try {
              await deleteRoleAssignment(id);
              await loadAssignments();
            } catch (err) {
              toast((err && err.message) || 'Could not remove that assignment.', 'err');
            }
          }));
        }

        if (canManageOnboarding) {
          const addTeamBtn = document.getElementById('addTeamBtn');
          if (addTeamBtn) addTeamBtn.addEventListener('click', async () => {
            const name = document.getElementById('newTeamName').value.trim();
            const color = document.getElementById('newTeamColor').value.trim();
            const discordUrl = (document.getElementById('newTeamDiscord') || { value: '' }).value.trim();
            const robloxGroupUrl = document.getElementById('newTeamGroupUrl').value.trim();
            const robloxGroupId = document.getElementById('newTeamGroupId').value.trim() || null;
            const defaultGroupRoleId = document.getElementById('newTeamGroupRoleId').value.trim() || null;
            const info = document.getElementById('newTeamInfo').value.trim();
            const skillsetIds = Array.from(document.querySelectorAll('.newTeamSkillset:checked')).map(el => Number(el.value));
            if (!name) { addTeamError = 'Enter a team name.'; paint(); return; }
            addingTeam = true; addTeamError = null; paint();
            try {
              await addTeam({ name, color, discordUrl, robloxGroupUrl, robloxGroupId, defaultGroupRoleId, info, skillsetIds });
              addingTeam = false;
              await loadTeamsData();
            } catch (err) {
              addingTeam = false;
              addTeamError = (err && err.message) ? err.message : 'Could not add that team.';
              paint();
            }
          });

          document.querySelectorAll('[data-edit-team]').forEach(el => el.addEventListener('click', () => {
            const id = Number(el.dataset.editTeam);
            editingTeamId = editingTeamId === id ? null : id;
            editTeamError = null;
            paint();
          }));

          document.querySelectorAll('[data-save-team]').forEach(el => el.addEventListener('click', async () => {
            const id = Number(el.dataset.saveTeam);
            const name = document.querySelector(`.editTeamName[data-team-id="${id}"]`).value.trim();
            const color = document.querySelector(`.editTeamColor[data-team-id="${id}"]`).value.trim();
            const discordUrl = (document.querySelector(`.editTeamDiscord[data-team-id="${id}"]`) || { value: '' }).value.trim();
            const robloxGroupUrl = document.querySelector(`.editTeamGroupUrl[data-team-id="${id}"]`).value.trim();
            const robloxGroupId = document.querySelector(`.editTeamGroupId[data-team-id="${id}"]`).value.trim() || null;
            const defaultGroupRoleId = document.querySelector(`.editTeamGroupRoleId[data-team-id="${id}"]`).value.trim() || null;
            const info = document.querySelector(`.editTeamInfo[data-team-id="${id}"]`).value;
            const skillsetIds = Array.from(document.querySelectorAll(`.editTeamSkillset[data-team-id="${id}"]:checked`)).map(x => Number(x.value));
            if (!name) { editTeamError = 'Enter a team name.'; paint(); return; }
            savingTeamEdit = true; editTeamError = null; paint();
            try {
              await updateTeam(id, { name, color, discordUrl, robloxGroupUrl, robloxGroupId, defaultGroupRoleId, info, skillsetIds });
              savingTeamEdit = false;
              editingTeamId = null;
              await loadTeamsData();
            } catch (err) {
              savingTeamEdit = false;
              editTeamError = (err && err.message) ? err.message : 'Could not save that team.';
              paint();
            }
          }));

          document.querySelectorAll('[data-del-team]').forEach(el => el.addEventListener('click', async () => {
            const id = el.dataset.delTeam;
            if (!(await askConfirm('Remove this team? Anyone assigned to it keeps their assignment record, but the team info disappears from their onboarding.'))) return;
            try {
              await deleteTeam(id);
              await loadTeamsData();
            } catch (err) {
              toast((err && err.message) || 'Could not remove that team.', 'err');
            }
          }));

          const addSkillsetBtn = document.getElementById('addSkillsetBtn');
          if (addSkillsetBtn) addSkillsetBtn.addEventListener('click', async () => {
            const name = document.getElementById('newSkillsetName').value.trim();
            const color = document.getElementById('newSkillsetColor').value.trim();
            const description = document.getElementById('newSkillsetDescription').value.trim();
            if (!name) { addSkillsetError = 'Enter a skillset name.'; paint(); return; }
            addingSkillset = true; addSkillsetError = null; paint();
            try {
              await addSkillset({ name, color, description });
              addingSkillset = false;
              await loadTeamsData();
            } catch (err) {
              addingSkillset = false;
              addSkillsetError = (err && err.message) ? err.message : 'Could not add that skillset.';
              paint();
            }
          });

          document.querySelectorAll('[data-del-skillset]').forEach(el => el.addEventListener('click', async () => {
            const id = el.dataset.delSkillset;
            if (!(await askConfirm('Remove this skillset?'))) return;
            try {
              await deleteSkillset(id);
              await loadTeamsData();
            } catch (err) {
              toast((err && err.message) || 'Could not remove that skillset.', 'err');
            }
          }));

          document.querySelectorAll('[data-copy-link]').forEach(el => el.addEventListener('click', (e) => {
            copyText(el.dataset.copyLink, e.currentTarget, 'Copied!');
          }));

          document.querySelectorAll('[data-del-link]').forEach(el => el.addEventListener('click', async () => {
            const token = el.dataset.delLink;
            if (!(await askConfirm('Remove this invite link? It will stop working immediately.'))) return;
            try {
              await deleteOnboardingLink(token);
              await loadLinksData();
            } catch (err) {
              toast((err && err.message) || 'Could not remove that link.', 'err');
            }
          }));

          const createLinkBtn = document.getElementById('createLinkBtn');
          if (createLinkBtn) createLinkBtn.addEventListener('click', async () => {
            const teamId = document.getElementById('newLinkTeam').value || null;
            const skillsetId = document.getElementById('newLinkSkillset').value || null;
            const roleId = document.getElementById('newLinkRole') ? (document.getElementById('newLinkRole').value || null) : null;
            const label = document.getElementById('newLinkLabel').value.trim();
            addingLink = true; addLinkError = null; lastCreatedLink = null; paint();
            try {
              const result = await createOnboardingLink(teamId, skillsetId, roleId, label);
              addingLink = false;
              lastCreatedLink = result.url;
              await loadLinksData();
            } catch (err) {
              addingLink = false;
              addLinkError = (err && err.message) ? err.message : 'Could not create that link.';
              paint();
            }
          });
        }

        if (canManageBroadcasts) {
          document.querySelectorAll('input[name="broadcastType"]').forEach(el => el.addEventListener('change', () => {
            newBroadcastType = el.value;
            paint();
          }));

          const addBroadcastBtn = document.getElementById('addBroadcastBtn');
          if (addBroadcastBtn) addBroadcastBtn.addEventListener('click', async () => {
            const message = document.getElementById('newBroadcastMessage').value.trim();
            const teamSelect = document.getElementById('newBroadcastTeam');
            const teamId = teamSelect ? teamSelect.value : '';
            if (!message) { addBroadcastError = 'Enter a message.'; paint(); return; }
            if (newBroadcastType === 'team' && !teamId) { addBroadcastError = 'Pick a team.'; paint(); return; }
            addingBroadcast = true; addBroadcastError = null; paint();
            try {
              await createBroadcast({ type: newBroadcastType, teamId: newBroadcastType === 'team' ? teamId : null, message });
              addingBroadcast = false;
              await loadBroadcastsData();
            } catch (err) {
              addingBroadcast = false;
              addBroadcastError = (err && err.message) ? err.message : 'Could not send that broadcast.';
              paint();
            }
          });

          document.querySelectorAll('[data-del-broadcast]').forEach(el => el.addEventListener('click', async () => {
            const id = el.dataset.delBroadcast;
            if (!(await askConfirm('Remove this broadcast? It will disappear from everyone\'s "My payments" tab.'))) return;
            try {
              await deleteBroadcast(id);
              await loadBroadcastsData();
            } catch (err) {
              toast((err && err.message) || 'Could not remove that broadcast.', 'err');
            }
          }));
        }
      }

      async function loadGroups() {
        groupsLoading = true; groupsError = null; paint();
        try {
          requiredGroups = await listRequiredGroups();
        } catch (err) {
          groupsError = (err && err.message) ? err.message : 'Could not load groups.';
        }
        if (myGen !== renderGen) return;
        groupsLoading = false;
        paint();
      }

      async function loadIgnoreEligibility() {
        ignoreEligibilityLoading = true; ignoreEligibilityError = null; paint();
        try {
          ignoreEligibility = await getIgnoreEligibility();
        } catch (err) {
          ignoreEligibilityError = (err && err.message) ? err.message : 'Could not load the current setting.';
        }
        if (myGen !== renderGen) return;
        ignoreEligibilityLoading = false;
        paint();
      }

      async function loadBaseAccessGroups() {
        baseAccessGroupsLoading = true; baseAccessGroupsError = null; paint();
        try {
          baseAccessGroups = await getBaseAccessGroups();
        } catch (err) {
          baseAccessGroupsError = (err && err.message) ? err.message : 'Could not load the sign-in groups.';
        }
        if (myGen !== renderGen) return;
        baseAccessGroupsLoading = false;
        paint();
      }

      async function loadBaseAccessDiscordServers() {
        baseAccessDiscordServersLoading = true; baseAccessDiscordServersError = null; paint();
        try {
          baseAccessDiscordServers = await getBaseAccessDiscordServers();
        } catch (err) {
          baseAccessDiscordServersError = (err && err.message) ? err.message : 'Could not load the sign-in Discord servers.';
        }
        if (myGen !== renderGen) return;
        baseAccessDiscordServersLoading = false;
        paint();
      }

      async function loadRoles() {
        rolesLoading = true; rolesError = null; paint();
        try {
          roles = await listRoles();
        } catch (err) {
          rolesError = (err && err.message) ? err.message : 'Could not load roles.';
        }
        if (myGen !== renderGen) return;
        rolesLoading = false;
        paint();
      }

      async function loadRecruitmentConfig() {
        recruitmentConfigLoading = true; recruitmentConfigError = null; paint();
        try {
          recruitmentConfig = await getRecruitmentConfig();
        } catch (err) {
          recruitmentConfigError = (err && err.message) ? err.message : 'Could not load auto-hire settings.';
        }
        if (myGen !== renderGen) return;
        recruitmentConfigLoading = false;
        paint();
      }

      async function loadPositions() {
        positionsLoading = true; positionsError = null; paint();
        try {
          positions = await getRecruitmentPositions();
        } catch (err) {
          positionsError = (err && err.message) ? err.message : 'Could not load positions.';
        }
        if (myGen !== renderGen) return;
        positionsLoading = false;
        paint();
      }

      async function loadUsdMinimum() {
        try {
          const data = await getUsdMinimum();
          usdMinimum = data ? data.threshold : 0;
        } catch (err) { }
        if (myGen !== renderGen) return;
        paint();
      }

      async function loadRateBands() {
        bandError = null;
        try {
          const json = await callHrData('list_rate_bands');
          rateBands = json.data || [];
          rateBandsLoaded = true;
        } catch (err) {
          bandError = (err && err.message) ? err.message : 'Could not load the rate card.';
          rateBandsLoaded = true;
        }
        if (myGen !== renderGen) return;
        paint();
      }

      async function loadApprovalConfig() {
        approvalConfigLoading = true; approvalConfigError = null; paint();
        try {
          approvalConfig = await getRecruitmentApprovalConfig();
        } catch (err) {
          approvalConfigError = (err && err.message) ? err.message : 'Could not load approval settings.';
        }
        if (myGen !== renderGen) return;
        approvalConfigLoading = false;
        paint();
      }

      async function loadOnboardingGroupConfig() {
        onboardingGroupConfigLoading = true; onboardingGroupConfigError = null; paint();
        try {
          onboardingGroupConfig = await getOnboardingGroupConfig();
        } catch (err) {
          onboardingGroupConfigError = (err && err.message) ? err.message : 'Could not load onboarding settings.';
        }
        if (myGen !== renderGen) return;
        onboardingGroupConfigLoading = false;
        paint();
      }

      async function loadRobloxGroupApiKeyStatus() {
        robloxGroupApiKeyStatusLoading = true; paint();
        try {
          robloxGroupApiKeyStatus = await getRobloxGroupApiKeyStatus();
        } catch (err) { }
        if (myGen !== renderGen) return;
        robloxGroupApiKeyStatusLoading = false;
        paint();
      }

      async function loadAssignments() {
        try {
          assignments = await listRoleAssignments();
        } catch (err) {
          assignments = [];
        }
        if (myGen !== renderGen) return;
        paint();
      }

      async function loadTeamsData() {
        teamsLoading = true; teamsError = null; paint();
        try {
          const [teamsData, skillsetsData] = await Promise.all([listTeams(), listSkillsets()]);
          teams = teamsData;
          skillsets = skillsetsData;
        } catch (err) {
          teamsError = (err && err.message) ? err.message : 'Could not load teams and skillsets.';
        }
        if (myGen !== renderGen) return;
        teamsLoading = false;
        paint();
        loadLinksData();
      }

      async function loadLinksData() {
        try {
          onboardingLinks = await listOnboardingLinks();
        } catch (err) {
          onboardingLinks = [];
        }
        if (myGen !== renderGen) return;
        paint();
      }

      async function loadBroadcastsData() {
        broadcastsLoading = true; broadcastsError = null; paint();
        try {
          const [broadcastsData, teamsData] = await Promise.all([listBroadcasts(), listTeams()]);
          broadcasts = broadcastsData;
          broadcastTeams = teamsData;
        } catch (err) {
          broadcastsError = (err && err.message) ? err.message : 'Could not load broadcasts.';
        }
        if (myGen !== renderGen) return;
        broadcastsLoading = false;
        paint();
      }

      paint();
      if (canManageGroups) { loadGroups(); loadIgnoreEligibility(); }
      if (canManageBaseAccess) { loadBaseAccessGroups(); if (discordOn()) loadBaseAccessDiscordServers(); }
      if (canManageRoles) {
        loadRoles().then(loadAssignments);
      } else if (canManageOnboarding) {
        loadRoles();
      }
      if (canManageOnboarding) {
        loadTeamsData();
        loadRobloxGroupApiKeyStatus();
        if (featureOn('recruitment')) { loadPositions(); loadRecruitmentConfig(); loadApprovalConfig(); }
        if (discordOn()) loadOnboardingGroupConfig();
      }
      if (canManageRate) { loadUsdMinimum(); loadRateBands(); }
      if (canManageBroadcasts) loadBroadcastsData();
    }

    // ---------------------------------------------------------------------------------
    // Settings > Branding. Everything that makes the panel look like the studio's own:
    // name, logo, colours, sign-in page, features, payout options and legal text. Saved to
    // the database and applied for everyone straight away. Only people with
    // settings.manage_branding can open it.
    //
    // The draft lives outside the Settings page so it survives the page re-painting while
    // other settings finish loading.
    // ---------------------------------------------------------------------------------
    const brandingState = { loading: false, loaded: false, error: null, data: null, draft: null, dirty: false, saving: false, notice: null, legalTab: 'tos' };

    const BRANDING_FEATURES = [
      ['payments', 'Payments', 'Logging work, approvals and payouts'],
      ['claims', 'Payment requests', 'Staff can ask to be paid for work'],
      ['paymentRuns', 'Payment runs', 'Group approved work into a pay day'],
      ['analytics', 'Analytics', 'Spend and output charts'],
      ['teams', 'Teams & games', 'Teams, games, task boards and deadlines'],
      ['staffDatabase', 'Staff database', 'Everyone in one searchable list'],
      ['broadcasts', 'Announcements', 'Messages shown to everyone or a team'],
      ['security', 'Security centre', 'Security levels, holds and sessions'],
      ['audit', 'Audit log', 'Every important change, with undo'],
      ['backups', 'Backups', 'Snapshots of the database you can restore'],
      ['pushNotifications', 'Browser notifications', 'Push notifications where supported']
    ];
    const BRANDING_METHOD_LABELS = { PAYPAL: 'PayPal', DEVEX_ROBUX: 'Robux', VENMO: 'Venmo', BANK_TRANSFER: 'Bank transfer' };
    const BRANDING_CURRENCY_LABELS = { ROBUX: 'Robux', USD: 'US dollars' };

    function brandingGet(path) {
      return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), brandingState.draft);
    }
    function brandingSet(path, value) {
      const keys = path.split('.');
      let o = brandingState.draft;
      keys.slice(0, -1).forEach(k => { if (!o[k] || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
      o[keys[keys.length - 1]] = value;
      brandingState.dirty = true;
    }

    // Shrinks an uploaded image in the browser so it can be stored with the branding.
    function brandingResizeImage(file, maxW, maxH, type) {
      return new Promise((resolve, reject) => {
        if (!/^image\//.test(file.type)) { reject(new Error('Pick an image file (PNG, JPG, WebP or SVG).')); return; }
        if (file.size > 8 * 1024 * 1024) { reject(new Error('That image is over 8 MB. Pick a smaller one.')); return; }
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Couldn't read that file."));
        reader.onload = () => {
          const img = new Image();
          img.onerror = () => reject(new Error("Couldn't open that image."));
          img.onload = () => {
            const scale = Math.min(1, maxW / (img.naturalWidth || maxW), maxH / (img.naturalHeight || maxH));
            const w = Math.max(1, Math.round((img.naturalWidth || maxW) * scale));
            const h = Math.max(1, Math.round((img.naturalHeight || maxH) * scale));
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, w, h);
            let quality = 0.86;
            let out = canvas.toDataURL(type, quality);
            while (out.length > 280 * 1024 && quality > 0.4 && type !== 'image/png') { quality -= 0.1; out = canvas.toDataURL(type, quality); }
            if (out.length > 280 * 1024 && type === 'image/png') out = canvas.toDataURL('image/webp', 0.85);
            if (out.length > 290 * 1024) { reject(new Error('That image is still too large after shrinking it. Try a simpler one.')); return; }
            resolve(out);
          };
          img.src = reader.result;
        };
        reader.readAsDataURL(file);
      });
    }

    function brandingValidate(d) {
      const errs = [];
      const st = d.studio || {};
      const hex = /^#[0-9a-fA-F]{6}$/;
      const url = (v) => !v || /^https:\/\/[^\s"'<>]+$/i.test(v) || /^(#\/|\/|\.\/)?[a-zA-Z0-9._\-/#?=&%]+$/.test(v) || /^data:image\//.test(v);
      if (!String(st.name || '').trim()) errs.push('Studio name can’t be empty.');
      if (st.shortName && String(st.shortName).length > 4) errs.push('Initials can be at most 4 characters.');
      if (st.requestIdPrefix && !/^[A-Z0-9]{1,6}$/.test(st.requestIdPrefix)) errs.push('Request ID prefix must be 1 to 6 capital letters or numbers.');
      if (st.website && !/^https:\/\//i.test(st.website)) errs.push('Website must start with https://');
      if (st.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(st.contactEmail)) errs.push('Contact email doesn’t look right.');
      if (!url(st.logoUrl)) errs.push('Logo must be an uploaded image or an https:// link.');
      if (!url((d.signIn || {}).backgroundImage)) errs.push('Background image must be an uploaded image or an https:// link.');
      if (!hex.test((d.theme || {}).accent || '')) errs.push('Accent colour must be a hex colour like #5B5FEF.');
      if (!hex.test((d.theme || {}).accentDark || '')) errs.push('Dark mode accent must be a hex colour like #8C8FFF.');
      if (!((d.payments || {}).currencies || []).length) errs.push('Keep at least one currency switched on.');
      if (!((d.payments || {}).methods || []).length) errs.push('Keep at least one payout method switched on.');
      return errs;
    }

    function brandingPreviewHtml() {
      const d = brandingState.draft;
      const st = d.studio || {};
      const th = d.theme || {};
      const name = [st.name || 'Studio', st.productName].filter(Boolean).join(' ');
      const mark = st.logoUrl ? `<img src="${esc(st.logoUrl)}" alt="">` : `<span>${esc((st.shortName || (st.name || 'S').slice(0, 2)).toUpperCase())}</span>`;
      const accent = /^#[0-9a-fA-F]{6}$/.test(th.accent || '') ? th.accent : '#5B5FEF';
      return `
        <div class="bp-card" style="--bp-accent:${accent};--bp-radius:${Math.max(4, Math.min(28, Number(th.radius) || 14))}px;">
          <div class="bp-label">Preview</div>
          <div class="bp-app">
            <div class="bp-side">
              <div class="bp-brand"><span class="bp-mark">${mark}</span><b>${esc(name)}</b></div>
              <div class="bp-nav on">Home</div><div class="bp-nav">My payments</div><div class="bp-nav">Review &amp; pay</div>
            </div>
            <div class="bp-main">
              <div class="bp-title">Good morning</div>
              <div class="bp-tile"><small>Owed to you</small><strong>R$ 12,500</strong></div>
              <span class="bp-btn">Request payment</span>
            </div>
          </div>
          <div class="bp-signin">
            <div class="bp-art"${d.signIn && d.signIn.backgroundImage ? ` style="background-image:linear-gradient(rgba(8,9,12,.55),rgba(8,9,12,.55)),url('${esc(d.signIn.backgroundImage)}')"` : ''}><b>${esc((d.signIn || {}).headline || '')}</b></div>
            <div class="bp-form"><b>${esc((d.signIn || {}).title || 'Sign in')}</b><span class="bp-btn dark">${esc((d.signIn || {}).buttonLabel || 'Sign in')}</span></div>
          </div>
        </div>`;
    }

    function brandingFieldHtml(path, label, opts) {
      const o = opts || {};
      const val = brandingGet(path);
      const id = 'bk_' + path.replace(/\./g, '_');
      const hint = o.hint ? `<span class="hint">${esc(o.hint)}</span>` : '';
      if (o.textarea) {
        return `<div class="field"><label for="${id}">${esc(label)} ${hint}</label><textarea id="${id}" data-bk="${esc(path)}" rows="${o.rows || 3}" maxlength="${o.max || 240}" placeholder="${esc(o.placeholder || '')}">${esc(val || '')}</textarea></div>`;
      }
      return `<div class="field"><label for="${id}">${esc(label)} ${hint}</label><input type="${o.type || 'text'}" id="${id}" data-bk="${esc(path)}" value="${esc(val == null ? '' : val)}" maxlength="${o.max || 120}" placeholder="${esc(o.placeholder || '')}"${o.upper ? ' style="text-transform:uppercase"' : ''} autocomplete="off" spellcheck="${o.spell ? 'true' : 'false'}"></div>`;
    }

    function brandingImageHtml(path, label, help) {
      const val = brandingGet(path) || '';
      const isUpload = /^data:image\//.test(val);
      return `
        <div class="field bk-image">
          <label>${esc(label)}</label>
          <div class="bk-image-row">
            <div class="bk-thumb${path === 'signIn.backgroundImage' ? ' wide' : ''}">${val ? `<img src="${esc(val)}" alt="">` : '<span>None</span>'}</div>
            <div class="bk-image-actions">
              <label class="btn btn-ghost btn-sm bk-upload">Upload image<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" data-bk-upload="${esc(path)}" hidden></label>
              ${val ? `<button type="button" class="btn btn-ghost btn-sm" data-bk-clear="${esc(path)}">Remove</button>` : ''}
            </div>
          </div>
          <input type="text" data-bk="${esc(path)}" value="${isUpload ? '' : esc(val)}" placeholder="${isUpload ? 'Using the uploaded image' : 'Or paste an https:// link'}" autocomplete="off" spellcheck="false">
          ${help ? `<p class="hint">${esc(help)}</p>` : ''}
        </div>`;
    }

    function brandingColorHtml(path, label, hint) {
      const val = brandingGet(path) || '#000000';
      return `
        <div class="field">
          <label>${esc(label)} ${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</label>
          <div class="bk-color">
            <input type="color" value="${esc(/^#[0-9a-fA-F]{6}$/.test(val) ? val : '#000000')}" data-bk-color="${esc(path)}" aria-label="${esc(label)}">
            <input type="text" data-bk="${esc(path)}" value="${esc(val)}" maxlength="7" spellcheck="false" autocomplete="off">
          </div>
        </div>`;
    }

    function brandingEditorHtml() {
      const S = brandingState;
      if (S.loading && !S.data) return `<div class="dash-loading">Loading branding...</div>`;
      if (S.error && !S.data) return `<div class="error-box"><span>${esc(S.error)}</span></div><button type="button" class="btn btn-ghost btn-sm" id="bkRetry">Try again</button>`;
      const d = S.draft;
      const locked = new Set(S.data.lockedFeatures || []);
      const feats = BRANDING_FEATURES.filter(f => !locked.has(f[0]));
      const legalKeys = [['tos', 'Terms of Service'], ['privacy', 'Privacy Policy'], ['aup', 'Acceptable Use']];
      const lt = S.legalTab;
      const legalVal = (d.legal || {})[lt] || '';
      return `
      <div class="heading-block">
        <h2 class="sec-title">Branding</h2>
        <p class="sub">How the panel looks and reads for everyone, including the sign-in page. Changes go live as soon as you save.</p>
      </div>
      ${S.notice ? `<div class="${S.notice.ok ? 'confirm-box' : 'error-box'}" role="status">${S.notice.ok ? '<div class="icon">&#10003;</div><div class="txt">' : '<span>'}${S.notice.ok ? `<strong>${esc(S.notice.text)}</strong></div>` : `${esc(S.notice.text)}</span>`}</div>` : ''}
      <div class="bk-layout">
        <div class="bk-form">
          <section class="panel bk-section">
            <h3>Studio</h3>
            <div class="row2">
              ${brandingFieldHtml('studio.name', 'Studio name', { max: 60, placeholder: 'e.g. Northwind Games' })}
              ${brandingFieldHtml('studio.productName', 'Product name', { max: 40, hint: '(optional)', placeholder: 'e.g. Hub' })}
            </div>
            <div class="row3">
              ${brandingFieldHtml('studio.shortName', 'Initials', { max: 4, upper: true, placeholder: 'NW' })}
              ${brandingFieldHtml('studio.requestIdPrefix', 'Request ID prefix', { max: 6, upper: true, placeholder: 'NW' })}
              ${brandingFieldHtml('studio.contactEmail', 'Contact email', { max: 120, type: 'email', placeholder: 'ops@studio.com' })}
            </div>
            <div class="row2">
              ${brandingFieldHtml('studio.website', 'Website', { max: 200, hint: '(optional)', placeholder: 'https://studio.com' })}
              ${brandingFieldHtml('studio.websiteLabel', 'Website label', { max: 60, hint: '(optional)', placeholder: 'studio.com' })}
            </div>
            <p class="hint" style="margin:0;">The name shown everywhere is the studio name followed by the product name. Initials are used when there's no logo, and the contact email appears in the legal pages.</p>
          </section>

          <section class="panel bk-section">
            <h3>Logo &amp; colours</h3>
            ${brandingImageHtml('studio.logoUrl', 'Logo', 'Square images work best. Uploads are resized to 256 × 256. Also used as the browser tab icon.')}
            <div class="row2">
              ${brandingColorHtml('theme.accent', 'Accent colour', '(buttons, links)')}
              ${brandingColorHtml('theme.accentDark', 'Accent in dark mode', '(a lighter shade reads better)')}
            </div>
            <div class="row2">
              <div class="field">
                <label for="bkRadius">Corner roundness <span class="hint">${esc(String(d.theme.radius))} px</span></label>
                <input type="range" id="bkRadius" min="4" max="24" step="1" value="${esc(d.theme.radius)}" data-bk-range="theme.radius">
              </div>
              <div class="field">
                <label for="bkMode">Default theme <span class="hint">(people can still switch)</span></label>
                <select id="bkMode" data-bk-select="theme.defaultMode"><option value="light" ${d.theme.defaultMode !== 'dark' ? 'selected' : ''}>Light</option><option value="dark" ${d.theme.defaultMode === 'dark' ? 'selected' : ''}>Dark</option></select>
              </div>
            </div>
          </section>

          <section class="panel bk-section">
            <h3>Sign-in page</h3>
            <div class="row2">
              ${brandingFieldHtml('signIn.title', 'Title', { max: 40, placeholder: 'Sign in' })}
              ${brandingFieldHtml('signIn.buttonLabel', 'Roblox button label', { max: 40, placeholder: 'Sign in with Roblox' })}
            </div>
            ${brandingFieldHtml('signIn.subtitle', 'Text under the title', { max: 240, textarea: true, rows: 2, spell: true })}
            ${brandingFieldHtml('signIn.headline', 'Headline', { max: 80, hint: '(right-hand panel)', placeholder: 'Paid for what you build.', spell: true })}
            ${brandingFieldHtml('signIn.tagline', 'Tagline', { max: 240, textarea: true, rows: 2, hint: '{studio} is replaced with your studio name', spell: true })}
            ${brandingFieldHtml('signIn.footerNote', 'Note at the bottom', { max: 240, hint: '(optional)', spell: true, placeholder: 'Staff only. Not on the team yet? Ask a lead for an invite link.' })}
            ${brandingImageHtml('signIn.backgroundImage', 'Background image', 'Optional. Fills the right-hand panel; it is darkened so the text stays readable. Uploads are resized to 1600 px wide.')}
            <label class="pp-check"><input type="checkbox" data-bk-check="signIn.showPreview" ${d.signIn.showPreview !== false ? 'checked' : ''}> Show the product preview on the sign-in page</label>
          </section>

          <section class="panel bk-section">
            <h3>Features</h3>
            <p class="hint" style="margin:-4px 0 12px;">A feature that's off disappears from the menu, can't be opened by link, and the server refuses its actions.</p>
            <div class="bk-toggles">
              ${feats.map(f => `<label class="bk-toggle"><input type="checkbox" data-bk-feature="${esc(f[0])}" ${d.features[f[0]] !== false ? 'checked' : ''}><span class="bk-switch" aria-hidden="true"></span><span><b>${esc(f[1])}</b><small>${esc(f[2])}</small></span></label>`).join('')}
            </div>
          </section>

          <section class="panel bk-section">
            <h3>Payouts</h3>
            <div class="row2">
              <div class="field"><label>Currencies</label><div class="bk-chips">${(S.data.allCurrencies || []).map(c => `<label class="bk-chip"><input type="checkbox" data-bk-list="payments.currencies" value="${esc(c)}" ${(d.payments.currencies || []).includes(c) ? 'checked' : ''}> ${esc(BRANDING_CURRENCY_LABELS[c] || c)}</label>`).join('')}</div></div>
              <div class="field"><label>Payout methods</label><div class="bk-chips">${(S.data.allMethods || []).map(m => `<label class="bk-chip"><input type="checkbox" data-bk-list="payments.methods" value="${esc(m)}" ${(d.payments.methods || []).includes(m) ? 'checked' : ''}> ${esc(BRANDING_METHOD_LABELS[m] || m)}</label>`).join('')}</div></div>
            </div>
          </section>

          <section class="panel bk-section">
            <h3>Legal pages</h3>
            <p class="hint" style="margin:-4px 0 12px;">Leave a page empty to use the built-in text. Lines like “1. Payments” become headings and lines starting with “- ” become lists. Have your final text checked before going live.</p>
            <div class="legal-tabs bk-legal-tabs">${legalKeys.map(([k, l]) => `<a href="#" data-bk-legal="${k}" class="${lt === k ? 'on' : ''}">${esc(l)}${(d.legal || {})[k] ? ' <span class="bk-dot" title="Custom text"></span>' : ''}</a>`).join('')}</div>
            <textarea class="bk-legal" data-bk="legal.${lt}" rows="12" maxlength="20000" placeholder="Using the built-in ${esc(legalKeys.find(x => x[0] === lt)[1])}.">${esc(legalVal)}</textarea>
            <div class="bk-legal-actions">
              <button type="button" class="btn btn-ghost btn-sm" id="bkLegalDefault">${legalVal ? 'Replace with built-in text' : 'Start from the built-in text'}</button>
              ${legalVal ? `<button type="button" class="btn btn-ghost btn-sm" id="bkLegalClear">Use built-in text</button>` : ''}
              <a class="btn btn-ghost btn-sm" href="#/${lt === 'tos' ? 'terms' : lt}" target="_blank" rel="noopener">View live page</a>
            </div>
          </section>

          <div class="bk-reset"><button type="button" class="pp-linkbtn" id="bkResetAll">Reset all branding to the defaults in studio.config.json</button></div>
        </div>
        <aside class="bk-aside">${brandingPreviewHtml()}</aside>
      </div>
      <div class="bk-savebar${S.dirty ? ' show' : ''}" role="region" aria-label="Unsaved changes">
        <span>You have unsaved changes</span>
        <div>
          <button type="button" class="btn btn-ghost btn-sm" id="bkDiscard" ${S.saving ? 'disabled' : ''}>Discard</button>
          <button type="button" class="btn btn-primary btn-sm" id="bkSave" ${S.saving ? 'disabled' : ''}>${S.saving ? 'Saving...' : 'Save changes'}</button>
        </div>
      </div>`;
    }

    function mountBrandingEditor(root) {
      const S = brandingState;
      const repaint = () => {
        const el = document.getElementById('brandingMount');
        if (!el) return;
        const y = window.scrollY;
        el.innerHTML = brandingEditorHtml();
        wire(el);
        window.scrollTo(0, y);
      };
      const softUpdate = () => {
        const aside = document.querySelector('.bk-aside');
        if (aside) aside.innerHTML = brandingPreviewHtml();
        const bar = document.querySelector('.bk-savebar');
        if (bar) bar.classList.toggle('show', S.dirty);
      };

      async function load() {
        S.loading = true; S.error = null; repaint();
        try {
          const json = await callHrData('get_branding');
          S.data = json.data;
          S.draft = JSON.parse(JSON.stringify(json.data.current));
          S.dirty = false; S.loaded = true;
        } catch (e) {
          S.error = ((e && e.message) || friendlyError());
        }
        S.loading = false;
        repaint();
      }

      async function save(payload, okText) {
        const errs = brandingValidate(payload);
        if (errs.length) { S.notice = { ok: false, text: errs.join(' ') }; repaint(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
        S.saving = true; S.notice = null; repaint();
        try {
          const json = await callHrData('save_branding', { branding: payload });
          S.data.current = json.data.current;
          S.data.saved = json.data.saved;
          S.draft = JSON.parse(JSON.stringify(json.data.current));
          S.dirty = false;
          S.notice = { ok: true, text: okText || 'Branding saved. Everyone sees it on their next page load.' };
          try { await fetchBootstrap(); } catch (e) { }
          S.saving = false;
          route();
          return;
        } catch (e) {
          S.notice = { ok: false, text: ((e && e.message) || friendlyError()) };
        }
        S.saving = false;
        repaint();
      }

      function wire(el) {
        const retry = el.querySelector('#bkRetry');
        if (retry) retry.addEventListener('click', load);
        if (!S.draft) return;
        el.querySelectorAll('[data-bk]').forEach(inp => inp.addEventListener('input', () => {
          let v = inp.value;
          const path = inp.dataset.bk;
          if (/shortName|requestIdPrefix/.test(path)) v = v.toUpperCase();
          if (/^theme\.accent/.test(path)) {
            const sw = el.querySelector(`[data-bk-color="${path}"]`);
            if (sw && /^#[0-9a-fA-F]{6}$/.test(v)) sw.value = v;
          }
          if (/logoUrl|backgroundImage/.test(path) && !v && /^data:/.test(brandingGet(path) || '')) return;
          brandingSet(path, v.trim() === '' && !/^legal\./.test(path) ? '' : v);
          softUpdate();
        }));
        el.querySelectorAll('[data-bk-color]').forEach(inp => inp.addEventListener('input', () => {
          const path = inp.dataset.bkColor;
          brandingSet(path, inp.value.toUpperCase());
          const txt = el.querySelector(`[data-bk="${path}"]`);
          if (txt) txt.value = inp.value.toUpperCase();
          softUpdate();
        }));
        el.querySelectorAll('[data-bk-range]').forEach(inp => inp.addEventListener('input', () => {
          brandingSet(inp.dataset.bkRange, Number(inp.value));
          const hint = inp.parentElement.querySelector('.hint');
          if (hint) hint.textContent = inp.value + ' px';
          softUpdate();
        }));
        el.querySelectorAll('[data-bk-select]').forEach(inp => inp.addEventListener('change', () => { brandingSet(inp.dataset.bkSelect, inp.value); softUpdate(); }));
        el.querySelectorAll('[data-bk-check]').forEach(inp => inp.addEventListener('change', () => { brandingSet(inp.dataset.bkCheck, inp.checked); softUpdate(); }));
        el.querySelectorAll('[data-bk-feature]').forEach(inp => inp.addEventListener('change', () => { brandingSet('features.' + inp.dataset.bkFeature, inp.checked); softUpdate(); }));
        el.querySelectorAll('[data-bk-list]').forEach(inp => inp.addEventListener('change', () => {
          const path = inp.dataset.bkList;
          const list = Array.from(el.querySelectorAll(`[data-bk-list="${path}"]:checked`)).map(x => x.value);
          brandingSet(path, list);
          softUpdate();
        }));
        el.querySelectorAll('[data-bk-upload]').forEach(inp => inp.addEventListener('change', async () => {
          const file = inp.files && inp.files[0];
          if (!file) return;
          const path = inp.dataset.bkUpload;
          const isLogo = path === 'studio.logoUrl';
          try {
            const url = await brandingResizeImage(file, isLogo ? 256 : 1600, isLogo ? 256 : 1200, isLogo ? 'image/png' : 'image/jpeg');
            brandingSet(path, url);
            S.notice = null;
          } catch (e) {
            S.notice = { ok: false, text: e.message };
          }
          repaint();
        }));
        el.querySelectorAll('[data-bk-clear]').forEach(btn => btn.addEventListener('click', () => { brandingSet(btn.dataset.bkClear, ''); repaint(); }));
        el.querySelectorAll('[data-bk-legal]').forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); S.legalTab = a.dataset.bkLegal; repaint(); }));
        const legalDefault = el.querySelector('#bkLegalDefault');
        if (legalDefault) legalDefault.addEventListener('click', async () => {
          const cur = (S.draft.legal || {})[S.legalTab];
          if (cur && !(await askConfirm('Replace your text with the built-in version?'))) return;
          brandingSet('legal.' + S.legalTab, (S.data.legalDefaults || {})[S.legalTab] || '');
          repaint();
        });
        const legalClear = el.querySelector('#bkLegalClear');
        if (legalClear) legalClear.addEventListener('click', async () => {
          if (!(await askConfirm('Remove your text and use the built-in version?'))) return;
          brandingSet('legal.' + S.legalTab, '');
          repaint();
        });
        const discard = el.querySelector('#bkDiscard');
        if (discard) discard.addEventListener('click', () => { S.draft = JSON.parse(JSON.stringify(S.data.current)); S.dirty = false; S.notice = null; repaint(); });
        const saveBtn = el.querySelector('#bkSave');
        if (saveBtn) saveBtn.addEventListener('click', () => save(S.draft));
        const resetAll = el.querySelector('#bkResetAll');
        if (resetAll) resetAll.addEventListener('click', async () => {
          if (!(await askConfirm('Reset every branding setting to the defaults in studio.config.json? Your logo, colours, sign-in text and legal text saved here will be removed.'))) return;
          S.saving = true; repaint();
          try {
            await callHrData('save_branding', { branding: {} });
            S.saving = false;
            S.notice = { ok: true, text: 'Branding reset to the defaults.' };
            try { await fetchBootstrap(); } catch (e) { }
            S.data = null; S.draft = null; S.loaded = false;
            route();
          } catch (e) {
            S.saving = false;
            S.notice = { ok: false, text: ((e && e.message) || friendlyError()) };
            repaint();
          }
        });
      }

      if (!S.loaded && !S.loading) { load(); return; }
      root.innerHTML = brandingEditorHtml();
      wire(root);
    }

    // ---------------------------------------------------------------------------------
    // My payments > Email notifications, and Settings > Notifications (studio webhook).
    // Both are small self-contained widgets that keep their state here, so the page around
    // them can re-paint without losing what someone typed.
    // ---------------------------------------------------------------------------------
    const notifPrefsState = { loaded: false, loading: false, data: null, stage: 'idle', email: '', code: '', busy: false, msg: null };

    function notifPrefsHtml() {
      const S = notifPrefsState;
      const d = S.data;
      const head = `<div class="preview-label">Email notifications</div>`;
      if (!d) return `${head}<div class="dash-loading">Loading...</div>`;
      const msg = S.msg ? `<div class="${S.msg.ok ? 'confirm-box' : 'error-box'}" role="status">${S.msg.ok ? `<div class="icon">&#10003;</div><div class="txt"><strong>${esc(S.msg.text)}</strong></div>` : `<span>${esc(S.msg.text)}</span>`}</div>` : '';
      if (!d.emailAvailable) return `${head}<p class="sub" style="margin:0;">You'll see notifications under the bell at the top of the menu. Email isn't set up for this panel yet.</p>`;
      const current = d.verified ? d.email : d.googleEmail;
      if (S.stage === 'code') {
        return `${head}${msg}
          <p class="sub" style="margin:0 0 12px;">We sent a 6-digit code to <strong>${esc(S.email)}</strong>. It expires in 20 minutes.</p>
          <div class="inline-form"><input type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" id="npCode" placeholder="123456" value="${esc(S.code)}" aria-label="Code"><button type="button" class="btn btn-primary btn-sm" id="npVerify" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Checking...' : 'Confirm'}</button></div>
          <button type="button" class="pp-linkbtn" id="npCancel" style="margin-top:10px;">Use a different address</button>`;
      }
      if (S.stage === 'edit' || !current) {
        return `${head}${msg}
          <p class="sub" style="margin:0 0 12px;">Get an email when you're paid, when a request is approved or turned down, and when something needs you.</p>
          <div class="inline-form"><input type="email" id="npEmail" placeholder="you@example.com" value="${esc(S.email)}" aria-label="Email address" autocomplete="email"><button type="button" class="btn btn-primary btn-sm" id="npSend" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Sending...' : 'Send code'}</button></div>
          ${current ? `<button type="button" class="pp-linkbtn" id="npCancel" style="margin-top:10px;">Cancel</button>` : ''}`;
      }
      return `${head}${msg}
        <div class="np-row">
          <div><strong>${esc(current)}</strong><span class="hint" style="margin:0;display:block;">${d.verified ? 'Confirmed' : 'From your Google account'}</span></div>
          <label class="bk-toggle np-toggle"><input type="checkbox" id="npEnabled" ${d.enabled ? 'checked' : ''}><span class="bk-switch" aria-hidden="true"></span><span><b>${d.enabled ? 'On' : 'Off'}</b></span></label>
        </div>
        <div style="display:flex;gap:12px;margin-top:10px;">
          <button type="button" class="pp-linkbtn" id="npChange">Change address</button>
          ${d.verified ? `<button type="button" class="pp-linkbtn" id="npRemove">Remove</button>` : ''}
        </div>`;
    }

    function mountNotifPrefs(el) {
      const S = notifPrefsState;
      const repaint = () => { const host = document.getElementById('notifPrefsPanel'); if (host) { host.innerHTML = notifPrefsHtml(); wire(host); } };
      async function load() {
        S.loading = true;
        try { const json = await callHrData('get_notify_prefs'); S.data = json.data; S.loaded = true; } catch (e) { S.data = { emailAvailable: false }; }
        S.loading = false; repaint();
      }
      function wire(host) {
        const q = (id) => host.querySelector('#' + id);
        if (q('npEmail')) q('npEmail').addEventListener('input', e => { S.email = e.target.value; });
        if (q('npCode')) q('npCode').addEventListener('input', e => { S.code = e.target.value.replace(/\D/g, ''); });
        if (q('npSend')) q('npSend').addEventListener('click', async () => {
          S.busy = true; S.msg = null; repaint();
          try { await callHrData('set_notify_email', { email: S.email }); S.stage = 'code'; S.code = ''; }
          catch (e) { S.msg = { ok: false, text: e.code === 'invalid_email' ? "That email address doesn't look right." : e.code === 'email_send_failed' ? "Couldn't send the email. Check the address and try again." : e.message }; }
          S.busy = false; repaint();
          const c = document.getElementById('npCode'); if (c) c.focus();
        });
        if (q('npVerify')) q('npVerify').addEventListener('click', async () => {
          S.busy = true; S.msg = null; repaint();
          try { await callHrData('verify_notify_email', { code: S.code }); S.stage = 'idle'; S.msg = { ok: true, text: 'Email confirmed. You\'ll get notifications there from now on.' }; await load(); }
          catch (e) { S.msg = { ok: false, text: e.code === 'code_wrong' ? "That code isn't right." : e.code === 'code_expired' ? 'That code expired. Send a new one.' : e.message }; }
          S.busy = false; repaint();
        });
        if (q('npCancel')) q('npCancel').addEventListener('click', () => { S.stage = 'idle'; S.msg = null; repaint(); });
        if (q('npChange')) q('npChange').addEventListener('click', () => { S.stage = 'edit'; S.email = ''; S.msg = null; repaint(); });
        if (q('npRemove')) q('npRemove').addEventListener('click', async () => {
          if (!(await askConfirm('Stop emailing this address?'))) return;
          try { await callHrData('set_notify_prefs', { removeEmail: true }); S.msg = null; await load(); } catch (e) { toast(e.message, 'err'); }
        });
        if (q('npEnabled')) q('npEnabled').addEventListener('change', async (e) => {
          try { await callHrData('set_notify_prefs', { enabled: e.target.checked }); S.data.enabled = e.target.checked; repaint(); }
          catch (err) { toast(err.message, 'err'); }
        });
      }
      el.innerHTML = notifPrefsHtml();
      wire(el);
      if (!S.loaded && !S.loading) load();
    }

    const webhookState = { loaded: false, data: null, url: '', events: [], busy: false, msg: null };
    const WEBHOOK_EVENT_LABELS = {
      request_submitted: 'Someone sends a payment request',
      request_approved: 'A payment request is approved',
      request_paid: 'Someone is paid',
      run_closed: 'A payment run is closed',
      security_changed: 'The security level changes',
      budget_warning: 'A game nears its budget',
      contract_signed: 'A contract is signed',
      revenue_recorded: 'Monthly revenue is recorded'
    };

    function webhookHtml() {
      const S = webhookState;
      if (!S.data) return `<div class="dash-loading">Loading...</div>`;
      const d = S.data;
      return `
      <div class="heading-block">
        <h2 class="sec-title">Notifications</h2>
        <p class="sub">People get their own notifications under the bell${d.emailConfigured ? ' and by email' : ''}. Here you can also send studio-wide events to a channel.</p>
      </div>
      ${S.msg ? `<div class="${S.msg.ok ? 'confirm-box' : 'error-box'}" role="status">${S.msg.ok ? `<div class="icon">&#10003;</div><div class="txt"><strong>${esc(S.msg.text)}</strong></div>` : `<span>${esc(S.msg.text)}</span>`}</div>` : ''}
      <div class="panel" style="max-width:720px;margin-bottom:18px;">
        <h3 style="font-size:15px;margin:0 0 6px;">Email</h3>
        ${d.emailConfigured
          ? `<p class="sub" style="margin:0;">Sending through ${esc(d.emailProvider === 'resend' ? 'Resend' : d.emailProvider === 'postmark' ? 'Postmark' : 'SMTP')}. Each person confirms their own address in My payments; Google sign-ins use their Google email.</p>`
          : `<p class="sub" style="margin:0;">Not set up. Add <code>RESEND_API_KEY</code> (or <code>POSTMARK_SERVER_TOKEN</code>, or <code>SMTP_HOST</code>) and <code>EMAIL_FROM</code> to the API's environment to turn on email.</p>`}
      </div>
      <div class="panel" style="max-width:720px;">
        <h3 style="font-size:15px;margin:0 0 6px;">Channel webhook</h3>
        <p class="sub" style="margin:0 0 14px;">Paste a Discord or Slack webhook URL (or any https endpoint) to post these events to a channel. No bot needed.</p>
        <div class="field"><label for="whUrl">Webhook URL</label><input type="url" id="whUrl" placeholder="https://discord.com/api/webhooks/..." value="${esc(S.url)}" autocomplete="off" spellcheck="false"></div>
        <div class="field"><label>Send these events</label>
          <div class="bk-toggles">${(d.allEvents || []).filter(e => featureOn(e === 'budget_warning' ? 'budgets' : e === 'contract_signed' ? 'contracts' : e === 'revenue_recorded' ? 'revenueShare' : e === 'run_closed' ? 'paymentRuns' : '')).map(e => `<label class="bk-toggle"><input type="checkbox" data-wh-event="${esc(e)}" ${S.events.includes(e) ? 'checked' : ''}><span class="bk-switch" aria-hidden="true"></span><span><b>${esc(WEBHOOK_EVENT_LABELS[e] || e)}</b></span></label>`).join('')}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" class="btn btn-primary btn-sm" id="whSave" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Saving...' : 'Save'}</button>
          <button type="button" class="btn btn-ghost btn-sm" id="whTest" ${S.busy || !S.url ? 'disabled' : ''}>Send a test</button>
        </div>
      </div>`;
    }

    function mountWebhookSettings(el) {
      const S = webhookState;
      const repaint = () => { const host = document.getElementById('webhookMount'); if (host) { host.innerHTML = webhookHtml(); wire(host); } };
      async function load() {
        try { const json = await callHrData('get_notify_webhook'); S.data = json.data; S.url = json.data.url || ''; S.events = json.data.events || []; S.loaded = true; }
        catch (e) { S.data = { allEvents: [], emailConfigured: false }; S.msg = { ok: false, text: e.message }; }
        repaint();
      }
      function wire(host) {
        const url = host.querySelector('#whUrl');
        if (url) url.addEventListener('input', () => { S.url = url.value.trim(); const t = host.querySelector('#whTest'); if (t) t.disabled = !S.url; });
        host.querySelectorAll('[data-wh-event]').forEach(cb => cb.addEventListener('change', () => {
          S.events = Array.from(host.querySelectorAll('[data-wh-event]:checked')).map(x => x.dataset.whEvent);
        }));
        const save = host.querySelector('#whSave');
        if (save) save.addEventListener('click', async () => {
          S.busy = true; S.msg = null; repaint();
          try { await callHrData('save_notify_webhook', { url: S.url, events: S.events }); S.msg = { ok: true, text: S.url ? 'Saved. Events will post to that channel.' : 'Saved. The webhook is off.' }; }
          catch (e) { S.msg = { ok: false, text: e.code === 'invalid_webhook' ? 'That has to be an https:// URL.' : e.code === 'database_update_needed' ? 'Run sql/upgrade.sql in Supabase first.' : e.message }; }
          S.busy = false; repaint();
        });
        const test = host.querySelector('#whTest');
        if (test) test.addEventListener('click', async () => {
          S.busy = true; repaint();
          try { const r = await callHrData('test_notify_webhook', { url: S.url }); S.msg = r.delivered ? { ok: true, text: 'Test message sent. Check the channel.' } : { ok: false, text: "The webhook didn't accept the message. Check the URL." }; }
          catch (e) { S.msg = { ok: false, text: e.message }; }
          S.busy = false; repaint();
        });
      }
      el.innerHTML = webhookHtml();
      wire(el);
      if (!S.loaded) load();
    }

    // Settings > Plan: what this deployment's licence includes.
    const planState = { data: null, error: null };
    const PLAN_REASONS = {
        missing: 'No licence key is set. Add LICENSE_KEY to the API environment.',
        bad_signature: "The licence key isn't valid.",
        malformed: "The licence key isn't valid.",
        expired: 'The licence has expired.',
        wrong_domain: "The licence is for a different website address than this one."
    };

    function planHtml() {
      const S = planState;
      if (S.error) return `<div class="error-box"><span>${esc(S.error)}</span></div>`;
      if (!S.data) return `<div class="dash-loading">Loading...</div>`;
      const d = S.data;
      const tierName = d.tier === 'pro' ? 'Pro' : 'Core';
      const groups = ['Pro', 'Add-on'];
      return `
      <div class="heading-block">
        <h2 class="sec-title">Plan</h2>
        <p class="sub">What this panel's licence includes.</p>
      </div>
      <div class="panel plan-card" style="max-width:720px;margin-bottom:18px;">
        <div class="plan-top">
          <div>
            <span class="plan-tier">${esc(tierName)}</span>
            <div class="plan-meta">${d.managed ? (d.valid ? `Licensed to <strong>${esc(d.licensee || 'this studio')}</strong>${d.expires ? ` &middot; renews ${esc(fmtDate(d.expires))}` : ' &middot; no expiry'}` : `<span style="color:var(--err-text);">${esc(PLAN_REASONS[d.reason] || 'The licence key could not be checked.')}</span> Running as Core.`) : 'Licensing is not set up on this panel, so everything is unlocked.'}</div>
          </div>
          ${d.addons && d.addons.length ? `<div class="plan-addons">${d.addons.map(a => `<span class="chip-tag">${esc(a === 'discord' ? 'Discord add-on' : a)}</span>`).join('')}</div>` : ''}
        </div>
      </div>
      ${groups.map(g => `
      <div class="panel" style="max-width:720px;margin-bottom:18px;">
        <h3 style="font-size:15px;margin:0 0 12px;">${g === 'Pro' ? 'Pro features' : 'Add-ons'}</h3>
        <ul class="plan-list">
          ${d.features.filter(f => f.group === g).map(f => `<li class="${f.included ? 'yes' : 'no'}"><span class="plan-mark" aria-hidden="true">${f.included ? '&#10003;' : '&ndash;'}</span><span>${esc(f.label)}</span><small>${f.included ? (f.on ? 'Included' : 'Included, switched off in Branding') : 'Not included'}</small></li>`).join('')}
        </ul>
      </div>`).join('')}
      <p class="hint" style="max-width:720px;">To change your plan, contact whoever supplied this panel for a new licence key, then set it as <code>LICENSE_KEY</code> on the API and restart it.</p>`;
    }

    function mountPlan(el) {
      el.innerHTML = planHtml();
      if (planState.data) return;
      callHrData('get_plan').then(j => { planState.data = j.data; }).catch(e => { planState.error = e.message; }).finally(() => {
        const host = document.getElementById('planMount'); if (host) host.innerHTML = planHtml();
      });
    }

    // ---------------------------------------------------------------------------------
    // Shared bits for the newer money pages (revenue share, contracts, exports, tax).
    // ---------------------------------------------------------------------------------
    let knownPeopleCache = null;
    function loadKnownPeople() {
      if (knownPeopleCache) return Promise.resolve(knownPeopleCache);
      return callHrData('list_known_people').then(j => { knownPeopleCache = j.data || []; return knownPeopleCache; }).catch(() => []);
    }
    // A text box with suggestions from everyone the panel knows; resolves to { id, name }.
    function personPickerHtml(id, placeholder) {
      return `<input type="text" id="${id}" list="${id}List" placeholder="${esc(placeholder || 'Start typing a name')}" autocomplete="off" spellcheck="false"><datalist id="${id}List">${(knownPeopleCache || []).map(p => `<option value="${esc(p.name)}"></option>`).join('')}</datalist>`;
    }
    function pickedPerson(id) {
      const el = document.getElementById(id);
      const name = el ? el.value.trim() : '';
      if (!name) return null;
      const hit = (knownPeopleCache || []).find(p => p.name.toLowerCase() === name.toLowerCase());
      return hit ? { id: hit.id, name: hit.name } : { id: null, name };
    }
    const CASH_SYMBOL = { USD: '$', EUR: '€', GBP: '£', CAD: 'CA$', AUD: 'A$' };
    function cashCode() { return (STUDIO.payments && STUDIO.payments.cashCurrency) || 'USD'; }
    function cashSymbol() { return CASH_SYMBOL[cashCode()] || '$'; }
    function money(amount, currency) {
      const n = Number(amount) || 0;
      if (currency === 'ROBUX') return 'R$ ' + Math.round(n).toLocaleString();
      return cashSymbol() + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    function currencyOptionsHtml(selected) {
      return `${currencyEnabled('ROBUX') ? `<option value="ROBUX" ${selected === 'ROBUX' ? 'selected' : ''}>Robux</option>` : ''}${currencyEnabled('USD') ? `<option value="USD" ${selected === 'USD' ? 'selected' : ''}>${esc(cashCode())}</option>` : ''}`;
    }
    function pageHeadHtml(title, sub, actions) {
      return `<div class="dash-head"><div><h1>${esc(title)}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div>${actions ? `<div class="dash-toolbar">${actions}</div>` : ''}</div>`;
    }
    function monthLabel(period) {
      const m = /^(\d{4})-(\d{2})$/.exec(String(period || ''));
      if (!m) return period || '';
      return new Date(Date.UTC(+m[1], +m[2] - 1, 1)).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
    }

    // ---------------------------------------------------------------------------------
    // Revenue share (#/revenue)
    // ---------------------------------------------------------------------------------
    function renderRevenue() {
      if (!hasPermission('revenue.manage')) { window.location.hash = '#/home'; return; }
      const myGen = renderGen;
      let data = null;
      let error = null;
      let busy = false;
      let formError = null;
      let recordOpen = false;
      let preview = { gameId: '', revenue: '', currency: currencyEnabled('ROBUX') ? 'ROBUX' : 'USD' };

      const gameName = (id) => { const g = (data.games || []).find(x => String(x.id) === String(id)); return g ? g.name : 'Game'; };
      const sharesFor = (gameId) => (data.shares || []).filter(s => String(s.game_id) === String(gameId));

      function previewHtml() {
        const shares = sharesFor(preview.gameId);
        const amount = Number(preview.revenue);
        if (!preview.gameId || !shares.length) return `<p class="hint" style="margin:0;">${preview.gameId ? 'This game has no shares yet.' : 'Pick a game to see the split.'}</p>`;
        const total = shares.reduce((t, s) => t + Number(s.percent), 0);
        return `<table class="mini-table"><tbody>${shares.map(s => `<tr><td>${esc(s.roblox_username)}</td><td class="num">${esc(Number(s.percent))}%</td><td class="num">${amount > 0 ? esc(money(amount * Number(s.percent) / 100, preview.currency)) : '-'}</td></tr>`).join('')}
          <tr class="muted"><td>Studio keeps</td><td class="num">${esc(Math.max(0, 100 - total).toFixed(2).replace(/\.00$/, ''))}%</td><td class="num">${amount > 0 ? esc(money(amount * Math.max(0, 100 - total) / 100, preview.currency)) : '-'}</td></tr></tbody></table>`;
      }

      function paint() {
        if (myGen !== renderGen) return;
        const now = new Date();
        const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const defaultPeriod = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;
        app.innerHTML = `
    ${topbar()}
    <div class="shell">
      ${pageHeadHtml('Revenue share', 'People paid a percentage of what a game earns. Record a month\'s revenue and everyone\'s share becomes a payment waiting for approval.', data ? `<button type="button" class="btn ${recordOpen ? 'btn-ghost' : 'btn-primary'} btn-sm" id="rsRecordToggle">${recordOpen ? 'Cancel' : 'Record revenue'}</button>` : '')}
      ${error ? `<div class="error-box"><span>${esc(error)}</span></div>` : ''}
      ${!data && !error ? `<div class="dash-loading">Loading...</div>` : ''}
      ${data && recordOpen ? `
      <div class="panel rs-record">
        <h3 class="panel-title">Record revenue</h3>
        ${formError ? `<div class="error-box"><span>${esc(formError)}</span></div>` : ''}
        <div class="row3">
          <div class="field"><label for="rsGame">Game</label><select id="rsGame"><option value="">Pick a game</option>${data.games.filter(g => sharesFor(g.id).length).map(g => `<option value="${esc(g.id)}" ${String(preview.gameId) === String(g.id) ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></div>
          <div class="field"><label for="rsPeriod">Month</label><input type="month" id="rsPeriod" value="${esc(defaultPeriod)}" max="${esc(now.toISOString().slice(0, 7))}"></div>
          <div class="field"><label for="rsAmount">Revenue</label><div class="amount-input"><input type="number" id="rsAmount" min="0" step="any" placeholder="e.g. 250000" value="${esc(preview.revenue)}"><select id="rsCurrency" aria-label="Currency">${currencyOptionsHtml(preview.currency)}</select></div></div>
        </div>
        <div class="field"><label for="rsNote">Note <span class="hint">(optional)</span></label><input type="text" id="rsNote" maxlength="300" placeholder="e.g. From the Creator Hub payout report"></div>
        <div class="rs-preview" id="rsPreview">${previewHtml()}</div>
        <button type="button" class="btn btn-primary btn-sm" id="rsRecord" ${busy ? 'disabled' : ''}>${busy ? 'Recording...' : 'Record and create payments'}</button>
      </div>` : ''}
      ${data ? `
      <div class="rs-grid">
        ${data.games.length ? data.games.map(g => {
          const shares = sharesFor(g.id);
          const total = shares.reduce((t, s) => t + Number(s.percent), 0);
          return `
          <section class="panel rs-game">
            <div class="rs-game-head">
              <div class="rs-game-name">${g.icon_url ? `<img src="${esc(g.icon_url)}" alt="">` : `<span class="rs-game-dot" style="background:${gameColor(g.name)}"></span>`}<strong>${esc(g.name)}</strong></div>
              <span class="hint" style="margin:0;">${esc(total.toFixed(2).replace(/\.00$/, ''))}% shared</span>
            </div>
            <div class="rs-bar" aria-hidden="true"><span style="width:${Math.min(100, total)}%"></span></div>
            ${shares.length ? `<ul class="rs-shares">${shares.map(s => `<li><span>${esc(s.roblox_username)}</span><b>${esc(Number(s.percent))}%</b><button type="button" class="pp-linkbtn" data-rs-remove="${esc(s.id)}" aria-label="Remove ${esc(s.roblox_username)}'s share">Remove</button></li>`).join('')}</ul>` : `<p class="hint" style="margin:8px 0 0;">No shares yet.</p>`}
            <div class="rs-add">
              ${personPickerHtml('rsPerson_' + g.id, 'Person')}
              <input type="number" id="rsPct_${esc(g.id)}" min="0.01" max="100" step="0.01" placeholder="%" aria-label="Percent">
              <button type="button" class="btn btn-ghost btn-sm" data-rs-add="${esc(g.id)}">Add</button>
            </div>
          </section>`;
        }).join('') : `<div class="dash-empty"><h3>No games yet</h3><p>Add your games in Settings &rsaquo; Games &amp; DevEx first.</p></div>`}
      </div>

      <div class="heading-block section-head"><h2 class="sec-title">Recorded months</h2></div>
      <div class="table-wrap">
        ${data.periods.length ? `<div class="table-scroll"><table class="req-table"><thead><tr><th>Month</th><th>Game</th><th>Revenue</th><th>Payments</th><th>Recorded by</th><th></th></tr></thead><tbody>
          ${data.periods.map(p => `<tr><td>${esc(monthLabel(p.period))}</td><td>${esc(gameName(p.game_id))}</td><td>${esc(money(p.revenue, p.currency))}</td><td>${esc((p.request_ids || []).length)}</td><td>${esc(p.recorded_by || '-')}<div class="hint" style="margin:0;">${esc(fmtDate(p.created_at))}</div></td><td style="text-align:right;"><button type="button" class="btn btn-danger-ghost btn-xs" data-rs-delete="${esc(p.id)}">Undo</button></td></tr>`).join('')}
        </tbody></table></div>` : `<div class="dash-empty"><h3>Nothing recorded yet</h3><p>When a game's monthly payout comes in, press Record revenue.</p></div>`}
      </div>` : ''}
    </div>`;
        wireTopbarSignOut();
        wire();
      }

      function wire() {
        const toggle = document.getElementById('rsRecordToggle');
        if (toggle) toggle.addEventListener('click', () => { recordOpen = !recordOpen; formError = null; paint(); });
        const game = document.getElementById('rsGame');
        const amount = document.getElementById('rsAmount');
        const cur = document.getElementById('rsCurrency');
        const repaintPreview = () => { const el = document.getElementById('rsPreview'); if (el) el.innerHTML = previewHtml(); };
        if (game) game.addEventListener('change', () => { preview.gameId = game.value; repaintPreview(); });
        if (amount) amount.addEventListener('input', () => { preview.revenue = amount.value; repaintPreview(); });
        if (cur) cur.addEventListener('change', () => { preview.currency = cur.value; repaintPreview(); });
        const rec = document.getElementById('rsRecord');
        if (rec) rec.addEventListener('click', async () => {
          const period = document.getElementById('rsPeriod').value;
          const note = document.getElementById('rsNote').value.trim();
          if (!preview.gameId) { formError = 'Pick a game.'; paint(); return; }
          if (!(Number(preview.revenue) > 0)) { formError = 'Enter the revenue for that month.'; paint(); return; }
          if (!/^\d{4}-\d{2}$/.test(period)) { formError = 'Pick the month.'; paint(); return; }
          if (!(await askConfirm(`Record ${money(preview.revenue, preview.currency)} for ${gameName(preview.gameId)}, ${monthLabel(period)}?\n\nEveryone with a share gets a payment waiting for approval.`, { okLabel: 'Record' }))) return;
          busy = true; formError = null; paint();
          try {
            const r = await callHrData('rs_record_period', { gameId: preview.gameId, period, revenue: Number(preview.revenue), currency: preview.currency, note });
            toast(`Created ${r.created} payment${r.created === 1 ? '' : 's'} for approval.`);
            recordOpen = false; preview.revenue = '';
            await load();
          } catch (e) {
            formError = e.code === 'period_exists' ? 'That month is already recorded for this game. Undo it below first if it was wrong.' : e.code === 'no_shares' ? 'This game has no shares.' : e.message;
          }
          busy = false; paint();
        });
        document.querySelectorAll('[data-rs-add]').forEach(btn => btn.addEventListener('click', async () => {
          const gameId = btn.dataset.rsAdd;
          const person = pickedPerson('rsPerson_' + gameId);
          const pct = Number(document.getElementById('rsPct_' + gameId).value);
          if (!person) { toast('Pick a person.', 'err'); return; }
          if (!person.id) { toast(`${person.name} isn't someone the panel knows yet. They need to sign in once first.`, 'err'); return; }
          if (!(pct > 0 && pct <= 100)) { toast('Enter a percentage between 0 and 100.', 'err'); return; }
          btn.disabled = true;
          try { await callHrData('rs_save_share', { gameId, robloxUserId: person.id, robloxUsername: person.name, percent: pct }); toast(`${person.name} now gets ${pct}%.`); await load(); }
          catch (e) { btn.disabled = false; toast(e.code === 'share_over_100' ? `That would take the total over 100% (${Number(e.allocated || 0)}% is already shared).` : e.message, 'err'); }
        }));
        document.querySelectorAll('[data-rs-remove]').forEach(btn => btn.addEventListener('click', async () => {
          if (!(await askConfirm('Remove this share?\n\nMonths already recorded keep their payments. Future months won\'t include them.'))) return;
          try { await callHrData('rs_remove_share', { id: btn.dataset.rsRemove }); await load(); } catch (e) { toast(e.message, 'err'); }
        }));
        document.querySelectorAll('[data-rs-delete]').forEach(btn => btn.addEventListener('click', async () => {
          if (!(await askConfirm('Undo this month?\n\nIts payments are removed. This only works if none of them has been paid yet.', { okLabel: 'Undo month', danger: true }))) return;
          try { await callHrData('rs_delete_period', { id: btn.dataset.rsDelete }); toast('Month removed.'); await load(); }
          catch (e) { toast(e.code === 'already_paid' ? "Some of those payments are already paid, so it can't be undone. Reject the unpaid ones instead." : e.message, 'err'); }
        }));
      }

      async function load() {
        try {
          const [json] = await Promise.all([callHrData('rs_overview'), loadKnownPeople()]);
          data = json.data; error = null;
        } catch (e) { error = e.code === 'database_update_needed' ? 'Your database needs an update. Run sql/upgrade.sql in Supabase.' : e.message; }
        paint();
      }

      paint();
      load();
    }

    // ---------------------------------------------------------------------------------
    // Contracts (#/contracts, #/contract/<id>)
    // ---------------------------------------------------------------------------------
    const CONTRACT_STATUS = {
      draft: ['Draft', 'neutral'], sent: ['Waiting for signature', 'warn'], active: ['Active', 'info'],
      completed: ['Completed', 'ok'], cancelled: ['Cancelled', 'muted']
    };
    function contractChip(status) {
      const [label, tone] = CONTRACT_STATUS[status] || [status, 'neutral'];
      return `<span class="tone-chip ${tone}">${esc(label)}</span>`;
    }
    function contractTermsTemplate(d) {
      const who = d.robloxUsername || 'the contractor';
      return `1. The work
${who} ("you") will deliver the milestones listed in this contract for ${studioName()} ("we").

2. Payment
Each milestone is paid at the amount shown once we approve it. Approved milestones are paid through the panel using your saved payout method.

3. Changes and approval
If a milestone needs changes we'll send it back with a note. You can resubmit it once it's fixed.

4. Ownership
Once a milestone is paid, everything you made for it belongs to ${studioName()}, and you won't reuse or resell it without our written permission.

5. Confidentiality
Keep anything you learn about our unreleased games, code and plans to yourself.

6. Ending the contract
Either side can end the contract in writing. Milestones already approved are still paid.`;
    }

    function renderContracts() {
      const myGen = renderGen;
      let list = null;
      let manage = false;
      let error = null;
      let tab = 'open';
      let editor = null;
      let games = [];

      function blankEditor() {
        return { id: null, title: '', person: '', gameId: '', currency: currencyEnabled('ROBUX') ? 'ROBUX' : 'USD', dueAt: '', terms: '', milestones: [{ title: '', amount: '', dueAt: '' }], busy: false, error: null };
      }

      function editorHtml() {
        const e = editor;
        const total = e.milestones.reduce((t, m) => t + (Number(m.amount) || 0), 0);
        return `
        <div class="panel ct-editor">
          <h3 class="panel-title">${e.id ? 'Edit draft' : 'New contract'}</h3>
          ${e.error ? `<div class="error-box"><span>${esc(e.error)}</span></div>` : ''}
          <div class="row2">
            <div class="field"><label for="ctTitle">Title</label><input type="text" id="ctTitle" maxlength="160" placeholder="e.g. Winter map commission" value="${esc(e.title)}"></div>
            <div class="field"><label for="ctPerson">Contractor</label>${personPickerHtml('ctPerson', 'Who is doing the work')}</div>
          </div>
          <div class="row3">
            <div class="field"><label for="ctGame">Game <span class="hint">(optional)</span></label><select id="ctGame"><option value="">None</option>${games.map(g => `<option value="${esc(g.id)}" ${String(e.gameId) === String(g.id) ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></div>
            <div class="field"><label for="ctCurrency">Paid in</label><select id="ctCurrency">${currencyOptionsHtml(e.currency)}</select></div>
            <div class="field"><label for="ctDue">Final deadline <span class="hint">(optional)</span></label><input type="date" id="ctDue" value="${esc(e.dueAt)}"></div>
          </div>
          <div class="field"><label>Milestones</label>
            <div class="ct-ms-edit">
              ${e.milestones.map((m, i) => `
                <div class="ct-ms-row">
                  <span class="ct-ms-num">${i + 1}</span>
                  <input type="text" data-ms-title="${i}" maxlength="160" placeholder="What gets delivered" value="${esc(m.title)}" aria-label="Milestone ${i + 1}">
                  <input type="number" data-ms-amount="${i}" min="0" step="any" placeholder="Amount" value="${esc(m.amount)}" aria-label="Amount">
                  <input type="date" data-ms-due="${i}" value="${esc(m.dueAt)}" aria-label="Due date">
                  <button type="button" class="icon-btn" data-ms-remove="${i}" aria-label="Remove milestone" ${e.milestones.length === 1 ? 'disabled' : ''}>&times;</button>
                </div>`).join('')}
            </div>
            <div class="ct-ms-foot"><button type="button" class="pp-linkbtn" id="ctAddMs">Add a milestone</button><span>Total <b id="ctTotal">${esc(money(total, e.currency))}</b></span></div>
          </div>
          <div class="field"><label for="ctTerms">Terms <span class="hint">(the contractor signs these)</span></label><textarea id="ctTerms" rows="8" maxlength="20000" placeholder="What both sides agree to.">${esc(e.terms)}</textarea>
            <button type="button" class="pp-linkbtn" id="ctTemplate" style="margin-top:6px;">${e.terms ? 'Replace with the starter template' : 'Use the starter template'}</button></div>
          <p class="hint">The starter template is a plain-English starting point, not legal advice.</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button type="button" class="btn btn-primary btn-sm" data-ct-save="send" ${e.busy ? 'disabled' : ''}>${e.busy ? 'Saving...' : 'Save and send'}</button>
            <button type="button" class="btn btn-ghost btn-sm" data-ct-save="draft" ${e.busy ? 'disabled' : ''}>Save as draft</button>
            <button type="button" class="btn btn-ghost btn-sm" id="ctCancelEdit">Cancel</button>
          </div>
        </div>`;
      }

      function filtered() {
        if (!list) return [];
        if (tab === 'open') return list.filter(c => ['sent', 'active'].includes(c.status));
        if (tab === 'drafts') return list.filter(c => c.status === 'draft');
        return list.filter(c => ['completed', 'cancelled'].includes(c.status));
      }

      function paint() {
        if (myGen !== renderGen) return;
        const rows = filtered();
        const counts = list ? { open: list.filter(c => ['sent', 'active'].includes(c.status)).length, drafts: list.filter(c => c.status === 'draft').length, done: list.filter(c => ['completed', 'cancelled'].includes(c.status)).length } : {};
        app.innerHTML = `
    ${topbar()}
    <div class="shell">
      ${pageHeadHtml('Contracts', manage ? 'Commissioned work with agreed terms and paid milestones. The contractor signs, marks milestones done, and each approval becomes a payment.' : 'Work you\'ve agreed to do. Sign new contracts and mark milestones done here.', manage && !editor ? `<button type="button" class="btn btn-primary btn-sm" id="ctNew">New contract</button>` : '')}
      ${error ? `<div class="error-box"><span>${esc(error)}</span></div>` : ''}
      ${editor ? editorHtml() : ''}
      ${list ? `
      <div class="tabs ct-tabs" role="tablist">
        ${[['open', 'Open'], ...(manage ? [['drafts', 'Drafts']] : []), ['done', 'Finished']].map(([k, l]) => `<button type="button" role="tab" class="tab-btn${tab === k ? ' on active' : ''}" data-ct-tab="${k}" aria-selected="${tab === k}">${l} <span class="hint" style="margin:0;">${counts[k] || 0}</span></button>`).join('')}
      </div>
      ${rows.length ? `<div class="ct-list">${rows.map(c => `
        <a class="ct-row" href="#/contract/${esc(c.id)}">
          <div class="ct-row-main"><strong>${esc(c.title)}</strong><span>${manage ? esc(c.roblox_username) + ' &middot; ' : ''}${esc(c.count)} milestone${c.count === 1 ? '' : 's'}${c.submitted ? ` &middot; <b class="ct-attn">${esc(c.submitted)} to review</b>` : ''}</span></div>
          <div class="ct-row-progress" aria-label="${esc(c.approved)} of ${esc(c.count)} approved"><span style="width:${c.count ? Math.round(c.approved / c.count * 100) : 0}%"></span></div>
          <div class="ct-row-amt">${esc(money(c.total, c.currency))}</div>
          <div>${contractChip(c.status)}</div>
        </a>`).join('')}</div>`
        : `<div class="dash-empty"><h3>${tab === 'open' ? 'No open contracts' : tab === 'drafts' ? 'No drafts' : 'Nothing finished yet'}</h3><p>${manage && tab !== 'done' ? 'Press New contract to commission some work.' : 'Contracts you\'re sent will show up here.'}</p></div>`}` : (error ? '' : `<div class="dash-loading">Loading...</div>`)}
    </div>`;
        wireTopbarSignOut();
        wire();
        if (editor) {
          const pick = document.getElementById('ctPerson');
          if (pick && editor.person) pick.value = editor.person;
        }
      }

      function syncEditor() {
        if (!editor) return;
        const v = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
        editor.title = v('ctTitle'); editor.person = v('ctPerson'); editor.gameId = v('ctGame');
        editor.currency = v('ctCurrency') || editor.currency; editor.dueAt = v('ctDue'); editor.terms = v('ctTerms');
        editor.milestones = editor.milestones.map((m, i) => ({
          title: (document.querySelector(`[data-ms-title="${i}"]`) || {}).value || '',
          amount: (document.querySelector(`[data-ms-amount="${i}"]`) || {}).value || '',
          dueAt: (document.querySelector(`[data-ms-due="${i}"]`) || {}).value || ''
        }));
      }

      function wire() {
        const q = (id) => document.getElementById(id);
        if (q('ctNew')) q('ctNew').addEventListener('click', async () => { await loadKnownPeople(); editor = blankEditor(); paint(); q('ctTitle') && q('ctTitle').focus(); });
        document.querySelectorAll('[data-ct-tab]').forEach(b => b.addEventListener('click', () => { tab = b.dataset.ctTab; paint(); }));
        if (!editor) return;
        if (q('ctCancelEdit')) q('ctCancelEdit').addEventListener('click', () => { editor = null; paint(); });
        if (q('ctAddMs')) q('ctAddMs').addEventListener('click', () => { syncEditor(); editor.milestones.push({ title: '', amount: '', dueAt: '' }); paint(); });
        document.querySelectorAll('[data-ms-remove]').forEach(b => b.addEventListener('click', () => { syncEditor(); editor.milestones.splice(Number(b.dataset.msRemove), 1); paint(); }));
        // Keep the total live without re-drawing the form (a re-draw mid-click would swallow it).
        const refreshTotal = () => {
          syncEditor();
          const t = editor.milestones.reduce((sum, m) => sum + (Number(m.amount) || 0), 0);
          const el = document.getElementById('ctTotal');
          if (el) el.textContent = money(t, editor.currency);
        };
        document.querySelectorAll('[data-ms-amount]').forEach(el => el.addEventListener('input', refreshTotal));
        if (q('ctCurrency')) q('ctCurrency').addEventListener('change', refreshTotal);
        if (q('ctTemplate')) q('ctTemplate').addEventListener('click', async () => {
          syncEditor();
          if (editor.terms && !(await askConfirm('Replace your terms with the starter template?'))) return;
          const p = pickedPerson('ctPerson');
          editor.terms = contractTermsTemplate({ robloxUsername: p ? p.name : '' });
          paint();
        });
        document.querySelectorAll('[data-ct-save]').forEach(b => b.addEventListener('click', async () => {
          syncEditor();
          const p = pickedPerson('ctPerson');
          const ms = editor.milestones.map(m => ({ title: m.title.trim(), amount: Number(m.amount), dueAt: m.dueAt || null })).filter(m => m.title || m.amount);
          if (!editor.title.trim()) { editor.error = 'Give the contract a title.'; paint(); return; }
          if (!p) { editor.error = 'Pick the contractor.'; paint(); return; }
          if (!p.id) { editor.error = `${p.name} isn't someone the panel knows yet. They need to sign in once first.`; paint(); return; }
          if (!ms.length || ms.some(m => !m.title || !(m.amount > 0))) { editor.error = 'Every milestone needs a description and an amount.'; paint(); return; }
          const send = b.dataset.ctSave === 'send';
          if (send && !editor.terms.trim()) { editor.error = 'Add the terms before sending, or use the starter template.'; paint(); return; }
          editor.busy = true; editor.error = null; paint();
          try {
            const r = await callHrData('ct_save', { id: editor.id, title: editor.title, robloxUserId: p.id, robloxUsername: p.name, gameId: editor.gameId || null, currency: editor.currency, dueAt: editor.dueAt || null, terms: editor.terms, milestones: ms, send });
            toast(send ? `Sent to ${p.name} to sign.` : 'Draft saved.');
            editor = null;
            window.location.hash = '#/contract/' + r.id;
          } catch (e) {
            editor.busy = false;
            editor.error = e.code === 'own_payment' ? "You can't make a contract with yourself." : e.code === 'invalid_fields' ? 'Check the milestones: each needs a description and an amount within the per-request limit.' : e.message;
            paint();
          }
        }));
      }

      async function load() {
        try {
          const [json, boot] = await Promise.all([callHrData('ct_list'), ensureBootstrap().catch(() => null)]);
          list = json.data || []; manage = !!json.canManage; error = null;
          games = (BOOTSTRAP && BOOTSTRAP.games) || [];
          const q = parseHashQuery();
          if (manage && q.get('new') === '1' && !editor) { await loadKnownPeople(); editor = blankEditor(); }
        } catch (e) { error = e.code === 'database_update_needed' ? 'Your database needs an update. Run sql/upgrade.sql in Supabase.' : e.message; }
        paint();
      }
      paint();
      load();
    }

    function renderContractPage(id) {
      const myGen = renderGen;
      let c = null;
      let error = null;
      let busy = false;
      let signError = null;

      function paint() {
        if (myGen !== renderGen) return;
        if (!c) {
          app.innerHTML = `${topbar()}<div class="shell">${error ? `<div class="dash-empty"><h3>Couldn't open this contract</h3><p>${esc(error)}</p><a class="btn btn-ghost btn-sm" href="#/contracts">Back to contracts</a></div>` : '<div class="dash-loading">Loading...</div>'}</div>`;
          wireTopbarSignOut();
          return;
        }
        const total = c.total;
        const approvedTotal = c.milestones.filter(m => m.status === 'approved').reduce((t, m) => t + Number(m.amount), 0);
        const mine = c.isContractor;
        app.innerHTML = `
    ${topbar()}
    <div class="shell ct-page">
      <a class="back-link" href="#/contracts">&larr; Contracts</a>
      <div class="dash-head">
        <div><h1>${esc(c.title)}</h1><p class="sub">${mine ? `From ${esc(studioName())}` : `With ${esc(c.roblox_username)}`}${c.due_at ? ` &middot; due ${esc(fmtDate(c.due_at))}` : ''}</p></div>
        <div class="dash-toolbar">${contractChip(c.status)}</div>
      </div>
      <div class="ct-stats">
        <div><small>Total</small><strong>${esc(money(total, c.currency))}</strong></div>
        <div><small>Approved</small><strong>${esc(money(approvedTotal, c.currency))}</strong></div>
        <div><small>Paid out</small><strong>${esc(money(c.paidTotal, c.currency))}</strong></div>
        <div><small>Milestones</small><strong>${esc(c.milestones.filter(m => m.status === 'approved').length)} / ${esc(c.milestones.length)}</strong></div>
      </div>

      ${c.status === 'sent' && mine ? `
      <div class="panel ct-sign">
        <h3 class="panel-title">Read and sign</h3>
        <p class="sub" style="margin:0 0 14px;">Read the terms and milestones below. Signing means you agree to them. You'll be paid for each milestone once it's approved.</p>
        ${signError ? `<div class="error-box"><span>${esc(signError)}</span></div>` : ''}
        <div class="field"><label for="ctSignName">Type your full name to sign</label><input type="text" id="ctSignName" maxlength="120" autocomplete="name"></div>
        <label class="pp-check"><input type="checkbox" id="ctAgree"> I've read this contract and agree to its terms.</label>
        <button type="button" class="btn btn-primary btn-sm" id="ctSign" ${busy ? 'disabled' : ''}>${busy ? 'Signing...' : 'Sign contract'}</button>
      </div>` : ''}
      ${c.status === 'sent' && !mine ? `<div class="warn-box"><span>Waiting for ${esc(c.roblox_username)} to sign.</span></div>` : ''}
      ${c.status === 'draft' ? `<div class="warn-box"><span>This is a draft. ${esc(c.roblox_username)} can't see it until you send it.</span><button type="button" class="btn btn-primary btn-sm" id="ctSend">Send to sign</button></div>` : ''}
      ${c.status === 'cancelled' ? `<div class="warn-box"><span>Cancelled${c.cancel_reason ? `: ${esc(c.cancel_reason)}` : '.'} Milestones already approved are still paid.</span></div>` : ''}

      <div class="heading-block section-head"><h2 class="sec-title">Milestones</h2></div>
      <div class="ct-ms-list">
        ${c.milestones.map((m, i) => {
          const state = m.status === 'approved' ? (m.paymentStatus === 'paid' ? ['Paid', 'ok'] : ['Approved', 'info']) : m.status === 'submitted' ? ['Waiting for review', 'warn'] : ['To do', 'neutral'];
          return `
          <div class="ct-ms">
            <span class="ct-ms-num ${m.status === 'approved' ? 'done' : ''}">${m.status === 'approved' ? '&#10003;' : i + 1}</span>
            <div class="ct-ms-body">
              <div class="ct-ms-top"><strong>${esc(m.title)}</strong><span class="ct-ms-amt">${esc(money(m.amount, c.currency))}</span></div>
              <div class="ct-ms-meta"><span class="tone-chip ${state[1]}">${state[0]}</span>${m.due_at ? `<span>Due ${esc(fmtDate(m.due_at))}</span>` : ''}${m.decided_by && m.status === 'approved' ? `<span>Approved by ${esc(m.decided_by)}</span>` : ''}</div>
              ${m.details ? `<p class="ct-ms-text">${esc(m.details)}</p>` : ''}
              ${m.submitted_note && m.status !== 'open' ? `<p class="ct-ms-note"><b>${esc(c.roblox_username)}:</b> ${esc(m.submitted_note)}</p>` : ''}
              ${m.decision_note && m.status === 'open' ? `<p class="ct-ms-note warn"><b>Sent back:</b> ${esc(m.decision_note)}</p>` : ''}
              ${c.status === 'active' && mine && m.status === 'open' ? `<div class="ct-ms-actions"><button type="button" class="btn btn-ghost btn-sm" data-ms-submit="${esc(m.id)}">Mark as done</button></div>` : ''}
              ${c.status === 'active' && c.canManage && !mine && ['open', 'submitted'].includes(m.status) ? `<div class="ct-ms-actions">
                <button type="button" class="btn btn-primary btn-sm" data-ms-approve="${esc(m.id)}">Approve ${esc(money(m.amount, c.currency))}</button>
                ${m.status === 'submitted' ? `<button type="button" class="btn btn-ghost btn-sm" data-ms-reject="${esc(m.id)}">Send back</button>` : ''}
              </div>` : ''}
            </div>
          </div>`;
        }).join('')}
      </div>

      <div class="heading-block section-head"><h2 class="sec-title">Terms</h2></div>
      <div class="panel"><div class="legal-doc ct-terms">${c.terms ? legalBodyHtml(c.terms) : '<p class="hint">No terms were written for this contract.</p>'}</div>
        ${c.signed_at ? `<div class="ct-signature"><span>Signed by</span><strong>${esc(c.signed_name)}</strong><small>${esc(fmtDateTime(c.signed_at))}</small></div>` : ''}
      </div>

      ${c.canManage && !mine && ['draft', 'sent', 'active'].includes(c.status) ? `<div class="ct-danger"><button type="button" class="btn btn-danger-ghost btn-sm" id="ctCancel">${c.status === 'draft' ? 'Delete draft' : 'Cancel contract'}</button></div>` : ''}
    </div>`;
        wireTopbarSignOut();
        wire();
      }

      function wire() {
        const q = (x) => document.getElementById(x);
        if (q('ctSign')) q('ctSign').addEventListener('click', async () => {
          const name = q('ctSignName').value.trim();
          if (name.length < 2) { signError = 'Type your full name.'; paint(); return; }
          if (!q('ctAgree').checked) { signError = 'Tick the box to agree to the terms.'; paint(); return; }
          busy = true; signError = null; paint();
          try { await callHrData('ct_sign', { id: c.id, name, agree: true }); toast('Signed. The contract is active.'); await load(); }
          catch (e) { signError = e.message; }
          busy = false; paint();
        });
        if (q('ctSend')) q('ctSend').addEventListener('click', async () => {
          if (!c.terms && !(await askConfirm('Send without any terms?\n\nThe contractor will sign a contract with only the milestones.'))) return;
          try { await callHrData('ct_send', { id: c.id }); toast(`Sent to ${c.roblox_username}.`); await load(); } catch (e) { toast(e.message, 'err'); }
        });
        if (q('ctCancel')) q('ctCancel').addEventListener('click', async () => {
          if (c.status === 'draft') {
            if (!(await askConfirm('Delete this draft?'))) return;
            try { await callHrData('ct_cancel', { id: c.id }); toast('Draft deleted.'); window.location.hash = '#/contracts'; } catch (e) { toast(e.message, 'err'); }
            return;
          }
          const reason = await askForText({ title: 'Cancel this contract', hint: `${c.roblox_username} sees this reason. Milestones already approved are still paid.`, placeholder: 'For example: the project was paused.', confirmLabel: 'Cancel contract', required: false });
          if (reason === null) return;
          try { await callHrData('ct_cancel', { id: c.id, reason }); toast('Contract cancelled.'); await load(); } catch (e) { toast(e.message, 'err'); }
        });
        document.querySelectorAll('[data-ms-submit]').forEach(b => b.addEventListener('click', async () => {
          const note = await askForText({ title: 'Mark this milestone as done', hint: 'Add a link or a short note so it can be checked. Optional.', placeholder: 'e.g. Uploaded to the team place, see the Winter folder.', confirmLabel: 'Send for review', required: false });
          if (note === null) return;
          try { await callHrData('ct_submit_milestone', { milestoneId: b.dataset.msSubmit, note }); toast('Sent for review.'); await load(); } catch (e) { toast(e.message, 'err'); }
        }));
        document.querySelectorAll('[data-ms-approve]').forEach(b => b.addEventListener('click', async () => {
          if (!(await askConfirm(`Approve this milestone?\n\nIt becomes a payment for ${c.roblox_username} waiting to be paid out.`, { okLabel: 'Approve' }))) return;
          b.disabled = true;
          try { const r = await callHrData('ct_decide_milestone', { milestoneId: b.dataset.msApprove, decision: 'approve' }); toast(r.completed ? 'Approved. Every milestone is done, so the contract is complete.' : 'Approved and added to Review & pay.'); await load(); }
          catch (e) { b.disabled = false; toast(e.code === 'own_payment' ? "You can't approve your own milestone." : e.message, 'err'); }
        }));
        document.querySelectorAll('[data-ms-reject]').forEach(b => b.addEventListener('click', async () => {
          const note = await askForText({ title: 'Send this milestone back', hint: `${c.roblox_username} sees this note.`, placeholder: 'What needs to change?', confirmLabel: 'Send back', required: true, requiredMessage: 'Say what needs to change.' });
          if (note === null) return;
          try { await callHrData('ct_decide_milestone', { milestoneId: b.dataset.msReject, decision: 'reject', note }); toast('Sent back.'); await load(); } catch (e) { toast(e.message, 'err'); }
        }));
      }

      async function load() {
        try { const json = await callHrData('ct_get', { id }); c = json.data; error = null; }
        catch (e) { error = e.code === 'not_found' ? "It doesn't exist, or it isn't yours to see." : e.message; }
        paint();
      }
      paint();
      load();
    }

    function renderTeamRemovedPage() {
      if (!authReady) { app.innerHTML = topbar(); return; }
      if (!isHrAuthed) { renderHrGate(); return; }

      app.innerHTML = `
    ${topbar()}
    <div class="closed-shell">
      <div class="lock-card">
        <div class="closed-icon warn">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3.2l9.3 16.1a1 1 0 01-.87 1.5H3.57a1 1 0 01-.87-1.5L12 3.2z"></path>
            <line x1="12" y1="9.6" x2="12" y2="14"></line>
            <circle cx="12" cy="17.1" r="0.95" fill="currentColor" stroke="none"></circle>
          </svg>
        </div>
        <h2>You're not on a team</h2>
        <p>Your team was removed, so the tool is on hold for you until a lead puts you on another team, or tells you that you're leaving ${esc(studioName())}. Nothing of yours is lost, and payments already logged for you are still paid.</p>
        <button type="button" class="btn btn-primary" id="teamRemovedRetryBtn">Check again</button>
        <div class="lock-note">Signed in as ${esc(hrUsername)}. Ask an admin to move you to a team - or <button type="button" class="inline-link-btn" id="teamRemovedSignOutBtn">sign out</button> if this isn't your account.</div>
      </div>
    </div>`;

      wireTopbarSignOut();

      const retryBtn = document.getElementById('teamRemovedRetryBtn');
      if (retryBtn) {
        retryBtn.addEventListener('click', async () => {
          if (retryBtn.disabled) return;
          retryBtn.disabled = true;
          const original = retryBtn.textContent;
          retryBtn.textContent = 'Checking...';
          const myGen = renderGen;
          await verifySession();
          if (myGen !== renderGen) return;
          if (!isHrAuthed) { window.location.hash = '#/'; return; }
          if (!teamRemoved) { window.location.hash = '#/'; return; }
          retryBtn.disabled = false;
          retryBtn.textContent = original;
        });
      }

      const signOutBtn = document.getElementById('teamRemovedSignOutBtn');
      if (signOutBtn) signOutBtn.addEventListener('click', hrSignOut);
    }

    // Terms, Privacy and Acceptable Use. Public: anyone can read them, signed in or not.
    const LEGAL_PAGES = [
      { key: 'terms', hash: '#/terms', label: 'Terms of Service' },
      { key: 'privacy', hash: '#/privacy', label: 'Privacy Policy' },
      { key: 'aup', hash: '#/aup', label: 'Acceptable Use' }
    ];
    let legalCache = null;

    function fetchLegal() {
      if (legalCache) return Promise.resolve(legalCache);
      return fetchWithTimeout(EDGE_BASE + '/public/legal', {}, 12000)
        .then(r => r.json())
        .then(j => { if (!j || !j.data) throw new Error('legal_failed'); legalCache = j.data; return legalCache; });
    }

    // Turns the plain-text policy into headed sections. Lines like "3. Payments" become headings,
    // "- item" lines become lists, everything else is a paragraph. All text is escaped.
    function legalBodyHtml(text) {
      const bullet = /^[-*•]\s+/;
      return String(text || '').replace(/\r/g, '').split(/\n\s*\n/).map(block => {
        const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
        if (!lines.length) return '';
        if (/^last updated/i.test(lines[0]) && lines.length === 1) return `<p class="legal-updated">${esc(lines[0])}</p>`;
        let out = '';
        let start = 0;
        if (/^\d+\.\s+\S/.test(lines[0]) && lines[0].length < 90) { out += `<h2>${esc(lines[0])}</h2>`; start = 1; }
        let para = [];
        let list = [];
        const flushPara = () => { if (para.length) out += `<p>${esc(para.join(' '))}</p>`; para = []; };
        const flushList = () => { if (list.length) out += `<ul>${list.map(l => `<li>${esc(l)}</li>`).join('')}</ul>`; list = []; };
        lines.slice(start).forEach(l => {
          if (bullet.test(l)) { flushPara(); list.push(l.replace(bullet, '')); }
          else { flushList(); para.push(l); }
        });
        flushPara(); flushList();
        return out;
      }).join('');
    }

    function renderPolicyPage(type) {
      if (type === 'tos') type = 'terms';
      const page = LEGAL_PAGES.find(p => p.key === type) || LEGAL_PAGES[0];
      const myGen = renderGen;
      let doc = null;
      let loadError = null;

      function tabs() {
        return `<nav class="legal-tabs" aria-label="Policies">${LEGAL_PAGES.map(p => `<a href="${p.hash}" class="${p.key === page.key ? 'on' : ''}"${p.key === page.key ? ' aria-current="page"' : ''}>${esc(p.label)}</a>`).join('')}</nav>`;
      }

      function body() {
        if (loadError) return `<div class="dash-empty"><h3>Couldn't load this page</h3><p>${esc(loadError)}</p><button type="button" class="btn btn-ghost btn-sm" id="retryPolicyBtn">Try again</button></div>`;
        if (!doc) return `<div class="legal-skeleton" aria-busy="true"><i></i><i></i><i></i><i></i><i></i></div>`;
        return `<article class="legal-doc">${legalBodyHtml(doc.content)}</article>`;
      }

      function paint() {
        if (myGen !== renderGen) return;
        if (isHrAuthed) {
          app.innerHTML = `
    ${topbar()}
    <div class="shell legal-shell">
      <div class="heading-block"><h1>${esc(page.label === 'Acceptable Use' ? 'Acceptable Use Policy' : page.label)}</h1></div>
      ${tabs()}
      <div class="legal-card">${body()}</div>
    </div>`;
          wireTopbarSignOut();
        } else {
          const st = STUDIO.studio || {};
          const logo = st.logoUrl ? `<img src="${esc(st.logoUrl)}" alt="">` : `<span class="auth-brand-mark">${esc(studioShort())}</span>`;
          app.innerHTML = `
    <div class="legal-public">
      <header class="legal-public-head">
        <a class="auth-brand" href="#/">${logo}<span>${esc(brandName())}</span></a>
        <div class="legal-public-actions">
          <button type="button" class="auth-icon-btn" id="themeToggleBtn" aria-label="${getTheme() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}">${themeToggleIcon()}</button>
          <a class="btn btn-primary btn-sm" href="#/">Sign in</a>
        </div>
      </header>
      <main class="legal-public-main">
        <h1>${esc(page.label === 'Acceptable Use' ? 'Acceptable Use Policy' : page.label)}</h1>
        ${tabs()}
        ${body()}
      </main>
      <footer class="legal-public-foot">&copy; ${new Date().getFullYear()} ${esc(studioName())}${st.website ? ` &middot; ${studioWebsiteLink('')}` : ''}</footer>
    </div>`;
          wireAuthShell();
        }
        const retryBtn = document.getElementById('retryPolicyBtn');
        if (retryBtn) retryBtn.addEventListener('click', load);
        document.title = `${page.label} · ${brandName()}`;
      }

      async function load() {
        loadError = null; doc = null; paint();
        try {
          const data = await fetchLegal();
          doc = data[page.key] || null;
          if (!doc) loadError = 'This page is not available right now.';
        } catch (err) {
          loadError = 'Check your connection and try again.';
        }
        paint();
      }

      paint();
      window.scrollTo(0, 0);
      load();
    }

    const INVITE_STORAGE_KEY = 'pv_pending_invite';
    function getPendingInvite() { try { return localStorage.getItem(INVITE_STORAGE_KEY) || null; } catch (e) { return null; } }
    function setPendingInvite(token) { try { localStorage.setItem(INVITE_STORAGE_KEY, token); } catch (e) { } }
    function clearPendingInvite() { try { localStorage.removeItem(INVITE_STORAGE_KEY); } catch (e) { } }

    function renderOnboarding() {
      if (!authReady) { app.innerHTML = topbar(); return; }
      if (!isHrAuthed) { renderHrGate(); return; }

      const myGen = renderGen;
      const query = parseHashQuery();
      const discordError = query.get('discordLinkError');
      let serverSteps = [];
      let myAssignment = [];
      let payoutMethod = null;
      let loading = true;
      let loadError = null;
      let busy = false;
      let stepError = null;
      let viewing = null;
      let discordSkipped = false;

      let inviteToken = getPendingInvite();
      let invite = { info: null, invalid: false, started: false, done: false };
      let pollTimer = null;

      function hasInviteTeam() { return !!(inviteToken && !invite.invalid && invite.info && invite.info.team); }

      function buildSteps() {
        const list = [];
        if (discordOn()) list.push({
          id: 'discord', title: 'Link Discord', blurb: 'So we can reach you and give you access.',
          required: true, done: !needsDiscordLink, skipped: needsDiscordLink && discordSkipped
        });
        if (inviteToken && !invite.invalid) {
          const teamName = invite.info && invite.info.team ? invite.info.team.name : null;
          list.push({
            id: 'invite', title: teamName ? `Join ${teamName}` : 'Join your team', blurb: 'Accept the invite to join the team.',
            required: true, done: invite.done, skipped: !invite.done && needsDiscordLink && discordSkipped
          });
        }
        serverSteps.forEach(s => {
          if (s.type === 'team_info' && hasInviteTeam()) return;
          list.push({
            id: s.id, title: s.title, blurb: s.description, required: !!s.required || s.type === 'team_info', done: !!s.completedAt, server: s
          });
        });
        list.push({
          id: 'payout', title: 'Add a payout method', blurb: 'Optional. You can do this later.',
          required: false, done: !!payoutMethod
        });
        return list;
      }

      function currentStep(list) {
        if (viewing) { const v = list.find(s => s.id === viewing); if (v) return v; }
        return list.find(s => !s.done && !s.skipped && s.id !== 'payout') || null;
      }

      function allRequiredDone(list) { return list.filter(s => s.required).every(s => s.done || s.skipped); }

      function paragraphs(text) {
        return String(text || '').split(/\n\s*\n/).map(p => `<p>${esc(p.trim())}</p>`).join('');
      }

      function railHtml(list, cur) {
        return `<ol class="ob-rail" aria-label="Setup steps">
          ${list.map((s, i) => {
          const state = s.done ? 'done' : (cur && cur.id === s.id ? 'now' : (s.skipped ? 'skipped' : ''));
          return `<li class="${state}">
              <button type="button" data-ob-view="${esc(s.id)}" ${cur && cur.id === s.id ? 'aria-current="step"' : ''}>
                <span class="ob-mark" aria-hidden="true">${s.done ? '&#10003;' : i + 1}</span>
                <span class="ob-rail-text"><span class="ob-rail-title">${esc(s.title)}</span>${s.skipped ? '<span class="ob-rail-sub">Skipped for now</span>' : !s.required ? '<span class="ob-rail-sub">Optional</span>' : ''}</span>
              </button>
            </li>`;
        }).join('')}
        </ol>`;
      }

      function discordStepHtml(s) {
        const linkUrl = staffDiscordLinkHref('#/onboarding');
        const errMsg = discordError && !s.done ? (DISCORD_LINK_ERROR_MESSAGES[discordError] || 'Could not link that Discord account. Try again.') : null;
        return `
          <h2>Link your Discord account</h2>
          <p class="ob-lead">We use Discord to message you about your team, applications and payments. It only takes a few seconds.</p>
          ${errMsg ? `<div class="error-box"><span>${esc(errMsg)}</span></div>` : ''}
          ${s.done
            ? `<div class="confirm-box"><div class="icon">&#10003;</div><div class="txt"><strong>Discord is linked</strong><span>You can change this later from your account.</span></div></div>`
            : `<div style="display:flex;gap:8px;flex-wrap:wrap;">
                <a class="btn btn-primary" href="${linkUrl}">${errMsg ? 'Try again' : 'Link Discord'}</a>
                <button type="button" class="btn btn-ghost" id="obDiscordSkip">Skip for now</button>
              </div>
              <p class="hint">You can skip this, but My payments stays locked until Discord is linked${inviteToken ? ' and you have joined your team\'s Roblox groups' : ''}.</p>`}`;
      }

      function inviteStepHtml(s) {
        const info0 = invite.info || {};
        if (!invite.done) {
          return `
          <h2>${esc(s.title)}</h2>
          <div class="ob-invite">
            ${info0.team ? `<div><span class="hint">Team</span><strong style="color:${safeColor(info0.team.color, 'var(--ink)')};">${esc(info0.team.name)}</strong></div>` : ''}
            ${info0.skillset ? `<div><span class="hint">Skill</span><strong style="color:${safeColor(info0.skillset.color, 'var(--ink)')};">${esc(info0.skillset.name)}</strong></div>` : ''}
          </div>
          <p class="ob-lead">Accept the invite and you're on the team straight away. A lead ranks you in the Roblox group by hand afterwards, so there's nothing to wait for here.</p>
          ${stepError ? `<div class="error-box"><span>${esc(stepError)}</span></div>` : ''}
          <button type="button" class="btn btn-primary" id="obInviteJoin" ${busy ? 'disabled' : ''}>${busy ? 'Accepting...' : 'Accept invite'}</button>`;
        }
        return `
          <h2>${esc(s.title)}</h2>
          <div class="confirm-box"><div class="icon">&#10003;</div><div class="txt"><strong>You're on the team</strong><span>This team and skill are on your account now.</span></div></div>`;
      }

      function inviteStepHtmlLegacy(s) {
        const info = invite.info || {};
        const chips = `
          <div class="ob-invite">
            ${info.team ? `<div><span class="hint">Team</span><strong style="color:${safeColor(info.team.color, 'var(--ink)')};">${esc(info.team.name)}</strong></div>` : ''}
            ${info.skillset ? `<div><span class="hint">Skill</span><strong style="color:${safeColor(info.skillset.color, 'var(--ink)')};">${esc(info.skillset.name)}</strong></div>` : ''}
          </div>`;
        if (needsDiscordLink) return `<h2>${esc(s.title)}</h2>${chips}<p class="ob-lead">Link Discord first, then come back to this step.</p><button type="button" class="btn btn-ghost" data-ob-view="discord">Go to Link Discord</button>`;
        if (invite.done) return `<h2>${esc(s.title)}</h2>${chips}<div class="confirm-box"><div class="icon">&#10003;</div><div class="txt"><strong>You're on the team</strong><span>This team and skill are on your account now.</span></div></div>`;
        if (invite.started) return `
          <h2>${esc(s.title)}</h2>
          ${chips}
          <p class="ob-lead">Our bot has sent you a Discord DM. Follow it to join the ${esc(studioName())} Roblox group (and your team's group if it has one), then press Continue in that DM.</p>
          <p class="hint">This page checks automatically every few seconds.</p>
          <button type="button" class="btn btn-ghost" id="obInviteCheck" ${busy ? 'disabled' : ''}>${busy ? 'Checking...' : 'Check now'}</button>`;
        return `
          <h2>${esc(s.title)}</h2>
          ${chips}
          <p class="ob-lead">You were invited to join this team. When you continue, our bot will DM you on Discord with a couple of quick steps.</p>
          <button type="button" class="btn btn-primary" id="obInviteJoin" ${busy ? 'disabled' : ''}>${busy ? 'Starting...' : 'Accept invite'}</button>`;
      }

      function teamInfoHtml() {
        if (!myAssignment || !myAssignment.length) {
          return `<div class="empty-note">You're not on a team yet. That's fine, a lead will add you, or ask for an invite link.</div>`;
        }
        return `<div class="ob-teams">${myAssignment.map(a => `
          <div class="panel" style="margin:0;">
            ${a.team ? `<strong style="color:${safeColor(a.team.color, 'var(--ink)')};font-size:15px;">${esc(a.team.name)}</strong>` : ''}
            ${a.skillset ? `<span class="hint"> as ${esc(a.skillset.name)}</span>` : ''}
            ${a.team && a.team.info ? `<p class="sub" style="margin:8px 0 0;white-space:pre-wrap;">${esc(a.team.info)}</p>` : ''}
            ${a.team && ((discordOn() && a.team.discord_url) || a.team.roblox_group_url) ? `<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
              ${discordOn() && a.team.discord_url ? `<a class="btn btn-primary btn-sm" href="${esc(safeUrl(a.team.discord_url) || '#')}" target="_blank" rel="noopener">Team Discord</a>` : ''}
              ${a.team.roblox_group_url ? `<a class="btn btn-ghost btn-sm" href="${esc(safeUrl(a.team.roblox_group_url) || '#')}" target="_blank" rel="noopener">Team Roblox group</a>` : ''}
            </div>` : ''}
          </div>`).join('')}</div>`;
      }

      function serverStepHtml(s) {
        const st = s.server;
        const isPolicy = st.type === 'tos' || st.type === 'aup';
        let body = '';
        if (st.type === 'team_info') body = teamInfoHtml();
        else if (isPolicy) body = `<div class="ob-policy legal-doc" tabindex="0" aria-label="${esc(st.title)}">${legalBodyHtml(st.content)}</div>${st.type === 'tos' ? '<p class="hint" style="margin-top:10px;">How we handle your information is in the <a href="#/privacy" target="_blank" rel="noopener">Privacy Policy</a>.</p>' : ''}`;
        else body = `<div class="ob-copy">${paragraphs(st.content)}</div>`;
        return `
          <h2>${esc(st.title)}</h2>
          ${st.description ? `<p class="ob-lead">${esc(st.description)}</p>` : ''}
          ${body}
          ${stepError ? `<div class="error-box"><span>${esc(stepError)}</span></div>` : ''}
          ${s.done
            ? `<p class="ob-done-note">&#10003; ${isPolicy ? 'You accepted this' : 'Done'} ${st.completedAt ? esc(relTime(st.completedAt)) : ''}.</p>`
            : `<button type="button" class="btn btn-primary" data-ob-complete="${esc(st.id)}" ${busy ? 'disabled' : ''}>${busy ? 'Saving...' : isPolicy ? 'I agree' : 'Continue'}</button>`}`;
      }

      function payoutStepHtml(s) {
        return `
          <h2>Add a payout method</h2>
          <p class="ob-lead">Tell us how you want to be paid. You can skip this and do it any time from My payments.</p>
          ${s.done ? `<div class="confirm-box"><div class="icon">&#10003;</div><div class="txt"><strong>Payout method saved</strong><span>${esc(PAYMENT_METHODS[payoutMethod.method] ? PAYMENT_METHODS[payoutMethod.method].label : payoutMethod.method)}</span></div></div>`
            : needsDiscordLink
              ? `<p class="hint">My payments is locked until Discord is linked.</p><div style="display:flex;gap:8px;flex-wrap:wrap;"><button type="button" class="btn btn-ghost" id="obFinish">Continue</button></div>`
              : `<div style="display:flex;gap:8px;flex-wrap:wrap;"><a class="btn btn-primary" href="#/my?focus=payout">Add payout method</a><button type="button" class="btn btn-ghost" id="obFinish">Skip for now</button></div>`}`;
      }

      function finishHtml(list) {
        const optionalLeft = list.filter(s => !s.required && !s.done);
        const skippedLeft = list.filter(s => s.skipped);
        return `
          <h2>You're all set</h2>
          <p class="ob-lead">Your account is ready. You can come back to this page any time to reread the policies.</p>
          ${skippedLeft.length ? `<div class="error-box" style="margin:0;"><span>Still to do: ${skippedLeft.map(s => esc(s.title.toLowerCase())).join(' and ')}. My payments stays locked until then.</span></div>` : ''}
          ${optionalLeft.length ? `<p class="hint">Still optional: ${optionalLeft.map(s => esc(s.title.toLowerCase())).join(', ')}.</p>` : ''}
          <a class="btn btn-primary" href="${hasPermission('dashboard.view') ? '#/dashboard' : '#/my'}">Go to ${esc(studioName())}</a>`;
      }

      function paint() {
        if (myGen !== renderGen) return;
        const list = buildSteps();
        const cur = currentStep(list);
        const required = list.filter(s => s.required);
        const doneCount = required.filter(s => s.done).length;
        let main;
        if (loading) main = `<div class="dash-loading">Loading your setup...</div>`;
        else if (loadError) main = `<div class="dash-empty"><h3>Could not load your setup</h3><p>${esc(loadError)}</p><button type="button" class="btn btn-ghost btn-sm" id="obRetry">Try again</button></div>`;
        else if (!cur) main = finishHtml(list);
        else if (cur.id === 'discord') main = discordStepHtml(cur);
        else if (cur.id === 'invite') main = inviteStepHtml(cur);
        else if (cur.id === 'payout') main = payoutStepHtml(cur);
        else main = serverStepHtml(cur);

        app.innerHTML = `
    ${topbar()}
    <div class="shell">
      <div class="heading-block">
        <h1>${allRequiredDone(list) && !loading ? 'Your setup' : 'Welcome to ' + esc(studioName())}</h1>
        <p class="sub">${loading ? '' : allRequiredDone(list) ? 'Everything required is done.' : `${doneCount} of ${required.length} required steps done. It takes a couple of minutes.`}</p>
        ${!loading ? `<div class="ob-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${required.length}" aria-valuenow="${doneCount}"><i style="width:${required.length ? Math.round(doneCount / required.length * 100) : 100}%"></i></div>` : ''}
      </div>
      <div class="ob-layout">
        ${loading || loadError ? '' : railHtml(list, cur)}
        <section class="panel ob-main" aria-live="polite">${main}</section>
      </div>
    </div>`;

        wireTopbarSignOut();
        const retry = document.getElementById('obRetry');
        if (retry) retry.addEventListener('click', load);
        document.querySelectorAll('[data-ob-view]').forEach(b => b.addEventListener('click', () => { viewing = b.dataset.obView; stepError = null; paint(); }));
        document.querySelectorAll('[data-ob-complete]').forEach(b => b.addEventListener('click', () => completeServerStep(b.dataset.obComplete)));
        const join = document.getElementById('obInviteJoin');
        if (join) join.addEventListener('click', acceptInvite);
        const check = document.getElementById('obInviteCheck');
        if (check) check.addEventListener('click', () => checkInvite(true));
        const skipDiscord = document.getElementById('obDiscordSkip');
        if (skipDiscord) skipDiscord.addEventListener('click', () => { discordSkipped = true; viewing = null; stepError = null; paint(); window.scrollTo(0, 0); });
        const finish = document.getElementById('obFinish');
        if (finish) finish.addEventListener('click', () => { viewing = null; window.location.hash = hasPermission('dashboard.view') ? '#/dashboard' : '#/my'; });
      }

      function afterStepDone() {
        viewing = null;
        stepError = null;
        const list = buildSteps();
        needsOnboarding = serverSteps.some(s => s.required && !s.completedAt);
        paint();
        if (allRequiredDone(list)) window.scrollTo(0, 0);
      }

      async function completeServerStep(id) {
        busy = true; stepError = null; paint();
        try {
          await completeOnboardingStep(id);
          serverSteps = serverSteps.map(s => s.id === id ? { ...s, completedAt: new Date().toISOString() } : s);
          busy = false;
          afterStepDone();
        } catch (e) {
          busy = false;
          stepError = e.message || 'Could not save that step.';
          paint();
        }
      }

      async function acceptInvite() {
        busy = true; stepError = null; paint();
        try {
          await claimOnboardingLinkToken(inviteToken);
          invite.started = true;
          invite.done = true;
          await finishInvite();
        } catch (e) {
          const msg = JOIN_LINK_ERROR_MESSAGES[e.code] || e.message || 'Could not accept that invite.';
          if (e.code === 'link_not_found') { invite.invalid = true; clearPendingInvite(); toast('That invite link is no longer valid.', 'err'); }
          else toast(msg, 'err');
        }
        busy = false;
        paint();
        startPolling();
      }

      async function checkInvite(manual) {
        if (manual) { busy = true; paint(); }
        try {
          const status = await getMyOnboardingLinkFlowStatus(inviteToken);
          invite.started = !!(status && status.started);
          if (status && status.done && !invite.done) { invite.done = true; finishInvite(); }
          else if (manual && invite.started) toast("Not finished yet. Complete the steps in the Discord DM, then check again.");
        } catch (e) { }
        if (manual) busy = false;
        if (myGen === renderGen) paint();
      }

      async function finishInvite() {
        clearPendingInvite();
        stopPolling();
        try { myAssignment = await getMyAssignment() || []; } catch (e) { }
        toast("You've joined the team.");
        afterStepDone();
      }

      function startPolling() {
        stopPolling();
        if (!inviteToken || invite.done || !invite.started) return;
        pollTimer = setInterval(() => {
          if (myGen !== renderGen || invite.done) { stopPolling(); return; }
          checkInvite(false);
        }, 6000);
      }
      function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

      async function load() {
        loading = true; loadError = null; paint();
        try {
          const tasks = [loadMyOnboarding(), getMyAssignment().catch(() => []), getMyPaymentMethod().catch(() => null)];
          if (inviteToken) {
            tasks.push(fetchOnboardingLinkPreview(inviteToken).catch(() => null));
            tasks.push(getMyOnboardingLinkFlowStatus(inviteToken).catch(() => null));
          }
          const [steps, assignment, method, info, status] = await Promise.all(tasks);
          serverSteps = steps || [];
          myAssignment = assignment || [];
          payoutMethod = method;
          if (inviteToken) {
            if (!info) { invite.invalid = true; clearPendingInvite(); }
            else {
              invite.info = info;
              invite.started = !!(status && status.started);
              invite.done = !!(status && status.done);
              if (invite.done) clearPendingInvite();
            }
          }
        } catch (e) {
          loadError = e.message || 'Could not load your setup.';
        }
        if (myGen !== renderGen) return;
        loading = false;
        needsOnboarding = serverSteps.some(s => s.required && !s.completedAt);
        if (discordError || query.get('discordLinked')) history.replaceState(null, '', '#/onboarding');
        if (invite.invalid && inviteToken) toast('That invite link is invalid or has expired.', 'err');
        paint();
        startPolling();
      }

      load();
    }

    function moneyFrozen() {
      return securityLevel === 'heightened' || securityLevel === 'lockdown';
    }

    function frozenAttrs() {
      if (!moneyFrozen()) return '';
      return ' disabled title="Payments are frozen while the security protocol is raised."';
    }

    function securityStrip() {
      if (securityLevel === 'normal' || !isHrAuthed) return '';
      const heavy = securityLevel === 'lockdown';
      return `
    <div class="sec-strip${heavy ? ' red' : ''}" role="status">
      <span class="sec-strip-dot"></span>
      <span><strong>${heavy ? 'Lockdown' : 'Heightened security'}</strong> is on, so payments are frozen.${lockdownNote ? ' ' + esc(lockdownNote.replace(/[.!?]*$/, '')) + '.' : ''}</span>
      ${canSeeSecurity() ? '<a href="#/security">Open security</a>' : ''}
    </div>`;
    }

    function canSeeSecurity() {
      return hasPermission('security.manage') || hasPermission('roles.manage');
    }

    function canSeeTeams() {
      return isHrAuthed && (hasPermission('teams.view') || hasPermission('staff.view_database') || hasPermission('dashboard.view'));
    }

    function canManageTeams() {
      return isHrAuthed && (hasPermission('teams.manage') || hasPermission('settings.manage_onboarding'));
    }

    function bigNum(n) {
      const v = Number(n || 0);
      if (v >= 1000000) return (v / 1000000).toFixed(v >= 10000000 ? 0 : 1) + 'M';
      if (v >= 1000) return (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'K';
      return String(v);
    }

    function signedNum(n) {
      if (n == null) return null;
      const v = Number(n);
      return (v > 0 ? '+' : v < 0 ? '' : '') + bigNum(Math.abs(v) === 0 ? 0 : v < 0 ? -Math.abs(v) : v);
    }

    function sparkline(points, key) {
      const vals = (points || []).map(p => Number(p[key] || 0));
      if (vals.length < 2) return '<div class="spark-empty">Not enough history yet</div>';
      const min = Math.min(...vals), max = Math.max(...vals);
      const span = max - min || 1;
      const w = 220, h = 48;
      const d = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - ((v - min) / span) * (h - 6) - 3}`).join(' ');
      const rising = vals[vals.length - 1] >= vals[0];
      return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Trend">
        <polyline points="${d}" fill="none" stroke="${rising ? 'var(--ok-text)' : 'var(--err-text)'}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></polyline>
      </svg>`;
    }

    function spendText(spend, monthOnly) {
      if (!spend) return null;
      const src = monthOnly ? spend.thisMonth : spend;
      const bits = [];
      if (src.ROBUX) bits.push('R$ ' + bigNum(src.ROBUX));
      if (src.USD) bits.push('$' + Number(src.USD).toLocaleString(undefined, { maximumFractionDigits: 2 }));
      return bits.length ? bits.join(' + ') : null;
    }

    function taskState(t) {
      if (t.status === 'done') {
        const late = t.due_at && t.completed_at && new Date(t.completed_at) > new Date(t.due_at);
        return { cls: late ? 'warn' : 'ok', label: late ? 'Done late' : 'Done on time' };
      }
      if (t.status === 'cancelled') return { cls: '', label: 'Cancelled' };
      if (!t.due_at) return { cls: '', label: 'No deadline' };
      const diff = new Date(t.due_at).getTime() - Date.now();
      if (diff < 0) return { cls: 'ban', label: 'Overdue ' + relTime(t.due_at) };
      if (diff < 3 * 24 * 60 * 60 * 1000) return { cls: 'warn', label: 'Due ' + relTime(t.due_at) };
      return { cls: '', label: 'Due ' + relTime(t.due_at) };
    }

    function renderTaskPage(taskId) {
      if (!authReady) { app.innerHTML = topbar(); return; }
      if (!isHrAuthed) { renderHrGate(); return; }

      const myGen = renderGen;
      let data = null;
      let loading = true;
      let loadError = null;
      let busy = false;

      function money(task) {
        if (!task.payment) return null;
        return task.currency === 'USD'
          ? '$' + Number(task.payment).toFixed(2)
          : 'R$ ' + Number(task.payment).toLocaleString();
      }

      function paint() {
        if (myGen !== renderGen) return;
        let body;
        if (loading) body = `<div class="dash-loading">Loading task...</div>`;
        else if (loadError) body = `<div class="dash-empty"><h3>Could not open this task</h3><p>${esc(loadError)}</p><a class="btn btn-ghost btn-sm" href="#/teams">Back to teams</a></div>`;
        else {
          const t = data.task;
          const st = taskState(t);
          const done = t.status === 'done';
          const others = (data.sharedWith || []).filter(x => String(x.id) !== String(t.id));
          body = `
      <div class="task-page">
        ${data.game && data.game.thumbnail_url ? `<img src="${esc(data.game.thumbnail_url)}" alt="${esc(data.game.name)}" class="task-banner">` : ''}
        <div class="task-page-head">
          ${data.game && data.game.icon_url
              ? `<img src="${esc(data.game.icon_url)}" alt="" class="task-game-icon">`
              : `<div class="task-game-icon placeholder" aria-hidden="true"></div>`}
          <div style="flex:1;min-width:0;">
            <div class="hint">${data.team ? `<span class="pp-dot" style="background:${safeColor(data.team.color, 'var(--muted)')};display:inline-block;margin-right:6px;"></span>${esc(data.team.name)}` : 'Task'}${data.game ? ` &middot; ${esc(data.game.name)}` : ''}</div>
            <h1 style="margin:4px 0 8px;">${esc(t.title)}</h1>
            <div class="pp-chips">
              <span class="pp-state ${st.cls}">${esc(st.label)}</span>
              ${t.repeat_every ? `<span class="pp-tag">Repeats ${esc({ weekly: 'weekly', fortnightly: 'every 2 weeks', monthly: 'monthly' }[t.repeat_every] || t.repeat_every)}</span>` : ''}
              ${t.batch_id ? `<span class="pp-tag">Given to everyone</span>` : ''}
            </div>
          </div>
        </div>

        <div class="task-facts">
          <div><span class="hint">Deadline</span><b>${t.due_at ? esc(fmtDateTime(t.due_at)) : 'No deadline'}</b></div>
          <div><span class="hint">Pays</span><b>${money(t) ? esc(money(t)) : 'Nothing set'}</b></div>
          <div><span class="hint">Assigned to</span><b>${t.assigned_to_user_id ? userLink(t.assigned_to_user_id, t.assigned_to_username) : 'Nobody'}</b></div>
          <div><span class="hint">${done ? 'Finished' : 'Set by'}</span><b>${done ? `${esc(t.completed_by || 'someone')}, ${esc(relTime(t.completed_at))}` : esc(t.created_by || 'unknown')}</b></div>
        </div>

        ${t.details ? `<div class="panel" style="margin:0 0 18px;"><h3 style="margin:0 0 8px;font-size:15px;">Details</h3><p class="task-details" style="margin:0;">${esc(t.details)}</p></div>` : ''}

        ${t.status === 'review' ? `<div class="filter-notice" style="margin-bottom:18px;">Waiting on a producer to review this. ${t.submitted_by ? esc(t.submitted_by) + ' sent it' : 'It was sent'}${t.submitted_at ? ' ' + esc(relTime(t.submitted_at)) : ''}.</div>` : ''}
        ${t.status === 'open' && t.review_note ? `<div class="pp-banner neutral" style="margin-bottom:18px;"><strong>Sent back:</strong> ${esc(t.review_note)}</div>` : ''}
        ${t.status === 'done' && t.approved_by ? `<div class="confirm-box" style="margin-bottom:18px;"><div class="icon">&#10003;</div><div class="txt"><strong>Approved by ${esc(t.approved_by)}</strong><span>${t.review_note ? esc(t.review_note) : 'Signed off, so it can be paid.'}</span></div></div>` : ''}

        ${money(t) ? (t.payment_request_id
              ? `<div class="confirm-box" style="margin-bottom:18px;"><div class="icon">&#10003;</div><div class="txt"><strong>Payment logged</strong><span>${esc(money(t))} for ${esc(t.assigned_to_username || 'them')}. Follow it on the payments dashboard.</span></div></div>`
              : done
                ? `<div class="filter-notice" style="margin-bottom:18px;">Finished and worth ${esc(money(t))}.${data.canManage && canSubmitRequests() ? '' : ' A lead can log the payment from here.'}</div>`
                : `<div class="filter-notice" style="margin-bottom:18px;">Pays ${esc(money(t))} once it's finished and a lead logs it.</div>`) : ''}

        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${data.isMine && !done && t.status !== 'review' && t.status !== 'cancelled' ? `<button type="button" class="btn btn-primary btn-sm" id="taskSubmitBtn" ${busy ? 'disabled' : ''}>${busy ? 'Sending...' : 'Mark it done'}</button>` : ''}
          ${t.status === 'review' && data.canManage && !data.isMine ? `<button type="button" class="btn btn-ok btn-sm" id="taskApproveBtn" ${busy ? 'disabled' : ''}>${busy ? 'Working...' : 'Approve it'}</button><button type="button" class="btn btn-ghost btn-sm" id="taskSendBackBtn" ${busy ? 'disabled' : ''}>Send it back</button>` : ''}
          ${done && data.canManage ? `<button type="button" class="btn btn-ghost btn-sm" id="taskToggleBtn" ${busy ? 'disabled' : ''}>${busy ? 'Saving...' : 'Reopen this task'}</button>` : ''}
          ${done && t.payment && !t.payment_request_id && data.canManage && canSubmitRequests()
              ? `<button type="button" class="btn btn-ok btn-sm" id="taskPayBtn" ${busy ? 'disabled' : ''}>${busy ? 'Working...' : `Pay ${esc(money(t))}`}</button>` : ''}
          ${data.team ? `<a class="btn btn-ghost btn-sm" href="#/teams?team=${encodeURIComponent(data.team.id)}&tab=deadlines">All ${esc(data.team.name)} deadlines</a>` : ''}
          ${data.game && data.game.roblox_place_id ? `<a class="btn btn-ghost btn-sm" href="https://www.roblox.com/games/${esc(data.game.roblox_place_id)}" target="_blank" rel="noopener">Open the game</a>` : ''}
        </div>

        ${others.length ? `
        <div class="panel" style="margin:20px 0 0;">
          <h3 style="margin:0 0 10px;font-size:15px;">Everyone else on this task</h3>
          <div class="task-people" style="border:none;padding:0;margin:0;">
            ${others.map(o => `<div class="task-person">
              ${avatarImg(o.assigned_to_user_id, '', 'style="width:22px;height:22px;border-radius:50%;"')}
              <span style="flex:1;min-width:0;">${userLink(o.assigned_to_user_id, o.assigned_to_username)}</span>
              <span class="pp-state ${o.status === 'done' ? 'ok' : ''}">${o.status === 'done' ? 'Done' : 'Still open'}</span>
            </div>`).join('')}
          </div>
        </div>` : ''}
      </div>`;
        }

        app.innerHTML = `${topbar()}<div class="dash-shell">${body}</div>`;
        wireTopbarSignOut();
        const payBtn = document.getElementById('taskPayBtn');
        if (payBtn) payBtn.addEventListener('click', async () => {
          const t = data.task;
          if (!(await askConfirm(`Log ${money(t)} for ${t.assigned_to_username} as a pending payment?\n\nIt'll show up on the payments dashboard to be paid out from there.`))) return;
          busy = true; paint();
          try {
            const r = await callHrData('pay_team_task', { id: t.id });
            toast(`Payment logged as pending (${r.requestId}).`);
            busy = false;
            await load();
          } catch (e) {
            busy = false;
            toast(e.code === 'task_not_done' ? 'Mark the task done first.' : (e.message || 'Could not log that payment.'), 'err');
            paint();
          }
        });
        const toggle = document.getElementById('taskToggleBtn');
        if (toggle) toggle.addEventListener('click', async () => {
          busy = true; paint();
          try {
            await callHrData('set_team_task_status', { id: data.task.id, status: 'open' });
            toast('Reopened');
            busy = false;
            await load();
          } catch (e) {
            busy = false;
            toast(e.message || 'Could not update the task.', 'err');
            paint();
          }
        });

        const submitBtn = document.getElementById('taskSubmitBtn');
        if (submitBtn) submitBtn.addEventListener('click', async () => {
          busy = true; paint();
          try {
            await callHrData('submit_task_for_review', { id: data.task.id });
            toast('Sent to your producer to review');
            busy = false;
            await load();
          } catch (e) {
            busy = false;
            toast(e.message || 'Could not send that for review.', 'err');
            paint();
          }
        });

        const approveBtn = document.getElementById('taskApproveBtn');
        if (approveBtn) approveBtn.addEventListener('click', async () => {
          busy = true; paint();
          try {
            await callHrData('decide_task_review', { id: data.task.id, decision: 'approve' });
            toast('Approved and queued for payment');
            busy = false;
            await load();
          } catch (e) {
            busy = false;
            toast(e.message || 'Could not approve that.', 'err');
            paint();
          }
        });

        const sendBackBtn = document.getElementById('taskSendBackBtn');
        if (sendBackBtn) sendBackBtn.addEventListener('click', async () => {
          const note = await askForText({
            title: 'Send this back',
            hint: 'They see this, so say what needs changing.',
            placeholder: 'For example: the doors clip through the wall on the left side.',
            confirmLabel: 'Send it back',
            required: true,
            requiredMessage: 'Write what needs changing.'
          });
          if (note === null) return;
          busy = true; paint();
          try {
            await callHrData('decide_task_review', { id: data.task.id, decision: 'send_back', note });
            toast('Sent back with your notes');
            busy = false;
            await load();
          } catch (e) {
            busy = false;
            toast(e.message || 'Could not send that back.', 'err');
            paint();
          }
        });
      }

      async function load() {
        loading = !data;
        loadError = null;
        paint();
        try {
          const json = await callHrData('get_task', { id: taskId });
          data = json.data;
        } catch (e) {
          loadError = e.code === 'task_not_found' ? "This task no longer exists. It may have been finished and cleared, or deleted."
            : e.code === 'missing_permission' ? "This task belongs to someone else, and you don't have access to team tasks."
              : (e.message || 'Could not load this task.');
        }
        if (myGen !== renderGen) return;
        loading = false;
        paint();
      }

      load();
    }

    function renderClaimPage() {
      if (!authReady) { app.innerHTML = topbar(); return; }
      if (!isHrAuthed) { renderHrGate(); return; }

      const myGen = renderGen;
      let claims = [];
      let loading = true;
      let loadError = null;
      let busy = false;
      let formOpen = false;

      function money(r) {
        return r.currency === 'USD' ? `$${Number(r.payment).toFixed(2)}` : `R$ ${Number(r.payment).toLocaleString()}`;
      }

      function stateChip(r) {
        if (r.status === 'proposed') return '<span class="pp-state warn">Waiting on a lead</span>';
        if (r.status === 'rejected') return '<span class="pp-state ban">Turned down</span>';
        if (r.status === 'paid' || r.paid) return '<span class="pp-state ok">Paid</span>';
        return '<span class="pp-state">Approved, waiting to be paid</span>';
      }

      function paint() {
        if (myGen !== renderGen) return;
        const open = claims.filter(c => c.status === 'proposed');
        const decided = claims.filter(c => c.status !== 'proposed');
        app.innerHTML = `
    ${topbar()}
    <div class="dash-shell">
      <div class="dash-head">
        <div>
          <h1 style="margin-bottom:4px;">Request a payment</h1>
          <p class="sub">Ask to be paid for work you've finished. A lead checks it, and can adjust the amount before approving.</p>
        </div>
        <div class="dash-toolbar">
          <button type="button" class="btn ${formOpen ? 'btn-ghost' : 'btn-primary'} btn-sm" id="claimToggle">${formOpen ? 'Cancel' : 'New request'}</button>
        </div>
      </div>

      ${formOpen ? `
      <div class="panel" style="margin:0 0 20px;">
        <div class="field"><label for="claimTask">What did you do</label>
          <input type="text" id="claimTask" placeholder="e.g. Built the winter lobby"></div>
        <div class="team-form-row">
          <div class="field"><label for="claimAmount">Amount</label>
            <input type="number" id="claimAmount" min="1" step="1" placeholder="e.g. 5000"></div>
          <div class="field"><label for="claimCurrency">Paid in</label>
            <select id="claimCurrency">${currencyEnabled('ROBUX') ? '<option value="ROBUX">Robux</option>' : ''}${currencyEnabled('USD') ? '<option value="USD">USD</option>' : ''}</select></div>
          <div class="field"><label for="claimGame">Game <span class="hint">(optional)</span></label>
            <input type="text" id="claimGame" placeholder="e.g. Obby Rush"></div>
        </div>
        <div class="field"><label for="claimNote">Details <span class="hint">(what you did, links, anything that helps)</span></label>
          <textarea id="claimNote" rows="3" placeholder="A couple of lines is plenty"></textarea></div>
        <button type="button" class="btn btn-primary btn-sm" id="claimSubmit" ${busy ? 'disabled' : ''}>${busy ? 'Sending...' : 'Send request'}</button>
      </div>` : ''}

      ${loading ? `<div class="dash-loading">Loading your requests...</div>`
            : loadError ? `<div class="dash-empty"><h3>Could not load your requests</h3><p>${esc(loadError)}</p></div>`
              : `
      ${open.length ? `
      <h2 class="sec-title" style="font-size:15px;">Waiting on a lead (${open.length})</h2>
      <div class="task-list" style="margin-bottom:22px;">
        ${open.map(r => `
        <div class="task-row">
          <div style="flex:1;min-width:0;">
            <div class="task-title">${esc(r.taskName || r.task_name || 'Work')}</div>
            <div class="task-meta">
              ${stateChip(r)}
              <span class="pp-tag">${esc(money(r))}</span>
              ${r.game ? `<span>${esc(r.game)}</span>` : ''}
              <span>${esc(relTime(r.created_at || r.createdAt))}</span>
            </div>
            ${(r.workRaw || r.work_raw) ? `<div class="task-details">${esc(r.workRaw || r.work_raw)}</div>` : ''}
          </div>
          <button type="button" class="btn btn-ghost btn-sm" data-withdraw="${esc(r.id)}">Withdraw</button>
        </div>`).join('')}
      </div>` : `<div class="dash-empty"><h3>Nothing waiting</h3><p>Press New request when you've finished something that should be paid.</p></div>`}

      ${decided.length ? `
      <h2 class="sec-title" style="font-size:15px;">Decided (${decided.length})</h2>
      <div class="task-list">
        ${decided.map(r => `
        <div class="task-row">
          <div style="flex:1;min-width:0;">
            <div class="task-title">${esc(r.taskName || r.task_name || 'Work')}</div>
            <div class="task-meta">
              ${stateChip(r)}
              <span class="pp-tag">${esc(money(r))}</span>
              ${r.statusNote || r.status_note ? `<span>${esc(r.statusNote || r.status_note)}</span>` : ''}
              <span>${esc(relTime(r.created_at || r.createdAt))}</span>
            </div>
          </div>
        </div>`).join('')}
      </div>` : ''}`}
    </div>`;

        wireTopbarSignOut();
        document.getElementById('claimToggle').addEventListener('click', () => { formOpen = !formOpen; paint(); const t = document.getElementById('claimTask'); if (t) t.focus(); });
        const submit = document.getElementById('claimSubmit');
        if (submit) submit.addEventListener('click', async () => {
          const taskName = document.getElementById('claimTask').value.trim();
          const payment = document.getElementById('claimAmount').value;
          const currency = document.getElementById('claimCurrency').value;
          const game = document.getElementById('claimGame').value.trim();
          const note = document.getElementById('claimNote').value.trim();
          if (!taskName) { toast('Say what you did first.', 'err'); return; }
          if (!payment || Number(payment) <= 0) { toast('Put in how much you are asking for.', 'err'); return; }
          busy = true; paint();
          try {
            await callHrData('submit_claim', { taskName, payment, currency, game, note });
            busy = false; formOpen = false;
            toast('Sent. A lead will look at it.');
            await load();
          } catch (e) {
            busy = false;
            toast(e.code === 'too_many_open_claims' ? 'You already have 10 requests waiting. Wait for those first.' : (e.message || 'Could not send that.'), 'err');
            paint();
          }
        });
        document.querySelectorAll('[data-withdraw]').forEach(el => el.addEventListener('click', async () => {
          if (!(await askConfirm('Withdraw this request?'))) return;
          try {
            await callHrData('withdraw_claim', { id: el.dataset.withdraw });
            toast('Withdrawn');
            await load();
          } catch (e) { toast(e.message || 'Could not withdraw it.', 'err'); }
        }));
      }

      async function load() {
        loadError = null;
        try {
          const json = await callHrData('list_my_claims');
          claims = json.data || [];
        } catch (e) {
          loadError = e.message || 'Could not load your requests.';
        }
        if (myGen !== renderGen) return;
        loading = false;
        paint();
      }

      paint();
      load();
    }

    function renderTeams() {
      if (!authReady) { app.innerHTML = topbar(); return; }
      if (!isHrAuthed) { renderHrGate(); return; }
      if (!canSeeTeams()) { window.location.hash = '#/'; return; }

      const myGen = renderGen;
      const query = parseHashQuery();
      let teamId = query.get('team') || null;
      let tab = ['members', 'games', 'deadlines'].includes(query.get('tab')) ? query.get('tab') : 'members';
      let overview = null;
      let detail = null;
      let org = null;
      const ORG_PREVIEW = 6;
      let orgSearch = '';
      let orgGroupBy = 'skill';
      let orgCompact = false;
      let orgOpenTeams = new Set();
      let orgOpenGroups = new Set();
      let view = ['org', 'games'].includes(query.get('view')) ? query.get('view') : 'teams';
      let gameId = query.get('game') || null;
      let gamesList = null;
      let gameDetail = null;
      if (gameId) view = 'games';
      let loading = true;
      let loadError = null;
      let busy = false;
      let taskDraft = null;
      let linkingGameId = null;
      let chartMetric = 'playing';
      let addPeopleOpen = false;
      let addPeopleList = null;
      let addPeopleLoading = false;
      let addPeopleError = null;
      let addPeopleSearch = '';
      let addPeopleChosen = new Set();
      let addPeopleSkillset = '';
      let board = null;
      let boardError = null;
      let boardCard = null;
      let boardBusy = false;
      let boardDragId = null;
      let boardDragFromList = null;
      let boardListDragId = null;
      let boardSearch = '';
      let boardFilter = 'all';
      let historyChart = null;
      let openTaskBatches = new Set();

      function goGame(nextGameId, nextTab) {
        gameId = nextGameId;
        gameDetail = null;
        tab = nextTab || 'members';
        view = 'games';
        history.replaceState(null, '', gameId ? `#/teams?view=games&game=${encodeURIComponent(gameId)}&tab=${tab}` : '#/teams?view=games');
        load();
      }

      function go(nextTeamId, nextTab) {
        if (String(nextTeamId || '') !== String(teamId || '')) {
          board = null;
          boardError = null;
          boardCard = null;
          boardBusy = false;
          boardDragId = null;
          boardDragFromList = null;
          boardListDragId = null;
          boardSearch = '';
          boardFilter = 'all';
        }
        teamId = nextTeamId;
        tab = nextTab || 'members';
        const hash = teamId ? `#/teams?team=${encodeURIComponent(teamId)}&tab=${tab}` : '#/teams';
        history.replaceState(null, '', hash);
        load();
      }

      function orgPersonCard(p, tagline, opts) {
        const o = opts || {};
        const cls = ['org-person', o.lead ? 'is-lead' : '', orgCompact && !o.lead ? 'compact' : ''].filter(Boolean).join(' ');
        return `
          <div class="${cls}" data-user-link data-user-id="${esc(p.robloxUserId)}" data-username="${esc(p.robloxUsername || '')}" role="button" tabindex="0" title="${esc(p.robloxUsername || '')}">
            ${avatarImg(p.robloxUserId, '', 'class="org-avatar"')}
            <div style="min-width:0;">
              <div class="org-name">${esc(p.robloxUsername || 'Unknown')}</div>
              ${orgCompact && !o.lead ? '' : `<div class="org-role">${tagline || esc((p.roles || [])[0] || 'No role')}</div>`}
            </div>
          </div>`;
      }

      function orgMatches(p) {
        const q = orgSearch.trim().toLowerCase();
        if (!q) return true;
        return (p.robloxUsername || '').toLowerCase().includes(q) ||
          String(p.robloxUserId) === q ||
          (p.roles || []).some(r => r.toLowerCase().includes(q)) ||
          (p.skillset && p.skillset.name.toLowerCase().includes(q));
      }

      function groupMembers(members) {
        const groups = new Map();
        members.forEach(m => {
          const key = orgGroupBy === 'role' ? ((m.roles || [])[0] || 'No role') : (m.skillset ? m.skillset.name : 'No skill set');
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(m);
        });
        return [...groups.entries()]
          .map(([name, people]) => ({ name, people: people.sort((a, b) => b.hierarchy - a.hierarchy || (a.robloxUsername || '').localeCompare(b.robloxUsername || '')) }))
          .sort((a, b) => b.people.length - a.people.length || a.name.localeCompare(b.name));
      }

      function orgGroupHtml(teamKey, group) {
        const key = teamKey + ':' + group.name;
        const open = orgOpenGroups.has(key) || !!orgSearch.trim() || group.people.length <= ORG_PREVIEW;
        const shown = open ? group.people : group.people.slice(0, ORG_PREVIEW);
        const hidden = group.people.length - shown.length;
        return `
          <div class="org-group">
            <button type="button" class="org-group-head" data-org-group="${esc(key)}" aria-expanded="${open}">
              <span class="org-caret ${open ? 'open' : ''}" aria-hidden="true">&#9656;</span>
              <span class="org-group-name">${esc(group.name)}</span>
              <span class="org-count">${group.people.length}</span>
            </button>
            <div class="org-group-body">
              ${shown.map(m => orgPersonCard(m, [
          m.skillset && orgGroupBy !== 'skill' ? esc(m.skillset.name) : null,
          esc((m.roles || [])[0] || '')
        ].filter(Boolean).join(' &middot; '))).join('')}
              ${hidden > 0 ? `<button type="button" class="org-more" data-org-group="${esc(key)}">Show ${hidden} more</button>` : ''}
            </div>
          </div>`;
      }

      function orgTeamHtml(t) {
        const members = t.members.filter(orgMatches);
        const lead = t.members.find(m => String(m.robloxUserId) === String(t.lead)) || null;
        const rest = members.filter(m => !lead || String(m.robloxUserId) !== String(lead.robloxUserId));
        const open = orgOpenTeams.has(String(t.id)) || !!orgSearch.trim();
        const leadShown = lead && (orgMatches(lead) || (!orgSearch.trim() && rest.length));
        return `
          <div class="org-team ${open ? 'open' : ''}" style="--team-color:${safeColor(t.color, 'var(--muted)')};">
            <button type="button" class="org-team-head" data-org-team="${esc(t.id)}" aria-expanded="${open}">
              <span class="org-caret ${open ? 'open' : ''}" aria-hidden="true">&#9656;</span>
              <span style="flex:1;min-width:0;">
                <span class="org-team-name">${esc(t.name)}</span>
                <span class="org-team-sub">${esc(t.members.length)} ${t.members.length === 1 ? 'person' : 'people'}${t.games.length ? ` &middot; ${esc(t.games.join(', '))}` : ''}</span>
              </span>
              ${!open ? `<span class="org-facepile">${t.members.slice(0, 5).map(m => avatarImg(m.robloxUserId, m.robloxUsername || '', 'class="org-face"')).join('')}${t.members.length > 5 ? `<span class="org-face more">+${t.members.length - 5}</span>` : ''}</span>` : ''}
            </button>
            ${open ? `
            <div class="org-team-body">
              ${leadShown ? `<div class="org-lead-wrap">${orgPersonCard(lead, 'Team lead' + ((lead.roles || [])[0] ? ' &middot; ' + esc(lead.roles[0]) : ''), { lead: true })}</div>` : ''}
              ${rest.length ? groupMembers(rest).map(g => orgGroupHtml(String(t.id), g)).join('')
              : `<p class="hint" style="margin:6px 0 0;">${orgSearch.trim() ? 'Nobody here matches your search.' : 'Only the lead so far.'}</p>`}
            </div>` : ''}
          </div>`;
      }

      function orgHtml() {
        if (!org) return `<div class="dash-loading">Building the chart...</div>`;
        const q = orgSearch.trim();
        const leadership = org.leadership.filter(orgMatches);
        const teams = org.teams
          .map(t => ({ t, hits: t.members.filter(orgMatches).length }))
          .filter(x => q ? x.hits > 0 : x.t.members.length > 0)
          .map(x => x.t);
        const unassigned = org.unassigned.filter(orgMatches);
        const emptyTeams = q ? [] : org.teams.filter(t => !t.members.length);
        const matches = leadership.length + teams.reduce((n, t) => n + t.members.filter(orgMatches).length, 0) + unassigned.length;

        return `
        <div class="org-toolbar">
          <div class="search-input-wrap" style="flex:1 1 240px;">
            <input type="text" id="orgSearchInput" placeholder="Find a person, role or skill" value="${esc(orgSearch)}" aria-label="Search the chart">
          </div>
          <div class="seg org-seg" role="tablist" aria-label="Group people by">
            ${[['skill', 'By skill'], ['role', 'By role']].map(([v, l]) => `<button type="button" role="tab" aria-selected="${orgGroupBy === v}" class="${orgGroupBy === v ? 'on' : ''}" data-org-group-by="${v}">${l}</button>`).join('')}
          </div>
          <button type="button" class="btn btn-ghost btn-sm" id="orgCompactBtn" aria-pressed="${orgCompact}">${orgCompact ? 'Show details' : 'Compact'}</button>
          <button type="button" class="btn btn-ghost btn-sm" id="orgExpandBtn">${orgOpenTeams.size ? 'Collapse all' : 'Expand all'}</button>
        </div>
        <p class="sub" style="margin:0 0 18px;">${q
            ? `${matches} ${matches === 1 ? 'person matches' : 'people match'} "${esc(q)}".`
            : `${esc(org.totals.people)} people across ${esc(org.totals.teams)} teams, ${esc(org.totals.onATeam)} of them on a team. Built from teams, skills and roles as they are right now.`}</p>
        <div class="org-chart">
          ${leadership.length ? `
          <div class="org-tier">
            <div class="org-tier-label">Leadership</div>
            <div class="org-row">${leadership.map(p => orgPersonCard(p, null, { lead: true })).join('')}</div>
          </div>
          <div class="org-connector" aria-hidden="true"></div>` : ''}
          ${teams.length ? `<div class="org-teams">${teams.map(orgTeamHtml).join('')}</div>`
            : `<div class="dash-empty"><h3>${q ? 'No teams match' : 'Nobody is on a team yet'}</h3><p>${q ? 'Try a different name, role or skill.' : 'Add people to teams from the Staff page and they will appear here.'}</p></div>`}
          ${emptyTeams.length ? `<p class="hint" style="margin-top:14px;">Teams with nobody on them: ${emptyTeams.map(t => esc(t.name)).join(', ')}.</p>` : ''}
          ${unassigned.length ? `
          <div class="org-team org-team-loose ${orgOpenTeams.has('none') || q ? 'open' : ''}" style="--team-color:var(--muted);margin-top:22px;">
            <button type="button" class="org-team-head" data-org-team="none" aria-expanded="${orgOpenTeams.has('none') || !!q}">
              <span class="org-caret ${orgOpenTeams.has('none') || q ? 'open' : ''}" aria-hidden="true">&#9656;</span>
              <span style="flex:1;min-width:0;">
                <span class="org-team-name">Not on a team</span>
                <span class="org-team-sub">${esc(unassigned.length)} ${unassigned.length === 1 ? 'person' : 'people'}</span>
              </span>
              ${!(orgOpenTeams.has('none') || q) ? `<span class="org-facepile">${unassigned.slice(0, 5).map(m => avatarImg(m.robloxUserId, '', 'class="org-face"')).join('')}${unassigned.length > 5 ? `<span class="org-face more">+${unassigned.length - 5}</span>` : ''}</span>` : ''}
            </button>
            ${orgOpenTeams.has('none') || q ? `<div class="org-team-body">${groupMembers(unassigned).map(g => orgGroupHtml('none', g)).join('')}</div>` : ''}
          </div>` : ''}
        </div>`;
      }

      function overviewHtml() {
        if (!overview || !overview.length) {
          return `<div class="dash-empty"><h3>No teams yet</h3><p>Create teams in Manage, under Teams &amp; skills.</p></div>`;
        }
        return `<div class="team-grid">${overview.map(t => {
          const s = t.tasks;
          return `
          <button type="button" class="team-card" data-open-team="${esc(t.id)}">
            <div class="team-card-head">
              <span class="pp-dot" style="background:${safeColor(t.color, 'var(--muted)')};"></span>
              <h3>${esc(t.name)}</h3>
            </div>
            <div class="team-card-stats">
              <div><b>${esc(t.memberCount)}</b><span>Members</span></div>
              <div><b>${esc(t.games.length)}</b><span>Games</span></div>
              <div><b>${s.onTimeRate == null ? '-' : esc(s.onTimeRate) + '%'}</b><span>On time</span></div>
              <div><b class="${s.overdue ? 'danger' : ''}">${esc(s.overdue)}</b><span>Overdue</span></div>
            </div>
            <div class="team-card-foot">
              ${t.stats.trackedGames
              ? `<span>${esc(bigNum(t.stats.playing))} playing now</span><span>${esc(bigNum(t.stats.visits7d))} visits this week</span>`
              : `<span class="hint">No games linked to Roblox yet</span>`}
            </div>
          </button>`;
        }).join('')}</div>`;
      }

      function gamesListHtml() {
        if (!gamesList) return `<div class="dash-loading">Loading games...</div>`;
        if (!gamesList.length) return `<div class="dash-empty"><h3>No games yet</h3><p>Add games in Manage, under Games &amp; rate, then assign them to a team.</p></div>`;
        return `<div class="team-grid">${gamesList.map(g => `
          <button type="button" class="team-card" data-open-game="${esc(g.id)}">
            <div class="team-card-head">
              ${g.iconUrl ? `<img src="${esc(g.iconUrl)}" alt="" class="game-icon" style="width:36px;height:36px;border-radius:8px;">` : `<span class="pp-dot" style="background:var(--muted);"></span>`}
              <h3>${esc(g.name)}</h3>
            </div>
            <div class="team-card-stats">
              <div><b>${esc(g.memberCount)}</b><span>People</span></div>
              <div><b>${esc(g.teams.length)}</b><span>Teams</span></div>
              <div><b>${g.tasks.onTimeRate == null ? '-' : esc(g.tasks.onTimeRate) + '%'}</b><span>On time</span></div>
              <div><b class="${g.tasks.overdue ? 'danger' : ''}">${esc(g.tasks.overdue)}</b><span>Overdue</span></div>
            </div>
            <div class="team-card-foot">
              ${g.stats
            ? `<span>${esc(bigNum(g.stats.playing))} playing now</span><span>${g.stats.visits7d == null ? 'New' : esc(bigNum(g.stats.visits7d)) + ' visits this week'}</span>`
            : `<span class="hint">${g.universeId ? 'Waiting for the first reading' : 'Not linked to Roblox yet'}</span>`}
            </div>
          </button>`).join('')}</div>`;
      }

      function gameMembersHtml() {
        const members = gameDetail.members.slice().sort((a, b) => (b.openTasks - a.openTasks) || (a.robloxUsername || '').localeCompare(b.robloxUsername || ''));
        if (!members.length) return `<div class="dash-empty"><h3>Nobody works on this game yet</h3><p>Assign it to a team and everyone on that team shows up here.</p></div>`;
        return `<div class="table-scroll"><table class="req-table">
          <thead><tr><th>Person</th><th>Team</th><th>Skill</th><th>Open tasks</th><th>Last active</th></tr></thead>
          <tbody>
            ${members.map(m => `
            <tr>
              <td class="name-cell" style="display:flex;gap:10px;align-items:center;">
                ${avatarImg(m.robloxUserId, '', 'style="width:28px;height:28px;border-radius:50%;"')}
                <span>${userLink(m.robloxUserId, m.robloxUsername)}
                  <span style="display:block;color:var(--muted);font-size:12px;">${(m.roles || []).join(', ') || 'No roles'}</span>
                </span>
              </td>
              <td>${m.team ? `<span class="pp-tag">${esc(m.team.name)}</span>` : '<span class="hint">None</span>'}</td>
              <td>${m.skillset ? esc(m.skillset.name) : '<span class="hint">Not set</span>'}</td>
              <td>${m.openTasks ? esc(m.openTasks) : '<span class="hint">None</span>'}</td>
              <td style="white-space:nowrap;color:var(--ink-soft);">${m.lastActive ? esc(shortAgo(m.lastActive)) : '-'}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>`;
      }

      function gameAnalyticsHtml() {
        const s = gameDetail.stats;
        const g = gameDetail.game;
        if (!g.universeId) return `<div class="dash-empty"><h3>Not linked to Roblox</h3><p>Open the team that owns this game and press "Link to Roblox" to start tracking players, visits and growth.</p></div>`;
        if (!s) return `<div class="dash-empty"><h3>No readings yet</h3><p>The first numbers arrive within a few hours, or press Refresh now.</p></div>`;
        return `
          <div class="stat-strip team-detail-strip">
            <div class="strip-card"><div class="strip-label">Playing now</div><div class="strip-value">${esc(bigNum(s.latest.playing))}</div></div>
            <div class="strip-card"><div class="strip-label">Visits</div><div class="strip-value">${esc(bigNum(s.latest.visits))}</div><div class="hint">${s.visitsLast7d == null ? 'Growth builds up from now' : esc(bigNum(s.visitsLast7d)) + ' this week'}</div></div>
            <div class="strip-card"><div class="strip-label">Favourites</div><div class="strip-value">${esc(bigNum(s.latest.favorites))}</div></div>
            <div class="strip-card"><div class="strip-label">Liked</div><div class="strip-value">${s.latest.likes + s.latest.dislikes ? Math.round(s.latest.likes / (s.latest.likes + s.latest.dislikes) * 100) + '%' : '-'}</div></div>
          </div>
          <div class="panel" style="margin:0 0 18px;">
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:12px;">
              <h3 style="margin:0;font-size:15px;flex:1;">History</h3>
              <div class="seg org-seg" role="tablist" aria-label="Metric">
                ${[['playing', 'Players online'], ['visits', 'Visits'], ['favorites', 'Favourites']].map(([v, l]) =>
          `<button type="button" role="tab" aria-selected="${chartMetric === v}" class="${chartMetric === v ? 'on' : ''}" data-chart-metric="${v}">${l}</button>`).join('')}
              </div>
            </div>
            <div style="position:relative;height:260px;"><canvas id="gameHistoryChart"></canvas></div>
          </div>
          <div class="panel" style="margin:0;">
            <h3 style="margin:0 0 10px;font-size:15px;">Money</h3>
            <div class="game-growth" style="border:none;padding:0;">
              <div><span class="hint">Paid out for this game</span><b>${esc(spendText(gameDetail.spend) || 'Nothing yet')}</b></div>
              <div><span class="hint">This month</span><b>${esc(spendText(gameDetail.spend, true) || 'Nothing yet')}</b></div>
              ${gameDetail.spend.ROBUX && s.visitsLast7d ? `<div><span class="hint">Robux per 1K visits this week</span><b>${esc((gameDetail.spend.ROBUX / (s.visitsLast7d / 1000)).toFixed(1))}</b></div>` : ''}
            </div>
          </div>`;
      }

      function addPeopleHtml() {
        const q = addPeopleSearch.trim().toLowerCase();
        const all = addPeopleList || [];
        const available = all.filter(p => !p.onThisTeam);
        const shown = available.filter(p => !q
          || (p.robloxUsername || '').toLowerCase().includes(q)
          || String(p.robloxUserId) === q
          || (p.roles || []).some(r => r.toLowerCase().includes(q))
          || (p.teams || []).some(t => t.toLowerCase().includes(q)));
        return `
        <div class="pp-scrim" id="addPeopleScrim">
          <aside class="pp" role="dialog" aria-modal="true" aria-labelledby="addPeopleTitle">
            <div class="pp-head">
              <div style="flex:1;min-width:0;">
                <h2 id="addPeopleTitle">Add people to ${esc(detail.team.name)}</h2>
                <div class="pp-sub">Tick everyone you want on the team, then add them in one go.</div>
              </div>
              <button type="button" class="modal-close" id="addPeopleClose" aria-label="Close">&times;</button>
            </div>
            <div style="padding:14px 22px 0;">
              <div class="search-input-wrap" style="margin-bottom:10px;">
                <input type="text" id="addPeopleSearchInput" placeholder="Search name, role or team" value="${esc(addPeopleSearch)}" aria-label="Search people">
              </div>
              ${(catalog.skillsets || []).length ? `
              <div class="field" style="margin-bottom:6px;">
                <label for="addPeopleSkill">Give them all a skill <span class="hint">(optional)</span></label>
                <select id="addPeopleSkill" class="pp-select">
                  <option value="">No specific skill</option>
                  ${(catalog.skillsets || []).map(k => `<option value="${esc(k.id)}" ${String(addPeopleSkillset) === String(k.id) ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}
                </select>
              </div>` : ''}
            </div>
            <div class="pp-body">
              ${addPeopleLoading && !addPeopleList ? `<div class="dash-loading">Loading people...</div>` : ''}
              ${addPeopleError ? `<div class="error-box"><span>${esc(addPeopleError)}</span></div>` : ''}
              ${addPeopleList && !available.length ? `<p class="hint" style="margin:0;">Everyone is already on this team.</p>` : ''}
              ${addPeopleList && available.length && !shown.length ? `<p class="hint" style="margin:0;">Nobody matches "${esc(addPeopleSearch.trim())}".</p>` : ''}
              ${shown.length ? `
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <span class="hint">${esc(shown.length)} of ${esc(available.length)} shown</span>
                <button type="button" class="pp-linkbtn" id="addPeopleToggleAll">${shown.every(p => addPeopleChosen.has(String(p.robloxUserId))) ? 'Clear these' : 'Select these'}</button>
              </div>
              <div class="pp-list">
                ${shown.map(p => `
                  <label class="pp-role">
                    <input type="checkbox" data-add-person="${esc(p.robloxUserId)}" ${addPeopleChosen.has(String(p.robloxUserId)) ? 'checked' : ''}>
                    ${avatarImg(p.robloxUserId, '', 'class="org-avatar"')}
                    <span class="pp-role-main">
                      <span class="pp-item-title">${esc(p.robloxUsername)}</span>
                      <span class="pp-role-meta">${(p.roles || []).join(', ') || 'No roles'}${p.teams && p.teams.length ? ` &middot; already on ${esc(p.teams.join(', '))}` : ''}</span>
                    </span>
                  </label>`).join('')}
              </div>` : ''}
            </div>
            <div class="pp-foot">
              <button type="button" class="btn btn-primary btn-sm" id="addPeopleConfirm" ${addPeopleChosen.size && !busy ? '' : 'disabled'}>${busy ? 'Adding...' : `Add ${addPeopleChosen.size || ''}`.trim()}</button>
              <button type="button" class="btn btn-ghost btn-sm" id="addPeopleCancel">Cancel</button>
            </div>
          </aside>
        </div>`;
      }

      function boardLabels() {
        return Array.from(new Set((board.cards || []).map(c => c.label).filter(Boolean))).sort((a, b) => a.localeCompare(b));
      }

      function boardCardHtml(card) {
        const due = card.due_at ? taskState({ due_at: card.due_at, status: 'open' }) : null;
        const lc = card.label ? gameColor(card.label) : null;
        return `
          <div class="bd-card" draggable="true" data-card="${esc(card.id)}" tabindex="0" role="button" aria-label="${esc(card.title)}">
            ${card.label ? `<span class="bd-label" style="background:${lc}1F;color:${lc};border:1px solid ${lc}55;">${esc(card.label)}</span>` : ''}
            <div class="bd-card-title">${esc(card.title)}</div>
            ${card.description ? `<div class="bd-card-desc">${esc(card.description)}</div>` : ''}
            <div class="bd-card-foot">
              ${card.due_at ? `<span class="pp-state ${due.cls}">${esc(due.label)}</span>` : ''}
              ${card.assigned_to_user_id ? `<span class="bd-assignee">${avatarImg(card.assigned_to_user_id, '', 'style="width:20px;height:20px;border-radius:50%;"')}${esc(card.assigned_to_username || '')}</span>` : ''}
            </div>
          </div>`;
      }

      function boardHtml() {
        if (!board) return `<div class="dash-loading">Loading the board...</div>`;
        if (boardError) return `<div class="dash-empty"><h3>Could not open the board</h3><p>${esc(boardError)}</p></div>`;
        const q = boardSearch.trim().toLowerCase();
        const matches = (c) => {
          if (boardFilter === 'mine' && String(c.assigned_to_user_id || '') !== String(board.me.robloxUserId)) return false;
          if (boardFilter === 'overdue' && !(c.due_at && new Date(c.due_at) < new Date())) return false;
          if (boardFilter === 'unassigned' && c.assigned_to_user_id) return false;
          if (!q) return true;
          return (c.title || '').toLowerCase().includes(q)
            || (c.description || '').toLowerCase().includes(q)
            || (c.assigned_to_username || '').toLowerCase().includes(q)
            || (c.label || '').toLowerCase().includes(q);
        };
        const cardsFor = (listId) => board.cards.filter(c => String(c.list_id) === String(listId) && matches(c));
        const totals = {
          all: board.cards.length,
          mine: board.cards.filter(c => String(c.assigned_to_user_id || '') === String(board.me.robloxUserId)).length,
          overdue: board.cards.filter(c => c.due_at && new Date(c.due_at) < new Date()).length,
          unassigned: board.cards.filter(c => !c.assigned_to_user_id).length
        };
        return `
        <div class="bd-toolbar">
          <div class="search-input-wrap" style="flex:1 1 220px;max-width:320px;">
            <input type="text" id="bdSearch" placeholder="Search cards" value="${esc(boardSearch)}" aria-label="Search cards">
          </div>
          <div class="chip-filters">
            ${[['all', 'All'], ['mine', 'Mine'], ['overdue', 'Overdue'], ['unassigned', 'Unassigned']].map(([id, label]) =>
          `<button type="button" class="chip-filter ${boardFilter === id ? 'on' : ''}" data-board-filter="${id}" aria-pressed="${boardFilter === id}">${label} <b>${esc(totals[id])}</b></button>`).join('')}
          </div>
        </div>
        <p class="sub" style="margin:0 0 14px;">Everyone on this team can add, move and edit cards. Drag a card to move it, or use the arrows (or drag a column header) to reorder columns.</p>
        <div class="bd-board">
          ${board.lists.map((list, idx) => {
            const cards = cardsFor(list.id);
            return `
            <section class="bd-list" data-list="${esc(list.id)}">
              <header class="bd-list-head" draggable="true" data-list-drag="${esc(list.id)}">
                <button type="button" class="bd-move-btn" data-move-list="${esc(list.id)}" data-dir="left" ${idx === 0 ? 'disabled' : ''} aria-label="Move ${esc(list.title)} left">&lsaquo;</button>
                <h3 data-rename-list="${esc(list.id)}" title="Click to rename">${esc(list.title)}</h3>
                <button type="button" class="bd-move-btn" data-move-list="${esc(list.id)}" data-dir="right" ${idx === board.lists.length - 1 ? 'disabled' : ''} aria-label="Move ${esc(list.title)} right">&rsaquo;</button>
                <span class="bd-count">${cards.length}</span>
                <button type="button" class="pp-icon-btn" data-delete-list="${esc(list.id)}" aria-label="Delete ${esc(list.title)}">&times;</button>
              </header>
              <div class="bd-cards" data-drop="${esc(list.id)}">
                ${cards.map(boardCardHtml).join('')}
              </div>
              <div class="bd-quick">
                <input type="text" class="bd-quick-input" data-quick-add="${esc(list.id)}" placeholder="+ Add a card" aria-label="Add a card to ${esc(list.title)}">
              </div>
              <button type="button" class="bd-add" data-add-card="${esc(list.id)}">Add with details</button>
            </section>`;
          }).join('')}
          <section class="bd-list bd-new">
            <input type="text" id="bdNewListInput" placeholder="New column name" aria-label="New column name">
            <button type="button" class="btn btn-ghost btn-sm" id="bdAddListBtn">Add column</button>
          </section>
        </div>`;
      }

      function boardCardModalHtml() {
        const c = boardCard;
        if (!c) return '';
        const isNew = !c.id;
        return `
        <div class="pp-scrim" id="bdCardScrim">
          <aside class="pp" role="dialog" aria-modal="true" aria-labelledby="bdCardTitle">
            <div class="pp-head">
              <div style="flex:1;min-width:0;">
                <h2 id="bdCardTitle">${isNew ? 'New card' : 'Card'}</h2>
                <div class="pp-sub">${esc((board.lists.find(l => String(l.id) === String(c.list_id)) || {}).title || '')}${c.created_by ? ` &middot; added by ${esc(c.created_by)}` : ''}</div>
              </div>
              <button type="button" class="modal-close" id="bdCardClose" aria-label="Close">&times;</button>
            </div>
            <div class="pp-body">
              <div class="field"><label for="bdTitle">What needs doing</label>
                <input type="text" id="bdTitle" value="${esc(c.title || '')}" placeholder="e.g. Fix the spawn lighting"></div>
              <div class="field"><label for="bdDesc">Details <span class="hint">(optional)</span></label>
                <textarea id="bdDesc" rows="4" placeholder="Anything useful for whoever picks this up">${esc(c.description || '')}</textarea></div>
              <div class="team-form-row">
                <div class="field"><label for="bdDue">Due <span class="hint">(optional)</span></label>
                  <input type="date" id="bdDue" value="${c.due_at ? esc(String(c.due_at).slice(0, 10)) : ''}"></div>
                <div class="field"><label for="bdAssignee">Assigned to</label>
                  <select id="bdAssignee">
                    <option value="">Nobody</option>
                    <option value="${esc(board.me.robloxUserId)}" ${String(c.assigned_to_user_id || '') === String(board.me.robloxUserId) ? 'selected' : ''}>Me (${esc(board.me.robloxUsername)})</option>
                    ${board.members.filter(m => String(m.roblox_user_id) !== String(board.me.robloxUserId)).map(m => `<option value="${esc(m.roblox_user_id)}" ${String(c.assigned_to_user_id || '') === String(m.roblox_user_id) ? 'selected' : ''}>${esc(m.roblox_username)}</option>`).join('')}
                  </select></div>
                <div class="field"><label for="bdLabel">Label <span class="hint">(optional)</span></label>
                  <input type="text" id="bdLabel" list="bdLabelOptions" value="${esc(c.label || '')}" placeholder="e.g. Bug, Urgent, needs art" maxlength="24">
                  <datalist id="bdLabelOptions">${boardLabels().map(l => `<option value="${esc(l)}">`).join('')}</datalist>
                </div>
              </div>
              ${boardLabels().length ? `<div class="bd-label-picks">${boardLabels().map(l => {
          const col = gameColor(l);
          return `<button type="button" class="bd-label-pick ${String(c.label || '') === l ? 'on' : ''}" data-pick-label="${esc(l)}" style="background:${col}1F;color:${col};border:1px solid ${col}55;">${esc(l)}</button>`;
        }).join('')}</div>` : ''}
            </div>
            <div class="pp-foot">
              <button type="button" class="btn btn-primary btn-sm" id="bdSaveCard" ${boardBusy ? 'disabled' : ''}>${boardBusy ? 'Saving...' : isNew ? 'Add card' : 'Save'}</button>
              ${!isNew ? `<button type="button" class="btn btn-ghost btn-sm" id="bdDeleteCard">Delete card</button>` : ''}
              <button type="button" class="btn btn-ghost btn-sm" id="bdCancelCard">Cancel</button>
            </div>
          </aside>
        </div>`;
      }

      function membersHtml() {
        const members = detail.members.slice().sort((a, b) => (b.openTasks - a.openTasks) || (a.robloxUsername || '').localeCompare(b.robloxUsername || ''));
        const addBtn = detail.canManage
          ? `<button type="button" class="btn btn-primary btn-sm" id="addPeopleBtn" style="margin-bottom:14px;">+ Add people</button>`
          : '';
        if (!members.length) return `${addBtn}<div class="dash-empty"><h3>Nobody on this team yet</h3><p>${detail.canManage ? 'Use Add people to put developers on this team, or send them an invite link.' : 'Ask a lead to add people to this team.'}</p></div>`;
        return `${addBtn}<div class="table-scroll"><table class="req-table">
          <thead><tr><th>Member</th><th>Skill</th><th>Open tasks</th><th>Requests</th><th>Last active</th></tr></thead>
          <tbody>
            ${members.map(m => `
            <tr>
              <td class="name-cell" style="display:flex;gap:10px;align-items:center;">
                ${avatarImg(m.robloxUserId, '', 'style="width:28px;height:28px;border-radius:50%;"')}
                <span>${userLink(m.robloxUserId, m.robloxUsername)}
                  ${m.warnCount ? `<span class="pending-badge" style="position:static;margin-left:6px;">${esc(m.warnCount)}/3</span>` : ''}
                  <span style="display:block;color:var(--muted);font-size:12px;">${(m.roles || []).join(', ') || 'No roles'}</span>
                </span>
              </td>
              <td>${m.skillset ? `<span class="pp-tag">${esc(m.skillset.name)}</span>` : '<span class="hint">Not set</span>'}</td>
              <td>${m.openTasks ? esc(m.openTasks) : '<span class="hint">None</span>'}</td>
              <td>${esc(m.requestCount)}${m.pendingCount ? ` <span class="hint">(${esc(m.pendingCount)} pending)</span>` : ''}</td>
              <td style="white-space:nowrap;color:var(--ink-soft);">${m.lastActive ? esc(shortAgo(m.lastActive)) : '-'}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>`;
      }

      function gameCardHtml(g) {
        const s = g.stats;
        const linking = linkingGameId === g.id;
        return `
        <div class="game-card">
          <div class="game-card-head">
            ${g.iconUrl ? `<img src="${esc(g.iconUrl)}" alt="" class="game-icon">` : `<div class="game-icon placeholder" aria-hidden="true"></div>`}
            <div style="flex:1;min-width:0;">
              <h4>${esc(g.name)}</h4>
              <div class="hint">${g.universeId ? `Universe ${esc(g.universeId)}` : 'Not linked to a Roblox game yet'}</div>
            </div>
            ${detail.canManage ? `<div style="display:flex;gap:6px;">
              <button type="button" class="btn btn-ghost btn-sm" data-link-game="${esc(g.id)}">${g.universeId ? 'Change link' : 'Link to Roblox'}</button>
              <button type="button" class="pp-icon-btn" data-remove-game="${esc(g.id)}" aria-label="Remove ${esc(g.name)} from this team">&times;</button>
            </div>` : ''}
          </div>
          ${linking ? `
          <div class="pp-add" style="margin:0 0 10px;">
            <input type="text" id="gameLinkInput" class="pp-select" style="flex:1 1 220px;" placeholder="Roblox place ID or game link" value="${g.placeId ? esc(g.placeId) : ''}">
            <button type="button" class="btn btn-primary btn-sm" id="gameLinkSave" ${busy ? 'disabled' : ''}>${busy ? 'Checking...' : 'Save'}</button>
            <button type="button" class="btn btn-ghost btn-sm" id="gameLinkCancel">Cancel</button>
          </div>` : ''}
          ${!g.universeId
            ? `<p class="hint" style="margin:0;">Link it to see players, visits, likes and growth.</p>`
            : !s
              ? `<p class="hint" style="margin:0;">Waiting for the first reading from Roblox. Press Refresh stats.</p>`
              : `
          <div class="game-stats">
            <div><b>${esc(bigNum(s.latest.playing))}</b><span>Playing now</span></div>
            <div><b>${esc(bigNum(s.latest.visits))}</b><span>Visits</span></div>
            <div><b>${esc(bigNum(s.latest.favorites))}</b><span>Favourites</span></div>
            <div><b>${s.latest.likes + s.latest.dislikes ? Math.round(s.latest.likes / (s.latest.likes + s.latest.dislikes) * 100) + '%' : '-'}</b><span>Liked</span></div>
          </div>
          <div class="game-growth">
            <div><span class="hint">Last 24 hours</span><b>${s.visitsLast24h == null ? 'Not enough history' : esc(bigNum(s.visitsLast24h)) + ' visits'}</b></div>
            <div><span class="hint">Last 7 days</span><b>${s.visitsLast7d == null ? 'Not enough history' : esc(bigNum(s.visitsLast7d)) + ' visits'}</b></div>
            <div><span class="hint">Players online vs a week ago</span><b class="${s.playingChange7d > 0 ? 'good' : s.playingChange7d < 0 ? 'danger' : ''}">${s.playingChange7d == null ? 'Not enough history' : esc(signedNum(s.playingChange7d))}</b></div>
          </div>
          ${g.spend ? `
          <div class="game-growth">
            <div><span class="hint">Paid out for this game</span><b>${esc(spendText(g.spend) || 'Nothing yet')}</b></div>
            <div><span class="hint">This month</span><b>${esc(spendText(g.spend, true) || 'Nothing yet')}</b></div>
            ${g.spend.ROBUX && s.visitsLast7d ? `<div><span class="hint">Robux per 1K visits this week</span><b>${esc((g.spend.ROBUX / (s.visitsLast7d / 1000)).toFixed(1))}</b></div>` : ''}
          </div>` : ''}
          <div class="game-spark">
            <span class="hint">Players online, since ${esc(fmtDate(s.firstSeen))}</span>
            ${sparkline(s.series, 'playing')}
          </div>`}
        </div>`;
      }

      function gamesHtml() {
        return `
          ${detail.canManage ? `
          <div class="pp-add" style="margin:0 0 16px;">
            <select id="addGameSelect" class="pp-select" aria-label="Game to assign" style="flex:1 1 220px;">
              <option value="">Assign a game to this team...</option>
              ${detail.availableGames.map(g => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('')}
            </select>
            <button type="button" class="btn btn-primary btn-sm" id="addGameBtn" ${busy ? 'disabled' : ''}>Assign</button>
            <button type="button" class="btn btn-ghost btn-sm" id="refreshStatsBtn" ${busy ? 'disabled' : ''}>${busy ? 'Working...' : 'Refresh stats'}</button>
          </div>` : ''}
          ${detail.games.some(g => g.stats && g.stats.series.length > 1) ? `
          <div class="panel" style="margin:0 0 18px;">
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:12px;">
              <h3 style="margin:0;font-size:15px;flex:1;">History</h3>
              <div class="seg org-seg" role="tablist" aria-label="Metric">
                ${[['playing', 'Players online'], ['visits', 'Visits'], ['favorites', 'Favourites']].map(([v, l]) =>
          `<button type="button" role="tab" aria-selected="${chartMetric === v}" class="${chartMetric === v ? 'on' : ''}" data-chart-metric="${v}">${l}</button>`).join('')}
              </div>
            </div>
            <div style="position:relative;height:260px;"><canvas id="gameHistoryChart"></canvas></div>
            <p class="hint" style="margin:10px 0 0;">Readings are taken every few hours, and whenever someone opens this page.</p>
          </div>` : ''}
          ${detail.games.length
            ? `<div class="game-grid">${detail.games.map(gameCardHtml).join('')}</div>`
            : `<div class="dash-empty"><h3>No games assigned</h3><p>${detail.canManage ? 'Assign one above, then link it to its Roblox place to track how it grows.' : 'Nobody has assigned a game to this team yet.'}</p></div>`}`;
      }

      function canTasks(source) {
        const src = source || detail;
        return !!(src && (src.canManage || src.canManageTasks));
      }

      function batchRowHtml(batch, source) {
        const src = source || detail;
        const first = batch[0];
        const done = batch.filter(t => t.status === 'done').length;
        const openOnes = batch.filter(t => t.status === 'open');
        const st = taskState(openOnes[0] || first);
        const key = 'batch:' + first.batch_id;
        const expanded = openTaskBatches.has(key);
        const game = src.games.find(g => String(g.id) === String(first.game_id));
        return `
          <div class="task-row">
            <div style="flex:1;min-width:0;">
              <div class="task-title ${done === batch.length ? 'done' : ''}">${esc(first.title)} <span class="pp-tag">Everyone</span></div>
              <div class="task-meta">
                <span class="pp-state ${done === batch.length ? 'ok' : st.cls}">${done === batch.length ? 'All done' : esc(st.label)}</span>
                <span>${esc(done)} of ${esc(batch.length)} done</span>
                ${game ? `<span>${esc(game.name)}</span>` : ''}
                ${first.due_at ? `<span title="${esc(fmtDateTime(first.due_at))}">${esc(fmtDate(first.due_at))}</span>` : ''}
                ${first.payment ? `<span class="pp-tag">${esc(first.currency === 'USD' ? '$' + Number(first.payment).toFixed(2) : 'R$ ' + Number(first.payment).toLocaleString())}</span>` : ''}
                ${first.repeat_every ? `<span class="pp-tag">Repeats ${esc({ weekly: 'weekly', fortnightly: 'every 2 weeks', monthly: 'monthly' }[first.repeat_every] || first.repeat_every)}</span>` : ''}
                <button type="button" class="pp-linkbtn" data-batch-toggle="${esc(key)}">${expanded ? 'Hide people' : 'Show people'}</button>
              </div>
              ${first.details ? `<div class="task-details">${esc(first.details)}</div>` : ''}
              ${expanded ? `<div class="task-people">${batch.map(t => `
                <div class="task-person">
                  ${avatarImg(t.assigned_to_user_id, '', 'style="width:22px;height:22px;border-radius:50%;"')}
                  <span style="flex:1;min-width:0;">${userLink(t.assigned_to_user_id, t.assigned_to_username)}</span>
                  <a class="pp-linkbtn" href="#/task/${encodeURIComponent(t.id)}">Open</a>
                  <span class="pp-state ${taskState(t).cls}">${esc(taskState(t).label)}</span>
                  ${canTasks(src) ? `<button type="button" class="pp-linkbtn" data-task-toggle="${esc(t.id)}" data-status="${t.status === 'done' ? 'open' : 'done'}">${t.status === 'done' ? 'Reopen' : 'Done'}</button>` : ''}
                </div>`).join('')}</div>` : ''}
            </div>
            ${canTasks(src) ? `
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <button type="button" class="btn btn-ghost btn-sm" data-batch-edit="${esc(first.batch_id)}">Edit</button>
              <button type="button" class="pp-icon-btn" data-batch-delete="${esc(first.batch_id)}" aria-label="Delete ${esc(first.title)} for everyone">&times;</button>
            </div>` : ''}
          </div>`;
      }

      function deadlinesHtml(source) {
        const src = source || detail;
        const s = src.taskSummary;
        const batches = new Map();
        src.tasks.forEach(t => {
          if (!t.batch_id) return;
          if (!batches.has(t.batch_id)) batches.set(t.batch_id, []);
          batches.get(t.batch_id).push(t);
        });
        const open = src.tasks.filter(t => t.status === 'open' && !t.batch_id);
        const closed = src.tasks.filter(t => t.status !== 'open' && !t.batch_id);
        const openBatches = [...batches.values()].filter(b => b.some(t => t.status === 'open'));
        const doneBatches = [...batches.values()].filter(b => !b.some(t => t.status === 'open'));
        const row = (t) => {
          const st = taskState(t);
          const game = src.games.find(g => String(g.id) === String(t.game_id));
          return `
          <div class="task-row">
            <div style="flex:1;min-width:0;">
              <div class="task-title ${t.status === 'done' ? 'done' : ''}">${esc(t.title)}</div>
              <div class="task-meta">
                <span class="pp-state ${st.cls}">${esc(st.label)}</span>
                ${game ? `<span>${esc(game.name)}</span>` : ''}
                ${t.assigned_to_user_id ? `<span>${userLink(t.assigned_to_user_id, t.assigned_to_username)}</span>` : '<span class="hint">Nobody assigned</span>'}
                ${t.due_at ? `<span title="${esc(fmtDateTime(t.due_at))}">${esc(fmtDate(t.due_at))}</span>` : ''}
                ${t.payment ? `<span class="pp-tag">${esc(t.currency === 'USD' ? '$' + Number(t.payment).toFixed(2) : 'R$ ' + Number(t.payment).toLocaleString())}</span>` : ''}
                ${t.repeat_every ? `<span class="pp-tag">Repeats ${esc({ weekly: 'weekly', fortnightly: 'every 2 weeks', monthly: 'monthly' }[t.repeat_every] || t.repeat_every)}</span>` : ''}
                <a class="pp-linkbtn" href="#/task/${encodeURIComponent(t.id)}">Open</a>
              </div>
              ${t.details ? `<div class="task-details">${esc(t.details)}</div>` : ''}
            </div>
            ${canTasks(src) ? `
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <button type="button" class="btn btn-ghost btn-sm" data-task-toggle="${esc(t.id)}" data-status="${t.status === 'done' ? 'open' : 'done'}">${t.status === 'done' ? 'Reopen' : 'Mark done'}</button>
              <button type="button" class="btn btn-ghost btn-sm" data-task-edit="${esc(t.id)}">Edit</button>
              <button type="button" class="pp-icon-btn" data-task-delete="${esc(t.id)}" aria-label="Delete ${esc(t.title)}">&times;</button>
            </div>` : ''}
          </div>`;
        };
        const d = taskDraft;
        return `
          <div class="stat-strip team-detail-strip">
            <div class="strip-card"><div class="strip-label">On time</div><div class="strip-value">${s.onTimeRate == null ? '-' : esc(s.onTimeRate) + '%'}</div><div class="hint">${esc(s.onTime)} of ${esc(s.done)} finished tasks</div></div>
            <div class="strip-card"><div class="strip-label">Overdue</div><div class="strip-value ${s.overdue ? 'danger' : ''}">${esc(s.overdue)}</div></div>
            <div class="strip-card"><div class="strip-label">Due within 3 days</div><div class="strip-value">${esc(s.dueSoon)}</div></div>
            <div class="strip-card"><div class="strip-label">Open</div><div class="strip-value">${esc(s.open)}</div></div>
          </div>
          ${canTasks(src) ? (d ? `
          <div class="panel" style="margin:0 0 18px;">
            <h3 style="margin:0 0 12px;font-size:15px;">${d.id ? 'Edit task' : 'New task'}</h3>
            <div class="field"><label for="taskTitle">What needs doing</label><input type="text" id="taskTitle" value="${esc(d.title || '')}" placeholder="e.g. Ship the winter map update"></div>
            <div class="team-form-row">
              <div class="field"><label for="taskDue">Deadline</label><input type="date" id="taskDue" value="${d.due_at ? esc(String(d.due_at).slice(0, 10)) : ''}"></div>
              <div class="field"><label for="taskGame">Game <span class="hint">(optional)</span></label>
                <select id="taskGame"><option value="">No specific game</option>${src.games.map(g => `<option value="${esc(g.id)}" ${String(d.game_id || (!d.id && gameDetail ? gameDetail.game.id : '')) === String(g.id) ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}${d.game_id && !src.games.some(g => String(g.id) === String(d.game_id)) ? `<option value="${esc(d.game_id)}" selected>Previously linked game (not on this team anymore)</option>` : ''}</select>
              </div>
              <div class="field"><label for="taskPayment">Pays <span class="hint">(optional)</span></label>
                <div style="display:flex;gap:6px;">
                  <input type="number" id="taskPayment" min="0" step="0.01" placeholder="e.g. 5000" value="${d.payment != null ? esc(d.payment) : ''}" style="flex:1;">
                  <select id="taskCurrency" aria-label="Currency" style="flex:0 0 100px;">
                    <option value="ROBUX" ${String(d.currency || 'ROBUX') === 'ROBUX' ? 'selected' : ''}>Robux</option>
                    <option value="USD" ${d.currency === 'USD' ? 'selected' : ''}>USD</option>
                  </select>
                </div>
              </div>
              <div class="field"><label for="taskRepeat">Repeats <span class="hint">(optional)</span></label>
                <select id="taskRepeat">${[['', 'Does not repeat'], ['weekly', 'Every week'], ['fortnightly', 'Every 2 weeks'], ['monthly', 'Every month']].map(([v, l]) => `<option value="${v}" ${String(d.repeat_every || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
              </div>
              <div class="field"><label for="taskAssignee">Assign to <span class="hint">(optional)</span></label>
                <select id="taskAssignee" ${d.batch_id ? 'disabled' : ''}>
                  <option value="">Nobody</option>
                  ${d.id ? '' : `<option value="__all__" ${d.assignAll ? 'selected' : ''}>Everyone on the team (${esc(src.members.length)})</option>`}
                  ${src.members.map(m => `<option value="${esc(m.robloxUserId)}" ${String(d.assigned_to_user_id) === String(m.robloxUserId) ? 'selected' : ''}>${esc(m.robloxUsername)}</option>`).join('')}
                </select>
                ${d.batch_id ? '<span class="hint">Given to everyone. Editing changes it for all of them.</span>' : ''}
              </div>
            </div>
            <div class="field"><label for="taskDetails">Notes <span class="hint">(optional)</span></label><textarea id="taskDetails" rows="2">${esc(d.details || '')}</textarea></div>
            <div style="display:flex;gap:8px;">
              <button type="button" class="btn btn-primary btn-sm" id="saveTaskBtn" ${busy ? 'disabled' : ''}>${busy ? 'Saving...' : d.id ? 'Save changes' : 'Add task'}</button>
              <button type="button" class="btn btn-ghost btn-sm" id="cancelTaskBtn">Cancel</button>
            </div>
          </div>` : `<button type="button" class="btn btn-primary btn-sm" id="newTaskBtn" style="margin-bottom:18px;">Add a task</button>`) : ''}
          ${open.length || openBatches.length ? `<div class="task-list">${openBatches.map(b => batchRowHtml(b, src)).join('')}${open.map(row).join('')}</div>` : `<div class="dash-empty"><h3>Nothing open</h3><p>${canTasks(src) ? 'Add a task to start tracking deadlines for this team.' : 'This team has no open tasks.'}</p></div>`}
          ${closed.length || doneBatches.length ? `<h3 class="sec-title" style="margin:24px 0 8px;font-size:15px;">Finished (${closed.length + doneBatches.length})</h3><div class="task-list">${doneBatches.map(b => batchRowHtml(b, src)).join('')}${closed.map(row).join('')}</div>` : ''}`;
      }

      function paint() {
        if (myGen !== renderGen) return;
        let body;
        if (loading) body = `<div class="dash-loading">Loading teams...</div>`;
        else if (loadError) body = `<div class="dash-empty"><h3>Could not load teams</h3><p>${esc(loadError)}</p><button type="button" class="btn btn-ghost btn-sm" id="retryTeamsBtn">Try again</button></div>`;
        else if (gameDetail) body = tab === 'deadlines' ? deadlinesHtml(gameDetail) : tab === 'analytics' ? gameAnalyticsHtml() : gameMembersHtml();
        else if (!detail) body = view === 'org' ? orgHtml() : view === 'games' ? gamesListHtml() : overviewHtml();
        else body = tab === 'board' ? boardHtml() : tab === 'games' ? gamesHtml() : tab === 'deadlines' ? deadlinesHtml() : membersHtml();

        const head = gameDetail
          ? `<div>
              <a class="pp-linkbtn" href="#/teams?view=games" id="backToGames">Back to all games</a>
              <h1 style="margin:6px 0 4px;display:flex;align-items:center;gap:10px;">
                ${gameDetail.game.iconUrl ? `<img src="${esc(gameDetail.game.iconUrl)}" alt="" class="game-icon" style="width:34px;height:34px;border-radius:8px;">` : ''}
                ${esc(gameDetail.game.name)}
              </h1>
              <p class="sub">${esc(gameDetail.members.length)} people &middot; ${gameDetail.teams.length ? gameDetail.teams.map(t => esc(t.name)).join(', ') : 'No team yet'} &middot; ${gameDetail.taskSummary.open} open tasks${gameDetail.taskSummary.overdue ? `, ${gameDetail.taskSummary.overdue} overdue` : ''}</p>
            </div>`
          : detail
            ? `<div>
              <a class="pp-linkbtn" href="#/teams" id="backToTeams">Back to all teams</a>
              <h1 style="margin:6px 0 4px;display:flex;align-items:center;gap:10px;"><span class="pp-dot" style="background:${safeColor(detail.team.color, 'var(--muted)')};width:14px;height:14px;"></span>${esc(detail.team.name)}</h1>
              <p class="sub">${esc(detail.members.length)} members &middot; ${esc(detail.games.length)} games &middot; ${detail.taskSummary.open} open tasks${detail.taskSummary.overdue ? `, ${detail.taskSummary.overdue} overdue` : ''}${spendText(detail.spend, true) ? ` &middot; ${esc(spendText(detail.spend, true))} paid out this month` : ''}</p>
            </div>`
            : `<div>
              <h1 style="margin-bottom:4px;">${view === 'games' ? 'Games' : view === 'org' ? 'Organisation' : 'Teams'}</h1>
              <p class="sub">${view === 'games'
              ? 'Every game, who works on it, its deadlines and how it is growing.'
              : view === 'org'
                ? `Everyone at ${esc(studioName())}, built from teams, skills and roles as they are right now.`
                : 'Who is on each team, which games they look after, and how they are doing against their deadlines.'}</p>
            </div>`;

        app.innerHTML = `
    ${topbar()}
    ${addPeopleOpen && detail ? addPeopleHtml() : ''}
    ${boardCard && detail ? boardCardModalHtml() : ''}
    <div class="dash-shell">
      <div class="dash-head">
        ${head}
        <div class="dash-toolbar">
          <button type="button" class="btn btn-ghost btn-sm" id="reloadTeamsBtn">Refresh</button>
          ${!detail && !gameDetail && view === 'org' ? `<button type="button" class="btn btn-ghost btn-sm" id="printOrgBtn">Print or save as PDF</button>` : ''}
          ${gameDetail ? `<button type="button" class="btn btn-ghost btn-sm" id="refreshGameStatsBtn">Refresh now</button>` : ''}
          ${gameDetail && gameDetail.game.placeId ? `<a class="btn btn-ghost btn-sm" href="https://www.roblox.com/games/${esc(gameDetail.game.placeId)}" target="_blank" rel="noopener">Open on Roblox</a>` : ''}
          ${detail && detail.canManage ? `<a class="btn btn-ghost btn-sm" href="#/manage?tab=teams">Team settings</a>` : ''}
        </div>
      </div>
      ${!detail && !gameDetail ? `
      <div class="tabs" style="margin-bottom:18px;" role="tablist">
        ${[['teams', 'Teams'], ['games', 'Games'], ['org', 'Org chart']].map(([id, label]) =>
          `<button type="button" role="tab" aria-selected="${view === id}" class="tab-btn ${view === id ? 'active' : ''}" data-teams-view="${id}">${label}</button>`).join('')}
      </div>` : ''}
      ${detail ? `
      <div class="tabs" style="margin-bottom:18px;" role="tablist">
        ${[['members', 'Members'], ['board', 'Board'], ['games', 'Games'], ['deadlines', 'Deadlines']].map(([id, label]) =>
            `<button type="button" role="tab" aria-selected="${tab === id}" class="tab-btn ${tab === id ? 'active' : ''}" data-team-tab="${id}">${label}</button>`).join('')}
      </div>` : ''}
      ${gameDetail ? `
      <div class="tabs" style="margin-bottom:18px;" role="tablist">
        ${[['members', 'Members'], ['deadlines', 'Deadlines'], ['analytics', 'Analytics']].map(([id, label]) =>
              `<button type="button" role="tab" aria-selected="${tab === id}" class="tab-btn ${tab === id ? 'active' : ''}" data-game-tab="${id}">${label}</button>`).join('')}
      </div>` : ''}
      ${body}
    </div>`;

        wireTopbarSignOut();
        const retry = document.getElementById('retryTeamsBtn');
        if (retry) retry.addEventListener('click', load);
        document.getElementById('reloadTeamsBtn').addEventListener('click', load);
        const back = document.getElementById('backToTeams');
        if (back) back.addEventListener('click', (e) => { e.preventDefault(); go(null); });
        document.querySelectorAll('[data-open-team]').forEach(el => el.addEventListener('click', () => go(el.dataset.openTeam)));
        document.querySelectorAll('[data-open-game]').forEach(el => el.addEventListener('click', () => goGame(el.dataset.openGame)));
        const backGames = document.getElementById('backToGames');
        if (backGames) backGames.addEventListener('click', (e) => { e.preventDefault(); goGame(null); });
        document.querySelectorAll('[data-game-tab]').forEach(el => el.addEventListener('click', () => {
          tab = el.dataset.gameTab;
          history.replaceState(null, '', `#/teams?view=games&game=${encodeURIComponent(gameId)}&tab=${tab}`);
          paint();
        }));
        const refreshGame = document.getElementById('refreshGameStatsBtn');
        if (refreshGame) refreshGame.addEventListener('click', () => load(true));
        document.querySelectorAll('[data-teams-view]').forEach(el => el.addEventListener('click', () => {
          view = el.dataset.teamsView;
          gameId = null; gameDetail = null;
          history.replaceState(null, '', view === 'teams' ? '#/teams' : `#/teams?view=${view}`);
          if ((view === 'org' && !org) || (view === 'games' && !gamesList)) load(); else paint();
        }));
        const orgSearchInput = document.getElementById('orgSearchInput');
        if (orgSearchInput) orgSearchInput.addEventListener('input', debounce(() => { orgSearch = orgSearchInput.value; paint(); const el = document.getElementById('orgSearchInput'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 150));
        document.querySelectorAll('[data-org-group-by]').forEach(el => el.addEventListener('click', () => { orgGroupBy = el.dataset.orgGroupBy; orgOpenGroups = new Set(); paint(); }));
        const compactBtn = document.getElementById('orgCompactBtn');
        if (compactBtn) compactBtn.addEventListener('click', () => { orgCompact = !orgCompact; paint(); });
        const expandBtn = document.getElementById('orgExpandBtn');
        if (expandBtn) expandBtn.addEventListener('click', () => {
          if (orgOpenTeams.size) { orgOpenTeams = new Set(); orgOpenGroups = new Set(); }
          else { orgOpenTeams = new Set([...(org ? org.teams.map(t => String(t.id)) : []), 'none']); }
          paint();
        });
        document.querySelectorAll('[data-org-team]').forEach(el => el.addEventListener('click', () => {
          const id = el.dataset.orgTeam;
          if (orgOpenTeams.has(id)) orgOpenTeams.delete(id); else orgOpenTeams.add(id);
          paint();
        }));
        document.querySelectorAll('[data-org-group]').forEach(el => el.addEventListener('click', () => {
          const key = el.dataset.orgGroup;
          if (orgOpenGroups.has(key)) orgOpenGroups.delete(key); else orgOpenGroups.add(key);
          paint();
        }));
        const printOrg = document.getElementById('printOrgBtn');
        if (printOrg) printOrg.addEventListener('click', () => window.print());
        document.querySelectorAll('.org-person').forEach(el => el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openUserMenu(el.dataset.userId, el.dataset.username); }
        }));
        document.querySelectorAll('[data-team-tab]').forEach(el => el.addEventListener('click', () => {
          tab = el.dataset.teamTab;
          history.replaceState(null, '', `#/teams?team=${encodeURIComponent(teamId)}&tab=${tab}`);
          paint();
          if (tab === 'board' && !board) loadBoard();
        }));

        wireBoard();
        const addPeopleBtn = document.getElementById('addPeopleBtn');
        if (addPeopleBtn) addPeopleBtn.addEventListener('click', () => {
          addPeopleOpen = true;
          addPeopleChosen = new Set();
          addPeopleSearch = '';
          addPeopleSkillset = '';
          paint();
          loadAddPeople();
        });
        const closeAddPeople = () => { addPeopleOpen = false; paint(); };
        ['addPeopleClose', 'addPeopleCancel'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.addEventListener('click', closeAddPeople);
        });
        const addScrim = document.getElementById('addPeopleScrim');
        if (addScrim) addScrim.addEventListener('click', (e) => { if (e.target === addScrim) closeAddPeople(); });
        const addSearch = document.getElementById('addPeopleSearchInput');
        if (addSearch) addSearch.addEventListener('input', debounce(() => {
          addPeopleSearch = addSearch.value;
          paint();
          const again = document.getElementById('addPeopleSearchInput');
          if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
        }, 120));
        const addSkill = document.getElementById('addPeopleSkill');
        if (addSkill) addSkill.addEventListener('change', () => { addPeopleSkillset = addSkill.value; });
        document.querySelectorAll('[data-add-person]').forEach(cb => cb.addEventListener('change', () => {
          const id = cb.dataset.addPerson;
          if (cb.checked) addPeopleChosen.add(id); else addPeopleChosen.delete(id);
          const confirmBtn = document.getElementById('addPeopleConfirm');
          if (confirmBtn) {
            confirmBtn.disabled = !addPeopleChosen.size;
            confirmBtn.textContent = `Add ${addPeopleChosen.size || ''}`.trim();
          }
        }));
        const toggleAll = document.getElementById('addPeopleToggleAll');
        if (toggleAll) toggleAll.addEventListener('click', () => {
          const shown = [...document.querySelectorAll('[data-add-person]')].map(cb => cb.dataset.addPerson);
          const allChosen = shown.every(id => addPeopleChosen.has(id));
          shown.forEach(id => { if (allChosen) addPeopleChosen.delete(id); else addPeopleChosen.add(id); });
          paint();
        });
        const addConfirm = document.getElementById('addPeopleConfirm');
        if (addConfirm) addConfirm.addEventListener('click', async () => {
          const ids = [...addPeopleChosen];
          const skillsetId = addPeopleSkillset || null;
          if (!ids.length) return;
          busy = true; paint();
          try {
            const r = await callHrData('bulk_assign_team', { teamId, robloxUserIds: ids, skillsetId });
            addPeopleOpen = false;
            addPeopleChosen = new Set();
            busy = false;
            toast(`${r.added} ${r.added === 1 ? 'person' : 'people'} added to ${r.teamName}.`);
            peopleCache.at = 0;
            await load();
          } catch (e) {
            busy = false;
            toast(e.message || 'Could not add those people.', 'err');
            paint();
          }
        });
        const addGameBtn = document.getElementById('addGameBtn');
        if (addGameBtn) addGameBtn.addEventListener('click', async () => {
          const sel = document.getElementById('addGameSelect');
          if (!sel.value) { toast('Pick a game first.', 'err'); return; }
          await run(() => callHrData('set_team_games', { teamId, gameId: sel.value, mode: 'add' }), 'Game assigned');
        });
        document.querySelectorAll('[data-remove-game]').forEach(el => el.addEventListener('click', async () => {
          if (!(await askConfirm('Take this game off the team?'))) return;
          await run(() => callHrData('set_team_games', { teamId, gameId: el.dataset.removeGame, mode: 'remove' }), 'Game removed');
        }));
        document.querySelectorAll('[data-chart-metric]').forEach(el => el.addEventListener('click', () => { chartMetric = el.dataset.chartMetric; paint(); }));
        drawHistoryChart();
        const refreshStats = document.getElementById('refreshStatsBtn');
        if (refreshStats) refreshStats.addEventListener('click', () => load(true));
        document.querySelectorAll('[data-link-game]').forEach(el => el.addEventListener('click', () => { linkingGameId = linkingGameId === el.dataset.linkGame ? null : el.dataset.linkGame; paint(); const i = document.getElementById('gameLinkInput'); if (i) i.focus(); }));
        const linkSave = document.getElementById('gameLinkSave');
        if (linkSave) linkSave.addEventListener('click', async () => {
          const val = document.getElementById('gameLinkInput').value.trim();
          const gameId = linkingGameId;
          busy = true; paint();
          try {
            const r = await callHrData('set_game_roblox_id', { gameId, placeId: val });
            linkingGameId = null;
            toast(r.robloxName ? `Linked to ${r.robloxName} on Roblox.` : 'Link saved.');
            busy = false;
            await load();
          } catch (e) {
            busy = false;
            toast(e.code === 'roblox_game_not_found' ? "Roblox doesn't have a game with that place ID." : (e.message || 'Could not link that game.'), 'err');
            paint();
          }
        });
        const linkCancel = document.getElementById('gameLinkCancel');
        if (linkCancel) linkCancel.addEventListener('click', () => { linkingGameId = null; paint(); });

        const newTask = document.getElementById('newTaskBtn');
        if (newTask) newTask.addEventListener('click', () => { taskDraft = { title: '', details: '', due_at: '', game_id: '', assigned_to_user_id: '' }; paint(); document.getElementById('taskTitle').focus(); });
        const cancelTask = document.getElementById('cancelTaskBtn');
        if (cancelTask) cancelTask.addEventListener('click', () => { taskDraft = null; paint(); });
        const saveTask = document.getElementById('saveTaskBtn');
        if (saveTask) saveTask.addEventListener('click', async () => {
          const title = document.getElementById('taskTitle').value.trim();
          if (!title) { toast('Give the task a name.', 'err'); return; }
          const due = document.getElementById('taskDue').value;
          const assignee = document.getElementById('taskAssignee').value;
          const source = gameDetail || detail;
          const teamField = document.getElementById('taskTeam');
          const effectiveTeamId = teamId || (teamField ? teamField.value : null) || (gameDetail && gameDetail.teams[0] ? gameDetail.teams[0].id : null);
          if (!effectiveTeamId) { toast('Assign this game to a team first, then it can have deadlines.', 'err'); return; }
          const everyone = assignee === '__all__';
          if (everyone && !source.members.length) { toast('Nobody works on this yet.', 'err'); return; }
          const member = source.members.find(m => String(m.robloxUserId) === String(assignee));
          const detailsVal = document.getElementById('taskDetails').value.trim();
          const gameIdVal = document.getElementById('taskGame').value || null;
          const repeatVal = document.getElementById('taskRepeat').value || null;
          const paymentVal = document.getElementById('taskPayment').value || null;
          const currencyVal = document.getElementById('taskCurrency').value;
          const saved = await run(() => callHrData('save_team_task', {
            id: taskDraft.id, batchId: taskDraft.batch_id || null, teamId: effectiveTeamId, title,
            details: detailsVal,
            dueAt: due ? new Date(due + 'T23:59:59').toISOString() : null,
            gameId: gameIdVal,
            assignToEveryone: everyone,
            assignedToUserId: everyone ? null : (assignee || null),
            assignedToUsername: everyone ? null : (member ? member.robloxUsername : null),
            repeatEvery: repeatVal,
            payment: paymentVal,
            currency: currencyVal
          }), taskDraft.id || taskDraft.batch_id ? 'Task updated' : (everyone ? `Task given to ${source.members.length} people` : 'Task added'), () => { taskDraft = null; });
          if (saved && saved.created > 1) toast(saved.notified ? `${saved.notified} of ${saved.created} were notified.` : 'Nobody could be notified.', saved.notified ? undefined : 'err');
        });
        document.querySelectorAll('[data-batch-toggle]').forEach(el => el.addEventListener('click', () => {
          const key = el.dataset.batchToggle;
          if (openTaskBatches.has(key)) openTaskBatches.delete(key); else openTaskBatches.add(key);
          paint();
        }));
        document.querySelectorAll('[data-batch-edit]').forEach(el => el.addEventListener('click', () => {
          taskDraft = (gameDetail || detail).tasks.find(t => String(t.batch_id) === String(el.dataset.batchEdit)) || null;
          paint();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }));
        document.querySelectorAll('[data-batch-delete]').forEach(el => el.addEventListener('click', async () => {
          if (!(await askConfirm('Delete this task for everyone it was given to?'))) return;
          await run(() => callHrData('delete_team_task', { batchId: el.dataset.batchDelete }), 'Task deleted for everyone');
        }));
        document.querySelectorAll('[data-task-edit]').forEach(el => el.addEventListener('click', () => {
          taskDraft = (gameDetail || detail).tasks.find(t => String(t.id) === String(el.dataset.taskEdit)) || null;
          paint();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }));
        document.querySelectorAll('[data-task-toggle]').forEach(el => el.addEventListener('click', async () => {
          await run(() => callHrData('set_team_task_status', { id: el.dataset.taskToggle, status: el.dataset.status }), el.dataset.status === 'done' ? 'Marked done' : 'Reopened');
        }));
        document.querySelectorAll('[data-task-delete]').forEach(el => el.addEventListener('click', async () => {
          if (!(await askConfirm('Delete this task? It disappears from the on-time figures too.'))) return;
          await run(() => callHrData('delete_team_task', { id: el.dataset.taskDelete }), 'Task deleted');
        }));
      }

      function drawHistoryChart() {
        const canvas = document.getElementById('gameHistoryChart');
        if (!canvas || typeof Chart === 'undefined') return;
        const source = gameDetail
          ? { games: [{ name: gameDetail.game.name, stats: gameDetail.stats }] }
          : detail;
        if (!source) return;
        if (historyChart) { historyChart.destroy(); historyChart = null; }
        const palette = ['#4F46E5', '#178A4C', '#DB2777', '#EA580C', '#0EA5E9', '#B45309'];
        const withHistory = source.games.filter(g => g.stats && g.stats.series.length > 1);
        const labels = [...new Set(withHistory.flatMap(g => g.stats.series.map(p => p.at)))].sort();
        const dark = getTheme() === 'dark';
        historyChart = new Chart(canvas.getContext('2d'), {
          type: 'line',
          data: {
            labels: labels.map(at => fmtDate(at)),
            datasets: withHistory.map((g, i) => ({
              label: g.name,
              data: labels.map(at => {
                const point = g.stats.series.find(p => p.at === at);
                return point ? point[chartMetric] : null;
              }),
              borderColor: palette[i % palette.length],
              backgroundColor: palette[i % palette.length] + '22',
              borderWidth: 2,
              pointRadius: 2,
              tension: .3,
              spanGaps: true
            }))
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { labels: { color: dark ? '#C9C7D4' : '#3A3850', boxWidth: 12 } } },
            scales: {
              x: { grid: { display: false }, ticks: { color: dark ? '#8C89A0' : '#6B6880', maxTicksLimit: 8 } },
              y: { beginAtZero: chartMetric === 'playing', grid: { color: dark ? '#2A2836' : '#EDECF5' }, ticks: { color: dark ? '#8C89A0' : '#6B6880', callback: v => bigNum(v) } }
            }
          }
        });
      }

      async function loadBoard() {
        boardError = null;
        try {
          const json = await callHrData('board_get', { teamId });
          board = json.data;
        } catch (e) {
          boardError = e.code === 'not_on_this_team' ? 'Only people on this team can open its board.' : (e.message || 'Could not load the board.');
        }
        if (myGen === renderGen) paint();
      }

      async function boardAction(fn, successText) {
        boardBusy = true; paint();
        try {
          await fn();
          boardBusy = false;
          if (successText) toast(successText);
          await loadBoard();
        } catch (e) {
          boardBusy = false;
          toast(e.message || 'That did not save.', 'err');
          paint();
        }
      }

      function wireBoard() {
        if (tab !== 'board' || !board) return;

        const search = document.getElementById('bdSearch');
        if (search) search.addEventListener('input', debounce(() => {
          boardSearch = search.value;
          paint();
          const again = document.getElementById('bdSearch');
          if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
        }, 140));
        document.querySelectorAll('[data-board-filter]').forEach(el => el.addEventListener('click', () => {
          boardFilter = el.dataset.boardFilter;
          paint();
        }));
        document.querySelectorAll('[data-quick-add]').forEach(inp => inp.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter') return;
          const title = inp.value.trim();
          if (!title) return;
          inp.value = '';
          boardAction(() => callHrData('board_save_card', { teamId, mode: 'create', listId: inp.dataset.quickAdd, title }), 'Card added');
        }));

        const addList = document.getElementById('bdAddListBtn');
        const listInput = document.getElementById('bdNewListInput');
        if (addList) addList.addEventListener('click', () => {
          const title = listInput.value.trim();
          if (!title) { toast('Give the column a name.', 'err'); listInput.focus(); return; }
          boardAction(() => callHrData('board_save_list', { teamId, mode: 'create', title }), 'Column added');
        });
        if (listInput) listInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && addList) addList.click(); });

        document.querySelectorAll('[data-rename-list]').forEach(el => el.addEventListener('click', () => {
          const current = el.textContent.trim();
          const title = prompt('Rename this column', current);
          if (title === null || !title.trim() || title.trim() === current) return;
          boardAction(() => callHrData('board_save_list', { teamId, mode: 'rename', id: el.dataset.renameList, title: title.trim() }), 'Column renamed');
        }));

        document.querySelectorAll('[data-delete-list]').forEach(el => el.addEventListener('click', async () => {
          const id = el.dataset.deleteList;
          const count = board.cards.filter(c => String(c.list_id) === String(id)).length;
          const msg = count
            ? `Delete this column and its ${count} card${count === 1 ? '' : 's'}? This cannot be undone.`
            : 'Delete this column?';
          if (!(await askConfirm(msg))) return;
          boardAction(() => callHrData('board_save_list', { teamId, mode: 'delete', id, force: true }), 'Column deleted');
        }));

        document.querySelectorAll('[data-move-list]').forEach(el => el.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const id = el.dataset.moveList;
          const dir = el.dataset.dir;
          const idx = board.lists.findIndex(l => String(l.id) === String(id));
          if (idx < 0) return;
          const swapIdx = dir === 'left' ? idx - 1 : idx + 1;
          if (swapIdx < 0 || swapIdx >= board.lists.length) return;
          const next = board.lists.slice();
          const tmp = next[idx];
          next[idx] = next[swapIdx];
          next[swapIdx] = tmp;
          board.lists = next;
          paint();
          const order = board.lists.map(l => l.id);
          boardAction(() => callHrData('board_save_list', { teamId, mode: 'reorder', order }));
        }));

        document.querySelectorAll('[data-add-card]').forEach(el => el.addEventListener('click', () => {
          boardCard = { list_id: el.dataset.addCard, title: '', description: '', due_at: '', assigned_to_user_id: '', label: '' };
          paint();
          const t = document.getElementById('bdTitle');
          if (t) t.focus();
        }));

        document.querySelectorAll('[data-card]').forEach(el => {
          const open = () => {
            boardCard = board.cards.find(c => String(c.id) === String(el.dataset.card)) || null;
            paint();
          };
          el.addEventListener('click', open);
          el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); open(); } });
          el.addEventListener('dragstart', (e) => {
            boardDragId = el.dataset.card;
            const fromZone = el.closest('.bd-cards');
            boardDragFromList = fromZone ? fromZone.dataset.drop : null;
            el.classList.add('dragging');
            if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', el.dataset.card); }
          });
          el.addEventListener('dragend', () => {
            el.classList.remove('dragging');
            boardDragId = null;
            boardDragFromList = null;
            document.querySelectorAll('.bd-cards').forEach(z => z.classList.remove('drop-target'));
          });
          el.addEventListener('dragover', (e) => {
            if (!boardDragId || boardDragId === el.dataset.card) return;
            e.preventDefault();
            e.stopPropagation();
            const dragEl = document.querySelector(`.bd-card[data-card="${CSS.escape(boardDragId)}"]`);
            if (!dragEl || dragEl === el) return;
            const zone = el.closest('.bd-cards');
            if (zone && zone.dataset.drop !== boardDragFromList) {
              if (dragEl.parentNode !== zone) zone.appendChild(dragEl);
              return;
            }
            const rect = el.getBoundingClientRect();
            const before = (e.clientY - rect.top) < rect.height / 2;
            el.parentNode.insertBefore(dragEl, before ? el : el.nextSibling);
          });
        });

        document.querySelectorAll('[data-drop]').forEach(zone => {
          zone.addEventListener('dragover', (e) => {
            if (!boardDragId) return;
            e.preventDefault();
            zone.classList.add('drop-target');
            if (e.target === zone || zone.dataset.drop !== boardDragFromList) {
              const dragEl = document.querySelector(`.bd-card[data-card="${CSS.escape(boardDragId)}"]`);
              if (dragEl && dragEl.parentNode !== zone) zone.appendChild(dragEl);
            }
          });
          zone.addEventListener('dragleave', (e) => { if (e.target === zone) zone.classList.remove('drop-target'); });
          zone.addEventListener('drop', (e) => {
            if (!boardDragId) return;
            e.preventDefault();
            e.stopPropagation();
            zone.classList.remove('drop-target');
            const cardId = boardDragId;
            const listId = zone.dataset.drop;
            const card = board.cards.find(c => String(c.id) === String(cardId));
            if (!card) return;
            const order = Array.from(zone.querySelectorAll('[data-card]')).map(c => c.dataset.card);
            card.list_id = listId;
            const ordered = order.map(id => board.cards.find(c => String(c.id) === String(id))).filter(Boolean);
            const others = board.cards.filter(c => !order.some(id => String(id) === String(c.id)));
            board.cards = others.concat(ordered);
            paint();
            boardAction(() => callHrData('board_save_card', { teamId, mode: 'move', id: cardId, listId, order }));
          });
        });

        document.querySelectorAll('[data-list-drag]').forEach(header => {
          const section = header.closest('.bd-list');
          if (!section) return;
          header.addEventListener('dragstart', (e) => {
            boardListDragId = section.dataset.list;
            section.classList.add('dragging-list');
            if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'list:' + section.dataset.list); }
          });
          header.addEventListener('dragend', () => { section.classList.remove('dragging-list'); boardListDragId = null; });
        });

        document.querySelectorAll('.bd-list[data-list]').forEach(section => {
          section.addEventListener('dragover', (e) => {
            if (!boardListDragId || boardListDragId === section.dataset.list) return;
            e.preventDefault();
            const dragEl = document.querySelector(`.bd-list[data-list="${CSS.escape(boardListDragId)}"]`);
            if (!dragEl || dragEl === section) return;
            const rect = section.getBoundingClientRect();
            const before = (e.clientX - rect.left) < rect.width / 2;
            section.parentNode.insertBefore(dragEl, before ? section : section.nextSibling);
          });
          section.addEventListener('drop', (e) => {
            if (!boardListDragId) return;
            e.preventDefault();
            e.stopPropagation();
            const order = Array.from(document.querySelectorAll('.bd-list[data-list]')).map(s => s.dataset.list);
            board.lists = order.map(id => board.lists.find(l => String(l.id) === String(id))).filter(Boolean);
            paint();
            boardAction(() => callHrData('board_save_list', { teamId, mode: 'reorder', order }));
          });
        });

        document.querySelectorAll('[data-pick-label]').forEach(btn => btn.addEventListener('click', () => {
          const input = document.getElementById('bdLabel');
          if (!input) return;
          const val = btn.dataset.pickLabel;
          input.value = (input.value.trim() === val) ? '' : val;
          document.querySelectorAll('[data-pick-label]').forEach(b => b.classList.toggle('on', b.dataset.pickLabel === input.value.trim()));
        }));

        const closeCard = () => { boardCard = null; paint(); };
        ['bdCardClose', 'bdCancelCard'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.addEventListener('click', closeCard);
        });
        const scrim = document.getElementById('bdCardScrim');
        if (scrim) scrim.addEventListener('click', (e) => { if (e.target === scrim) closeCard(); });

        const saveCard = document.getElementById('bdSaveCard');
        if (saveCard) saveCard.addEventListener('click', () => {
          const title = document.getElementById('bdTitle').value.trim();
          if (!title) { toast('Give the card a name.', 'err'); return; }
          const due = document.getElementById('bdDue').value;
          const assignee = document.getElementById('bdAssignee').value;
          const assigneeName = assignee
            ? (String(assignee) === String(board.me.robloxUserId)
              ? board.me.robloxUsername
              : (board.members.find(m => String(m.roblox_user_id) === String(assignee)) || {}).roblox_username)
            : null;
          const payload = {
            teamId,
            mode: boardCard.id ? 'update' : 'create',
            id: boardCard.id,
            listId: boardCard.list_id,
            title,
            description: document.getElementById('bdDesc').value.trim(),
            dueAt: due ? new Date(due + 'T23:59:59').toISOString() : null,
            assignedToUserId: assignee || null,
            assignedToUsername: assigneeName || null,
            label: document.getElementById('bdLabel').value.trim() || null
          };
          const wasNew = !boardCard.id;
          boardCard = null;
          boardAction(() => callHrData('board_save_card', payload), wasNew ? 'Card added' : 'Card saved');
        });

        const deleteCard = document.getElementById('bdDeleteCard');
        if (deleteCard) deleteCard.addEventListener('click', async () => {
          if (!(await askConfirm('Delete this card?'))) return;
          const id = boardCard.id;
          boardCard = null;
          boardAction(() => callHrData('board_save_card', { teamId, mode: 'delete', id }), 'Card deleted');
        });
      }

      async function loadAddPeople() {
        addPeopleLoading = true;
        addPeopleError = null;
        try {
          const [json] = await Promise.all([
            callHrData('list_people_for_team', { teamId }),
            loadCatalog('skillsets').catch(() => [])
          ]);
          addPeopleList = json.data || [];
        } catch (e) {
          addPeopleError = e.message || 'Could not load the list of people.';
        }
        addPeopleLoading = false;
        if (myGen === renderGen && addPeopleOpen) paint();
      }

      async function run(fn, successText, after) {
        busy = true; paint();
        let result = null;
        try {
          result = await fn();
          if (after) after();
          toast(successText);
          busy = false;
          await load();
          return result;
        } catch (e) {
          busy = false;
          toast(e.message || 'That did not save.', 'err');
          paint();
        }
      }

      async function load(refreshStats) {
        loading = !overview && !detail && !gamesList && !gameDetail;
        loadError = null;
        paint();
        try {
          if (gameId) {
            const json = await callHrData('game_detail', { gameId, refreshStats: !!refreshStats });
            gameDetail = json.data;
            gameDetail.games = [{ id: gameDetail.game.id, name: gameDetail.game.name }];
            detail = null;
          } else if (view === 'games') {
            const json = await callHrData('games_overview');
            gamesList = json.data;
            detail = null; gameDetail = null;
          } else if (teamId) {
            const json = await callHrData('team_detail', { teamId, refreshStats: !!refreshStats });
            detail = json.data;
          } else if (view === 'org') {
            const json = await callHrData('org_chart');
            org = json.data;
            detail = null;
            if (!orgOpenTeams.size && org.totals.onATeam <= 40) {
              orgOpenTeams = new Set([...org.teams.filter(t => t.members.length).map(t => String(t.id)), 'none']);
            }
          } else {
            const json = await callHrData('teams_overview');
            overview = json.data;
            detail = null;
          }
        } catch (e) {
          loadError = e.message || 'Could not load teams.';
          if (e.code === 'team_not_found') { teamId = null; loadError = null; history.replaceState(null, '', '#/teams'); }
          if (e.code === 'game_not_found') { gameId = null; gameDetail = null; loadError = null; history.replaceState(null, '', '#/teams?view=games'); }
        }
        if (myGen !== renderGen) return;
        loading = false;
        paint();
      }

      load();
    }

    function renderStaffDatabase() {
      if (!authReady) { app.innerHTML = topbar(); return; }
      if (!isHrAuthed) { renderHrGate(); return; }
      if (!hasPermission('staff.view_database')) { window.location.hash = hasPermission('dashboard.view') ? '#/dashboard' : '#/'; return; }

      const myGen = renderGen;
      const query = parseHashQuery();
      const canAssign = hasPermission('settings.manage_onboarding') || hasPermission('roles.manage');
      const canModerate = hasPermission('staff.moderate');
      const canInvite = hasPermission('settings.manage_onboarding');
      let staff = peopleCache.rows.length ? peopleCache.rows : [];
      let loading = !staff.length;
      let loadError = null;
      let search = '';
      let staffTab = query.get('tab') === 'moderation' && canModerate ? 'moderation' : 'people';
      let chip = 'all';
      let sortBy = 'active';
      let pendingOpen = query.get('user') ? { id: query.get('user'), tab: { config: 'teams', payment: 'payout' }[query.get('open')] || query.get('open') || 'overview' } : null;
      let modOverview = null;
      let modLoading = false;
      let staffLoadInFlight = false;
      let staffRefreshQueued = false;
      let staffRefreshTimer = null;
      let modRefreshTimer = null;
      let staffSnapshot = '';
      let modError = null;

      let inviteModalOpen = false;
      let inviteOptionsLoading = false;
      let inviteOptionsError = null;
      let inviteTeams = [];
      let inviteSkillsets = [];
      let inviteRoles = [];
      let inviteTargetUsername = '';
      let inviteTeamId = '';
      let inviteSkillsetId = '';
      let inviteRoleId = '';
      let inviteLabel = '';
      let inviteBusy = false;
      let inviteError = null;
      let inviteResultUrl = null;
      let inviteResultUsername = null;

      const CHIPS = [
        { id: 'all', label: 'Everyone', test: () => true },
        { id: 'pending', label: 'Waiting on payment', test: s => s.pendingCount > 0 },
        { id: 'onboarding', label: 'Onboarding unfinished', test: s => s.onboardingRequired && s.onboardingCompleted < s.onboardingRequired },
        { id: 'noteam', label: 'No team', test: s => !s.team },
        { id: 'warned', label: 'Has warnings', test: s => s.warnCount > 0 && !s.isBanned },
        { id: 'banned', label: 'Banned', test: s => s.isBanned }
      ];
      const SORTS = {
        active: { label: 'Recently active', fn: (a, b) => new Date(b.lastActive || 0) - new Date(a.lastActive || 0) },
        requests: { label: 'Most requests', fn: (a, b) => (b.requestCount || 0) - (a.requestCount || 0) },
        pending: { label: 'Most pending', fn: (a, b) => (b.pendingCount || 0) - (a.pendingCount || 0) },
        warnings: { label: 'Most warnings', fn: (a, b) => (b.isBanned - a.isBanned) || (b.warnCount || 0) - (a.warnCount || 0) },
        name: { label: 'Name (A-Z)', fn: (a, b) => (a.robloxUsername || '').localeCompare(b.robloxUsername || '') }
      };

      function matchesSearch(s) {
        const q = search.trim().toLowerCase();
        if (!q) return true;
        return (s.robloxUsername || '').toLowerCase().includes(q) ||
          String(s.robloxUserId || '') === q ||
          (s.roles || []).some(r => r.toLowerCase().includes(q)) ||
          (s.team || '').toLowerCase().includes(q) ||
          (s.skillset || '').toLowerCase().includes(q);
      }

      function getRows() {
        const c = CHIPS.find(x => x.id === chip) || CHIPS[0];
        return staff.filter(s => matchesSearch(s) && c.test(s)).sort(SORTS[sortBy].fn);
      }

      function chipsHtml() {
        const base = staff.filter(matchesSearch);
        return CHIPS.filter(c => c.id !== 'banned' || staff.some(s => s.isBanned)).map(c => {
          const n = base.filter(c.test).length;
          return `<button type="button" class="chip-filter ${chip === c.id ? 'on' : ''}" data-chip="${c.id}" aria-pressed="${chip === c.id}">${esc(c.label)} <b>${n}</b></button>`;
        }).join('');
      }

      function badgeHtml(s) {
        if (s.isBanned) return `<span class="pending-badge" style="background:var(--err-bg);border-color:var(--err-line);color:var(--err-text);">Banned</span>`;
        if (s.warnCount) return `<span class="pending-badge">${esc(s.warnCount)}/3 warnings</span>`;
        if (s.pendingCount) return `<span class="pending-badge">${esc(s.pendingCount)} pending</span>`;
        return '';
      }

      function cardsHtml() {
        if (loading && !staff.length) return `<div class="dash-loading">Loading staff...</div>`;
        if (loadError && !staff.length) return `<div class="dash-empty"><h3>Could not load staff</h3><p>${esc(loadError)}</p><button type="button" class="btn btn-ghost btn-sm" id="retryStaffBtn">Try again</button></div>`;
        const rows = getRows();
        if (!rows.length) return `
          <div class="dash-empty">
            <h3>No one matches</h3>
            <p>${search.trim() ? `Nobody matches "${esc(search.trim())}"${chip !== 'all' ? ' with this filter' : ''}.` : 'Nobody fits this filter right now.'}</p>
            <button type="button" class="btn btn-ghost btn-sm" id="clearStaffFilters">Show everyone</button>
          </div>`;
        return `<div class="staff-grid">${rows.map((s, i) => {
          const outranks = (Number(s.maxHierarchy) || 0) >= hrMaxHierarchy;
          return `
          <div class="staff-card" data-staff-idx="${i}" tabindex="0" role="button" aria-label="Open ${esc(s.robloxUsername || 'profile')}">
            ${badgeHtml(s)}
            <div class="avatar-wrap">${avatarImg(s.robloxUserId, '')}</div>
            <div class="staff-name">${esc(s.robloxUsername || 'Unknown')}</div>
            <div class="staff-id">${s.team ? esc(s.team) : 'No team'}</div>
            <div class="staff-roles">${(s.roles || []).length ? s.roles.map(r => `<span class="perm-chip">${esc(r)}</span>`).join('') : `<span class="hint">No roles</span>`}</div>
            <div class="staff-stats-row">
              <div class="staff-stat"><b>${esc(s.requestCount || 0)}</b><span>Requests</span></div>
              <div class="staff-stat"><b>${s.onboardingRequired ? `${esc(s.onboardingCompleted)}/${esc(s.onboardingRequired)}` : '-'}</b><span>Onboard</span></div>
              <div class="staff-stat"><b>${s.lastActive ? esc(shortAgo(s.lastActive)) : '-'}</b><span>Active</span></div>
            </div>
            ${s.robloxUserId && (canAssign || canModerate) ? `
            <div class="staff-card-actions">
              ${canAssign ? `<button type="button" class="btn btn-ghost btn-sm" data-staff-open="${i}" data-open-tab="${hasPermission('settings.manage_onboarding') ? 'teams' : 'roles'}">Teams &amp; roles</button>` : ''}
              ${canModerate ? `<button type="button" class="btn btn-ghost btn-sm" data-staff-open="${i}" data-open-tab="moderation">${outranks ? 'View record' : (s.isBanned ? 'Review ban' : 'Moderate')}</button>` : ''}
            </div>` : ''}
          </div>`;
        }).join('')}</div>`;
      }

      function openPerson(p, tab) {
        if (p) openUserMenu(p.robloxUserId, p.robloxUsername, tab || 'overview');
      }

      function wirePeople() {
        const retryBtn = document.getElementById('retryStaffBtn');
        if (retryBtn) retryBtn.addEventListener('click', load);
        const clearBtn = document.getElementById('clearStaffFilters');
        if (clearBtn) clearBtn.addEventListener('click', () => {
          chip = 'all'; search = '';
          const si = document.getElementById('staffSearchInput'); if (si) si.value = '';
          paintPeople();
        });
        document.querySelectorAll('[data-staff-idx]').forEach(el => {
          el.addEventListener('click', (e) => { if (e.target.closest('button')) return; openPerson(getRows()[Number(el.dataset.staffIdx)]); });
          el.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); openPerson(getRows()[Number(el.dataset.staffIdx)]); } });
        });
        document.querySelectorAll('[data-staff-open]').forEach(el => el.addEventListener('click', () => openPerson(getRows()[Number(el.dataset.staffOpen)], el.dataset.openTab)));
        document.querySelectorAll('[data-chip]').forEach(el => el.addEventListener('click', () => { chip = el.dataset.chip; paintPeople(); }));
      }

      function paintPeople() {
        if (staffTab !== 'people' || myGen !== renderGen) return;
        const area = document.getElementById('staffTableArea');
        if (area) area.innerHTML = cardsHtml();
        const chipsEl = document.getElementById('staffChips');
        if (chipsEl) chipsEl.innerHTML = staff.length ? chipsHtml() : '';
        const countEl = document.getElementById('staffTotalCount');
        if (countEl) countEl.textContent = staff.length ? `${staff.length} people` : 'Loading...';
        wirePeople();
      }

      async function loadModeration() {
        modLoading = true; modError = null; paintModeration();
        try {
          const json = await callHrData('moderation_overview');
          modOverview = json.data;
        } catch (e) {
          modError = e.message;
        }
        modLoading = false;
        if (myGen === renderGen) paintModeration();
      }

      function modPersonRow(id, name, bodyHtml, tab, label) {
        return `<div class="mod-list-item">
          ${avatarImg(id, '')}
          <div class="grow">
            <div>${userLink(id, name)}</div>
            ${bodyHtml}
          </div>
          <button type="button" class="btn btn-ghost btn-sm" data-mod-open="${esc(id)}" data-mod-name="${esc(name || '')}">${label}</button>
        </div>`;
      }

      function paintModeration() {
        if (staffTab !== 'moderation' || myGen !== renderGen) return;
        const area = document.getElementById('staffTableArea');
        if (!area) return;
        if (modLoading && !modOverview) { area.innerHTML = `<div class="dash-loading">Loading moderation overview...</div>`; return; }
        if (modError) {
          area.innerHTML = `<div class="dash-empty"><h3>Could not load moderation</h3><p>${esc(modError)}</p><button type="button" class="btn btn-ghost btn-sm" id="retryModBtn">Try again</button></div>`;
          document.getElementById('retryModBtn').addEventListener('click', loadModeration);
          return;
        }
        const o = modOverview || { bans: [], warned: [], recent: [] };
        area.innerHTML = `
          <div class="mod-grid">
            <div style="display:flex;flex-direction:column;gap:20px;">
              <div class="panel">
                <h2 class="sec-title" style="font-size:15px;">Banned (${o.bans.length})</h2>
                <p class="hint" style="margin:0 0 8px;">Can't sign in. Timed bans end on their own.</p>
                ${o.bans.length ? o.bans.map(b => modPersonRow(b.roblox_user_id, b.roblox_username,
          `<div class="why">${esc(b.reason || 'No reason given')}</div>
                   <div class="when">${b.expires_at ? `Ends ${esc(relTime(b.expires_at))}` : 'Permanent'} &middot; by ${esc(b.banned_by || 'unknown')} ${esc(relTime(b.banned_at))}</div>`, 'moderation', 'Review')).join('')
            : `<p class="hint" style="margin:8px 0 0;">No one is banned.</p>`}
              </div>
              <div class="panel">
                <h2 class="sec-title" style="font-size:15px;">On warnings (${o.warned.length})</h2>
                <p class="hint" style="margin:0 0 8px;">A third warning bans the account automatically.</p>
                ${o.warned.length ? o.warned.map(w => modPersonRow(w.robloxUserId, w.robloxUsername,
              `<div class="why">${strikesHtml(w.count)} <span style="margin-left:6px;">${esc(w.lastReason || '')}</span></div>
                   <div class="when">Last warned ${esc(relTime(w.lastAt))}${w.lastBy ? ` by ${esc(w.lastBy)}` : ''}</div>`, 'moderation', 'Review')).join('')
            : `<p class="hint" style="margin:8px 0 0;">No active warnings.</p>`}
              </div>
            </div>
            <div class="panel">
              <h2 class="sec-title" style="font-size:15px;margin-bottom:12px;">Recent activity</h2>
              ${o.recent.length ? `<ul class="timeline">${o.recent.map(h => modEventHtml(h).replace('<div class="t-meta">', `<div class="t-meta">${h.target_user_id || h.target_username ? userLink(h.target_user_id, h.target_username) + ' &middot; ' : ''}`)).join('')}</ul>`
            : `<p class="hint" style="margin:0;">No moderation actions yet. Open anyone's name to add a note, warning or ban.</p>`}
            </div>
          </div>`;
        area.querySelectorAll('[data-mod-open]').forEach(el => el.addEventListener('click', () => openUserMenu(el.dataset.modOpen, el.dataset.modName, 'moderation')));
      }

      function paintShell() {
        app.innerHTML = `
    ${topbar()}
    <div class="dash-shell">
      <div class="dash-head">
        <div>
          <h1 style="margin-bottom:4px;">Staff</h1>
          <p class="sub"><span id="staffTotalCount">${staff.length ? `${staff.length} people` : 'Loading...'}</span>. Click anyone to see and manage their teams, skills, roles, payout and record in one place.</p>
        </div>
        <div class="dash-toolbar">
          ${canInvite ? `<button type="button" class="btn btn-primary btn-sm" id="openInviteBtn">Invite</button>` : ''}
          <button type="button" class="btn btn-ghost btn-sm" id="refreshStaffBtn">Refresh</button>
        </div>
      </div>
      ${canModerate ? `
      <div class="tabs" style="margin-bottom:16px;" role="tablist">
        <button type="button" role="tab" aria-selected="${staffTab === 'people'}" class="tab-btn ${staffTab === 'people' ? 'active' : ''}" data-staff-tab="people">People</button>
        <button type="button" role="tab" aria-selected="${staffTab === 'moderation'}" class="tab-btn ${staffTab === 'moderation' ? 'active' : ''}" data-staff-tab="moderation">Moderation</button>
      </div>` : ''}
      ${staffTab === 'people' ? `
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;align-items:center;">
        <div class="search-input-wrap">
          <input type="text" id="staffSearchInput" placeholder="Search name, ID, role or team" value="${esc(search)}" aria-label="Search staff">
        </div>
        <select id="staffSortSelect" class="filter-select" aria-label="Sort by">
          ${Object.entries(SORTS).map(([k, v]) => `<option value="${k}" ${sortBy === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}
        </select>
      </div>
      <div class="chip-filters" id="staffChips" style="margin-bottom:16px;"></div>` : ''}
      <div class="${staffTab === 'people' ? 'table-wrap' : ''}" id="staffTableArea"></div>
    </div>
    <div id="inviteModalContainer"></div>`;

        wireTopbarSignOut();
        document.querySelectorAll('[data-staff-tab]').forEach(el => el.addEventListener('click', () => {
          staffTab = el.dataset.staffTab;
          history.replaceState(null, '', staffTab === 'moderation' ? '#/staff?tab=moderation' : '#/staff');
          paintShell();
          if (staffTab === 'moderation') { if (!modOverview) loadModeration(); else paintModeration(); }
        }));
        const searchInput = document.getElementById('staffSearchInput');
        if (searchInput) searchInput.addEventListener('input', debounce(() => { search = searchInput.value; paintPeople(); }, 120));
        const sortSel = document.getElementById('staffSortSelect');
        if (sortSel) sortSel.addEventListener('change', () => { sortBy = sortSel.value; paintPeople(); });
        document.getElementById('refreshStaffBtn').addEventListener('click', () => { if (staffTab === 'moderation') loadModeration(); load(); });
        const inviteBtn = document.getElementById('openInviteBtn');
        if (inviteBtn) inviteBtn.addEventListener('click', openInviteModal);
        paintPeople();
        paintModeration();
        paintInviteModal();
      }

      async function openInviteModal() {
        inviteModalOpen = true;
        inviteError = null;
        inviteResultUrl = null;
        inviteResultUsername = null;
        paintInviteModal();
        if (!inviteTeams.length && !inviteOptionsLoading) {
          inviteOptionsLoading = true;
          inviteOptionsError = null;
          paintInviteModal();
          try {
            const [t, sk, r] = await Promise.all([listTeams(), listSkillsets(), listRoles()]);
            inviteTeams = t || [];
            inviteSkillsets = sk || [];
            inviteRoles = r || [];
          } catch (e) {
            inviteOptionsError = (e && e.message) || 'Could not load teams and roles.';
          }
          inviteOptionsLoading = false;
          if (myGen === renderGen) paintInviteModal();
        }
      }

      function closeInviteModal() {
        inviteModalOpen = false;
        inviteError = null;
        inviteResultUrl = null;
        inviteResultUsername = null;
        inviteTargetUsername = '';
        inviteTeamId = '';
        inviteSkillsetId = '';
        inviteRoleId = '';
        inviteLabel = '';
        paintInviteModal();
      }

      function renderInviteModal() {
        return `
    <div class="modal-scrim" id="inviteModalScrim">
      <div class="modal-card" style="max-width:440px;">
        <button type="button" class="modal-close" id="inviteModalClose">&times;</button>
        <div class="modal-body" style="padding-top:8px;">
          <h3 style="margin-top:0;">Invite someone</h3>
          <p style="color:var(--ink-soft);font-size:13px;">Enter their Roblox username, then pick a team, skill and optional role. Only that Roblox account can use the link, and it takes them straight through Discord linking and their team setup.</p>
          ${inviteOptionsLoading ? `<div style="text-align:center;color:var(--muted);padding:16px 0;">Loading teams and roles...</div>` : `
          ${inviteOptionsError ? `<div class="error-box"><span>${esc(inviteOptionsError)}</span></div>` : ''}
          ${inviteError ? `<div class="error-box"><span>${esc(inviteError)}</span></div>` : ''}
          ${inviteResultUrl ? `<div class="confirm-box"><div class="icon">&#10003;</div><div class="txt"><strong>Invite ready for ${esc(inviteResultUsername)}</strong><div style="color:var(--ink-soft);font-size:13px;margin-bottom:6px;">Only their Roblox account can use this link.</div><span class="mono" style="word-break:break-all;">${esc(inviteResultUrl)}</span></div></div>` : ''}
          <div class="field" style="text-align:left;">
            <label>Roblox username</label>
            <input type="text" id="inviteUsernameInput" placeholder="e.g. Builderman" value="${esc(inviteTargetUsername)}" ${inviteBusy ? 'disabled' : ''}>
          </div>
          <div class="field" style="text-align:left;">
            <label>Team</label>
            <select id="inviteTeamSelect" ${inviteBusy ? 'disabled' : ''}>
              <option value="">No team</option>
              ${inviteTeams.map(t => `<option value="${esc(t.id)}" ${String(inviteTeamId) === String(t.id) ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field" style="text-align:left;">
            <label>Skillset</label>
            <select id="inviteSkillsetSelect" ${inviteBusy ? 'disabled' : ''}>
              <option value="">No skillset</option>
              ${inviteSkillsets.map(s => `<option value="${esc(s.id)}" ${String(inviteSkillsetId) === String(s.id) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field" style="text-align:left;">
            <label>Role <span class="hint">(optional)</span></label>
            <select id="inviteRoleSelect" ${inviteBusy ? 'disabled' : ''}>
              <option value="">No role</option>
              ${inviteRoles.map(r => `<option value="${esc(r.id)}" ${String(inviteRoleId) === String(r.id) ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field" style="text-align:left;">
            <label>Label <span class="hint">(optional)</span></label>
            <input type="text" id="inviteLabelInput" placeholder="e.g. Alex for design" value="${esc(inviteLabel)}" ${inviteBusy ? 'disabled' : ''}>
          </div>
          <div style="display:flex;gap:10px;justify-content:center;margin-top:6px;">
            <button type="button" class="btn btn-primary" id="inviteCreateBtn" ${inviteBusy ? 'disabled' : ''}>${inviteBusy ? 'Creating...' : inviteResultUrl ? 'Create another' : 'Create invite'}</button>
            <button type="button" class="btn btn-ghost" id="inviteCancelBtn">${inviteResultUrl ? 'Done' : 'Cancel'}</button>
          </div>`}
        </div>
      </div>
    </div>`;
      }

      function paintInviteModal() {
        if (renderGen !== myGen) return;
        const container = document.getElementById('inviteModalContainer');
        if (!container) return;
        container.innerHTML = inviteModalOpen ? renderInviteModal() : '';
        wireInviteModal();
      }

      function wireInviteModal() {
        const scrim = document.getElementById('inviteModalScrim');
        if (scrim) scrim.addEventListener('click', (e) => { if (e.target === scrim) closeInviteModal(); });
        const close = document.getElementById('inviteModalClose');
        if (close) close.addEventListener('click', closeInviteModal);
        const cancel = document.getElementById('inviteCancelBtn');
        if (cancel) cancel.addEventListener('click', closeInviteModal);
        const usernameInput = document.getElementById('inviteUsernameInput');
        if (usernameInput) usernameInput.addEventListener('input', () => { inviteTargetUsername = usernameInput.value; });
        const teamSel = document.getElementById('inviteTeamSelect');
        if (teamSel) teamSel.addEventListener('change', () => { inviteTeamId = teamSel.value; });
        const skillSel = document.getElementById('inviteSkillsetSelect');
        if (skillSel) skillSel.addEventListener('change', () => { inviteSkillsetId = skillSel.value; });
        const roleSel = document.getElementById('inviteRoleSelect');
        if (roleSel) roleSel.addEventListener('change', () => { inviteRoleId = roleSel.value; });
        const labelInput = document.getElementById('inviteLabelInput');
        if (labelInput) labelInput.addEventListener('input', () => { inviteLabel = labelInput.value; });
        const createBtn = document.getElementById('inviteCreateBtn');
        if (createBtn) createBtn.addEventListener('click', async () => {
          const username = inviteTargetUsername.trim();
          if (!username) { inviteError = 'Enter the Roblox username you\'re inviting.'; paintInviteModal(); return; }
          inviteBusy = true; inviteError = null; paintInviteModal();
          try {
            const result = await createOnboardingLink(inviteTeamId || null, inviteSkillsetId || null, inviteRoleId || null, inviteLabel.trim() || null, username);
            inviteResultUrl = result && result.url ? result.url : null;
            inviteResultUsername = (result && result.targetUsername) || username;
            inviteTargetUsername = ''; inviteTeamId = ''; inviteSkillsetId = ''; inviteRoleId = ''; inviteLabel = '';
          } catch (e) {
            inviteError = (e && e.message) || 'Could not create that invite.';
          }
          inviteBusy = false;
          if (myGen === renderGen) paintInviteModal();
        });
      }

      async function load(quiet) {
        if (staffLoadInFlight) { staffRefreshQueued = staffRefreshQueued || !!quiet; return; }
        staffLoadInFlight = true;
        loadError = null;
        if (!staff.length) { loading = true; paintPeople(); }
        const btn = quiet ? null : document.getElementById('refreshStaffBtn');
        if (btn) { btn.disabled = true; btn.textContent = 'Refreshing...'; }
        try {
          staff = await loadStaffDatabase();
          rememberPeople(staff);
        } catch (err) {
          loadError = (err && err.message) ? err.message : 'Could not load staff.';
        }
        staffLoadInFlight = false;
        if (myGen !== renderGen) return;
        loading = false;
        const btn2 = quiet ? null : document.getElementById('refreshStaffBtn');
        if (btn2) { btn2.disabled = false; btn2.textContent = 'Refresh'; }
        const snapshot = JSON.stringify(staff);
        if (!quiet || snapshot !== staffSnapshot) paintPeople();
        staffSnapshot = snapshot;
        if (staffRefreshQueued) { staffRefreshQueued = false; setTimeout(() => load(true), 200); }
        if (pendingOpen) {
          history.replaceState(null, '', '#/staff');
          const p = staff.find(x => String(x.robloxUserId) === String(pendingOpen.id));
          openUserMenu(pendingOpen.id, p ? p.robloxUsername : null, pendingOpen.tab);
          pendingOpen = null;
        }
      }

      const onModerated = (e) => {
        if (myGen !== renderGen) { window.removeEventListener('pv:moderated', onModerated); return; }
        const d = e.detail || {};
        const row = staff.find(x => String(x.robloxUserId) === String(d.robloxUserId));
        if (row) { row.warnCount = d.warnCount; row.isBanned = d.isBanned; }
        paintPeople();
        if (staffTab === 'moderation') scheduleModerationRefresh();
      };
      const onPeopleChanged = () => {
        if (myGen !== renderGen) { window.removeEventListener('pv:people-changed', onPeopleChanged); return; }
        scheduleQuietRefresh();
      };
      function scheduleQuietRefresh() {
        clearTimeout(staffRefreshTimer);
        staffRefreshTimer = setTimeout(() => { if (myGen === renderGen) load(true); }, 400);
      }
      function scheduleModerationRefresh() {
        clearTimeout(modRefreshTimer);
        modRefreshTimer = setTimeout(() => { if (myGen === renderGen) loadModeration(); }, 400);
      }
      window.addEventListener('pv:moderated', onModerated);
      window.addEventListener('pv:people-changed', onPeopleChanged);

      paintShell();
      if (staffTab === 'moderation') loadModeration();
      load();
    }

    function renderAuditLogs() {
      if (!hasPermission('audit.view')) { window.location.hash = hasPermission('dashboard.view') ? '#/dashboard' : '#/'; return; }
      const myGen = renderGen;
      const canRevert = hasPermission('audit.revert');
      const canBackup = hasPermission('backups.manage');

      const auditQuery = parseHashQuery();
      let tab = auditQuery.get('tab') === 'backups' && canBackup ? 'backups' : 'logs';

      let logs = [];
      let logsLoading = true;
      let logsError = null;
      let category = 'all';
      let search = auditQuery.get('search') || '';
      let revertBusyId = null;

      let backups = [];
      let backupsLoading = false;
      let backupsError = null;
      let backupAllBusy = false;
      let backupMsg = null;
      let backupBusyId = null;

      window.__refreshCurrentAuditPage = () => { if (renderGen === myGen && tab === 'logs') loadLogs(); };

      const ACTION_LABELS = {
        quick_warn: 'Warned', add_user_warning: 'Warned', quick_ban: 'Banned', auto_ban: 'Banned (3 warnings)',
        quick_unban: 'Lifted ban', unban_user: 'Lifted ban', ban_expired: 'Timed ban ended', remove_user_warning: 'Removed warning',
        note: 'Added note', submit_request: 'Submitted payment request', mark_paid: 'Marked paid', reject_request: 'Rejected request',
        reopen_request: 'Reopened request', delete_request: 'Deleted request', revert: 'Reverted a change',
        auto_downgrade_payment_method: 'Payment method switched to Robux (below USD minimum)'
      };
      function actionLabel(a) {
        if (ACTION_LABELS[a]) return ACTION_LABELS[a];
        const t = String(a || '').replace(/_/g, ' ');
        return t.charAt(0).toUpperCase() + t.slice(1);
      }

      function detailsSummary(row) {
        const d = row.details || {};
        const parts = [];
        if (d.reason) parts.push(`Reason: ${d.reason}`);
        if (d.taskName) parts.push(`Task: ${d.taskName}`);
        if (d.payment != null) parts.push(`Amount: ${d.payment}${d.currency ? ' ' + d.currency : ''}`);
        if (d.warnCount != null) parts.push(`Warn count: ${d.warnCount}`);
        if (d.row_counts) parts.push(`Tables backed up: ${Object.keys(d.row_counts).length}`);
        if (d.original_action) parts.push(`Reverted: ${actionLabel(d.original_action)}`);
        if (!parts.length) return '-';
        return esc(parts.join(' · '));
      }

      function logRowHtml(row) {
        return `
      <tr>
        <td class="mono" style="white-space:nowrap;">${esc(fmtDateTime(row.created_at))}</td>
        <td><span class="category-chip ${esc(row.category)}">${esc(row.category)}</span></td>
        <td>${esc(actionLabel(row.action))}${row.reverted ? `<span class="audit-reverted-tag">&#8634; reverted</span>` : ''}</td>
        <td>${userLink(row.actor_user_id, row.actor_username)}</td>
        <td>${row.target_user_id || row.target_username ? userLink(row.target_user_id, row.target_username) : '<span class="hint">-</span>'}</td>
        <td class="audit-details-cell">${detailsSummary(row)}</td>
        <td class="actions-cell">
          ${canRevert && row.revert_data && !row.reverted
            ? `<button type="button" class="btn btn-ghost btn-sm" data-revert-id="${esc(row.id)}" ${revertBusyId === row.id ? 'disabled' : ''}>${revertBusyId === row.id ? 'Reverting...' : 'Revert'}</button>`
            : (row.reverted ? `<span class="hint">by ${esc(row.reverted_by || 'unknown')}</span>` : '')}
        </td>
      </tr>`;
      }

      function logsTableHtml() {
        if (logsLoading) return `<div class="dash-loading">Loading audit logs...</div>`;
        if (logsError) return `
      <div class="dash-empty">
        <h3>Could not load audit logs</h3>
        <p>${esc(logsError)}</p>
        <button type="button" class="btn btn-ghost btn-sm" id="retryLogsBtn">Try again</button>
      </div>`;
        if (!logs.length) return `<div class="dash-empty"><h3>Nothing here</h3><p>No audit log entries match.</p></div>`;
        return `
      <table class="req-table">
        <thead><tr><th>Time</th><th>Category</th><th>Action</th><th>Actor</th><th>Target</th><th>Details</th><th></th></tr></thead>
        <tbody>${logs.map(logRowHtml).join('')}</tbody>
      </table>`;
      }

      function backupsBodyHtml() {
        if (backupsLoading) return `<div class="dash-loading">Loading backups...</div>`;
        if (backupsError) return `
      <div class="dash-empty">
        <h3>Could not load backups</h3>
        <p>${esc(backupsError)}</p>
        <button type="button" class="btn btn-ghost btn-sm" id="retryBackupsBtn">Try again</button>
      </div>`;
        if (!backups.length) return `<div class="empty-note">No backups yet. Backups are also taken automatically every 6 hours.</div>`;
        return backups.map(b => `
      <div class="backup-card">
        <div class="backup-meta">
          <strong>${esc(b.trigger === 'manual' ? 'Manual backup' : 'Scheduled backup')}</strong>
          <span class="mono">${esc(fmtDateTime(b.created_at))} · by ${esc(b.created_by || 'system')}</span>
          <span class="mono">${(b.tables || []).length} tables · ${Object.values(b.row_counts || {}).reduce((s, n) => s + (Number(n) || 0), 0)} rows · ${((b.size_bytes || 0) / 1024).toFixed(1)} KB</span>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" class="btn btn-ghost btn-sm" data-load-backup="${esc(b.id)}" ${backupBusyId === b.id ? 'disabled' : ''}>${backupBusyId === b.id ? 'Working...' : 'Load / inspect'}</button>
          ${hasPermission('roles.manage') ? `<button type="button" class="btn btn-ghost btn-sm" data-restore-backup="${esc(b.id)}" ${backupBusyId === b.id ? 'disabled' : ''} style="color:var(--err-text);">Restore</button>` : ''}
        </div>
      </div>`).join('');
      }

      function paint() {
        app.innerHTML = `
    ${topbar()}
    <div class="dash-shell">
      <div class="dash-head">
        <div>
          <h1 style="margin-bottom:4px;">Audit logs</h1>
          <p class="sub">Every payment, moderation, and backup action taken in the tool, with who did it and who it was done to.</p>
        </div>
        <div class="dash-toolbar">
          <button type="button" class="btn btn-ghost btn-sm" id="refreshAuditBtn">Refresh</button>
        </div>
      </div>

      <div class="filter-bar">
        <div class="tabs">
          <button type="button" class="tab-btn ${tab === 'logs' ? 'active' : ''}" data-audit-tab="logs">Logs</button>
          ${canBackup ? `<button type="button" class="tab-btn ${tab === 'backups' ? 'active' : ''}" data-audit-tab="backups">Backups</button>` : ''}
        </div>
        ${tab === 'logs' ? `
        <div class="search-input-wrap">
          <input type="text" id="auditSearchInput" placeholder="Search by actor, target, or action" value="${esc(search)}">
        </div>
        <div class="filter-select-group">
          <select id="auditCategorySelect" class="filter-select">
            <option value="all" ${category === 'all' ? 'selected' : ''}>All categories</option>
            <option value="payments" ${category === 'payments' ? 'selected' : ''}>Payments</option>
            <option value="moderation" ${category === 'moderation' ? 'selected' : ''}>Moderation</option>
            <option value="backups" ${category === 'backups' ? 'selected' : ''}>Backups</option>
          </select>
        </div>` : ''}
      </div>

      ${tab === 'logs' ? `
      <div class="table-wrap" id="auditTableArea">${logsTableHtml()}</div>
      ` : `
      <div class="panel">
        <div class="preview-label" style="margin-bottom:10px;">Database backups</div>
        ${backupMsg ? `<div class="${backupMsg.ok ? 'confirm-box' : 'error-box'}" style="margin-bottom:12px;"><span>${esc(backupMsg.text)}</span></div>` : ''}
        <div style="margin-bottom:14px;">
          <button type="button" class="btn btn-primary btn-sm" id="backupAllBtn" ${backupAllBusy ? 'disabled' : ''}>${backupAllBusy ? 'Backing up...' : 'Backup All Data'}</button>
        </div>
        <div id="backupsListArea">${backupsBodyHtml()}</div>
      </div>
      `}
      <div class="footer-note">Data is stored in a database and shared across everyone using this tool. Scheduled backups run automatically every 6 hours.</div>
    </div>`;

        wireTopbarSignOut();
        wireEvents();
      }

      function wireEvents() {
        document.querySelectorAll('[data-audit-tab]').forEach(b => b.addEventListener('click', () => {
          tab = b.dataset.auditTab;
          if (tab === 'backups' && !backups.length && !backupsLoading) loadBackups();
          paint();
        }));

        const refreshBtn = document.getElementById('refreshAuditBtn');
        if (refreshBtn) refreshBtn.addEventListener('click', () => { tab === 'logs' ? loadLogs() : loadBackups(); });

        const searchInput = document.getElementById('auditSearchInput');
        if (searchInput) searchInput.addEventListener('input', debounce(() => { search = searchInput.value; loadLogs(); }, 350));

        const categorySelect = document.getElementById('auditCategorySelect');
        if (categorySelect) categorySelect.addEventListener('change', () => { category = categorySelect.value; loadLogs(); });

        const retryLogsBtn = document.getElementById('retryLogsBtn');
        if (retryLogsBtn) retryLogsBtn.addEventListener('click', loadLogs);
        const retryBackupsBtn = document.getElementById('retryBackupsBtn');
        if (retryBackupsBtn) retryBackupsBtn.addEventListener('click', loadBackups);

        document.querySelectorAll('[data-revert-id]').forEach(btn => btn.addEventListener('click', async () => {
          const id = btn.dataset.revertId;
          if (!(await askConfirm('Revert this action? This will undo it where possible.'))) return;
          revertBusyId = id; paint();
          try {
            await revertAuditLog(id);
            await loadLogs();
          } catch (e) {
            toast(e.message || 'Could not revert this entry.', 'err');
            revertBusyId = null; paint();
          }
        }));

        const backupAllBtn = document.getElementById('backupAllBtn');
        if (backupAllBtn) backupAllBtn.addEventListener('click', async () => {
          backupAllBusy = true; backupMsg = null; paint();
          try {
            const data = await backupAllData();
            backupMsg = { ok: true, text: `Backup created${data && data.row_counts ? ' · ' + Object.values(data.row_counts).reduce((s, n) => s + (Number(n) || 0), 0) + ' rows' : ''}.` };
            await loadBackups();
          } catch (e) {
            backupMsg = { ok: false, text: e.message || 'Backup failed.' };
          }
          backupAllBusy = false;
          paint();
        });

        document.querySelectorAll('[data-load-backup]').forEach(btn => btn.addEventListener('click', async () => {
          const id = btn.dataset.loadBackup;
          backupBusyId = id; backupMsg = null; paint();
          try {
            const res = await loadBackupData(id);
            const tables = (res.meta && res.meta.row_counts) ? Object.entries(res.meta.row_counts).map(([t, n]) => `${t}: ${n}`).join(', ') : '';
            backupMsg = { ok: true, text: `Loaded backup from ${fmtDateTime(res.meta.created_at)}. ${tables}` };
          } catch (e) {
            backupMsg = { ok: false, text: e.message || 'Could not load this backup.' };
          }
          backupBusyId = null;
          paint();
        }));

        document.querySelectorAll('[data-restore-backup]').forEach(btn => btn.addEventListener('click', async () => {
          const id = btn.dataset.restoreBackup;
          if (!(await askConfirm('Restore this backup? This will upsert every row from the backup back into the live database. It will not delete newer rows.'))) return;
          backupBusyId = id; backupMsg = null; paint();
          try {
            const res = await restoreBackupData(id);
            const summary = Object.entries(res.summary || {}).map(([t, s]) => `${t}: ${s.restored}`).join(', ');
            backupMsg = { ok: true, text: `Restore complete. ${summary}` };
          } catch (e) {
            backupMsg = { ok: false, text: e.message || 'Restore failed.' };
          }
          backupBusyId = null;
          paint();
        }));
      }

      async function loadLogs() {
        logsLoading = true; logsError = null; revertBusyId = null; paint();
        try {
          logs = await listAuditLogs(category, search);
        } catch (e) {
          logsError = e.message || 'Something went wrong while loading the audit log.';
        }
        if (myGen !== renderGen) return;
        logsLoading = false;
        paint();
      }

      async function loadBackups() {
        backupsLoading = true; backupsError = null; paint();
        try {
          backups = await listBackups();
        } catch (e) {
          backupsError = e.message || 'Something went wrong while loading backups.';
        }
        if (myGen !== renderGen) return;
        backupsLoading = false;
        paint();
      }

      loadLogs();
      if (tab === 'backups') loadBackups();
    }

    function renderCreateView() {
      if (!authReady) { app.innerHTML = topbar(); return; }

      if (!isHrAuthed) {
        app.innerHTML = `
    ${topbar()}
    <div class="lock-overlay">
      <div class="lock-card">
        <div class="gate-icon">${gateMark()}</div>
        <h2>Sign in to continue</h2>
        <p>Sign in with your Roblox account and be in the studio group at the required rank to log a payment request.</p>
        ${configError ? `<div class="error-box"><span>${esc(configError)}</span></div>` : ''}
        <button type="button" class="btn btn-primary roblox-btn" id="lockSignInBtn" ${configError ? 'disabled' : ''}>Sign in with Roblox</button>
        <div class="lock-note">You can't log a request until you sign in.</div>
      </div>
    </div>`;
        wireTopbarSignOut();
        const btn = document.getElementById('lockSignInBtn');
        if (btn) btn.addEventListener('click', () => beginLogin('#/new'));
        return;
      }

      if (!canSubmitRequests()) {
        window.location.hash = '#/my';
        return;
      }

      let submitted = false;
      let submitting = false;
      let submitError = null;
      let fieldErrors = {};
      let targetMethod = null;
      let targetMethodLoaded = false;
      let targetMethodLoading = false;
      let targetMethodLookupTimer = null;
      let lastLookedUpUsername = '';
      let usernameSuggestions = [];
      let usernameSuggestTimer = null;
      let usernameSuggestVisible = false;
      let ignoreEligibility = false;
      let currencyTouched = false;

      let userSkillsets = [];
      let userSkillsetsLoading = false;
      let userSkillsetsLoaded = false;
      let selectedSkillsetIds = new Set();

      function currentData() {
        const username = document.getElementById('f_username')?.value.trim() || '';
        const task = document.getElementById('f_task')?.value.trim() || '';
        const game = document.getElementById('f_game')?.value || '';
        const workRaw = document.getElementById('f_work')?.value || '';
        const timeWorked = document.getElementById('f_time')?.value.trim() || '';
        const paymentRaw = document.getElementById('f_payment')?.value || '0';
        const currency = document.getElementById('f_currency')?.value || 'ROBUX';
        const skillsetIds = Array.from(selectedSkillsetIds);
        const skillsetNames = userSkillsets.filter(s => selectedSkillsetIds.has(String(s.id))).map(s => s.name);
        return {
          id: '', robloxUsername: username, taskName: task, game, workRaw, timeWorked,
          payment: Number(paymentRaw) || 0, currency, skillsetIds, skillsetNames, requestedBy: hrUsername, createdAt: Date.now(), paid: false, paidAt: null
        };
      }

      function validate(data) {
        const errs = {};
        if (!data.robloxUsername) errs.f_username = "The developer's Roblox username is required.";
        if (!data.taskName) errs.f_task = 'Task name is required.';
        if (!data.game) errs.f_game = 'Select which game this work was for.';
        if (!data.payment || data.payment <= 0) errs.f_payment = 'Enter a payment amount greater than 0.';
        return errs;
      }

      function paint() {
        app.innerHTML = `
    ${topbar()}
    <div class="shell">
      <div class="heading-block">
        <h1>Log work</h1>
        <p class="sub">Log work someone else did. It goes to Review &amp; pay for approval and shows up in their My payments straight away.</p>
      </div>

      ${configError ? `<div class="error-box"><span>${esc(configError)}</span></div>` : ''}
       
      ${submitted ? `
      <div class="confirm-box">
        <div class="icon">&#10003;</div>
        <div class="txt"><strong>Logged</strong><span>It's waiting in Review &amp; pay, and they can see it in their My payments.</span></div>
      </div>
      <button type="button" class="btn btn-ghost" id="anotherBtn" style="margin-bottom:26px;">Log another request</button>
      ` : ''}

      <div class="create-grid">
        <div class="panel">
          ${submitError ? `<div class="error-box"><span>${esc(submitError)}</span></div>` : ''}
          <div class="field" style="position:relative;">
            <label>Their Roblox username</label>
            <input type="text" id="f_username" placeholder="Builderman" autocomplete="off" class="${fieldErrors.f_username ? 'field-invalid' : ''}">
            ${fieldErrors.f_username ? `<div class="err-hint">${esc(fieldErrors.f_username)}</div>` : ''}
            <div id="usernameSuggestSlot"></div>
            <div id="methodWarningSlot"></div>
          </div>
          <div class="field">
            <label>Game</label>
            <select id="f_game" class="${fieldErrors.f_game ? 'field-invalid' : ''}" ${!appDataReady || GAMES.length === 0 ? 'disabled' : ''}>
              <option value="">${!appDataReady ? 'Loading games...' : (GAMES.length ? 'Select a game' : 'No games configured yet')}</option>
              ${GAMES.map(g => `<option value="${esc(g.name)}">${esc(g.name)}</option>`).join('')}
            </select>
            ${fieldErrors.f_game ? `<div class="err-hint">${esc(fieldErrors.f_game)}</div>` : ''}
            ${appDataReady && GAMES.length === 0 ? `<div class="err-hint" style="color:var(--muted);">Ask an admin to add a game from the Manage panel first.</div>` : ''}
          </div>
          <div class="field">
            <label>Task</label>
            <input type="text" id="f_task" placeholder="Rebirth System" class="${fieldErrors.f_task ? 'field-invalid' : ''}">
            ${fieldErrors.f_task ? `<div class="err-hint">${esc(fieldErrors.f_task)}</div>` : ''}
          </div>
          <div class="field" id="f_skillset_field">
            <label>Skills used <span class="hint">(optional)</span></label>
            ${userSkillsetsLoading ? `<div class="hint" style="margin-left:0;display:block;">Checking their skillsets...</div>` : userSkillsets.length === 0 ? `<div class="hint" style="margin-left:0;display:block;">${userSkillsetsLoaded ? 'This person has no skillsets assigned yet - ask an admin to add some under Manage.' : 'Enter a Roblox username above to see this person\'s skillsets.'}</div>` : `
            <div style="display:flex;flex-direction:column;gap:6px;max-height:180px;overflow-y:auto;border:1px solid var(--line);border-radius:8px;padding:8px;">
              ${userSkillsets.map(s => `<label class="perm-check-item"><input type="checkbox" class="f_skillset_check" value="${esc(s.id)}" ${selectedSkillsetIds.has(String(s.id)) ? 'checked' : ''}> ${esc(s.name)}</label>`).join('')}
            </div>
            <p class="hint" style="margin-left:0;display:block;margin-top:6px;">They hold ${userSkillsets.length} skillset${userSkillsets.length === 1 ? '' : 's'} - pick the one(s) this task used, or leave unchecked for General.</p>
            `}
          </div>
          <div class="field">
            <label>Work done <span class="hint">(one line per item)</span></label>
            <textarea id="f_work" placeholder="Rebirth UI\nRebirth data saving\nBalance pass"></textarea>
          </div>
          <div class="row3">
            <div class="field"><label>Time spent</label><input type="text" id="f_time" placeholder="2h 30m"></div>
            <div class="field">
              <label>Amount</label>
              <input type="number" id="f_payment" placeholder="1250" min="0" class="${fieldErrors.f_payment ? 'field-invalid' : ''}">
              ${fieldErrors.f_payment ? `<div class="err-hint">${esc(fieldErrors.f_payment)}</div>` : ''}
            </div>
            <div class="field">
              <label>Currency</label>
              <select id="f_currency">
                <option value="ROBUX">Robux</option>
                <option value="USD">USD ($)</option>
              </select>
            </div>
          </div>
          <div class="field" style="margin-top:-10px;"><span class="hint" style="margin-left:0;">${devexLabel()}</span></div>
          <div class="field" id="usdEquivSlot" style="margin-top:-10px;${robuxEquivalentLabel(currentData()) ? '' : 'display:none;'}"><span class="hint" style="margin-left:0;">${robuxEquivalentLabel(currentData())}</span></div>
          <div class="field"><label>Logged by</label><input type="text" id="f_requester" value="${esc(hrUsername)}" disabled></div>
          <button type="button" class="btn btn-primary" id="submitBtn" ${submitting || configError ? 'disabled' : ''}>${submitting ? 'Logging...' : 'Log payment'}</button>
        </div>

        <div>
          <div class="preview-label">Live preview</div>
          <div id="previewSlot">${renderInvoice(currentData())}</div>
        </div>
      </div>
    </div>`;

        wireTopbarSignOut();

        const ids = ['f_username', 'f_task', 'f_game', 'f_work', 'f_time', 'f_payment', 'f_currency'];
        ids.forEach(id => {
          const el = document.getElementById(id);
          if (!el) return;
          el.addEventListener('input', updatePreview);
          el.addEventListener('change', updatePreview);
        });

        document.querySelectorAll('.f_skillset_check').forEach(el => el.addEventListener('change', () => {
          if (el.checked) selectedSkillsetIds.add(el.value);
          else selectedSkillsetIds.delete(el.value);
          updatePreview();
        }));

        {
          const el = document.getElementById('f_username');
          if (el && el.value.trim()) lookupTargetMethod(el.value.trim());
        }

        const currencySelect = document.getElementById('f_currency');
        if (currencySelect) currencySelect.addEventListener('change', () => { currencyTouched = true; });

        const usernameInput = document.getElementById('f_username');
        if (usernameInput) {
          usernameInput.addEventListener('input', () => {
            scheduleTargetMethodLookup();
            scheduleUsernameSuggest();
          });
          usernameInput.addEventListener('blur', () => {
            lookupTargetMethod(usernameInput.value.trim());
            setTimeout(() => { usernameSuggestVisible = false; renderUsernameSuggestions(); }, 150);
          });
          usernameInput.addEventListener('focus', () => {
            if (usernameSuggestions.length) { usernameSuggestVisible = true; renderUsernameSuggestions(); }
          });
        }
        renderMethodWarning();
        renderUsernameSuggestions();

        const submitBtn = document.getElementById('submitBtn');
        if (submitBtn) submitBtn.addEventListener('click', handleSubmit);

        const anotherBtn = document.getElementById('anotherBtn');
        if (anotherBtn) anotherBtn.addEventListener('click', () => {
          submitted = false; submitError = null; fieldErrors = {};
          targetMethod = null; targetMethodLoaded = false; lastLookedUpUsername = ''; currencyTouched = false;
          paint();
        });
      }

      function updatePreview() {
        const slot = document.getElementById('previewSlot');
        if (slot) slot.innerHTML = renderInvoice(currentData());
        const equivSlot = document.getElementById('usdEquivSlot');
        if (equivSlot) {
          const label = robuxEquivalentLabel(currentData());
          equivSlot.style.display = label ? '' : 'none';
          equivSlot.innerHTML = `<span class="hint" style="margin-left:0;">${label}</span>`;
        }
      }

      function scheduleUsernameSuggest() {
        const usernameInput = document.getElementById('f_username');
        if (!usernameInput) return;
        const q = usernameInput.value.trim();
        if (usernameSuggestTimer) clearTimeout(usernameSuggestTimer);
        if (q.length < 2) {
          usernameSuggestions = []; usernameSuggestVisible = false; renderUsernameSuggestions();
          return;
        }
        usernameSuggestTimer = setTimeout(async () => {
          try {
            const results = await searchRobloxUsernames(q);
            usernameSuggestions = results.filter(name => name.toLowerCase() !== q.toLowerCase());
            usernameSuggestVisible = usernameSuggestions.length > 0;
          } catch (e) {
            usernameSuggestions = [];
            usernameSuggestVisible = false;
          }
          renderUsernameSuggestions();
        }, 300);
      }

      function pickUsernameSuggestion(name) {
        const usernameInput = document.getElementById('f_username');
        if (usernameInput) usernameInput.value = name;
        usernameSuggestions = [];
        usernameSuggestVisible = false;
        renderUsernameSuggestions();
        updatePreview();
        lookupTargetMethod(name);
      }

      function renderUsernameSuggestions() {
        const slot = document.getElementById('usernameSuggestSlot');
        if (!slot) return;
        if (!usernameSuggestVisible || usernameSuggestions.length === 0) { slot.innerHTML = ''; return; }
        slot.innerHTML = `
          <div class="autocomplete-list">
            ${usernameSuggestions.map(name => `<div class="autocomplete-item" data-pick-username="${esc(name)}">${esc(name)}</div>`).join('')}
          </div>`;
        slot.querySelectorAll('[data-pick-username]').forEach(el => {
          el.addEventListener('mousedown', (e) => { e.preventDefault(); pickUsernameSuggestion(el.dataset.pickUsername); });
        });
      }

      function scheduleTargetMethodLookup() {
        const usernameInput = document.getElementById('f_username');
        if (!usernameInput) return;
        if (targetMethodLookupTimer) clearTimeout(targetMethodLookupTimer);
        targetMethodLookupTimer = setTimeout(() => {
          lookupTargetMethod(usernameInput.value.trim());
        }, 500);
      }

      async function lookupTargetMethod(username) {
        if (!username || username === lastLookedUpUsername) return;
        lastLookedUpUsername = username;
        targetMethodLoading = true;
        targetMethodLoaded = false;
        userSkillsetsLoading = true;
        userSkillsetsLoaded = false;
        userSkillsets = [];
        selectedSkillsetIds = new Set();
        renderMethodWarning();
        paintSkillsetField();
        try {
          targetMethod = await getPaymentMethodForUser(username);
        } catch (err) {
          targetMethod = null;
        }
        targetMethodLoading = false;
        targetMethodLoaded = true;
        if (targetMethod && !currencyTouched) {
          const suggestedCurrency = targetMethod.method === 'DEVEX_ROBUX' ? 'ROBUX' : 'USD';
          const currencySelect = document.getElementById('f_currency');
          if (currencySelect && currencySelect.value !== suggestedCurrency) {
            currencySelect.value = suggestedCurrency;
            updatePreview();
          }
        }
        renderMethodWarning();

        try {
          userSkillsets = await getUserSkillsets(username, null);
        } catch (err) {
          console.error('Could not load skillsets for', username, err);
          userSkillsets = [];
        }
        userSkillsetsLoading = false;
        userSkillsetsLoaded = true;
        paintSkillsetField();
      }

      function paintSkillsetField() {
        const field = document.getElementById('f_skillset_field');
        if (!field) return;
        field.innerHTML = `
          <label>Skills used <span class="hint">(optional)</span></label>
          ${userSkillsetsLoading ? `<div class="hint" style="margin-left:0;display:block;">Checking their skillsets...</div>` : userSkillsets.length === 0 ? `<div class="hint" style="margin-left:0;display:block;">${userSkillsetsLoaded ? 'This person has no skillsets assigned yet - ask an admin to add some under Manage.' : 'Enter a Roblox username above to see this person\'s skillsets.'}</div>` : `
          <div style="display:flex;flex-direction:column;gap:6px;max-height:180px;overflow-y:auto;border:1px solid var(--line);border-radius:8px;padding:8px;">
            ${userSkillsets.map(s => `<label class="perm-check-item"><input type="checkbox" class="f_skillset_check" value="${esc(s.id)}" ${selectedSkillsetIds.has(String(s.id)) ? 'checked' : ''}> ${esc(s.name)}</label>`).join('')}
          </div>
          <p class="hint" style="margin-left:0;display:block;margin-top:6px;">They hold ${userSkillsets.length} skillset${userSkillsets.length === 1 ? '' : 's'} - pick the one(s) this task used, or leave unchecked for General.</p>
          `}`;
        field.querySelectorAll('.f_skillset_check').forEach(el => el.addEventListener('change', () => {
          if (el.checked) selectedSkillsetIds.add(el.value);
          else selectedSkillsetIds.delete(el.value);
          updatePreview();
        }));
      }

      function renderMethodWarning() {
        const slot = document.getElementById('methodWarningSlot');
        if (!slot) return;
        if (targetMethodLoading) {
          slot.innerHTML = `<div class="hint" style="margin-left:0;display:block;margin-top:6px;">Checking payment method on file...</div>`;
        } else if (targetMethodLoaded && !targetMethod) {
          slot.innerHTML = `<div class="warn-box" style="margin-top:10px;margin-bottom:0;"><span>No payment method on file yet. You can still submit this, but they'll need to add one under "My payments" before it gets paid.</span></div>`;
        } else if (targetMethodLoaded && targetMethod) {
          slot.innerHTML = `<div class="hint" style="margin-left:0;display:block;margin-top:6px;color:var(--ok-text);">On file: ${esc(methodDisplayLabel(targetMethod))}</div>`;
        } else {
          slot.innerHTML = '';
        }
      }

      async function handleSubmit() {
        const data = currentData();
        const errs = validate(data);
        if (Object.keys(errs).length) {
          fieldErrors = errs;
          submitError = 'Please fix the highlighted fields before submitting.';
          paint();
          return;
        }
        fieldErrors = {};

        if (data.currency === 'ROBUX' && !ignoreEligibility) {
          submitting = true; submitError = null; paint();

          let eligibility = [];
          try {
            eligibility = await getUserEligibility(data.robloxUsername);
          } catch (err) {
            submitting = false;
            submitError = "Could not verify the developer's payout group membership. Check your connection and try again.";
            paint();
            return;
          }

          const missingGroups = eligibility.filter(g => !g.eligible);
          if (missingGroups.length > 0) {
            submitting = false;
            submitError = `They can't be paid yet. Still missing: ${missingGroups.map(g => g.name).join(', ')}. Ask them to sort that out, then try again.`;
            paint();
            return;
          }

        }

        submitting = true; submitError = null; paint();
        try {
          await saveRequest(data);
          submitting = false; submitted = true; paint();
        } catch (err) {
          submitting = false;
          submitError = (err && err.message) ? err.message : 'Could not submit this request. Check your connection and try again.';
          paint();
        }
      }

      paint();
      (async () => {
        try { ignoreEligibility = await getIgnoreEligibility(); } catch (e) { }
      })();
    }
