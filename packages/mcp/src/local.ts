/**
 * The MCP server's side of a local agent link: listen on 127.0.0.1 and let
 * the extension dial in. No relay, no pairing code: the person copied the
 * agent key out of the extension, and both sides prove they know it.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { Transport } from "@extension-use/client";
import { ExtensionUseError, isEnvelope, randomId, type Envelope } from "@extension-use/protocol";
import { AGENT_PATH, AGENT_PORTS, agentKeyId, agentNonce, agentProof, isDeviceFrame, sameProof, type DeviceFrame } from "@extension-use/protocol/remote";

export interface LocalAgentOptions {
  /** The agent key from the extension's control panel (eu_agent_…). */
  key: string;
  /** Ports to try, in order. Default: AGENT_PORTS. Pass [0] for a random port (tests). */
  ports?: readonly number[];
  /** Default 127.0.0.1. */
  host?: string;
  /** How long an unauthenticated socket may take to finish the handshake. Default 5 s. */
  handshakeTimeoutMs?: number;
  /** Called when a browser connects (after the proof checks out) or disconnects. */
  onBrowser?(connected: boolean): void;
  log?(line: string): void;
}

type Sink = { deliver(env: Envelope): void; ended(reason: string): void };

/** Websites must never reach this socket; extensions (and non-browser clients) may. */
function allowedOrigin(req: IncomingMessage) {
  const origin = req.headers.origin;
  return !origin || /^(chrome-extension|moz-extension|safari-web-extension):\/\//.test(origin);
}

export async function listenForBrowser(options: LocalAgentOptions) {
  const keyId = await agentKeyId(options.key);
  const log = options.log ?? (() => {});
  const handshakeTimeout = options.handshakeTimeoutMs ?? 5000;
  const sessions = new Map<string, Sink>();
  let device: WebSocket | undefined;
  let waiters: (() => void)[] = [];

  const send = (ws: WebSocket | undefined, frame: DeviceFrame) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
  };

  function endSessions(reason: string) {
    for (const sink of sessions.values()) sink.ended(reason);
    sessions.clear();
  }

  function accept(ws: WebSocket) {
    let nonce: string | undefined;
    let theirs: string | undefined;
    let authed = false;
    const timer = setTimeout(() => ws.close(4401, "handshake timeout"), handshakeTimeout);

    ws.on("message", (data: RawData) => {
      let frame: unknown;
      try {
        frame = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!isDeviceFrame(frame)) return;
      if (!authed) return void handshake(frame);
      if (frame.t === "ping") send(ws, { t: "pong" });
      else if (frame.t === "msg" && isEnvelope(frame.env)) sessions.get(frame.s)?.deliver(frame.env);
      else if (frame.t === "closed") {
        const sink = sessions.get(frame.s);
        sessions.delete(frame.s);
        sink?.ended(frame.reason ?? "closed by the extension");
      }
    });

    async function handshake(frame: DeviceFrame) {
      if (frame.t === "agent-hello" && !nonce && typeof frame.nonce === "string" && frame.nonce.length >= 16) {
        theirs = frame.nonce;
        nonce = agentNonce();
        send(ws, { t: "agent-challenge", keyId, nonce, proof: await agentProof(options.key, "mcp", theirs, nonce) });
      } else if (frame.t === "agent-proof" && nonce && theirs) {
        const expected = await agentProof(options.key, "extension", nonce, theirs);
        if (!sameProof(frame.proof, expected)) {
          send(ws, { t: "error", code: "UNAUTHORIZED", message: "Wrong agent key" });
          ws.close(4401, "wrong key");
          return;
        }
        authed = true;
        clearTimeout(timer);
        // One browser per agent key: a new connection replaces the old one.
        if (device && device !== ws) {
          endSessions("replaced by a new browser connection");
          device.close(4000, "replaced");
        }
        device = ws;
        send(ws, { t: "ready", deviceId: `agent-${keyId}`, name: "local agent link" });
        log("browser connected");
        for (const w of waiters.splice(0)) w();
        options.onBrowser?.(true);
      } else {
        ws.close(4400, "unexpected frame");
      }
    }

    ws.on("close", () => {
      clearTimeout(timer);
      if (device !== ws) return;
      device = undefined;
      endSessions("The browser disconnected");
      log("browser disconnected");
      options.onBrowser?.(false);
    });
    ws.on("error", () => {});
  }

  const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });
  const server: Server = createServer((_req, res) => res.writeHead(404).end());
  server.on("upgrade", (req, socket, head) => {
    const path = new URL(req.url ?? "/", "http://local").pathname;
    if (path !== AGENT_PATH || !allowedOrigin(req)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, accept);
  });

  const host = options.host ?? "127.0.0.1";
  const port = await bindFirstFree(server, options.ports ?? AGENT_PORTS, host);
  log(`waiting for the browser on ${host}:${port}`);

  function waitForBrowser(ms: number): Promise<void> {
    if (device) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        waiters = waiters.filter((w) => w !== done);
        reject(
          new ExtensionUseError(
            "NOT_CONNECTED",
            "The browser hasn't connected yet. In the extension's control panel, check that \"Connect an agent\" is on and uses the same key as this server; the browser checks for agents every 30 seconds or so.",
          ),
        );
      }, ms);
      waiters.push(done);
    });
  }

  return {
    port,
    url: `ws://${host}:${port}${AGENT_PATH}`,
    get connected() {
      return Boolean(device);
    },
    waitForBrowser,
    /**
     * A client transport for one controller session. `label` is how the
     * extension lists it ("agent:<label>"), `waitMs` how long to wait for a
     * browser that hasn't connected yet.
     */
    transport(opts: { label?: string; waitMs?: number } = {}): Transport {
      let s: string | undefined;
      let ws: WebSocket | undefined;
      return {
        kind: "agent",
        async open(onMessage, onClose) {
          await waitForBrowser(opts.waitMs ?? 0);
          ws = device;
          s = randomId();
          sessions.set(s, { deliver: onMessage, ended: (reason) => onClose(`DEVICE_OFFLINE: ${reason}`) });
          send(ws, { t: "open", s, origin: `agent:${(opts.label ?? "agent").slice(0, 60)}`, label: "mcp" });
        },
        send(env) {
          if (s) send(ws, { t: "msg", s, env });
        },
        close() {
          if (s && sessions.delete(s)) send(ws, { t: "close", s });
          s = undefined;
        },
      };
    },
    async close() {
      endSessions("The agent's MCP server stopped");
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

export type LocalAgentLink = Awaited<ReturnType<typeof listenForBrowser>>;

async function bindFirstFree(server: Server, ports: readonly number[], host: string): Promise<number> {
  for (const port of ports) {
    const bound = await new Promise<number | undefined>((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException) => {
        server.off("listening", onListening);
        if (err.code === "EADDRINUSE" || err.code === "EACCES") resolve(undefined);
        else reject(err);
      };
      const onListening = () => {
        server.off("error", onError);
        const addr = server.address();
        resolve(typeof addr === "object" && addr ? addr.port : port);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, host);
    });
    if (bound !== undefined) return bound;
  }
  throw new Error(`Ports ${ports.join(", ")} are all in use. Close another agent's extension-use MCP server and try again.`);
}
