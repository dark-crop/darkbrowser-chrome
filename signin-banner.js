/**
 * Sign-in banner - the in-panel half of the hard-login gate.
 *
 * Runs on the Darkbrowser side panel (sidepanel.html). While the user is signed out it covers the
 * whole panel with a sign-in takeover (CLI-style paste flow): open the gateway /token page, paste
 * the token back, it is validated against /v1/models and stored as the Dark LLM key. Once signed in
 * the takeover hides itself. The api-adapter.js gate is the real enforcement; this is the visible,
 * friendly front door so the user is never left staring at an in-chat error.
 */

(function() {
  'use strict';

  const registry = globalThis.BrowserKingRegistry;
  if (!registry) {
    return;
  }

  const GATEWAY = 'https://dark-llm.cropbinary.com';
  const MODELS_URL = `${GATEWAY}/v1/models`;
  const TOKEN_URL = `${GATEWAY}/token`;
  const PLACEHOLDERS = new Set([
    'darkbrowser-signed-out',
    'browserking-key',
    'custom-provider-key',
    'browserking-access-token',
    'custom-provider-access-token'
  ]);

  function isSignedIn(dark) {
    const key = String(dark?.apiKey || '').trim();
    return Boolean(key) && !PLACEHOLDERS.has(key);
  }

  let overlay = null;
  let statusEl = null;
  let inputEl = null;
  let saveEl = null;
  let signOutBtn = null;

  function ensureOverlay() {
    if (overlay || !document.body) {
      return overlay;
    }

    const style = document.createElement('style');
    style.id = 'darkbrowser-signin-style';
    style.textContent = `
      #darkbrowser-signin {
        position: fixed;
        inset: 0;
        z-index: 2147483000;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background:
          radial-gradient(circle at top, rgba(168, 85, 247, 0.18), transparent 40%),
          hsl(var(--bg-100, 60 3% 12%));
        color: hsl(var(--text-100, 40 12% 92%));
        font-family: var(--font-ui, ui-sans-serif, system-ui, sans-serif);
        overflow: auto;
      }
      #darkbrowser-signin .db-card {
        width: 100%;
        max-width: 360px;
        display: grid;
        gap: 14px;
      }
      #darkbrowser-signin h1 {
        margin: 0;
        font-size: 22px;
        font-weight: 600;
        color: #c084fc;
      }
      #darkbrowser-signin p {
        margin: 0;
        line-height: 1.5;
        color: hsl(var(--text-300, 40 6% 68%));
        font-size: 13px;
      }
      #darkbrowser-signin ol {
        margin: 0;
        padding-left: 18px;
        color: hsl(var(--text-300, 40 6% 68%));
        font-size: 13px;
        line-height: 1.6;
      }
      #darkbrowser-signin input {
        width: 100%;
        box-sizing: border-box;
        border-radius: 12px;
        border: 1px solid rgba(168, 85, 247, 0.35);
        background: hsl(var(--bg-000, 60 3% 9%));
        color: hsl(var(--text-100, 40 12% 92%));
        padding: 12px 14px;
        font-size: 14px;
      }
      #darkbrowser-signin input:focus {
        outline: none;
        border-color: #a855f7;
      }
      #darkbrowser-signin button {
        border: 0;
        border-radius: 12px;
        padding: 12px 14px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        font-family: inherit;
      }
      #darkbrowser-signin button.primary {
        background: #a855f7;
        color: #fff;
      }
      #darkbrowser-signin button.primary:hover {
        background: #c084fc;
      }
      #darkbrowser-signin button.primary:disabled {
        opacity: 0.6;
        cursor: default;
      }
      #darkbrowser-signin .db-status {
        min-height: 18px;
        font-size: 12px;
        color: hsl(var(--text-300, 40 6% 68%));
      }
      #darkbrowser-signin .db-status.error { color: #f38ba8; }
      #darkbrowser-signin .db-status.success { color: #a6e3a1; }
      #darkbrowser-signout {
        position: fixed;
        right: 10px;
        bottom: 8px;
        z-index: 2147482000;
        display: none;
        align-items: center;
        gap: 5px;
        padding: 5px 10px;
        border: 1px solid rgba(168, 85, 247, 0.4);
        border-radius: 999px;
        background: color-mix(in srgb, hsl(var(--bg-000, 60 3% 9%)) 80%, transparent);
        color: #c084fc;
        font-family: var(--font-ui, ui-sans-serif, system-ui, sans-serif);
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        opacity: 0.7;
        backdrop-filter: blur(6px);
      }
      #darkbrowser-signout:hover { opacity: 1; }
    `;
    document.head.appendChild(style);

    overlay = document.createElement('div');
    overlay.id = 'darkbrowser-signin';
    overlay.innerHTML = `
      <div class="db-card">
        <h1>Darkbrowser</h1>
        <p>Sign in with your Dark LLM account to use the agent. There is no guest access.</p>
        <ol>
          <li>Click <strong>Open sign-in page</strong> and sign in.</li>
          <li>Copy the access token it shows you.</li>
          <li>Paste it below and click <strong>Save token</strong>.</li>
        </ol>
        <button type="button" class="primary" data-role="open">Open sign-in page</button>
        <input type="password" placeholder="Paste access token (sk-...)" autocomplete="off" data-role="token" />
        <button type="button" class="primary" data-role="save">Save token</button>
        <div class="db-status" data-role="status"></div>
      </div>
    `;
    document.body.appendChild(overlay);

    statusEl = overlay.querySelector('[data-role="status"]');
    inputEl = overlay.querySelector('[data-role="token"]');
    saveEl = overlay.querySelector('[data-role="save"]');

    overlay.querySelector('[data-role="open"]').addEventListener('click', () => {
      window.open(TOKEN_URL, '_blank', 'noopener');
      setStatus('Sign in on the page that opened, copy your token, then paste it below.', '');
    });

    saveEl.addEventListener('click', onSave);
    inputEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        onSave();
      }
    });

    // Discreet sign-out pill, shown only while signed in (the overlay handles the signed-out state).
    signOutBtn = document.createElement('button');
    signOutBtn.id = 'darkbrowser-signout';
    signOutBtn.type = 'button';
    signOutBtn.textContent = 'Sign out';
    signOutBtn.addEventListener('click', onSignOut);
    document.body.appendChild(signOutBtn);

    return overlay;
  }

  async function onSignOut() {
    await registry.updateState((draft) => {
      draft.providers.darkllm.apiKey = '';
    });
    if (inputEl) inputEl.value = '';
    setStatus('Signed out.', '');
    await refresh();
  }

  function setStatus(message, kind) {
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.className = `db-status ${kind || ''}`.trim();
  }

  async function validateToken(key) {
    try {
      const res = await fetch(MODELS_URL, { headers: { Authorization: `Bearer ${key}` } });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function onSave() {
    const key = String(inputEl?.value || '').trim();
    if (!key) {
      setStatus('Paste your access token first.', 'error');
      return;
    }
    setStatus('Validating token with the gateway...', '');
    saveEl.disabled = true;
    const ok = await validateToken(key);
    if (!ok) {
      saveEl.disabled = false;
      setStatus('The gateway rejected that token. Check it and try again.', 'error');
      return;
    }
    await registry.updateState((draft) => {
      draft.activeProvider = 'darkllm';
      draft.providers.darkllm.apiKey = key;
      draft.providers.darkllm.enabled = true;
    });
    saveEl.disabled = false;
    if (inputEl) inputEl.value = '';
    setStatus('Signed in. Loading Darkbrowser...', 'success');
    await refresh();
  }

  async function refresh() {
    ensureOverlay();
    if (!overlay) return;
    const state = await registry.loadState();
    const signedIn = isSignedIn(state.providers.darkllm);
    overlay.style.display = signedIn ? 'none' : 'flex';
    if (signOutBtn) signOutBtn.style.display = signedIn ? 'inline-flex' : 'none';
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.browserKingProviderState) {
      refresh();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refresh, { once: true });
  } else {
    refresh();
  }
})();
