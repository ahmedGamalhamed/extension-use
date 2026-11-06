# Command line

Four commands ship with the packages.

| Command | Package | Run it with |
|---|---|---|
| `extension-use` | `@extension-use/host` | `npx extension-use …` in a project that has the package |
| `extension-use-relay` | `@extension-use/relay` | `npx @extension-use/relay …` |
| `extension-use-mcp` | `@extension-use/mcp` | `npx -y @extension-use/mcp …`, usually from an MCP client's config |
| `create-extension-use` | `create-extension-use` | `npm create extension-use@latest …` |

## extension-use

### `extension-use manifest`

Prints the manifest fields Extension-use needs, or merges them into a file.

```bash
npx extension-use manifest --groups runtime,tabs,page,dom,overlay --origins https://app.example.com --remote --write manifest.json
```

| Flag | Meaning |
|---|---|
| `--groups <list>` | Groups the host enables. Default: all but the opt-in ones (`tabCapture`, `downloads`, `bookmarks`, `history`, `cookies`). |
| `--origins <list>` | Websites allowed to connect from a tab (`externally_connectable`). |
| `--matches <list>` | Pages the content runtime runs on. Default `<all_urls>`. |
| `--no-side-panel` | Don't add the `sidePanel` permission. |
| `--remote` | Remote control through a relay: adds `storage` and `alarms`. |
| `--write <file>` | Merge into `manifest.json`, or into the `manifest` key of `package.json`. Without it, prints the fields. |

### `extension-use codegen`

Writes TypeScript types for your extension's own actions, from `runtime.describe`.

```bash
EXTENSION_USE_TOKEN=eu_ctl_… npx extension-use codegen --relay http://127.0.0.1:7777 --out src/extension-actions.ts
```

| Flag | Meaning |
|---|---|
| `--relay <url>` | Ask a running browser through a relay. Token: `EXTENSION_USE_TOKEN` or `--token`. |
| `--device <id>` | Which browser to ask. Default `default`. |
| `--from <file>` | Or read saved `runtime.describe` output (JSON). |
| `--out <file>` | Where to write. Default `extension-actions.ts`. |
| `--all` | Include the built-in actions too. |

### `extension-use vendor`

Copies the no-build bundles into your project. Run it from `postinstall` to keep them current.

```bash
npx extension-use vendor --extension extension/vendor --web web/vendor
```

| Flag | Meaning |
|---|---|
| `--extension <dir>` | Where to put the extension bundles. Default `extension/vendor`. |
| `--web <dir>` | Where to put the web app client. Default `web/vendor`. Needs `@extension-use/client` installed. |

## extension-use-relay

```bash
npx @extension-use/relay
```

| Command | What it does |
|---|---|
| `serve` (default) | Start the relay. It prints its URL and the owner token, and asks you to confirm pairing codes. |
| `token create <name> [--grants a,b]` | Create a controller token. It's shown once. |
| `token list` | List tokens. |
| `token revoke <name>` | Revoke a token. |
| `devices` | List paired browsers. |
| `unpair <deviceId>` | Remove a paired browser. |
| `approve <code>` | Approve a pairing request, when the relay runs without a terminal. |
| `owner-token` | Print the owner token. |

| Option | Meaning |
|---|---|
| `--port <n>` | Port. Default `7777`, or `EXTENSION_USE_RELAY_PORT`. |
| `--host <host>` | Address to listen on. Default `127.0.0.1`. Put it behind HTTPS before you use `0.0.0.0`. |
| `--data <file>` | Data file. Default `~/.extension-use/relay.json`, or `EXTENSION_USE_RELAY_DATA`. |
| `--no-prompt` | Don't ask to confirm pairing codes in the terminal. Use `approve` instead. |

## extension-use-mcp

```bash
npx -y @extension-use/mcp --relay http://127.0.0.1:7777 [--device default] [--include "dom.*,tabs.*"] [--exclude "tabs.close"]
```

The token comes from `EXTENSION_USE_TOKEN` (preferred) or `--token`. See [@extension-use/mcp](../packages/mcp.md).

## create-extension-use

```bash
npm create extension-use@latest my-extension -- --template wxt --url http://localhost:5173/ --yes
```

See [start a new extension](../start/new-project.md).
