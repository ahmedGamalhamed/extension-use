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
