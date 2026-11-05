/**
 * Example controller: a plain web app that drives the extension.
 * - Inside the side panel it connects through the frame transport.
 * - Opened in a normal tab it connects through the page transport.
 */
import { connect, ExtensionUseError, type Client, type Target } from "@extension-use/client";
import { frame, inExtensionFrame } from "@extension-use/client/frame";
import { page } from "@extension-use/client/page";

declare const DEV_EXTENSION_ID: string;

const params = new URLSearchParams(location.search);
const extensionId = params.get("ext") ?? DEV_EXTENSION_ID;
const mode = window.parent !== window ? "frame" : "page";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const logEl = $("#log");
const statusEl = $("#status");

function log(label: string, data?: unknown, isError = false) {
  const entry = document.createElement("div");
  entry.className = `entry${isError ? " error" : ""}`;
  const head = document.createElement("strong");
  head.textContent = label;
  entry.append(head);
  if (data !== undefined) {
    const pre = document.createElement("pre");
    const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
    pre.textContent = text.length > 4000 ? `${text.slice(0, 4000)}\n…` : text;
    entry.append(pre);
  }
  logEl.prepend(entry);
}

const target = (): Target | undefined => {
  const v = $<HTMLInputElement>("#target").value.trim();
  return v ? { tab: { urlMatch: v } } : undefined;
};

async function run<T>(label: string, fn: () => Promise<T>) {
  try {
    const out = await fn();
    log(label, out);
    return out;
  } catch (err) {
    log(label, err instanceof ExtensionUseError ? `${err.code}: ${err.message}` : String(err), true);
    throw err;
  }
}

async function start(): Promise<Client> {
  statusEl.textContent = `Connecting (${mode})…`;
  const transport = mode === "frame" ? frame() : page({ extensionId });
  const ext = await connect(transport, { name: "example-controller", version: "0.1.0" });
  statusEl.textContent = `Connected via ${mode} to ${ext.host.name ?? ext.host.id} ${ext.host.version ?? ""} · ${ext.capabilities.length} actions`;
  statusEl.className = "ok";

  ext.on("picker.selected", (p) => log("event: picker.selected", p));
  ext.on("tab.activated", (p) => log("event: tab.activated", p));
  ext.onDisconnect((reason) => {
    statusEl.textContent = `Disconnected: ${reason ?? "unknown"}`;
    statusEl.className = "error";
  });

  const opt = () => ({ target: target() });
  const locator = () => {
    const v = $<HTMLInputElement>("#locator").value.trim();
    if (/^e\d+$/.test(v)) return { ref: v };
    const m = /^(\w+)\s+"(.+)"$/.exec(v); // role "name"
    if (m) return { role: m[1]!, name: m[2]! };
    return { css: v || "body" };
  };

  const actions: Record<string, () => Promise<unknown>> = {
    info: () => ext.page.info({}, opt()),
    snapshot: async () => (await ext.dom.snapshot({ format: "text" }, opt())).text,
    tabs: () => ext.tabs.list({ currentWindow: true }),
    highlight: () => ext.overlay.highlight({ locator: locator(), all: true, label: "match", durationMs: 4000 }, opt()),
    click: () => ext.dom.click({ locator: locator() }, opt()),
    pick: () => ext.picker.start({ prompt: "Pick something" }, opt()),
    toast: () => ext.overlay.toast({ message: "Hello from the controller", kind: "success" }, opt()),
    screenshot: async () => {
      const shot = await ext.capture.screenshot({}, opt());
      const img = Object.assign(document.createElement("img"), { src: shot.dataUrl, className: "shot" });
      logEl.prepend(img);
      return { width: shot.width, height: shot.height };
    },
  };
  for (const [name, fn] of Object.entries(actions)) {
    const btn = document.querySelector<HTMLButtonElement>(`[data-action="${name}"]`);
    if (!btn) continue;
    btn.disabled = false;
    btn.onclick = () => void run(name, fn).catch(() => {});
  }
  return ext;
}

declare global {
  interface Window {
    ext?: Client;
    extReady: Promise<Client>;
    storageProbe(): Promise<Record<string, unknown>>;
  }
}

window.extReady = start();
window.extReady.then(
  (ext) => (window.ext = ext),
  (err) => {
    statusEl.textContent = `Not connected: ${err.message}`;
    statusEl.className = "error";
  },
);

/** Spike: what storage works for this app when framed by an extension page? */
window.storageProbe = async () => {
  const result: Record<string, unknown> = { mode, inExtensionFrame: inExtensionFrame() };
  try {
    localStorage.setItem("eu-probe", "1");
    result.localStorage = localStorage.getItem("eu-probe") === "1";
  } catch (e) {
    result.localStorage = String(e);
  }
  try {
    result.indexedDB = await new Promise((resolve) => {
      const req = indexedDB.open("eu-probe", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("kv");
      req.onsuccess = () => {
        req.result.close();
        resolve(true);
      };
      req.onerror = () => resolve(String(req.error));
    });
  } catch (e) {
    result.indexedDB = String(e);
  }
  document.cookie = `eu_probe_${mode}=1; path=/; SameSite=None; Secure`;
  document.cookie = `eu_probe_lax_${mode}=1; path=/`;
  result.cookies = document.cookie;
  result.hasStorageAccess = "hasStorageAccess" in document ? await document.hasStorageAccess() : "unsupported";
  const res = await fetch("/__cookies", { credentials: "include" }).then((r) => r.text(), (e) => String(e));
  result.cookiesSeenByServer = res;
  return result;
};
