import type { Envelope } from "@extension-use/protocol";
import type { Transport } from "../index.js";

export interface MemoryServerSide {
  /** Deliver an envelope to the client. */
  send(env: Envelope): void;
  /** Called with every envelope the client sends. */
  onMessage(handler: (env: Envelope) => void): void;
  /** Simulate the host going away. */
  disconnect(reason?: string): void;
}

/**
 * An in-process transport pair, for tests and for hosts that embed a client
 * directly. Messages are delivered asynchronously, like real transports.
 */
export function memoryPair(): { transport: Transport; server: MemoryServerSide } {
  let toClient: ((env: Envelope) => void) | undefined;
  let closeClient: ((reason?: string) => void) | undefined;
  let toServer: ((env: Envelope) => void) | undefined;
  const clone = <T>(x: T): T => structuredClone(x);

  const transport: Transport = {
    kind: "memory",
    open(onMessage, onClose) {
      toClient = onMessage;
      closeClient = onClose;
    },
    send(env) {
      const copy = clone(env);
      queueMicrotask(() => toServer?.(copy));
    },
    close() {
      toClient = undefined;
    },
  };

  const server: MemoryServerSide = {
    send(env) {
      const copy = clone(env);
      queueMicrotask(() => toClient?.(copy));
    },
    onMessage(handler) {
      toServer = handler;
    },
    disconnect(reason) {
      closeClient?.(reason);
    },
  };

  return { transport, server };
}
