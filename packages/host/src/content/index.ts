/**
 * @extension-use/host/content
 *
 * Call `startContentRuntime()` in your content script. Pass only the groups
 * you enabled in the background so unused code isn't bundled.
 */
import { ExtensionUseError } from "@extension-use/protocol";
import { CONTENT_CANCEL, CONTENT_EVENT, CONTENT_MESSAGE } from "../wire.js";
import type { ContentRequest } from "../background/router.js";
import type { ContentContext, ContentGroup, ContentHandler } from "./context.js";
import { domContent, pageContent, waitContent } from "./dom.js";
import { overlayContent, pickerContent } from "./overlay.js";

export type { ContentContext, ContentGroup, ContentHandler } from "./context.js";
export { roleOf, nameOf, isVisible } from "./aria.js";
export { resolve as resolveLocator, findAll, describe, refFor, cssPath } from "./locator.js";

export const contentGroups = {
  page: pageContent,
  dom: domContent,
  wait: waitContent,
  overlay: overlayContent,
  picker: pickerContent,
} as const;

export const allContentGroups: ContentGroup[] = Object.values(contentGroups);

export interface ContentRuntimeOptions {
  /** Default: all built-in content groups. */
  groups?: ContentGroup[];
  /** Host-defined content actions. */
  handlers?: Record<string, ContentHandler>;
}

const FLAG = "__extensionUseContentRuntime";

export function startContentRuntime(options: ContentRuntimeOptions = {}) {
  const g = globalThis as Record<string, unknown>;
  if (g[FLAG]) return; // injected twice (manifest + on-demand): keep the first
  g[FLAG] = true;

  const handlers = new Map<string, ContentHandler>();
  for (const group of options.groups ?? allContentGroups) for (const [k, v] of Object.entries(group.handlers)) handlers.set(k, v);
  for (const [k, v] of Object.entries(options.handlers ?? {})) handlers.set(k, v);

  const pending = new Map<string, AbortController>();

  const emit = (name: string, payload: unknown) => {
    chrome.runtime.sendMessage({ [CONTENT_EVENT]: { name, payload } }).catch(() => {});
  };

  chrome.runtime.onMessage.addListener((msg: Record<string, unknown> | undefined, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !msg) return false;

    if (typeof msg[CONTENT_CANCEL] === "string") {
      pending.get(msg[CONTENT_CANCEL] as string)?.abort(new ExtensionUseError("CANCELLED", "Cancelled"));
      return false;
    }

    const req = msg[CONTENT_MESSAGE] as ContentRequest | undefined;
    if (!req) return false;

    const handler = handlers.get(req.action);
    if (!handler) {
      sendResponse({ ok: false, error: { code: "UNKNOWN_ACTION", message: `This page's runtime has no "${req.action}"` } });
      return false;
    }

    const abort = new AbortController();
    pending.set(req.callId, abort);
    const ctx: ContentContext = { signal: abort.signal, timeoutMs: req.timeoutMs, policy: req.policy, emit };

    Promise.resolve()
      .then(() => handler(req.input, ctx))
      .then(
        (output) => sendResponse({ ok: true, output: output ?? {} }),
        (err) => sendResponse({ ok: false, error: ExtensionUseError.from(err).toPayload() }),
      )
      .finally(() => pending.delete(req.callId));
    return true; // async response
  });
}
