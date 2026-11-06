/**
 * The extension's side of a relay connection, without chrome.* APIs: one
 * outbound WebSocket, controller sessions multiplexed on it, keep-alive pings
 * and reconnects. Chrome wiring (storage, alarms, pairing UI) is in remote.ts.
 */
import { REMOTE_PING_MS, agentKeyId, agentNonce, agentProof, isDeviceFrame, sameProof, type DeviceFrame } from "@extension-use/protocol/remote";
import type { Connection, Router } from "./router.js";

export type RemoteStatus = "disconnected" | "connecting" | "connected" | "unauthorized";

export interface RemoteState {
  status: RemoteStatus;
  relay: string;
  deviceId?: string;
  name?: string;
  error?: string;
  sessions: { id: string; origin: string; label?: string }[];
}

export interface RemoteLinkOptions {
  /** Relay base URL, e.g. "http://127.0.0.1:7777". */
  relay: string;
  /** Full WebSocket URL, when it isn't `<relay>/v1/device` (a local agent link). */
  url?: string;
  /** Device token from pairing. Ignored when `agentKey` is set. */
  deviceToken?: string;
  /**
   * Authenticate with the local agent handshake instead of a device token:
   * both sides prove they know this key, and nothing is accepted before the
   * other side's proof checks out.
   */
  agentKey?: string;
  /** Transport name sessions get in the router. Default "remote". */
  transport?: string;
  router: Router;
  /** Action patterns remote controllers may call (the relay may narrow them further per token). */
  grants: string[];
  WebSocket?: typeof globalThis.WebSocket;
  onState?(state: RemoteState): void;
  log?(...args: unknown[]): void;
  /** Reconnect delays in ms. Default 1s, 2s, 5s, 10s, then every 30s. */
  backoff?: number[];
}

export function wsUrl(relay: string) {
  return `${relay.replace(/^http/, "ws").replace(/\/+$/, "")}/v1/device`;
}

export function createRemoteLink(opts: RemoteLinkOptions) {
  const WS = opts.WebSocket ?? globalThis.WebSocket;
  const backoff = opts.backoff ?? [1000, 2000, 5000, 10_000, 30_000];
  const log = opts.log ?? (() => {});
  const sessions = new Map<string, { conn: Connection; origin: string; label?: string }>();
  let ws: WebSocket | undefined;
  let ping: ReturnType<typeof setInterval> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let stopped = true;
  let state: RemoteState = { status: "disconnected", relay: opts.relay, sessions: [] };

  const setState = (patch: Partial<RemoteState>) => {
    state = { ...state, ...patch, sessions: [...sessions.entries()].map(([id, s]) => ({ id, origin: s.origin, ...(s.label ? { label: s.label } : {}) })) };
    opts.onState?.(state);
  };

  const send = (frame: DeviceFrame) => {
    if (ws?.readyState === 1) ws.send(JSON.stringify(frame));
  };

  function closeSessions() {
    for (const s of sessions.values()) s.conn.close();
    sessions.clear();
  }

  function onFrame(frame: DeviceFrame) {
    switch (frame.t) {
      case "ready":
        attempt = 0;
        setState({ status: "connected", deviceId: frame.deviceId, name: frame.name, error: undefined });
        log("relay connected", frame.deviceId);
        break;
      case "open": {
        const conn = opts.router.connect({
          transport: opts.transport ?? "remote",
          origin: frame.origin,
          grants: opts.grants,
          send: (env) => send({ t: "msg", s: frame.s, env }),
        });
        sessions.set(frame.s, { conn, origin: frame.origin, ...(frame.label ? { label: frame.label } : {}) });
        setState({});
        break;
      }
      case "msg":
        sessions.get(frame.s)?.conn.receive(frame.env);
        break;
      case "close": {
        const s = sessions.get(frame.s);
        sessions.delete(frame.s);
        s?.conn.close();
        setState({});
        break;
      }
      case "error":
        log("relay error", frame.code, frame.message);
        if (frame.code === "UNAUTHORIZED") {
          stopped = true;
          setState({ status: "unauthorized", error: frame.message });
        } else setState({ error: frame.message });
        break;
      case "pong":
        break;
    }
  }

  function open() {
    if (stopped || (ws && ws.readyState <= 1)) return;
    clearTimeout(retry);
    setState({ status: "connecting" });
    let socket: WebSocket;
    try {
      socket = new WS(opts.url ?? wsUrl(opts.relay));
    } catch (e) {
      setState({ status: "disconnected", error: String(e) });
      schedule();
      return;
    }
    ws = socket;
    const key = opts.agentKey;
    // With an agent key, the other side is unproven until its challenge checks out.
    let trusted = !key;
    let ourNonce: string | undefined;
    socket.addEventListener("open", () => {
      if (key) {
        ourNonce = agentNonce();
        socket.send(JSON.stringify({ t: "agent-hello", nonce: ourNonce } satisfies DeviceFrame));
      } else {
        socket.send(JSON.stringify({ t: "auth", token: opts.deviceToken ?? "", client: { name: "extension" } } satisfies DeviceFrame));
      }
      clearInterval(ping);
      // Traffic every < 30 s keeps an MV3 service worker alive while connected.
      ping = setInterval(() => send({ t: "ping" }), REMOTE_PING_MS);
    });
    const verify = async (frame: DeviceFrame) => {
      if (frame.t !== "agent-challenge" || !key || !ourNonce || typeof frame.nonce !== "string" || frame.nonce.length < 16) return socket.close();
      const ok = frame.keyId === (await agentKeyId(key)) && sameProof(frame.proof, await agentProof(key, "mcp", ourNonce, frame.nonce));
      if (!ok) {
        setState({ error: "An agent on this computer uses a different key" });
        return socket.close();
      }
      trusted = true;
      if (socket.readyState === 1) socket.send(JSON.stringify({ t: "agent-proof", proof: await agentProof(key, "extension", frame.nonce, ourNonce) } satisfies DeviceFrame));
    };
    let pending = Promise.resolve();
    socket.addEventListener("message", (e: MessageEvent) => {
      let frame: unknown;
      try {
        frame = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (!isDeviceFrame(frame)) return;
      const f = frame;
      // Keep frames in order while the proof is checked (Web Crypto is async).
      pending = pending.then(() => {
        if (ws !== socket) return;
        if (trusted) return onFrame(f);
        if (f.t === "agent-challenge") return verify(f);
        // Anything else before the proof (ready, open, msg...) is refused.
        socket.close();
      }).catch(() => socket.close());
    });
    socket.addEventListener("close", () => {
      if (ws !== socket) return;
      clearInterval(ping);
      ws = undefined;
      closeSessions();
      if (state.status !== "unauthorized") {
        setState({ status: "disconnected" });
        schedule();
      }
    });
    socket.addEventListener("error", () => {
      /* close follows */
    });
  }

  function schedule() {
    if (stopped) return;
    const delay = backoff[Math.min(attempt, backoff.length - 1)]!;
    attempt++;
    retry = setTimeout(open, delay);
  }

  return {
    start() {
      stopped = false;
      open();
    },
    /** Reconnect now (for example when an alarm wakes the service worker). */
    poke() {
      if (stopped) return;
      attempt = 0;
      if (!ws) open();
    },
    stop() {
      stopped = true;
      clearTimeout(retry);
      clearInterval(ping);
      const s = ws;
      ws = undefined;
      s?.close();
      closeSessions();
      setState({ status: "disconnected" });
    },
    get state() {
      return state;
    },
  };
}

export type RemoteLink = ReturnType<typeof createRemoteLink>;
