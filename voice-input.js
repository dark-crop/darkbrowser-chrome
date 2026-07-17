/**
 * Voice Input
 *
 * Injects a microphone button into the BrowserKing sidepanel chat input area.
 * Uses the Web Speech API (SpeechRecognition) to transcribe speech to text
 * and populate the textarea for hands-free interaction.
 */

(function() {
  'use strict';

  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    console.warn('[BrowserKing Voice] Web Speech API not supported in this browser.');
    return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  let recognition = null;
  let isListening = false;
  let micButton = null;

  const MIC_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
  </svg>`;

  const MIC_STOP_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" opacity="0.4"/>
    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" opacity="0.4"/>
    <line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
  </svg>`;

  function getProviderColor() {
    try {
      const registry = globalThis.BrowserKingRegistry;
      if (registry) {
        registry.loadState().then((state) => {
          const def = registry.getActiveProviderDefinition(state);
          if (micButton && def?.color) {
            micButton.style.setProperty('--mic-accent', def.color);
          }
        });
      }
    } catch (_) {}
    return '#BF8534';
  }

  function createMicButton() {
    const btn = document.createElement('button');
    btn.id = 'browserking-mic-btn';
    btn.type = 'button';
    btn.title = 'Voice input (click to speak)';
    btn.innerHTML = MIC_ICON;
    btn.style.cssText = `
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      padding: 0;
      border: none;
      border-radius: 6px;
      background: transparent;
      color: var(--mic-accent, #BF8534);
      cursor: pointer;
      opacity: 0.7;
      transition: opacity 0.15s, background 0.15s;
      flex-shrink: 0;
    `;

    btn.addEventListener('mouseenter', () => { btn.style.opacity = '1'; });
    btn.addEventListener('mouseleave', () => { if (!isListening) btn.style.opacity = '0.7'; });
    btn.addEventListener('click', toggleListening);

    return btn;
  }

  function startRecognition(textarea) {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';

    let baseText = textarea.value;
    if (baseText && !baseText.endsWith(' ')) {
      baseText += ' ';
    }

    recognition.onresult = (event) => {
      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }

      if (final) {
        baseText += final + ' ';
      }

      // Update textarea value and trigger React's synthetic event
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(textarea, baseText + interim);
      } else {
        textarea.value = baseText + interim;
      }
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    };

    recognition.onerror = (event) => {
      if (event.error !== 'aborted') {
        console.warn('[BrowserKing Voice] Recognition error:', event.error);
      }
      stopListening();
    };

    recognition.onend = () => {
      if (isListening) {
        // Auto-restart if we were still meant to be listening
        try { recognition.start(); } catch (_) { stopListening(); }
      }
    };

    recognition.start();
  }

  function stopListening() {
    isListening = false;
    if (recognition) {
      try { recognition.stop(); } catch (_) {}
      recognition = null;
    }
    if (micButton) {
      micButton.innerHTML = MIC_ICON;
      micButton.style.opacity = '0.7';
      micButton.style.background = 'transparent';
      micButton.title = 'Voice input (click to speak)';
    }
  }

  function toggleListening() {
    const textarea = document.querySelector('textarea[placeholder], textarea');
    if (!textarea) return;

    if (isListening) {
      stopListening();
      return;
    }

    isListening = true;
    micButton.innerHTML = MIC_STOP_ICON;
    micButton.style.opacity = '1';
    micButton.style.background = 'rgba(239, 68, 68, 0.15)';
    micButton.style.color = '#EF4444';
    micButton.title = 'Stop recording';
    startRecognition(textarea);
  }

  function injectMicButton() {
    if (document.getElementById('browserking-mic-btn')) return;

    // Look for the toolbar area near the send button
    const sendButton = document.querySelector('[data-test-id="send-button"], button[aria-label*="Send"], button[type="submit"]');
    if (!sendButton) return;

    micButton = createMicButton();
    getProviderColor();

    // Insert before the send button
    const parent = sendButton.parentElement;
    if (parent) {
      parent.insertBefore(micButton, sendButton);
    }
  }

  // Poll for the send button to appear (React renders async)
  let attempts = 0;
  const interval = setInterval(() => {
    injectMicButton();
    attempts++;
    if (document.getElementById('browserking-mic-btn') || attempts > 60) {
      clearInterval(interval);
    }
  }, 500);

  // Re-inject if UI re-renders
  const observer = new MutationObserver(() => {
    if (!document.getElementById('browserking-mic-btn')) {
      injectMicButton();
    }
  });

  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true
  });

})();
