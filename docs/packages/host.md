# @extension-use/host

Everything that runs inside your extension: the router, the page actions, the side panel bridge, the control panel, manifest helpers, a CLI, and bundles for extensions with no build step.

```bash
npm install @extension-use/host
```

## Entry points

| Import | Runs in | Main export |
|---|---|---|
| `@extension-use/host/background` | The service worker | `defineHost()`, `defineAction()`, `builtinGroups`, `allBuiltinGroups`, `ExtensionUseError` |
| `@extension-use/host/content` | A content script, in every frame | `startContentRuntime()`, `contentGroups`, `ExtensionUseError` |
| `@extension-use/host/frame` | An extension page that hosts your web app (side panel, popup) | `mountFrameBridge()` |
| `@extension-use/host/ui` | An extension page (options) | `mountControlPanel()` |
| `@extension-use/host/offscreen` | An offscreen document | `mountOffscreen()`, for the opt-in `tabCapture` group |
| `@extension-use/host/permissions` | Your build script | `withExtensionUse()`, `permissionsFor()`, `GROUP_NAMES` |
| `@extension-use/host/standalone/*` | Extensions with no build step | Prebuilt bundles: `extension-use-background.js`, `-content.js`, `-frame.js`, `-ui.js`, `-offscreen.js` |

The package also installs the [`extension-use` CLI](../reference/cli.md#extension-use): `manifest`, `codegen` and `vendor`.

## `defineHost()` options

```ts
import { defineHost } from "@extension-use/host/background";

const router = defineHost({
  id: "my-extension",
  controllers: { frame: { origins: ["https://app.example.com"] } },
});
```

| Option | Meaning |
|---|---|
| `id` | Your extension's identifier, shown to controllers. Required. |
| `name`, `version` | Shown to controllers. `version` defaults to the manifest's. |
| `controllers.frame` | `{ origins, grants? }`: web apps in an iframe inside an extension page. |
| `controllers.page` | `{ origins, grants? }`: websites that connect through `externally_connectable`. |
| `controllers.remote` | `{ grants?, relays? }`: scripts and agents through a relay. Needs the `storage` and `alarms` permissions. `relays` defaults to localhost and any `https://` relay. |
| `controllers.agent` | `{ grants?, ports?, serverName? }`: a coding agent or local model on this computer, with no relay. The person clicks **Connect an agent** in the control panel and pastes the instructions into their agent. Needs the `storage` and `alarms` permissions. See the [AI agents guide](../guides/agents.md). |
| `groups` | Built-in groups to enable. Default `allBuiltinGroups` (all but the opt-in ones). See [permissions](../guides/permissions.md). |
| `actions` | Your own actions, made with `defineAction()`. See [custom actions](../guides/custom-actions.md). |
| `policy` | `{ blockedSites?, sensitiveFields? }`. See [security](../guides/security.md#site-policy). |
| `contentScript` | Path of the bundled content script, such as `"content.js"`. The host injects it into tabs that don't have it yet. Needs `scripting`. |
| `offscreen` | Path of a page that calls `mountOffscreen()`, such as `"offscreen.html"`. Needed by the `tabCapture` group. |
| `badge` | Show control state on the toolbar icon. Default `true`. Needs an `action` in the manifest. |
| `defaultTimeoutMs` | Default call timeout, when an action has none. |
| `onAudit(entry)` | Called after every call with `{ ts, session, transport, origin, action, tabId?, ok, code?, ms }`. |
| `debug` | Log every call. |

`defineHost()` returns the router. `router.pause()`, `router.resume()` and `router.paused` control the kill switch.

## `startContentRuntime()` options

| Option | Meaning |
|---|---|
| `groups` | Content groups to include: `contentGroups.page`, `dom`, `edit`, `wait`, `overlay`, `picker`. Default: all. |
| `handlers` | Handlers for your own `where: "content"` actions, by name. |
| `indicator` | Show "Controlled by …" on the page during website and remote control. Default `true`. |

It's safe to run twice (manifest and on-demand injection). The second call does nothing.

## `mountFrameBridge()` options

See [the frame bridge](../guides/controllers.md#the-frame-bridge).

## `mountControlPanel(container, options?)`

Renders pairing with a relay, the connection state, active sessions, recent actions and **Pause all control** into `container`, inside a shadow root.

| Option | Meaning |
|---|---|
| `deviceName` | The browser's name offered when pairing. |
| `playground` | Add a form that runs any action on a tab. For development. Default `false`. |

## `mountOffscreen()`

Call it in an offscreen page, and point `defineHost({ offscreen })` at that page. It holds tab capture streams for the `tabCapture` group and for screenshots of background tabs. See [recipe 8](../recipes.md#8-work-in-background-tabs).

## No build step

`npx extension-use vendor` copies the standalone bundles into `extension/vendor` (and the client into `web/vendor`). Then:

| File | Use it in | How |
|---|---|---|
| `extension-use-background.js` | The service worker | `import { defineHost } from "./vendor/extension-use-background.js"` (manifest: `"type": "module"`) |
| `extension-use-content.js` | Content scripts | List it in `content_scripts[].js`. It starts the runtime by itself. |
| `extension-use-frame.js` | The side panel page | `import { mountFrameBridge } from "./vendor/extension-use-frame.js"` |
| `extension-use-ui.js` | The control panel page | `import { mountControlPanel } from "./vendor/extension-use-ui.js"` |
| `extension-use-offscreen.js` | The offscreen page | `<script src="vendor/extension-use-offscreen.js"></script>`. It mounts by itself. |

See the [plain JS/TS guide](../guides/plain.md#plain-javascript-no-build-step).

## Bundle size

The router checks input with zod, which adds about 35 KB gzipped to the background script. Content scripts and side panel pages stay small.
