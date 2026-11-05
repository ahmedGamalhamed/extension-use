import { describe, expect, it, vi } from "vitest";
import { connect, type Client } from "@extension-use/client";
import { memoryPair } from "@extension-use/client/memory";
import { ExtensionUseError, type Envelope } from "@extension-use/protocol";
import { z } from "@extension-use/protocol/schemas";
import { createRouter, type RouterEnv } from "../src/background/router.js";
import { builtinGroups } from "../src/background/groups.js";
import { defineAction } from "../src/registry.js";

const echo = defineAction(
  "test.echo",
  { where: "background", version: 1, description: "echo", input: z.object({ text: z.string() }), output: z.object({ text: z.string(), tab: z.number().optional() }) },
  async (input, ctx) => ({ text: input.text, ...(input.text === "tab" ? { tab: (await ctx.tab()).tabId } : {}) }),
);

const slow = defineAction(
  "test.slow",
  { where: "background", version: 1, description: "slow", input: z.object({}), output: z.object({}) },
  (_input, ctx) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve({}), 5000);
      ctx.signal.addEventListener("abort", () => {
        clearTimeout(t);
        reject(ctx.signal.reason);
      });
    }),
);

function setup(opts: { grants?: string[]; url?: string; env?: Partial<RouterEnv> } = {}) {
  const sendToContent = vi.fn(async (_tab, _frame, req: { action: string; input: unknown }) => ({ echoed: req.action, input: req.input }));
  const cancelContent = vi.fn();
  const router = createRouter({
    host: { id: "test-host", name: "Test", version: "1.2.3" },
    actions: [...builtinGroups.dom.actions, ...builtinGroups.page.actions, ...builtinGroups.picker.actions, echo, slow],
    env: {
      resolveTab: async () => ({ tabId: 7, windowId: 1, url: opts.url ?? "https://example.com/" }),
      sendToContent,
      cancelContent,
      ...opts.env,
    },
    policy: { blockedSites: ["https://blocked.example/*"] },
  });
  const { transport, server } = memoryPair();
  const conn = router.connect({
    transport: "memory",
    origin: "https://app.example",
    grants: opts.grants ?? ["*"],
    send: (env: Envelope) => server.send(env),
  });
  server.onMessage((env) => conn.receive(env));
  return { router, transport, server, sendToContent, cancelContent };
}

async function client(t: ReturnType<typeof setup>) {
  return (await connect(t.transport, { name: "test" })) as Client & { test: { echo(i: { text: string }): Promise<{ text: string; tab?: number }> } };
}

