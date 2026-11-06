# @extension-use/mcp

An MCP server that turns your browser into tools for AI agents. Any MCP client (Claude Code, Claude Desktop, IDE agents, a local model or your own) can then read and act in your real browser. Every call still goes through the extension's grants, site policy and kill switch.

There are two ways to reach the browser:

```
No relay:      agent ──MCP (stdio)──▶ extension-use-mcp (127.0.0.1) ◀──WebSocket── your browser
Through relay: agent ──MCP (stdio)──▶ extension-use-mcp ──WebSocket──▶ relay ◀── your browser (paired)
```

## On this computer, no relay

If the extension enables `controllers.agent`, click **Connect an agent** in its control panel and paste the instructions into your agent. They add this server with the key the extension made:

```json
{
  "mcpServers": {
    "browser": {
      "command": "npx",
      "args": ["-y", "@extension-use/mcp"],
      "env": { "EXTENSION_USE_AGENT_KEY": "eu_agent_…" }
    }
  }
}
```

The server listens on the first free port from 47821 to 47825 on 127.0.0.1, and the browser connects to it by itself. See the [AI agents guide](../guides/agents.md#no-setup-connect-an-agent).

## Through a relay

You need a [relay](./relay.md) with your browser paired, and a token for the agent:

```bash
npx @extension-use/relay token create agent --grants "runtime.*,tabs.*,page.*,dom.*,wait.*,overlay.*,capture.*,run.*"
```

Claude Code:

```bash
claude mcp add extension-use -e EXTENSION_USE_TOKEN=eu_ctl_… -- npx -y @extension-use/mcp --relay http://127.0.0.1:7777
```

Clients with a JSON config:

```json
{
  "mcpServers": {
    "extension-use": {
      "command": "npx",
      "args": ["-y", "@extension-use/mcp", "--relay", "http://127.0.0.1:7777"],
      "env": { "EXTENSION_USE_TOKEN": "eu_ctl_…" }
    }
  }
}
```

| Flag | Meaning |
|---|---|
| `--relay <url>` | The relay. Default `http://127.0.0.1:7777`. Not used with an agent key. |
| `--device <id>` | Which browser, when several are paired. Default: the most recently connected one. |
| `--include "dom.*,tabs.*"` | Only these actions. |
| `--exclude "tabs.close"` | Hide these actions. |
| `--token <token>` | The token, if you can't use `EXTENSION_USE_TOKEN`. The variable keeps it out of process lists. |
| `--agent-key <key>` | The agent key, if you can't use `EXTENSION_USE_AGENT_KEY`. With a key, the server listens locally instead of using a relay. |

## What the agent gets

- One tool per action the token allows, named with underscores (`dom_click`, `run_sequence`), including your extension's own actions.
- Instructions for the snapshot → ref → act loop.
- Screenshots as images the model can see.
- Destructive tools marked as such, so clients can ask before running them.

See the [AI agents guide](../guides/agents.md) for details and safety notes.

## In your own code

```ts
import { createExtensionUseMcpServer } from "@extension-use/mcp";
import { connect } from "@extension-use/client";
import { remote } from "@extension-use/client/remote";

const { server } = createExtensionUseMcpServer({
  connect: () => connect(remote({ relay: "http://127.0.0.1:7777", token })),
  include: ["dom.*", "page.*"],
});
await server.connect(yourTransport); // any MCP server transport
```

Options: `connect({ purpose })` (called again after a disconnect; `purpose` is `"list"` or `"call"`, so you can wait less for a browser while listing tools), `include`, `exclude`, `name`. The result has `notifyToolsChanged()` to tell the client to list the tools again.

Without a relay, `listenForBrowser({ key })` gives you a transport for the local agent link:

```ts
import { connect } from "@extension-use/client";
import { createExtensionUseMcpServer, listenForBrowser } from "@extension-use/mcp";

const local = await listenForBrowser({ key: process.env.EXTENSION_USE_AGENT_KEY!, onBrowser: () => mcp.notifyToolsChanged() });
const mcp = createExtensionUseMcpServer({ connect: () => connect(local.transport({ label: "my-agent", waitMs: 30_000 })) });
```
