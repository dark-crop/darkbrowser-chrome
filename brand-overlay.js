(function() {
  'use strict';

  const registry = globalThis.BrowserKingRegistry;
  if (!registry || !globalThis.chrome?.storage?.local) {
    return;
  }

  function hexToRgba(hex, alpha) {
    const raw = hex.replace('#', '');
    const value = raw.length === 3 ? raw.split('').map((part) => part + part).join('') : raw;
    const red = parseInt(value.slice(0, 2), 16);
    const green = parseInt(value.slice(2, 4), 16);
    const blue = parseInt(value.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }

  function ensureOverlayStyle() {
    let style = document.getElementById('browserking-overlay-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'browserking-overlay-style';
      document.head.appendChild(style);
    }
    return style;
  }

  let lastColor = null;

  async function applyOverlay() {
    const state = await registry.loadState();
    const definition = registry.getActiveProviderDefinition(state);
    const rawColor = definition.color;
    // For very dark/black colors use visible neon cyan so the glow is always perceptible
    const color = (rawColor === '#111111' || rawColor === '#0F172A' || rawColor === '#000000') ? '#22D3EE' : rawColor;
    const isDark = rawColor === '#111111' || rawColor === '#0F172A';

    // Inject CSS overrides for the stop button hover — this avoids
    // cloning the button (which caused infinite mutation loops).
    const bgNormal = isDark ? '#FAF9F5' : `${color}22`;
    const bgHover = isDark ? '#F0EEE6' : `${color}33`;
    const shadow = `0 40px 80px ${hexToRgba(color, 0.24)}, 0 4px 14px ${hexToRgba(color, 0.24)}`;

    const pulseKeyframes = `
      @keyframes claude-pulse {
        0% {
          box-shadow:
            inset 0 0 25px ${hexToRgba(color, 0.95)},
            inset 0 0 50px ${hexToRgba(color, 0.6)},
            inset 0 0 80px ${hexToRgba(color, 0.2)};
          outline: 3px solid ${hexToRgba(color, 0.7)};
        }
        50% {
          box-shadow:
            inset 0 0 35px ${hexToRgba(color, 1.0)},
            inset 0 0 70px ${hexToRgba(color, 0.75)},
            inset 0 0 110px ${hexToRgba(color, 0.35)};
          outline: 3px solid ${hexToRgba(color, 0.9)};
        }
        100% {
          box-shadow:
            inset 0 0 25px ${hexToRgba(color, 0.95)},
            inset 0 0 50px ${hexToRgba(color, 0.6)},
            inset 0 0 80px ${hexToRgba(color, 0.2)};
          outline: 3px solid ${hexToRgba(color, 0.7)};
        }
      }
    `;

    // Replace the stock animation styles directly when the element exists.
    // This is the most reliable approach since @keyframes ignores !important
    // and "last definition wins" means we must control the original element.
    const animationStyle = document.getElementById('claude-agent-animation-styles');
    if (animationStyle) {
      animationStyle.textContent = pulseKeyframes;
    }

    const overlayStyle = ensureOverlayStyle();
    // Move our style element to end of <head> so our rules come last
    document.head.appendChild(overlayStyle);
    overlayStyle.textContent = `
      #claude-agent-stop-button {
        background: ${bgNormal} !important;
        border-color: ${color}66 !important;
        box-shadow: ${shadow} !important;
      }
      #claude-agent-stop-button:hover {
        background: ${bgHover} !important;
        box-shadow: ${shadow} !important;
      }

      ${pulseKeyframes}

      #claude-agent-glow-border {
        box-shadow:
          inset 0 0 25px ${hexToRgba(color, 0.95)},
          inset 0 0 50px ${hexToRgba(color, 0.6)},
          inset 0 0 80px ${hexToRgba(color, 0.2)} !important;
        outline: 3px solid ${hexToRgba(color, 0.7)} !important;
        outline-offset: -3px !important;
      }
    `;

    // Also set inline style directly as fallback
    const border = document.getElementById('claude-agent-glow-border');
    if (border) {
      border.style.setProperty('box-shadow',
        `inset 0 0 25px ${hexToRgba(color, 0.95)}, inset 0 0 50px ${hexToRgba(color, 0.6)}, inset 0 0 80px ${hexToRgba(color, 0.2)}`,
        'important'
      );
      border.style.setProperty('outline', `3px solid ${hexToRgba(color, 0.7)}`, 'important');
      border.style.setProperty('outline-offset', '-3px', 'important');
    }

    const stopButton = document.getElementById('claude-agent-stop-button');
    if (stopButton && stopButton.innerHTML.includes('Stop Claude')) {
      stopButton.innerHTML = stopButton.innerHTML.replace('Stop Claude', 'Stop Darkbrowser');
    }

    const staticIndicator = document.getElementById('claude-static-indicator-container');
    if (staticIndicator) {
      const html = staticIndicator.innerHTML;
      if (html.includes('Claude is active') || html.includes('#D97757')) {
        staticIndicator.innerHTML = html
          .replaceAll('Claude is active in this tab group', 'Darkbrowser is active in this tab group')
          .replaceAll('#D97757', color);
      }
    }

    lastColor = color;
  }

  let debounceTimer = null;
  function debouncedApply() {
    if (debounceTimer) {
      return;
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      applyOverlay();
    }, 100);
  }

  const observer = new MutationObserver(debouncedApply);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.browserKingProviderState) {
      applyOverlay();
    }
  });
  applyOverlay();
})();
