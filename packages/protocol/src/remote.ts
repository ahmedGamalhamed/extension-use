/**
 * Frames between an extension (the "device") and a relay, over one WebSocket
 * that the extension opens. Several controller sessions are multiplexed on it;
 * each carries ordinary protocol envelopes.
 *
 *   extension → relay   { t: "auth", token }            first frame (device token)
 *   relay → extension   { t: "ready", deviceId, name }
 *   relay → extension   { t: "open", s, origin, label }  a controller connected
 *   both directions     { t: "msg", s, env }             an envelope for session s
 *   relay → extension   { t: "close", s }                the controller went away
 *   extension → relay   { t: "closed", s, reason? }      the extension ended the session
 *   both directions     { t: "ping" } / { t: "pong" }    keep-alive (MV3 service workers need traffic every < 30 s)
 *   relay → extension   { t: "error", code, message }    auth failure etc., then the socket closes
 *
 * Controllers that use the relay's WebSocket API send one frame first,
 * { t: "auth", token }, and then plain envelopes.
 */
import type { Envelope, ErrorCode } from "./index.js";

export type DeviceFrame =
  | { t: "auth"; token: string; client?: { name?: string; sdkVersion?: string } }
  | { t: "ready"; deviceId: string; name: string }
  | { t: "open"; s: string; origin: string; label?: string }
  | { t: "msg"; s: string; env: Envelope }
  | { t: "close"; s: string }
  | { t: "closed"; s: string; reason?: string }
  | { t: "ping" }
  | { t: "pong" }
  | { t: "error"; code: ErrorCode | "UNAUTHORIZED"; message: string }
  // Local agent link (see below): a mutual proof of the agent key instead of { t: "auth" }.
  | { t: "agent-hello"; nonce: string }
  | { t: "agent-challenge"; keyId: string; nonce: string; proof: string }
  | { t: "agent-proof"; proof: string };

export function isDeviceFrame(x: unknown): x is DeviceFrame {
  return typeof x === "object" && x !== null && typeof (x as { t?: unknown }).t === "string";
}

/** Interval for keep-alive pings. MV3 service workers stay alive while WebSocket traffic flows at least every 30 s. */
export const REMOTE_PING_MS = 20_000;

/** Pairing, as seen by the extension. */
export interface PairingStart {
  pairingId: string;
  /** Short code the person compares/enters on the relay side, like "482-913". */
  code: string;
  expiresAt: number;
}

export type PairingStatus =
  | { status: "pending" }
  | { status: "approved"; deviceId: string; deviceToken: string; name: string }
  | { status: "denied" | "expired" };

// ---------------------------------------------------------------------------
// Local agent link
//
// No relay: an agent's MCP server (`@extension-use/mcp` with an agent key)
// listens on 127.0.0.1, and the extension dials the known ports itself. The
// person copied the key out of the extension, so there is no pairing code.
// Neither side sends the key: each proves it knows it.
//
//   extension → mcp   { t: "agent-hello", nonce: nE }
//   mcp → extension   { t: "agent-challenge", keyId, nonce: nM, proof: HMAC(key, "mcp|nE|nM") }
//   extension → mcp   { t: "agent-proof", proof: HMAC(key, "extension|nM|nE") }
//   mcp → extension   { t: "ready", … }, then the usual open / msg / close frames
//
// The extension ignores every other frame until the MCP server's proof checks
// out, so a process that doesn't know the key can't open a session.
// ---------------------------------------------------------------------------

/** Ports an agent's MCP server tries, in order; the extension dials all of them. */
export const AGENT_PORTS: readonly number[] = [47821, 47822, 47823, 47824, 47825];
/** WebSocket path of the local agent link. */
export const AGENT_PATH = "/v1/agent";
export const AGENT_KEY_PREFIX = "eu_agent_";

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const subtle = () => {
  const s = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (!s) throw new Error("Web Crypto is not available");
  return s;
};

/** A new agent key: 24 random bytes, base64url, with the eu_agent_ prefix. */
export function newAgentKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${AGENT_KEY_PREFIX}${b64}`;
}

export function isAgentKey(key: string): boolean {
  return new RegExp(`^${AGENT_KEY_PREFIX}[A-Za-z0-9_-]{20,}$`).test(key);
}

export function agentNonce(): string {
  return hex(crypto.getRandomValues(new Uint8Array(16)).buffer as ArrayBuffer);
}

/** Short public id of a key (first 12 hex digits of its SHA-256), so a side can tell which key the other means. */
export async function agentKeyId(key: string): Promise<string> {
  return hex(await subtle().digest("SHA-256", new TextEncoder().encode(key))).slice(0, 12);
}

/** HMAC-SHA256(key, `${role}|${a}|${b}`) in hex. */
export async function agentProof(key: string, role: "mcp" | "extension", a: string, b: string): Promise<string> {
  const k = await subtle().importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await subtle().sign("HMAC", k, new TextEncoder().encode(`${role}|${a}|${b}`)));
}

/** Compare two proofs without an early exit. */
export function sameProof(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
