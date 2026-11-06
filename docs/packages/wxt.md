# @extension-use/wxt

A [WXT](https://wxt.dev) module that adds what Extension-use needs to the manifest WXT generates: the permissions for your action groups, host access, and `externally_connectable` for your website.

```bash
npm install -D @extension-use/wxt
```

Needs `wxt` 0.20 or newer.

## Use it

```ts
// wxt.config.ts
import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@extension-use/wxt"],
  extensionUse: {
    groups: ["runtime", "tabs", "page", "dom", "overlay", "picker"],
    controllerOrigins: ["https://app.example.com"],
    remote: true,
  },
});
```

## Options

The options are the same as `withExtensionUse()`:

| Option | Meaning |
|---|---|
| `groups` | Groups the host enables. Must match `defineHost({ groups })`. Default: all but the opt-in ones. |
| `controllerOrigins` | Websites that connect from a normal tab. |
| `matches` | Pages the content runtime runs on. Default `<all_urls>`. |
| `remote` | Remote control through a relay: adds `storage` and `alarms`. |
| `sidePanel` | Adds `sidePanel`. Default `true`. |
| `injectOnDemand` | Adds `scripting` so the host can inject the content script. Default `true`. |

Unknown group names fail the build early.

## Entrypoints

WXT turns these into manifest entries:

| Entrypoint | Becomes | Calls |
|---|---|---|
| `entrypoints/background.ts` | The service worker | `defineHost()` |
| `entrypoints/content.ts` | A content script | `startContentRuntime()` |
| `entrypoints/sidepanel/` | `side_panel` | `mountFrameBridge()` |
| `entrypoints/options/` | The options page | `mountControlPanel()` |
| `entrypoints/offscreen/` | `offscreen.html` | `mountOffscreen()` |

Point `defineHost({ contentScript })` at `"content-scripts/content.js"`, which is where WXT puts it.

See the [WXT guide](../guides/wxt.md) for a full walkthrough.
