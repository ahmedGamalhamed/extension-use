# AI agents: MCP and the agent-friendly actions

`@extension-use/mcp` turns a paired browser into MCP tools. Any MCP client (Claude Code, Claude Desktop, IDE agents, your own) can then read and act in **your real browser, signed in as you**. Every call still goes through the extension's grants and site policy, shows "Controlled by remote: …" on the page, and stops when you press **Pause all control**.

```
agent ──MCP (stdio)──▶ extension-use-mcp ──WebSocket──▶ relay ◀── your browser (paired)
```

## Set it up

1. Start a relay and pair your browser. See the [remote control guide](remote.md).
2. Give the agent its own token, limited to what it needs:

   ```bash
   npx @extension-use/relay token create agent --grants "runtime.*,tabs.*,page.*,dom.*,wait.*,overlay.*,capture.*,run.*"
   ```

3. Register the MCP server with your client. For Claude Code:

   ```bash
   claude mcp add extension-use -e EXTENSION_USE_TOKEN=eu_ctl_… -- npx -y @extension-use/mcp --relay http://127.0.0.1:7777
   ```

   For clients with a JSON config:

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

Options:
- `--device <id>`: pick a browser when several are paired. The default is the most recently connected one.
- `--include "dom.*,tabs.*"` and `--exclude "tabs.close"`: narrow the tools further.

## What the agent gets

- **One tool per action** the token allows, named with underscores (`dom_click`, `tabs_open`, `run_sequence`). The list comes from the browser itself (`runtime.describe`), so your extension's **own actions** (`app_save`, …) appear too, with their descriptions and schemas.
- **Server instructions** that teach the snapshot → ref → act loop.
- **`dom_snapshot`** returns a compact text tree. By default it covers only the visible part of the page (`viewportOnly: true`); pass `viewportOnly: false` for the whole page. Interactive elements carry refs:

  ```
  - heading "Order form" [level=1] [ref=e3]
  - textbox "Email" [ref=e7]: ""
  - button "Save draft" [ref=e12]
  ```

  The agent then calls `dom_click { "locator": { "ref": "e12" } }`.
- **`capture_screenshot`** returns an image the model can see.
- **`run_sequence`** batches known steps into one call (see below).
- **Errors** come back as tool errors with a code, such as `INVALID_INPUT: locator: …` or `BLOCKED_BY_POLICY: …`. A paused browser returns `BLOCKED_BY_POLICY` with "paused", and the instructions tell the agent to stop and ask you.
- **No browser yet:** the server offers a single `browser_status` tool that explains what's missing.

## `run.sequence`: several steps, one round trip

```json
{
  "steps": [
    { "action": "dom.fill", "input": { "locator": { "ref": "e7" }, "value": "me@example.com" } },
    { "action": "dom.click", "input": { "locator": { "ref": "e12" } }, "pauseMs": 300 },
    { "action": "wait.for", "input": { "locator": { "text": "Saved" } } }
  ],
  "onError": "stop"
}
```

- **Steps are data only:** no conditions, loops or expressions. Logic stays in the controller, which keeps the extension within store policy.
- **Each step is checked as its own call:** grants, input checks, site policy and audit all apply. It can't nest another `run.sequence`.
- **The result** lists every step's `ok`/`output` or `error`. `onError: "continue"` keeps going after a failure, and each step can override it.

## `runtime.describe` and typed clients

`runtime.describe` lists the actions a controller may call, with JSON schemas for their input and output. It's what the MCP server uses, and it powers codegen for your own actions:

```bash
EXTENSION_USE_TOKEN=eu_ctl_… npx extension-use codegen --relay http://127.0.0.1:7777 --out src/extension-actions.ts
```

Or, from a saved `JSON.stringify(await ext.runtime.describe())`:

```bash
npx extension-use codegen --from describe.json --out src/extension-actions.ts
```

```ts
import type { CoreActions } from "@extension-use/client";
import type { HostActions } from "./extension-actions";

const ext = await connect<CoreActions & HostActions>(frame());
await ext.app.save({ note: "read later" }); // typed input and output
```

## Use it from your own agent code

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

Or skip MCP and drive the client directly, as in [recipe 5](../recipes.md#5-an-ai-model-reads-and-acts-on-the-page).

## Safety notes

- The browser is signed in as you. Give agents narrow tokens, and revoke them when you're done (`token revoke agent`).
- Password and payment fields are refused by default, and extension stores and `chrome://` pages are always blocked. Add your own blocked sites with `policy.blockedSites` in `defineHost()`.
- Every action shows in the page, on the toolbar badge and in the control panel's activity log. **Pause all control** stops everything at once.
