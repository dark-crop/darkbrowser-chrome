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

  // Hard-lock: the stock Claude-for-Chrome first-run opens Anthropic's OAuth/onboarding page
  // (claude.ai/oauth/authorize) on install and sets an Anthropic "improve Claude for Chrome" uninstall
  // survey. Darkbrowser must NEVER send users to Anthropic, so we neutralise both Chrome APIs here.
  // This file is imported BEFORE the stock service worker (see service-worker-loader.js), so these
  // patches are in place before the stock onInstalled handler opens the tab / sets the URL.
  (function lockDownAnthropicNavigation() {
    const isGateway = (url) => typeof url === 'string' && /dark-llm\.cropbinary\.com/i.test(url);
    const isOnboarding = (url) =>
      typeof url === 'string' && /claude\.ai\/oauth|\/oauth\/authorize|oauth_callback|docs\.google\.com\/forms/i.test(url);

    // 1) Swallow any attempt to OPEN an Anthropic OAuth/onboarding tab (create or navigate).
    try {
      const origCreate = chrome.tabs && chrome.tabs.create && chrome.tabs.create.bind(chrome.tabs);
      if (origCreate) {
        chrome.tabs.create = function(props, cb) {
          if (props && isOnboarding(props.url)) {
            if (typeof cb === 'function') { try { cb(undefined); } catch (e) {} }
            return Promise.resolve(undefined);
          }
          return origCreate(props, cb);
        };
      }
      const origUpdate = chrome.tabs && chrome.tabs.update && chrome.tabs.update.bind(chrome.tabs);
      if (origUpdate) {
        chrome.tabs.update = function(a, b, c) {
          const props = (a && typeof a === 'object') ? a : b;   // (props) or (tabId, props[, cb])
          if (props && isOnboarding(props.url)) {
            const cb = (typeof c === 'function') ? c : (typeof b === 'function' ? b : undefined);
            if (typeof cb === 'function') { try { cb(undefined); } catch (e) {} }
            return Promise.resolve(undefined);
          }
          return origUpdate(a, b, c);
        };
      }
    } catch (e) {}

    // 2) Never set the Anthropic uninstall survey - force it empty (allow only our own gateway URL).
    try {
      const origSetUninstall = chrome.runtime && chrome.runtime.setUninstallURL &&
        chrome.runtime.setUninstallURL.bind(chrome.runtime);
      if (origSetUninstall) {
        origSetUninstall('');
        chrome.runtime.setUninstallURL = function(url, cb) {
          return origSetUninstall((!url || isGateway(url)) ? url : '', cb);
        };
      }
    } catch (e) {}

    // 3) Silence the Anthropic cloud-pairing bridge WebSocket (wss://bridge.claudeusercontent.com).
    //    Darkbrowser runs the agent LOCALLY and never uses it, so it just 403s (no real Claude account)
    //    and spams the error log. All the extension's sends on it are guarded by readyState===OPEN, so
    //    an inert socket stuck in CONNECTING is safe: no handshake error, no reconnect loop. Other
    //    WebSockets pass straight through.
    try {
      const RealWS = globalThis.WebSocket;
      if (RealWS && !RealWS.__darkbrowserPatched) {
        const isBridge = (u) => typeof u === 'string' && /bridge\.claudeusercontent\.com/i.test(u);
        const Patched = function (url, protocols) {
          if (isBridge(url)) {
            return {
              url, readyState: 0, bufferedAmount: 0, extensions: '', protocol: '', binaryType: 'blob',
              onopen: null, onclose: null, onerror: null, onmessage: null,
              send() {}, close() {}, addEventListener() {}, removeEventListener() {},
              dispatchEvent() { return false; },
            };
          }
          return protocols === undefined ? new RealWS(url) : new RealWS(url, protocols);
        };
        Patched.prototype = RealWS.prototype;
        Patched.CONNECTING = RealWS.CONNECTING;
        Patched.OPEN = RealWS.OPEN;
        Patched.CLOSING = RealWS.CLOSING;
        Patched.CLOSED = RealWS.CLOSED;
        Patched.__darkbrowserPatched = true;
        globalThis.WebSocket = Patched;
      }
    } catch (e) {}
  })();

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
