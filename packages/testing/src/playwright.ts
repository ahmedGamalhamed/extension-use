/**
 * @extension-use/testing/playwright
 *
 *   // playwright.config.ts
 *   use: { extensionPath: "dist/extension" }
 *
 *   // my.spec.ts
 *   import { test, expect } from "@extension-use/testing/playwright";
 *   test("reads the page", async ({ context, openPanel }) => {
 *     const page = await context.newPage();
 *     await page.goto("https://example.com");
 *     const panel = await openPanel();
 *     const snap = await panel.ext.dom.snapshot({ format: "text" }, { target: { tab: { urlMatch: "https://example.com/*" } } });
 *   });
 *
 * Your controller app must connect with `connect(transport, { expose: true })`
 * (in test or dev builds) so the fixture can reach its client.
 */
import { test as base, chromium, type BrowserContext, type Frame, type Page, type Worker } from "@playwright/test";
import { ExtensionUseError, type CallOptions } from "@extension-use/protocol";
import type { CoreActions } from "@extension-use/protocol/schemas";
import type { ActionNamespaces } from "@extension-use/client";
import { resolve } from "node:path";

const EXPOSE_KEY = "__extensionUse";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CallResult<O = any> = { ok: true; output: O } | { ok: false; code: string; message: string; data?: unknown };

export type Controller<A extends Record<string, { input: unknown; output: unknown }> = CoreActions> = ActionNamespaces<A> & {
  /** The page or frame the controller app runs in. */
  readonly frame: Page | Frame;
  /** Call an action. Rejects with an ExtensionUseError on failure. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  call<O = any>(action: string, input?: unknown, options?: Omit<CallOptions, "signal">): Promise<O>;
  /** Call an action and return the outcome instead of throwing. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  try<O = any>(action: string, input?: unknown, options?: Omit<CallOptions, "signal">): Promise<CallResult<O>>;
  /** Whether the host offers this action to the controller. */
  has(action: string): Promise<boolean>;
};

/**
 * Drive the Extension-use client that a controller app exposed in this page or
 * frame. Waits for the app to connect.
 */
export async function controllerIn<A extends Record<string, { input: unknown; output: unknown }> = CoreActions>(
  frame: Page | Frame,
  options: { key?: string; timeoutMs?: number } = {},
): Promise<Controller<A>> {
  const key = options.key ?? EXPOSE_KEY;
  await frame.waitForFunction((k) => Boolean((globalThis as Record<string, unknown>)[k]), key, { timeout: options.timeoutMs ?? 10_000 });

  const tryCall = (action: string, input: unknown = {}, callOptions: Omit<CallOptions, "signal"> = {}) =>
    frame.evaluate(
      async ([k, a, i, o]) => {
        const ext = (globalThis as unknown as Record<string, { callRaw(a: string, i: unknown, o: unknown): Promise<unknown> }>)[k as string]!;
        try {
          return { ok: true as const, output: await ext.callRaw(a as string, i, o) };
        } catch (e) {
          const err = e as { code?: string; message?: string; data?: unknown };
          return { ok: false as const, code: err.code ?? "INTERNAL", message: err.message ?? String(e), ...(err.data !== undefined ? { data: err.data } : {}) };
        }
      },
      [key, action, input, callOptions] as const,
    ) as Promise<CallResult>;

  const base = {
    frame,
    try: tryCall,
    async call(action: string, input?: unknown, callOptions?: Omit<CallOptions, "signal">) {
      const r = await tryCall(action, input, callOptions);
      if (!r.ok) throw new ExtensionUseError(r.code as never, r.message, r.data);
      return r.output;
    },
    has: (action: string) => frame.evaluate(([k, a]) => (globalThis as unknown as Record<string, { has(a: string): boolean }>)[k as string]!.has(a as string), [key, action] as const),
  };

  return new Proxy(base, {
    get(target, prop, receiver) {
      if (typeof prop !== "string" || prop in target) return Reflect.get(target, prop, receiver);
      return new Proxy(
        {},
        {
          get: (_t, method) =>
            typeof method === "string" && method !== "then"
              ? (input?: unknown, opts?: Omit<CallOptions, "signal">) => base.call(`${prop}.${method}`, input, opts)
              : undefined,
        },
      );
    },
  }) as unknown as Controller<A>;
}

export interface Panel {
  /** The extension page (side panel opened as a tab). */
  page: Page;
  /** The iframe running your web app. */
  frame: Frame;
  /** The web app's client. */
  ext: Controller;
}

export interface ExtensionFixtures {
  /** Path to the built, unpacked extension. Set it in `use` in playwright.config. */
  extensionPath: string;
  /** Extension page that mounts the frame bridge. Default "sidepanel.html". */
  panelPath: string;
  /** Run the browser headless. Default true (unless HEADED=1). */
  extensionHeadless: boolean;
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
  /**
   * Open the side panel page as a tab (Playwright can't open the real side
   * panel) and connect to the web app inside it. The bridge code is the same.
   */
  openPanel(options?: { path?: string; frameUrl?: string | RegExp }): Promise<Panel>;
}

export const test = base.extend<ExtensionFixtures>({
  extensionPath: ["", { option: true }],
  panelPath: ["sidepanel.html", { option: true }],
  extensionHeadless: [!process.env.HEADED, { option: true }],

  context: async ({ extensionPath, extensionHeadless }, use) => {
    if (!extensionPath) throw new Error("Set `use: { extensionPath: \"path/to/unpacked/extension\" }` in playwright.config");
    const path = resolve(extensionPath);
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      headless: extensionHeadless,
      args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`],
    });
    await use(context);
    await context.close();
  },

  serviceWorker: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent("serviceworker");
    await use(worker);
  },

  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },

  openPanel: async ({ context, extensionId, panelPath }, use) => {
    await use(async (options = {}) => {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/${options.path ?? panelPath}`);
      const matches = (url: string) =>
        options.frameUrl instanceof RegExp ? options.frameUrl.test(url) : options.frameUrl ? url.startsWith(options.frameUrl) : /^https?:/.test(url);
      let frame: Frame | undefined;
      for (let i = 0; i < 100 && !frame; i++) {
        frame = page.frames().find((f) => f !== page.mainFrame() && matches(f.url()));
        if (!frame) await page.waitForTimeout(100);
      }
      if (!frame) throw new Error("The panel did not load a web app frame");
      await frame.waitForLoadState();
      return { page, frame, ext: await controllerIn(frame) };
    });
  },
});

export { expect } from "@playwright/test";
