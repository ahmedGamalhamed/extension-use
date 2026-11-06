// Tabs that work in the background: tab capture keeps them rendering (and
// lets us screenshot them), and autoDiscardable keeps Chrome from unloading them.
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { FIXTURE_URL, expect, test } from "./fixtures.js";

const { id } = JSON.parse(readFileSync(new URL("../../examples/basic-extension/dev-key.json", import.meta.url), "utf8")) as { id: string };

// Chrome lets an extension capture a tab once the person invoked it there
// (toolbar button, side panel...). Playwright can't click the toolbar, so the
// test browser allowlists the example extension instead.
// No viewport emulation: tab capture sees the real window size, not an emulated one.
test.use({ extensionArgs: [`--allowlisted-extension-id=${id}`], viewport: null });

/** Open the fixture in a tab that stays in the background, and its Playwright page. */
async function backgroundTab(panel: { call: (a: string, i: unknown) => Promise<any> }, context: { pages(): Page[] }, query: string) {
  const url = `${FIXTURE_URL}?${query}`;
  const tab = await panel.call("tabs.open", { url, active: false });
  const page = context.pages().find((p) => p.url() === url)!;
  return { tab, page, on: { target: { tab: tab.id } } };
}

/** How many animation frames the page runs in `ms`. */
const framesIn = (page: Page, ms: number) =>
  page.evaluate(
    (ms) =>
      new Promise<number>((resolve) => {
        let n = 0;
        const tick = () => {
          n++;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        setTimeout(() => resolve(n), ms);
      }),
    ms,
  );

test("screenshots of a background tab go through tab capture", async ({ panel, context }) => {
  const { tab, on } = await backgroundTab(panel, context, "bg-shot");
  expect(tab.active).toBe(false);

  const shot = await panel.call("capture.screenshot", {}, on);
  expect(shot.dataUrl).toMatch(/^data:image\/png;base64,/);
  expect(shot.width).toBeGreaterThan(100);
  expect(shot.height).toBeGreaterThan(100);
  // A short capture for one call doesn't stay behind.
  expect((await panel.call("tabCapture.list", {})).tabIds).toEqual([]);

  const crop = await panel.call("capture.screenshot", { locator: { css: "h1" }, format: "jpeg" }, on);
  expect(crop.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
  expect(crop.width).toBeLessThan(shot.width);

  const full = await panel.call("capture.fullPage", {}, on);
  // A new capture's size can settle a pixel or two off.
  expect(Math.abs(full.width - shot.width)).toBeLessThanOrEqual(4);
  expect(full.height).toBeGreaterThanOrEqual(shot.height);
  await panel.call("tabs.close", { tabId: tab.id });
});

test("tabCapture.start keeps a background tab rendering", async ({ panel, context }) => {
  const { tab, page, on } = await backgroundTab(panel, context, "bg-render");
  const before = await framesIn(page, 600);

  const started = await panel.call("tabCapture.start", {}, on);
  expect(started).toMatchObject({ tabId: tab.id });
  expect(started.width).toBeGreaterThan(100);
  expect((await panel.call("tabCapture.list", {})).tabIds).toEqual([tab.id]);
  // Starting again is a no-op.
  await panel.call("tabCapture.start", {}, on);

  const during = await framesIn(page, 600);
  expect(during).toBeGreaterThan(10);
  // Headless Chromium doesn't pause background tabs; a headed one does (HEADED=1).
  if (before < 5) expect(await page.evaluate(() => document.visibilityState)).toBe("visible");

  // Screenshots reuse the running capture.
  const shot = await panel.call("capture.screenshot", {}, on);
  expect(Math.abs(shot.width - started.width)).toBeLessThanOrEqual(4);
  expect((await panel.call("tabCapture.list", {})).tabIds).toEqual([tab.id]);

  expect(await panel.call("tabCapture.stop", {}, on)).toEqual({ stopped: true });
  expect(await panel.call("tabCapture.stop", {}, on)).toEqual({ stopped: false });
  expect((await panel.call("tabCapture.list", {})).tabIds).toEqual([]);

  // Closing a captured tab ends its capture.
  await panel.call("tabCapture.start", {}, on);
  await panel.call("tabs.close", { tabId: tab.id });
  await expect.poll(async () => (await panel.call("tabCapture.list", {})).tabIds).toEqual([]);
});

test("autoDiscardable, and acting on a discarded tab reloads it", async ({ panel, context, serviceWorker }) => {
  const kept = await backgroundTab(panel, context, "keep");
  const updated = await panel.call("tabs.update", { autoDiscardable: false }, kept.on);
  expect(updated).toMatchObject({ id: kept.tab.id, autoDiscardable: false });
  const listed = await panel.call("tabs.list", {});
  expect(listed.tabs.find((t: { id: number }) => t.id === kept.tab.id)).toMatchObject({ autoDiscardable: false });
  await panel.call("tabs.update", { autoDiscardable: true }, kept.on);

  // Chrome unloads the tab; the next content action brings it back.
  const gone = await backgroundTab(panel, context, "discard");
  const newId = await serviceWorker.evaluate(async (tabId) => (await chrome.tabs.discard(tabId))?.id, gone.tab.id);
  const after = (await panel.call("tabs.list", {})).tabs.find((t: { id: number }) => t.id === newId);
  expect(after).toMatchObject({ discarded: true });
  const text = await panel.call("dom.text", { locator: { css: "h1" } }, { target: { tab: newId } });
  expect(text.text).toContain("Order form");

  await panel.call("tabs.close", { tabId: kept.tab.id });
  await panel.call("tabs.close", { tabId: newId });
});
