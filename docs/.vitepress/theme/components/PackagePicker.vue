<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { withBase } from "vitepress";

// ---------------------------------------------------------------------------
// Choices
// ---------------------------------------------------------------------------

type Setup = "wxt" | "bundler" | "nobuild";
type Ctl = "frame" | "page" | "remote" | "agent";
type Extra = "custom" | "tabCapture" | "downloads" | "bookmarks" | "history" | "cookies" | "testing";
type PM = "npm" | "pnpm" | "yarn" | "bun";

const SETUPS: { id: Setup; title: string; text: string }[] = [
  { id: "wxt", title: "WXT", text: "Your extension is built with WXT." },
  { id: "bundler", title: "Your own bundler", text: "Vite, esbuild, webpack, Rollup or another bundler." },
  { id: "nobuild", title: "No build step", text: "Plain JavaScript files that Chrome loads as they are." },
];

const CONTROLLERS: { id: Ctl; title: string; text: string }[] = [
  { id: "frame", title: "A web app in the side panel", text: "Your hosted web app runs inside the side panel or popup and drives the extension." },
  { id: "page", title: "Your website in a normal tab", text: "Your site talks to the installed extension directly, with no panel open." },
  { id: "remote", title: "Scripts, servers and CI jobs", text: "Code outside the browser calls it over HTTP or WebSocket through a relay." },
  { id: "agent", title: "AI agents (MCP)", text: "Claude Code and other MCP clients use the browser as a set of tools." },
];

const EXTRAS: { id: Extra; title: string; text: string }[] = [
  { id: "custom", title: "Your own actions", text: "Expose your extension's features as typed actions next to the built-in ones." },
  { id: "tabCapture", title: "Work in background tabs", text: "Keep tabs rendering at full speed and screenshot them without focusing them." },
  { id: "downloads", title: "Downloads", text: "Start, list and cancel downloads." },
  { id: "bookmarks", title: "Bookmarks", text: "Search, create, edit and remove bookmarks." },
  { id: "history", title: "History", text: "Search and delete browsing history." },
  { id: "cookies", title: "Cookies", text: "List, set and remove cookies." },
  { id: "testing", title: "Tests", text: "Unit tests with a mock host and Playwright tests with your real extension." },
];

const OPT_IN: Extra[] = ["tabCapture", "downloads", "bookmarks", "history", "cookies"];
const DEFAULT_GROUPS = ["runtime", "run", "tabs", "windows", "capture", "frames", "page", "dom", "edit", "wait", "overlay", "picker"];

const setup = ref<Setup>("wxt");
const fresh = ref(false);
const controllers = ref<Ctl[]>(["frame"]);
const extras = ref<Extra[]>([]);
const appUrl = ref("https://app.example.com/ext");
const pm = ref<PM>("npm");

// Templates unwrap refs, so each list gets its own toggle.
const flip = <T,>(list: T[], id: T) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
function toggleController(id: Ctl) {
  controllers.value = flip(controllers.value, id);
}
function toggleExtra(id: Extra) {
  extras.value = flip(extras.value, id);
}

// Remember the choices in the URL so a setup can be shared.
onMounted(() => {
  const q = new URLSearchParams(location.hash.slice(1));
  const s = q.get("setup");
  if (s === "wxt" || s === "bundler" || s === "nobuild") setup.value = s;
  if (q.has("new")) fresh.value = q.get("new") === "1";
  if (q.has("c")) controllers.value = q.get("c")!.split(",").filter((x): x is Ctl => CONTROLLERS.some((c) => c.id === x));
  if (q.has("x")) extras.value = q.get("x")!.split(",").filter((x): x is Extra => EXTRAS.some((e) => e.id === x));
  if (q.get("url")) appUrl.value = q.get("url")!;
  const p = q.get("pm");
  if (p === "npm" || p === "pnpm" || p === "yarn" || p === "bun") pm.value = p;
});
watch([setup, fresh, controllers, extras, appUrl, pm], () => {
  const q = new URLSearchParams({
    setup: setup.value,
    new: fresh.value ? "1" : "0",
    c: controllers.value.join(","),
    x: extras.value.join(","),
    url: appUrl.value,
    pm: pm.value,
  });
  history.replaceState(history.state, "", `#${q}`);
});

// ---------------------------------------------------------------------------
// Derived facts
// ---------------------------------------------------------------------------

const hasFrame = computed(() => controllers.value.includes("frame"));
const hasPage = computed(() => controllers.value.includes("page"));
const hasAgent = computed(() => controllers.value.includes("agent"));
const hasScripts = computed(() => controllers.value.includes("remote"));
const hasRemote = computed(() => hasScripts.value || hasAgent.value);
const hasWeb = computed(() => hasFrame.value || hasPage.value);
const optIns = computed(() => OPT_IN.filter((g) => extras.value.includes(g)));
const hasCustom = computed(() => extras.value.includes("custom") && setup.value !== "nobuild");
const hasCapture = computed(() => extras.value.includes("tabCapture"));
const hasTests = computed(() => extras.value.includes("testing"));
const nothingPicked = computed(() => controllers.value.length === 0);

const origin = computed(() => {
  try {
    return new URL(appUrl.value).origin;
  } catch {
    return "https://app.example.com";
  }
});
const frameUrl = computed(() => {
  try {
    return new URL(appUrl.value).href;
  } catch {
    return "https://app.example.com/ext";
  }
});

// ---------------------------------------------------------------------------
// Package manager commands
// ---------------------------------------------------------------------------

