import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomInt } from "node:crypto";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { connect, type Client, type Transport } from "@extension-use/client";
import { ExtensionUseError, envelope, isEnvelope, matchAny, randomId, type Envelope, type ErrorCode } from "@extension-use/protocol";
import { REMOTE_PING_MS, isDeviceFrame, type DeviceFrame, type PairingStart, type PairingStatus } from "@extension-use/protocol/remote";
import { Store } from "./store.js";

export const RELAY_VERSION = "0.1.0";

export interface RelayOptions {
  port?: number;
  /** Default 127.0.0.1: only this machine can reach the relay. */
  host?: string;
  /** JSON file for tokens and paired devices. Omit to keep everything in memory. */
  dataFile?: string;
  /** Called when an extension asks to pair. Approve with relay.approve(code). */
  onPairingRequest?(request: PendingPairing): void;
  /** Log lines (connections, pairings). Default: none. */
  log?(line: string): void;
  /** How long a pairing code stays valid. Default 5 minutes. */
  pairingTtlMs?: number;
}

export interface PendingPairing {
  pairingId: string;
  code: string;
  name: string;
  expiresAt: number;
  remoteAddress: string;
}

interface Pairing extends PendingPairing {
  result?: PairingStatus;
}

interface Controller {
  name: string;
  grants: string[];
  owner: boolean;
}

/** A live device connection: one WebSocket, many controller sessions. */
class DeviceLink {
  readonly sessions = new Map<string, { deliver(env: Envelope): void; ended(reason: string): void }>();
  readonly connectedAt = Date.now();

  constructor(
    readonly id: string,
    readonly name: string,
    private readonly ws: WebSocket,
  ) {}

  send(frame: DeviceFrame) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(frame));
  }

  open(origin: string, label: string, sink: { deliver(env: Envelope): void; ended(reason: string): void }): string {
    const s = randomId();
    this.sessions.set(s, sink);
    this.send({ t: "open", s, origin, label });
    return s;
  }

  close(s: string) {
    if (this.sessions.delete(s)) this.send({ t: "close", s });
  }

  endAll(reason: string) {
    for (const sink of this.sessions.values()) sink.ended(reason);
    this.sessions.clear();
  }

  terminate(code = 4000, reason = "replaced") {
    this.endAll(reason);
    this.ws.close(code, reason);
  }
}

const STATUS_FOR: Partial<Record<ErrorCode | "UNAUTHORIZED", number>> = {
  UNAUTHORIZED: 401,
  NOT_GRANTED: 403,
  BLOCKED_BY_POLICY: 403,
  INVALID_INPUT: 400,
  UNKNOWN_ACTION: 404,
  TARGET_NOT_FOUND: 404,
  ELEMENT_NOT_FOUND: 404,
  DEVICE_OFFLINE: 503,
  NOT_CONNECTED: 503,
  TIMEOUT: 504,
  QUOTA_EXCEEDED: 429,
  NEEDS_USER_GESTURE: 409,
  NEEDS_PERMISSION: 409,
};

