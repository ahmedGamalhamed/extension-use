# Controllers and transports

A **controller** is anything that drives your extension: a web app, a website, a script or an agent. It connects through a **transport**, and the host checks every call against what that controller was granted.

## The three transports

| | `frame` | `page` | `remote` |
|---|---|---|---|
| Controller | A web app in an iframe in an extension page (side panel, popup, options) | A website in a normal tab | A script, server, CI job or agent |
| Client import | `@extension-use/client/frame` | `@extension-use/client/page` | `@extension-use/client/remote` |
| Host config | `controllers.frame` | `controllers.page` | `controllers.remote` |
| Connects through | `postMessage` to the frame bridge | `externally_connectable` | A relay the person paired with |
| Who it is | The iframe's origin, checked by the bridge and the background | The sender's origin, checked by Chrome and the background | The token the relay issued |
| `permissions.*` actions | Yes, after a click in the app | No | No |
| Default tab | The active tab of the panel's window | The active tab of the site's window | The active tab of the last focused window |

Enable only the controllers you use. A transport with no entry in `controllers` refuses every connection.

```ts
defineHost({
  id: "my-extension",
  controllers: {
    frame: { origins: ["https://app.example.com", "http://localhost:5173"] },
    page: { origins: ["https://app.example.com"], grants: ["runtime.*", "tabs.list", "dom.snapshot"] },
    remote: { grants: ["runtime.*", "tabs.*", "page.*", "dom.*"] },
  },
});
```

`grants` defaults to every enabled action (`"all"`). Patterns use `*`, as in `"dom.*"`. A page controller is reachable from any page on its origin, so give it only what it needs.

## Connecting

```ts
import { connect } from "@extension-use/client";
import { frame } from "@extension-use/client/frame";

const ext = await connect(frame({ hostOrigins: ["chrome-extension://abcdefghijklmnopabcdefghijklmnop"] }), {
  name: "my-web-app",
  timeoutMs: 15_000,
});
```

`connect()` does a handshake and resolves when the host answers. It rejects with `NOT_CONNECTED` if no host answers in time. In a page controller, that usually means the extension isn't installed.

| `connect()` option | Meaning |
|---|---|
| `name`, `version` | Shown to the host in the handshake and in its activity log. |
| `handshakeTimeoutMs` | How long to wait for the host. Default 5000 ms. |
| `timeoutMs` | Default timeout for calls. Default: each action's own. |
| `debug` | Log every message to the console. |
| `expose` | Put the client on `globalThis.__extensionUse` (or a name you pass), so [Playwright tests](./testing.md) can reach it. Use it in development builds. |

### Transport options

**`frame({ hostOrigins? })`**: the extension pages allowed to drive this app. The default is any extension origin. Pin your extension's ID in production. `inExtensionFrame()` tells you whether the app is running inside an extension iframe, so one app can pick `frame()` or `page()` itself.

**`page({ extensionId })`**: the extension to connect to. The site's origin must be in the extension's `externally_connectable.matches` (the CLI, the WXT module and `withExtensionUse()` add it from `controllerOrigins`) and in `controllers.page.origins`.

**`remote({ relay, token, device?, WebSocket? })`**: the relay URL and a controller token. `device` picks a paired browser, and defaults to the most recently connected one. Pass a `WebSocket` class where there's no global one. See [remote control](./remote.md).

**`memoryPair()`** from `@extension-use/client/memory`: an in-memory transport for tests and custom hosts. [`createMockHost()`](./testing.md) uses it.

## The client

```ts
await ext.dom.click({ locator: { role: "button", name: "Save" } });        // typed, by namespace
await ext.call("dom.click", { locator: { ref: "e12" } });                  // typed, by name
await ext.callRaw("app.saveNote", { text: "hi" });                         // any action, untyped

ext.has("tabs.close");          // offered by the host and granted to this controller?
ext.host;                       // { id, name?, version?, sdkVersion, protocol }
ext.capabilities;               // the actions this controller may call
ext.connected;                  // false after a disconnect

const off = ext.on("tab.updated", ({ tab, changes }, meta) => { /* meta: { name, ts, tabId? } */ });
ext.on("tab.*", (payload, meta) => console.log(meta.name));
ext.onDisconnect((reason) => console.warn("disconnected", reason));
ext.close();
```

