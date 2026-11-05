#!/usr/bin/env node
/**
 * extension-use manifest [--groups a,b] [--origins <list>] [--matches <list>] [--no-side-panel] [--write <file>]
 *   Print the manifest fields Extension-use needs, or merge them into a
 *   manifest.json (or the "manifest" key of a package.json).
 *
 * extension-use vendor [--extension <dir>] [--web <dir>]
 *   Copy the standalone bundles into your project, for extensions and web
 *   apps without a build step.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GROUP_NAMES, withExtensionUse, type GroupName, type ManifestFields } from "./permissions.js";

const argv = process.argv.slice(2);
const command = argv[0];
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const list = (v: string | undefined) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined);

const HELP = `Usage:
  extension-use manifest [options]   Print or write the manifest fields Extension-use needs
    --groups <list>     Action groups the host enables (default: all). Known: ${GROUP_NAMES.join(", ")}
    --origins <list>    Web app origins allowed to connect from a tab (externally_connectable)
    --matches <list>    Pages the content runtime runs on (default <all_urls>)
    --no-side-panel     Don't add the "sidePanel" permission
    --remote            Remote control through a relay (adds "storage" and "alarms")
    --write <file>      Merge into manifest.json, or into the "manifest" key of package.json

  extension-use vendor [options]     Copy the no-build bundles into your project
    --extension <dir>   Where to put the extension bundles (default extension/vendor)
    --web <dir>         Where to put the web app client (default web/vendor; needs @extension-use/client installed)`;

function manifest() {
  const options = {
    ...(list(flag("groups")) ? { groups: list(flag("groups")) as GroupName[] } : {}),
    ...(list(flag("origins")) ? { controllerOrigins: list(flag("origins"))! } : {}),
    ...(list(flag("matches")) ? { matches: list(flag("matches"))! } : {}),
    sidePanel: !argv.includes("--no-side-panel"),
    remote: argv.includes("--remote"),
  };
  const file = flag("write");
  if (!file) {
    console.log(JSON.stringify(withExtensionUse({}, options), null, 2));
    return;
  }
  const json = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const isPackageJson = /package\.json$/i.test(file);
  const current = (isPackageJson ? json.manifest ?? {} : json) as ManifestFields;
  const merged = withExtensionUse(current, options);
  writeFileSync(file, JSON.stringify(isPackageJson ? { ...json, manifest: merged } : merged, null, 2) + "\n");
  console.log(`Updated ${file}${isPackageJson ? ' ("manifest")' : ""}: ${[...(merged.permissions ?? []), ...(merged.host_permissions ?? [])].join(", ")}`);
}

function vendor() {
  const here = dirname(fileURLToPath(import.meta.url)); // dist/
  const hostDir = join(here, "standalone");
  const extDir = resolve(flag("extension") ?? "extension/vendor");
  const webDir = resolve(flag("web") ?? "web/vendor");
  const copied: string[] = [];

  mkdirSync(extDir, { recursive: true });
  for (const f of ["extension-use-background.js", "extension-use-content.js", "extension-use-frame.js", "extension-use-ui.js"]) {
    const src = join(hostDir, f);
    if (!existsSync(src)) throw new Error(`Missing ${src}. Is @extension-use/host built?`);
    copyFileSync(src, join(extDir, f));
    copied.push(relative(process.cwd(), join(extDir, f)));
  }

  try {
    const require = createRequire(join(process.cwd(), "package.json"));
    const client = require.resolve("@extension-use/client/standalone/extension-use-client.js");
    mkdirSync(webDir, { recursive: true });
    copyFileSync(client, join(webDir, "extension-use-client.js"));
    copied.push(relative(process.cwd(), join(webDir, "extension-use-client.js")));
  } catch {
    console.warn("Skipped the web client: install @extension-use/client to vendor it.");
  }
  console.log(`Copied:\n  ${copied.join("\n  ")}`);
}

try {
  if (command === "manifest") manifest();
  else if (command === "vendor") vendor();
  else {
    console.log(HELP);
    process.exit(command === "--help" || command === "help" ? 0 : 1);
  }
} catch (err) {
  console.error(`✖ ${(err as Error).message}`);
  process.exit(1);
}
