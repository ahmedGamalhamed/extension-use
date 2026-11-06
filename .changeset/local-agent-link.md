---
"@extension-use/protocol": minor
"@extension-use/host": minor
"@extension-use/mcp": minor
---

Connect a coding agent or local model with no relay. Hosts that set `controllers.agent` get a **Connect an agent** section in the control panel with instructions to paste into the agent. Those instructions start `@extension-use/mcp` with `EXTENSION_USE_AGENT_KEY`; the server listens on 127.0.0.1 (ports 47821–47825) and the extension dials it. Both sides prove they know the key without sending it. The MCP server now sends `tools/list_changed` when the browser connects, `connect()` receives `{ purpose: "list" | "call" }`, and `listenForBrowser()` is exported for custom servers.