### Call options

Every action takes an optional second argument:

```ts
await ext.dom.text({}, {
  target: { tab: { urlMatch: "https://shop.example/*" }, frame: { urlMatch: "https://pay.example/*" } },
  timeoutMs: 10_000,
  signal: abortController.signal, // cancels the call in the extension too
});
```

**Targets** pick where an action runs:
- `tab`: `"active"` (the default), a tab ID, or `{ urlMatch }` for the first tab whose URL matches.
- `frame`: `"top"` (the default), a frame ID from `frames.list`, or `{ urlMatch }`. Iframes work same-origin and cross-origin, because the content runtime runs in every frame.

**Locators** find elements. Fields combine, and all must match:

| Field | Finds | Notes |
|---|---|---|
| `ref` | An element from `dom.snapshot` or `dom.query` | The most reliable. Valid until the page reloads. |
| `role` + `name` | By accessibility role and name | `name` matches a case-insensitive substring unless `exact: true`. |
| `testId` | `data-testid` | Searches inside open shadow roots. |
| `text` | By visible text | |
| `css` | A CSS selector | Searches inside open shadow roots. |
| `nth` | The nth match (0-based) | |

### Events

| Event | Payload |
|---|---|
| `tab.updated` | `{ tab, changes }` |
| `tab.activated` | `{ tabId, windowId }` |
| `tab.removed` | `{ tabId }` |
| `picker.selected` | `{ ref, locator, url }` for the picked element |
| `picker.hovered` | `{ ref, role, name }` of the element under the pointer |

Your own actions can emit events too (`ctx.emit()` in a [custom action](./custom-actions.md)). Full payloads are in the [action reference](../actions.md#events).

### Errors

Failed calls reject with an `ExtensionUseError` that carries a `code`, a `message` and sometimes `data`:

```ts
import { ExtensionUseError } from "@extension-use/client";

try {
  await ext.dom.click({ locator: { text: "Checkout" } });
} catch (err) {
  if (err instanceof ExtensionUseError && err.code === "ELEMENT_NOT_FOUND") showHint();
  else throw err;
}
```

See [error codes](../reference/errors.md).

## The frame bridge

`mountFrameBridge()` runs in an extension page and hosts your web app:

```ts
import { mountFrameBridge } from "@extension-use/host/frame";

const bridge = mountFrameBridge({
  url: "https://app.example.com/ext",
  container: document.getElementById("app")!,
  attributes: { allow: "clipboard-write" },
  fallback: "Can't reach the app. Check your connection.",
  fallbackAfterMs: 8000,
});
bridge.reload(); // reload the app and start a new session
```

| Option | Meaning |
|---|---|
| `url` | The web app to load. |
| `allowedOrigins` | Origins allowed to send commands. Default: the origin of `url`. The background checks `controllers.frame.origins` too. |
| `container` | Where to mount the iframe. Default `document.body`. |
| `attributes` | Extra iframe attributes. |
| `fallback`, `fallbackAfterMs` | Shown if the app hasn't loaded after 8 seconds (by default). |
| `bridgeActions` | Run the gesture-gated `permissions.*` actions in this page. Default `true`. |
| `debug` | Log messages. |

**Ship it safely:**
- Send `Content-Security-Policy: frame-ancestors chrome-extension://<id>` from the web app, so only your extension can frame it.
- Pin the extension with `frame({ hostOrigins })`.
- In development, pin the ID with a manifest `key`. The templates generate one.

If Chrome stops the service worker, the bridge reconnects and resumes the session by itself.

## Several controllers at once

A side panel, a website and a remote agent can be connected at the same time. Each has its own session, grants and audit entries. They aren't locked against each other, so if two controllers act on the same tab, both calls run.
