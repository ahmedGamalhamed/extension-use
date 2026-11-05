/**
 * The extension's side of a relay connection, without chrome.* APIs: one
 * outbound WebSocket, controller sessions multiplexed on it, keep-alive pings
 * and reconnects. Chrome wiring (storage, alarms, pairing UI) is in remote.ts.
 */
import { REMOTE_PING_MS, isDeviceFrame, type DeviceFrame } from "@extension-use/protocol/remote";
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
  deviceToken: string;
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
          transport: "remote",
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
      socket = new WS(wsUrl(opts.relay));
    } catch (e) {
      setState({ status: "disconnected", error: String(e) });
      schedule();
      return;
    }
    ws = socket;
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ t: "auth", token: opts.deviceToken, client: { name: "extension" } } satisfies DeviceFrame));
      clearInterval(ping);
      // Traffic every < 30 s keeps an MV3 service worker alive while connected.
      ping = setInterval(() => send({ t: "ping" }), REMOTE_PING_MS);
    });
    socket.addEventListener("message", (e: MessageEvent) => {
      try {
        const frame = JSON.parse(String(e.data));
        if (isDeviceFrame(frame)) onFrame(frame);
      } catch {
        /* ignore */
      }
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
