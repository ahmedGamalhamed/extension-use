# Extension-use

Status: **phases 0–5 built**:
- protocol, router, content runtime;
- frame, page and remote (relay) transports;
- bridge actions for gesture-gated APIs;
- `create-extension-use` with `wxt`, `plain` and no-build `vanilla` templates;
- the `@extension-use/wxt` module;
- the test kit;
- the local relay with pairing, tokens, the HTTP/SSE/WebSocket API, the control panel, the kill switch and visible-control indicators;
- for agents: the MCP server, `run.sequence`, `runtime.describe`, snapshot options for language models (`viewportOnly`, `textMaxLength`), codegen for host-defined actions, and a playground in the control panel;
- the relay's `RelayBackend` interface (tenants, limit checks, usage events), so a hosted relay can add accounts and limits without forking it;
- unit and browser tests.

Scope note (2026-11-05): framework support is WXT and plain JS/TS only. CRXJS and Plasmo are out of scope; other bundlers can use `withExtensionUse()` or the CLI.

Started 2026-11-05, based on the "web-driven side panel" idea.

## 1. The idea, expanded

The first idea was narrow. The side panel loads our web app in an iframe, and the extension relays `postMessage` calls to a small set of page actions.

Extension-use makes that relay general. **An extension built with the SDK becomes a programmable browser agent that other parties can drive through a fixed, declarative action set.** The side panel iframe is one of several ways to drive it:

| Controller | Where it runs | How it reaches the extension | Typical use |
|---|---|---|---|
| **Frame** | Our web app in an iframe inside the side panel, popup, options page or an in-page overlay | `window.postMessage` → frame bridge → `chrome.runtime` | Web-driven UI (the original idea) |
| **Page** | An allowed website open in a normal tab | `externally_connectable` (`chrome.runtime.sendMessage/connect` from the page), or a content-script bridge where that is not supported | Our site drives the extension directly, with no panel open |
| **Remote** | A backend, script, CI job or AI agent | The extension holds an outbound WebSocket to a **relay**; the controller calls the relay's HTTP/WS API | Automation, "launch action X from a server", agents |
| **Native** (later) | A local CLI or desktop app | Chrome native messaging | Local tools and dev scripts |

All four speak **the same protocol** and run **the same actions**. Only the transport and the trust checks differ. A feature built against the client API works whichever way it is connected.

The name follows "computer-use" and "browser-use": a controller *uses the extension* the way an agent uses a computer. The extension holds the privileges (tabs, host permissions, capture). The controller only gets to ask for them through actions the extension chose to expose.

### Priorities

**The SDK comes first.** Many people should be able to use it for their own projects, and nothing built around it (such as a hosted relay) may ever get in the way of that. In practice:

1. **Everything works with no account and no cloud.** Frame, page, remote (with a local or self-hosted relay), native and MCP all work for free, offline, on someone's own machine.
2. **Setup takes minutes.** One command creates a working extension plus a controller. It works with the common extension frameworks and doesn't force a build tool.
3. **Pay only for what you use.** Unused actions aren't bundled, and the extension's permissions match the actions actually used.
4. **Stable and typed.** Semver, a documented protocol, deprecation windows, and full TypeScript types from end to end.
5. **No private shortcuts.** Products built by the maintainers use the public SDK like everyone else. If they need something, it goes into the SDK for everyone.

## 2. Concepts

- **Host**: the extension that embeds the SDK. It defines which actions exist and which controllers may call them.
- **Controller**: whoever sends commands (frame, page, remote, native).
- **Transport**: the channel between a controller and the host's background.
- **Action**: a named, versioned operation with a typed input and output, such as `dom.click` or `tabs.open`. It is data in and data out. It never runs code it receives.
- **Event**: something the host pushes to controllers, such as `tab.updated`, `dom.clicked`, `picker.selected` or `recording.stopped`.
- **Capability**: an action plus the scope it may run on, for example `dom.click` on `*.example.com`. The handshake announces capabilities. Grants limit them per controller.
- **Session**: one connected controller with its id, origin or token, its grants and its subscriptions.
- **Target**: what an action applies to: a tab, a frame in it, and an element in that frame.

