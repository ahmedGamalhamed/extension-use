import { afterEach, describe, expect, it } from "vitest";
import { connect } from "@extension-use/client";
import { remote } from "@extension-use/client/remote";
import { builtinGroups, createRemoteLink, createRouter } from "@extension-use/host/background";
import { ExtensionUseError } from "@extension-use/protocol";
import { createRelay, hashToken, newId, newToken, type Controller, type DeviceInfo, type RelayBackend, type UsageEvent } from "../src/index.js";

/** A two-tenant backend, like a hosted service would provide. */
class TestBackend implements RelayBackend {
  tokens = new Map<string, Controller>();
  devices = new Map<string, DeviceInfo & { hash: string }>();
  usage: UsageEvent[] = [];
  callLimit = new Map<string, number>();
  deviceLimit = new Map<string, number>();
  calls = new Map<string, number>();

  owner(tenant: string) {
    const t = newToken("eu_own");
    this.tokens.set(t, { tenant, name: "owner", grants: ["*"], owner: true });
    return t;
  }
  async authenticateController(token: string) {
    return this.tokens.get(token);
  }
  async authenticateDevice(token: string) {
    const h = hashToken(token);
    return [...this.devices.values()].find((d) => d.hash === h);
  }
  async createDevice(tenant: string, name: string) {
    const token = newToken("eu_dev");
    const device = { tenant, id: newId("dev"), name, createdAt: Date.now(), hash: hashToken(token) };
    this.devices.set(device.id, device);
    return { device, token };
  }
  async listDevices(tenant: string) {
    return [...this.devices.values()].filter((d) => d.tenant === tenant);
  }
  async removeDevice(tenant: string, id: string) {
    return this.devices.get(id)?.tenant === tenant && this.devices.delete(id);
  }
  async touchDevice() {}
  async createToken(tenant: string, name: string, grants: string[]) {
    const t = newToken("eu_ctl");
    this.tokens.set(t, { tenant, name, grants, owner: false });
    return t;
  }
  async listTokens() {
    return [];
  }
  async revokeToken() {
    return false;
  }
  checkCall(c: Controller) {
    const n = (this.calls.get(c.tenant) ?? 0) + 1;
    this.calls.set(c.tenant, n);
    const limit = this.callLimit.get(c.tenant);
    if (limit !== undefined && n > limit) throw new ExtensionUseError("QUOTA_EXCEEDED", "Monthly call limit reached", { upgradeUrl: "https://cloud.example/billing" });
  }
  checkNewDevice(tenant: string) {
    const limit = this.deviceLimit.get(tenant);
    if (limit !== undefined && [...this.devices.values()].filter((d) => d.tenant === tenant).length >= limit) {
      throw new ExtensionUseError("PLAN_REQUIRED", "Your plan allows no more browsers", { upgradeUrl: "https://cloud.example/billing" });
    }
  }
  recordUsage(e: UsageEvent) {
    this.usage.push(e);
  }
}

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function waitFor(fn: () => boolean) {
  const end = Date.now() + 3000;
  while (!fn()) {
    if (Date.now() > end) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function setup() {
  const backend = new TestBackend();
  const relay = createRelay({ port: 0, backend, pairingCodeDigits: 9 });
  const { url } = await relay.listen();
  cleanups.push(() => relay.close());

  async function browser(tenant: string, ownerToken: string, name: string) {
    const start = await (await fetch(`${url}/v1/pairings`, { method: "POST", body: JSON.stringify({ name }) })).json();
    const approve = await fetch(`${url}/v1/pairings/approve`, { method: "POST", headers: { authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ code: start.code }) });
    if (!approve.ok) return { approve: await approve.json() };
    const { deviceToken } = await (await fetch(`${url}/v1/pairings/${start.pairingId}`)).json();
    const router = createRouter({
      host: { id: `${tenant}-${name}`, name },
      actions: builtinGroups.runtime.actions,
      env: { resolveTab: async () => ({ tabId: 1, windowId: 1, url: "https://example.com/" }), sendToContent: async () => ({}) },
    });
    const link = createRemoteLink({ relay: url, deviceToken, router, grants: ["*"], backoff: [50] });
    link.start();
    cleanups.push(() => link.stop());
    await waitFor(() => link.state.status === "connected");
    return { link, code: start.code as string };
  }
  return { backend, relay, url, browser };
}

describe("relay backends", () => {
  it("keeps tenants apart", async () => {
    const { backend, url, browser } = await setup();
    const a = backend.owner("org_a");
    const b = backend.owner("org_b");
    const { code } = await browser("org_a", a, "Alice's Chrome");
    expect(code).toMatch(/^\d{3}-\d{3}-\d{3}$/); // longer codes for a shared relay
    await browser("org_b", b, "Bob's Chrome");

    const alice = await connect(remote({ relay: url, token: a }));
    cleanups.push(() => alice.close());
    expect(alice.host.name).toBe("Alice's Chrome");

    const bobDevices = await (await fetch(`${url}/v1/devices`, { headers: { authorization: `Bearer ${b}` } })).json();
    expect(bobDevices.map((d: { name: string }) => d.name)).toEqual(["Bob's Chrome"]);
    const aliceDevice = [...backend.devices.values()].find((d) => d.tenant === "org_a")!;
    // Bob can't reach Alice's browser even with its id.
    await expect(connect(remote({ relay: url, token: b, device: aliceDevice.id }))).rejects.toMatchObject({ code: "TARGET_NOT_FOUND" });
    const r = await fetch(`${url}/v1/devices/${aliceDevice.id}/calls`, { method: "POST", headers: { authorization: `Bearer ${b}` }, body: JSON.stringify({ action: "runtime.ping" }) });
    expect(r.status).toBe(404);
  });

  it("meters calls and connections, without payloads", async () => {
    const { backend, url, browser } = await setup();
    const a = backend.owner("org_a");
    await browser("org_a", a, "Chrome");
    const ext = await connect(remote({ relay: url, token: a }));
    cleanups.push(() => ext.close());
    await ext.runtime.ping();
    await ext.runtime.ping();
    await waitFor(() => backend.usage.filter((u) => u.kind === "call").length === 2);
    const call = backend.usage.find((u) => u.kind === "call")!;
    expect(call).toEqual({ kind: "call", tenant: "org_a", controller: "owner", device: expect.stringMatching(/^dev_/), action: "runtime.ping", ok: true, ms: expect.any(Number), ts: expect.any(Number) });
    expect(backend.usage.some((u) => u.kind === "device.connected" && u.tenant === "org_a")).toBe(true);
  });

  it("enforces plan limits with upgrade information", async () => {
    const { backend, url, browser } = await setup();
    const a = backend.owner("org_a");
    await browser("org_a", a, "Chrome");
    backend.callLimit.set("org_a", 1);
    const ext = await connect(remote({ relay: url, token: a }));
    cleanups.push(() => ext.close());
    await ext.runtime.ping();
    const err = await ext.runtime.ping().catch((e) => e);
    expect(err).toMatchObject({ code: "QUOTA_EXCEEDED", data: { upgradeUrl: "https://cloud.example/billing" } });

    const http = await fetch(`${url}/v1/devices/default/calls`, { method: "POST", headers: { authorization: `Bearer ${a}` }, body: JSON.stringify({ action: "runtime.ping" }) });
    expect(http.status).toBe(429);

    backend.deviceLimit.set("org_a", 1);
    const second = await browser("org_a", a, "Laptop");
    expect(second.approve).toMatchObject({ ok: false, error: { code: "PLAN_REQUIRED" } });
  });

  it("limits wrong pairing codes per tenant", async () => {
    const { backend, url } = await setup();
    const a = backend.owner("org_a");
    const tryCode = (code: string) => fetch(`${url}/v1/pairings/approve`, { method: "POST", headers: { authorization: `Bearer ${a}` }, body: JSON.stringify({ code }) });
    for (let i = 0; i < 10; i++) expect((await tryCode(`000-000-00${i}`)).status).toBe(404);
    const blocked = await tryCode("000-000-010");
    expect(blocked.status).toBe(429);
  });
});