function add(pkgs: string[], dev = false) {
  const list = pkgs.join(" ");
  switch (pm.value) {
    case "npm":
      return `npm install ${dev ? "-D " : ""}${list}`;
    case "pnpm":
      return `pnpm add ${dev ? "-D " : ""}${list}`;
    case "yarn":
      return `yarn add ${dev ? "-D " : ""}${list}`;
    case "bun":
      return `bun add ${dev ? "--dev " : ""}${list}`;
  }
}
function dlx(cmd: string) {
  return { npm: `npx ${cmd}`, pnpm: `pnpm dlx ${cmd}`, yarn: `yarn dlx ${cmd}`, bun: `bunx ${cmd}` }[pm.value];
}
/** A binary from a package installed in the project (the `extension-use` CLI from @extension-use/host). */
function bin(cmd: string) {
  return { npm: `npx ${cmd}`, pnpm: `pnpm exec ${cmd}`, yarn: `yarn ${cmd}`, bun: `bunx ${cmd}` }[pm.value];
}
function create(template: string) {
  const args = `my-extension --template ${template} --url ${frameUrl.value}`;
  return {
    npm: `npm create extension-use@latest ${args.replace("my-extension ", "my-extension -- ")}`,
    pnpm: `pnpm create extension-use ${args}`,
    yarn: `yarn create extension-use ${args}`,
    bun: `bun create extension-use ${args}`,
  }[pm.value];
}

// ---------------------------------------------------------------------------
// Packages
// ---------------------------------------------------------------------------

interface Pkg {
  name: string;
  where: string;
  why: string;
  link: string;
}

const packages = computed<Pkg[]>(() => {
  const out: Pkg[] = [
    {
      name: "@extension-use/host",
      where: setup.value === "nobuild" ? "Extension (vendored)" : "Extension",
      why: "Runs inside your extension: the router with grants and site policy, the page actions, the side panel bridge, manifest helpers and the CLI.",
      link: "/packages/host",
    },
  ];
  if (setup.value === "wxt")
    out.push({ name: "@extension-use/wxt", where: "Extension (dev)", why: "Adds the permissions and externally_connectable entries to the manifest WXT generates.", link: "/packages/wxt" });
  if (hasWeb.value || hasScripts.value)
    out.push({
      name: "@extension-use/client",
      where: [hasWeb.value ? (setup.value === "nobuild" ? "Web app (vendored)" : "Web app") : "", hasScripts.value ? "Scripts" : ""].filter(Boolean).join(" + "),
      why: "The typed client: connect over the frame, page or remote transport and call actions as ext.dom.click(…).",
      link: "/packages/client",
    });
  if (hasRemote.value)
    out.push({ name: "@extension-use/relay", where: "Run with npx", why: "The local relay your browser pairs with. Scripts and agents reach the browser through it.", link: "/packages/relay" });
  if (hasAgent.value)
    out.push({ name: "@extension-use/mcp", where: "Run by your MCP client", why: "Turns the paired browser's actions into MCP tools.", link: "/packages/mcp" });
  if (hasTests.value)
    out.push({ name: "@extension-use/testing", where: "Web app (dev)", why: "createMockHost() for unit tests and Playwright fixtures that load your real extension.", link: "/packages/testing" });
  if (fresh.value)
    out.push({ name: "create-extension-use", where: "Run once", why: "Creates a working extension and web app with the setup you picked.", link: "/packages/create-extension-use" });
  out.push({ name: "@extension-use/protocol", where: "Installed for you", why: "Shared types, error codes and schemas. host and client depend on it; you rarely import it.", link: "/packages/protocol" });
  return out;
});

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

interface File {
  name: string;
  lang: string;
  code: string;
}
interface Step {
  title: string;
  text?: string[];
  files?: File[];
}

const indent = (s: string, n: number) =>
  s
    .split("\n")
    .map((l) => (l ? " ".repeat(n) + l : l))
    .join("\n");

const paths = computed(() => {
  switch (setup.value) {
    case "wxt":
      return {
        background: "entrypoints/background.ts",
        content: "entrypoints/content.ts",
        contentScript: "content-scripts/content.js",
        sidepanelHtml: "entrypoints/sidepanel/index.html",
        sidepanelJs: "entrypoints/sidepanel/main.ts",
        controlHtml: "entrypoints/options/index.html",
        controlJs: "entrypoints/options/main.ts",
        offscreenHtml: "entrypoints/offscreen/index.html",
        offscreenJs: "entrypoints/offscreen/main.ts",
        actions: "lib/actions.ts",
        actionsImport: "../lib/actions",
        web: "src/extension.ts",
        lang: "ts",
      };
    case "bundler":
      return {
        background: "src/background.ts",
        content: "src/content.ts",
        contentScript: "content.js",
        sidepanelHtml: "sidepanel.html",
        sidepanelJs: "src/sidepanel.ts",
        controlHtml: "control.html",
        controlJs: "src/control.ts",
        offscreenHtml: "offscreen.html",
        offscreenJs: "src/offscreen.ts",
        actions: "src/actions.ts",
        actionsImport: "./actions",
        web: "src/extension.ts",
        lang: "ts",
      };
    default:
      return {
        background: "extension/background.js",
        content: "",
        contentScript: "vendor/extension-use-content.js",
        sidepanelHtml: "extension/sidepanel.html",
        sidepanelJs: "extension/sidepanel.js",
        controlHtml: "extension/control.html",
        controlJs: "extension/control.js",
        offscreenHtml: "extension/offscreen.html",
        offscreenJs: "",
        actions: "",
        actionsImport: "",
        web: "web/main.js",
        lang: "js",
      };
  }
});

const hostImport = (entry: "background" | "content" | "frame" | "ui" | "offscreen") =>
  setup.value === "nobuild" ? `./vendor/extension-use-${entry}.js` : `@extension-use/host/${entry}`;

