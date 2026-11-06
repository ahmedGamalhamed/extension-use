# @extension-use/relay

The relay lets scripts, servers, CI jobs and AI agents drive a browser. The extension dials out to the relay, so nothing listens inside the browser. It runs on your machine, needs no account, and listens on `127.0.0.1` by default.

```bash
npx @extension-use/relay
```

Needs Node.js 22 or newer.

```
script / server / agent ──HTTP, SSE or WebSocket──▶ relay ◀──WebSocket (the extension dials out)── your browser
```

## How to use it

1. Turn on `controllers.remote` in your extension and add the control panel. See [remote control](../guides/remote.md#1-enable-remote-control-in-your-extension).
2. Start the relay. It prints its URL and an owner token.
3. Pair the browser from the control panel, and confirm the code in the relay's terminal.
4. Create a token for each script or agent, then call the browser:

```bash
npx @extension-use/relay token create script --grants "dom.*,page.*,tabs.*"
```

```bash
curl -H "Authorization: Bearer $TOKEN" -d '{"action":"page.info"}' http://127.0.0.1:7777/v1/devices/default/calls
```

The commands are listed in the [CLI reference](../reference/cli.md#extension-use-relay), and the HTTP, SSE and WebSocket API in the [remote control guide](../guides/remote.md#api).

## In your own server

```ts
import { createRelay } from "@extension-use/relay";

const relay = createRelay({
  port: 7777,
  dataFile: "./relay.json",
  onPairingRequest: (p) => notifyMe(`Pair ${p.name}? Code ${p.code}`),
});
const { url } = await relay.listen();
// relay.approve(code), relay.deny(code), relay.pendingPairings(), relay.devicesOnline(), relay.ownerToken
```

| Option | Meaning |
|---|---|
| `port`, `host` | Where to listen. Default `7777` on `127.0.0.1`. |
| `dataFile` | JSON file for tokens and paired browsers. Omit it to keep everything in memory. |
| `backend` | Storage, accounts and limits. Default: `LocalBackend` (one tenant, no limits). |
| `onPairingRequest(p)` | Called when a browser asks to pair: `{ pairingId, code, name, expiresAt, remoteAddress }`. |
| `pairingTtlMs` | How long a pairing code stays valid. Default 5 minutes. |
| `pairingCodeDigits` | Digits in pairing codes. 6 for a local relay; 9 or more when many people share one. |
| `extraRoutes` | Your own non-`/v1` HTTP routes (a dashboard, webhooks). |
| `log(line)` | Log lines for connections and pairings. |

To host a relay for many people, implement `RelayBackend` (tenants, tokens, devices, plan checks, usage events). See [custom backends](../guides/remote.md#custom-backends-accounts-limits-metering).
