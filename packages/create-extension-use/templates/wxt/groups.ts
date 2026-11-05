// The action groups this extension offers. Fewer groups means fewer
// permissions: @extension-use/wxt works them out from this list.
export const GROUPS = ["runtime", "tabs", "capture", "page", "dom", "wait", "overlay", "picker"] as const;
