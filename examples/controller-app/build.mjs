import { build } from "esbuild";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "dist");
const { id } = JSON.parse(await readFile(join(here, "../basic-extension/dev-key.json"), "utf8"));

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const result = await build({
  entryPoints: [join(here, "src/main.ts")],
  outfile: join(out, "main.js"),
  bundle: true,
  format: "esm",
  target: "es2022",
  conditions: ["source"],
  define: { DEV_EXTENSION_ID: JSON.stringify(id) },
  metafile: true,
  minify: process.env.MINIFY === "1",
  logLevel: "warning",
});
await cp(join(here, "index.html"), join(out, "index.html"));
await cp(join(here, "fixtures"), join(out, "fixtures"), { recursive: true });

const bytes = Object.values(result.metafile.outputs)[0].bytes;
console.log(`Built controller app → ${out} (${(bytes / 1024).toFixed(1)} KB)`);
