/**
 * @extension-use/protocol
 *
 * The wire format shared by every transport (frame, page, remote, native).
 * This entry point has no runtime dependencies so clients stay small.
 * Zod schemas for the built-in actions live in `@extension-use/protocol/schemas`.
 */

export const PROTOCOL_VERSION = 1 as const;

/** Marker put on every envelope so bridges can ignore unrelated postMessage traffic. */
export const ENVELOPE_TAG = "extension-use" as const;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const ERROR_CODES = [
  "UNKNOWN_ACTION",
  "INVALID_INPUT",
  "NOT_GRANTED",
  "BLOCKED_BY_POLICY",
  "TARGET_NOT_FOUND",
  "ELEMENT_NOT_FOUND",
  "TIMEOUT",
  "CANCELLED",
  "NEEDS_USER_GESTURE",
  "NEEDS_PERMISSION",
  "TAB_CLOSED",
  "NOT_CONNECTED",
  "DEVICE_OFFLINE",
  "QUOTA_EXCEEDED",
  "PLAN_REQUIRED",
  "UNSUPPORTED_VERSION",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
  data?: unknown;
}

export class ExtensionUseError extends Error {
  readonly code: ErrorCode;
  readonly data?: unknown;

  constructor(code: ErrorCode, message: string, data?: unknown) {
    super(message);
    this.name = "ExtensionUseError";
    this.code = code;
    if (data !== undefined) this.data = data;
  }

  toPayload(): ErrorPayload {
    const payload: ErrorPayload = { code: this.code, message: this.message };
    if (this.data !== undefined) payload.data = this.data;
    return payload;
  }

  static from(err: unknown): ExtensionUseError {
    if (err instanceof ExtensionUseError) return err;
    if (isErrorPayload(err)) return new ExtensionUseError(err.code, err.message, err.data);
    const message = err instanceof Error ? err.message : String(err);
    return new ExtensionUseError("INTERNAL", message);
  }
}

export function isErrorPayload(x: unknown): x is ErrorPayload {
  return (
    typeof x === "object" &&
    x !== null &&
    typeof (x as ErrorPayload).code === "string" &&
    (ERROR_CODES as readonly string[]).includes((x as ErrorPayload).code) &&
    typeof (x as ErrorPayload).message === "string"
  );
}

// ---------------------------------------------------------------------------
// Targets and locators
// ---------------------------------------------------------------------------

/** Glob where `*` matches any run of characters, e.g. `*://*.example.com/*`. */
export type UrlPattern = string;

export interface Target {
  /** Default: the active tab of the controller's window (or the last focused window). */
  tab?: "active" | number | { urlMatch: UrlPattern };
  /** Default: the top frame. */
  frame?: "top" | number;
}

/**
 * How to find an element. Fields combine (all must match). From most to least stable:
 * `ref` (from dom.snapshot / dom.query), `role` + `name`, `testId`, `text`, `css`.
 */
export interface Locator {
  ref?: string;
  role?: string;
  name?: string;
  text?: string;
  testId?: string;
  css?: string;
  /** Pick the nth match (0-based). Default 0. */
  nth?: number;
  /** Match `name` / `text` exactly instead of as a case-insensitive substring. */
  exact?: boolean;
}

// ---------------------------------------------------------------------------
// Handshake
// ---------------------------------------------------------------------------

export type TransportKind = "frame" | "page" | "remote" | "native" | "memory";

export interface ClientInfo {
  name?: string;
  version?: string;
  /** Protocol versions the client understands. */
  protocols: number[];
}

export interface HostInfo {
  id: string;
  name?: string;
  version?: string;
  sdkVersion: string;
  protocol: number;
}

export interface Capability {
  action: string;
  version: number;
  /** Where the action runs: in the extension background or in the page. */
  where: "background" | "content";
}

// ---------------------------------------------------------------------------
// Envelopes
// ---------------------------------------------------------------------------

interface Base {
  /** Always ENVELOPE_TAG. */
  eu: typeof ENVELOPE_TAG;
  v: number;
}

