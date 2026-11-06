import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { connect } from "@extension-use/client";
import { agentInstructions, builtinGroups, createRemoteLink, createRouter } from "@extension-use/host/background";
import { AGENT_PATH, isAgentKey, newAgentKey } from "@extension-use/protocol/remote";
import { createExtensionUseMcpServer, listenForBrowser } from "../src/index.js";

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function waitFor(fn: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

function fakeBrowser() {
  const sendToContent = vi.fn(async (_t: unknown, _f: number, req: { action: string }) => {
    if (req.action === "dom.snapshot") return { text: '- button "Compose" [ref=e2]', nodeCount: 1, truncated: false };
    return { ref: "e2" };
  });
  const router = createRouter({
    host: { id: "fake-browser", name: "Fake" },
    actions: [...builtinGroups.runtime.actions, ...builtinGroups.dom.actions],
    env: { resolveTab: async () => ({ tabId: 1, windowId: 1, url: "https://mail.example/" }), sendToContent },
  });
  return { router, sendToContent };
}

/** The extension's side: dial the local agent port with a key. */
function dial(router: ReturnType<typeof createRouter>, url: string, agentKey: string) {
  const link = createRemoteLink({ relay: "http://127.0.0.1", url, agentKey, transport: "agent", router, grants: ["*"], backoff: [50] });
  link.start();
  cleanups.push(() => link.stop());
  return link;
}

/** An MCP server in local mode, wired like the CLI, plus a client talking to it. */
async function agentServer(key: string, opts: { listWaitMs?: number } = {}) {
  const local = await listenForBrowser({ key, ports: [0] });
  cleanups.push(() => local.close());
  const mcp = createExtensionUseMcpServer({
    connect: (ctx) =>
      connect(local.transport({ label: mcp.server.getClientVersion()?.name ?? "agent", waitMs: ctx?.purpose === "list" ? (opts.listWaitMs ?? 200) : 2000 }), { name: "extension-use-mcp" }),
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await mcp.server.connect(a);
  const client = new McpClient({ name: "test-agent", version: "1.0.0" });
  await client.connect(b);
  cleanups.push(async () => {
    await client.close();
    await mcp.close();
  });
  return { local, mcp, client };
}

const textOf = (r: { content: unknown }) => (r.content as { type: string; text?: string }[]).map((c) => c.text ?? "").join("\n");

describe("local agent link", () => {
  it("lets an agent drive the browser with only the key from the instructions", async () => {
    const key = newAgentKey();
    expect(isAgentKey(key)).toBe(true);
    const { router, sendToContent } = fakeBrowser();
    const { local, client } = await agentServer(key);
    const link = dial(router, local.url, key);
    await waitFor(() => link.state.status === "connected");

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["dom_click", "dom_snapshot"]));

    const snap = await client.callTool({ name: "dom_snapshot", arguments: {} });
    expect(textOf(snap)).toContain('button "Compose" [ref=e2]');
    expect(sendToContent).toHaveBeenCalled();

    // The extension lists the session under the agent's own name.
    expect(router.sessions().map((s) => [s.transport, s.origin])).toContainEqual(["agent", "agent:test-agent"]);
  });

  it("never connects with a different key", async () => {
    const { router } = fakeBrowser();
    const { local, client } = await agentServer(newAgentKey());
    const link = dial(router, local.url, newAgentKey());
    await new Promise((r) => setTimeout(r, 300));
    expect(link.state.status).not.toBe("connected");
    expect(local.connected).toBe(false);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["browser_status"]);
    expect(router.sessions()).toHaveLength(0);
  });

  it("refuses websites", async () => {
    const local = await listenForBrowser({ key: newAgentKey(), ports: [0] });
    cleanups.push(() => local.close());
    const ws = new WebSocket(local.url, { headers: { origin: "https://evil.example" } });
    const outcome = await new Promise<string>((resolve) => {
      ws.on("open", () => resolve("open"));
      ws.on("error", () => resolve("refused"));
    });
    expect(outcome).toBe("refused");
  });

  it("the extension ignores a server that can't prove it knows the key", async () => {
    const { router } = fakeBrowser();
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    cleanups.push(() => new Promise((r) => wss.close(r)));
    await new Promise((r) => wss.once("listening", r));
    const port = (wss.address() as { port: number }).port;
    const got: string[] = [];
    wss.on("connection", (ws) => {
      ws.on("message", (d) => got.push(JSON.parse(d.toString()).t));
      // Skip the proof and try to open a session straight away.
      ws.send(JSON.stringify({ t: "ready", deviceId: "x", name: "x" }));
      ws.send(JSON.stringify({ t: "open", s: "s1", origin: "agent:impostor" }));
      ws.send(JSON.stringify({ t: "agent-challenge", keyId: "000000000000", nonce: "0".repeat(32), proof: "00" }));
    });
    const link = dial(router, `ws://127.0.0.1:${port}${AGENT_PATH}`, newAgentKey());
    await new Promise((r) => setTimeout(r, 300));
    expect(router.sessions()).toHaveLength(0);
    expect(link.state.status).not.toBe("connected");
    expect(got).not.toContain("agent-proof");
  });

  it("tells the MCP client to list tools again when the browser connects late", async () => {
    const key = newAgentKey();
    const { router } = fakeBrowser();
    const local = await listenForBrowser({ key, ports: [0], onBrowser: () => mcp.notifyToolsChanged() });
    cleanups.push(() => local.close());
    const mcp = createExtensionUseMcpServer({ connect: (ctx) => connect(local.transport({ waitMs: ctx?.purpose === "list" ? 100 : 2000 })) });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await mcp.server.connect(a);
    const client = new McpClient({ name: "late", version: "1.0.0" });
    let changed = 0;
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => void changed++);
    await client.connect(b);
    cleanups.push(async () => {
      await client.close();
      await mcp.close();
    });

    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(["browser_status"]);
    dial(router, local.url, key);
    await waitFor(() => changed > 0);
    expect((await client.listTools()).tools.map((t) => t.name)).toContain("dom_click");
  });

  it("waits for the browser during a tool call", async () => {
    const key = newAgentKey();
    const { router } = fakeBrowser();
    const { local, client } = await agentServer(key);
    const call = client.callTool({ name: "browser_status", arguments: {} });
    setTimeout(() => dial(router, local.url, key), 200);
    expect(textOf(await call)).toContain("Connected");
  });

  it("writes instructions with the key and a ready-to-paste MCP config", () => {
    const key = newAgentKey();
    const text = agentInstructions(key, { hostName: "My Extension" });
    expect(text).toContain('"EXTENSION_USE_AGENT_KEY": "' + key + '"');
    expect(text).toContain(`claude mcp add browser -e EXTENSION_USE_AGENT_KEY=${key} -- npx -y @extension-use/mcp`);
    expect(text).toContain('"My Extension"');
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    expect(JSON.parse(json).mcpServers.browser.args).toEqual(["-y", "@extension-use/mcp"]);
  });
});
