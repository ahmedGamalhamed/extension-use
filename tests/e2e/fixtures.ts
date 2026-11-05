// The repo's own e2e tests use the public test kit, like any user would.
import { controllerIn, test as base, type Controller } from "@extension-use/testing/playwright";
import type { Page } from "@playwright/test";

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

export { expect } from "@extension-use/testing/playwright";

declare global {
  interface Window {
    __events: unknown[];
    __pick: Promise<unknown>;
  }
}
