/**
 * Effort picker dialog.
 *
 * Shown when the user triggers /effort (from the chat or the / menu). api-adapter.js writes a
 * `darkbrowserEffortPrompt` flag to chrome.storage; this script (running on the side panel) opens a
 * small modal listing the effort tiers with the active one highlighted. Picking a tier stores it in
 * `darkbrowserEffort`, which api-adapter.js reads to build the real gateway model id (lane + tier).
 */

(function() {
  'use strict';

  const TIERS = [
    { id: 'low', label: 'Low', desc: 'Fastest, least reasoning' },
    { id: 'med', label: 'Med', desc: 'Balanced' },
    { id: 'high', label: 'High', desc: 'Default' },
    { id: 'ultra', label: 'Ultra', desc: 'Most thorough, slowest' }
  ];
  const IDS = TIERS.map((tier) => tier.id);

  let overlay = null;
  let listEl = null;

  async function getEffort() {
    try {
      const result = await chrome.storage.local.get('darkbrowserEffort');
      const value = result?.darkbrowserEffort;
      return IDS.includes(value) ? value : 'high';
    } catch {
      return 'high';
    }
  }

  async function setEffort(tier) {
    try {
      await chrome.storage.local.set({ darkbrowserEffort: tier });
    } catch {
      /* ignore */
    }
  }

  function ensureOverlay() {
    if (overlay || !document.body) {
      return overlay;
    }

    const style = document.createElement('style');
    style.id = 'darkbrowser-effort-style';
    style.textContent = `
      #darkbrowser-effort {
        position: fixed;
        inset: 0;
        z-index: 2147483200;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 20px;
        background: rgba(10, 8, 14, 0.55);
        backdrop-filter: blur(2px);
        font-family: var(--font-ui, ui-sans-serif, system-ui, sans-serif);
      }
      #darkbrowser-effort .de-card {
        width: 100%;
        max-width: 320px;
        border-radius: 16px;
        border: 1px solid rgba(168, 85, 247, 0.35);
        background: hsl(var(--bg-000, 60 3% 9%));
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
        padding: 14px;
        display: grid;
        gap: 10px;
      }
      #darkbrowser-effort .de-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
      }
      #darkbrowser-effort h2 {
        margin: 0;
        font-size: 15px;
        font-weight: 600;
        color: hsl(var(--text-100, 40 12% 92%));
      }
      #darkbrowser-effort .de-sub {
        font-size: 11px;
        color: hsl(var(--text-400, 40 5% 55%));
      }
      #darkbrowser-effort .de-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        width: 100%;
        text-align: left;
        padding: 10px 12px;
        border-radius: 12px;
        border: 1px solid transparent;
        background: hsl(var(--bg-100, 60 3% 12%));
        color: hsl(var(--text-100, 40 12% 92%));
        cursor: pointer;
        font-family: inherit;
      }
      #darkbrowser-effort .de-row:hover {
        border-color: rgba(168, 85, 247, 0.5);
      }
      #darkbrowser-effort .de-row.active {
        border-color: #a855f7;
        background: color-mix(in srgb, #a855f7 16%, hsl(var(--bg-100, 60 3% 12%)));
      }
      #darkbrowser-effort .de-label {
        font-size: 14px;
        font-weight: 600;
      }
      #darkbrowser-effort .de-desc {
        font-size: 11px;
        color: hsl(var(--text-400, 40 5% 55%));
        margin-top: 1px;
      }
      #darkbrowser-effort .de-check {
        color: #c084fc;
        font-weight: 700;
        opacity: 0;
      }
      #darkbrowser-effort .de-row.active .de-check {
        opacity: 1;
      }
    `;
    document.head.appendChild(style);

    overlay = document.createElement('div');
    overlay.id = 'darkbrowser-effort';
    overlay.innerHTML = `
      <div class="de-card">
        <div class="de-head">
          <h2>Effort</h2>
          <span class="de-sub">applies to new messages</span>
        </div>
        <div class="de-list"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    listEl = overlay.querySelector('.de-list');

    // Close when clicking the backdrop (outside the card).
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        close();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && overlay && overlay.style.display !== 'none') {
        close();
      }
    });

    return overlay;
  }

  async function render() {
    if (!listEl) {
      return;
    }
    const current = await getEffort();
    listEl.innerHTML = '';
    TIERS.forEach((tier) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `de-row ${tier.id === current ? 'active' : ''}`;
      const left = document.createElement('div');
      const label = document.createElement('div');
      label.className = 'de-label';
      label.textContent = tier.label;
      const desc = document.createElement('div');
      desc.className = 'de-desc';
      desc.textContent = tier.desc;
      left.appendChild(label);
      left.appendChild(desc);
      const check = document.createElement('span');
      check.className = 'de-check';
      check.textContent = '✓';
      row.appendChild(left);
      row.appendChild(check);
      row.addEventListener('click', async () => {
        await setEffort(tier.id);
        await render();
        close();
      });
      listEl.appendChild(row);
    });
  }

  async function open() {
    ensureOverlay();
    if (!overlay) {
      return;
    }
    await render();
    overlay.style.display = 'flex';
  }

  function close() {
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') {
      return;
    }
    if (changes.darkbrowserEffortPrompt && changes.darkbrowserEffortPrompt.newValue) {
      open();
    } else if (changes.darkbrowserEffort && overlay && overlay.style.display !== 'none') {
      render();
    }
  });
})();
