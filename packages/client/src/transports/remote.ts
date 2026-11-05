import { ExtensionUseError, ERROR_CODES, isEnvelope, type Envelope, type ErrorCode } from "@extension-use/protocol";
import type { Transport } from "../index.js";

export interface RemoteTransportOptions {
  /** The relay, e.g. "http://127.0.0.1:7777" (local) or "https://relay.example.com". */
  relay: string;
  /** A controller token from the relay (`extension-use-relay token create`). */
  token: string;
  /** Paired device id, or "default" for the most recently connected browser. */
  device?: string;
  /** WebSocket implementation. Default: globalThis.WebSocket (browsers, Node 22+). */
  WebSocket?: typeof globalThis.WebSocket;
}

const asCode = (code: string): ErrorCode => ((ERROR_CODES as readonly string[]).includes(code) ? (code as ErrorCode) : "NOT_CONNECTED");

/** Drive a paired browser through an Extension-use relay. */
export function remote(options: RemoteTransportOptions): Transport {
  let ws: WebSocket | undefined;
  return {
    kind: "remote",
    open(onMessage, onClose) {
      const WS = options.WebSocket ?? globalThis.WebSocket;
      if (!WS) throw new Error("remote(): no WebSocket available. Use Node 22+ or pass { WebSocket }.");
      const base = options.relay.replace(/^http/, "ws").replace(/\/+$/, "");
      const socket = new WS(`${base}/v1/devices/${encodeURIComponent(options.device ?? "default")}/session`);
      ws = socket;

      return new Promise<void>((resolve, reject) => {
        let ready = false;
        socket.addEventListener("open", () => socket.send(JSON.stringify({ t: "auth", token: options.token })));
        socket.addEventListener("message", (e: MessageEvent) => {
          let data: unknown;
          try {
            data = JSON.parse(typeof e.data === "string" ? e.data : String(e.data));
          } catch {
            return;
          }
          const frame = data as { t?: string; code?: string; message?: string };
          if (frame.t === "ready") {
            ready = true;
            resolve();
          } else if (frame.t === "error") {
            const err = new ExtensionUseError(frame.code === "UNAUTHORIZED" ? "NOT_GRANTED" : asCode(frame.code ?? ""), frame.message ?? "Relay error");
            if (!ready) reject(err);
            else onClose(`${err.code}: ${err.message}`);
          } else if (isEnvelope(data)) {
            onMessage(data);
          }
        });
        socket.addEventListener("close", () => {
          if (!ready) reject(new ExtensionUseError("NOT_CONNECTED", `Could not connect to the relay at ${options.relay}`));
          else onClose("DEVICE_OFFLINE: The relay connection closed");
        });
        socket.addEventListener("error", () => {
          /* a close event follows */
        });
      });
    },
    send(env: Envelope) {
      if (ws?.readyState === 1) ws.send(JSON.stringify(env));
    },
    close() {
      ws?.close();
      ws = undefined;
    },
  };
}
