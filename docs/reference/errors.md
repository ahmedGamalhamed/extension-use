# Error codes

Every failed call rejects with an `ExtensionUseError`, which has a `code`, a `message` and sometimes `data`. Over the relay's HTTP API, the same codes come back as `{ ok: false, error: { code, message } }` with the HTTP status below.

```ts
import { ExtensionUseError } from "@extension-use/client";

try {
  await ext.dom.click({ locator: { text: "Checkout" } });
} catch (err) {
  if (err instanceof ExtensionUseError) console.warn(err.code, err.message);
}
```

| Code | HTTP | Meaning | What to do |
|---|---|---|---|
| `UNKNOWN_ACTION` | 404 | The host doesn't offer this action: its group isn't enabled, or a mock host has no handler for it. | Check `ext.has(name)`, or enable the group in `defineHost({ groups })`. |
| `INVALID_INPUT` | 400 | The input doesn't match the action's schema. The message names the field. | Fix the input. See the [action reference](../actions.md). |
| `NOT_GRANTED` | 403 | This controller may not call this action. | Widen the controller's `grants`, or the relay token's grants. |
| `BLOCKED_BY_POLICY` | 403 | The target page is blocked, the field is a password or payment field, or control is paused. | Pick another tab, or ask the person to resume control. Agents should stop and ask. |
| `TARGET_NOT_FOUND` | 404 | No tab or frame matches the target, or the page has no content runtime. | Check the target. Reload the tab, or set `contentScript` in `defineHost()` so the host can inject it. |
| `ELEMENT_NOT_FOUND` | 404 | No element matches the locator. | Take a new snapshot (refs reset on reload), or loosen the locator. |
| `TIMEOUT` | 504 | The call took longer than its timeout. | Pass a longer `timeoutMs`, or wait for the page first (`wait.for`, `tabs.waitForLoad`). |
| `CANCELLED` | | The call was cancelled: its `signal` aborted, or the person pressed `Esc` in the picker. | Usually nothing. |
| `NEEDS_USER_GESTURE` | 409 | Chrome requires a recent click: `permissions.request`, or capturing a tab the person hasn't invoked the extension on. | Call it from a click handler, or ask the person to open the extension on that tab. |
| `NEEDS_PERMISSION` | | The extension lacks a manifest permission for this action. | Add the group to the manifest (CLI, WXT module or `withExtensionUse()`). |
| `TAB_CLOSED` | | The tab closed during the call. | Retry on another tab. |
| `NOT_CONNECTED` | | No host answered the handshake, or the connection was lost. | Is the extension installed and the origin allowed? For `page()`, check the extension ID and `externally_connectable`. |
| `DEVICE_OFFLINE` | 503 | The relay has no live connection to that browser. | Open the browser and check the control panel shows **Connected**. |
| `QUOTA_EXCEEDED` | 429 | A hosted relay's usage limit was reached. `data.upgradeUrl` may be set. | Wait, or raise the limit. |
| `PLAN_REQUIRED` | 402 | A hosted relay's plan doesn't allow this, such as pairing more browsers. `data.upgradeUrl` may be set. | Change the plan. |
| `UNSUPPORTED_VERSION` | | The client and host speak different protocol versions. | Update the packages so their versions match. |
| `INTERNAL` | | Anything else, including errors thrown by custom actions. | Read the message, and turn on `debug` in `defineHost()` and `connect()`. |

`QUOTA_EXCEEDED` and `PLAN_REQUIRED` come only from relays with a custom `RelayBackend` that enforces limits. The local relay has none.
