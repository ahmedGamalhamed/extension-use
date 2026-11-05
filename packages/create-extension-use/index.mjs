#!/usr/bin/env node
// npm create extension-use@latest [dir] -- [--template plain|wxt] [--url http://localhost:5173/] [--yes]
import { createHash, generateKeyPairSync } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const SDK_VERSION = "^0.1.0";
const TEMPLATES = { plain: "No framework, esbuild only", wxt: "WXT (Vite-based extension framework)" };
const here = dirname(fileURLToPath(import.meta.url));

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Usage: npm create extension-use@latest [dir] -- [options]

Options:
  --template <plain|wxt>   Extension setup (default: ask, or plain with --yes)
  --url <url>              Where your web app runs (default http://localhost:5173/)
  --name <name>            Extension name (default: the folder name)
  --yes                    Use defaults, don't ask
  --local <dir>            Use local package tarballs from <dir> (for SDK development)`);
  process.exit(0);
}

const interactive = !args.yes && process.stdin.isTTY;
const rl = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : undefined;
const ask = async (q, def) => (rl ? (await rl.question(`${q} (${def}) `)).trim() || def : def);

const dir = resolve(args._[0] ?? (await ask("Project folder?", "my-extension")));
const name = args.name ?? (await ask("Extension name?", basename(dir)));
let template = args.template;
if (!template) {
  if (rl) console.log(Object.entries(TEMPLATES).map(([k, v]) => `  ${k.padEnd(6)} ${v}`).join("\n"));
  template = await ask("Template?", "plain");
}
if (!(template in TEMPLATES)) fail(`Unknown template "${template}". Use one of: ${Object.keys(TEMPLATES).join(", ")}`);
const controllerUrl = new URL(args.url ?? (await ask("Where will your web app run?", "http://localhost:5173/"))).href;
rl?.close();

if (existsSync(dir) && (await readdir(dir)).length) fail(`${dir} is not empty`);
await mkdir(dir, { recursive: true });

// A public key in the manifest pins the extension ID across machines and rebuilds,
// so your web app can trust it (frame-ancestors, externally_connectable).
const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const der = publicKey.export({ type: "spki", format: "der" });
const extensionId = [...createHash("sha256").update(der).digest("hex").slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");

const controllerOrigin = new URL(controllerUrl).origin;
const vars = {
  name,
  packageName: basename(dir).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "my-extension",
  controllerUrl,
  controllerOrigin,
  controllerHost: new URL(controllerUrl).hostname,
  port: new URL(controllerUrl).port || (controllerUrl.startsWith("https") ? "443" : "80"),
  extensionId,
  sdk: SDK_VERSION,
};

await copyTemplate(join(here, "templates/shared"), dir);
await copyTemplate(join(here, "templates", template), dir);
await writeFile(join(dir, "extension-key.json"), JSON.stringify({ comment: "Public key: pins the extension ID. Safe to commit.", key: der.toString("base64"), id: extensionId }, null, 2) + "\n");

if (args.local) await useLocalPackages(dir, resolve(args.local));

const rel = relative(process.cwd(), dir) || ".";
console.log(`
Created ${name} (${template}) in ${dir}
Extension ID: ${extensionId}

Next:
  cd ${rel}
  npm install
  npm run dev

${template === "wxt" ? "WXT opens a browser with the extension loaded." : "Load ./dist/extension in chrome://extensions (Developer mode → Load unpacked)."}
Click the extension's toolbar icon to open the side panel; it shows your web app from ${controllerUrl}
`);

// ---------------------------------------------------------------------------

async function copyTemplate(from, to) {
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const src = join(from, entry.name);
    const outName = entry.name === "_gitignore" ? ".gitignore" : entry.name;
    const dest = join(to, outName);
    if (entry.isDirectory()) {
      await mkdir(dest, { recursive: true });
      await copyTemplate(src, dest);
    } else {
      const text = await readFile(src, "utf8");
      await writeFile(dest, text.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m)));
    }
  }
}

async function useLocalPackages(projectDir, tarballDir) {
  const tarballs = (await readdir(tarballDir)).filter((f) => f.endsWith(".tgz"));
  const pkgPath = join(projectDir, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
  const local = {};
  for (const file of tarballs) {
    const m = /^extension-use-(\w+)-\d/.exec(file);
    if (m) local[`@extension-use/${m[1]}`] = `file:${join(tarballDir, file).replace(/\\/g, "/")}`;
  }
  for (const section of ["dependencies", "devDependencies"]) {
    for (const dep of Object.keys(pkg[section] ?? {})) if (local[dep]) pkg[section][dep] = local[dep];
  }
  pkg.overrides = { ...pkg.overrides, ...local };
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--yes" || a === "-y") out.yes = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      out[k] = v ?? argv[++i];
    } else out._.push(a);
  }
  return out;
}

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