export function createRelay(options: RelayOptions = {}) {
  const store = new Store(options.dataFile);
  const log = options.log ?? (() => {});
  const devices = new Map<string, DeviceLink>();
  const pairings = new Map<string, Pairing>();
  const httpClients = new Map<string, Promise<Client>>(); // `${controller}:${deviceId}`
  const pairingTtl = options.pairingTtlMs ?? 5 * 60_000;

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  function resolveDevice(id: string): DeviceLink {
    if (id === "default") {
      const online = [...devices.values()].sort((a, b) => b.connectedAt - a.connectedAt);
      if (online[0]) return online[0];
    } else {
      const d = devices.get(id);
      if (d) return d;
      if (!store.listDevices().some((x) => x.id === id)) throw new ExtensionUseError("TARGET_NOT_FOUND", `No paired device "${id}"`);
    }
    throw new ExtensionUseError("DEVICE_OFFLINE", id === "default" ? "No paired browser is connected" : `Device "${id}" is not connected`);
  }

  /**
   * Per-session view of a token's grants: refuse calls outside them, and narrow
   * what the device reports (the welcome's capabilities, runtime.describe results).
   */
  function controllerFilter(controller: Controller) {
    const describeCalls = new Set<string>();
    const allowed = (action: string) => controller.owner || matchAny(controller.grants, action);
    return {
      /** A denial to send back instead of forwarding, or undefined to forward. */
      outgoing(env: Envelope): Envelope | undefined {
        if (env.kind !== "call") return undefined;
        if (!allowed(env.action)) {
          return envelope({ kind: "result", id: env.id, ok: false, error: { code: "NOT_GRANTED", message: `Token "${controller.name}" may not call "${env.action}"` } });
        }
        if (env.action === "runtime.describe" && !controller.owner) describeCalls.add(env.id);
        return undefined;
      },
      incoming(env: Envelope): Envelope {
        if (controller.owner) return env;
        if (env.kind === "welcome") return { ...env, capabilities: env.capabilities.filter((c) => allowed(c.action)) };
        if (env.kind === "result" && describeCalls.delete(env.id) && env.ok) {
          const out = env.output as { actions?: { name: string }[] };
          if (Array.isArray(out?.actions)) return { ...env, output: { ...out, actions: out.actions.filter((a) => allowed(a.name)) } };
        }
        return env;
      },
    };
  }

  /** A client-side transport over a device session, used for the HTTP and SSE APIs. */
  function sessionTransport(device: DeviceLink, controller: Controller, label: string): Transport {
    let s: string | undefined;
    const filter = controllerFilter(controller);
    return {
      kind: "relay",
      open(onMessage, onClose) {
        s = device.open(`relay:${controller.name}`, label, {
          deliver: (env) => onMessage(filter.incoming(env)),
          ended: (reason) => onClose(reason),
        });
      },
      send(env) {
        const denied = filter.outgoing(env);
        if (denied) return void queueMicrotask(() => device.sessions.get(s!)?.deliver(denied));
        device.send({ t: "msg", s: s!, env });
      },
      close() {
        if (s) device.close(s);
      },
    };
  }

  async function httpClient(controller: Controller, device: DeviceLink): Promise<Client> {
    const key = `${controller.name}:${device.id}:${device.connectedAt}`;
    let client = httpClients.get(key);
    if (!client) {
      client = connect(sessionTransport(device, controller, "http"), { name: `relay-http:${controller.name}`, handshakeTimeoutMs: 10_000 });
      httpClients.set(key, client);
      client.then(
        (c) => c.onDisconnect(() => httpClients.delete(key)),
        () => httpClients.delete(key),
      );
    }
    return client;
  }

  // -------------------------------------------------------------------------
  // Pairing
  // -------------------------------------------------------------------------

  function startPairing(name: string, remoteAddress: string): PairingStart {
    const now = Date.now();
    for (const [id, p] of pairings) if (p.expiresAt < now && !p.result) pairings.set(id, { ...p, result: { status: "expired" } });
    const pending = [...pairings.values()].filter((p) => !p.result);
    if (pending.length >= 10) throw new ExtensionUseError("QUOTA_EXCEEDED", "Too many pairing requests; try again later");
    const raw = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const pairing: Pairing = { pairingId: randomId(), code: `${raw.slice(0, 3)}-${raw.slice(3)}`, name: name.slice(0, 80) || "Browser", expiresAt: now + pairingTtl, remoteAddress };
    pairings.set(pairing.pairingId, pairing);
    log(`pairing request from "${pairing.name}": code ${pairing.code}`);
    options.onPairingRequest?.({ ...pairing });
    return { pairingId: pairing.pairingId, code: pairing.code, expiresAt: pairing.expiresAt };
  }

  function findPending(code: string) {
    const normalized = code.replace(/\D/g, "");
    const p = [...pairings.values()].find((x) => !x.result && x.code.replace(/\D/g, "") === normalized);
    if (!p) throw new ExtensionUseError("TARGET_NOT_FOUND", `No pending pairing with code ${code}`);
    if (p.expiresAt < Date.now()) {
      p.result = { status: "expired" };
      throw new ExtensionUseError("TIMEOUT", `Pairing code ${code} expired`);
    }
    return p;
  }

  function approve(code: string, name?: string): { deviceId: string; name: string } {
    const p = findPending(code);
    const { device, token } = store.addDevice(name ?? p.name);
    p.result = { status: "approved", deviceId: device.id, deviceToken: token, name: device.name };
    log(`paired "${device.name}" as ${device.id}`);
    return { deviceId: device.id, name: device.name };
  }

  function deny(code: string) {
    findPending(code).result = { status: "denied" };
  }

  function pairingStatus(id: string): PairingStatus {
    const p = pairings.get(id);
    if (!p) return { status: "expired" };
    if (p.result) {
      // Hand the device token out once.
      if (p.result.status === "approved") pairings.delete(id);
      return p.result;
    }
    if (p.expiresAt < Date.now()) return { status: "expired" };
    return { status: "pending" };
  }

  // -------------------------------------------------------------------------
  // HTTP
  // -------------------------------------------------------------------------

  const sendJson = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };
  const sendError = (res: ServerResponse, err: unknown) => {
    const e = ExtensionUseError.from(err);
    sendJson(res, STATUS_FOR[e.code] ?? (e.code === "INTERNAL" ? 500 : 422), { ok: false, error: e.toPayload() });
  };
  const unauthorized = (res: ServerResponse) => sendJson(res, 401, { ok: false, error: { code: "UNAUTHORIZED", message: "Missing or unknown token" } });

  async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > 1_000_000) throw new ExtensionUseError("INVALID_INPUT", "Body too large");
      chunks.push(chunk as Buffer);
    }
    if (!chunks.length) return {};
    try {
      const v = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error();
      return v;
    } catch {
      throw new ExtensionUseError("INVALID_INPUT", "Body must be a JSON object");
    }
  }

  function bearer(req: IncomingMessage, url: URL): string | undefined {
    const h = req.headers.authorization;
    if (h?.startsWith("Bearer ")) return h.slice(7).trim();
    // EventSource can't set headers, so the SSE endpoint also takes ?access_token=.
    if (url.pathname.endsWith("/events")) return url.searchParams.get("access_token") ?? undefined;
    return undefined;
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://relay");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = req.method ?? "GET";
    const parts = path.split("/").filter(Boolean); // ["v1", ...]

    // CORS: controllers may be web apps. Tokens are bearer tokens, never cookies.
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "authorization, content-type");
    res.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
    if (method === "OPTIONS") return void res.writeHead(204).end();

    try {
      if (path === "/v1/health") return sendJson(res, 200, { ok: true, version: RELAY_VERSION, devicesOnline: devices.size });

      // Pairing (extension side: no token yet).
      if (path === "/v1/pairings" && method === "POST") {
        const body = await readJson(req);
        return sendJson(res, 200, startPairing(String(body.name ?? "Browser"), req.socket.remoteAddress ?? ""));
      }
      if (parts[0] === "v1" && parts[1] === "pairings" && parts.length === 3 && method === "GET" && parts[2] !== "pending") {
        return sendJson(res, 200, pairingStatus(parts[2]!));
      }

      const token = bearer(req, url);
      const controller = token ? store.controllerFor(token) : undefined;
      if (!controller) return unauthorized(res);
      const ownerOnly = () => {
        if (!controller.owner) throw new ExtensionUseError("NOT_GRANTED", "Only the owner token can do this");
      };

      if (path === "/v1/pairings/pending" && method === "GET") {
        ownerOnly();
        return sendJson(res, 200, [...pairings.values()].filter((p) => !p.result && p.expiresAt > Date.now()).map(({ code, name, expiresAt }) => ({ code, name, expiresAt })));
      }
      if (path === "/v1/pairings/approve" && method === "POST") {
        ownerOnly();
        const body = await readJson(req);
        return sendJson(res, 200, approve(String(body.code ?? ""), typeof body.name === "string" ? body.name : undefined));
      }
      if (path === "/v1/pairings/deny" && method === "POST") {
        ownerOnly();
        deny(String((await readJson(req)).code ?? ""));
        return sendJson(res, 200, { ok: true });
      }

      if (path === "/v1/tokens" && method === "GET") {
        ownerOnly();
        return sendJson(res, 200, store.listTokens());
      }
      if (path === "/v1/tokens" && method === "POST") {
        ownerOnly();
        const body = await readJson(req);
        const grants = Array.isArray(body.grants) ? body.grants.map(String) : ["*"];
        try {
          return sendJson(res, 200, { name: body.name, grants, token: store.createToken(String(body.name ?? ""), grants) });
        } catch (e) {
          throw new ExtensionUseError("INVALID_INPUT", (e as Error).message);
        }
      }
      if (parts[1] === "tokens" && parts.length === 3 && method === "DELETE") {
        ownerOnly();
        return sendJson(res, store.revokeToken(parts[2]!) ? 200 : 404, { ok: true });
      }

      if (path === "/v1/devices" && method === "GET") {
        return sendJson(res, 200, store.listDevices().map((d) => ({ ...d, online: devices.has(d.id) })));
      }
      if (parts[1] === "devices" && parts.length === 3 && method === "DELETE") {
        ownerOnly();
        devices.get(parts[2]!)?.terminate(4001, "unpaired");
        devices.delete(parts[2]!);
        return sendJson(res, store.removeDevice(parts[2]!) ? 200 : 404, { ok: true });
      }

      if (parts[1] === "devices" && parts[3] === "calls" && method === "POST") {
        const body = await readJson(req);
        const action = String(body.action ?? "");
        if (!matchAny(controller.grants, action)) throw new ExtensionUseError("NOT_GRANTED", `Token "${controller.name}" may not call "${action}"`);
        const device = resolveDevice(parts[2]!);
        const client = await httpClient(controller, device);
        const output = await client.callRaw(action, body.input ?? {}, {
          ...(body.target ? { target: body.target as never } : {}),
          ...(typeof body.timeoutMs === "number" ? { timeoutMs: body.timeoutMs } : {}),
        });
        return sendJson(res, 200, { ok: true, output });
      }

      if (parts[1] === "devices" && parts[3] === "events" && method === "GET") {
        const device = resolveDevice(parts[2]!);
        const patterns = (url.searchParams.get("events") ?? "*").split(",").filter(Boolean);
        const client = await connect(sessionTransport(device, controller, "sse"), { name: `relay-sse:${controller.name}` });
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        res.write(`event: ready\ndata: ${JSON.stringify({ device: device.id })}\n\n`);
        for (const p of patterns) {
          client.on(p, (payload, meta) => res.write(`event: ${meta.name}\ndata: ${JSON.stringify({ payload, ts: meta.ts, ...(meta.tabId !== undefined ? { tabId: meta.tabId } : {}) })}\n\n`));
        }
        const keepAlive = setInterval(() => res.write(": ping\n\n"), 15_000);
        const end = () => {
          clearInterval(keepAlive);
          client.close();
        };
        client.onDisconnect(() => res.end());
        req.on("close", end);
        return;
      }

      sendJson(res, 404, { ok: false, error: { code: "UNKNOWN_ACTION", message: `No route ${method} ${path}` } });
    } catch (err) {
      sendError(res, err);
    }
  }

  // -------------------------------------------------------------------------
  // WebSockets
  // -------------------------------------------------------------------------

  const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });

  function firstFrame(ws: WebSocket, timeoutMs = 5000): Promise<DeviceFrame> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("auth timeout")), timeoutMs);
      ws.once("message", (data: RawData) => {
        clearTimeout(timer);
        try {
          const frame = JSON.parse(data.toString());
          if (isDeviceFrame(frame)) resolve(frame);
          else reject(new Error("bad frame"));
        } catch {
          reject(new Error("bad frame"));
        }
      });
    });
  }

  const fail = (ws: WebSocket, code: ErrorCode | "UNAUTHORIZED", message: string) => {
    ws.send(JSON.stringify({ t: "error", code, message } satisfies DeviceFrame));
    ws.close(4401, code);
  };

  async function acceptDevice(ws: WebSocket, remote: string) {
    const frame = await firstFrame(ws).catch(() => undefined);
    const record = frame?.t === "auth" ? store.deviceForToken(frame.token) : undefined;
    if (!record) return fail(ws, "UNAUTHORIZED", "Unknown device token: pair this browser again");

    devices.get(record.id)?.terminate(4000, "replaced by a new connection");
    const link = new DeviceLink(record.id, record.name, ws);
    devices.set(record.id, link);
    store.touchDevice(record.id);
    log(`device online: ${record.name} (${record.id}) from ${remote}`);
    link.send({ t: "ready", deviceId: record.id, name: record.name });

    ws.on("message", (data: RawData) => {
      let f: unknown;
      try {
        f = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!isDeviceFrame(f)) return;
      if (f.t === "ping") link.send({ t: "pong" });
      else if (f.t === "msg" && isEnvelope(f.env)) link.sessions.get(f.s)?.deliver(f.env);
      else if (f.t === "closed") {
        const sink = link.sessions.get(f.s);
        link.sessions.delete(f.s);
        sink?.ended(f.reason ?? "closed by the extension");
      }
    });
    ws.on("close", () => {
      if (devices.get(record.id) === link) devices.delete(record.id);
      link.endAll("The browser disconnected");
      store.touchDevice(record.id);
      log(`device offline: ${record.name} (${record.id})`);
    });
  }

  async function acceptController(ws: WebSocket, deviceId: string) {
    const frame = await firstFrame(ws).catch(() => undefined);
    const controller = frame?.t === "auth" ? store.controllerFor(frame.token) : undefined;
    if (!controller) return fail(ws, "UNAUTHORIZED", "Missing or unknown token");
    let device: DeviceLink;
    try {
      device = resolveDevice(deviceId);
    } catch (err) {
      const e = ExtensionUseError.from(err);
      return fail(ws, e.code, e.message);
    }
    const filter = controllerFilter(controller);
    const s = device.open(`relay:${controller.name}`, "websocket", {
      deliver: (env) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(filter.incoming(env))),
      ended: (reason) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ t: "error", code: "DEVICE_OFFLINE", message: reason } satisfies DeviceFrame));
          ws.close(4503, "device gone");
        }
      },
    });
    ws.send(JSON.stringify({ t: "ready", deviceId: device.id, name: device.name } satisfies DeviceFrame));
    ws.on("message", (data: RawData) => {
      let env: unknown;
      try {
        env = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!isEnvelope(env)) return;
      const denied = filter.outgoing(env);
      if (denied) ws.send(JSON.stringify(denied));
      else device.send({ t: "msg", s, env });
    });
    ws.on("close", () => device.close(s));
  }

  // Detect dead sockets.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      const w = ws as WebSocket & { alive?: boolean };
      if (w.alive === false) w.terminate();
      else {
        w.alive = false;
        w.ping();
      }
    }
  }, REMOTE_PING_MS * 2);
  heartbeat.unref();

  const server: Server = createServer((req, res) => void handle(req, res));
  server.on("upgrade", (req, socket, head) => {
    const path = new URL(req.url ?? "/", "http://relay").pathname;
    const deviceMatch = /^\/v1\/devices\/([\w-]+)\/session$/.exec(path);
    if (path !== "/v1/device" && !deviceMatch) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      (ws as WebSocket & { alive?: boolean }).alive = true;
      ws.on("pong", () => ((ws as WebSocket & { alive?: boolean }).alive = true));
      if (deviceMatch) void acceptController(ws, deviceMatch[1]!);
      else void acceptDevice(ws, req.socket.remoteAddress ?? "");
    });
  });

  return {
    store,
    get ownerToken() {
      return store.ownerToken;
    },
    devicesOnline: () => [...devices.values()].map((d) => ({ id: d.id, name: d.name, sessions: d.sessions.size })),
    pendingPairings: () => [...pairings.values()].filter((p) => !p.result && p.expiresAt > Date.now()).map(({ code, name, expiresAt, pairingId, remoteAddress }) => ({ code, name, expiresAt, pairingId, remoteAddress })),
    approve,
    deny,
    listen(): Promise<{ url: string; port: number }> {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(options.port ?? 7777, options.host ?? "127.0.0.1", () => {
          const addr = server.address();
          const port = typeof addr === "object" && addr ? addr.port : (options.port ?? 7777);
          resolve({ url: `http://${options.host ?? "127.0.0.1"}:${port}`, port });
        });
      });
    },
    async close() {
      clearInterval(heartbeat);
      for (const d of devices.values()) d.terminate(1001, "relay shutting down");
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

export type Relay = ReturnType<typeof createRelay>;