function backgroundCode() {
  const names = optIns.value.length ? ["allBuiltinGroups", "builtinGroups", "defineHost"] : ["defineHost"];
  const imports = [`import { ${names.join(", ")} } from "${hostImport("background")}";`];
  if (hasCustom.value) imports.push(`import { saveNote } from "${paths.value.actionsImport}";`);

  const ctl: string[] = [];
  if (hasFrame.value) ctl.push(`// Your web app in the side panel or popup.`, `frame: { origins: ["${origin.value}"] },`);
  if (hasPage.value)
    ctl.push(
      `// Your website in a normal tab. Read-only to start; widen as needed.`,
      `page: {`,
      `  origins: ["${origin.value}"],`,
      `  grants: ["runtime.*", "tabs.list", "page.info", "dom.snapshot", "dom.query", "dom.text", "overlay.*"],`,
      `},`,
    );
  if (hasRemote.value)
    ctl.push(`// Scripts and agents, through a relay the person pairs with in the control panel.`, `// Default: every enabled action. Narrow it with grants: ["dom.*", ...].`, `remote: {},`);

  const body = [
    `defineHost({`,
    `  id: "my-extension",`,
    `  controllers: {`,
    indent(ctl.join("\n"), 4),
    `  },`,
    ...(optIns.value.length ? [`  // The default groups plus the opt-in ones you picked.`, `  groups: [...allBuiltinGroups, ${optIns.value.map((g) => `builtinGroups.${g}`).join(", ")}],`] : []),
    ...(hasCustom.value ? [`  actions: [saveNote],`] : []),
    `  // Injected into tabs that were open before the extension was installed.`,
    `  contentScript: "${paths.value.contentScript}",`,
    ...(hasCapture.value ? [`  offscreen: "offscreen.html",`] : []),
    `});`,
    ...(hasFrame.value ? [``, `// Clicking the toolbar icon opens the side panel.`, `chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});`] : []),
  ].join("\n");

  if (setup.value === "wxt") {
    return `${imports.join("\n")}\n\nexport default defineBackground({\n  type: "module",\n  main() {\n${indent(body, 4)}\n  },\n});\n`;
  }
  return `${imports.join("\n")}\n\n${body}\n`;
}

function contentCode() {
  if (setup.value === "wxt")
    return `import { startContentRuntime } from "@extension-use/host/content";

export default defineContentScript({
  matches: ["<all_urls>"],
  allFrames: true,
  matchAboutBlank: true,
  main() {
    startContentRuntime();
  },
});
`;
  return `import { startContentRuntime } from "@extension-use/host/content";

// Bundle this file as a classic script (IIFE), not an ES module.
startContentRuntime();
`;
}

function htmlPage(title: string, script: string, mount: string, module = true) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      html, body, #${mount} { margin: 0; height: 100%; }
    </style>
  </head>
  <body>
    <div id="${mount}"></div>
    <script${module ? ' type="module"' : ""} src="${script}"><\/script>
  </body>
</html>
`;
}

function sidepanelFiles(): File[] {
  const script = setup.value === "wxt" ? "./main.ts" : "sidepanel.js";
  const ts = setup.value !== "nobuild";
  return [
    { name: paths.value.sidepanelHtml, lang: "html", code: htmlPage("My extension", script, "app") },
    {
      name: paths.value.sidepanelJs,
      lang: paths.value.lang,
      code: `import { mountFrameBridge } from "${hostImport("frame")}";

mountFrameBridge({
  url: "${frameUrl.value}",
  container: document.getElementById("app")${ts ? "!" : ""},
  fallback: "Can't reach the app. Check your connection and try again.",
});
`,
    },
  ];
}

function controlFiles(): File[] {
  const script = setup.value === "wxt" ? "./main.ts" : "control.js";
  const ts = setup.value !== "nobuild";
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Remote control</title>
    <style>
      :root { color-scheme: light dark; }
      body { margin: 0; padding: 16px; max-width: 560px; font: 14px system-ui, sans-serif; }
    </style>
  </head>
  <body>
    <div id="panel"></div>
    <script type="module" src="${script}"><\/script>
  </body>
</html>
`;
  const dev = setup.value === "nobuild" ? "false" : setup.value === "wxt" ? "import.meta.env.DEV" : "false";
  return [
    { name: paths.value.controlHtml, lang: "html", code: html },
    {
      name: paths.value.controlJs,
      lang: paths.value.lang,
      code: `import { mountControlPanel } from "${hostImport("ui")}";

// Pairing with a relay, the kill switch and the activity log.
// playground: true adds a form to run any action (handy in development).
mountControlPanel(document.getElementById("panel")${ts ? "!" : ""}, { playground: ${dev} });
`,
    },
  ];
}

function offscreenFiles(): File[] {
  if (setup.value === "nobuild")
    return [
      {
        name: paths.value.offscreenHtml,
        lang: "html",
        code: `<!doctype html>
<!-- Never shown: Chrome opens it as an offscreen document to hold tab capture streams. -->
<meta charset="utf-8" />
<script src="vendor/extension-use-offscreen.js"><\/script>
`,
      },
    ];
  const script = setup.value === "wxt" ? "./main.ts" : "offscreen.js";
  return [
    {
      name: paths.value.offscreenHtml,
      lang: "html",
      code: `<!doctype html>
<!-- Never shown: Chrome opens it as an offscreen document to hold tab capture streams. -->
<meta charset="utf-8" />
<script type="module" src="${script}"><\/script>
`,
    },
    {
      name: paths.value.offscreenJs,
      lang: "ts",
      code: `import { mountOffscreen } from "@extension-use/host/offscreen";

mountOffscreen();
`,
    },
  ];
}

