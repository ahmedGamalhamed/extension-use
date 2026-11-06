#!/usr/bin/env node
/**
 * MCP server over stdio for the browser.
 *
 * Local agent link (no relay): copy the instructions from the extension's
 * control panel ("Connect an agent"). They set EXTENSION_USE_AGENT_KEY; this
 * server then listens on 127.0.0.1 and the browser connects to it by itself.
 *   { "command": "npx", "args": ["-y", "@extension-use/mcp"],
 *     "env": { "EXTENSION_USE_AGENT_KEY": "eu_agent_…" } }
 *
 * Through a relay:
 *   extension-use-mcp --relay http://127.0.0.1:7777 [--device default] [--include "dom.*,tabs.*"] [--exclude "tabs.close"]
 *   Token: EXTENSION_USE_TOKEN (preferred, keeps it out of process lists) or --token.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { connect } from "@extension-use/client";
import { remote } from "@extension-use/client/remote";
import { isAgentKey } from "@extension-use/protocol/remote";
import { createExtensionUseMcpServer } from "./index.js";
import { listenForBrowser, type LocalAgentLink } from "./local.js";

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const list = (v?: string) => v?.split(",").map((s) => s.trim()).filter(Boolean);
// stdout is the MCP channel: report on stderr.
const say = (line: string) => console.error(`extension-use-mcp: ${line}`);

const agentKey = process.env.EXTENSION_USE_AGENT_KEY ?? flag("agent-key");
const relayFlag = flag("relay") ?? process.env.EXTENSION_USE_RELAY;
const token = process.env.EXTENSION_USE_TOKEN ?? flag("token");
const device = flag("device") ?? process.env.EXTENSION_USE_DEVICE ?? "default";
const include = list(flag("include"));
const exclude = list(flag("exclude"));

if (agentKey && !isAgentKey(agentKey)) {
  say("EXTENSION_USE_AGENT_KEY doesn't look like an agent key (eu_agent_…). Copy the instructions from the extension's control panel again.");
  process.exit(1);
}
if (!agentKey && !token) {
  say("set EXTENSION_USE_AGENT_KEY (from \"Connect an agent\" in the extension's control panel), or EXTENSION_USE_TOKEN for a relay (create one with: npx @extension-use/relay token create agent)");
  process.exit(1);
}

// Tool listing shouldn't hold up the agent's start; a tool call can wait for a browser that's waking up.
const LIST_WAIT_MS = 3_000;
const CALL_WAIT_MS = 40_000;

let local: LocalAgentLink | undefined;
const mcp = createExtensionUseMcpServer({
  connect: (ctx) => {
    if (!local) {
      const relay = relayFlag ?? "http://127.0.0.1:7777";
      return connect(remote({ relay, token: token!, device }), { name: "extension-use-mcp" });
    }
    const label = mcp.server.getClientVersion()?.name ?? "agent";
    return connect(local.transport({ label, waitMs: ctx?.purpose === "list" ? LIST_WAIT_MS : CALL_WAIT_MS }), { name: "extension-use-mcp", handshakeTimeoutMs: 10_000 });
  },
  ...(include ? { include } : {}),
  ...(exclude ? { exclude } : {}),
});

if (agentKey) {
  try {
    local = await listenForBrowser({
      key: agentKey,
      log: say,
      onBrowser: () => mcp.notifyToolsChanged(),
    });
  } catch (e) {
    say((e as Error).message);
    process.exit(1);
  }
}

await mcp.server.connect(new StdioServerTransport());
if (!local) say(`serving tools for ${device} via ${relayFlag ?? "http://127.0.0.1:7777"}`);

const stop = async () => {
  await mcp.close();
  await local?.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
// The agent closing stdin means it's done with us.
process.stdin.on("end", stop);
