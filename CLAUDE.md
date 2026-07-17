# Darkbrowser - dev context

Chrome side-panel browser agent, **hard-locked to the Dark LLM gateway** with a hard sign-in (no guest
access). Same lock philosophy as [darkcode-cli](../darkcode-cli). Repo `dark-crop/darkbrowser-chrome`
(private). MIT. Based on Anthropic's Claude for Chrome (via the open-source BrowserKing fork).

## What this is (and isn't)

It does NOT reimplement browser automation. It **intercepts** the stock Claude-for-Chrome extension's
`fetch` to `api.anthropic.com/v1/messages` (in `api-adapter.js`) and re-routes to the gateway,
translating Anthropic <-> OpenAI on the fly. Our changes are a thin, contained layer on top.

## The lock (where it lives)

- `provider-registry.js` - `LOCKED_PROVIDER = 'darkllm'`. `buildDefaultState()` enables + activates
  only `darkllm`; every fallback (`getProviderDefinition`, `getActiveProviderState`, `normalizeState`)
  resolves to it. The other 15 upstream providers stay in `PROVIDERS` (routing path unchanged) but are
  never enabled or surfaced. `migrateZaiProviders` is a no-op (must never flip the active provider).
- `api-adapter.js` - the **hard sign-in gate**: `isSignedIn(provider)` (checks the key is real, not in
  `PLACEHOLDER_KEYS`). `proxyAnthropicMessages` returns a 401-style error before any upstream call when
  signed out. `DEFAULT_PROVIDER_CONFIG` -> `darkllm` @ `https://dark-llm.cropbinary.com/v1`.
- `provider-settings.html` / `.js` - Options UI surfaces only the **Dark LLM account** card (paste-flow
  sign-in). The multi-provider grid still renders but is `display:none`. Sign-in: open
  `https://dark-llm.cropbinary.com/token`, paste token, validated vs `/v1/models`, stored as
  `providers.darkllm.apiKey` via `registry.updateState`.
- `auth-bypass.js` - silences the UPSTREAM Claude login only (fake `accessToken` etc.). It never writes
  a usable Dark LLM key; the real credential is `providers.darkllm.apiKey`, gated separately.
- `signin-banner.js` - the VISIBLE half of the gate. Loaded by `sidepanel.html`; renders a full-panel
  sign-in takeover while signed out (same paste flow as the options card), hides itself once signed in.

## Sign-in = darkcode-auth

Same service as the CLI: `dark-core/darkcode-auth` serves `/token` (page + `POST`), validates
username/password (PBKDF2), returns the user's LiteLLM virtual key. That key carries all per-user
limits + private vector store.

## Conventions

- **Never rename `globalThis.BrowserKingRegistry`** or the `browserKingProviderState` storage key -
  they are internal identifiers wired across every injected script. Only user-visible strings were
  rebranded to "Darkbrowser".
- No build step. Load unpacked from source. `assets/` is upstream's bundled React app - do NOT hand-edit
  it; do our work in the root injected scripts (`*-registry.js`, `api-adapter.js`, `*-branding.js`,
  `*-overlay.js`, `provider-settings.*`).
- No em-dash characters anywhere (family rule).
- Models roster mirrors `dark-core/litellm/config.yaml` (loki / thor / thor-1m x effort tiers).
- **Vision:** all lanes are marked `supportsVision: true` because every lane loads an `--mmproj`
  projector in `dark-core/llama-swap/config.yaml`. `inferVisionSupport` also returns true for
  `darkllm`. If the gateway ever drops the projectors, flip these back.

## Known follow-ups

- None open. (Lock, hard sign-in via options card + side-panel takeover, and vision all done.)
