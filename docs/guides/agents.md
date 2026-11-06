# AI agents: MCP and the agent-friendly actions

`@extension-use/mcp` turns your browser into MCP tools. Any MCP client (Claude Code, Claude Desktop, IDE agents, a local model, your own) can then read and act in **your real browser, signed in as you**. Every call still goes through the extension's grants and site policy, shows "Controlled by …" on the page, and stops when you press **Pause all control**.

An agent on the same computer needs no relay. An agent anywhere else goes through one.

## No setup: connect an agent

```
agent ──MCP (stdio)──▶ extension-use-mcp (listens on 127.0.0.1) ◀──WebSocket── your browser
```

For the person using the extension:

1. Open the extension's control panel and click **Connect an agent**.
2. Click **Copy instructions** and paste them into your coding agent or local model.

The agent adds the MCP server from the instructions and starts using it. There's nothing else to install, run or pair. The panel shows the agent by name once it connects.

For the extension's developer, turn it on in `defineHost()` (it needs the `storage` and `alarms` permissions):

```ts
defineHost({
  id: "my-extension",
  controllers: {
    agent: {}, // or { grants: ["runtime.*", "tabs.*", "page.*", "dom.*", "wait.*", "capture.*", "run.*"] }
  },
});
```

How it works:

- **The key.** Clicking **Connect an agent** makes a random key (`eu_agent_…`), kept in `chrome.storage.local`. The instructions pass it to the server as `EXTENSION_USE_AGENT_KEY`.
- **Who dials whom.** The MCP server listens on the first free port from 47821 to 47825, on 127.0.0.1 only. The extension can't listen, so it dials those ports itself: every few seconds while its service worker runs, and every 30 seconds through an alarm when Chrome has stopped it. A new agent connects within about 30 seconds. Tool calls wait for it, and the server tells the client to list its tools again once the browser is there.
- **Proof, not passwords.** Neither side sends the key. Each proves it knows it (HMAC-SHA256 over both sides' random nonces), and the extension refuses every message until the server's proof checks out. The server refuses connections from websites (by `Origin`).
- **Only this computer.** The extension only dials 127.0.0.1, so the key is useless to anyone who can't run programs on this computer. It does stay in the agent's MCP config, and may appear in its transcript.
- **Revoking.** **New key** makes a new key and disconnects agents with the old one. **Turn off** forgets the key and stops looking for agents. **Pause all control** stops everything at once, as always.
- **Whole browser.** An agent can act on any tab the extension's grants and site policy allow, like a relay controller. Narrow it with `grants`.
- **Several agents.** Each agent's server takes the next free port, so up to five can be connected at once with the same instructions.

## Through a relay

```
agent ──MCP (stdio)──▶ extension-use-mcp ──WebSocket──▶ relay ◀── your browser (paired)
```

Use a relay when the agent runs on another machine, or when you want tokens with different grants per agent.

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
- **`capture_screenshot`** and **`capture_fullPage`** return an image the model can see.
- **`dom_html`** returns the page's markup when the agent needs more than the snapshot. Through MCP it is cut at 50,000 characters unless the agent passes `maxLength`, or a `locator` for one part.
- **`edit_*`** tools change the page (sanitized HTML, text, attributes, removing elements). They are marked destructive, as are `tabs_close`, `windows_close`, `downloads_cancel`, `bookmarks_remove`, `history_delete`, `cookies_set` and `cookies_remove`, so MCP clients can ask before running them. Leave them out with `--exclude "edit.*"`.
- **Browser data** (`downloads_*`, `bookmarks_*`, `history_*`, `cookies_*`) appears only if the extension enables those opt-in groups. Cookie values can sign someone in as the person, so think twice before giving an agent `cookies.*`.
- **`run_sequence`** batches known steps into one call (see below).
- **Errors** come back as tool errors with a code, such as `INVALID_INPUT: locator: …` or `BLOCKED_BY_POLICY: …`. A paused browser returns `BLOCKED_BY_POLICY` with "paused", and the instructions tell the agent to stop and ask you.
- **No browser yet:** the server offers a single `browser_status` tool that explains what's missing, and sends `tools/list_changed` when the browser connects.

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

- The browser is signed in as you. Give agents narrow tokens, and revoke them when you're done (`token revoke agent`). Without a relay, use **New key** or **Turn off** in the control panel.
- Password and payment fields are refused by default, and extension stores and `chrome://` pages are always blocked. Add your own blocked sites with `policy.blockedSites` in `defineHost()`.
- Every action shows in the page, on the toolbar badge and in the control panel's activity log. **Pause all control** stops everything at once.
