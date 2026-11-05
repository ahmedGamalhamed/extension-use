// The action groups this extension offers. Fewer groups means fewer
// permissions in the manifest (build.mjs works them out from this list).
export const GROUPS = ["runtime", "run", "tabs", "frames", "capture", "page", "dom", "wait", "overlay", "picker"] as const;
