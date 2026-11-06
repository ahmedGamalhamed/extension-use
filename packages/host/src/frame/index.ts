/**
 * @extension-use/host/frame
 *
 * Runs in an extension page (side panel, popup, options, or an extension page
 * shown as an in-page overlay). Mounts your web app in an iframe and relays
 * protocol messages between it and the background router.
 */
import { ExtensionUseError, envelope, isEnvelope, matchAny, type CallEnvelope, type Envelope } from "@extension-use/protocol";
import { FRAME_PORT, type BridgeHello } from "../wire.js";

type BridgeHandler = (input: unknown, ctx: { userActive: boolean }) => Promise<unknown>;

function permissionSet(input: unknown): chrome.permissions.Permissions {
  const i = (input ?? {}) as { permissions?: unknown; origins?: unknown };
  const strings = (x: unknown) => (Array.isArray(x) && x.every((s) => typeof s === "string") ? (x as string[]) : undefined);
  const permissions = strings(i.permissions);
  const origins = strings(i.origins);
  if ((i.permissions !== undefined && !permissions) || (i.origins !== undefined && !origins)) {
    throw new ExtensionUseError("INVALID_INPUT", "permissions and origins must be arrays of strings");
  }
  if (!permissions?.length && !origins?.length) throw new ExtensionUseError("INVALID_INPUT", "Give permissions or origins");
  // Chrome rejects unknown permission names itself; we only check the shape.
  return { ...(permissions ? { permissions } : {}), ...(origins ? { origins } : {}) } as chrome.permissions.Permissions;
}

/** Built-in bridge actions. Inputs are checked by hand to keep zod out of extension pages. */
export const BRIDGE_ACTIONS: Record<string, BridgeHandler> = {
  "permissions.contains": async (input) => ({ granted: await chrome.permissions.contains(permissionSet(input)) }),
  "permissions.getAll": async () => {
    const all = await chrome.permissions.getAll();
    return { permissions: all.permissions ?? [], origins: all.origins ?? [] };
  },
  "permissions.request": async (input, { userActive }) => {
    const set = permissionSet(input);
    if (!userActive) {
      throw new ExtensionUseError("NEEDS_USER_GESTURE", "Call permissions.request right after the person clicks in your app");
    }
    try {
      return { granted: await chrome.permissions.request(set) };
    } catch (err) {
      const message = String((err as Error)?.message ?? err);
      if (/user gesture/i.test(message)) throw new ExtensionUseError("NEEDS_USER_GESTURE", message);
      throw new ExtensionUseError("NEEDS_PERMISSION", message);
    }
  },
};

export interface FrameBridgeOptions {
  /** The web app to load, e.g. "https://app.example.com/ext". */
  url: string;
  /**
   * Origins allowed to send commands. Default: the origin of `url`.
   * The background checks this again against `controllers.frame.origins`.
   */
  allowedOrigins?: string[];
  /** Where to mount the iframe. Default: document.body. */
  container?: HTMLElement;
  /** Extra iframe attributes, e.g. { allow: "clipboard-write" }. */
  attributes?: Record<string, string>;
  /** Shown if the app has not loaded after `fallbackAfterMs` (default 8000). */
  fallback?: HTMLElement | string;
  fallbackAfterMs?: number;
  /** Run gesture-gated actions (permissions.*) in this page. Default true. */
  bridgeActions?: boolean;
  debug?: boolean;
}

export interface FrameBridge {
  iframe: HTMLIFrameElement;
  /** Reload the app (and start a new session). */
  reload(): void;
  destroy(): void;
}

