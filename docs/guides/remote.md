# Remote control through a relay

A relay lets anything that can make HTTP requests drive your browser: a script on your laptop, a home server, a CI job, or an AI agent. You don't need an account or a cloud service.

```
script / server / agent ──HTTP, SSE or WebSocket──▶ relay ◀──WebSocket (the extension dials out)── your browser
```

- The **extension opens the connection**. Nothing listens inside the browser.
- The person **pairs** the browser with a relay once, from the extension's control panel. Pairing gives the extension a device token, kept in `chrome.storage.local`.
- Controllers use **tokens** from the relay. Each token can be limited to some actions. The extension applies its own limits (`controllers.remote.grants`) and site policy as well.
- While a remote controller acts, the page shows **"Controlled by remote: …"** and the toolbar badge shows **ON**. The control panel lists sessions and recent actions and has a **Pause all control** button.

## 1. Enable remote control in your extension

```ts
// background
defineHost({
  id: "my-extension",
  controllers: {
    frame: { origins: ["https://app.example.com"] },
    remote: {
      grants: ["runtime.*", "tabs.*", "page.*", "dom.*", "overlay.*", "capture.*"], // default: everything
      // relays: ["http://127.0.0.1:*", "https://relay.example.com"],          // default: localhost and any https relay
    },
  },
});
```

Remote control needs the `storage` and `alarms` permissions:
- WXT: `extensionUse: { remote: true, ... }`;
- `withExtensionUse(manifest, { remote: true })`;
- the CLI: `npx extension-use manifest --remote --write manifest.json`.

Add the control panel to an extension page. The options page is a good place:

```ts
// control.ts (in control.html, set as "options_page" in the manifest)
import { mountControlPanel } from "@extension-use/host/ui";
mountControlPanel(document.getElementById("panel")!);
```

With no build step, use `vendor/extension-use-ui.js` (copied by `extension-use vendor`).

## 2. Start a relay and pair

```bash
npx @extension-use/relay
```

It prints its URL (`http://127.0.0.1:7777`) and an **owner token**, which has full access. Data is kept in `~/.extension-use/relay.json`.

In the extension's control panel, enter the relay URL and click **Connect to relay**. The panel shows a code like `482-913`. The relay's terminal asks you to confirm the same code; answer `y`. Without a terminal, run `npx @extension-use/relay approve 482-913`. The panel then shows **Connected**.

## 3. Call it

**From a script (Node 22+ or a browser):**

```ts
import { connect } from "@extension-use/client";
import { remote } from "@extension-use/client/remote";

const ext = await connect(remote({ relay: "http://127.0.0.1:7777", token: process.env.EU_TOKEN! }));
const { text } = await ext.dom.snapshot({ format: "text" });
await ext.dom.click({ locator: { role: "button", name: "Next" } });
ext.on("tab.updated", ({ tab }) => console.log(tab.url));
```

**Over HTTP, from any language:**

```bash
curl -H "Authorization: Bearer $EU_TOKEN" -H "content-type: application/json" \
  -d '{"action":"tabs.open","input":{"url":"https://example.com"}}' \
  http://127.0.0.1:7777/v1/devices/default/calls
```

**Events over SSE:**

```bash
curl -N "http://127.0.0.1:7777/v1/devices/default/events?events=tab.*&access_token=$EU_TOKEN"
```

## Tokens

```bash
npx @extension-use/relay token create agent --grants "dom.snapshot,dom.click,dom.fill,page.*"
```

```bash
npx @extension-use/relay token list
```

```bash
npx @extension-use/relay token revoke agent
```

A token is shown once and stored only as a hash. Calls outside its grants fail with `NOT_GRANTED` (HTTP 403) at the relay, before they reach the browser.

## API

All endpoints except pairing need `Authorization: Bearer <token>`. `:device` is a device id from `GET /v1/devices`, or `default` for the most recently connected browser.

| Method and path | What it does |
|---|---|
| `POST /v1/devices/:device/calls` | Body `{ action, input?, target?, timeoutMs? }`. Returns `{ ok: true, output }`, or `{ ok: false, error: { code, message } }` with a status code: 400 `INVALID_INPUT`, 403 `NOT_GRANTED`/`BLOCKED_BY_POLICY`, 404 `UNKNOWN_ACTION`/`TARGET_NOT_FOUND`/`ELEMENT_NOT_FOUND`, 409 `NEEDS_USER_GESTURE`, 503 `DEVICE_OFFLINE`, 504 `TIMEOUT`. |
| `GET /v1/devices/:device/events?events=a,b` | Server-sent events. Each event has `event: <name>` and `data: { payload, ts, tabId? }`. Also accepts `?access_token=` because `EventSource` can't send headers. |
| `WS /v1/devices/:device/session` | The full protocol. Send `{ "t": "auth", "token": "…" }` first, then envelopes. `remote()` in `@extension-use/client` does this for you. |
| `GET /v1/devices` | Paired browsers and whether they're online. |
| `DELETE /v1/devices/:id` | Unpair a browser (owner only). |
| `GET / POST /v1/tokens`, `DELETE /v1/tokens/:name` | Manage tokens (owner only). |
| `GET /v1/pairings/pending`, `POST /v1/pairings/approve` `{ code }`, `POST /v1/pairings/deny` `{ code }` | Handle pairing requests (owner only). |
| `GET /v1/health` | Version and online device count (no token). |

## Running it beyond your machine

The relay listens on `127.0.0.1` by default. To reach it from elsewhere (`--host 0.0.0.0`), put it behind HTTPS with a reverse proxy, because tokens travel in headers. The extension only pairs with `https://` relays unless they're on localhost. You can narrow that with `controllers.remote.relays`.

You can also run it from code:

```ts
import { createRelay } from "@extension-use/relay";
const relay = createRelay({ port: 7777, dataFile: "./relay.json", onPairingRequest: (p) => notifyMe(p.code) });
await relay.listen();
```

## How the connection stays up

- **Keep-alive:** the extension pings every 20 seconds. Chrome keeps a Manifest V3 service worker alive while WebSocket messages flow at least every 30 seconds.
- **Waking up:** if Chrome still stops the service worker, an alarm wakes it every minute and it reconnects.
- **Reconnects:** after a relay restart the extension retries with backoff (1, 2, 5, 10, then every 30 seconds).
- **Forgotten browsers:** if the relay no longer knows the browser, the panel says so and stops retrying.
- **Tested:** the browser tests cover pairing, calls, the page indicator, the badge, the kill switch, unpairing and relay restarts. They don't cover a service worker stopped by Chrome after a long idle period, because Playwright's own connection to the service worker can keep it alive. Check that case by hand in a normal Chrome.