function groupNames() {
  return [...DEFAULT_GROUPS, ...optIns.value];
}

function wxtConfig() {
  const opts: string[] = [];
  if (optIns.value.length) opts.push(`// Must match the groups in defineHost().`, `groups: ${JSON.stringify(groupNames()).replace(/","/g, '", "')},`);
  if (hasPage.value) opts.push(`// Lets your website connect from a normal tab (externally_connectable).`, `controllerOrigins: ["${origin.value}"],`);
  if (hasRemote.value) opts.push(`// Remote control needs "storage" and "alarms".`, `remote: true,`);
  if (!hasFrame.value) opts.push(`// No side panel controller, so no "sidePanel" permission.`, `sidePanel: false,`);
  const manifest = [`action: { default_title: "My extension" }, // the badge shows control state here`];
  if (hasCustom.value) manifest.push(`permissions: ["storage"], // used by the saveNote action`);
  return `import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@extension-use/wxt"],
  extensionUse: {${opts.length ? `\n${indent(opts.join("\n"), 4)}\n  ` : ""}},
  manifest: {
${indent(manifest.join("\n"), 4)}
  },
});
`;
}

function manifestJson() {
  const m: Record<string, unknown> = {
    manifest_version: 3,
    name: "My extension",
    version: "0.1.0",
    background: { service_worker: "background.js", type: "module" },
    action: { default_title: "My extension" },
  };
  if (hasFrame.value) m.side_panel = { default_path: "sidepanel.html" };
  if (hasRemote.value) m.options_page = "control.html";
  m.content_scripts = [
    {
      matches: ["<all_urls>"],
      js: [paths.value.contentScript],
      run_at: "document_idle",
      all_frames: true,
      match_about_blank: true,
    },
  ];
  if (hasCustom.value) m.permissions = ["storage"];
  return `${JSON.stringify(m, null, 2)}\n`;
}

function manifestCommand() {
  const file = setup.value === "nobuild" ? "extension/manifest.json" : "manifest.json";
  const flags = [`--write ${file}`];
  if (optIns.value.length) flags.push(`--groups ${groupNames().join(",")}`);
  if (hasPage.value) flags.push(`--origins ${origin.value}`);
  if (hasRemote.value) flags.push(`--remote`);
  if (!hasFrame.value) flags.push(`--no-side-panel`);
  return bin(`extension-use manifest ${flags.join(" ")}`);
}

function actionsCode() {
  return `import { defineAction } from "@extension-use/host/background";
import * as z from "zod";

// Controllers call it as ext.app.saveNote({ text }) once it's typed (see codegen).
export const saveNote = defineAction(
  "app.saveNote",
  {
    where: "background",
    version: 1,
    description: "Save a note about the page in the target tab.",
    input: z.object({ text: z.string().min(1).max(2000) }),
    output: z.object({ id: z.string() }),
  },
  async ({ text }, ctx) => {
    const tab = await ctx.tab(); // the call's target tab, checked against site policy
    const id = crypto.randomUUID();
    await chrome.storage.local.set({ [id]: { text, url: tab.url, savedAt: Date.now() } });
    return { id };
  },
);
`;
}

function webCode() {
  const nobuild = setup.value === "nobuild";
  const both = hasFrame.value && hasPage.value;
  const imports = nobuild
    ? `import { connect, ${[hasFrame.value ? "frame" : "", both ? "inExtensionFrame" : "", hasPage.value ? "page" : ""].filter(Boolean).join(", ")} } from "./vendor/extension-use-client.js";`
    : [
        `import { connect } from "@extension-use/client";`,
        ...(hasFrame.value ? [`import { frame${both ? ", inExtensionFrame" : ""} } from "@extension-use/client/frame";`] : []),
        ...(hasPage.value ? [`import { page } from "@extension-use/client/page";`] : []),
      ].join("\n");

  const transport = both
    ? `inExtensionFrame()
    ? frame({ hostOrigins: [\`chrome-extension://\${EXTENSION_ID}\`] }) // inside the side panel
    : page({ extensionId: EXTENSION_ID }), // in a normal tab`
    : hasFrame.value
      ? `frame({ hostOrigins: [\`chrome-extension://\${EXTENSION_ID}\`] }),`
      : `page({ extensionId: EXTENSION_ID }),`;

  const expose = hasTests.value ? (nobuild ? `\n  { expose: location.hostname === "localhost" }, // lets Playwright tests reach the client` : `\n  { expose: import.meta.env.DEV }, // lets Playwright tests reach the client (Vite's dev flag)`) : "";

  return `${imports}

// Your extension's ID (chrome://extensions). Pin it in development with a manifest "key".
const EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";

export const ext = await connect(
  ${transport}${expose}
);

// Read the page as a compact tree with refs, then act on what you find.
const { text } = await ext.dom.snapshot({ format: "text" });
await ext.dom.click({ locator: { role: "button", name: "Save" } });
await ext.overlay.toast({ message: "Saved", kind: "success" });

ext.on("tab.updated", ({ tab }) => console.log("now on", tab.url));
${hasCustom.value ? `\n// Your own action, before codegen gives you types:\nawait ext.callRaw("app.saveNote", { text: "Read this later" });\n` : ""}`;
}

function scriptCode() {
  return `// Node 22+ (or a browser). Run it after pairing your browser with the relay.
import { connect } from "@extension-use/client";
import { remote } from "@extension-use/client/remote";

const ext = await connect(remote({ relay: "http://127.0.0.1:7777", token: process.env.EXTENSION_USE_TOKEN! }));

const tab = await ext.tabs.open({ url: "https://example.com" });
const { text } = await ext.dom.snapshot({ format: "text" }, { target: { tab: tab.id } });
console.log(text);

ext.close();
`;
}