describe("router + client", () => {
  it("does the handshake and reports capabilities", async () => {
    const t = setup();
    const ext = await client(t);
    expect(ext.host).toMatchObject({ id: "test-host", name: "Test", version: "1.2.3", protocol: 1 });
    expect(ext.has("dom.click")).toBe(true);
    expect(ext.has("tabs.list")).toBe(false); // group not enabled
    expect(ext.capabilities.find((c) => c.action === "dom.click")).toEqual({ action: "dom.click", version: 1, where: "content" });
  });

  it("runs background actions through the namespace proxy", async () => {
    const t = setup();
    const ext = await client(t);
    await expect(ext.test.echo({ text: "hi" })).resolves.toEqual({ text: "hi" });
    await expect(ext.test.echo({ text: "tab" })).resolves.toEqual({ text: "tab", tab: 7 });
  });

  it("forwards content actions with parsed input and defaults", async () => {
    const t = setup();
    const ext = await client(t);
    const out = await ext.dom.click({ locator: { role: "button", name: "Save" } });
    expect(out).toMatchObject({ echoed: "dom.click" });
    const req = t.sendToContent.mock.calls[0]![2];
    expect(req.input).toEqual({ locator: { role: "button", name: "Save" }, button: "left", clickCount: 1, modifiers: [] });
    expect(req.policy).toEqual({ sensitiveFields: "refuse" });
    expect(t.sendToContent.mock.calls[0]![0]).toMatchObject({ tabId: 7 });
  });

  it("rejects bad input, unknown actions and missing grants", async () => {
    const t = setup({ grants: ["dom.*", "test.echo"] });
    const ext = await client(t);
    await expect(ext.dom.click({ locator: {} } as never)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(ext.callRaw("nope.nothing")).rejects.toMatchObject({ code: "UNKNOWN_ACTION" });
    await expect(ext.page.info()).rejects.toMatchObject({ code: "NOT_GRANTED" });
    expect(ext.has("page.info")).toBe(false);
  });

  it("blocks sites from the policy and the built-in list", async () => {
    for (const url of ["https://blocked.example/x", "chrome://settings", "https://chromewebstore.google.com/detail/x"]) {
      const t = setup({ url });
      const ext = await client(t);
      await expect(ext.page.info()).rejects.toMatchObject({ code: "BLOCKED_BY_POLICY" });
      expect(t.sendToContent).not.toHaveBeenCalled();
    }
  });

  it("times out and cancels", async () => {
    const t = setup();
    const ext = await client(t);
    await expect(ext.callRaw("test.slow", {}, { timeoutMs: 50 })).rejects.toMatchObject({ code: "TIMEOUT" });

    const ac = new AbortController();
    const p = ext.callRaw("test.slow", {}, { signal: ac.signal });
    setTimeout(() => ac.abort(), 20);
    await expect(p).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("asks the content runtime to cancel when a content call is aborted", async () => {
    const t = setup({ env: { sendToContent: () => new Promise(() => {}) } });
    const ext = await client(t);
    const ac = new AbortController();
    const p = ext.picker.start({}, { signal: ac.signal });
    await new Promise((r) => setTimeout(r, 20));
    ac.abort();
    await expect(p).rejects.toMatchObject({ code: "CANCELLED" });
    await new Promise((r) => setTimeout(r, 20));
    expect(t.cancelContent).toHaveBeenCalledTimes(1);
  });

  it("delivers events only to subscribers", async () => {
    const t = setup();
    const ext = await client(t);
    const got: unknown[] = [];
    const off = ext.on("tab.*", (p, meta) => got.push([p, meta.tabId]));
    await new Promise((r) => setTimeout(r, 10));
    t.router.emit("tab.removed", { tabId: 3 }, 3);
    t.router.emit("picker.selected", { ref: "e1" });
    await new Promise((r) => setTimeout(r, 10));
    expect(got).toEqual([[{ tabId: 3 }, 3]]);
    off();
    await new Promise((r) => setTimeout(r, 10));
    t.router.emit("tab.removed", { tabId: 4 }, 4);
    await new Promise((r) => setTimeout(r, 10));
    expect(got).toHaveLength(1);
  });

  it("pauses everything with the kill switch and keeps an audit log", async () => {
    const t = setup();
    const ext = await client(t);
    await ext.test.echo({ text: "a" });
    t.router.pause();
    await expect(ext.test.echo({ text: "b" })).rejects.toMatchObject({ code: "BLOCKED_BY_POLICY" });
    t.router.resume();
    await ext.test.echo({ text: "c" });
    const log = t.router.audit();
    expect(log.map((e) => [e.action, e.ok, e.code])).toEqual([
      ["test.echo", true, undefined],
      ["test.echo", false, "BLOCKED_BY_POLICY"],
      ["test.echo", true, undefined],
    ]);
    expect(log[0]).toMatchObject({ origin: "https://app.example", transport: "memory" });
  });

  it("refuses calls before hello and rejects unsupported protocol versions", async () => {
    const router = createRouter({ host: { id: "h" }, actions: [echo], env: { resolveTab: async () => ({ tabId: 1, windowId: 1, url: "https://x/" }), sendToContent: async () => ({}) } });
    const sent: Envelope[] = [];
    const conn = router.connect({ transport: "memory", origin: "x", grants: ["*"], send: (e) => sent.push(e) });
    conn.receive({ eu: "extension-use", v: 1, kind: "call", id: "1", action: "test.echo", input: { text: "x" } });
    expect(sent[0]).toMatchObject({ kind: "result", ok: false, error: { code: "NOT_CONNECTED" } });
    conn.receive({ eu: "extension-use", v: 1, kind: "hello", client: { protocols: [99] } });
    expect(sent[1]).toMatchObject({ kind: "bye" });
  });

  it("fails pending calls when the host disconnects", async () => {
    const t = setup({ env: { sendToContent: () => new Promise(() => {}) } });
    const ext = await client(t);
    const p = ext.page.info();
    await new Promise((r) => setTimeout(r, 10));
    t.server.disconnect("gone");
    await expect(p).rejects.toBeInstanceOf(ExtensionUseError);
    await expect(p).rejects.toMatchObject({ code: "NOT_CONNECTED" });
    expect(ext.connected).toBe(false);
  });
});
