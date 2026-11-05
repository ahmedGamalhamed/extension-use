/**
 * @extension-use/client
 *
 *   import { connect } from "@extension-use/client";
 *   import { frame } from "@extension-use/client/frame";
 *
 *   const ext = await connect(frame());
 *   await ext.dom.click({ locator: { role: "button", name: "Save" } });
 */
import {
  ExtensionUseError,
  PROTOCOL_VERSION,
  envelope,
  matchAny,
  randomId,
  type ActionTypeMap,
  type CallOptions,
  type Capability,
  type Envelope,
  type EventTypeMap,
  type HostInfo,
  type ResultEnvelope,
} from "@extension-use/protocol";
import type { CoreActions, CoreEvents } from "@extension-use/protocol/schemas";

export { ExtensionUseError } from "@extension-use/protocol";
export type { CallOptions, Locator, Target, ErrorCode } from "@extension-use/protocol";
export type { CoreActions, CoreEvents, ElementInfo, TabInfo, SnapshotNode } from "@extension-use/protocol/schemas";

// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------

export interface Transport {
  readonly kind: string;
  /** Start listening. Must call `onMessage` for every envelope from the host. */
  open(onMessage: (env: Envelope) => void, onClose: (reason?: string) => void): void | Promise<void>;
  send(env: Envelope): void;
  close(): void;
  /** Resend hello if no welcome arrives within this many ms (frames that load before their bridge). */
  helloRetryMs?: number;
}

// ---------------------------------------------------------------------------
// Typing
// ---------------------------------------------------------------------------

type Fn<I, O> = {} extends I ? (input?: I, options?: CallOptions) => Promise<O> : (input: I, options?: CallOptions) => Promise<O>;

type Namespaces<A extends ActionTypeMap> = keyof A & string extends infer K ? (K extends `${infer N}.${string}` ? N : never) : never;

/** `{ dom: { click: fn, ... }, tabs: { ... } }` derived from `"dom.click"` style names. */
export type ActionNamespaces<A extends ActionTypeMap> = {
  [N in Namespaces<A>]: {
    [K in keyof A & string as K extends `${N}.${infer M}` ? M : never]: Fn<A[K]["input"], A[K]["output"]>;
  };
};

export interface ClientBase<A extends ActionTypeMap, E extends EventTypeMap> {
  readonly host: HostInfo;
  readonly session: string;
  readonly capabilities: Capability[];
  readonly connected: boolean;
  /** Whether the host offers (and this controller may call) an action. */
  has(action: string): boolean;
  call<K extends keyof A & string>(action: K, input?: A[K]["input"], options?: CallOptions): Promise<A[K]["output"]>;
  /** Call any action by name, including host-defined ones not in the type map. */
  callRaw(action: string, input?: unknown, options?: CallOptions): Promise<unknown>;
  on<K extends keyof E & string>(event: K, handler: (payload: E[K], meta: { tabId?: number; ts: number }) => void): () => void;
  on(event: string, handler: (payload: unknown, meta: { tabId?: number; ts: number }) => void): () => void;
  onDisconnect(handler: (reason?: string) => void): () => void;
  close(): void;
}

export type Client<A extends ActionTypeMap = CoreActions, E extends EventTypeMap = CoreEvents> = ClientBase<A, E> & ActionNamespaces<A>;

export interface ConnectOptions {
  /** Shown to the host in the handshake. */
  name?: string;
  version?: string;
  /** How long to wait for the host's welcome. Default 5000 ms. */
  handshakeTimeoutMs?: number;
  /** Default timeout for calls. Default: the host's per-action default. */
  timeoutMs?: number;
  /** Log every envelope to the console. */
  debug?: boolean;
}

// ---------------------------------------------------------------------------
// connect()
// ---------------------------------------------------------------------------

/** Client-side safety net when neither the caller nor the host bound a call. */
const FALLBACK_TIMEOUT_MS = 150_000;
const RESERVED = new Set(["host", "session", "capabilities", "connected", "has", "call", "callRaw", "on", "onDisconnect", "close", "then"]);

