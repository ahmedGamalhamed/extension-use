/**
 * The router is the core of a host. It knows nothing about chrome.* APIs:
 * transports hand it a channel, and the environment (tab lookup, content
 * messaging) is injected. This keeps it unit-testable and reusable for the
 * remote relay connection later.
 */
import {
  ExtensionUseError,
  PROTOCOL_VERSION,
  envelope,
  isEnvelope,
  matchAny,
  randomId,
  type CallEnvelope,
  type Capability,
  type Envelope,
  type HostInfo,
  type Target,
} from "@extension-use/protocol";
import type { ActionContext, ActionDef, ResolvedTab, SessionInfo } from "../registry.js";

export const SDK_VERSION = "0.1.0";

/** Pages a controller may never act on, whatever the host's own policy says. */
export const ALWAYS_BLOCKED = [
  "chrome://*",
  "chrome-untrusted://*",
  "edge://*",
  "about:*",
  "chrome-extension://*",
  "moz-extension://*",
  "https://chromewebstore.google.com/*",
  "https://chrome.google.com/webstore*",
  "https://microsoftedge.microsoft.com/addons*",
];

export interface Policy {
  /** Extra URL patterns controllers may not act on. */
  blockedSites?: string[];
  /** What to do with password and payment fields. Default "refuse". */
  sensitiveFields?: "refuse" | "allow";
}

export interface ContentRequest {
  callId: string;
  action: string;
  input: unknown;
  timeoutMs: number;
  policy: { sensitiveFields: "refuse" | "allow" };
  /** The call's target, for hosts and mocks that need it. */
  target?: Target;
  /** Who is calling, so the page can show that it is being controlled. */
  controller?: { transport: string; origin: string };
}

export interface RouterEnv {
  resolveTab(target: Target | undefined, session: SessionInfo): Promise<ResolvedTab>;
  sendToContent(tab: ResolvedTab, frameId: number, req: ContentRequest): Promise<unknown>;
  cancelContent?(tab: ResolvedTab, frameId: number, callId: string): void;
}

export interface AuditEntry {
  ts: number;
  session: string;
  transport: string;
  origin: string;
  action: string;
  tabId?: number;
  ok: boolean;
  code?: string;
  ms: number;
}

export interface RouterOptions {
  host: { id: string; name?: string; version?: string };
  actions: ActionDef[];
  env: RouterEnv;
  policy?: Policy;
  defaultTimeoutMs?: number;
  auditSize?: number;
  onAudit?(entry: AuditEntry): void;
  debug?: boolean;
  /** Called when a controller session opens or closes. */
  onSessionsChange?(sessions: SessionInfo[]): void;
}

export interface Channel {
  transport: string;
  /** Origin of the controller, already verified by the transport. */
  origin: string;
  /** Action patterns this controller may call, e.g. ["*"] or ["dom.*", "tabs.list"]. */
  grants: string[];
  windowId?: number;
  send(env: Envelope): void;
}

export interface Connection {
  receive(message: unknown): void;
  close(): void;
  readonly session: SessionInfo | undefined;
}

interface SessionState {
  info: SessionInfo;
  channel: Channel;
  subscriptions: Set<string>;
  pending: Map<string, AbortController>;
}

export type Router = ReturnType<typeof createRouter>;

