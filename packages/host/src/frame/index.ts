/**
 * @extension-use/host/frame
 *
 * Runs in an extension page (side panel, popup, options, or an extension page
 * shown as an in-page overlay). Mounts your web app in an iframe and relays
 * protocol messages between it and the background router.
 */
import { isEnvelope, matchAny } from "@extension-use/protocol";
import { FRAME_PORT, type BridgeHello } from "../wire.js";

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

  function openPort(origin: string) {
    port?.disconnect();
    const p = chrome.runtime.connect({ name: FRAME_PORT });
    const hello: BridgeHello = { type: "bridge-hello", origin, ...(windowId !== undefined ? { windowId } : {}) };
    p.postMessage(hello);
    p.onMessage.addListener((env: unknown) => {
      log("→ frame", env);
      iframe.contentWindow?.postMessage(env, origin);
    });
    p.onDisconnect.addListener(() => {
      if (port === p) port = undefined;
    });
    port = p;
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
    loaded = true;
    queue = queue.then(async () => {
      log("← frame", data);
      // A hello means a (re)started client: give it a fresh session and pin its origin.
      if (data.kind === "hello" || !port || frameOrigin !== origin) {
        await windowReady;
        frameOrigin = origin;
        openPort(origin);
      }
      port!.postMessage(data);
    });
  };
  window.addEventListener("message", onMessage);

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
