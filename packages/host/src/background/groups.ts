/**
 * Built-in action groups, as seen from the background.
 * Background actions carry their handler here. Content actions are declared
 * here (so the router can validate and route them) and implemented in the
 * content runtime.
 */
import { ExtensionUseError, matchPattern } from "@extension-use/protocol";
import { coreActionSchemas, z, type CoreActionName, type TabInfo, type WindowInfo } from "@extension-use/protocol/schemas";
import type { ActionContext, ActionDef, ActionGroup, ResolvedTab } from "../registry.js";
import { captureFrame, capturedTabs, startCapture, stopCapture, tabCaptureAvailable, withCapture } from "./tab-capture.js";
import { bookmarksGroup, cookiesGroup, downloadsGroup, historyGroup } from "./browser-data.js";

type S = typeof coreActionSchemas;
type Handler<K extends CoreActionName> = NonNullable<ActionDef<S[K]>["handler"]>;

function bg<K extends CoreActionName>(name: K, handler: Handler<K>): ActionDef {
  return { name, schema: coreActionSchemas[name], handler } as unknown as ActionDef;
}

function content(name: CoreActionName): ActionDef {
  return { name, schema: coreActionSchemas[name] };
}

function toTabInfo(t: chrome.tabs.Tab): TabInfo {
  return {
    id: t.id ?? -1,
    windowId: t.windowId,
    url: t.url ?? t.pendingUrl ?? "",
    title: t.title ?? "",
    active: t.active,
    status: t.status ?? "unknown",
    ...(t.discarded ? { discarded: true } : {}),
    ...(t.autoDiscardable === false ? { autoDiscardable: false } : {}),
  };
}

/**
 * Wait until the tab has finished loading. A tab with a navigation still
 * pending isn't done, and with `notBlank` neither is a new tab that still
 * shows its initial about:blank (it reports "complete" before it starts
 * loading the URL it was opened with).
 */
export async function waitForLoad(tabId: number, signal: AbortSignal, opts: { notBlank?: boolean } = {}): Promise<chrome.tabs.Tab> {
  const done = (t: chrome.tabs.Tab) => t.status === "complete" && !t.pendingUrl && !(opts.notBlank && (!t.url || t.url === "about:blank"));
  const tab = await chrome.tabs.get(tabId);
  if (done(tab)) return tab;
  return new Promise((resolve, reject) => {
    const onUpdated = (id: number, _info: { status?: string }, t: chrome.tabs.Tab) => {
      if (id === tabId && done(t)) {
        cleanup();
        resolve(t);
      }
    };
    const onRemoved = (id: number) => {
      if (id === tabId) {
        cleanup();
        reject(new ExtensionUseError("TAB_CLOSED", "The tab was closed"));
      }
    };
    const onAbort = () => {
      cleanup();
      reject(signal.reason);
    };
    const cleanup = () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      signal.removeEventListener("abort", onAbort);
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    signal.addEventListener("abort", onAbort, { once: true });
    // The tab may have finished loading between get() and addListener().
    chrome.tabs.get(tabId).then((t) => {
      if (done(t)) {
        cleanup();
        resolve(t);
      }
    }, () => {});
  });
}

