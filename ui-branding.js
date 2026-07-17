(function() {
  'use strict';

  const registry = globalThis.BrowserKingRegistry;
  if (!registry) {
    return;
  }

  const replacements = [
    ['Claude in Chrome settings', 'Darkbrowser settings'],
    ['Claude for Chrome', 'Darkbrowser'],
    ['Claude Options', 'Darkbrowser Settings'],
    ['Open Claude', 'Open Darkbrowser'],
    ['Toggle Claude side panel', 'Toggle Darkbrowser side panel'],
    ['Teach Claude your workflow', 'Teach Darkbrowser your workflow'],
    ['Claude is active in this tab group', 'Darkbrowser is active in this tab group'],
    ['Stop Claude', 'Stop Darkbrowser'],
    ['Claude content', 'Darkbrowser content'],
    ['HIGH RISK: Claude can take most actions on the internet now.', 'HIGH RISK: Darkbrowser can take most actions on the internet now.'],
    ['Claude can take screenshots when responding.', 'Darkbrowser can take screenshots when responding.'],
    ['Claude is AI and can make mistakes.', 'Darkbrowser is AI and can make mistakes.'],
    ['Message Claude...', 'Message Darkbrowser...'],
    ['Reply to Claude', 'Reply to Darkbrowser'],
    ['Teach Claude', 'Teach Darkbrowser'],
    ['Pin Claude for quick access', 'Pin Darkbrowser for quick access'],
    // Catch-all: some brand strings are hardcoded as "BrowserKing" in the compiled bundle (the
    // upstream fork's build), so the Claude -> Darkbrowser rules above never see them. This sweeps
    // any leftover "BrowserKing" in visible text (e.g. the HIGH RISK banner, the reply placeholder).
    ['BrowserKing', 'Darkbrowser'],
    ['Browser King', 'Darkbrowser']
  ];

  function replaceText(root) {
    const walker = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.nodeValue || !node.nodeValue.trim()) {
        continue;
      }

      let nextValue = node.nodeValue;
      replacements.forEach(([from, to]) => {
        nextValue = nextValue.split(from).join(to);
      });

      if (nextValue !== node.nodeValue) {
        node.nodeValue = nextValue;
      }
    }
  }

  function hexToHsl(hex) {
    const sanitized = hex.replace('#', '');
    const value = sanitized.length === 3
      ? sanitized.split('').map((part) => part + part).join('')
      : sanitized;

    const red = parseInt(value.slice(0, 2), 16) / 255;
    const green = parseInt(value.slice(2, 4), 16) / 255;
    const blue = parseInt(value.slice(4, 6), 16) / 255;

    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    let hue = 0;
    let saturation = 0;
    const lightness = (max + min) / 2;

    if (max !== min) {
      const delta = max - min;
      saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);

      switch (max) {
        case red:
          hue = (green - blue) / delta + (green < blue ? 6 : 0);
          break;
        case green:
          hue = (blue - red) / delta + 2;
          break;
        default:
          hue = (red - green) / delta + 4;
          break;
      }

      hue /= 6;
    }

    return `${Math.round(hue * 360)} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%`;
  }

  function parseHsl(hsl) {
    const match = String(hsl).match(/(\d+)\s+(\d+)%\s+(\d+)%/);
    if (!match) {
      return { h: 15, s: 60, l: 50 };
    }

    return {
      h: Number(match[1]),
      s: Number(match[2]),
      l: Number(match[3])
    };
  }

  function makeTone(parts, overrides) {
    return `${overrides.h ?? parts.h} ${overrides.s ?? parts.s}% ${overrides.l ?? parts.l}%`;
  }

  function ensureThemeStyle() {
    let style = document.getElementById('browserking-provider-theme-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'browserking-provider-theme-style';
      document.head.appendChild(style);
    }
    return style;
  }

  function hexToRgb(hex) {
    const raw = hex.replace('#', '');
    const value = raw.length === 3 ? raw.split('').map((p) => p + p).join('') : raw;
    return {
      r: parseInt(value.slice(0, 2), 16),
      g: parseInt(value.slice(2, 4), 16),
      b: parseInt(value.slice(4, 6), 16)
    };
  }

  function isDarkColor(hex) {
    const { r, g, b } = hexToRgb(hex);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance < 0.5;
  }

  function patchShimmerGradients(color) {
    const { r, g, b } = hexToRgb(color);
    const shimmerEl = document.querySelector('[style*="#d97757"], [style*="#D97757"], [style*="217, 119, 87"]');
    if (shimmerEl) {
      shimmerEl.style.backgroundImage = shimmerEl.style.backgroundImage
        .replace(/#[dD]97757/g, color)
        .replace(/#[eE][aA]896[aA]/g, color)
        .replace(/rgba?\(217,\s*119,\s*87/g, `rgba(${r}, ${g}, ${b}`);
    }
  }

  async function applyTheme() {
    const state = await registry.loadState();
    const definition = registry.getActiveProviderDefinition(state);
    const hsl = hexToHsl(definition.color);
    const parts = parseHsl(hsl);
    const brand000 = makeTone(parts, { l: Math.max(28, parts.l - 12) });
    const brand100 = makeTone(parts, { l: Math.max(34, parts.l - 6) });
    const brand200 = makeTone(parts, { l: Math.min(62, parts.l + 2) });
    const brand900 = makeTone(parts, { s: Math.max(8, parts.s - 36), l: 10 });
    const accentBrand = makeTone(parts, { l: Math.max(34, parts.l - 6) });
    const accent000 = makeTone(parts, { l: Math.max(34, parts.l - 4) });
    const accent100 = makeTone(parts, { l: Math.max(40, parts.l) });
    const accent200 = makeTone(parts, { l: Math.max(40, parts.l) });
    const accent900 = makeTone(parts, { s: Math.max(22, parts.s - 18), l: 22 });
    const warning000 = makeTone(parts, { l: 24 });
    const warning100 = makeTone(parts, { l: 34 });
    const warning200 = makeTone(parts, { l: 34 });
    const warning900 = makeTone(parts, { s: Math.max(48, parts.s - 8), l: 84 });

    const palette = {
      '--brand-000': brand000,
      '--brand-100': brand100,
      '--brand-200': brand200,
      '--brand-900': brand900,
      '--accent-brand': accentBrand,
      '--accent-000': accent000,
      '--accent-100': accent100,
      '--accent-200': accent200,
      '--accent-900': accent900,
      '--accent-pro-000': accent000,
      '--accent-pro-100': accent100,
      '--accent-pro-200': accent200,
      '--color-brand-000': `hsl(${brand000})`,
      '--color-brand-100': `hsl(${brand100})`,
      '--color-brand-200': `hsl(${brand200})`,
      '--color-accent-brand': `hsl(${accentBrand})`,
      '--color-accent-000': `hsl(${accent000})`,
      '--color-accent-100': `hsl(${accent100})`,
      '--color-accent-200': `hsl(${accent200})`,
      '--color-accent-900': `hsl(${accent900})`,
      '--color-accent-pro-000': `hsl(${accent000})`,
      '--color-accent-pro-100': `hsl(${accent100})`,
      '--color-accent-pro-200': `hsl(${accent200})`,
      '--warning-000': warning000,
      '--warning-100': warning100,
      '--warning-200': warning200,
      '--warning-900': warning900
    };

    Object.entries(palette).forEach(([key, value]) => {
      document.documentElement.style.setProperty(key, value, 'important');
      document.body?.style?.setProperty(key, value, 'important');
    });

    document.documentElement.style.setProperty('--provider-brand-color', definition.color, 'important');
    document.body?.style?.setProperty('--provider-brand-color', definition.color, 'important');

    const style = ensureThemeStyle();
    const vars = Object.entries(palette)
      .map(([key, value]) => `${key}: ${value} !important;`)
      .join('\n        ');

    style.textContent = `
      :root,
      html[data-theme="claude"],
      body[data-theme="claude"],
      body,
      [data-theme="claude"] {
        ${vars}
      }

      .bg-brand-000 {
        background-color: hsl(var(--brand-000)) !important;
      }

      .hover\\:bg-brand-200:hover {
        background-color: hsl(var(--brand-200)) !important;
      }

      .bg-accent-brand,
      .bg-accent-pro-000,
      .bg-accent-000 {
        background-color: hsl(var(--accent-000)) !important;
      }

      .hover\\:bg-accent-100:hover,
      .hover\\:bg-accent-pro-100:hover {
        background-color: hsl(var(--accent-100)) !important;
      }

      .text-accent-brand,
      .text-accent-000,
      .text-accent-pro-000 {
        color: hsl(var(--accent-000)) !important;
      }

      .border-accent-brand,
      .border-accent-000,
      .border-accent-pro-000 {
        border-color: hsl(var(--accent-000)) !important;
      }

      .bg-warning-900 {
        background-color: hsl(var(--warning-900)) !important;
      }

      .text-warning-000,
      .text-warning-100,
      .text-warning-200 {
        color: hsl(var(--warning-000)) !important;
      }

      .ring-accent-brand,
      .ring-accent-000 {
        --tw-ring-color: hsl(var(--accent-000)) !important;
      }

      .fill-accent-brand,
      .fill-accent-000 {
        fill: hsl(var(--accent-000)) !important;
      }

      .text-\\[\\#D97757\\],
      .text-\\[\\#d97757\\] {
        color: ${definition.color} !important;
      }

      .\\[\\&_svg\\]\\:\\!fill-\\[\\#D97757\\] svg,
      .\\[\\&_svg\\]\\:\\!fill-\\[\\#D97757\\] svg *,
      .\\[\\&_svg\\]\\:\\!fill-\\[\\#d97757\\] svg,
      .\\[\\&_svg\\]\\:\\!fill-\\[\\#d97757\\] svg * {
        fill: ${definition.color} !important;
      }

      /* The "thinking" / "shimmer" working spark renders its fill on the child <path>, so target
         descendants too - otherwise the Claude orange survives the parent svg rule above. */
      svg[class*="fill-[#D97757]"] *,
      svg[class*="fill-[#d97757]"] * {
        fill: ${definition.color} !important;
      }

      .bg-brand-000,
      .bg-brand-100,
      [class*="bg-accent-pro"],
      [class*="bg-accent-brand"] {
        background-color: hsl(var(--accent-000)) !important;
      }

      [class*="border-accent-pro"],
      [class*="border-accent-brand"],
      [class*="border-brand-"] {
        border-color: hsl(var(--accent-000)) !important;
      }

      [data-test-id="send-button"].bg-\\[\\#BF8534\\],
      .bg-\\[\\#BF8534\\] {
        background-color: hsl(var(--accent-000)) !important;
      }

      [data-test-id="send-button"].hover\\:bg-\\[\\#A06F2C\\]:hover,
      .hover\\:bg-\\[\\#A06F2C\\]:hover {
        background-color: hsl(var(--brand-000)) !important;
      }

      .bg-\\[\\#F7ECC1\\],
      .dark\\:bg-\\[\\#F5DB9A\\] {
        background-color: ${definition.color} !important;
        color: ${isDarkColor(definition.color) ? '#F5F5F5' : '#141413'} !important;
      }

      .bg-\\[\\#F7ECC1\\] *,
      .dark\\:bg-\\[\\#F5DB9A\\] * {
        color: ${isDarkColor(definition.color) ? '#F5F5F5' : '#141413'} !important;
      }

      .bg-\\[\\#141413\\].text-\\[\\#F7ECC1\\],
      .bg-\\[\\#141413\\].text-\\[\\#F7ECC1\\] * {
        color: ${definition.color} !important;
      }

      .spark-glow-container:before {
        background-image:
          radial-gradient(circle at var(--pointer-x,50%) var(--pointer-y,50%), ${definition.color}66 0%, ${definition.color}4d 20%, transparent 60%),
          conic-gradient(from var(--spark-rotate,0deg) at 50% 50%, ${definition.color}99 0%, transparent 15%, transparent 40%, ${definition.color}99 48%, ${definition.color}99 52%, transparent 60%, transparent 85%, ${definition.color}99 100%),
          conic-gradient(from var(--spark-rotate2,180deg) at 50% 50%, #fc99 0%, ${definition.color}99 35%, ${definition.color}99 65%, #fc99 100%) !important;
      }

      .gradient-bg {
        background: linear-gradient(${definition.color}0d, ${definition.color}05, #6a9bcc0f 66%, #6a9bcc1f), hsl(var(--bg-300)) !important;
      }
    `;

    patchShimmerGradients(definition.color);

    document.title = document.title
      .replace('Claude for Chrome', registry.BRAND.name)
      .replace('Claude Options', `${registry.BRAND.name} Settings`)
      .replace('New Tab', registry.BRAND.name);
    replaceText(document.body);
  }

  const observer = new MutationObserver(() => replaceText(document.body));
  observer.observe(document.documentElement, { childList: true, subtree: true });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.browserKingProviderState) {
      applyTheme();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyTheme, { once: true });
  } else {
    applyTheme();
  }
})();
