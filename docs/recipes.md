# Recipes

Short, copy-paste patterns. Each one works with any template (WXT, plain or vanilla). `ext` is a connected client.

## 1. A side panel that is just your web app

The setup command gives you this. To ship it:

1. Deploy your web app at a stable URL, for example `https://app.example.com/ext`. Send `Content-Security-Policy: frame-ancestors chrome-extension://<your-store-extension-id>` so only your extension can frame it.
2. Set that URL in the side panel (`mountFrameBridge({ url })`) and its origin in `defineHost({ controllers: { frame: { origins } } })`.
3. In the web app, pin the extension: `frame({ hostOrigins: ["chrome-extension://<id>"] })`.
4. Build without the dev `key` and upload to the Chrome Web Store.

New features in the panel are now web deploys, not store reviews, as long as they use existing actions.

## 2. Your website drives the extension, with no panel open

Open your site in a normal tab. It connects through `externally_connectable`:

```ts
import { connect } from "@extension-use/client";
import { page } from "@extension-use/client/page";

const ext = await connect(page({ extensionId: "abcdefghijklmnopabcdefghijklmnop" }));
const { tabs } = await ext.tabs.list({ currentWindow: true });
```

Give page controllers only what they need. They are reachable from any page on your origin:

```ts
controllers: { page: { origins: ["https://app.example.com"], grants: ["runtime.*", "tabs.list", "tabs.activate"] } }
```

Detect whether the extension is installed by catching the error from `connect()`, which fails with `NOT_CONNECTED` after the handshake timeout.

## 3. Save the page you're reading to your server

```ts
const target = { tab: "active" as const };
const [info, { text }] = await Promise.all([ext.page.info({}, { target }), ext.dom.text({ maxLength: 100_000 }, { target })]);
await fetch("/api/clips", { method: "POST", body: JSON.stringify({ url: info.url, title: info.title, text }) });
await ext.overlay.toast({ message: "Saved", kind: "success" }, { target });
```

The request goes from your web app to your server with your app's own cookies. The extension never talks to your server.

## 4. Let the person point at something

```ts
const picked = await ext.picker.start({ prompt: "Click the price" });
// picked.locator: { css, role?, name?, testId?, text? }. Store it and reuse it later:
const { elements } = await ext.dom.query({ locator: { css: picked.locator.css } });
```

`Esc` rejects with `CANCELLED`. Listen to `ext.on("picker.hovered", ...)` for live feedback in your UI.

## 5. An AI model reads and acts on the page

`dom.snapshot` gives a compact, accessibility-style text tree with a `ref` for every interactive element. It suits a language model well:

```ts
const { text } = await ext.dom.snapshot({ format: "text", interactiveOnly: false });
// Send `text` to your model (from your back end), with a tool like:
//   click(ref: string) → ext.dom.click({ locator: { ref } })
//   fill(ref: string, value: string) → ext.dom.fill({ locator: { ref }, value })
// Take a fresh snapshot after each action.
```

Refs stay valid until the page reloads. Typing into password and payment fields is refused by default (`BLOCKED_BY_POLICY`).

## 6. Ask for a site only when needed

Ship with no host permissions for a site and ask at the moment of use. It must happen right after a click in your web app, so call it from a click handler:

```ts
button.onclick = async () => {
  const { granted } = await ext.permissions.request({ origins: ["https://*.shop.example/*"] });
  if (granted) await ext.tabs.reload();
};
```

The origins must be listed in the manifest's `optional_host_permissions`. Called without a recent click, it fails with `NEEDS_USER_GESTURE`. Only the side panel (frame) controller has `permissions.*`.

## 7. React to tab changes

```ts
const off = ext.on("tab.updated", ({ tab, changes }) => {
  if (changes.status === "complete") refreshPanelFor(tab.url);
});
ext.on("tab.activated", ({ tabId }) => refreshPanelForTab(tabId));
```