## 3. Architecture

```
 Frame controller        Page controller          Remote controller (server / agent / MCP)
 (iframe in panel)       (allowed website)                 │  HTTPS / WS
      │ postMessage           │ externally_connectable     ▼
      ▼                       │                       ┌─────────┐
 frame bridge                 │                       │  Relay  │  (auth, pairing, routing, queue)
 (panel page, checks origin)  │                       └────┬────┘
      │ runtime port          │ runtime port               │ outbound WebSocket (opened by extension)
      ▼                       ▼                            ▼
 ┌─────────────────────────────────────────────────────────────────┐
 │ Background: router                                              │
 │   sessions · grants · policy · audit log · action registry      │
 └───────────────┬──────────────────────────────┬──────────────────┘
                 │ tabs.sendMessage / ports      │ chrome.* APIs
                 ▼                               ▼
     content runtime (per tab/frame)      background actions
     dom.*, overlay.*, picker.*           tabs.*, capture.*, storage.*, downloads.*
```

The **router** is the core. Every command, whatever its transport, goes through the same steps:

1. decode and validate the envelope and the input schema;
2. check the session's grants and the global policy (blocked sites, sensitive fields, rate limits);
3. resolve the target (which tab, which frame);
4. run the action in the background, or forward it to the content runtime in that frame;
5. return the result or a typed error, and write an audit entry.

## 4. Protocol

One envelope for every transport:

```ts
type Envelope =
  | { v: 1; kind: "hello"; client: ClientInfo }                                   // controller → host
  | { v: 1; kind: "welcome"; host: HostInfo; capabilities: Capability[]; session: string }
  | { v: 1; kind: "call"; id: string; action: string; input: unknown; target?: Target; timeoutMs?: number }
  | { v: 1; kind: "result"; id: string; ok: true; output: unknown }
  | { v: 1; kind: "result"; id: string; ok: false; error: { code: ErrorCode; message: string; data?: unknown } }
  | { v: 1; kind: "cancel"; id: string }
  | { v: 1; kind: "subscribe" | "unsubscribe"; events: string[]; filter?: EventFilter }
  | { v: 1; kind: "event"; name: string; payload: unknown; tabId?: number; ts: number }
  | { v: 1; kind: "progress"; id: string; payload: unknown };                      // long-running actions
```

- **Versioning.** `v` is the envelope version. Each action also has its own version (`dom.click@1`). The host announces the versions it supports. The client picks the highest one both sides know.
- **Error codes** are a closed set: `UNKNOWN_ACTION`, `INVALID_INPUT`, `NOT_GRANTED`, `BLOCKED_BY_POLICY`, `TARGET_NOT_FOUND`, `ELEMENT_NOT_FOUND`, `TIMEOUT`, `CANCELLED`, `NEEDS_USER_GESTURE`, `NEEDS_PERMISSION`, `TAB_CLOSED`, `DEVICE_OFFLINE`, `QUOTA_EXCEEDED`, `PLAN_REQUIRED`, `INTERNAL`. The last two are for relays that enforce limits, and carry an upgrade URL in `data`.
- **Targets:**
  ```ts
  type Target = {
    tab?: "active" | number | { urlMatch: string };   // default: the active tab of the window that owns the controller
    frame?: "top" | number | { urlMatch: string };
  };
  ```
- **Locators** for elements, from most to least stable: `{ ref }` (an id from a previous `dom.snapshot`), `{ role, name }`, `{ text }`, `{ testId }`, `{ css }`, with an optional `nth`. The content runtime resolves them and waits for the element within the action's timeout.
- **Sequences.** `run.sequence` takes a list of calls with `waitFor` conditions and an `onError` rule (`stop`, `continue`). It cuts round trips for remote controllers and stays declarative: no branches on returned values, no expressions. A controller that needs logic runs it on its own side.