function unitTestCode() {
  return `import { expect, test } from "vitest";
import { createMockHost, expectErrorCode } from "@extension-use/testing";

test("reads the page title", async () => {
  const host = createMockHost({
    handlers: {
      "page.info": () => ({
        url: "https://blog.example/post",
        title: "Post",
        viewport: { width: 1280, height: 800, devicePixelRatio: 1 },
        scroll: { x: 0, y: 0 },
        document: { width: 1280, height: 4000 },
      }),
    },
  });
  const ext = await host.connect();

  expect((await ext.page.info()).title).toBe("Post");
  expect(host.callsTo("page.info")).toHaveLength(1);
});

test("blocked pages are refused", async () => {
  const host = createMockHost({ handlers: { "dom.text": () => ({ text: "", truncated: false }) }, tab: { url: "chrome://settings" } });
  await expectErrorCode((await host.connect()).dom.text(), "BLOCKED_BY_POLICY");
});
`;
}

function playwrightCode() {
  const out = setup.value === "wxt" ? ".output/chrome-mv3" : setup.value === "bundler" ? "dist" : "extension";
  return `// playwright.config.ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  use: { extensionPath: "${out}" } as Record<string, unknown>, // your built extension
});
`;
}

function e2eCode() {
  if (hasFrame.value)
    return `import { expect, test } from "@extension-use/testing/playwright";

test("the side panel reads the page", async ({ context, openPanel }) => {
  const site = await context.newPage();
  await site.goto("https://example.com/");

  const { ext } = await openPanel(); // the side panel page, opened as a tab
  const snap = await ext.dom.snapshot({ format: "text" }, { target: { tab: { urlMatch: "https://example.com/*" } } });
  expect(snap.text).toContain("Example Domain");
});
`;
  return `import { controllerIn, expect, test } from "@extension-use/testing/playwright";

test("my site drives the extension", async ({ context }) => {
  const app = await context.newPage();
  await app.goto("${origin.value}/");

  const ext = await controllerIn(app); // the client your site exposed
  const { tabs } = await ext.tabs.list({});
  expect(tabs.length).toBeGreaterThan(0);
});
`;
}

