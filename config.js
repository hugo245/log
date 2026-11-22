// ---------------------------------------------------------------------------------------
// Web app deployment settings.
//
// This is the only frontend file a studio needs to edit. Everything else about the look and
// copy (name, logo, colours, sign-in text, enabled features...) comes from the API, which
// reads studio.config.json and the Branding panel in Settings.
// ---------------------------------------------------------------------------------------
window.STUDIO_CONFIG = {
  // Where the API (server.js) is running. No trailing slash.
  apiBase: 'https://api.playverseinternal.cc',

  // Shown for the first paint on a visitor's very first load, before the API answers.
  // After that the live branding is cached in the browser, so keep this roughly in sync.
  branding: {
    studio: { name: 'Studio Panel', shortName: 'SP', productName: '', logoUrl: 'assets/logo.svg', websiteLabel: '', website: '' },
    theme: { accent: '#5B5FEF', accentDark: '#8C8FFF', radius: 14, defaultMode: 'light' }
  }
};