export function createRouter(opts: RouterOptions) {
  const actions = new Map<string, ActionDef>();
  for (const def of opts.actions) {
    if (actions.has(def.name)) throw new Error(`Duplicate action "${def.name}"`);
    if (def.schema.where === "background" && !def.handler) throw new Error(`Background action "${def.name}" has no handler`);
    actions.set(def.name, def);
  }

  const policy: Required<Policy> = {
    blockedSites: [...ALWAYS_BLOCKED, ...(opts.policy?.blockedSites ?? [])],
    sensitiveFields: opts.policy?.sensitiveFields ?? "refuse",
  };
  const sessions = new Map<string, SessionState>();
  const auditLog: AuditEntry[] = [];
  const auditSize = opts.auditSize ?? 500;
  let paused = false;

  const hostInfo: HostInfo = {
    id: opts.host.id,
    sdkVersion: SDK_VERSION,
    protocol: PROTOCOL_VERSION,
    ...(opts.host.name ? { name: opts.host.name } : {}),
    ...(opts.host.version ? { version: opts.host.version } : {}),
  };

  const capabilities: Capability[] = [...actions.values()].map((d) => ({
    action: d.name,
    version: d.schema.version,
    where: d.schema.where,
  }));

  const log = (...args: unknown[]) => {
    if (opts.debug) console.debug("[extension-use]", ...args);
  };

  function assertAllowedUrl(url: string) {
    if (matchAny(policy.blockedSites, url)) {
      throw new ExtensionUseError("BLOCKED_BY_POLICY", `Controllers may not act on ${url}`);
    }
  }

  function audit(entry: AuditEntry) {
    auditLog.push(entry);
    if (auditLog.length > auditSize) auditLog.shift();
    opts.onAudit?.(entry);
  }

  function emit(name: string, payload: unknown, tabId?: number) {
    const env = envelope({ kind: "event", name, payload, ts: Date.now(), ...(tabId !== undefined ? { tabId } : {}) });
    for (const s of sessions.values()) {
      if (matchAny([...s.subscriptions], name)) s.channel.send(env);
    }
  }

  interface Invocation {
    id: string;
    action: string;
    input: unknown;
    target?: Target;
    timeoutMs?: number;
    /** Nesting depth: 0 for calls from a controller, 1 inside run.sequence. */
    depth: number;
    parentSignal?: AbortSignal;
  }

  /** The whole pipeline for one call: checks, validation, dispatch, timeout and audit. */
  async function execute(state: SessionState, call: Invocation): Promise<unknown> {
    const started = Date.now();
    const def = actions.get(call.action);
    let tabId: number | undefined;
    const abort = new AbortController();
    const onParentAbort = () => abort.abort(call.parentSignal?.reason);
    if (call.depth === 0) state.pending.set(call.id, abort);
    call.parentSignal?.addEventListener("abort", onParentAbort, { once: true });

    try {
      if (paused) throw new ExtensionUseError("BLOCKED_BY_POLICY", "Control is paused by the person using this browser");
      if (!def) throw new ExtensionUseError("UNKNOWN_ACTION", `Unknown action "${call.action}"`);
      if (!matchAny(state.info.granted, call.action)) {
        throw new ExtensionUseError("NOT_GRANTED", `This controller may not call "${call.action}"`);
      }
      if (call.depth > 0 && def.schema.nestable === false) {
        throw new ExtensionUseError("INVALID_INPUT", `"${call.action}" can't be used inside another action`);
      }

      const parsed = def.schema.input.safeParse(call.input ?? {});
      if (!parsed.success) {
        throw new ExtensionUseError("INVALID_INPUT", parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "), {
          issues: parsed.error.issues,
        });
      }

      const timeoutMs = call.timeoutMs ?? def.schema.timeoutMs ?? opts.defaultTimeoutMs ?? 10_000;
      const frameId = typeof call.target?.frame === "number" ? call.target.frame : 0;

      let tabPromise: Promise<ResolvedTab> | undefined;
      const resolveTab = () => {
        tabPromise ??= opts.env.resolveTab(call.target, state.info).then((t) => {
          assertAllowedUrl(t.url);
          tabId = t.tabId;
          return t;
        });
        return tabPromise;
      };

      const sendContent = async (action: string, input: unknown, callId: string) => {
        const tab = await resolveTab();
        const onAbort = () => opts.env.cancelContent?.(tab, frameId, callId);
        abort.signal.addEventListener("abort", onAbort, { once: true });
        try {
          return await opts.env.sendToContent(tab, frameId, {
            callId,
            action,
            input,
            timeoutMs: Math.max(0, timeoutMs - (Date.now() - started) - 50),
            policy: { sensitiveFields: policy.sensitiveFields },
            ...(call.target ? { target: call.target } : {}),
            controller: { transport: state.info.transport, origin: state.info.origin },
          });
        } finally {
          abort.signal.removeEventListener("abort", onAbort);
        }
      };

      const ctx: ActionContext = {
        session: state.info,
        host: opts.host,
        target: call.target,
        signal: abort.signal,
        timeoutMs,
        tab: resolveTab,
        callContent: async <O>(action: string, input: unknown) => {
          const inner = actions.get(action);
          if (!inner || inner.schema.where !== "content") throw new ExtensionUseError("UNKNOWN_ACTION", `No content action "${action}"`);
          const p = inner.schema.input.parse(input ?? {});
          return (await sendContent(action, p, randomId())) as O;
        },
        call: (action, input, options = {}) =>
          execute(state, {
            id: randomId(),
            action,
            input,
            depth: call.depth + 1,
            parentSignal: abort.signal,
            ...((options.target ?? call.target) ? { target: options.target ?? call.target } : {}),
            ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
          }),
        listActions: () => [...actions.values()].filter((d) => matchAny(state.info.granted, d.name)),
        assertAllowedUrl,
        emit,
      };

      const work =
        def.schema.where === "content"
          ? sendContent(def.name, parsed.data, call.id)
          : Promise.resolve().then(() => def.handler!(parsed.data, ctx));

      const output = (await withTimeout(work, timeoutMs, abort)) ?? {};
      audit({ ts: started, session: state.info.id, transport: state.info.transport, origin: state.info.origin, action: call.action, ...(tabId !== undefined ? { tabId } : {}), ok: true, ms: Date.now() - started });
      return output;
    } catch (err) {
      const e = ExtensionUseError.from(err);
      log("call failed", call.action, e.code, e.message);
      audit({ ts: started, session: state.info.id, transport: state.info.transport, origin: state.info.origin, action: call.action, ...(tabId !== undefined ? { tabId } : {}), ok: false, code: e.code, ms: Date.now() - started });
      throw e;
    } finally {
      call.parentSignal?.removeEventListener("abort", onParentAbort);
      if (call.depth === 0) state.pending.delete(call.id);
    }
  }

  async function runCall(state: SessionState, call: CallEnvelope) {
    try {
      const output = await execute(state, {
        id: call.id,
        action: call.action,
        input: call.input,
        depth: 0,
        ...(call.target ? { target: call.target } : {}),
        ...(call.timeoutMs !== undefined ? { timeoutMs: call.timeoutMs } : {}),
      });
      state.channel.send(envelope({ kind: "result", id: call.id, ok: true, output }));
    } catch (err) {
      state.channel.send(envelope({ kind: "result", id: call.id, ok: false, error: ExtensionUseError.from(err).toPayload() }));
    }
  }

  function connect(channel: Channel): Connection {
    let state: SessionState | undefined;

    const conn: Connection = {
      get session() {
        return state?.info;
      },
      receive(message: unknown) {
        if (!isEnvelope(message)) {
          log("dropped non-envelope message", message);
          return;
        }
        const msg = message;
        if (msg.kind === "hello") {
          if (!msg.client?.protocols?.includes(PROTOCOL_VERSION)) {
            channel.send(envelope({ kind: "bye", reason: `UNSUPPORTED_VERSION: host speaks protocol ${PROTOCOL_VERSION}` }));
            return;
          }
          if (state) closeSession(state);
          const granted = channel.grants.length ? channel.grants : [];
          state = {
            info: {
              id: randomId(),
              transport: channel.transport,
              origin: channel.origin,
              granted,
              ...(channel.windowId !== undefined ? { windowId: channel.windowId } : {}),
            },
            channel,
            subscriptions: new Set(),
            pending: new Map(),
          };
          sessions.set(state.info.id, state);
          opts.onSessionsChange?.([...sessions.values()].map((s) => s.info));
          log("session opened", state.info);
          channel.send(
            envelope({
              kind: "welcome",
              session: state.info.id,
              host: hostInfo,
              capabilities: capabilities.filter((c) => matchAny(granted, c.action)),
              granted,
            }),
          );
          return;
        }

        if (!state) {
          if (msg.kind === "call") {
            channel.send(envelope({ kind: "result", id: msg.id, ok: false, error: { code: "NOT_CONNECTED", message: "Send hello first" } }));
          }
          return;
        }

        switch (msg.kind) {
          case "call":
            void runCall(state, msg);
            break;
          case "cancel":
            state.pending.get(msg.id)?.abort(new ExtensionUseError("CANCELLED", "Cancelled by controller"));
            break;
          case "subscribe":
            for (const e of msg.events) state.subscriptions.add(e);
            break;
          case "unsubscribe":
            for (const e of msg.events) state.subscriptions.delete(e);
            break;
          case "bye":
            closeSession(state);
            state = undefined;
            break;
          default:
            log("ignored envelope", msg.kind);
        }
      },
      close() {
        if (state) closeSession(state);
        state = undefined;
      },
    };
    return conn;
  }

  function closeSession(state: SessionState) {
    for (const a of state.pending.values()) a.abort(new ExtensionUseError("CANCELLED", "Session closed"));
    sessions.delete(state.info.id);
    opts.onSessionsChange?.([...sessions.values()].map((s) => s.info));
    log("session closed", state.info.id);
  }

  return {
    connect,
    emit,
    capabilities: () => capabilities,
    sessions: () => [...sessions.values()].map((s) => s.info),
    audit: () => [...auditLog],
    /** Kill switch: reject every call until resumed. */
    pause() {
      paused = true;
      for (const s of sessions.values()) for (const a of s.pending.values()) a.abort(new ExtensionUseError("BLOCKED_BY_POLICY", "Control was paused"));
    },
    resume() {
      paused = false;
    },
    get paused() {
      return paused;
    },
    assertAllowedUrl,
  };
}

function withTimeout<T>(work: Promise<T>, ms: number, abort: AbortController): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const e = new ExtensionUseError("TIMEOUT", `Timed out after ${ms} ms`);
      abort.abort(e);
      reject(e);
    }, ms);
    abort.signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(abort.signal.reason ?? new ExtensionUseError("CANCELLED", "Cancelled"));
      },
      { once: true },
    );
    work.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
