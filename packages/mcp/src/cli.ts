#!/usr/bin/env node
/**
 * MCP server over stdio for a browser paired with an Extension-use relay.
 *
 *   extension-use-mcp --relay http://127.0.0.1:7777 [--device default] [--include "dom.*,tabs.*"] [--exclude "tabs.close"]
 *   Token: EXTENSION_USE_TOKEN (preferred, keeps it out of process lists) or --token.
 *
 * Example for an MCP client config:
 *   { "command": "npx", "args": ["-y", "@extension-use/mcp", "--relay", "http://127.0.0.1:7777"],
 *     "env": { "EXTENSION_USE_TOKEN": "eu_ctl_…" } }
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { connect } from "@extension-use/client";
import { remote } from "@extension-use/client/remote";
import { createExtensionUseMcpServer } from "./index.js";

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const list = (v?: string) => v?.split(",").map((s) => s.trim()).filter(Boolean);

const relay = flag("relay") ?? process.env.EXTENSION_USE_RELAY ?? "http://127.0.0.1:7777";
const token = process.env.EXTENSION_USE_TOKEN ?? flag("token");
const device = flag("device") ?? process.env.EXTENSION_USE_DEVICE ?? "default";

if (!token) {
  // stdout is the MCP channel: report on stderr.
  console.error("extension-use-mcp: set EXTENSION_USE_TOKEN (create one with: npx @extension-use/relay token create agent)");
  process.exit(1);
}

const include = list(flag("include"));
const exclude = list(flag("exclude"));
const { server, close } = createExtensionUseMcpServer({
  connect: () => connect(remote({ relay, token, device }), { name: "extension-use-mcp" }),
  ...(include ? { include } : {}),
  ...(exclude ? { exclude } : {}),
});

await server.connect(new StdioServerTransport());
console.error(`extension-use-mcp: serving tools for ${device} via ${relay}`);
const stop = async () => {
  await close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
