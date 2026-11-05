# Extension-use with plain JavaScript or TypeScript

There are two options without a framework:

- **TypeScript + esbuild** (`--template plain`): a short `build.mjs` bundles the extension and the web app, and works out the permissions from your action groups.
- **Plain JavaScript, no build step** (`--template vanilla`): you edit `.js` files and reload. The SDK comes as prebuilt bundles that `npm install` copies into `extension/vendor` and `web/vendor`.

## TypeScript + esbuild

```bash
npm create extension-use@latest my-extension -- --template plain
```

```bash
cd my-extension && npm install && npm run dev
```

Then load `dist/extension` in `chrome://extensions` (Developer mode → Load unpacked).

Layout:

```
extension/background.ts   defineHost(): which web apps may connect, and what they may call
extension/content.ts      startContentRuntime(): the page actions
extension/sidepanel.ts    mountFrameBridge(): loads your web app in the side panel
extension/groups.ts       the action groups you enable (build.mjs derives permissions from it)
web/main.ts               your web app: connect(frame()) or connect(page({ extensionId }))
build.mjs                 builds both; --watch rebuilds and serves the web app
```

## Plain JavaScript, no build step

```bash
npm create extension-use@latest my-extension -- --template vanilla
```

```bash
cd my-extension && npm install && npm run dev
```

Then load `extension/` in `chrome://extensions`. `npm install` runs `extension-use vendor`, which copies these files in:

| File | Use it in | How |
|---|---|---|
| `extension/vendor/extension-use-background.js` | the service worker | `import { defineHost } from "./vendor/extension-use-background.js"` (manifest: `"type": "module"`) |
| `extension/vendor/extension-use-content.js` | content scripts | list it in `content_scripts[].js`; it starts the runtime by itself |
| `extension/vendor/extension-use-frame.js` | the side panel page | `import { mountFrameBridge } from "./vendor/extension-use-frame.js"` |
| `web/vendor/extension-use-client.js` | your web app | `import { connect, frame, page } from "./vendor/extension-use-client.js"` |

The bundles are also published inside the packages, at `@extension-use/host/standalone/*` and `@extension-use/client/standalone/extension-use-client.js`. You can copy them by hand or load the client from a CDN.

### Keep the manifest in sync

The vanilla `manifest.json` asks for every built-in group's permissions. To ask for less, list your groups:

```bash
npx extension-use manifest --groups runtime,page,dom,overlay --origins https://app.example.com --write extension/manifest.json
```

This merges `permissions`, `host_permissions` and `externally_connectable` into the file and keeps your other entries. Without `--write` it prints the fields.

## Adding Extension-use to an existing extension

Use the same three calls: `defineHost()` in the background, `startContentRuntime()` in a content script, and `mountFrameBridge()` in an extension page that hosts your app. Use `withExtensionUse()` from `@extension-use/host/permissions`, or the CLI above, for the manifest. See the [action reference](../actions.md) for what controllers can call.
