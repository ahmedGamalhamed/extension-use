// The repo's own e2e tests use the public test kit, like any user would.
import { controllerIn, test as base, type Controller } from "@extension-use/testing/playwright";
import { expect, type Page } from "@playwright/test";
import type { Relay } from "@extension-use/relay";

export const FIXTURE_URL = "http://127.0.0.1:5174/fixtures/form.html";
export const FIXTURE_TARGET = { tab: { urlMatch: "http://127.0.0.1:5174/fixtures/form.html*" } };
export const CONTROLLER_URL = "http://localhost:5173/";

export { controllerIn };

export const test = base.extend<{ fixture: Page; panel: Controller }>({
  fixture: async ({ context }, use) => {
    const page = await context.newPage();
    await page.goto(FIXTURE_URL);
    await use(page);
  },
  /** The example controller app inside the side panel page. */
  panel: async ({ openPanel, fixture }, use) => {
    void fixture; // open the test page first
    const { ext } = await openPanel({ frameUrl: CONTROLLER_URL });
    await use(ext);
  },
});

export { expect };

/** Pair the extension with a relay through the control panel page, as a person would. */
export async function pairThroughControlPanel(page: Page, relay: Relay, relayUrl: string) {
  // The control panel lives in an open shadow root; Playwright's locators pierce it.
  await page.getByLabel("Relay URL").fill(relayUrl);
  await page.getByRole("button", { name: "Connect to relay" }).click();
  const code = (await page.locator(".code").textContent())!;
  expect(code).toMatch(/^\d{3}-\d{3}$/);
  expect(relay.pendingPairings()).toEqual([expect.objectContaining({ code })]);
  relay.approve(code);
  await expect(page.getByText(`Connected to ${relayUrl}`)).toBeVisible({ timeout: 10_000 });
}

declare global {
  interface Window {
    __events: unknown[];
    __pick: Promise<unknown>;
  }
}
