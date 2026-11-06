/** Internal message keys between the background, content runtimes and frame bridges. */
export const FRAME_PORT = "extension-use:frame";
export const CONTENT_MESSAGE = "__extensionUseCall";
export const CONTENT_CANCEL = "__extensionUseCancel";
export const CONTENT_EVENT = "__extensionUseEvent";

export interface BridgeHello {
  type: "bridge-hello";
  origin: string;
  windowId?: number;
}

/** Port the control panel (extension page) opens to the background. */
export const UI_PORT = "extension-use:ui";

export type UiCommand =
  | { cmd: "state" }
  | { cmd: "pause" }
  | { cmd: "resume" }
  | { cmd: "pair"; relay: string; name: string }
  | { cmd: "cancel-pairing" }
  | { cmd: "unpair" }
  | { cmd: "reconnect" }
  | { cmd: "describe" }
  | { cmd: "call"; id: string; action: string; input: unknown; target?: import("@extension-use/protocol").Target };

/** Replies to "describe" and "call" (state updates have no `kind`). */
export type UiReply =
  | { kind: "describe"; actions: { name: string; description: string; where: string; input: Record<string, unknown> }[] }
  | { kind: "call-result"; id: string; ok: true; output: unknown; ms: number }
  | { kind: "call-result"; id: string; ok: false; error: { code: string; message: string }; ms: number };

export interface UiState {
  host: { id: string; name?: string; version?: string };
  paused: boolean;
  sessions: { id: string; transport: string; origin: string }[];
  audit: { ts: number; transport: string; origin: string; action: string; ok: boolean; code?: string; ms: number }[];
  /** Undefined when the host has no `controllers.remote`. */
  remote?: import("./background/remote.js").RemoteUiState;
  error?: string;
}

/** Messages from the background to the offscreen document that holds tab capture streams. */
export const OFFSCREEN_MESSAGE = "__extensionUseOffscreen";

export type OffscreenCommand =
  | { op: "start"; tabId: number; streamId?: string; width?: number; height?: number }
  | { op: "stop"; tabId: number }
  | { op: "list" }
  | { op: "frame"; tabId: number; format: "png" | "jpeg"; quality?: number };

export type OffscreenReply = { ok: true; output: unknown } | { ok: false; error: string };