const steps = computed<Step[]>(() => {
  const s: Step[] = [];
  const nobuild = setup.value === "nobuild";
  const template = { wxt: "wxt", bundler: "plain", nobuild: "vanilla" }[setup.value];

  if (fresh.value)
    s.push({
      title: "Create the project",
      text: [
        `This creates an extension and a small web app with the side panel and website controllers already wired up. Use the steps below to add what else you picked, or to compare with your own code.`,
        setup.value === "bundler" ? "The `plain` template uses esbuild. The same code works with any bundler." : "",
      ].filter(Boolean),
      files: [{ name: "Terminal", lang: "sh", code: create(template) }],
    });

  // Install
  const extDeps = ["@extension-use/host"];
  if (nobuild && hasWeb.value) extDeps.push("@extension-use/client");
  if (hasCustom.value) extDeps.push("zod");
  const install: File[] = [{ name: "In your extension project", lang: "sh", code: add(extDeps) }];
  if (setup.value === "wxt") install[0]!.code += `\n${add(["@extension-use/wxt"], true)}`;
  if (nobuild) install[0]!.code += `\n# Copy the prebuilt bundles in (add this as a "postinstall" script to keep them current)\n${bin(`extension-use vendor --extension extension/vendor${hasWeb.value ? " --web web/vendor" : ""}`)}`;
  if (hasWeb.value && !nobuild) install.push({ name: "In your web app", lang: "sh", code: add(["@extension-use/client"]) + (hasTests.value ? `\n${add(["@extension-use/testing", "@playwright/test", "vitest"], true)}` : "") });
  if (hasWeb.value && nobuild && hasTests.value) install.push({ name: "For tests", lang: "sh", code: add(["@extension-use/testing", "@playwright/test", "vitest"], true) });
  if (!hasWeb.value && hasTests.value) install.push({ name: "For tests", lang: "sh", code: add(["@extension-use/testing", "@playwright/test", "vitest"], true) });
  if (hasScripts.value) install.push({ name: "In your script's project", lang: "sh", code: add(["@extension-use/client"]) });
  s.push({
    title: "Install the packages",
    text: [
      hasRemote.value ? "The relay and the MCP server run with `npx`, so they need no install." : "",
      hasCustom.value ? "`zod` (v4) describes the input and output of your own actions." : "",
      nobuild ? "With no build step, `extension-use vendor` copies ready-made ES module bundles into your folders. Your code imports them by relative path." : "",
    ].filter(Boolean),
    files: install,
  });

  // Manifest
  if (setup.value === "wxt")
    s.push({
      title: "Configure the manifest",
      text: ["The `@extension-use/wxt` module adds the permissions for your action groups when WXT generates the manifest."],
      files: [{ name: "wxt.config.ts", lang: "ts", code: wxtConfig() }],
    });
  else
    s.push({
      title: "Set up the manifest",
      text: [
        "Add these entries to your manifest, or merge them into the one you have.",
        "Then let the CLI add the permissions, host permissions and `externally_connectable` entries for what you picked. It keeps your other entries, so you can run it again after changes.",
        setup.value === "bundler" ? "Bundle each entry to the root of your output folder (`background.js`, `content.js`, and so on), next to the manifest. If you build the manifest in code, `withExtensionUse(manifest, options)` from `@extension-use/host/permissions` does the same as the CLI." : "",
      ].filter(Boolean),
      files: [
        { name: nobuild ? "extension/manifest.json" : "manifest.json", lang: "json", code: manifestJson() },
        { name: "Terminal", lang: "sh", code: manifestCommand() },
      ],
    });

  if (hasCustom.value)
    s.push({
      title: "Define your own actions",
      text: [
        "A background action runs your code with the same grants, input checks, site policy and audit as the built-in actions. Content actions run in the page instead; see [Custom actions](/guides/custom-actions).",
      ],
      files: [{ name: paths.value.actions, lang: "ts", code: actionsCode() }],
    });

  s.push({
    title: "Start the host in the background",
    text: [
      "`defineHost()` decides who may connect and what each controller may call. Everything else is refused.",
      optIns.value.length ? "Opt-in groups reach data outside any page, so they are never on by default. The list here must match the manifest's." : "",
    ].filter(Boolean),
    files: [{ name: paths.value.background, lang: paths.value.lang, code: backgroundCode() }],
  });

  if (!nobuild)
    s.push({
      title: "Start the content runtime",
      text: ["The content runtime runs the page actions (reading, clicking, typing, overlays, the picker) in every frame."],
      files: [{ name: paths.value.content, lang: "ts", code: contentCode() }],
    });
  else
    s.push({
      title: "The content runtime",
      text: ["Nothing to write: the manifest above loads `vendor/extension-use-content.js` into every page, and it starts by itself."],
    });

  if (hasFrame.value)
    s.push({
      title: "Load your web app in the side panel",
      text: [
        "The frame bridge loads your web app in an iframe and passes its calls to the background.",
        `Serve the web app with \`Content-Security-Policy: frame-ancestors chrome-extension://<your-extension-id>\` so only your extension can frame it.`,
      ],
      files: sidepanelFiles(),
    });

  if (hasRemote.value)
    s.push({
      title: "Add the control panel",
      text: [
        "The person pairs the browser with a relay here, sees active sessions and can pause all control with one click.",
        setup.value === "wxt" ? "WXT turns the `options` entrypoint into the options page." : "The manifest above makes it the options page.",
      ],
      files: controlFiles(),
    });

  if (hasCapture.value)
    s.push({
      title: "Add the offscreen page",
      text: [
        "Tab capture streams have to live in a document, and the service worker can't hold one. `defineHost({ offscreen })` points at this page.",
        "Chrome allows capturing a tab only after the person invoked your extension on it (toolbar button, side panel, shortcut or context menu).",
      ],
      files: offscreenFiles(),
    });

  if (hasWeb.value)
    s.push({
      title: hasFrame.value && !hasPage.value ? "Connect from your web app" : hasPage.value && !hasFrame.value ? "Connect from your website" : "Connect from your web app",
      text: [
        hasFrame.value && hasPage.value ? "The same code works in the side panel and in a normal tab: it picks the frame or page transport for you." : "",
        "Every action is typed. Wrong input comes back as `INVALID_INPUT`, and anything the controller wasn't granted as `NOT_GRANTED`.",
        hasPage.value ? "If the extension isn't installed, `connect()` fails with `NOT_CONNECTED` after the handshake timeout. Use that to show an install prompt." : "",
      ].filter(Boolean),
      files: [{ name: paths.value.web, lang: nobuild ? "js" : "ts", code: webCode() }],
    });

  if (hasRemote.value)
    s.push({
      title: "Start a relay and pair the browser",
      text: [
        "The relay prints its URL and an owner token. Open the control panel, enter the relay URL and click **Connect to relay**, then confirm the code in the relay's terminal.",
        "Give each script or agent its own token, limited to what it needs.",
      ],
      files: [
        {
          name: "Terminal",
          lang: "sh",
          code: [
            dlx("@extension-use/relay"),
            ...(hasScripts.value ? [`${dlx("@extension-use/relay")} token create script --grants "runtime.*,tabs.*,page.*,dom.*,wait.*"`] : []),
            ...(hasAgent.value ? [`${dlx("@extension-use/relay")} token create agent --grants "runtime.*,tabs.*,page.*,dom.*,wait.*,overlay.*,capture.*,run.*"`] : []),
          ].join("\n"),
        },
      ],
    });

  if (hasScripts.value)
    s.push({
      title: "Drive the browser from a script",
      text: ["Or skip the client and call the HTTP API from any language."],
      files: [
        { name: "script.ts", lang: "ts", code: scriptCode() },
        {
          name: "Terminal",
          lang: "sh",
          code: `curl -H "Authorization: Bearer $EXTENSION_USE_TOKEN" -H "content-type: application/json" \\
  -d '{"action":"dom.snapshot","input":{"format":"text"}}' \\
  http://127.0.0.1:7777/v1/devices/default/calls`,
        },
      ],
    });

  if (hasAgent.value)
    s.push({
      title: "Connect your AI agent",
      text: ["The agent gets one tool per action the token allows, including your own actions, and instructions for the snapshot → ref → act loop."],
      files: [
        { name: "Claude Code", lang: "sh", code: `claude mcp add extension-use -e EXTENSION_USE_TOKEN=eu_ctl_… -- npx -y @extension-use/mcp --relay http://127.0.0.1:7777` },
        {
          name: "Other MCP clients (JSON config)",
          lang: "json",
          code: `{
  "mcpServers": {
    "extension-use": {
      "command": "npx",
      "args": ["-y", "@extension-use/mcp", "--relay", "http://127.0.0.1:7777"],
      "env": { "EXTENSION_USE_TOKEN": "eu_ctl_…" }
    }
  }
}
`,
        },
      ],
    });

  if (hasCustom.value && (hasWeb.value || hasScripts.value))
    s.push({
      title: "Generate types for your actions",
      text: ["`runtime.describe` lists every action with its JSON schema. Codegen turns that into types, so `ext.app.saveNote()` is checked like the built-in actions."],
      files: [
        {
          name: "Terminal",
          lang: "sh",
          code: hasRemote.value
            ? `EXTENSION_USE_TOKEN=eu_ctl_… ${bin("extension-use codegen --relay http://127.0.0.1:7777 --out src/extension-actions.ts")}`
            : `# Save JSON.stringify(await ext.runtime.describe()) to describe.json, then:\n${bin("extension-use codegen --from describe.json --out src/extension-actions.ts")}`,
        },
        {
          name: "Then",
          lang: "ts",
          code: `import type { CoreActions } from "@extension-use/client";
import type { HostActions } from "./extension-actions";

const ext = await connect<CoreActions & HostActions>(/* transport */);
const { id } = await ext.app.saveNote({ text: "Read this later" });
`,
        },
      ],
    });

  if (hasTests.value)
    s.push({
      title: "Test it",
      text: [
        "The mock host runs the real router, so input checks, grants, site policy and error codes behave as in the browser.",
        "The Playwright fixtures load your built extension into Chromium. Run `npx playwright install chromium` once.",
      ],
      files: [
        { name: "extension.test.ts", lang: "ts", code: unitTestCode() },
        { name: "playwright.config.ts", lang: "ts", code: playwrightCode() },
        { name: "e2e/extension.spec.ts", lang: "ts", code: e2eCode() },
      ],
    });

  s.push({
    title: "Load it in Chrome",
    text: [
      setup.value === "wxt"
        ? "`wxt` (your dev script) opens Chrome with the extension loaded."
        : `Open \`chrome://extensions\`, turn on Developer mode, click **Load unpacked** and pick ${setup.value === "bundler" ? "your build output folder" : "the `extension` folder"}.`,
      hasFrame.value ? "Click the toolbar icon to open the side panel." : "",
      "Every action shows on the page while it runs, and the toolbar badge shows when the browser is being controlled.",
    ].filter(Boolean),
  });

  return s;
});

