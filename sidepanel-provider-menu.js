(function() {
  'use strict';

  const registry = globalThis.BrowserKingRegistry;
  if (!registry) {
    return;
  }

  let mounted = false;
  let panelOpen = false;
  let expandedProviderId = null;

  function mount() {
    if (mounted || !document.body) {
      return;
    }

    mounted = true;

    const style = document.createElement('style');
    style.textContent = `
      #prism-provider-menu {
        position: absolute;
        top: 52px;
        left: 16px;
        z-index: 9999;
        width: calc(100% - 32px);
        font-family: var(--font-ui);
        pointer-events: none;
      }
      #prism-provider-menu button {
        font-family: inherit;
      }
      .prism-menu-trigger {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 0;
        color: hsl(var(--text-100));
        font-size: 14px;
        line-height: 1.3;
        pointer-events: auto;
      }
      .prism-trigger-arrow {
        opacity: 0.7;
        transform: translateY(1px);
      }
      .prism-menu-panel {
        margin-top: 8px;
        width: min(320px, calc(100vw - 32px));
        max-height: min(70vh, 620px);
        overflow: auto;
        border-radius: 16px;
        border: 1px solid hsl(var(--border-300) / 0.24);
        background: hsl(var(--bg-000));
        box-shadow: 0 24px 50px rgba(15, 23, 42, 0.18);
        padding: 10px;
        pointer-events: auto;
      }
      .prism-provider-row {
        border-radius: 14px;
        border: 1px solid hsl(var(--border-300) / 0.16);
        overflow: hidden;
        margin-bottom: 8px;
      }
      .prism-provider-head {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 10px 12px;
        background: hsl(var(--bg-100));
        color: hsl(var(--text-100));
      }
      .prism-color-dot {
        width: 11px;
        height: 11px;
        border-radius: 999px;
        flex: 0 0 auto;
      }
      .prism-provider-models {
        padding: 8px;
        display: grid;
        gap: 6px;
        background: hsl(var(--bg-000));
      }
      .prism-provider-model {
        width: 100%;
        text-align: left;
        padding: 9px 10px;
        border-radius: 12px;
        background: transparent;
        color: hsl(var(--text-200));
      }
      .prism-provider-model.active {
        background: hsl(var(--bg-100));
        color: hsl(var(--text-000));
      }
    `;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'prism-provider-menu';
    document.body.appendChild(root);

    async function render() {
      const state = await registry.loadState();
      const activeDefinition = registry.getActiveProviderDefinition(state);
      const activeModel = registry.getCurrentModel(state);
      const enabled = registry.getEnabledProviders(state);

      root.innerHTML = `
        <button type="button" class="prism-menu-trigger" aria-label="Choose provider and model">
          <span>${activeModel.name}</span>
          <span class="prism-trigger-arrow">⌄</span>
        </button>
        <div class="prism-menu-panel" style="display:${panelOpen ? '' : 'none'}"></div>
      `;

      const trigger = root.querySelector('.prism-menu-trigger');
      const panel = root.querySelector('.prism-menu-panel');

      trigger.addEventListener('click', () => {
        panelOpen = !panelOpen;
        panel.style.display = panelOpen ? '' : 'none';
      });

      panel.innerHTML = enabled.map(({ definition, state: providerState }) => `
        <div class="prism-provider-row" data-provider-id="${definition.id}">
          <button type="button" class="prism-provider-head">
            <span style="display:inline-flex;align-items:center;gap:10px;">
              <span class="prism-color-dot" style="background:${definition.color}"></span>
              <span>${definition.label}</span>
            </span>
            <span>${state.activeProvider === definition.id ? '✓' : ''}</span>
          </button>
          <div class="prism-provider-models" style="display:${expandedProviderId === definition.id || (!expandedProviderId && state.activeProvider === definition.id) ? 'grid' : 'none'};">
            ${providerState.models.map((model) => `
              <button
                type="button"
                class="prism-provider-model ${state.activeProvider === definition.id && providerState.model === model.id ? 'active' : ''}"
                data-model-id="${model.id}"
              >
                ${model.name}${model.supportsVision ? ' - vision' : ''}
              </button>
            `).join('')}
          </div>
        </div>
      `).join('');

      panel.querySelectorAll('.prism-provider-head').forEach((button) => {
        button.addEventListener('click', () => {
          expandedProviderId = button.parentElement.getAttribute('data-provider-id');
          const models = button.parentElement.querySelector('.prism-provider-models');
          const shouldOpen = models.style.display === 'none';
          panel.querySelectorAll('.prism-provider-models').forEach((entry) => {
            entry.style.display = 'none';
          });
          models.style.display = shouldOpen ? 'grid' : 'none';
        });
      });

      panel.querySelectorAll('.prism-provider-model').forEach((button) => {
        button.addEventListener('click', async () => {
          const providerId = button.closest('[data-provider-id]').getAttribute('data-provider-id');
          const modelId = button.getAttribute('data-model-id');
          await registry.updateState(async (draft) => {
            draft.activeProvider = providerId;
            draft.providers[providerId].enabled = true;
            draft.providers[providerId].model = modelId;
          });
          panelOpen = false;
          render();
        });
      });
    }

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes.browserKingProviderState) {
        render();
      }
    });

    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