## 5. Action set

The action set is what the store review approves, so it has to be generic and complete from the first release. A new primitive needs an extension release. New combinations of primitives do not.

**Tabs and navigation** (background): `tabs.list`, `tabs.open`, `tabs.close`, `tabs.activate`, `tabs.navigate`, `tabs.reload`, `tabs.goBack`, `tabs.waitForLoad`, `windows.list`.

**Reading the page** (content):
- `page.info`: url, title, size, scroll position, viewport.
- `dom.snapshot`: a compact accessibility-style tree with `ref` ids for interactive elements. This is the main input for AI controllers.
- `dom.query`: elements by locator, with chosen fields (text, attributes, bounding box, visible or not).
- `dom.text`: the readable text of the page or of one element.
- `dom.html`: the markup of the page or of one element, with current form values and sensitive values masked.
- `wait.for`: an element appears, disappears or is visible; a URL matches; the network goes quiet.

**Interacting** (content, with real input events where possible):
- `dom.click`, `dom.hover`, `dom.type`, `dom.fill`, `dom.select`, `dom.check`, `dom.press` (keys);
- `dom.scrollTo`, `page.scroll`, `dom.focus`, `dom.drag`.

**Overlay UI** (content, drawn in a shadow root):
- `overlay.highlight` (outline elements, with a label), `overlay.clear`;
- `overlay.toast`, `overlay.cursor` (shows where an agent is acting);
- `picker.start`: the person picks an element; returns a locator and fires `picker.selected`.

**Capture** (background):
- `capture.screenshot` (visible area, or an element crop);
- `capture.fullPage` (scroll and stitch);
- `tabCapture.start` / `tabCapture.stop` (opt-in): capture a tab to keep it rendering in the background; screenshots of background tabs go through it. `record.start` / `record.stop` (saving the stream) would build on the same offscreen page. See §8.

**Host services:**
- `storage.get` / `storage.set`: a key-value store scoped to the extension and the controller;
- `downloads.start`, `clipboard.write`, `notify.show`, `permissions.request`.

**Browser data** (background, opt-in groups: each needs its own manifest permission and is never in the defaults):
- `downloads.start/list/cancel`, `bookmarks.search/list/create/update/remove`, `history.search/delete`, `cookies.list/set/remove`.
- Site policy applies to every URL they touch. Bookmarks accept only http(s) and file URLs, because a `javascript:` bookmark runs code when clicked.

**Host-defined actions.** A host can register its own actions with a schema, such as `shop.captureItems` or `reader.saveArticle`. They go through the same router, grants and audit log. This lets each product add product-specific primitives without forking the SDK.