const readMore = computed(() => {
  const links: { text: string; link: string }[] = [];
  links.push(setup.value === "wxt" ? { text: "WXT guide", link: "/guides/wxt" } : { text: "Plain JS/TS and no-build guide", link: "/guides/plain" });
  links.push({ text: "Controllers and transports", link: "/guides/controllers" });
  links.push({ text: "Action groups and permissions", link: "/guides/permissions" });
  if (hasRemote.value) links.push({ text: "Remote control", link: "/guides/remote" });
  if (hasAgent.value) links.push({ text: "AI agents", link: "/guides/agents" });
  if (hasCustom.value) links.push({ text: "Custom actions", link: "/guides/custom-actions" });
  if (hasCapture.value) links.push({ text: "Background tabs recipe", link: "/recipes#8-work-in-background-tabs" });
  if (hasTests.value) links.push({ text: "Testing", link: "/guides/testing" });
  links.push({ text: "Security and store policy", link: "/guides/security" });
  links.push({ text: "Action reference", link: "/actions" });
  return links;
});

// Tiny inline markdown for step text: `code`, **bold** and [links](/path).
function md(text: string) {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t: string, href: string) => `<a href="${href.startsWith("/") ? withBase(href) : href}">${t}</a>`);
}

const copiedAll = ref(false);
async function copyLink() {
  try {
    await navigator.clipboard.writeText(location.href);
    copiedAll.value = true;
    setTimeout(() => (copiedAll.value = false), 1500);
  } catch {
    /* clipboard blocked: the URL is still in the address bar */
  }
}
</script>

