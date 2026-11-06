# Security and store policy

The extension keeps every privilege. Controllers ask, and the router decides. This page lists what's checked, what's on by default, and what you can tune.

## What every call goes through

1. **Transport check.** The caller's origin (frame, page) or token (remote) must match `controllers.<transport>`. Unknown callers can't even connect.
2. **Pause check.** If control is paused, every call fails with `BLOCKED_BY_POLICY`.
3. **Grants.** The action must exist (`UNKNOWN_ACTION`) and match the controller's `grants` (`NOT_GRANTED`).
4. **Input check.** The input must match the action's schema. Otherwise: `INVALID_INPUT`.
5. **Site policy.** The target tab's URL must not be blocked. Otherwise: `BLOCKED_BY_POLICY`.
6. **Field policy.** Typing into password and payment fields is refused by default.
7. **Audit.** The call, its outcome and its duration are recorded. Inputs and outputs aren't.

`run.sequence` runs each step through the same checks, and can't nest another sequence.

## Trust per transport

| Transport | How the caller is identified | Advice |
|---|---|---|
| `frame` | The iframe's origin, checked by the frame bridge and again by the background | Send `frame-ancestors chrome-extension://<id>` from your web app, and pin the extension with `frame({ hostOrigins })`. |
| `page` | The sender's origin, which Chrome sets for `externally_connectable` | Any page on that origin can connect, including ones with user content. Grant read-only actions unless you need more. |
| `remote` | A token issued by the relay the person paired with | Give each script or agent its own token with narrow grants, and revoke it when you're done. |

## Grants

```ts
controllers: {
  frame: { origins: ["https://app.example.com"] },                                    // grants default to "all"
  page: { origins: ["https://app.example.com"], grants: ["runtime.*", "dom.snapshot"] },
  remote: { grants: ["runtime.*", "tabs.*", "page.*", "dom.*", "capture.*"] },
}
```

Patterns use `*`. Remote controllers have two layers: the token's grants at the relay, and `controllers.remote.grants` in the extension. A call must pass both.

## Site policy

These are always blocked:

- browser pages: `chrome://*`, `chrome-untrusted://*`, `edge://*` and `about:*`;
- extension pages: `chrome-extension://*` and `moz-extension://*`;
- the Chrome Web Store and Edge Add-ons.

Add your own:

```ts
defineHost({
  id: "my-extension",
  controllers: { /* … */ },
  policy: {
    blockedSites: ["https://*.bank.example/*", "https://mail.example.com/*"],
    sensitiveFields: "refuse", // the default; "allow" lets controllers type into password and payment fields
  },
});
```

Blocked sites apply to page actions and to browser data: cookies, downloads and bookmarks for blocked sites are refused too.

## What the person sees and controls

- **An on-page indicator.** While a website or remote controller acts, the page shows "Controlled by …". Turn it off with `startContentRuntime({ indicator: false })`, only if your own UI shows it instead.
- **The toolbar badge.** It shows when the browser is being controlled. It needs an `action` in the manifest. Turn it off with `defineHost({ badge: false })`.
- **The control panel** (`mountControlPanel()` from `@extension-use/host/ui`): sessions, recent actions, relay pairing and a **Pause all control** button.
- **A keyboard shortcut.** Declare `"extension-use-toggle-pause"` under `commands` in the manifest, and the shortcut pauses and resumes control.
- **In code.** `defineHost()` returns the router: `router.pause()`, `router.resume()`, `router.paused`.

## Audit

```ts
defineHost({
  id: "my-extension",
  controllers: { /* … */ },
  onAudit(entry) {
    // { ts, session, transport, origin, action, tabId?, ok, code?, ms }
    console.debug("[extension-use]", entry.action, entry.ok ? "ok" : entry.code);
  },
});
```

Entries never include inputs, outputs or page content.

## Simulated input

All input is simulated (`isTrusted: false`). Most sites accept it, but some check, such as bot-protected pages and some payment forms. Extension-use doesn't try to get around those checks.

## Chrome Web Store policy

Manifest V3 forbids running remotely hosted code. Extension-use is built around that:

- Controllers send **data**: an action name and its input. Every action's code ships inside the extension.
- There is no `eval`, and no action that runs scripts or HTML a controller sends. `edit.setHtml` sanitizes its input: no scripts, no event handlers.
- `run.sequence` steps are plain data, with no conditions, loops or expressions. Logic stays in the controller.
- Your side panel can load a hosted web app, the same way it could link to your website. Describe in your store listing what the panel does.

Keep your [custom actions](./custom-actions.md) to the same rule.

## Remote control

- The relay listens on `127.0.0.1` by default. Put it behind HTTPS before you expose it, because tokens travel in headers.
- The extension pairs only with `https://` relays, or with relays on localhost. Narrow that list with `controllers.remote.relays`.
- Pairing needs the person to confirm a code on both sides. Wrong codes are rate-limited.
- Tokens are shown once and stored only as hashes.

See [remote control](./remote.md) and [AI agents](./agents.md). MCP marks destructive tools (`edit_*`, `tabs_close`, `cookies_set` and others) so clients can ask before running them.