**Editing the page** (content, the opt-in `edit` group, so a `dom.*` grant doesn't include it):
- `edit.setHtml`, `edit.setText`, `edit.setAttributes`, `edit.remove`.
- HTML is parsed into an inert `<template>` and sanitized before it reaches the page: scripts, frames, plugins, `<base>`, `<meta>`, event-handler attributes, `srcdoc` and `javascript:` URLs are removed. `<script>` elements can't be edited, because adding text to an empty one runs it. Markup goes in; code never does.

**Never in the set:** `eval`, "run script", injecting unsanitized HTML, or a generic CDP passthrough. These would break the store's remote code rule and would turn the extension into an open remote shell.

**Optional power tier, behind its own flag:** `chrome.debugger` for trusted input events, file uploads and network capture. It shows Chrome's "is debugging this browser" banner and needs the `debugger` permission, so it ships only in hosts that opt in.

## 6. Security and trust

The more ways there are to drive the extension, the bigger this section gets. Each transport has its own trust check, and they all feed the same grant model.

### 6.1 Trust per transport

- **Frame:** the bridge accepts messages only from the iframe's `contentWindow`, and only when `event.origin` is in the host's allowlist. The web app sets `Content-Security-Policy: frame-ancestors chrome-extension://<id> …` so only our extension IDs can frame it.
- **Page:** `externally_connectable.matches` in the manifest lists the allowed origins, and Chrome enforces it. The router checks `sender.origin` again and maps it to a grant set. Where a content-script bridge is needed (Firefox, Safari), the bridge checks `event.source === window` and the origin, and only runs on allowlisted origins.
- **Remote:** nothing reaches the extension unless the person **paired** it:
  1. the person clicks "Connect" in the extension, or opens a pairing link from our app;
  2. the extension gets a short code from the relay and shows it, or the web app shows a QR code or a code the person confirms in the extension;
  3. once confirmed, the relay issues a **device token** to the extension and a **controller token** to the account or service, each with scopes;
  4. the extension shows every paired controller and can revoke each one; the relay can expire tokens.
  The extension always dials out. It never listens. Commands are data checked against the same schemas and grants.
- **Native:** `allowed_origins` in the native host manifest, and grants like any other controller.

### 6.2 Grants

A grant is `{ controller, actions[], sites[], expires? }`. The defaults are strict:

- the frame and page controllers from our own origins get the full set on the sites the person allows;
- remote controllers get only what was approved when pairing, for example "read-only on all sites" or "full control on `*.shop.com`";
- a host-wide **site policy** always wins: `chrome://`, the Web Store, bank and payment domains (configurable), and the person's own blocklist.

### 6.3 Guard rails in the runtime

- **Visible control.** While a remote or page controller is active, the toolbar badge changes and a thin border or `overlay.cursor` shows on the tab. The person always knows when something else is acting.
- **Kill switch.** One click in the popup, or a keyboard shortcut, pauses every session.
- **Sensitive fields.** `dom.type` / `dom.fill` refuse `input[type=password]`, payment fields (`autocomplete=cc-*`) and similar fields, unless the host opts in and the person confirms. `dom.text` / `dom.snapshot` mask those values.
- **Confirmations.** Hosts can mark actions as `confirm: true`, such as form submits on new sites or downloads. The person approves them in the extension UI, never in the controller.
- **Rate limits and quotas** per session.
- **Audit log** of who called what, on which tab, and when. It is kept locally, shown in the extension, and can be exported.

## 7. Remote endpoint and relay

This is the "launch actions from an endpoint" part.

```
POST /v1/devices/:deviceId/calls        { action, input, target, timeoutMs }  → result (waits up to timeoutMs)
POST /v1/devices/:deviceId/sequences    { steps: [...] }                       → results
GET  /v1/devices/:deviceId/events       (SSE)                                  → events stream
WS   /v1/devices/:deviceId/session      full protocol, both ways
GET  /v1/devices                         paired devices, online or not, capabilities
```

- **The relay is a router, not a brain.** It authenticates both sides, maps controller to device, forwards envelopes, and holds calls briefly while a device reconnects. It can run on Cloudflare Workers + Durable Objects (one object per device, which holds its WebSocket), or on a small Node service.
- **Offline devices.** Calls fail fast with `DEVICE_OFFLINE` by default. An optional short queue (TTL in seconds) covers reconnects. There is no long queue: replaying stale clicks hours later is dangerous.
- **Keeping the MV3 service worker alive.** Since Chrome 116, an active WebSocket keeps the service worker alive as long as messages flow at least every 30 s, so the extension sends a heartbeat. The fallback is an offscreen document that holds the socket. Reconnect uses backoff, and the extension resumes with its device token.
- **Self-hosting and local use.** The relay is open source, and its URL is a host setting. `npx @extension-use/relay` starts a single-user relay on `localhost`, with no account, no database and pairing by code in the terminal. Personal projects (a script on your laptop, a home server, a Raspberry Pi) get full remote control with nothing hosted by us. The same relay deploys to Cloudflare, Fly or Docker for people who want it online.
- **MCP adapter.** A small `@extension-use/mcp` server exposes the capability list as MCP tools (one tool per action, with schemas from the registry). Any MCP agent (Claude, IDEs, …) can then drive a paired browser. This is the shortest path to "extension-use for agents" and costs little once the relay exists.

## 8. MV3 and browser realities

- **User gestures.** A click inside the iframe does **not** count as a gesture for the extension once it arrives as a message. `tabCapture`, `permissions.request` and `sidePanel.open` need a gesture in an extension page. Plan: the SDK has a `gesture.request` action that shows a small "Allow / Start" button in the side panel or popup. The person's click there carries the gesture. From remote, these actions return `NEEDS_USER_GESTURE` with a prompt the extension shows.
- **Background tabs.** Chrome stops painting a tab that isn't in front: `captureVisibleTab` can't see it, `requestAnimationFrame` pauses, and timers slow to about once a second (once a minute after a while). It may also discard the tab when memory is low. Content actions don't wait on animation frames or timers alone, so they still work there. A discarded tab is reloaded before a content action runs, and `tabs.update` takes `autoDiscardable: false` to prevent it. **Tab capture keeps the tab rendering:** while a capture stream for the tab is open, Chrome paints it, runs its frames and timers at full speed, and doesn't discard it. The tabCapture group holds such a stream in an offscreen document (`USER_MEDIA`), which the service worker gets with `tabCapture.getMediaStreamId` (Chrome 116+). Screenshots of a background tab read a frame from it. Chrome allows this only on a tab where the person invoked the extension (activeTab-style grant, until the tab navigates away), so without that the call returns `NEEDS_USER_GESTURE`. Tested in `tests/e2e/background-tabs.spec.ts`. The tests allowlist the example extension with `--allowlisted-extension-id`, because Playwright can't click the toolbar. Playwright also keeps every page it controls visible, so the throttling itself isn't measured there.
- **Host permissions.** Ship with `activeTab` plus optional host permissions. `permissions.request` (behind a gesture) widens them per site. The capability list in the handshake reflects what is granted right now.
- **Storage and sign-in in the iframe.** Third-party cookie and storage partitioning may apply under a `chrome-extension://` top frame. This needs a spike: Firebase auth, cookies, IndexedDB. If it fails, use a token handoff: the extension fetches a token from the signed-in site tab, or does `chrome.identity`, and passes it to the frame over the bridge.
- **Cross-browser.** Chrome first. Edge works the same way. Firefox: no `externally_connectable` for web pages and no `sidePanel` (it has `sidebar_action`), so use the content-script bridge. Safari: last, with limits.

### Phase 0 spike results (2026-11-05)

Measured in `tests/e2e/extension.spec.ts` with Playwright's Chromium and the example extension (which has `<all_urls>` host permissions):

- **Storage in the iframe works and is shared with the top-level site.** localStorage and IndexedDB work in the framed app. Values written in the frame are visible when the same origin is opened as a normal tab, so Firebase-style IndexedDB sign-in should be shared.
- **Cookies: only `SameSite=None; Secure` cookies work inside the frame.** A `SameSite=Lax` cookie set in the frame was not stored. Sign-in cookies the panel needs must be `SameSite=None; Secure`, or the app must use token-based auth. Still to check: Chrome with third-party cookies blocked, and an extension with narrower host permissions.
- **User gesture: a click in the iframe gives the extension page transient activation.** Chrome passes user activation up to parent frames. So gesture-gated APIs (`permissions.request`, `sidePanel.open`) can run **in the frame bridge page** when the controller asks right after a click. They can't run in the background service worker. (`tabCapture.getMediaStreamId` is different: it needs the extension to have been invoked on the target tab, not a fresh gesture, and it works from the service worker.) **Built and verified:** bridge actions (`permissions.request/contains/getAll`) run in the frame bridge page. A real `chrome.permissions.request` call succeeds right after a click in the iframe, and returns `NEEDS_USER_GESTURE` without one.
- **WebSocket keep-alive in MV3:** built in phase 3. The extension pings every 20 s while connected, and a 1-minute alarm reconnects after the service worker restarts. Browser tests cover reconnecting after a relay restart. A long idle period in a normal Chrome (with no debugger attached) still needs a manual check.

## 9. SDK packages

```
packages/
  protocol/      envelope types, error codes, action schemas (zod → JSON Schema), version helpers
  host/          defineHost(), router, policy, grants, audit
    /background  entry for the service worker
    /content     content runtime + built-in DOM/overlay actions
    /frame       frame bridge for side panel / popup / overlay iframes
    /ui          optional prebuilt pieces: pairing screen, sessions list, kill switch, gesture prompt
  client/        typed client, one API with interchangeable transports
    /frame  /page  /remote  /native
  relay/         reference relay (Workers + Durable Objects, and a Node adapter); pluggable
                 AuthProvider / UsageSink / Entitlements / PolicySource with free defaults
  mcp/           MCP server on top of the remote client
  devtools/      message inspector (both sides), action playground
```

A hosted or company relay plugs its own accounts, limits and policy into these interfaces instead of forking the relay.

### Host side

```ts
// background.ts
import { defineHost, builtinActions } from "@extension-use/host/background";

export const host = defineHost({
  id: "shop",
  actions: { ...builtinActions, "shop.captureItems": captureItems },
  controllers: {
    frame:  { origins: ["https://app.example.com"], grants: "all" },
    page:   { origins: ["https://app.example.com"], grants: ["tabs.*", "picker.*"] },
    remote: { relay: "wss://relay.example.com", pairing: true },
  },
  policy: { blockedSites: ["*://*.bank.*/*"], sensitiveFields: "refuse" },
});
```

### Client side

```ts
import { connect } from "@extension-use/client";
import { frame } from "@extension-use/client/frame";     // or page(), remote({ token, device })

const ext = await connect(frame(), { timeoutMs: 5000 });

ext.has("record.start");                                  // from the capability handshake
await ext.dom.click({ role: "button", name: "Add to cart" });
const snap = await ext.dom.snapshot({ tab: "active" });
ext.on("picker.selected", (e) => console.log(e.locator));
await ext.call("shop.captureItems", { limit: 20 });      // host-defined action, typed when types are shared
```

Types come from the action registry. In a shared monorepo the client imports the host's action map type. Elsewhere, `extension-use codegen` builds a typed client from the JSON schemas the host publishes.

### Developer experience

This is where most of the effort goes, because it decides whether people adopt the SDK.

- **Scaffolding:** `npm create extension-use@latest` asks three questions (framework, controllers, starter actions). It creates an extension that loads in Chrome and a sample controller that already clicks something.
- **Build setups:** WXT (a module) and plain JS/TS: with esbuild, or with no build step at all using prebuilt standalone bundles. The core doesn't depend on any of them. Other bundlers can use `withExtensionUse()` or the `extension-use manifest` CLI.
- **Opt-in actions and generated permissions:** a host imports only the action groups it uses (`@extension-use/host/actions/dom`, `…/tabs`, `…/capture`). A build helper reads the chosen actions and writes the matching `permissions` and `host_permissions` into the manifest. Bundles stay small, and the store review stays easy.
- **Small runtime:** the content runtime should stay under ~15 KB gzipped with the core DOM actions. The client should stay under ~5 KB per transport.
- **Test kit:**
  - `@extension-use/testing` provides a mock host for unit tests of controllers, with recorded and replayed responses.
  - A Playwright fixture loads the real extension and connects a controller in end-to-end tests.
- **Devtools:**
  - a panel that shows every envelope, its timing and its errors on both sides;
  - an action playground that runs an action on the current tab from a form.
- **Docs:**
  - a guide for each transport;
  - a reference for each action, generated from the schemas;
  - copy-paste recipes for personal projects, for example:
    - drive your own tab manager from a web page;
    - save the page you're reading to your own server from a script;
    - let Claude use your browser through MCP and a local relay;
    - trigger browser actions from home automation;
    - build a side panel that is just your web app.
- **Stability policy:**
  - protocol v1 is frozen once 1.0 ships;
  - actions are versioned on their own (`dom.click@2` can sit next to `@1`);
  - hosts support at least the previous protocol version;
  - removals happen only after one minor release of deprecation warnings.
- **Community:**
  - public repo, issues and discussions;
  - a contributing guide for adding actions;
  - a showcase page of extensions built with the SDK.

## 10. Store policy

- Remote **data** that drives **built-in** actions is allowed. Remote **code** is not. The action set stays declarative, with no eval, no remote scripts and no `run.sequence` expressions.
- The listing and the privacy policy must say plainly that the extension can be controlled by the person's paired services and our web app, what data actions can read, and that the relay sees command payloads (or does not, if we add end-to-end encryption between controller and device).
- The `debugger` tier and broad host permissions draw extra review, so they stay opt-in per host.

## 11. Open questions

Carried over from the first idea:
- iframe sign-in and storage (§8), offline fallback for the panel (cached shell or a small built-in screen), and the privacy promise.

New with Extension-use:
1. ~~**Third-party controllers.**~~ Decided: yes. This makes the consent screen per controller, the stricter default grants and the abuse controls (site policy, rate limits, fast revocation) required, not optional.
2. **End-to-end encryption.** Should controller ↔ device payloads be encrypted so the relay sees only routing data? Usage counting only needs routing metadata, so encryption doesn't block it.
3. **Snapshot format.** Use our own compact tree, or match an existing one (such as Playwright's aria snapshot) so agents already know it?
4. **Latency.** Live features (highlight following the mouse) may need a "fast path" event channel that skips the audit and the per-call schema checks.
5. **Multiple controllers at once.** Panel + remote agent on the same tab: lock per tab, queue, or last-writer-wins?
6. **Recording and replay.** Should controllers be able to record a person's actions as a `run.sequence` and replay it? It is useful, and it adds to the store review story.

## 12. Phases

The SDK ships first and is useful on its own at every step.

| Phase | Scope | Proves |
|---|---|---|
| **0: spikes** | iframe sign-in/storage, gesture via panel button, WebSocket keep-alive in MV3 | The three biggest unknowns |
| **1: SDK core (frame)** | protocol, router, content runtime, core actions (tabs, page, dom, overlay, picker, screenshot), frame transport; opt-in action imports + permission generator; WXT adapter + plain build; `npm create extension-use`; devtools log; first docs | The original idea, and that a newcomer can start in minutes |
| **2: page + test kit** | `externally_connectable` transport, grants per origin; mock host + Playwright fixture; standalone bundles and a no-build template for plain JS; public 0.x release and recipes | Our site drives the extension with no panel; others can build on it |
| **3: remote (free)** ✅ | open-source relay with no-op tenancy, `npx` local relay, pairing, device tokens, HTTP/SSE/WS API, visible-control indicator, kill switch, audit UI | "Launch actions from an endpoint", with nothing hosted by us |
| **4: agents** ✅ (1.0 freeze not yet: still 0.x until the first public release) | MCP adapter, `dom.snapshot` tuned for LLMs, `run.sequence`, codegen; action playground; **1.0 with frozen protocol** | Extension-use as an agent tool, stable enough to build on |
| **5: pluggable relay backend** ✅ | `RelayBackend`: tenants, limit checks and usage events, with no-op defaults in the open-source relay | A hosted relay needs no fork of the SDK |
| **6: reach** | Firefox bridge, native messaging, optional debugger tier, end-to-end encryption | The SDK holds up beyond Chrome and beyond our own products |
