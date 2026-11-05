/**
 * @extension-use/host/background
 *
 * Call `defineHost()` once in your extension's service worker.
 */
import { ExtensionUseError, matchAny, matchPattern, type Envelope, type Target } from "@extension-use/protocol";
import type { ActionDef, ActionGroup, ResolvedTab, SessionInfo } from "../registry.js";
import { CONTENT_MESSAGE, CONTENT_EVENT, CONTENT_CANCEL, FRAME_PORT, type BridgeHello } from "../wire.js";
import { allBuiltinGroups } from "./groups.js";
import { createRouter, type AuditEntry, type Policy } from "./router.js";

export { builtinGroups, allBuiltinGroups } from "./groups.js";
export { createRouter, ALWAYS_BLOCKED, SDK_VERSION } from "./router.js";
export type { Router, RouterEnv, RouterOptions, Channel, Connection, AuditEntry, Policy, ContentRequest } from "./router.js";
export { defineAction } from "../registry.js";
export type { ActionDef, ActionGroup, ActionContext, SessionInfo, ResolvedTab } from "../registry.js";

export interface ControllerConfig {
  /** Origins allowed to connect, e.g. ["https://app.example.com", "http://localhost:5173"]. */
  origins: string[];
  /** Action patterns this controller may call. "all" means every action. */
  grants?: "all" | string[];
}

export interface HostOptions {
  id: string;
  name?: string;
  /** Default: the extension's manifest version. */
  version?: string;
  /** Built-in groups to enable. Default: all of them. */
  groups?: ActionGroup[];
  /** Host-defined actions, such as `myapp.saveArticle`. */
  actions?: ActionDef[];
  controllers: {
    /** Web apps loaded in an iframe inside an extension page (side panel, popup...). */
    frame?: ControllerConfig;
    /** Websites that connect directly via `externally_connectable`. */
    page?: ControllerConfig;
  };
  policy?: Policy;
  /**
   * Path of the bundled content script inside the extension (e.g. "content.js").
   * When set, the host injects it into tabs that don't have it yet (needs the
   * "scripting" permission).
   */
  contentScript?: string;
  defaultTimeoutMs?: number;
  onAudit?(entry: AuditEntry): void;
  debug?: boolean;
}