export async function connect<A extends ActionTypeMap = CoreActions, E extends EventTypeMap = CoreEvents>(
  transport: Transport,
  options: ConnectOptions = {},
): Promise<Client<A, E>> {
  const log = (...a: unknown[]) => options.debug && console.debug("[extension-use/client]", ...a);
  const pending = new Map<string, { resolve(v: unknown): void; reject(e: unknown): void; timer: ReturnType<typeof setTimeout>; cleanup(): void }>();
  const listeners = new Map<string, Set<(payload: unknown, meta: { tabId?: number; ts: number }) => void>>();
  const disconnectHandlers = new Set<(reason?: string) => void>();
  let connected = false;
  let welcome: Extract<Envelope, { kind: "welcome" }> | undefined;
  let onWelcome: ((w: Extract<Envelope, { kind: "welcome" }>) => void) | undefined;
  let onBye: ((reason?: string) => void) | undefined;

  const send = (env: Envelope) => {
    log("→", env);
    transport.send(env);
  };

  const failAll = (reason?: string) => {
    for (const p of pending.values()) {
      p.cleanup();
      p.reject(new ExtensionUseError("NOT_CONNECTED", reason ?? "Disconnected from the extension"));
    }
    pending.clear();
  };

  const handle = (env: Envelope) => {
    log("←", env);
    switch (env.kind) {
      case "welcome":
        if (!welcome) {
          welcome = env;
          connected = true;
          onWelcome?.(env);
        }
        break;
      case "result": {
        const p = pending.get(env.id);
        if (!p) return;
        pending.delete(env.id);
        p.cleanup();
        const r = env as ResultEnvelope;
        if (r.ok) p.resolve(r.output);
        else p.reject(new ExtensionUseError(r.error.code, r.error.message, r.error.data));
        break;
      }
      case "event":
        for (const [pattern, set] of listeners) {
          if (matchAny([pattern], env.name)) {
            for (const h of set) {
              try {
                h(env.payload, { ts: env.ts, ...(env.tabId !== undefined ? { tabId: env.tabId } : {}) });
              } catch (err) {
                console.error("[extension-use/client] event handler failed", err);
              }
            }
          }
        }
        break;
      case "bye":
        onBye?.(env.reason);
        close(env.reason);
        break;
    }
  };

  function close(reason?: string) {
    if (!connected && !welcome) return;
    connected = false;
    failAll(reason);
    for (const h of disconnectHandlers) h(reason);
  }

  await transport.open(handle, (reason) => {
    onBye?.(reason);
    close(reason);
  });

  const hello = envelope({ kind: "hello", client: { protocols: [PROTOCOL_VERSION], ...(options.name ? { name: options.name } : {}), ...(options.version ? { version: options.version } : {}) } });

  const w = await new Promise<Extract<Envelope, { kind: "welcome" }>>((resolve, reject) => {
    const timeoutMs = options.handshakeTimeoutMs ?? 5000;
    let retry: ReturnType<typeof setInterval> | undefined;
    const timer = setTimeout(() => {
      finish();
      transport.close();
      reject(new ExtensionUseError("NOT_CONNECTED", `No answer from the extension within ${timeoutMs} ms. Is it installed, and is this origin allowed?`));
    }, timeoutMs);
    const finish = () => {
      clearTimeout(timer);
      if (retry) clearInterval(retry);
      onWelcome = undefined;
      onBye = undefined;
    };
    onWelcome = (env) => {
      finish();
      resolve(env);
    };
    onBye = (reason) => {
      finish();
      reject(new ExtensionUseError(reason?.startsWith("UNSUPPORTED_VERSION") ? "UNSUPPORTED_VERSION" : "NOT_CONNECTED", reason ?? "The extension closed the connection"));
    };
    send(hello);
    if (transport.helloRetryMs) retry = setInterval(() => !welcome && send(hello), transport.helloRetryMs);
  });

  const granted = w.granted;

  function callRaw(action: string, input?: unknown, opts: CallOptions = {}): Promise<unknown> {
    if (!connected) return Promise.reject(new ExtensionUseError("NOT_CONNECTED", "Not connected to the extension"));
    const id = randomId();
    const timeoutMs = opts.timeoutMs ?? options.timeoutMs;
    return new Promise((resolve, reject) => {
      if (opts.signal?.aborted) {
        reject(new ExtensionUseError("CANCELLED", "Aborted before sending"));
        return;
      }
      const onAbort = () => {
        send(envelope({ kind: "cancel", id }));
        const p = pending.get(id);
        pending.delete(id);
        p?.cleanup();
        reject(new ExtensionUseError("CANCELLED", "Aborted by caller"));
      };
      const timer = setTimeout(() => {
        pending.delete(id);
        opts.signal?.removeEventListener("abort", onAbort);
        send(envelope({ kind: "cancel", id }));
        reject(new ExtensionUseError("TIMEOUT", `No answer for "${action}"`));
      }, (timeoutMs ?? FALLBACK_TIMEOUT_MS) + 1000);
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      pending.set(id, {
        resolve,
        reject,
        timer,
        cleanup: () => {
          clearTimeout(timer);
          opts.signal?.removeEventListener("abort", onAbort);
        },
      });
      send(
        envelope({
          kind: "call",
          id,
          action,
          input: input ?? {},
          ...(opts.target ? { target: opts.target } : {}),
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        }),
      );
    });
  }

  const base: ClientBase<A, E> = {
    get host() {
      return w.host;
    },
    get session() {
      return w.session;
    },
    get capabilities() {
      return w.capabilities;
    },
    get connected() {
      return connected;
    },
    has(action: string) {
      return w.capabilities.some((c) => c.action === action) && matchAny(granted, action);
    },
    call: ((action: string, input?: unknown, opts?: CallOptions) => callRaw(action, input, opts)) as ClientBase<A, E>["call"],
    callRaw,
    on(event: string, handler: (payload: never, meta: { tabId?: number; ts: number }) => void) {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
        send(envelope({ kind: "subscribe", events: [event] }));
      }
      set.add(handler as (p: unknown, m: { tabId?: number; ts: number }) => void);
      return () => {
        set!.delete(handler as (p: unknown, m: { tabId?: number; ts: number }) => void);
        if (set!.size === 0) {
          listeners.delete(event);
          if (connected) send(envelope({ kind: "unsubscribe", events: [event] }));
        }
      };
    },
    onDisconnect(handler) {
      disconnectHandlers.add(handler);
      return () => disconnectHandlers.delete(handler);
    },
    close() {
      if (connected) send(envelope({ kind: "bye" }));
      close("Closed by client");
      transport.close();
    },
  };

  // `ext.dom.click(...)` → callRaw("dom.click", ...)
  const namespaces = new Map<string, object>();
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (typeof prop !== "string" || RESERVED.has(prop) || prop in target) return Reflect.get(target, prop, receiver);
      let ns = namespaces.get(prop);
      if (!ns) {
        ns = new Proxy(
          {},
          {
            get(_t, method) {
              if (typeof method !== "string" || method === "then") return undefined;
              return (input?: unknown, opts?: CallOptions) => callRaw(`${prop}.${method}`, input, opts);
            },
          },
        );
        namespaces.set(prop, ns);
      }
      return ns;
    },
  }) as Client<A, E>;
}
