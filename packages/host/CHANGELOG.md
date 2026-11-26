# @extension-use/host

## 0.2.0

### Minor Changes

- 4b7b305: Connect a coding agent or local model with no relay. Hosts that set `controllers.agent` get a **Connect an agent** section in the control panel with instructions to paste into the agent. Those instructions start `@extension-use/mcp` with `EXTENSION_USE_AGENT_KEY`; the server listens on 127.0.0.1 (ports 47821–47825) and the extension dials it. Both sides prove they know the key without sending it. The MCP server now sends `tools/list_changed` when the browser connects, `connect()` receives `{ purpose: "list" | "call" }`, and `listenForBrowser()` is exported for custom servers.

### Patch Changes

- 90bdfbc: `extension-use vendor` now copies `extension-use-offscreen.js`, which no-build extensions need for the tabCapture group. `ExtensionUseError` is exported from `@extension-use/host/background` and `@extension-use/host/content`, so custom actions can fail with a specific code. `extension-use-relay --help` prints the commands and options instead of starting a relay.
- 30fdb6d: Frame bridge: keep working after Chrome stops the idle background service worker. The bridge now resumes the app's session (hello and event subscriptions) on a new port, and fails in-flight calls at once with `NOT_CONNECTED` instead of letting them time out. Before, every call failed with "Send hello first" until the app reloaded.
- Updated dependencies [4b7b305]
  - @extension-use/protocol@0.2.0