export function defineHost(options: HostOptions) {
  const groups = options.groups ?? allBuiltinGroups;
  const actions = [...groups.flatMap((g) => g.actions), ...(options.actions ?? [])];

  const router = createRouter({
    host: {
      id: options.id,
      ...(options.name ? { name: options.name } : {}),
      version: options.version ?? chrome.runtime.getManifest().version,
    },
    actions,
    ...(options.policy ? { policy: options.policy } : {}),
    ...(options.defaultTimeoutMs ? { defaultTimeoutMs: options.defaultTimeoutMs } : {}),
    ...(options.onAudit ? { onAudit: options.onAudit } : {}),
    ...(options.debug ? { debug: options.debug } : {}),
    env: {
      resolveTab,
      async sendToContent(tab, frameId, req) {
        const message = { [CONTENT_MESSAGE]: req };
        let response: unknown;
        try {
          response = await chrome.tabs.sendMessage(tab.tabId, message, { frameId });
        } catch (err) {
          if (!options.contentScript || !isNoReceiver(err)) throw toContentError(err);
          await chrome.scripting.executeScript({ target: { tabId: tab.tabId, frameIds: [frameId] }, files: [options.contentScript] });
          response = await chrome.tabs.sendMessage(tab.tabId, message, { frameId }).catch((e) => {
            throw toContentError(e);
          });
        }
        const r = response as { ok: boolean; output?: unknown; error?: unknown } | undefined;
        if (!r) throw new ExtensionUseError("INTERNAL", "The content runtime did not answer");
        if (!r.ok) throw ExtensionUseError.from(r.error);
        return r.output;
      },
      cancelContent(tab, frameId, callId) {
        chrome.tabs.sendMessage(tab.tabId, { [CONTENT_CANCEL]: callId }, { frameId }).catch(() => {});
      },
    },
  });

  const grantsOf = (c: ControllerConfig) => (c.grants === undefined || c.grants === "all" ? ["*"] : c.grants);

  // Frame transport: the frame bridge in an extension page connects a port.
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== FRAME_PORT) return;
    const cfg = options.controllers.frame;
    const sender = port.sender;
    if (!cfg || sender?.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(""))) {
      port.disconnect();
      return;
    }
    let conn: ReturnType<typeof router.connect> | undefined;
    port.onMessage.addListener((msg: unknown) => {
      if (!conn) {
        const hello = msg as BridgeHello;
        if (hello?.type !== "bridge-hello" || typeof hello.origin !== "string" || !matchAny(cfg.origins, hello.origin)) {
          port.disconnect();
          return;
        }
        conn = router.connect({
          transport: "frame",
          origin: hello.origin,
          grants: grantsOf(cfg),
          ...(typeof hello.windowId === "number" ? { windowId: hello.windowId } : {}),
          send: (env: Envelope) => safePost(port, env),
        });
        return;
      }
      conn.receive(msg);
    });
    port.onDisconnect.addListener(() => conn?.close());
  });

  // Page transport: websites listed in externally_connectable.
  chrome.runtime.onConnectExternal.addListener((port) => {
    const cfg = options.controllers.page;
    const origin = port.sender?.origin ?? (port.sender?.url ? new URL(port.sender.url).origin : "");
    if (!cfg || !origin || !matchAny(cfg.origins, origin)) {
      port.disconnect();
      return;
    }
    const windowId = port.sender?.tab?.windowId;
    const conn = router.connect({
      transport: "page",
      origin,
      grants: grantsOf(cfg),
      ...(windowId !== undefined ? { windowId } : {}),
      send: (env) => safePost(port, env),
    });
    port.onMessage.addListener((msg) => conn.receive(msg));
    port.onDisconnect.addListener(() => conn.close());
  });

  // Events from content runtimes.
  chrome.runtime.onMessage.addListener((msg, sender) => {
    const ev = (msg as Record<string, unknown> | undefined)?.[CONTENT_EVENT] as { name: string; payload: unknown } | undefined;
    if (ev && sender.id === chrome.runtime.id && typeof ev.name === "string") {
      router.emit(ev.name, ev.payload, sender.tab?.id);
    }
    return false;
  });

  // Tab events.
  chrome.tabs.onUpdated.addListener((_id, changes, tab) => {
    if (!("status" in changes || "url" in changes || "title" in changes)) return;
    router.emit(
      "tab.updated",
      {
        tab: { id: tab.id ?? -1, windowId: tab.windowId, url: tab.url ?? "", title: tab.title ?? "", active: tab.active, status: tab.status ?? "unknown" },
        changes,
      },
      tab.id,
    );
  });
  chrome.tabs.onActivated.addListener(({ tabId, windowId }) => router.emit("tab.activated", { tabId, windowId }, tabId));
  chrome.tabs.onRemoved.addListener((tabId) => router.emit("tab.removed", { tabId }, tabId));

  return router;
}

async function resolveTab(target: Target | undefined, session: SessionInfo): Promise<ResolvedTab> {
  const t = target?.tab ?? "active";
  let tab: chrome.tabs.Tab | undefined;

  if (typeof t === "number") {
    tab = await chrome.tabs.get(t).catch(() => undefined);
  } else if (t === "active") {
    const q: chrome.tabs.QueryInfo = { active: true };
    if (session.windowId !== undefined) q.windowId = session.windowId;
    else q.lastFocusedWindow = true;
    [tab] = await chrome.tabs.query(q);
  } else if (typeof t === "object" && typeof t.urlMatch === "string") {
    const all = await chrome.tabs.query({});
    const matches = all.filter((x) => matchPattern(t.urlMatch, x.url ?? ""));
    matches.sort((a, b) => Number(b.active) - Number(a.active) || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
    tab = matches[0];
  }

  if (!tab || tab.id === undefined) throw new ExtensionUseError("TARGET_NOT_FOUND", `No tab matches ${JSON.stringify(t)}`);
  return { tabId: tab.id, windowId: tab.windowId, url: tab.url ?? tab.pendingUrl ?? "" };
}

function isNoReceiver(err: unknown) {
  return /Receiving end does not exist|Could not establish connection/i.test(String((err as Error)?.message ?? err));
}

function toContentError(err: unknown) {
  if (isNoReceiver(err)) {
    return new ExtensionUseError("TARGET_NOT_FOUND", "The page has no Extension-use content runtime (reload the tab, or set `contentScript` in defineHost)");
  }
  if (/No tab with id/i.test(String((err as Error)?.message ?? err))) return new ExtensionUseError("TAB_CLOSED", "The tab was closed");
  return ExtensionUseError.from(err);
}

function safePost(port: chrome.runtime.Port, message: unknown) {
  try {
    port.postMessage(message);
  } catch {
    /* port already closed */
  }
}
