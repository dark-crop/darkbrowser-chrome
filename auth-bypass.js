/**
 * Auth Bypass - Storage Key Management
 *
 * Keeps the STOCK Claude extension's auth keys populated so it never shows Claude's own login.
 * These are placeholder values only - they are NOT a Dark LLM credential. The real Darkbrowser
 * sign-in (a Dark LLM access token) is stored separately in the provider state, and api-adapter.js
 * refuses every request until that real token is present (see the sign-in gate). So this file does
 * not grant access to the gateway; it only silences the upstream Claude login. No fetch patching
 * here - that's all handled by api-adapter.js.
 */

(function() {
  'use strict';

  async function ensureAuth() {
    try {
      const result = await chrome.storage.local.get([
        'accessToken', 'refreshToken', 'tokenExpiry', 'anthropicApiKey',
        'selectedModel', 'selectedModelQuickMode'
      ]);

      const updates = {};
      if (!result.accessToken) updates.accessToken = 'custom-provider-access-token';
      if (!result.refreshToken) updates.refreshToken = 'custom-provider-refresh-token';
      if (!result.tokenExpiry || result.tokenExpiry < Date.now()) {
        updates.tokenExpiry = Date.now() + (365 * 24 * 60 * 60 * 1000);
      }
      if (!result.anthropicApiKey) updates.anthropicApiKey = 'custom-provider-key';

      if (Object.keys(updates).length > 0) {
        await chrome.storage.local.set(updates);
        console.log('[Auth Bypass] Repopulated auth keys:', Object.keys(updates));
      }
    } catch (e) {
      console.error('[Auth Bypass] Error:', e);
    }
  }

  ensureAuth();

  // Re-check periodically
  setInterval(ensureAuth, 10000);

  // Restore if something clears tokens
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if ((changes.accessToken && !changes.accessToken.newValue) ||
        (changes.anthropicApiKey && !changes.anthropicApiKey.newValue)) {
      ensureAuth();
    }
  });

  console.log('[Auth Bypass] Storage manager installed');
})();
