// The action groups this extension offers. Fewer groups means fewer
// permissions in the manifest (build.mjs works them out from this list).
export const GROUPS = ["runtime", "run", "tabs", "windows", "frames", "capture", "page", "dom", "edit", "wait", "overlay", "picker"] as const;
