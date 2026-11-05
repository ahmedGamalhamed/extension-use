import { isEnvelope, type Envelope } from "@extension-use/protocol";
import type { Transport } from "../index.js";

export interface PageTransportOptions {
  /** The ID of the extension to connect to. */
  extensionId: string;
}

interface MinimalPort {
  postMessage(msg: unknown): void;
  disconnect(): void;
  onMessage: { addListener(cb: (msg: unknown) => void): void };
  onDisconnect: { addListener(cb: () => void): void };
}

/**
 * Use from a normal web page. The extension must list this page's origin in
 * `externally_connectable.matches` and in `controllers.page.origins`.
 */
export function page(options: PageTransportOptions): Transport {
  let port: MinimalPort | undefined;
  return {
    kind: "page",
    open(onMessage, onClose) {
      const runtime = (globalThis as { chrome?: { runtime?: { connect?(id: string): MinimalPort } } }).chrome?.runtime;
      if (!runtime?.connect) {
        throw new Error("page() transport: the extension is not installed, or this origin is not in its externally_connectable list.");
      }
      port = runtime.connect(options.extensionId);
      port.onMessage.addListener((msg) => isEnvelope(msg) && onMessage(msg));
      port.onDisconnect.addListener(() => {
        port = undefined;
        onClose("The extension disconnected");
      });
    },
    send(env: Envelope) {
      port?.postMessage(env);
    },
    close() {
      port?.disconnect();
      port = undefined;
    },
  };
}