export function mountFrameBridge(options: FrameBridgeOptions): FrameBridge {
  const appOrigin = new URL(options.url).origin;
  const allowed = options.allowedOrigins ?? [appOrigin];
  const log = (...a: unknown[]) => options.debug && console.debug("[extension-use/frame]", ...a);

  const iframe = document.createElement("iframe");
  iframe.style.cssText = "border:0;width:100%;height:100%;display:block;";
  for (const [k, v] of Object.entries(options.attributes ?? {})) iframe.setAttribute(k, v);
  (options.container ?? document.body).append(iframe);

  let port: chrome.runtime.Port | undefined;
  let frameOrigin: string | undefined;
  let loaded = false;
  let windowId: number | undefined;
  const windowReady = chrome.windows
    ?.getCurrent()
    .then((w) => {
      windowId = w.id;
    })
    .catch(() => {});

  // Actions the bridge runs itself: they need the person's click, which only
  // reaches extension pages (the background never has a user gesture).
  const bridgeActions = options.bridgeActions === false ? {} : BRIDGE_ACTIONS;
  let granted: string[] = [];

  // The background is an MV3 service worker that Chrome stops when idle, which
  // drops the port. The app has no idea, so the bridge keeps what it needs to
  // resume the session on a new port: the app's hello and its subscriptions.
  let clientHello: Envelope | undefined;
  const subscriptions = new Set<string>();
  // Calls sent to the background that have no result yet. They fail fast when the
  // port drops; they are never re-sent, since actions like clicks are not idempotent.
  const inflight = new Set<string>();

  const toFrame = (env: unknown, origin: string) => {
    log("→ frame", env);
    iframe.contentWindow?.postMessage(env, origin);
  };

  /** Open a port to the background. With `resume`, replay the app's hello and subscriptions on it. */
  function openPort(origin: string, resume: boolean) {
    port?.disconnect();
    let p: chrome.runtime.Port;
    try {
      p = chrome.runtime.connect({ name: FRAME_PORT });
    } catch (err) {
      // The extension was reloaded or updated: this page is orphaned until it reloads.
      log("could not connect", err);
      port = undefined;
      return;
    }
    const hello: BridgeHello = { type: "bridge-hello", origin, ...(windowId !== undefined ? { windowId } : {}) };
    p.postMessage(hello);
    let welcomed = false;
    // The app already has a welcome; the one for a resumed session stays here.
    let swallowWelcome = resume;
    p.onMessage.addListener((env: Envelope) => {
      if (env?.kind === "welcome") {
        welcomed = true;
        granted = env.granted;
        if (swallowWelcome) {
          swallowWelcome = false;
          log("resumed session", env.session);
          return;
        }
        const extra = Object.keys(bridgeActions)
          .filter((a) => matchAny(granted, a))
          .map((action) => ({ action, version: 1, where: "bridge" as const }));
        env = { ...env, capabilities: [...env.capabilities, ...extra] };
      } else if (env?.kind === "result") {
        inflight.delete(env.id);
      } else if (env?.kind === "bye") {
        // The session is over for the app too: don't resume it.
        clientHello = undefined;
        subscriptions.clear();
      }
      toFrame(env, origin);
    });
    p.onDisconnect.addListener(() => {
      void chrome.runtime.lastError; // read it so Chrome doesn't log it as unchecked
      if (port !== p) return;
      port = undefined;
      log("port closed");
      for (const id of inflight) {
        toFrame(
          envelope({ kind: "result", id, ok: false, error: { code: "NOT_CONNECTED", message: "The extension's background restarted during this call. Try again." } }),
          origin,
        );
      }
      inflight.clear();
      // Events only reach a live session, so resume now if the app listens for any.
      // Only after a session was really running, so a refused port can't loop.
      if (welcomed && clientHello && subscriptions.size) openPort(origin, true);
    });
    port = p;
    if (resume && clientHello) {
      p.postMessage(clientHello);
      if (subscriptions.size) p.postMessage(envelope({ kind: "subscribe", events: [...subscriptions] }));
    }
  }

  // Messages are handled one after another so the first await can't reorder them.
  let queue: Promise<void> = Promise.resolve();
  const onMessage = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow) return;
    if (!matchAny(allowed, event.origin)) {
      log("rejected message from", event.origin);
      return;
    }
    if (!isEnvelope(event.data)) return;
    const data = event.data;
    const origin = event.origin;
    // Transient activation is time-limited: read it as the message arrives.
    const userActive = navigator.userActivation?.isActive ?? false;
    loaded = true;
    queue = queue.then(async () => {
      log("← frame", data);
      await windowReady;
      if (data.kind === "hello" || frameOrigin !== origin) {
        // A (re)started client, or the frame navigated to another allowed app:
        // start a fresh session pinned to this origin, with nothing to resume.
        frameOrigin = origin;
        clientHello = data.kind === "hello" ? data : undefined;
        subscriptions.clear();
        inflight.clear(); // a restarted client already failed its own pending calls
        openPort(origin, false);
      } else if (!port) {
        // The background stopped since the last message: resume the app's session.
        openPort(origin, true);
      }
      if (data.kind === "call" && Object.hasOwn(bridgeActions, data.action)) {
        void runBridgeAction(data, userActive).then((result) => toFrame(result, origin));
        return;
      }
      if (data.kind === "subscribe") for (const e of data.events) subscriptions.add(e);
      else if (data.kind === "unsubscribe") for (const e of data.events) subscriptions.delete(e);
      if (!port) {
        if (data.kind === "call") {
          toFrame(envelope({ kind: "result", id: data.id, ok: false, error: { code: "NOT_CONNECTED", message: "The extension was reloaded. Reopen this panel." } }), origin);
        }
        return;
      }
      if (data.kind === "call") inflight.add(data.id);
      port.postMessage(data);
    });
  };
  window.addEventListener("message", onMessage);

  async function runBridgeAction(call: CallEnvelope, userActive: boolean): Promise<Envelope> {
    try {
      if (!matchAny(granted, call.action)) throw new ExtensionUseError("NOT_GRANTED", `This controller may not call "${call.action}"`);
      const output = await bridgeActions[call.action]!(call.input ?? {}, { userActive });
      return envelope({ kind: "result", id: call.id, ok: true, output });
    } catch (err) {
      return envelope({ kind: "result", id: call.id, ok: false, error: ExtensionUseError.from(err).toPayload() });
    }
  }

  // Set src only after the listener exists so no early hello is lost.
  iframe.src = options.url;

  let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
  if (options.fallback) {
    fallbackTimer = setTimeout(() => {
      if (loaded) return;
      const node = typeof options.fallback === "string" ? Object.assign(document.createElement("div"), { textContent: options.fallback }) : options.fallback!;
      iframe.replaceWith(node);
    }, options.fallbackAfterMs ?? 8000);
  }

  return {
    iframe,
    reload() {
      port?.disconnect();
      port = undefined;
      clientHello = undefined;
      subscriptions.clear();
      inflight.clear();
      iframe.src = options.url;
    },
    destroy() {
      clearTimeout(fallbackTimer);
      window.removeEventListener("message", onMessage);
      port?.disconnect();
      iframe.remove();
    },
  };
}
