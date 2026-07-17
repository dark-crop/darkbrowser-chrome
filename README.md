<h1 align="center">Darkbrowser</h1>

<p align="center">
  <b>A browser agent wired to your own private, uncensored LLM - not someone else's cloud.</b>
</p>

<p align="center">
  Chrome side-panel agent &nbsp;·&nbsp; one hard-locked gateway &nbsp;·&nbsp; hard sign-in, no guest access
</p>

<p align="center">
  <a href="#install"><img alt="platform" src="https://img.shields.io/badge/platform-Chrome%20%7C%20Chromium%20116%2B-informational?style=flat-square" /></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" /></a>
  <a href="#relationship-to-claude-for-chrome"><img alt="fork" src="https://img.shields.io/badge/based%20on-Claude%20for%20Chrome-8b5cf6?style=flat-square" /></a>
  <a href="#the-lock"><img alt="locked" src="https://img.shields.io/badge/provider-dark--llm%20(locked)-a855f7?style=flat-square" /></a>
  <a href="#status"><img alt="status" src="https://img.shields.io/badge/status-early%20preview-a855f7?style=flat-square" /></a>
</p>

<p align="center">
  <a href="#the-unlock">The unlock</a> ·
  <a href="#install">Install</a> ·
  <a href="#sign-in">Sign in</a> ·
  <a href="#models">Models</a> ·
  <a href="#the-lock">The lock</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#security">Security</a>
</p>

---

## The unlock

