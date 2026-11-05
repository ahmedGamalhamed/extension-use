// Builds the web app to dist/web and, with --watch, serves it on {{controllerUrl}}.
import * as esbuild from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";

const watch = process.argv.includes("--watch");
await mkdir("dist/web", { recursive: true });
await copyFile("web/index.html", "dist/web/index.html");

const ctx = await esbuild.context({
  entryPoints: ["web/main.ts"],
  outfile: "dist/web/main.js",
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: !watch,
  logLevel: "info",
});

if (watch) {
  await ctx.watch();
  await ctx.serve({ servedir: "dist/web", port: {{port}}, host: "{{controllerHost}}" });
  console.log("web app: {{controllerUrl}}");
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
