// Runs before first paint: applies the saved theme and cached branding so the page never
// flashes the wrong colours, and warms up the connection to the API.
(function () {
  var root = document.documentElement;
  var cfg = window.STUDIO_CONFIG || {};
  var cached = null;
  try { cached = JSON.parse(localStorage.getItem('studio_bootstrap_v2') || 'null'); } catch (e) { }
  var branding = (cached && cached.config) || cfg.branding || {};
  var theme = branding.theme || {};

  var saved = null;
  try { saved = localStorage.getItem('pv_theme'); } catch (e) { }
  var mode = saved === 'dark' || saved === 'light' ? saved : (theme.defaultMode === 'dark' ? 'dark' : 'light');
  root.setAttribute('data-theme', mode);

  var hex = /^#[0-9a-fA-F]{6}$/;
  if (hex.test(theme.accent || '')) root.style.setProperty('--brand', theme.accent);
  if (hex.test(theme.accentDark || '')) root.style.setProperty('--brand-dark', theme.accentDark);
  if (theme.radius) root.style.setProperty('--radius-lg', Math.max(4, Math.min(28, Number(theme.radius) || 18)) + 'px');

  if (branding.studio && branding.studio.name) {
    document.title = [branding.studio.name, branding.studio.productName].filter(Boolean).join(' ');
  }

  if (cfg.apiBase && /^https:\/\//.test(cfg.apiBase)) {
    var link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = cfg.apiBase;
    link.crossOrigin = 'anonymous';
    document.head.appendChild(link);
  }
})();
