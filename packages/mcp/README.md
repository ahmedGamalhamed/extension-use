# @extension-use/mcp

MCP server that lets AI agents use your real browser through an Extension-use relay. Tools come from the browser itself, so your extension's own actions show up too, and every call still goes through the extension's permissions, site policy and kill switch.

```bash
claude mcp add extension-use -e EXTENSION_USE_TOKEN=eu_ctl_… -- npx -y @extension-use/mcp --relay http://127.0.0.1:7777
```

See the agents guide in the Extension-use docs.

License: MIT
