# @extension-use/client

The typed client that controllers use: a web app in your side panel, your website, or a script. It's small (about 2.1 KB gzipped, plus 0.8 KB for the frame transport) and has no dependencies beyond the protocol types.

```bash
npm install @extension-use/client
```

## Entry points

| Import | Export | Use it when |
|---|---|---|
| `@extension-use/client` | `connect()`, `ExtensionUseError`, types (`Client`, `CoreActions`, `Locator`, `Target`, …) | Always |
| `@extension-use/client/frame` | `frame({ hostOrigins? })`, `inExtensionFrame()` | Your app runs in an iframe that the extension's frame bridge mounted |
| `@extension-use/client/page` | `page({ extensionId })` | Your site runs in a normal tab |
| `@extension-use/client/remote` | `remote({ relay, token, device?, WebSocket? })` | Your code runs outside the browser and reaches it through a relay |
| `@extension-use/client/memory` | `memoryPair()` | Tests and custom hosts |
| `@extension-use/client/standalone/extension-use-client.js` | `connect`, `frame`, `inExtensionFrame`, `page`, `remote` and `ExtensionUseError` in one ES module | No build step |

## Quick example

```ts
import { connect } from "@extension-use/client";
import { frame } from "@extension-use/client/frame";

const ext = await connect(frame());

const { text } = await ext.dom.snapshot({ format: "text" });
await ext.dom.click({ locator: { role: "button", name: "Save" } });
await ext.overlay.toast({ message: "Saved", kind: "success" });
ext.on("tab.updated", ({ tab }) => console.log(tab.url));
```

## API

| Member | What it does |
|---|---|
| `connect(transport, options?)` | Handshake with the host. Rejects with `NOT_CONNECTED` if nothing answers. |
| `ext.<group>.<action>(input?, options?)` | Call an action, typed. |
| `ext.call(name, input?, options?)` | The same, by name. |
| `ext.callRaw(name, input?, options?)` | Call any action, including your own before you have types. |
| `ext.has(name)` | Whether the host offers the action and this controller may call it. |
| `ext.on(event, handler)` | Subscribe. Patterns like `"tab.*"` work. Returns an unsubscribe function. |
| `ext.onDisconnect(handler)` | Called when the connection ends. |
| `ext.close()` | Close the session. |
| `ext.host`, `ext.session`, `ext.capabilities`, `ext.connected` | Host info, session ID, callable actions, connection state. |

Call options: `{ target?, timeoutMs?, signal? }`. Connect options: `name`, `version`, `handshakeTimeoutMs`, `timeoutMs`, `debug`, `expose`.

The [controllers guide](../guides/controllers.md) covers transports, targets, locators, events and errors in detail. The [action reference](../actions.md) lists every action's input and output.

## Your own actions, typed

```ts
import { connect, type CoreActions } from "@extension-use/client";
import type { HostActions } from "./extension-actions"; // from `extension-use codegen`

const ext = await connect<CoreActions & HostActions>(frame());
await ext.app.saveNote({ text: "Read later" });
```

See [custom actions](../guides/custom-actions.md#generate-types).
