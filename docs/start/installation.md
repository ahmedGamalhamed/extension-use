# Add to your extension

This page adds Extension-use to an extension you already have, so a web app in its side panel and your website can drive it. The code is TypeScript with a bundler. For WXT or no build step, see the [WXT guide](../guides/wxt.md) or the [plain JS/TS guide](../guides/plain.md).

::: tip Faster: use the picker
The [package picker](./picker.md) writes these steps for your exact setup, including remote control, AI agents, custom actions, opt-in groups and tests.
:::

## 1. Install

In the extension's project:

```bash
npm install @extension-use/host
```

In your web app:

```bash
npm install @extension-use/client
```

`@extension-use/protocol` comes with both. You rarely import it yourself.

## 2. Start the host in the background

`defineHost()` creates the router. It accepts connections only from the origins you list, and refuses any action a controller wasn't granted.

```ts
// background.ts (your service worker)
import { defineHost } from "@extension-use/host/background";

defineHost({
  id: "my-extension",
  controllers: {
    // Your web app inside the side panel: every enabled action.
    frame: { origins: ["https://app.example.com"] },
    // Your website in a normal tab: only what it needs.
    page: { origins: ["https://app.example.com"], grants: ["runtime.*", "tabs.list", "page.info", "dom.snapshot"] },
  },
  // Injected into tabs that were open before the extension was installed or updated.
  contentScript: "content.js",
});

chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
```

The [`@extension-use/host` page](../packages/host.md#definehost-options) lists every option. Use it to narrow the groups, add your own actions, block sites or turn on remote control.

## 3. Start the content runtime

```ts
// content.ts: bundle it as a classic script (IIFE)
import { startContentRuntime } from "@extension-use/host/content";

startContentRuntime();
```

To keep the content script small, pass only the groups you use: `startContentRuntime({ groups: [contentGroups.page, contentGroups.dom] })`.

## 4. Load your web app in the side panel

```html
<!-- sidepanel.html -->
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>html, body, #app { margin: 0; height: 100%; }</style>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="sidepanel.js"></script>
  </body>
</html>
```

```ts
// sidepanel.ts
import { mountFrameBridge } from "@extension-use/host/frame";

mountFrameBridge({ url: "https://app.example.com/ext", container: document.getElementById("app")! });
```

## 5. Update the manifest

Add the entry points:

```json
{
  "manifest_version": 3,
  "background": { "service_worker": "background.js", "type": "module" },
  "action": { "default_title": "My extension" },
  "side_panel": { "default_path": "sidepanel.html" },
  "content_scripts": [
    { "matches": ["<all_urls>"], "js": ["content.js"], "run_at": "document_idle", "all_frames": true, "match_about_blank": true }
  ]
}
```

Then let the CLI add the permissions for the groups you enable, plus `externally_connectable` for your website:

```bash
npx extension-use manifest --origins https://app.example.com --write manifest.json
```

It merges into the file and keeps your other entries. If you generate the manifest in code, `withExtensionUse(manifest, options)` from `@extension-use/host/permissions` does the same. See [action groups and permissions](../guides/permissions.md).

## 6. Connect from your web app

```ts
import { connect } from "@extension-use/client";
import { frame, inExtensionFrame } from "@extension-use/client/frame";
import { page } from "@extension-use/client/page";

const EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop"; // from chrome://extensions

const ext = await connect(
  inExtensionFrame()
    ? frame({ hostOrigins: [`chrome-extension://${EXTENSION_ID}`] }) // inside your side panel
    : page({ extensionId: EXTENSION_ID }), // in a normal tab
);

const { text } = await ext.dom.snapshot({ format: "text" });
await ext.dom.fill({ locator: { role: "textbox", name: "Email" }, value: "me@example.com" });
const picked = await ext.picker.start({ prompt: "Pick the price" });
ext.on("tab.updated", ({ tab }) => console.log(tab.url));
```

Serve the web app with `Content-Security-Policy: frame-ancestors chrome-extension://<your-extension-id>`, so only your extension can frame it.

## 7. Try it

Build, then load the output folder in `chrome://extensions` (Developer mode → **Load unpacked**). Click the toolbar icon to open the side panel.

While a controller acts on a page, the page shows it. Calls that break the rules fail with a clear code, such as `NOT_GRANTED`, `BLOCKED_BY_POLICY` or `ELEMENT_NOT_FOUND`. See [error codes](../reference/errors.md).

## Next

- [Controllers and transports](../guides/controllers.md): the client API, targets, locators and events.
- [Remote control](../guides/remote.md) and [AI agents](../guides/agents.md).
- [Custom actions](../guides/custom-actions.md): expose your extension's own features.
- [Recipes](../recipes.md): short patterns you can copy.
