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
    studio: { name: 'PlayVerse', shortName: 'PV', productName: 'Hub', logoUrl: 'assets/logo.png', websiteLabel: 'playverse.cc', website: 'https://www.playverse.cc' },
    theme: { accent: '#6366F1', accentDark: '#8B87FF', radius: 18, defaultMode: 'light' }
  }
};
