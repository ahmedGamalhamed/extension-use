# Start a new extension

`create-extension-use` creates a working extension whose side panel loads your web app, plus a small demo web app to start from.

```bash
npm create extension-use@latest my-extension
```

It asks for a template and your web app's URL. To skip the questions:

```bash
npm create extension-use@latest my-extension -- --template wxt --url http://localhost:5173/ --yes
```

| Option | Meaning |
|---|---|
| `--template <wxt\|plain\|vanilla>` | The build setup. Default: ask, or `plain` with `--yes`. |
| `--url <url>` | Where your web app runs. Default `http://localhost:5173/`. |
| `--name <name>` | The extension's name. Default: the folder name. |
| `--yes` | Use the defaults and don't ask. |

With pnpm, yarn or bun, use `pnpm create extension-use`, `yarn create extension-use` or `bun create extension-use` with the same options (no `--` needed).

## Templates

| Template | For | Guide |
|---|---|---|
| `wxt` | [WXT](https://wxt.dev) projects. WXT opens Chrome with the extension loaded. | [WXT](../guides/wxt.md) |
| `plain` | TypeScript bundled with esbuild, no framework. | [Plain JS/TS](../guides/plain.md#typescript--esbuild) |
| `vanilla` | Plain JavaScript with **no build step**. `npm install` copies prebuilt bundles in. | [No build step](../guides/plain.md#plain-javascript-no-build-step) |

## What you get

- **An extension** with `defineHost()` in the background, the content runtime, and a side panel that loads your web app with `mountFrameBridge()`.
- **Two controllers set up**: `frame` for the side panel, and `page` (read-only grants) for the same app opened in a normal tab.
- **A pinned extension ID** for development. The manifest gets a public `key` from `extension-key.json`, so the ID stays the same on every machine and your web app can trust it. Store builds leave the key out (`STORE_BUILD=1` in the `plain` and `wxt` templates).
- **A demo web app** in `web/`, with buttons that snapshot the page, highlight links and run the element picker.

```bash
cd my-extension
npm install
npm run dev
```

`npm run dev` serves the web app on `http://localhost:5173` and rebuilds the extension. With `wxt`, Chrome opens with the extension loaded. With `plain`, load `dist/extension`, and with `vanilla`, load `extension/`, from `chrome://extensions` (Developer mode → **Load unpacked**). Then click the toolbar icon to open the side panel.

## Next

- Add remote control, agents, custom actions or tests: the [package picker](./picker.md) shows the extra steps for each.
- Ship the side panel: [recipe 1](../recipes.md#1-a-side-panel-that-is-just-your-web-app).
