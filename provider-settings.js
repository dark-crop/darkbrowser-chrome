(function() {
  'use strict';

  const registry = globalThis.BrowserKingRegistry;

  if (!registry) {
    return;
  }

  const providerGrid = document.getElementById('provider-grid');
  const providerSearch = document.getElementById('provider-search');
  const providerSummary = document.getElementById('provider-summary');
  const saveButton = document.getElementById('save-providers');
  const resetButton = document.getElementById('reset-providers');
  const syncAllButton = document.getElementById('sync-all-models');

  let state = null;
  let filterText = '';

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  function renderCard(providerId, definition, providerState) {
    const isActive = state.activeProvider === providerId;
    const note = definition.note
      ? `<div class="card-note">${escapeHtml(definition.note)}</div>`
      : '';

    return `
      <article class="provider-card ${isActive ? 'active' : ''}" data-provider-id="${providerId}" style="--provider-color: ${definition.color}">
        <div class="provider-top">
          <div class="provider-title">
            <span class="provider-dot"></span>
            <div class="provider-heading">
              <h2>${escapeHtml(definition.label)}</h2>
              <p>${definition.transport === 'anthropic' ? 'Native Anthropic messages' : 'OpenAI-compatible chat completions'}</p>
            </div>
          </div>
          <div class="provider-actions">
            <label class="toggle">
              <input type="checkbox" data-action="toggle-enabled" ${providerState.enabled ? 'checked' : ''} />
              Enabled
            </label>
          </div>
        </div>

        ${note}

        <div class="field">
          <label>Base URL</label>
          <input data-action="base-url" value="${escapeHtml(providerState.baseUrl)}" />
        </div>

        <div class="field">
          <label>API Key</label>
          <input data-action="api-key" type="password" placeholder="${definition.requiresApiKey ? 'Enter API key' : 'Not required for this provider'}" value="${escapeHtml(providerState.apiKey || '')}" />
          <small>${definition.requiresApiKey ? 'Only providers with a key appear in the sidepanel picker.' : 'Local or proxy provider.'}</small>
        </div>

        <div class="row">
          <div class="field">
            <label>Default model</label>
            <select data-action="model-select">
              ${providerState.models.map((model) => `
                <option value="${escapeHtml(model.id)}" ${model.id === providerState.model ? 'selected' : ''}>
                  ${escapeHtml(model.name)}${model.supportsVision ? ' - vision' : ''}
                </option>
              `).join('')}
            </select>
          </div>
          <div class="field">
            <label>Availability</label>
            <small>
              ${providerState.models.length} models cached${providerState.lastSyncedAt ? `, last synced ${new Date(providerState.lastSyncedAt).toLocaleString()}` : ''}.
            </small>
          </div>
        </div>

        <div class="buttons">
          <button class="primary" data-action="set-active" type="button">${isActive ? 'Active provider' : 'Set active'}</button>
          <button class="secondary" data-action="sync-models" type="button">Fetch models</button>
        </div>

        <div class="status" data-role="status"></div>
      </article>
    `;
  }

  function updateSummary() {
    const enabled = registry.getEnabledProviders(state);
    const currentProvider = registry.getActiveProviderDefinition(state);
    const currentModel = registry.getCurrentModel(state);
    providerSummary.textContent = `${enabled.length} configured provider${enabled.length === 1 ? '' : 's'} available. Active: ${currentProvider.label} / ${currentModel.name}.`;
  }

  function render() {
    const cards = Object.keys(registry.PROVIDERS)
      .filter((providerId) => {
        if (!filterText) {
          return true;
        }

        const definition = registry.getProviderDefinition(providerId);
        const haystack = `${definition.label} ${providerId}`.toLowerCase();
        return haystack.includes(filterText);
      })
      .map((providerId) => renderCard(providerId, registry.getProviderDefinition(providerId), state.providers[providerId]))
      .join('');

    providerGrid.innerHTML = cards;
    updateSummary();
  }

  async function load() {
    state = await registry.loadState();
    render();
  }

  async function persist(message) {
    state = await registry.saveState(state);
    render();
    if (!message) {
      return;
    }
    providerSummary.textContent = message;
  }

  function setCardStatus(card, message, kind) {
    const status = card.querySelector('[data-role="status"]');
    if (!status) {
      return;
    }

    status.textContent = message;
    status.className = `status ${kind || ''}`.trim();
  }

  function canSyncProvider(providerId, providerState) {
    const definition = registry.getProviderDefinition(providerId);
    if (!providerState.enabled) {
      return false;
    }

    if (definition.publicModelsUrl) {
      return true;
    }

    if (!definition.requiresApiKey) {
      return true;
    }

    return Boolean(providerState.apiKey);
  }

  async function syncProviderModels(providerId, card) {
    const providerState = state.providers[providerId];
    if (!canSyncProvider(providerId, providerState)) {
      if (card) {
        setCardStatus(card, 'Add an API key first to fetch models.', 'error');
      }
      return false;
    }

    if (card) {
      setCardStatus(card, 'Fetching live models...', '');
    }

    const models = await registry.fetchProviderModels(providerId, providerState);
    if (!models.length) {
      if (card) {
        setCardStatus(card, 'No models returned by this provider.', 'error');
      }
      return false;
    }

    providerState.models = models;
    if (!models.some((model) => model.id === providerState.model)) {
      providerState.model = models[0].id;
    }
    providerState.lastSyncedAt = Date.now();

    if (card) {
      setCardStatus(card, 'Model list refreshed.', 'success');
    }

    return true;
  }

  providerGrid.addEventListener('input', (event) => {
    const card = event.target.closest('[data-provider-id]');
    if (!card) {
      return;
    }

    const providerId = card.getAttribute('data-provider-id');
    const providerState = state.providers[providerId];
    const action = event.target.getAttribute('data-action');

    if (action === 'base-url') {
      providerState.baseUrl = event.target.value.trim();
    }

    if (action === 'api-key') {
      providerState.apiKey = event.target.value.trim();
    }
  });

  providerGrid.addEventListener('change', (event) => {
    const card = event.target.closest('[data-provider-id]');
    if (!card) {
      return;
    }

    const providerId = card.getAttribute('data-provider-id');
    const providerState = state.providers[providerId];
    const action = event.target.getAttribute('data-action');

    if (action === 'toggle-enabled') {
      providerState.enabled = event.target.checked;
    }

    if (action === 'model-select') {
      providerState.model = event.target.value;
    }
  });

  providerGrid.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) {
      return;
    }

    const card = event.target.closest('[data-provider-id]');
    if (!card) {
      return;
    }

    const providerId = card.getAttribute('data-provider-id');
    const providerState = state.providers[providerId];
    const action = button.getAttribute('data-action');

    if (action === 'set-active') {
      state.activeProvider = providerId;
      providerState.enabled = true;
      await persist(`Active provider updated to ${registry.getProviderDefinition(providerId).label}.`);
      return;
    }

    if (action === 'sync-models') {
      try {
        const synced = await syncProviderModels(providerId, card);
        if (synced) {
          await persist(`Fetched live models for ${registry.getProviderDefinition(providerId).label}.`);
        }
      } catch (error) {
        setCardStatus(card, error.message || 'Failed to fetch models.', 'error');
      }
    }
  });

  providerSearch.addEventListener('input', () => {
    filterText = providerSearch.value.trim().toLowerCase();
    render();
  });

  saveButton.addEventListener('click', async () => {
    providerSummary.textContent = 'Saving provider configuration and refreshing live model catalogs...';
    for (const providerId of Object.keys(state.providers)) {
      try {
        await syncProviderModels(providerId);
      } catch (error) {
        console.warn('[Provider Settings] Failed to sync models for', providerId, error);
      }
    }
    await persist('Provider configuration saved and live model catalogs refreshed.');
  });

  resetButton.addEventListener('click', async () => {
    state = registry.buildDefaultState();
    await persist('Provider configuration reset to defaults.');
  });

  syncAllButton.addEventListener('click', async () => {
    providerSummary.textContent = 'Fetching models from enabled providers...';

    const providerIds = Object.keys(state.providers).filter((providerId) => canSyncProvider(providerId, state.providers[providerId]));
    for (const providerId of providerIds) {
      try {
        await syncProviderModels(providerId);
      } catch (error) {
        console.warn('[Provider Settings] Failed to sync models for', providerId, error);
      }
    }

    await persist('Live model sync finished.');
  });

  load();

  // ---- Darkbrowser sign-in (CLI-style paste flow) -----------------------------------------
  // Open the gateway /token page, sign in there, paste the returned token back here. The token
  // is validated against /v1/models before being stored as the Dark LLM provider key. This is
  // the hard-login gate: with no valid token, api-adapter.js refuses every request.
  const GATEWAY = 'https://dark-llm.cropbinary.com';
  const MODELS_URL = `${GATEWAY}/v1/models`;
  const TOKEN_URL = `${GATEWAY}/token`;

  const openSignin = document.getElementById('open-signin');
  const tokenInput = document.getElementById('token-input');
  const saveToken = document.getElementById('save-token');
  const signOut = document.getElementById('sign-out');
  const signinStatus = document.getElementById('signin-status');
  const signinPill = document.getElementById('signin-status-pill');
  const signinSub = document.getElementById('signin-sub');
  const signedKey = document.getElementById('signed-key');
  const modelSelect = document.getElementById('model-select');

  function setSigninStatus(message, kind) {
    if (!signinStatus) return;
    signinStatus.textContent = message || '';
    signinStatus.className = `status ${kind || ''}`.trim();
  }

  function maskKey(key) {
    const value = String(key || '');
    if (value.length <= 12) return value ? `${value.slice(0, 3)}...` : '';
    return `${value.slice(0, 6)}...${value.slice(-4)}`;
  }

  async function validateToken(key) {
    try {
      const res = await fetch(MODELS_URL, { headers: { Authorization: `Bearer ${key}` } });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function captureUsername(key) {
    try {
      const res = await fetch(`${GATEWAY}/key/info`, { headers: { Authorization: `Bearer ${key}` } });
      const data = res.ok ? await res.json() : null;
      const username = data?.info?.key_alias || data?.info?.user_id || '';
      if (globalThis.chrome?.storage?.local) {
        await chrome.storage.local.set({ darkbrowserUsername: username });
      }
    } catch {
      /* non-fatal */
    }
  }

  async function renderSignin() {
    const current = await registry.loadState();
    const dark = current.providers.darkllm || {};
    const models = Array.isArray(dark.models) && dark.models.length
      ? dark.models
      : registry.PROVIDERS.darkllm.models;

    if (modelSelect) {
      modelSelect.innerHTML = models
        .map((model) => `<option value="${escapeHtml(model.id)}" ${model.id === dark.model ? 'selected' : ''}>${escapeHtml(model.name)}</option>`)
        .join('');
    }

    const signedIn = Boolean(dark.apiKey);
    if (signinPill) signinPill.textContent = signedIn ? 'Signed in' : 'Signed out';
    if (signinSub) signinSub.textContent = signedIn ? 'Darkbrowser is active' : 'Sign in to activate Darkbrowser';
    if (signedKey) signedKey.textContent = signedIn ? maskKey(dark.apiKey) : 'Not signed in.';
  }

  if (openSignin) {
    openSignin.addEventListener('click', () => {
      window.open(TOKEN_URL, '_blank', 'noopener');
      setSigninStatus('Sign in on the page that opened, copy your token, then paste it below.', '');
    });
  }

  if (saveToken) {
    saveToken.addEventListener('click', async () => {
      const key = String(tokenInput?.value || '').trim();
      if (!key) {
        setSigninStatus('Paste your access token first.', 'error');
        return;
      }
      setSigninStatus('Validating token with the gateway...', '');
      saveToken.disabled = true;
      const ok = await validateToken(key);
      if (!ok) {
        saveToken.disabled = false;
        setSigninStatus('The gateway rejected that token. Check it and try again.', 'error');
        return;
      }
      await captureUsername(key);
      await registry.updateState((draft) => {
        draft.activeProvider = 'darkllm';
        draft.providers.darkllm.apiKey = key;
        draft.providers.darkllm.enabled = true;
        if (modelSelect && modelSelect.value) {
          draft.providers.darkllm.model = modelSelect.value;
        }
      });
      saveToken.disabled = false;
      if (tokenInput) tokenInput.value = '';
      setSigninStatus('Signed in. Darkbrowser is ready - open the side panel.', 'success');
      await renderSignin();
    });
  }

  if (signOut) {
    signOut.addEventListener('click', async () => {
      await registry.updateState((draft) => {
        draft.providers.darkllm.apiKey = '';
      });
      if (globalThis.chrome?.storage?.local) {
        await chrome.storage.local.remove('darkbrowserUsername');
      }
      setSigninStatus('Signed out.', '');
      await renderSignin();
    });
  }

  if (modelSelect) {
    modelSelect.addEventListener('change', async () => {
      await registry.updateState((draft) => {
        draft.providers.darkllm.model = modelSelect.value;
      });
    });
  }

  renderSignin();
})();
