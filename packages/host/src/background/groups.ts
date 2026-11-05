/**
 * Built-in action groups, as seen from the background.
 * Background actions carry their handler here. Content actions are declared
 * here (so the router can validate and route them) and implemented in the
 * content runtime.
 */
import { ExtensionUseError, matchPattern } from "@extension-use/protocol";
import { coreActionSchemas, z, type CoreActionName, type TabInfo } from "@extension-use/protocol/schemas";
import type { ActionContext, ActionDef, ActionGroup } from "../registry.js";

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
  };
}

async function waitForLoad(tabId: number, signal: AbortSignal): Promise<chrome.tabs.Tab> {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === "complete") return tab;
  return new Promise((resolve, reject) => {
    const onUpdated = (id: number, info: { status?: string }, t: chrome.tabs.Tab) => {
      if (id === tabId && info.status === "complete") {
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
      if (t.status === "complete") {
        cleanup();
        resolve(t);
      }
    }, () => {});
  });
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
      return toTabInfo(input.waitForLoad && tab.id !== undefined ? await waitForLoad(tab.id, ctx.signal) : tab);
    }),
    bg("tabs.close", async (input, ctx) => {
      const tab = await chrome.tabs.get(input.tabId).catch(() => {
        throw new ExtensionUseError("TARGET_NOT_FOUND", `No tab ${input.tabId}`);
      });
      ctx.assertAllowedUrl(tab.url ?? "");
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
      await chrome.tabs.update(tabId, { url: input.url });
      return toTabInfo(input.waitForLoad ? await waitForLoad(tabId, ctx.signal) : await chrome.tabs.get(tabId));
    }),
    bg("tabs.reload", async (input, ctx) => {
      const { tabId } = await ctx.tab();
      await chrome.tabs.reload(tabId);
      // reload() resolves before the status flips to "loading"; give it a tick.
      await new Promise((r) => setTimeout(r, 50));
      return toTabInfo(input.waitForLoad ? await waitForLoad(tabId, ctx.signal) : await chrome.tabs.get(tabId));
    }),
    bg("tabs.waitForLoad", async (_input, ctx) => {
      const { tabId } = await ctx.tab();
      return toTabInfo(await waitForLoad(tabId, ctx.signal));
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
      const info = await chrome.tabs.get(tab.tabId);
      if (!info.active) {
        throw new ExtensionUseError("TARGET_NOT_FOUND", "Only the visible tab of a window can be captured; activate it first (tabs.activate)");
      }
      const opts: chrome.extensionTypes.ImageDetails = { format: input.format };
      if (input.quality !== undefined) opts.quality = input.quality;
      const dataUrl = await captureWithRetry(tab.windowId, opts, ctx.signal);
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
  ],
};

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

// Content groups: declared here, implemented in the content runtime.
function contentGroup(name: string, actions: CoreActionName[]): ActionGroup {
  return { name, permissions: [], needsHostAccess: true, actions: actions.map(content) };
}

export const pageGroup = contentGroup("page", ["page.info", "page.scroll"]);
export const domGroup = contentGroup("dom", [
  "dom.query",
  "dom.text",
  "dom.snapshot",
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
export const waitGroup = contentGroup("wait", ["wait.for"]);
export const overlayGroup = contentGroup("overlay", ["overlay.highlight", "overlay.clear", "overlay.toast"]);
export const pickerGroup = contentGroup("picker", ["picker.start", "picker.cancel"]);

export const builtinGroups = {
  runtime: runtimeGroup,
  run: runGroup,
  tabs: tabsGroup,
  capture: captureGroup,
  frames: framesGroup,
  page: pageGroup,
  dom: domGroup,
  wait: waitGroup,
  overlay: overlayGroup,
  picker: pickerGroup,
} as const;

export const allBuiltinGroups: ActionGroup[] = Object.values(builtinGroups);
