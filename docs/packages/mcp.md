# @extension-use/mcp

An MCP server that turns a paired browser into tools for AI agents. Any MCP client (Claude Code, Claude Desktop, IDE agents or your own) can then read and act in your real browser. Every call still goes through the extension's grants, site policy and kill switch.

```
agent ──MCP (stdio)──▶ extension-use-mcp ──WebSocket──▶ relay ◀── your browser (paired)
```

## Use it

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
| `--relay <url>` | The relay. Required. |
| `--device <id>` | Which browser, when several are paired. Default: the most recently connected one. |
| `--include "dom.*,tabs.*"` | Only these actions. |
| `--exclude "tabs.close"` | Hide these actions. |
| `--token <token>` | The token, if you can't use `EXTENSION_USE_TOKEN`. The variable keeps it out of process lists. |

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

Options: `connect()` (called again after a disconnect), `include`, `exclude`, `name`.