export interface HelloEnvelope extends Base {
  kind: "hello";
  client: ClientInfo;
}

export interface WelcomeEnvelope extends Base {
  kind: "welcome";
  session: string;
  host: HostInfo;
  capabilities: Capability[];
  /** Actions this session may call (after grants). Patterns like `dom.*`. */
  granted: string[];
}

export interface CallEnvelope extends Base {
  kind: "call";
  id: string;
  action: string;
  input: unknown;
  target?: Target;
  timeoutMs?: number;
}

export interface ResultOkEnvelope extends Base {
  kind: "result";
  id: string;
  ok: true;
  output: unknown;
}

export interface ResultErrEnvelope extends Base {
  kind: "result";
  id: string;
  ok: false;
  error: ErrorPayload;
}

export type ResultEnvelope = ResultOkEnvelope | ResultErrEnvelope;

export interface CancelEnvelope extends Base {
  kind: "cancel";
  id: string;
}

export interface SubscribeEnvelope extends Base {
  kind: "subscribe" | "unsubscribe";
  events: string[];
}

export interface EventEnvelope extends Base {
  kind: "event";
  name: string;
  payload: unknown;
  tabId?: number;
  ts: number;
}

export interface ProgressEnvelope extends Base {
  kind: "progress";
  id: string;
  payload: unknown;
}

export interface ByeEnvelope extends Base {
  kind: "bye";
  reason?: string;
}

export type Envelope =
  | HelloEnvelope
  | WelcomeEnvelope
  | CallEnvelope
  | ResultEnvelope
  | CancelEnvelope
  | SubscribeEnvelope
  | EventEnvelope
  | ProgressEnvelope
  | ByeEnvelope;

export type EnvelopeKind = Envelope["kind"];

type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;
export type EnvelopeBody = DistributiveOmit<Envelope, "eu" | "v">;

/** Build an envelope with the tag and current protocol version filled in. */
export function envelope<T extends EnvelopeBody>(body: T): T & Base {
  return { eu: ENVELOPE_TAG, v: PROTOCOL_VERSION, ...body };
}

const KINDS: ReadonlySet<string> = new Set([
  "hello",
  "welcome",
  "call",
  "result",
  "cancel",
  "subscribe",
  "unsubscribe",
  "event",
  "progress",
  "bye",
]);

/** Cheap structural check. Full validation of inputs happens in the host router. */
export function isEnvelope(x: unknown): x is Envelope {
  if (typeof x !== "object" || x === null) return false;
  const e = x as Record<string, unknown>;
  if (e.eu !== ENVELOPE_TAG || typeof e.v !== "number" || typeof e.kind !== "string") return false;
  if (!KINDS.has(e.kind)) return false;
  switch (e.kind) {
    case "call":
      return typeof e.id === "string" && typeof e.action === "string";
    case "result":
      return typeof e.id === "string" && typeof e.ok === "boolean";
    case "cancel":
    case "progress":
      return typeof e.id === "string";
    case "subscribe":
    case "unsubscribe":
      return Array.isArray(e.events);
    case "event":
      return typeof e.name === "string";
    default:
      return true;
  }
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

const patternCache = new Map<string, RegExp>();

/** Glob match where `*` matches any characters. Used for URLs, origins and action grants. */
export function matchPattern(pattern: string, value: string): boolean {
  let re = patternCache.get(pattern);
  if (!re) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    re = new RegExp(`^${escaped}$`, "i");
    patternCache.set(pattern, re);
  }
  return re.test(value);
}

export function matchAny(patterns: readonly string[], value: string): boolean {
  return patterns.some((p) => matchPattern(p, value));
}

// ---------------------------------------------------------------------------
// Typing helpers shared by client and host
// ---------------------------------------------------------------------------

/** Map of action name to its input and output types. */
export type ActionTypeMap = Record<string, { input: unknown; output: unknown }>;

/** Map of event name to its payload type. */
export type EventTypeMap = Record<string, unknown>;

export interface CallOptions {
  target?: Target;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export function randomId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
