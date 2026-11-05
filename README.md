# Extension-use

Let a web app, a website or (soon) a remote script drive your browser extension through a fixed, typed and declarative set of actions: read the page, click, type, highlight, pick elements, manage tabs, take screenshots.

```
web app (iframe in side panel)  ──postMessage──▶  frame bridge ─┐
website (externally_connectable) ─────────────────────────────┤──▶ router (background) ──▶ content runtime (tab)
remote / MCP (planned)          ──relay──────────────────────┘        grants · policy · audit
```

The extension keeps the privileges. Controllers can only call the actions the extension enables, on the sites its policy allows. No remote code ever runs, so it stays within Chrome Web Store rules.

Status: **0.1, phase 1 of [the design](docs/design.md).** Frame and page transports work end to end. Remote relay, MCP and framework adapters come next.

## Packages

| Package | What it does | Size (min+gzip) |
|---|---|---|
| `@extension-use/protocol` | Envelope types, error codes, zod schemas for every built-in action | (types only in clients) |
| `@extension-use/host` | `/background` router and `defineHost()`, `/content` runtime with DOM actions, overlay and picker, `/frame` bridge for side panels and popups, `/permissions` manifest helper | content runtime ≈ 9.3 KB |
| `@extension-use/client` | Typed client with `frame()`, `page()` and `memoryPair()` transports | core ≈ 2.1 KB + frame ≈ 0.8 KB |

## Use it

**In the extension:**

```ts
// background.ts
import { defineHost } from "@extension-use/host/background";
defineHost({
  id: "my-ext",
  controllers: {
    frame: { origins: ["https://app.example.com"] },
    page: { origins: ["https://app.example.com"], grants: ["tabs.*", "dom.snapshot"] },
  },
  contentScript: "content.js",
});

// content.ts
import { startContentRuntime } from "@extension-use/host/content";
startContentRuntime();

// sidepanel.ts
import { mountFrameBridge } from "@extension-use/host/frame";
mountFrameBridge({ url: "https://app.example.com/ext" });
```

**In the web app:**

```ts
import { connect } from "@extension-use/client";
import { frame } from "@extension-use/client/frame";

const ext = await connect(frame());
const { text } = await ext.dom.snapshot({ format: "text" });   // accessibility-style tree with refs
await ext.dom.click({ locator: { role: "button", name: "Save" } });
await ext.dom.fill({ locator: { ref: "e12" }, value: "hello" });
const picked = await ext.picker.start({ prompt: "Pick the price" });
ext.on("tab.updated", ({ tab }) => console.log(tab.url));
```

Every action and its input is typed. Wrong input comes back as `INVALID_INPUT`, not as a silent failure.

## Built-in actions

`runtime.ping` · `tabs.list/open/close/activate/navigate/reload/waitForLoad` · `capture.screenshot` (whole view or one element) · `page.info/scroll` · `dom.query/text/snapshot/click/hover/focus/type/fill/select/check/press/scrollTo` · `wait.for` · `overlay.highlight/clear/toast` · `picker.start/cancel`

Locators: `ref` (from a snapshot), `role` + `name`, `testId`, `text`, `css`, plus `nth` and `exact`.

Guard rails on by default:
- Origin checks on every transport, and grants per controller.
- Blocked pages: `chrome://` pages, extension stores, and your own list.
- Password and payment fields are refused.
- A kill switch: `router.pause()`.
- An audit log of every call.

## Try the example

```bash
pnpm install
```

```bash
pnpm example:build
```

```bash
pnpm example:serve
```

Then load `examples/basic-extension/dist` as an unpacked extension in Chrome (`chrome://extensions` → Developer mode → Load unpacked) and click its toolbar icon. The side panel loads the controller app from `http://localhost:5173`. Test pages are at `http://127.0.0.1:5174/fixtures/form.html`. Opening `http://localhost:5173` in a normal tab connects through the page transport instead.

## Develop

```bash
pnpm typecheck
```

```bash
pnpm test
```

```bash
pnpm test:e2e
```

`test:e2e` builds the example and loads it into Playwright's Chromium (run `pnpm exec playwright install chromium` once first). Set `HEADED=1` to watch.
