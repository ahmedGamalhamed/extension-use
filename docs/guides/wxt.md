# Extension-use with WXT

[WXT](https://wxt.dev) builds the extension, and `@extension-use/wxt` fills in the manifest. Your web app drives the extension through `@extension-use/client`.

## New project

```bash
npm create extension-use@latest my-extension -- --template wxt
```

```bash
cd my-extension && npm install && npm run dev
```

`npm run dev` starts your web app on `http://localhost:5173` and WXT, which opens Chrome with the extension loaded. Click the extension's toolbar icon to open the side panel.

## Add to an existing WXT project

```bash
npm install @extension-use/host @extension-use/client
```

```bash
npm install -D @extension-use/wxt
```

**`wxt.config.ts`**: the module adds the permissions for the groups you list, and `externally_connectable` for your web app.

```ts
import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@extension-use/wxt"],
  extensionUse: {
    groups: ["runtime", "tabs", "page", "dom", "overlay", "picker"],
    controllerOrigins: ["https://app.example.com"],
  },
});
```

**`entrypoints/background.ts`**: list the same groups.

```ts
import { builtinGroups, defineHost } from "@extension-use/host/background";
const { runtime, tabs, page, dom, overlay, picker } = builtinGroups;

export default defineBackground({
  type: "module",
  main() {
    defineHost({
      id: "my-extension",
      groups: [runtime, tabs, page, dom, overlay, picker],
      controllers: {
        frame: { origins: ["https://app.example.com"] },
        page: { origins: ["https://app.example.com"], grants: ["runtime.*", "dom.snapshot"] },
      },
      contentScript: "content-scripts/content.js", // inject into tabs opened before install
    });
  },
});
```

**`entrypoints/content.ts`**: pass only the content groups you use, so unused actions aren't bundled.

```ts
import { contentGroups, startContentRuntime } from "@extension-use/host/content";

export default defineContentScript({
  matches: ["<all_urls>"],
  main() {
    startContentRuntime({ groups: [contentGroups.page, contentGroups.dom, contentGroups.overlay, contentGroups.picker] });
  },
});
```

**`entrypoints/sidepanel/index.html`** + **`main.ts`**: WXT turns a `sidepanel` entrypoint into the manifest's `side_panel`.

```ts
import { mountFrameBridge } from "@extension-use/host/frame";
mountFrameBridge({ url: "https://app.example.com/ext", container: document.getElementById("app")! });
```

## Tips

- **Pin the extension ID in development.** Put a public `key` in `manifest` (the template generates one in `extension-key.json`). Your web app can then trust `chrome-extension://<id>` in `frame-ancestors` and in `frame({ hostOrigins })`. Leave the key out of the store build.
- **The groups must match** between `extensionUse.groups` and `defineHost({ groups })`. If an action's group is missing from the manifest side, the permission it needs is missing too.
- **Background bundle size:** the router validates inputs with zod, which adds about 35 KB gzipped to the background script. Content scripts and side panel pages stay small.
