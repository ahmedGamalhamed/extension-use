// Builds self-contained bundles for using Extension-use with no bundler.
//   node scripts/standalone.mjs host|client
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const which = process.argv[2];
const common = { bundle: true, minify: true, target: "chrome120", conditions: ["source"], legalComments: "none", logLevel: "warning" };

const jobs = {
  host: [
    // ESM: `import { defineHost } from "./vendor/extension-use-background.js"` in a module service worker.
    { entryPoints: [join(root, "packages/host/src/background/index.ts")], outfile: join(root, "packages/host/dist/standalone/extension-use-background.js"), format: "esm" },
    // Classic script: list it in manifest content_scripts; it starts the runtime with every built-in group.
    { stdin: { contents: `import { startContentRuntime } from "./src/content/index.ts"; startContentRuntime();`, resolveDir: join(root, "packages/host"), loader: "ts" }, outfile: join(root, "packages/host/dist/standalone/extension-use-content.js"), format: "iife" },
    // ESM: `import { mountFrameBridge } from "./vendor/extension-use-frame.js"` in the side panel page.
    { entryPoints: [join(root, "packages/host/src/frame/index.ts")], outfile: join(root, "packages/host/dist/standalone/extension-use-frame.js"), format: "esm" },
  ],
  client: [
    // ESM for the web app: connect, frame, page, ExtensionUseError in one file.
    {
      stdin: {
        contents: `export * from "./src/index.ts"; export { frame, inExtensionFrame } from "./src/transports/frame.ts"; export { page } from "./src/transports/page.ts";`,
        resolveDir: join(root, "packages/client"),
        loader: "ts",
      },
      outfile: join(root, "packages/client/dist/standalone/extension-use-client.js"),
      format: "esm",
      target: "es2020",
    },
  ],
};

if (!jobs[which]) {
  console.error("usage: node scripts/standalone.mjs host|client");
  process.exit(1);
}
for (const job of jobs[which]) await build({ ...common, ...job });
console.log(`standalone ${which} bundles built`);
