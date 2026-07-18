/**
 * Auth Bypass - Storage Key Management
 *
 * Keeps the STOCK Claude extension's auth keys populated so it never shows Claude's own login /
 * OAuth consent screen. These are placeholder values only - they are NOT a Dark LLM credential.
 * The real Darkbrowser sign-in (a Dark LLM access token) is stored separately in the provider
 * state, and api-adapter.js refuses every request until that real token is present (see the
 * sign-in gate). So this file does not grant access to the gateway; it only silences the upstream
 * Claude login. No fetch patching here - that's all handled by api-adapter.js.
 *
 * FRESH-INSTALL RACE: on a brand-new install the stock app reads storage and, finding no token,
 * shows the "Claude for Chrome would like to connect" OAuth consent. To beat that read we seed the
 * keys IMMEDIATELY with a bare set() at load (chrome.storage serializes calls, so a get issued
 * later returns these) and again on the install/startup events - not gated behind a get() first.
 */

(function() {
  'use strict';

  const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

  // The placeholder auth state the stock extension needs to consider itself "connected". None of
  // these is a usable credential (the sign-in gate in api-adapter.js treats them as signed-out).
  function seedValues() {
    return {
      accessToken: 'custom-provider-access-token',
      refreshToken: 'custom-provider-refresh-token',
      tokenExpiry: Date.now() + YEAR_MS,
      anthropicApiKey: 'custom-provider-key',
      // Onboarding / permission flags so the first-run consent + notices never appear.
      browserControlPermissionAccepted: true,
      announcementDismissed: 'all',
    };
  }

  function seedNow() {
    try {
      // Bare, unconditional set - enqueued before the app bundle's first storage read so the fresh
      // install never sees an empty auth state.
      chrome.storage.local.set(seedValues());
    } catch (e) {
      // storage may be momentarily unavailable during SW spin-up; the periodic ensureAuth covers it.
    }
  }

  // 1) Seed the instant this script loads (runs in both the service worker and every extension page).
  seedNow();

  // 2) Seed on the lifecycle events too. auth-bypass is imported before the stock service worker in
  //    service-worker-loader.js, so these listeners register first and run on fresh install / startup.
  try {
    chrome.runtime?.onInstalled?.addListener(seedNow);
    chrome.runtime?.onStartup?.addListener(seedNow);
  } catch (e) {
    // not in a context with chrome.runtime lifecycle events; the load-time seed already ran.
  }

  // 3) Top up any missing/expired keys, and keep them populated over time.
  async function ensureAuth() {
    try {
      const result = await chrome.storage.local.get([
        'accessToken', 'refreshToken', 'tokenExpiry', 'anthropicApiKey',
      ]);

      const updates = {};
      if (!result.accessToken) updates.accessToken = 'custom-provider-access-token';
      if (!result.refreshToken) updates.refreshToken = 'custom-provider-refresh-token';
      if (!result.tokenExpiry || result.tokenExpiry < Date.now()) {
        updates.tokenExpiry = Date.now() + YEAR_MS;
      }
      if (!result.anthropicApiKey) updates.anthropicApiKey = 'custom-provider-key';

      if (Object.keys(updates).length > 0) {
        await chrome.storage.local.set(updates);
      }
    } catch (e) {
      console.error('[Auth Bypass] Error:', e);
    }
  }

  ensureAuth();
  setInterval(ensureAuth, 10000);

  // Restore if something clears the tokens.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if ((changes.accessToken && !changes.accessToken.newValue) ||
        (changes.anthropicApiKey && !changes.anthropicApiKey.newValue)) {
      seedNow();
    }
  });

  console.log('[Auth Bypass] Storage manager installed');
})();
