import { afterEach, describe, expect, it, vi } from "vitest";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { connect } from "@extension-use/client";
import { remote } from "@extension-use/client/remote";
import { builtinGroups, createRemoteLink, createRouter, defineAction } from "@extension-use/host/background";
import { z } from "@extension-use/protocol/schemas";
import { createRelay } from "@extension-use/relay";
import { createExtensionUseMcpServer } from "../src/index.js";

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

const save = defineAction(
  "app.save",
  { where: "background", version: 1, description: "Save the current page to the user's reading list.", input: z.object({ note: z.string().optional() }), output: z.object({ saved: z.boolean() }) },
  () => ({ saved: true }),
);

async function waitFor(fn: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function setup(opts: { pair?: boolean; grants?: string[] } = {}) {
  const relay = createRelay({ port: 0 });
  const { url } = await relay.listen();
  cleanups.push(() => relay.close());

  const sendToContent = vi.fn(async (_t: unknown, _f: number, req: { action: string; input: Record<string, unknown> }) => {
    if (req.action === "dom.snapshot") return { text: '- heading "Inbox" [level=1] [ref=e1]\n- button "Compose" [ref=e2]', nodeCount: 2, truncated: false };
    return { ref: "e2" };
  });
  const router = createRouter({
    host: { id: "fake-browser", name: "Fake" },
    actions: [...builtinGroups.runtime.actions, ...builtinGroups.run.actions, ...builtinGroups.dom.actions, save],
    env: { resolveTab: async () => ({ tabId: 1, windowId: 1, url: "https://mail.example/" }), sendToContent },
  });

  const pairAndLink = async () => {
    const start = await (await fetch(`${url}/v1/pairings`, { method: "POST", body: "{}" })).json();
    relay.approve(start.code);
    const { deviceToken } = await (await fetch(`${url}/v1/pairings/${start.pairingId}`)).json();
    const link = createRemoteLink({ relay: url, deviceToken, router, grants: ["*"], backoff: [50] });
    link.start();
    cleanups.push(() => link.stop());
    await waitFor(() => link.state.status === "connected");
  };
  if (opts.pair !== false) await pairAndLink();

  const token = opts.grants
    ? (await (await fetch(`${url}/v1/tokens`, { method: "POST", headers: { authorization: `Bearer ${relay.ownerToken}` }, body: JSON.stringify({ name: "agent", grants: opts.grants }) })).json()).token
    : relay.ownerToken;

  const { server, close } = createExtensionUseMcpServer({ connect: () => connect(remote({ relay: url, token })) });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const mcp = new McpClient({ name: "test-agent", version: "1.0.0" });
  await mcp.connect(b);
  cleanups.push(async () => {
    await mcp.close();
    await close();
  });
  return { mcp, sendToContent, pairAndLink };
}

const textOf = (r: { content: unknown }) => (r.content as { type: string; text?: string }[]).map((c) => c.text ?? "").join("\n");

describe("MCP server", () => {
  it("exposes the browser's actions as tools, including host-defined ones", async () => {
    const { mcp } = await setup();
    expect(mcp.getInstructions()).toContain("dom_snapshot");
    const { tools } = await mcp.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["dom_click", "dom_snapshot", "run_sequence", "app_save", "runtime_ping"]));
    expect(names).not.toContain("runtime_describe");

    const click = tools.find((t) => t.name === "dom_click")!;
    expect(click.inputSchema.required).toEqual(["locator"]);
    expect(click.inputSchema.properties).toHaveProperty("target");
    expect(click.annotations).toMatchObject({ readOnlyHint: false });
    expect(tools.find((t) => t.name === "dom_snapshot")!.annotations).toMatchObject({ readOnlyHint: true });
    expect(tools.find((t) => t.name === "app_save")!.description).toBe("Save the current page to the user's reading list.");
  });

  it("calls actions, with model-friendly snapshot defaults and readable errors", async () => {
    const { mcp, sendToContent } = await setup();
    const snap = await mcp.callTool({ name: "dom_snapshot", arguments: {} });
    expect(textOf(snap)).toContain('button "Compose" [ref=e2]');
    expect(sendToContent.mock.calls[0]![2].input).toMatchObject({ format: "text", viewportOnly: true });

    const click = await mcp.callTool({ name: "dom_click", arguments: { locator: { ref: "e2" }, target: { tab: 1 } } });
    expect(click.isError).toBeFalsy();
    expect(sendToContent.mock.calls[1]![2]).toMatchObject({ action: "dom.click", target: { tab: 1 }, input: { locator: { ref: "e2" } } });

    const bad = await mcp.callTool({ name: "dom_click", arguments: {} });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toMatch(/^INVALID_INPUT: locator/);

    expect(textOf(await mcp.callTool({ name: "app_save", arguments: { note: "later" } }))).toContain('"saved": true');

    const seq = await mcp.callTool({
      name: "run_sequence",
      arguments: { steps: [{ action: "dom.fill", input: { locator: { ref: "e3" }, value: "hi" } }, { action: "dom.click", input: { locator: { ref: "e2" } } }] },
    });
    expect(JSON.parse(textOf(seq))).toMatchObject({ completed: 2, ok: true });
  });

  it("only offers what the token allows", async () => {
    const { mcp } = await setup({ grants: ["runtime.*", "dom.snapshot", "dom.text"] });
    const names = (await mcp.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(["dom_snapshot", "dom_text", "runtime_ping"]);
    const denied = await mcp.callTool({ name: "dom_click", arguments: { locator: { ref: "e1" } } });
    expect(denied.isError).toBe(true);
  });

  it("explains how to connect when no browser is paired, then picks it up", async () => {
    const { mcp, pairAndLink } = await setup({ pair: false });
    const { tools } = await mcp.listTools();
    expect(tools.map((t) => t.name)).toEqual(["browser_status"]);
    expect(tools[0]!.description).toContain("DEVICE_OFFLINE");

    await pairAndLink();
    expect(textOf(await mcp.callTool({ name: "browser_status", arguments: {} }))).toContain('Connected to "Fake"');
    expect((await mcp.listTools()).tools.length).toBeGreaterThan(5);
  });
});