Most browser agents route everything you see and do on the web through a vendor's cloud.
**Darkbrowser routes it to a machine you own.** It is a hard-locked Chrome side-panel agent for the
self-hosted [**Dark LLM**](https://github.com/dark-crop/dark-core) gateway - your own uncensored
models, on your own GPU box. It talks to **one gateway and nothing else**: no OpenAI, no Anthropic, no
telemetry to a third party.

It keeps the full browser-automation toolkit (screenshots, clicks, typing, scrolling, multi-tab
navigation, workflow recording) and layers on the two changes that make it yours: the **provider
lock** to Dark LLM, and a **hard sign-in** - the agent will not run for anyone who has not signed in
with a Dark LLM account. Same lock, same credential, same "no guest access" as the
[**darkcode**](https://github.com/dark-crop/darkcode-cli) CLI.

```mermaid
flowchart LR
    U(["you"]) --> DB["Darkbrowser<br/>Chrome side panel"]
    DB -->|"paste token (sign in)"| AUTH{{"darkcode-auth /token<br/>username + password"}}
    AUTH -->|"Dark LLM key"| DB
    DB -->|"Bearer key"| G{{"Dark LLM gateway<br/>your GPU box"}}

    subgraph lanes["built-in dark-llm provider (locked)"]
        direction TB
        LK["Loki · fast MoE"]
        TH["Thor · coder / 256K (default)"]
        T1["Thor 1M · huge context"]
    end
    G --> lanes

    classDef hub fill:#a855f7,stroke:#7c3aed,stroke-width:2px,color:#fff
    class G,AUTH hub
```

## Highlights

| | |
|---|---|
| 🔒 **One gateway, one provider** | Hard-locked to `dark-llm`. The other 15 providers exist in code but never surface in the UI. |
| 🚪 **Hard sign-in, no guest** | The agent refuses every request until you sign in with a Dark LLM account and store a real token. |
| 🧠 **Your model lanes** | Loki (fast MoE), Thor (coder, 256K), Thor 1M (long context) - picked from the side-panel selector. |
| 🖱 **Full browser toolkit** | Screenshots, clicks, typing, scrolling, tab navigation, and workflow recording, all intact. |
| 🎨 **Provider-themed UI** | The whole panel themes to Dark LLM power-purple - sidebar, send button, page glow. |
| 🧩 **Reads pages without vision** | An accessibility-tree content script lets text-only lanes still drive the page. |

## Install

Darkbrowser is a private, unsigned extension - install it unpacked:

1. Clone this repo:
   ```bash
   git clone https://github.com/dark-crop/darkbrowser-chrome.git
   ```
2. Open `chrome://extensions` in Chrome (or any Chromium 116+ browser).
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `darkbrowser-chrome` folder.
5. Pin the **Darkbrowser** icon and open the side panel with the icon or `Cmd/Ctrl + E`.

There is no build step - the extension loads directly from source.

## Sign in

Darkbrowser will not run until you sign in. This mirrors the darkcode CLI's browser flow: sign in on
the gateway page, then paste the token back.

1. Open the extension **Options** (right-click the icon → Options, or `chrome://extensions` →
   Details → Extension options) and go to the **Providers** tab.
2. On the **Dark LLM account** card, click **Open sign-in page**. It opens
   `https://dark-llm.cropbinary.com/token`.
3. Sign in there with your Dark LLM **username and password**. The page shows your access token.
4. Copy the token, paste it into the **Access token** field, and click **Save token**.

The token is validated against the gateway (`/v1/models`) before it is stored. Once signed in, the
card shows **Signed in** and the side panel is ready. **Sign out** clears the token and re-locks the
agent.

> Don't have an account? Accounts are provisioned on the box with
> [`add-user.py`](https://github.com/dark-crop/dark-core/blob/main/docs/users.md). Each account gets
> its own usage tier and private RAG store.

## Models

Every lane routes to your gateway. Pick one from the model selector at the top of the side panel.

| Lane | What it is | Best for |
|---|---|---|
| **Thor** | 27B coder, 256K context (default) | Everyday browsing tasks, forms, extraction |
| **Thor 1M** | long-context variant | Large pages, long multi-step sessions |
| **Loki** | fast MoE | Quick, cheap actions |

Each lane has effort tiers (`med` / `high` / `ultra`) exposed as separate entries in the picker.
The gateway's exact roster is defined in
[dark-core `litellm/config.yaml`](https://github.com/dark-crop/dark-core).

> **Vision note:** the current lanes are text-first and drive the page through the accessibility tree.
> Screenshot-based visual reasoning needs a vision lane on the gateway; that is a planned follow-up.

## The lock

The lock is deliberately small and lives in a few well-contained places:

| Where | What it does |
|---|---|
| `provider-registry.js` | `LOCKED_PROVIDER = 'darkllm'`. Only Dark LLM is enabled and active by default; every fallback resolves to it. |
| `api-adapter.js` | The sign-in gate: `isSignedIn()` rejects every request with a placeholder / empty key. No guest access. |
| `provider-settings.*` | Surfaces only the Dark LLM account card; the multi-provider grid is hidden. |
| `auth-bypass.js` | Silences the *upstream* Claude login only - it never mints a usable Dark LLM key. |

The other 15 provider definitions from the upstream project are kept in code (so the routing path is
unchanged) but are hidden in the UI and never active.

## Architecture

Darkbrowser is based on Anthropic's **Claude for Chrome** extension. It does not reimplement browser
automation - it **intercepts** the stock extension's calls to `api.anthropic.com/v1/messages` and
re-routes them to your gateway, translating Anthropic ↔ OpenAI on the fly.

| File | Purpose |
|---|---|
| `provider-registry.js` | Provider definitions, the Dark LLM lock, model lists, state management |
| `api-adapter.js` | API translation layer (Anthropic ↔ OpenAI) + the hard sign-in gate |
| `provider-settings.html` / `.js` | Options UI: the Dark LLM account sign-in card (paste flow) |
| `auth-bypass.js` | Keeps the stock extension from showing Claude's own login (placeholder tokens only) |
| `ui-branding.js` | Re-skins the panel to Darkbrowser + Dark LLM power-purple |
| `brand-overlay.js` | Page glow border and stop-button theming |
| `sidepanel-provider-menu.js` | Provider / model selector in the side panel |

Requests flow: **stock extension → `fetch` intercept in `api-adapter.js` → sign-in gate → translate to
`chat/completions` → `https://dark-llm.cropbinary.com/v1` with your Bearer token.**

## Security

- **No guest access.** With no valid token, `api-adapter.js` returns a 401-style error to the agent and
  nothing reaches the gateway.
- **Token stays local.** Your Dark LLM key lives in `chrome.storage.local` on your machine and is only
  ever sent to the gateway as a Bearer header.
- **Sign-in is the same service as the CLI.** The `/token` page and `POST /token` are served by
  [`darkcode-auth`](https://github.com/dark-crop/dark-core), which validates your username/password
  (PBKDF2-hashed store) and hands back your LiteLLM virtual key - carrying all your per-user usage
  limits and private vector store.
- **Placeholder tokens are treated as signed-out.** The stock extension's fake auth keys
  (`custom-provider-*`, `darkbrowser-signed-out`) are explicitly rejected by the gate.

## Relationship to Claude for Chrome

Darkbrowser is a fork of Anthropic's
[Claude for Chrome](https://chrome.google.com/webstore/detail/claude/danfohhfmbeahkgpceibgibfpkhokbfp)
extension (via the open-source multi-provider BrowserKing project). The browser-automation engine is
upstream's; Darkbrowser adds the provider lock, the hard sign-in gate, and the Dark LLM branding. MIT
licensed.

## Family

Part of the [**dark-crop**](https://github.com/dark-crop) family:

- [**darkcode-cli**](https://github.com/dark-crop/darkcode-cli) - terminal coding agent, same lock.
- [**dark-core**](https://github.com/dark-crop/dark-core) - the gateway: LiteLLM, darkcode-auth,
  image bridge, pgvector RAG.
- **Darkbrowser** - this repo, the browser agent.

## Status

Early preview. The lock and hard sign-in work; a vision lane for screenshot reasoning is the next
step. License: MIT.
