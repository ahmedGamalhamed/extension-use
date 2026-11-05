import { test as base, chromium, type BrowserContext, type Frame, type Page } from "@playwright/test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const EXTENSION_PATH = join(here, "../../examples/basic-extension/dist");
export const FIXTURE_URL = "http://127.0.0.1:5174/fixtures/form.html";
export const FIXTURE_TARGET = { tab: { urlMatch: "http://127.0.0.1:5174/fixtures/form.html*" } };
export const CONTROLLER_URL = "http://localhost:5173/";

export type CallResult = { ok: true; out: any } | { ok: false; code: string; message: string };

export interface Controller {
  frame: Frame | Page;
  call(action: string, input?: unknown, options?: Record<string, unknown>): Promise<CallResult>;
  /** Call and expect success. */
  ok(action: string, input?: unknown, options?: Record<string, unknown>): Promise<any>;
}

export function controllerFor(frame: Frame | Page): Controller {
  const call = (action: string, input: unknown = {}, options: Record<string, unknown> = {}) =>
    frame.evaluate(
      ([a, i, o]) =>
        window.extReady.then((ext) =>
          ext.callRaw(a as string, i, o as never).then(
            (out) => ({ ok: true as const, out }),
            (e: { code: string; message: string }) => ({ ok: false as const, code: e.code, message: e.message }),
          ),
        ),
      [action, input, options] as const,
    ) as Promise<CallResult>;
  return {
    frame,
    call,
    async ok(action, input, options) {
      const r = await call(action, input, options);
      if (!r.ok) throw new Error(`${action} failed: ${r.code} ${r.message}`);
      return r.out;
    },
  };
}

export const test = base.extend<{ context: BrowserContext; extensionId: string; fixture: Page; panel: Controller }>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      headless: !process.env.HEADED,
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent("serviceworker");
    await use(new URL(worker.url()).host);
  },
  fixture: async ({ context }, use) => {
    const page = await context.newPage();
    await page.goto(FIXTURE_URL);
    await use(page);
  },
  /**
   * The side panel page opened as a tab (tests can't open the real side
   * panel). It mounts the controller app in an iframe, exactly as in the panel.
   */
  panel: async ({ context, extensionId, fixture }, use) => {
    void fixture;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    const frame = await waitForFrame(page, CONTROLLER_URL);
    await frame.evaluate(() => window.extReady.then(() => true));
    await use(controllerFor(frame));
  },
});

async function waitForFrame(page: Page, urlPrefix: string): Promise<Frame> {
  for (let i = 0; i < 100; i++) {
    const f = page.frames().find((x) => x.url().startsWith(urlPrefix));
    if (f) {
      await f.waitForLoadState();
      return f;
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`No frame for ${urlPrefix}`);
}

export { expect } from "@playwright/test";

// `window.extReady` and `window.storageProbe` are declared by the example controller app.
declare global {
  interface Window {
    __events: unknown[];
    __pick: Promise<unknown>;
  }
}
