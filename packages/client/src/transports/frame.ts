import { isEnvelope, matchAny, type Envelope } from "@extension-use/protocol";
import type { Transport } from "../index.js";

export interface FrameTransportOptions {
  /**
   * Origins of extension pages allowed to drive this app, e.g.
   * ["chrome-extension://abcdefghijklmnopabcdefghijklmnop"]. Pin your extension
   * IDs in production. Default: any extension origin.
   */
  hostOrigins?: string[];
}

const ANY_EXTENSION = ["chrome-extension://*", "moz-extension://*", "safari-web-extension://*"];

/** Use when this app runs in an iframe mounted by `mountFrameBridge` (side panel, popup...). */
export function frame(options: FrameTransportOptions = {}): Transport {
  const allowed = options.hostOrigins ?? ANY_EXTENSION;
  let hostOrigin: string | undefined;
  let listener: ((e: MessageEvent) => void) | undefined;

  return {
    kind: "frame",
    helloRetryMs: 1000,
    open(onMessage) {
      if (window.parent === window) {
        throw new Error("frame() transport: this page is not inside an iframe. Use page() or open it from the extension.");
      }
      listener = (e: MessageEvent) => {
        if (e.source !== window.parent || !matchAny(allowed, e.origin) || !isEnvelope(e.data)) return;
        if (hostOrigin && e.origin !== hostOrigin) return;
        hostOrigin ??= e.origin; // pin to the first extension that answered
        onMessage(e.data);
      };
      window.addEventListener("message", listener);
    },
    send(env: Envelope) {
      // Until the welcome pins the extension's origin, only hellos are sent, and they carry nothing sensitive.
      if (!hostOrigin && env.kind !== "hello") return;
      window.parent.postMessage(env, hostOrigin ?? "*");
    },
    close() {
      if (listener) window.removeEventListener("message", listener);
    },
  };
}

/** True when this page is running inside an extension frame. */
export function inExtensionFrame(): boolean {
  try {
    return window.parent !== window && /^(chrome|moz|safari-web)-extension:/.test(document.referrer || (window.location.ancestorOrigins?.[0] ?? ""));
  } catch {
    return false;
  }
}
