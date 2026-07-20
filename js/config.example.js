// Copy this file to config.js and fill in your own values for local dev.
// config.js is gitignored — it never gets committed.
// The deployed site generates config.js from this template at build time,
// injecting FLICKR_API_KEY and FLICKR_USER_ID from GitHub Actions secrets
// (see .github/workflows/deploy.yml).
export const FLICKR_CONFIG = {
  // Create one at https://www.flickr.com/services/apps/create/apikey/
  apiKey: '__FLICKR_API_KEY__',
  // Flickr NSID for the account being displayed (not secret, just kept out
  // of source so the site isn't hardcoded to one account).
  userId: '__FLICKR_USER_ID__',
};
