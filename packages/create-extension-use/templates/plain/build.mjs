// node build.mjs           build dist/extension and dist/web
// node build.mjs --watch   rebuild on change and serve the web app
import * as esbuild from "esbuild";
import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";

const watch = process.argv.includes("--watch");
const CONTROLLER_URL = process.env.CONTROLLER_URL ?? "{{controllerUrl}}";
const out = "dist/extension";
await mkdir(out, { recursive: true });

const define = {
  CONTROLLER_URL: JSON.stringify(CONTROLLER_URL),
  CONTROLLER_ORIGIN: JSON.stringify(new URL(CONTROLLER_URL).origin),
};
const common = { bundle: true, target: "chrome120", minify: !watch, define, logLevel: "info" };

const contexts = [
  await esbuild.context({ ...common, entryPoints: ["extension/background.ts", "extension/sidepanel.ts"], outdir: out, format: "esm" }),
  await esbuild.context({ ...common, entryPoints: ["extension/content.ts"], outdir: out, format: "iife" }),
];

// Permissions come from the action groups in extension/groups.ts.
const permsBuild = await esbuild.build({
  stdin: {
    contents: `import { builtinGroups } from "@extension-use/host/background";
               import { permissionsFor } from "@extension-use/host/permissions";
               import { GROUPS } from "./extension/groups";
               export default permissionsFor(GROUPS.map((g) => builtinGroups[g]), { sidePanel: true });`,
    resolveDir: ".",
    loader: "ts",
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "neutral",
  logLevel: "warning",
});
const { default: permissions } = await import(`data:text/javascript;base64,${Buffer.from(permsBuild.outputFiles[0].text).toString("base64")}`);
const { key } = JSON.parse(await readFile("extension-key.json", "utf8"));

const manifest = {
  manifest_version: 3,
  name: "{{name}}",
  version: "0.1.0",
  ...(process.env.STORE_BUILD ? {} : { key }), // the Web Store assigns its own ID
  background: { service_worker: "background.js", type: "module" },
  side_panel: { default_path: "sidepanel.html" },
  action: { default_title: "Open {{name}}" },
  content_scripts: [{ matches: permissions.host_permissions.length ? permissions.host_permissions : ["<all_urls>"], js: ["content.js"], run_at: "document_idle", all_frames: true, match_about_blank: true }],
  externally_connectable: { matches: [`${new URL(CONTROLLER_URL).origin}/*`] },
  ...permissions,
};
await writeFile(`${out}/manifest.json`, JSON.stringify(manifest, null, 2));
await copyFile("extension/sidepanel.html", `${out}/sidepanel.html`);

if (watch) {
  for (const ctx of contexts) await ctx.watch();
  spawn(process.execPath, ["web/serve.mjs", "--watch"], { stdio: "inherit" });
  console.log(`\nLoad ${out} in chrome://extensions, then reload it there after background changes.`);
} else {
  for (const ctx of contexts) {
    await ctx.rebuild();
    await ctx.dispose();
  }
  const web = spawn(process.execPath, ["web/serve.mjs"], { stdio: "inherit" });
  await new Promise((resolve, reject) => web.on("exit", (code) => (code ? reject(new Error(`web build failed (${code})`)) : resolve())));
}
