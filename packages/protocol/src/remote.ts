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
  | { t: "error"; code: ErrorCode | "UNAUTHORIZED"; message: string };

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
