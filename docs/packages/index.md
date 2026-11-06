# Packages

Extension-use is split so you install only what you use. Most extensions need two packages: **host** inside the extension, and **client** wherever the controller runs.

::: tip Not sure?
The [package picker](../start/picker.md) tells you which packages your setup needs, and where each one goes.
:::

| Package | Install in | What it does | Size (min+gzip) |
|---|---|---|---|
| [`@extension-use/host`](./host.md) | Your extension | `defineHost()` (router, grants, policy), the content runtime, the frame bridge, the control panel, manifest helpers, the `extension-use` CLI and no-build bundles | content runtime ≈ 9.3 KB |
| [`@extension-use/client`](./client.md) | Your web app, site or script | `connect()` with the `frame`, `page`, `remote` and `memory` transports, and typed calls | core ≈ 2.1 KB + frame ≈ 0.8 KB |
| [`@extension-use/protocol`](./protocol.md) | Installed for you | Message types, error codes and zod schemas for every built-in action | types only in clients |
| [`@extension-use/wxt`](./wxt.md) | Your WXT extension (dev) | Adds the permissions for your groups and `externally_connectable` to the generated manifest | build time only |
| [`@extension-use/relay`](./relay.md) | Run with `npx`, or in your server | The relay that scripts and agents call and the browser dials out to | server |
| [`@extension-use/mcp`](./mcp.md) | Run by your MCP client | A paired browser's actions as MCP tools for AI agents | server |
| [`@extension-use/testing`](./testing.md) | Your app (dev) | `createMockHost()` for unit tests, and Playwright fixtures that load your real extension | dev only |
| [`create-extension-use`](./create-extension-use.md) | Run once | `npm create extension-use`: the `wxt`, `plain` and `vanilla` templates | n/a |

## Which ones do I need?

| You want to… | Packages |
|---|---|
| Drive the extension from a web app in its side panel | `host` + `client` |
| Drive it from your website in a normal tab | `host` + `client` |
| Drive it from scripts, servers or CI | `host` (with `remote` on) + `relay` + `client` (or plain HTTP) |
| Let an AI agent use the browser | `host` (with `remote` on) + `relay` + `mcp` |
| Build the extension with WXT | add `wxt` |
| Test your controller code | add `testing` |
| Start from scratch | `create-extension-use` |

All packages share one version and are released together. They are MIT-licensed.
