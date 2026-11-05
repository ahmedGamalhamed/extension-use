import { connect, type Client } from "@extension-use/client";
import { remote } from "@extension-use/client/remote";
import { createRelay, type Relay } from "@extension-use/relay";
import type { Page, Worker } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURE_TARGET, FIXTURE_URL, expect, test } from "./fixtures.js";

const T = { target: FIXTURE_TARGET };

async function pairThroughControlPanel(page: Page, relay: Relay, relayUrl: string) {
  // The control panel lives in an open shadow root; Playwright's locators pierce it.
  await page.getByLabel("Relay URL").fill(relayUrl);
  await page.getByRole("button", { name: "Connect to relay" }).click();
  const code = (await page.locator(".code").textContent())!;
  expect(code).toMatch(/^\d{3}-\d{3}$/);
  expect(relay.pendingPairings()).toEqual([expect.objectContaining({ code })]);
  relay.approve(code);
  await expect(page.getByText(`Connected to ${relayUrl}`)).toBeVisible({ timeout: 10_000 });
}

const badge = (sw: Worker) => sw.evaluate(() => chrome.action.getBadgeText({}));

test("remote control through a relay: pairing, calls, visible control, kill switch, unpairing", async ({ context, extensionId, serviceWorker, fixture }) => {
  test.setTimeout(60_000);
  const relay = createRelay({ port: 0 });
  const { url } = await relay.listen();
  let ext: Client | undefined;
  try {
    const control = await context.newPage();
    await control.goto(`chrome-extension://${extensionId}/control.html`);
    await pairThroughControlPanel(control, relay, url);
    expect(relay.devicesOnline()).toEqual([expect.objectContaining({ name: expect.stringContaining("on") })]);

    // A script (this test process) drives the browser through the relay.
    ext = await connect(remote({ relay: url, token: relay.ownerToken }));
    expect(ext.host.id).toBe("example-basic");
    expect(await ext.page.info({}, T)).toMatchObject({ url: FIXTURE_URL });
    await ext.dom.fill({ locator: { css: "#email" }, value: "remote@example.com" }, T);
    await expect(fixture.locator("#email")).toHaveValue("remote@example.com");

    // Visible control: a pill in the page, the toolbar badge, and the control panel.
    await expect(fixture.locator(".controlled")).toHaveText("Controlled by remote: owner");
    expect(await badge(serviceWorker)).toBe("ON");
    await expect(control.getByText("relay:owner").first()).toBeVisible();
    await expect(control.getByText(/dom\.fill/)).toBeVisible();

    // HTTP calls work too, with a narrower token.
    const { token } = await (
      await fetch(`${url}/v1/tokens`, { method: "POST", headers: { authorization: `Bearer ${relay.ownerToken}` }, body: JSON.stringify({ name: "reader", grants: ["page.*", "dom.snapshot"] }) })
    ).json();
    const call = (action: string, input: unknown) =>
      fetch(`${url}/v1/devices/default/calls`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ action, input, ...T }) });
    const snap = await (await call("dom.snapshot", { format: "text" })).json();
    expect(snap.output.text).toContain('heading "Order form"');
    expect((await call("dom.click", { locator: { css: "#save" } })).status).toBe(403);

    // Kill switch in the control panel stops everything, and survives in the badge.
    await control.getByRole("button", { name: "Pause all control" }).click();
    await expect(ext.runtime.ping()).rejects.toMatchObject({ code: "BLOCKED_BY_POLICY" });
    await expect.poll(() => badge(serviceWorker)).toBe("II");
    await control.getByRole("button", { name: "Resume" }).click();
    await expect.poll(() => ext!.runtime.ping().then(() => "ok", (e) => e.code)).toBe("ok");

    // Forgetting the relay ends the link; the device token is gone from the extension.
    await control.getByRole("button", { name: "Disconnect and forget" }).click();
    await expect(control.getByRole("button", { name: "Connect to relay" })).toBeVisible();
    await expect.poll(() => relay.devicesOnline().length).toBe(0);
    await expect(ext.runtime.ping()).rejects.toMatchObject({ code: expect.stringMatching(/DEVICE_OFFLINE|NOT_CONNECTED/) });
    expect(await serviceWorker.evaluate(() => chrome.storage.local.get("extensionUse.remote"))).toEqual({});
  } finally {
    ext?.close();
    await relay.close();
  }
});

test("the extension reconnects when the relay restarts, and stops if the relay forgot it", async ({ context, extensionId }) => {
  test.setTimeout(60_000);
  const dataFile = join(mkdtempSync(join(tmpdir(), "eu-relay-")), "relay.json");
  const relay = createRelay({ port: 0, dataFile });
  const { url, port } = await relay.listen();
  const control = await context.newPage();
  await control.goto(`chrome-extension://${extensionId}/control.html`);
  await pairThroughControlPanel(control, relay, url);

  // Restart on the same port with the same data file: the extension reconnects by itself.
  await relay.close();
  await expect(control.getByText(/Disconnected|Connecting/)).toBeVisible({ timeout: 10_000 });
  const restarted = createRelay({ port, dataFile });
  await restarted.listen();
  try {
    await expect(control.getByText(`Connected to ${url}`)).toBeVisible({ timeout: 20_000 });
    const ext = await connect(remote({ relay: url, token: restarted.ownerToken }));
    expect(await ext.runtime.ping()).toMatchObject({ pong: true });
    ext.close();
  } finally {
    await restarted.close();
  }

  // A relay with no record of this browser: the extension says so instead of retrying forever.
  const fresh = createRelay({ port });
  await fresh.listen();
  try {
    await expect(control.getByText("The relay no longer knows this browser")).toBeVisible({ timeout: 20_000 });
  } finally {
    await fresh.close();
  }
});
