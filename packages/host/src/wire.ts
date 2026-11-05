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
  | { cmd: "reconnect" };

export interface UiState {
  host: { id: string; name?: string; version?: string };
  paused: boolean;
  sessions: { id: string; transport: string; origin: string }[];
  audit: { ts: number; transport: string; origin: string; action: string; ok: boolean; code?: string; ms: number }[];
  /** Undefined when the host has no `controllers.remote`. */
  remote?: import("./background/remote.js").RemoteUiState;
  error?: string;
}
