# @extension-use/testing

Test your controller code at two levels: fast unit tests against a mock host, and browser tests that load your real extension with Playwright.

```bash
npm install -D @extension-use/testing
```

For browser tests, also install `@playwright/test` (1.45 or newer) and run `npx playwright install chromium` once.

## Entry points

| Import | Exports |
|---|---|
| `@extension-use/testing` | `createMockHost()`, `expectErrorCode()` |
| `@extension-use/testing/playwright` | `test` (with extension fixtures), `expect`, `controllerIn()` |

## `createMockHost(options?)`

Runs the real router over an in-memory transport. You supply the results of the actions your code uses.

| Option | Meaning |
|---|---|
| `handlers` | Results for built-in actions, by name. Actions without one aren't offered (`UNKNOWN_ACTION`). |
| `actions` | Your own actions, run for real. |
| `grants` | Grants for connected controllers. Default `["*"]`. |
| `tab` | The tab every call targets. Default: tab 1 on `https://example.com/`. |
| `policy` | Site policy, as in `defineHost()`. |
| `validateOutput` | Check handler results against each action's output schema. Default `true`. |

The host has `connect()`, `calls`, `callsTo(action)`, `emit(name, payload, tabId?)`, `setHandler(action, handler)` and `router` (for `pause()`).

`expectErrorCode(promise, code)` resolves with the `ExtensionUseError` if the promise rejects with that code, and fails otherwise.

## Playwright fixtures

| Fixture | What it is |
|---|---|
| `extensionPath` (option) | Your built, unpacked extension. Set it in `use` in `playwright.config`. |
| `panelPath` (option) | The extension page that mounts the frame bridge. Default `"sidepanel.html"`. |
| `extensionHeadless`, `extensionArgs` (options) | Run headless (default, unless `HEADED=1`), and extra Chromium switches. |
| `context` | Chromium with your extension loaded. |
| `extensionId`, `serviceWorker` | The extension's ID and its service worker. |
| `openPanel({ path?, frameUrl? })` | Opens the side panel page as a tab and returns `{ page, frame, ext }`. |

`controllerIn(pageOrFrame)` drives the client a page exposed with `connect(…, { expose: true })`. Its `ext.call()` rejects with an `ExtensionUseError`, and `ext.try()` returns `{ ok, output }` or `{ ok: false, code, message }`.

See the [testing guide](../guides/testing.md) for examples.