<template>
  <div class="picker">
    <section class="q">
      <h3>1. How is your extension built?</h3>
      <div class="cards three" role="radiogroup" aria-label="Build setup">
        <button
          v-for="o in SETUPS"
          :key="o.id"
          type="button"
          role="radio"
          :aria-checked="setup === o.id"
          class="card"
          :class="{ on: setup === o.id }"
          @click="setup = o.id"
        >
          <span class="title">{{ o.title }}</span>
          <span class="text">{{ o.text }}</span>
        </button>
      </div>
      <label class="check inline">
        <input v-model="fresh" type="checkbox" />
        I'm starting a new extension (scaffold it with <code>create-extension-use</code>)
      </label>
    </section>

    <section class="q">
      <h3>2. What will control your extension?</h3>
      <p class="hint">Pick all that apply. Each one is a controller with its own origins and grants.</p>
      <div class="cards two">
        <button
          v-for="o in CONTROLLERS"
          :key="o.id"
          type="button"
          role="checkbox"
          :aria-checked="controllers.includes(o.id)"
          class="card"
          :class="{ on: controllers.includes(o.id) }"
          @click="toggleController(o.id)"
        >
          <span class="tick" aria-hidden="true"></span>
          <span class="title">{{ o.title }}</span>
          <span class="text">{{ o.text }}</span>
        </button>
      </div>
    </section>

    <section class="q">
      <h3>3. Anything else?</h3>
      <div class="cards three compact">
        <button
          v-for="o in EXTRAS"
          :key="o.id"
          type="button"
          role="checkbox"
          :aria-checked="extras.includes(o.id)"
          class="card"
          :class="{ on: extras.includes(o.id), off: o.id === 'custom' && setup === 'nobuild' }"
          :disabled="o.id === 'custom' && setup === 'nobuild'"
          @click="toggleExtra(o.id)"
        >
          <span class="tick" aria-hidden="true"></span>
          <span class="title">{{ o.title }}</span>
          <span class="text">{{ o.id === "custom" && setup === "nobuild" ? "Needs zod schemas, so it needs a build step." : o.text }}</span>
        </button>
      </div>
    </section>

    <section class="q settings">
      <label v-if="hasWeb" class="field">
        <span>Your web app's URL</span>
        <input v-model.trim="appUrl" type="url" spellcheck="false" placeholder="https://app.example.com/ext" />
      </label>
      <div class="field">
        <span>Package manager</span>
        <div class="seg" role="radiogroup" aria-label="Package manager">
          <button v-for="p in (['npm', 'pnpm', 'yarn', 'bun'] as const)" :key="p" type="button" role="radio" :aria-checked="pm === p" :class="{ on: pm === p }" @click="pm = p">
            {{ p }}
          </button>
        </div>
      </div>
    </section>

    <div v-if="nothingPicked" class="custom-block warning">
      <p class="custom-block-title">Pick at least one controller</p>
      <p>Extension-use exists so something outside the extension can drive it. Choose a web app, a website, scripts or an agent above.</p>
    </div>

    <template v-else>
      <h2 id="your-packages" class="result-h">Your packages</h2>
      <table class="pkgs">
        <thead>
          <tr>
            <th>Package</th>
            <th>Where</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in packages" :key="p.name">
            <td><a :href="withBase(p.link)"><code>{{ p.name }}</code></a></td>
            <td class="where">{{ p.where }}</td>
            <td>{{ p.why }}</td>
          </tr>
        </tbody>
      </table>

      <div class="result-head">
        <h2 id="setup-steps" class="result-h">Setup steps</h2>
        <button type="button" class="share" @click="copyLink">{{ copiedAll ? "Link copied" : "Copy link to this setup" }}</button>
      </div>
      <ol class="steps">
        <li v-for="(step, i) in steps" :key="step.title + i">
          <h3>{{ step.title }}</h3>
          <p v-for="(t, j) in step.text ?? []" :key="j" v-html="md(t)"></p>
          <div v-for="f in step.files ?? []" :key="f.name" class="file">
            <div class="file-name">{{ f.name }}</div>
            <div :class="`language-${f.lang}`">
              <button title="Copy code" class="copy"></button>
              <span class="lang">{{ f.lang }}</span>
              <pre><code>{{ f.code }}</code></pre>
            </div>
          </div>
        </li>
      </ol>

      <h2 id="read-next" class="result-h">Read next</h2>
      <ul class="more">
        <li v-for="l in readMore" :key="l.link"><a :href="withBase(l.link)">{{ l.text }}</a></li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.picker {
  margin-top: 24px;
}
.q {
  margin: 0 0 28px;
}
.q h3 {
  margin: 0 0 4px;
  font-size: 17px;
}
.hint {
  margin: 0 0 10px !important;
  color: var(--vp-c-text-2);
  font-size: 14px;
}
.cards {
  display: grid;
  gap: 10px;
  margin-top: 10px;
}
.cards.two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.cards.three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
@media (max-width: 640px) {
  .cards.two,
  .cards.three {
    grid-template-columns: 1fr;
  }
}
.card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  text-align: left;
  padding: 12px 14px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg-soft);
  cursor: pointer;
  transition:
    border-color 0.15s,
    background 0.15s;
}
.card:hover {
  border-color: var(--vp-c-brand-2);
}
.card:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}
.card.on {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}
.card.off {
  opacity: 0.55;
  cursor: not-allowed;
}
.card .title {
  font-weight: 600;
  font-size: 15px;
  padding-right: 22px;
}
.card .text {
  font-size: 13px;
  line-height: 1.45;
  color: var(--vp-c-text-2);
}
.compact .card {
  padding: 10px 12px;
}
.tick {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 16px;
  height: 16px;
  border: 1.5px solid var(--vp-c-text-3);
  border-radius: 4px;
}
.card.on .tick {
  background: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}
.card.on .tick::after {
  content: "";
  position: absolute;
  left: 4px;
  top: 1px;
  width: 5px;
  height: 9px;
  border: solid var(--vp-c-white);
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
.check.inline {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 12px;
  font-size: 14px;
  color: var(--vp-c-text-2);
  cursor: pointer;
}
.settings {
  display: flex;
  flex-wrap: wrap;
  gap: 16px 24px;
  align-items: flex-end;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 14px;
  flex: 1 1 260px;
}
.field > span {
  font-weight: 600;
}
.field input {
  padding: 8px 10px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
}
.field input:focus {
  border-color: var(--vp-c-brand-1);
  outline: none;
}
.seg {
  display: inline-flex;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  overflow: hidden;
  align-self: flex-start;
}
.seg button {
  padding: 7px 14px;
  font-size: 13px;
  font-family: var(--vp-font-family-mono);
  border-left: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-2);
}
.seg button:first-child {
  border-left: 0;
}
.seg button.on {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  font-weight: 600;
}
.result-h {
  margin-top: 40px !important;
}
.result-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
}
.share {
  font-size: 13px;
  color: var(--vp-c-brand-1);
  font-weight: 500;
}
.pkgs .where {
  white-space: nowrap;
  font-size: 13px;
}
.steps {
  list-style: none;
  padding-left: 0 !important;
  counter-reset: step;
}
.steps > li {
  position: relative;
  padding-left: 40px;
  margin: 0 0 28px !important;
  counter-increment: step;
}
.steps > li::before {
  content: counter(step);
  position: absolute;
  left: 0;
  top: 0;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  font-weight: 700;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.steps h3 {
  margin: 0 0 6px !important;
  padding-top: 1px;
  font-size: 17px;
}
.steps p {
  margin: 6px 0 !important;
}
.file {
  margin-top: 12px;
}
.file-name {
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: var(--vp-c-text-2);
  margin-bottom: -8px;
}
@media (max-width: 640px) {
  .steps > li {
    padding-left: 0;
  }
  .steps > li::before {
    position: static;
    margin-bottom: 6px;
  }
}
</style>
