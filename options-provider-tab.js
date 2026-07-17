(function() {
  'use strict';

  const TAB_ID = 'options?prism_tab=providers';
  const TAB_LABEL = 'Providers';

  function isProvidersTab() {
    return window.location.hash === `#${TAB_ID}`;
  }

  function setActiveTab() {
    const isProviders = isProvidersTab();
    const frame = document.getElementById('prism-provider-frame-wrap');
    if (!frame) {
      return;
    }

    frame.style.display = isProviders ? '' : 'none';

    const contentHost = frame.parentElement;
    if (!contentHost) {
      return;
    }

    contentHost.style.position = 'relative';
    contentHost.style.minHeight = 'calc(100vh - 180px)';

    Array.from(contentHost.children).forEach((child) => {
      if (child === frame) {
        return;
      }

      child.style.display = isProviders ? 'none' : '';
    });

    const providerButton = document.querySelector('[data-prism-provider-nav]');
    const navItems = document.querySelectorAll('nav ul button');
    navItems.forEach((button) => {
      if (!(button instanceof HTMLElement)) {
        return;
      }

      if (button === providerButton) {
        if (isProviders) {
          button.setAttribute('aria-current', 'page');
          button.setAttribute('data-state', 'active');
          button.tabIndex = 0;
        } else {
          button.removeAttribute('aria-current');
          button.removeAttribute('data-state');
        }
        button.style.background = isProviders ? 'hsl(var(--bg-300))' : 'transparent';
        button.style.color = isProviders ? 'hsl(var(--text-000))' : 'hsl(var(--text-200))';
        button.style.fontWeight = isProviders ? '550' : '430';
        return;
      }

      if (isProviders) {
        button.removeAttribute('aria-current');
        button.removeAttribute('data-state');
        button.tabIndex = -1;
        button.style.background = 'transparent';
        button.style.color = 'hsl(var(--text-200))';
        button.style.fontWeight = '430';
      } else {
        button.style.background = '';
        button.style.color = '';
        button.style.fontWeight = '';
        button.tabIndex = 0;
      }
    });
  }

  function mount() {
    const navList = document.querySelector('nav ul');
    const contentHost = document.querySelector('nav + div');
    if (!navList || !contentHost || document.getElementById('prism-provider-frame-wrap')) {
      return;
    }

    const navItem = document.createElement('li');
    const templateButton = navList.querySelector('button');
    const templateClasses = templateButton ? templateButton.className : '';
    navItem.innerHTML = `
      <button
        type="button"
        data-prism-provider-nav="true"
        class="${templateClasses}"
        style="display:block;width:100%;"
      >
        ${TAB_LABEL}
      </button>
    `;
    navItem.querySelector('button').addEventListener('click', () => {
      window.location.hash = TAB_ID;
    });
    navList.appendChild(navItem);

    const frameWrap = document.createElement('div');
    frameWrap.id = 'prism-provider-frame-wrap';
    frameWrap.style.display = 'none';
    frameWrap.style.position = 'absolute';
    frameWrap.style.inset = '0';
    frameWrap.style.zIndex = '2';
    frameWrap.innerHTML = `
      <iframe
        src="/provider-settings.html"
        title="Provider settings"
        style="width:100%;height:100%;min-height:calc(100vh - 180px);border:1px solid hsl(var(--border-300) / 0.18);border-radius:18px;background:hsl(var(--bg-100));"
      ></iframe>
    `;
    contentHost.appendChild(frameWrap);

    setActiveTab();
  }

  const observer = new MutationObserver(() => {
    mount();
    setActiveTab();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('hashchange', setActiveTab);
  mount();
})();