function toWindowInfo(w: chrome.windows.Window): WindowInfo {
  return {
    id: w.id ?? -1,
    focused: w.focused,
    state: w.state ?? "normal",
    type: w.type ?? "normal",
    incognito: w.incognito,
    ...(w.left !== undefined ? { left: w.left } : {}),
    ...(w.top !== undefined ? { top: w.top } : {}),
    ...(w.width !== undefined ? { width: w.width } : {}),
    ...(w.height !== undefined ? { height: w.height } : {}),
    tabCount: w.tabs?.length ?? 0,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Closing a blank or new-tab page is fine even though controllers can't act on those pages. */
function assertMayClose(ctx: ActionContext, url: string) {
  if (!url || /^(about:blank|chrome:\/\/newtab\/?|chrome:\/\/new-tab-page\/?|edge:\/\/newtab\/?)$/i.test(url)) return;
  ctx.assertAllowedUrl(url);
}

/**
 * Start a navigation and, if asked, wait for it to finish. chrome.tabs.update,
 * reload, goBack and goForward resolve before the tab flips to "loading", so
 * waiting for "complete" straight away can return the old page. Wait to see
 * "loading" first; same-document navigations never show it, hence the cap.
 */
async function navigateAndWait(tabId: number, start: () => Promise<unknown>, signal: AbortSignal, wait: boolean): Promise<chrome.tabs.Tab> {
  let onUpdated: ((id: number, info: { status?: string }) => void) | undefined;
  const loading = new Promise<void>((resolve) => {
    onUpdated = (id, info) => {
      if (id === tabId && info.status === "loading") resolve();
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
  try {
    await start();
    if (!wait) return await chrome.tabs.get(tabId);
    await Promise.race([loading, sleep(500)]);
  } finally {
    chrome.tabs.onUpdated.removeListener(onUpdated!);
  }
  return waitForLoad(tabId, signal);
}

/**
 * Chrome's back and forward (which chrome.tabs.goBack uses) skip history
 * entries the person never interacted with, and synthetic clicks don't count,
 * so for a controller every entry can look skippable. history.back() in the
 * page isn't affected. The Navigation API says whether there is an entry to
 * go to; it only sees same-origin entries, so a cross-origin step without
 * interaction still fails.
 */
async function historyInPage(tabId: number, dir: "back" | "forward"): Promise<boolean> {
  if (!chrome.scripting?.executeScript) return false;
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (back: boolean) => {
      const nav = (globalThis as { navigation?: { canGoBack: boolean; canGoForward: boolean } }).navigation;
      if (!nav || !(back ? nav.canGoBack : nav.canGoForward)) return false;
      history.go(back ? -1 : 1);
      return true;
    },
    args: [dir === "back"],
  });
  return result?.result === true;
}

async function historyStep(ctx: ActionContext, dir: "back" | "forward", wait: boolean) {
  const { tabId } = await ctx.tab();
  const go = async () => {
    try {
      await (dir === "back" ? chrome.tabs.goBack(tabId) : chrome.tabs.goForward(tabId));
    } catch (err) {
      if (await historyInPage(tabId, dir).catch(() => false)) return;
      throw new ExtensionUseError("INVALID_INPUT", `Can't go ${dir}: ${String((err as Error)?.message ?? err)}`);
    }
  };
  return toTabInfo(await navigateAndWait(tabId, go, ctx.signal, wait));
}

function checkUrl(ctx: ActionContext, url: string) {
  ctx.assertAllowedUrl(url);
  if (!/^(https?|file|data):/i.test(url)) {
    throw new ExtensionUseError("BLOCKED_BY_POLICY", `Only http(s), file and data URLs can be opened, got ${url}`);
  }
}

export const runtimeGroup: ActionGroup = {
  name: "runtime",
  permissions: [],
  needsHostAccess: false,
  actions: [
    bg("runtime.ping", () => ({ pong: true as const, ts: Date.now() })),
    bg("runtime.describe", (input, ctx) => {
      const toJson = (schema: z.ZodType, io: "input" | "output") =>
        z.toJSONSchema(schema, { io, unrepresentable: "any", reused: "inline", cycles: "ref" }) as Record<string, unknown>;
      const wanted = input.actions ? new Set(input.actions) : undefined;
      return {
        host: ctx.host,
        actions: ctx
          .listActions()
          .filter((d) => !wanted || wanted.has(d.name))
          .map((d) => ({
            name: d.name,
            description: d.schema.description,
            where: d.schema.where,
            version: d.schema.version,
            input: toJson(d.schema.input, "input"),
            output: toJson(d.schema.output, "output"),
          })),
      };
    }),
  ],
};

export const runGroup: ActionGroup = {
  name: "run",
  permissions: [],
  needsHostAccess: false,
  actions: [
    bg("run.sequence", async (input, ctx) => {
      const results: ({ ok: true; action: string; output: unknown } | { ok: false; action: string; error: { code: string; message: string } })[] = [];
      let completed = 0;
      for (const step of input.steps) {
        if (ctx.signal.aborted) throw ctx.signal.reason;
        try {
          const output = await ctx.call(step.action, step.input ?? {}, {
            ...(step.target ? { target: step.target as never } : {}),
            ...(step.timeoutMs !== undefined ? { timeoutMs: step.timeoutMs } : {}),
          });
          results.push({ ok: true, action: step.action, output });
          completed++;
          if (step.pauseMs) await new Promise((r) => setTimeout(r, step.pauseMs));
        } catch (err) {
          const e = ExtensionUseError.from(err);
          if (e.code === "BLOCKED_BY_POLICY" && /paused/i.test(e.message)) throw e; // the kill switch stops everything
          results.push({ ok: false, action: step.action, error: { code: e.code, message: e.message } });
          if ((step.onError ?? input.onError) === "stop") break;
        }
      }
      return { completed, ok: results.every((r) => r.ok) && results.length === input.steps.length, results };
    }),
  ],
};

export const tabsGroup: ActionGroup = {
  name: "tabs",
  permissions: ["tabs"],
  needsHostAccess: false,
  actions: [
    bg("tabs.list", async (input, ctx) => {
      const query: chrome.tabs.QueryInfo = {};
      if (input.currentWindow) {
        if (ctx.session.windowId !== undefined) query.windowId = ctx.session.windowId;
        else query.lastFocusedWindow = true;
      }
      const tabs = await chrome.tabs.query(query);
      return {
        tabs: tabs.map(toTabInfo).filter((t) => !input.urlMatch || matchPattern(input.urlMatch, t.url)),
      };
    }),
    bg("tabs.open", async (input, ctx) => {
      checkUrl(ctx, input.url);
      const props: chrome.tabs.CreateProperties = { url: input.url, active: input.active };
      if (ctx.session.windowId !== undefined) props.windowId = ctx.session.windowId;
      const tab = await chrome.tabs.create(props);
      return toTabInfo(input.waitForLoad && tab.id !== undefined ? await waitForLoad(tab.id, ctx.signal, { notBlank: true }) : tab);
    }),
    bg("tabs.close", async (input, ctx) => {
      const tab = await chrome.tabs.get(input.tabId).catch(() => {
        throw new ExtensionUseError("TARGET_NOT_FOUND", `No tab ${input.tabId}`);
      });
      assertMayClose(ctx, tab.url ?? "");
      await chrome.tabs.remove(input.tabId);
      return {};
    }),
    bg("tabs.activate", async (input) => {
      const tab = await chrome.tabs.update(input.tabId, { active: true }).catch(() => {
        throw new ExtensionUseError("TARGET_NOT_FOUND", `No tab ${input.tabId}`);
      });
      if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
      return toTabInfo(tab!);
    }),
    bg("tabs.navigate", async (input, ctx) => {
      checkUrl(ctx, input.url);
      const { tabId } = await ctx.tab();
      return toTabInfo(await navigateAndWait(tabId, () => chrome.tabs.update(tabId, { url: input.url }), ctx.signal, input.waitForLoad));
    }),
    bg("tabs.reload", async (input, ctx) => {
      const { tabId } = await ctx.tab();
      return toTabInfo(await navigateAndWait(tabId, () => chrome.tabs.reload(tabId), ctx.signal, input.waitForLoad));
    }),
    bg("tabs.waitForLoad", async (_input, ctx) => {
      const { tabId } = await ctx.tab();
      return toTabInfo(await waitForLoad(tabId, ctx.signal));
    }),
    bg("tabs.goBack", (input, ctx) => historyStep(ctx, "back", input.waitForLoad)),
    bg("tabs.goForward", (input, ctx) => historyStep(ctx, "forward", input.waitForLoad)),
    bg("tabs.update", async (input, ctx) => {
      const { tabId } = await ctx.tab();
      const props: chrome.tabs.UpdateProperties = {};
      if (input.pinned !== undefined) props.pinned = input.pinned;
      if (input.muted !== undefined) props.muted = input.muted;
      if (input.autoDiscardable !== undefined) props.autoDiscardable = input.autoDiscardable;
      if (Object.keys(props).length) await chrome.tabs.update(tabId, props);
      if (input.zoom !== undefined) await chrome.tabs.setZoom(tabId, input.zoom);
      const t = await chrome.tabs.get(tabId);
      return {
        ...toTabInfo(t),
        pinned: t.pinned,
        muted: t.mutedInfo?.muted ?? false,
        zoom: await chrome.tabs.getZoom(tabId),
        autoDiscardable: t.autoDiscardable,
      };
    }),
  ],
};

async function getWindow(windowId: number) {
  return chrome.windows.get(windowId, { populate: true }).catch(() => {
    throw new ExtensionUseError("TARGET_NOT_FOUND", `No window ${windowId}`);
  });
}

const BOUNDS = ["left", "top", "width", "height"] as const;

export const windowsGroup: ActionGroup = {
  name: "windows",
  permissions: [],
  needsHostAccess: false,
  actions: [
    bg("windows.list", async () => {
      const wins = await chrome.windows.getAll({ populate: true, windowTypes: ["normal", "popup"] });
      return { windows: wins.map(toWindowInfo) };
    }),
    bg("windows.open", async (input, ctx) => {
      if (input.url) checkUrl(ctx, input.url);
      const data: chrome.windows.CreateData = { focused: input.focused, type: input.type };
      if (input.url) data.url = input.url;
      for (const k of BOUNDS) if (input[k] !== undefined) data[k] = input[k];
      const created = await chrome.windows.create(data).catch((err: unknown) => {
        throw new ExtensionUseError("INVALID_INPUT", String((err as Error)?.message ?? err));
      });
      if (created?.id === undefined) throw new ExtensionUseError("INTERNAL", "The window was not created");
      let tab = created.tabs?.[0];
      if (tab?.id !== undefined && input.url && input.waitForLoad) tab = await waitForLoad(tab.id, ctx.signal, { notBlank: true });
      const win = await getWindow(created.id);
      return { ...toWindowInfo(win), ...(tab ? { tab: toTabInfo(tab) } : {}) };
    }),
    bg("windows.update", async (input) => {
      await getWindow(input.windowId);
      const info: chrome.windows.UpdateInfo = {};
      if (input.focused !== undefined) info.focused = input.focused;
      if (input.state !== undefined) info.state = input.state;
      for (const k of BOUNDS) if (input[k] !== undefined) info[k] = input[k];
      await chrome.windows.update(input.windowId, info).catch((err: unknown) => {
        throw new ExtensionUseError("INVALID_INPUT", String((err as Error)?.message ?? err));
      });
      return toWindowInfo(await getWindow(input.windowId));
    }),
    bg("windows.close", async (input, ctx) => {
      const win = await getWindow(input.windowId);
      for (const t of win.tabs ?? []) assertMayClose(ctx, t.url ?? t.pendingUrl ?? "");
      await chrome.windows.remove(input.windowId);
      return {};
    }),
  ],
};

export const captureGroup: ActionGroup = {
  name: "capture",
  permissions: [],
  needsHostAccess: true,
  actions: [
    bg("capture.screenshot", async (input, ctx) => {
      const tab = await ctx.tab();
      const opts = { format: input.format, ...(input.quality !== undefined ? { quality: input.quality } : {}) };
      const dataUrl = await withShooter(ctx, tab, (shooter) => shooter.shoot(opts));
      const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());

      if (!input.locator) {
        const out = { dataUrl, width: bitmap.width, height: bitmap.height };
        bitmap.close();
        return out;
      }

      const [{ elements }, page] = await Promise.all([
        ctx.callContent<{ elements: { box: { x: number; y: number; width: number; height: number } }[] }>("dom.query", { locator: input.locator }),
        ctx.callContent<{ viewport: { width: number } }>("page.info", {}),
      ]);
      const box = elements[0]?.box;
      if (!box) throw new ExtensionUseError("ELEMENT_NOT_FOUND", "Element not found");
      const scale = bitmap.width / page.viewport.width;
      const sx = Math.max(0, Math.round(box.x * scale));
      const sy = Math.max(0, Math.round(box.y * scale));
      const sw = Math.max(1, Math.min(bitmap.width - sx, Math.round(box.width * scale)));
      const sh = Math.max(1, Math.min(bitmap.height - sy, Math.round(box.height * scale)));
      const canvas = new OffscreenCanvas(sw, sh);
      canvas.getContext("2d")!.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
      bitmap.close();
      const blob = await canvas.convertToBlob({
        type: input.format === "jpeg" ? "image/jpeg" : "image/png",
        ...(input.quality !== undefined ? { quality: input.quality / 100 } : {}),
      });
      return { dataUrl: await blobToDataUrl(blob), width: sw, height: sh };
    }),
    bg("capture.fullPage", async (input, ctx) => {
      const tab = await ctx.tab();
      type PageInfo = { viewport: { width: number; height: number }; scroll: { x: number; y: number }; document: { height: number } };
      const page = await ctx.callContent<PageInfo>("page.info", {});
      const vh = page.viewport.height;
      let total = Math.min(page.document.height, input.maxHeight);
      let truncated = page.document.height > input.maxHeight;
      let canvas: OffscreenCanvas | undefined;
      let lastShot = 0;
      await withShooter(ctx, tab, async (shooter) => {
        try {
          for (let y = 0; y < total; y += vh) {
            if (ctx.signal.aborted) throw ctx.signal.reason;
            const { scroll } = await ctx.callContent<{ scroll: { x: number; y: number } }>("page.scroll", { x: 0, y });
            // Let the page repaint; captureVisibleTab also allows only 2 calls a second.
            await sleep(Math.max(120, lastShot + shooter.minGapMs - Date.now()));
            const shot = await shooter.shoot({ format: "png" });
            lastShot = Date.now();
            const bitmap = await createImageBitmap(await (await fetch(shot)).blob());
            const scale = bitmap.width / page.viewport.width;
            if (!canvas) {
              // Canvases top out around 32k pixels per side.
              const maxCss = Math.floor(32_000 / scale);
              if (total > maxCss) {
                total = maxCss;
                truncated = true;
              }
              canvas = new OffscreenCanvas(bitmap.width, Math.round(total * scale));
            }
            canvas.getContext("2d")!.drawImage(bitmap, 0, Math.round(scroll.y * scale));
            bitmap.close();
            if (scroll.y + vh >= total) break;
          }
        } finally {
          await ctx.callContent("page.scroll", { x: page.scroll.x, y: page.scroll.y }).catch(() => {});
        }
      });
      if (!canvas) throw new ExtensionUseError("INTERNAL", "Nothing was captured");
      const blob = await canvas.convertToBlob({
        type: input.format === "jpeg" ? "image/jpeg" : "image/png",
        ...(input.quality !== undefined ? { quality: input.quality / 100 } : {}),
      });
      return { dataUrl: await blobToDataUrl(blob), width: canvas.width, height: canvas.height, truncated };
    }),
  ],
};

interface Shooter {
  shoot(opts: { format: "png" | "jpeg"; quality?: number }): Promise<string>;
  /** Least time between two shots. */
  minGapMs: number;
}

/**
 * Screenshots of the tab in front of a window use captureVisibleTab. Chrome
 * doesn't paint a tab in the background (or in a minimized window), so those
 * go through tab capture, which keeps it rendering for as long as it runs.
 */
async function withShooter<T>(ctx: ActionContext, tab: ResolvedTab, fn: (shooter: Shooter) => Promise<T>): Promise<T> {
  const info = await chrome.tabs.get(tab.tabId);
  const win = await chrome.windows.get(info.windowId).catch(() => undefined);
  if (info.active && win?.state !== "minimized") {
    return fn({ shoot: (opts) => captureWithRetry(tab.windowId, opts, ctx.signal), minGapMs: 550 });
  }
  if (!tabCaptureAvailable()) {
    if (info.active) throw new ExtensionUseError("TARGET_NOT_FOUND", "The window is minimized. Restore it (windows.update), or enable the tabCapture group to capture tabs Chrome isn't showing");
    throw new ExtensionUseError("TARGET_NOT_FOUND", "The tab is in the background. Bring it to the front (tabs.activate), or enable the tabCapture group to capture background tabs");
  }
  return withCapture(tab.tabId, await viewportSize(ctx, info), () =>
    fn({ shoot: async (opts) => (await captureFrame(tab.tabId, opts)).dataUrl, minGapMs: 0 }),
  );
}

/** The tab's viewport in device pixels, so a capture stream isn't scaled. */
async function viewportSize(ctx: ActionContext, info: chrome.tabs.Tab) {
  try {
    const { viewport } = await ctx.callContent<{ viewport: { width: number; height: number; devicePixelRatio: number } }>("page.info", {});
    return { width: viewport.width * viewport.devicePixelRatio, height: viewport.height * viewport.devicePixelRatio };
  } catch {
    return { width: info.width ?? 1280, height: info.height ?? 800 };
  }
}

/**
 * captureVisibleTab is limited to 2 calls a second, and sometimes fails with a
 * transient "image readback failed". Retry those a couple of times.
 */
async function captureWithRetry(windowId: number, opts: chrome.extensionTypes.ImageDetails, signal: AbortSignal): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await chrome.tabs.captureVisibleTab(windowId, opts);
    } catch (err) {
      const message = String((err as Error)?.message ?? err);
      const rateLimited = /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/i.test(message);
      const transient = rateLimited || /readback failed|Failed to capture tab/i.test(message);
      if (!transient || attempt >= 2 || signal.aborted) throw new ExtensionUseError("INTERNAL", message);
      await new Promise((r) => setTimeout(r, rateLimited ? 550 : 150));
    }
  }
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type};base64,${btoa(binary)}`;
}

export const framesGroup: ActionGroup = {
  name: "frames",
  permissions: ["webNavigation"],
  needsHostAccess: false,
  actions: [
    bg("frames.list", async (_input, ctx) => {
      const { tabId } = await ctx.tab();
      if (!chrome.webNavigation?.getAllFrames) throw new ExtensionUseError("NEEDS_PERMISSION", 'frames.list needs the "webNavigation" permission');
      const frames = (await chrome.webNavigation.getAllFrames({ tabId })) ?? [];
      return { frames: frames.map((f) => ({ frameId: f.frameId, parentFrameId: f.parentFrameId, url: f.url })) };
    }),
  ],
};

/**
 * Keep tabs rendering in the background by capturing them (see tab-capture.ts).
 * Opt-in: it needs "tabCapture" and "offscreen", and an offscreen page.
 */
export const tabCaptureGroup: ActionGroup = {
  name: "tabCapture",
  permissions: ["tabCapture", "offscreen"],
  needsHostAccess: false,
  actions: [
    bg("tabCapture.start", async (_input, ctx) => {
      const tab = await ctx.tab();
      const size = await startCapture(tab.tabId, await viewportSize(ctx, await chrome.tabs.get(tab.tabId)));
      return { tabId: tab.tabId, ...size };
    }),
    bg("tabCapture.stop", async (_input, ctx) => {
      const { tabId } = await ctx.tab();
      return { stopped: await stopCapture(tabId) };
    }),
    bg("tabCapture.list", async () => ({ tabIds: await capturedTabs() })),
  ],
};

// Content groups: declared here, implemented in the content runtime.
function contentGroup(name: string, actions: CoreActionName[]): ActionGroup {
  return { name, permissions: [], needsHostAccess: true, actions: actions.map(content) };
}

export const pageGroup = contentGroup("page", ["page.info", "page.scroll"]);
export const domGroup = contentGroup("dom", [
  "dom.query",
  "dom.text",
  "dom.snapshot",
  "dom.html",
  "dom.click",
  "dom.hover",
  "dom.focus",
  "dom.type",
  "dom.fill",
  "dom.select",
  "dom.check",
  "dom.press",
  "dom.scrollTo",
  "dom.blur",
  "dom.drag",
  "dom.upload",
  "dom.scroll",
  "dom.wheel",
  "dom.selectText",
  "dom.paste",
  "dom.pointer",
]);
export const editGroup = contentGroup("edit", ["edit.setHtml", "edit.setText", "edit.setAttributes", "edit.remove"]);
export const waitGroup = contentGroup("wait", ["wait.for"]);
export const overlayGroup = contentGroup("overlay", ["overlay.highlight", "overlay.clear", "overlay.toast"]);
export const pickerGroup = contentGroup("picker", ["picker.start", "picker.cancel"]);

export const builtinGroups = {
  runtime: runtimeGroup,
  run: runGroup,
  tabs: tabsGroup,
  windows: windowsGroup,
  capture: captureGroup,
  frames: framesGroup,
  page: pageGroup,
  dom: domGroup,
  edit: editGroup,
  wait: waitGroup,
  overlay: overlayGroup,
  picker: pickerGroup,
  tabCapture: tabCaptureGroup,
  downloads: downloadsGroup,
  bookmarks: bookmarksGroup,
  history: historyGroup,
  cookies: cookiesGroup,
} as const;

/**
 * Groups that need permissions or files beyond the defaults; enable them by
 * name. The browser-data groups (downloads, bookmarks, history, cookies) reach
 * the person's data outside any page, so no host gets them by accident.
 */
export const OPT_IN_GROUPS: readonly (keyof typeof builtinGroups)[] = ["tabCapture", "downloads", "bookmarks", "history", "cookies"];

/** The default groups: every built-in group except the opt-in ones. */
export const allBuiltinGroups: ActionGroup[] = Object.entries(builtinGroups)
  .filter(([name]) => !OPT_IN_GROUPS.includes(name as keyof typeof builtinGroups))
  .map(([, g]) => g);
