# @extension-use/mcp

MCP server that lets AI agents use your real browser. Tools come from the browser itself, so your extension's own actions show up too, and every call still goes through the extension's permissions, site policy and kill switch.

With no relay: click **Connect an agent** in the extension's control panel and paste the instructions into your agent. They boil down to:

```bash
claude mcp add browser -e EXTENSION_USE_AGENT_KEY=eu_agent_… -- npx -y @extension-use/mcp
```

Through a relay:

```bash
claude mcp add extension-use -e EXTENSION_USE_TOKEN=eu_ctl_… -- npx -y @extension-use/mcp --relay http://127.0.0.1:7777
```

See the agents guide in the Extension-use docs.

License: MIT
