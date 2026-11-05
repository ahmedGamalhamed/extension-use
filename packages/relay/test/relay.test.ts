import { afterEach, describe, expect, it, vi } from "vitest";
import { connect } from "@extension-use/client";
import { remote } from "@extension-use/client/remote";
import { builtinGroups, createRemoteLink, createRouter, defineAction, type RemoteLink } from "@extension-use/host/background";
import { z } from "@extension-use/protocol/schemas";
import { createRelay, type Relay } from "../src/index.js";

const echo = defineAction(
  "test.echo",
  { where: "background", version: 1, description: "", input: z.object({ text: z.string() }), output: z.object({ text: z.string() }) },
  (i) => ({ text: i.text }),
);

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function waitFor<T>(fn: () => T | undefined | false, ms = 3000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** A relay plus a fake "browser": the real router and remote link, with a fake page behind it. */
async function setup() {
  const relay: Relay = createRelay({ port: 0 });
  const { url } = await relay.listen();
  cleanups.push(() => relay.close());

  const sendToContent = vi.fn(async (_tab: unknown, _frame: number, req: { action: string; input: unknown }) => ({ ref: "e1", echoed: req.action }));
  const router = createRouter({
    host: { id: "fake-browser", name: "Fake" },
    actions: [...builtinGroups.runtime.actions, ...builtinGroups.dom.actions, echo],
    env: { resolveTab: async () => ({ tabId: 1, windowId: 1, url: "https://example.com/" }), sendToContent },
  });

  // Pair like the extension does.
  const start = await (await fetch(`${url}/v1/pairings`, { method: "POST", body: JSON.stringify({ name: "Test browser" }) })).json();
  expect(start.code).toMatch(/^\d{3}-\d{3}$/);
  expect(await (await fetch(`${url}/v1/pairings/${start.pairingId}`)).json()).toEqual({ status: "pending" });
  const { deviceId } = await relay.approve(start.code);
  const approved = await (await fetch(`${url}/v1/pairings/${start.pairingId}`)).json();
  expect(approved).toMatchObject({ status: "approved", deviceId, name: "Test browser" });
  // The device token is handed out once.
  expect(await (await fetch(`${url}/v1/pairings/${start.pairingId}`)).json()).toEqual({ status: "expired" });

  const link: RemoteLink = createRemoteLink({ relay: url, deviceToken: approved.deviceToken, router, grants: ["*"], backoff: [50] });
  link.start();
  cleanups.push(() => link.stop());
  await waitFor(() => link.state.status === "connected");

  const http = (path: string, body?: unknown, token = relay.ownerToken) =>
    fetch(`${url}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  return { relay, url, router, link, deviceId, sendToContent, http };
}

describe("relay", () => {
  it("lets a controller drive the paired browser over WebSocket", async () => {
    const { url, relay, sendToContent, router, link } = await setup();
    const ext = await connect(remote({ relay: url, token: relay.ownerToken }));
    cleanups.push(() => ext.close());

    expect(ext.host).toMatchObject({ id: "fake-browser" });
    expect(await ext.runtime.ping()).toMatchObject({ pong: true });
    expect(await ext.dom.click({ locator: { role: "button", name: "Go" } })).toMatchObject({ ref: "e1" });
    expect(sendToContent.mock.calls[0]![2]).toMatchObject({ controller: { transport: "remote", origin: "relay:owner" } });
    expect(link.state.sessions).toHaveLength(1);

    const events: unknown[] = [];
    ext.on("tab.*", (p, meta) => events.push([meta.name, p]));
    await new Promise((r) => setTimeout(r, 50));
    router.emit("tab.removed", { tabId: 3 }, 3);
    await waitFor(() => events.length === 1);
    expect(events).toEqual([["tab.removed", { tabId: 3 }]]);
  });

  it("narrows what a token can do, at the relay", async () => {
    const { url, http } = await setup();
    const created = await (await http("/v1/tokens", { name: "reader", grants: ["runtime.*", "dom.snapshot"] })).json();
    const ext = await connect(remote({ relay: url, token: created.token }));
    cleanups.push(() => ext.close());

    expect(ext.has("runtime.ping")).toBe(true);
    expect(ext.has("dom.click")).toBe(false);
    // runtime.describe is narrowed too, so the token can't even list what it can't call.
    const described = await ext.runtime.describe();
    expect(described.actions.map((a) => a.name).sort()).toEqual(["dom.snapshot", "runtime.describe", "runtime.ping"]);
    await expect(ext.dom.click({ locator: { css: "a" } })).rejects.toMatchObject({ code: "NOT_GRANTED" });

    const r = await http("/v1/devices/default/calls", { action: "dom.click", input: { locator: { css: "a" } } }, created.token);
    expect(r.status).toBe(403);
    expect((await r.json()).error.code).toBe("NOT_GRANTED");

    // Only the owner can manage tokens.
    expect((await http("/v1/tokens", { name: "x" }, created.token)).status).toBe(403);
  });

  it("stops accepting revoked tokens", async () => {
    const { url, relay, http } = await setup();
    const { token } = await (await http("/v1/tokens", { name: "ci", grants: ["*"] })).json();
    expect((await http("/v1/devices/default/calls", { action: "runtime.ping" }, token)).status).toBe(200);
    await fetch(`${url}/v1/tokens/ci`, { method: "DELETE", headers: { authorization: `Bearer ${relay.ownerToken}` } });
    expect((await http("/v1/devices/default/calls", { action: "runtime.ping" }, token)).status).toBe(401);
    await expect(connect(remote({ relay: url, token }))).rejects.toMatchObject({ code: "NOT_GRANTED" });
  });

  it("serves one-shot HTTP calls with meaningful status codes", async () => {
    const { http, deviceId, link } = await setup();
    const ok = await http(`/v1/devices/${deviceId}/calls`, { action: "test.echo", input: { text: "hi" } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, output: { text: "hi" } });

    const bad = await http(`/v1/devices/${deviceId}/calls`, { action: "test.echo", input: { text: 1 } });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe("INVALID_INPUT");

    expect((await http(`/v1/devices/${deviceId}/calls`, { action: "runtime.ping" }, "eu_ctl_nope")).status).toBe(401);
    expect((await http("/v1/devices/dev_unknown/calls", { action: "runtime.ping" })).status).toBe(404);

    const list = await (await http("/v1/devices")).json();
    expect(list).toEqual([expect.objectContaining({ id: deviceId, name: "Test browser", online: true })]);

    link.stop();
    await new Promise((r) => setTimeout(r, 50));
    const offline = await http(`/v1/devices/${deviceId}/calls`, { action: "runtime.ping" });
    expect(offline.status).toBe(503);
    expect((await offline.json()).error.code).toBe("DEVICE_OFFLINE");
  });

  it("streams events over SSE", async () => {
    const { url, relay, router } = await setup();
    const ac = new AbortController();
    cleanups.push(() => ac.abort());
    const res = await fetch(`${url}/v1/devices/default/events?events=tab.*&access_token=${relay.ownerToken}`, { signal: ac.signal });
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const reader = res.body!.getReader();
    let text = "";
    const read = async (until: string) => {
      while (!text.includes(until)) text += new TextDecoder().decode((await reader.read()).value);
    };
    await read("event: ready");
    await new Promise((r) => setTimeout(r, 50));
    router.emit("tab.activated", { tabId: 7, windowId: 1 }, 7);
    await read("event: tab.activated");
    expect(text).toMatch(/event: tab\.activated\ndata: \{"payload":\{"tabId":7,"windowId":1\},"ts":\d+,"tabId":7\}/);
  });

  it("fails pending calls when the browser drops, and recovers when it comes back", async () => {
    const { url, relay, link, sendToContent } = await setup();
    const ext = await connect(remote({ relay: url, token: relay.ownerToken }));
    sendToContent.mockImplementationOnce(() => new Promise(() => {})); // the page never answers
    const pending = ext.dom.click({ locator: { css: "a" } });
    await new Promise((r) => setTimeout(r, 50));
    link.stop(); // the browser goes away mid-call
    await expect(pending).rejects.toMatchObject({ code: "DEVICE_OFFLINE" });
    expect(ext.connected).toBe(false);

    link.start();
    await waitFor(() => link.state.status === "connected");
    const again = await connect(remote({ relay: url, token: relay.ownerToken }));
    cleanups.push(() => again.close());
    expect(await again.runtime.ping()).toMatchObject({ pong: true });
  });

  it("respects the browser's kill switch and rejects unknown devices", async () => {
    const { url, relay, router, http, deviceId, link } = await setup();
    const ext = await connect(remote({ relay: url, token: relay.ownerToken }));
    cleanups.push(() => ext.close());
    router.pause();
    await expect(ext.runtime.ping()).rejects.toMatchObject({ code: "BLOCKED_BY_POLICY" });
    router.resume();

    // Unpairing closes the link; the old token no longer works.
    await fetch(`${url}/v1/devices/${deviceId}`, { method: "DELETE", headers: { authorization: `Bearer ${relay.ownerToken}` } });
    await waitFor(() => link.state.status === "unauthorized");
    expect((await (await http("/v1/devices")).json())).toEqual([]);
  });

  it("refuses controllers with bad tokens and reports offline devices on connect", async () => {
    const relay = createRelay({ port: 0 });
    const { url } = await relay.listen();
    cleanups.push(() => relay.close());
    await expect(connect(remote({ relay: url, token: "eu_ctl_bad" }))).rejects.toMatchObject({ code: "NOT_GRANTED" });
    await expect(connect(remote({ relay: url, token: relay.ownerToken }))).rejects.toMatchObject({ code: "DEVICE_OFFLINE" });
  });
});
