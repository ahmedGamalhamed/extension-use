/**
 * Tab capture, from the background side.
 *
 * Chrome stops painting a tab that isn't in front: captureVisibleTab can't see
 * it, animation frames pause and timers slow to about once a second. While a
 * tab is being captured, Chrome keeps it rendering at full speed and won't
 * discard it. The capture stream lives in an offscreen document (the service
 * worker can't hold a MediaStream), which also grabs frames for screenshots.
 *
 * Needs the "tabCapture" and "offscreen" permissions (the tabCapture group) and
 * an extension page that calls mountOffscreen() from "@extension-use/host/offscreen",
 * passed to defineHost as `offscreen`.
 */
import { ExtensionUseError } from "@extension-use/protocol";
import { OFFSCREEN_MESSAGE, type OffscreenCommand, type OffscreenReply } from "../wire.js";

let offscreenPath: string | undefined;

/** Called by defineHost with its `offscreen` option. */
export function configureTabCapture(path: string | undefined) {
  offscreenPath = path;
}

export function tabCaptureAvailable(): boolean {
  return !!offscreenPath && !!chrome.tabCapture?.getMediaStreamId && !!chrome.offscreen?.createDocument;
}

function assertAvailable() {
  if (!chrome.tabCapture?.getMediaStreamId || !chrome.offscreen?.createDocument) {
    throw new ExtensionUseError("NEEDS_PERMISSION", 'Tab capture needs the "tabCapture" and "offscreen" permissions (the tabCapture group)');
  }
  if (!offscreenPath) {
    throw new ExtensionUseError(
      "NEEDS_PERMISSION",
      'Tab capture needs an offscreen page: add one that calls mountOffscreen() from "@extension-use/host/offscreen", and pass its path to defineHost as `offscreen`',
    );
  }
}

let creating: Promise<void> | undefined;

async function ensureOffscreen() {
  const url = chrome.runtime.getURL(offscreenPath!);
  const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT" as chrome.runtime.ContextType], documentUrls: [url] });
  if (existing.length) return;
  creating ??= chrome.offscreen
    .createDocument({ url, reasons: ["USER_MEDIA"], justification: "Capture a tab so it keeps rendering in the background, and take screenshots of it" })
    .catch((err: unknown) => {
      // Another call may have created it in the meantime.
      if (!/single offscreen document/i.test(String((err as Error)?.message ?? err))) throw err;
    })
    .finally(() => (creating = undefined));
  await creating;
}

async function send<T>(command: OffscreenCommand): Promise<T> {
  await ensureOffscreen();
  const reply = (await chrome.runtime.sendMessage({ [OFFSCREEN_MESSAGE]: command })) as OffscreenReply | undefined;
  if (!reply) throw new ExtensionUseError("INTERNAL", "The offscreen page did not answer (does it call mountOffscreen()?)");
  if (!reply.ok) throw new ExtensionUseError("INTERNAL", reply.error);
  return reply.output as T;
}

async function hasOffscreen() {
  if (!offscreenPath || !chrome.runtime.getContexts) return false;
  const url = chrome.runtime.getURL(offscreenPath);
  return (await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT" as chrome.runtime.ContextType], documentUrls: [url] })).length > 0;
}

export async function capturedTabs(): Promise<number[]> {
  if (!(await hasOffscreen())) return [];
  return (await send<{ tabIds: number[] }>({ op: "list" })).tabIds;
}

/**
 * Start capturing a tab. `size` is the tab's viewport in device pixels, so the
 * stream matches the page instead of being scaled.
 */
export async function startCapture(tabId: number, size: { width: number; height: number }) {
  assertAvailable();
  // Already captured: the offscreen page returns the running stream's size.
  if ((await capturedTabs()).includes(tabId)) return send<{ width: number; height: number }>({ op: "start", tabId });
  let streamId: string;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    if (/not been invoked/i.test(message)) {
      throw new ExtensionUseError(
        "NEEDS_USER_GESTURE",
        "Chrome lets an extension capture a tab only after the person invoked it there (toolbar button, side panel, shortcut or context menu) since the tab last navigated. Ask them to do that, or bring the tab to the front (tabs.activate).",
      );
    }
    if (/active stream/i.test(message)) throw new ExtensionUseError("INVALID_INPUT", "The tab is already being captured by something else");
    throw new ExtensionUseError("INTERNAL", message);
  }
  const clamp = (n: number) => Math.max(64, Math.min(4096, Math.round(n)));
  return send<{ width: number; height: number }>({ op: "start", tabId, streamId, width: clamp(size.width), height: clamp(size.height) });
}

export async function stopCapture(tabId: number): Promise<boolean> {
  if (!(await hasOffscreen())) return false;
  return (await send<{ stopped: boolean }>({ op: "stop", tabId })).stopped;
}

/** The current frame of a captured tab, as a data URL. */
export function captureFrame(tabId: number, opts: { format: "png" | "jpeg"; quality?: number }) {
  return send<{ dataUrl: string; width: number; height: number }>({ op: "frame", tabId, ...opts });
}

/**
 * Run `fn` while the tab is captured: reuse a capture started with
 * tabCapture.start, or hold a short one for the call.
 */
export async function withCapture<T>(tabId: number, size: { width: number; height: number }, fn: () => Promise<T>): Promise<T> {
  assertAvailable();
  if ((await capturedTabs()).includes(tabId)) return fn();
  await startCapture(tabId, size);
  try {
    return await fn();
  } finally {
    await stopCapture(tabId).catch(() => {});
  }
}
