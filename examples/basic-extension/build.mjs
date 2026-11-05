// Builds the example extension into examples/basic-extension/dist.
//   CONTROLLER_URL=https://my.app/ext node examples/basic-extension/build.mjs
import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "dist");
const controllerUrl = process.env.CONTROLLER_URL ?? "http://localhost:5173/";
const controllerOrigin = new URL(controllerUrl).origin;
const conditions = ["source"];

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

await build({
  entryPoints: {
    background: join(here, "src/background.ts"),
    sidepanel: join(here, "src/sidepanel.ts"),
  },
  outdir: out,
  bundle: true,
  format: "esm",
  target: "chrome120",
  conditions,
  define: { CONTROLLER_URL: JSON.stringify(controllerUrl), CONTROLLER_ORIGIN: JSON.stringify(controllerOrigin) },
  logLevel: "warning",
});
// Content scripts are classic scripts: rebuild that one as an IIFE.
await build({
  entryPoints: [join(here, "src/content.ts")],
  outfile: join(out, "content.js"),
  bundle: true,
  format: "iife",
  target: "chrome120",
  conditions,
  logLevel: "warning",
});

// Work out permissions from the action groups the host enables.
const perms = await build({
  stdin: {
    contents: `import { allBuiltinGroups } from "@extension-use/host/background";
               import { permissionsFor } from "@extension-use/host/permissions";
               export default permissionsFor(allBuiltinGroups, { sidePanel: true });`,
    resolveDir: here,
    loader: "ts",
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "neutral",
  conditions,
  logLevel: "warning",
});
const { default: permissions } = await import(`data:text/javascript;base64,${Buffer.from(perms.outputFiles[0].text).toString("base64")}`);

const { key, id } = JSON.parse(await readFile(join(here, "dev-key.json"), "utf8"));
const manifest = {
  manifest_version: 3,
  name: "Extension-use example",
  version: "0.1.0",
  description: "A minimal Extension-use host: a side panel that loads a web app, which drives the current tab.",
  key,
  background: { service_worker: "background.js", type: "module" },
  side_panel: { default_path: "sidepanel.html" },
  action: { default_title: "Open Extension-use panel" },
  content_scripts: [{ matches: ["<all_urls>"], js: ["content.js"], run_at: "document_idle" }],
  externally_connectable: { matches: [`${controllerOrigin}/*`] },
  ...permissions,
  // Asked for at runtime with permissions.request (from the side panel, after a click).
  optional_permissions: ["bookmarks"],
};
await writeFile(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
await cp(join(here, "sidepanel.html"), join(out, "sidepanel.html"));

console.log(`Built example extension (${id}) → ${out}\n  controller: ${controllerUrl}\n  permissions: ${[...permissions.permissions, ...permissions.host_permissions].join(", ")}`);
