/**
 * @extension-use/host/ui
 *
 * A ready-made control panel for an extension page (options page, popup, or a
 * tab in your side panel): pair with a relay, see who is connected, pause all
 * control, and review recent activity.
 *
 *   import { mountControlPanel } from "@extension-use/host/ui";
 *   mountControlPanel(document.getElementById("panel")!);
 */
import { UI_PORT, type UiCommand, type UiState } from "../wire.js";

export interface ControlPanelOptions {
  /** Default device name offered when pairing. */
  deviceName?: string;
}

const CSS = `
:host { all: initial; display: block; font: 13px/1.45 system-ui, sans-serif; color: var(--fg); --fg: #111827; --muted: #6b7280; --bg: #fff; --card: #f9fafb; --border: #e5e7eb; --accent: #7c3aed; --danger: #dc2626; --ok: #059669; }
@media (prefers-color-scheme: dark) { :host { --fg: #e5e7eb; --muted: #9ca3af; --bg: #111318; --card: #181b22; --border: #2a2f3a; --accent: #a78bfa; --danger: #f87171; --ok: #34d399; } }
* { box-sizing: border-box; }
section { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 12px; margin-bottom: 10px; }
h2 { font-size: 13px; margin: 0 0 8px; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.muted { color: var(--muted); }
.row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.row.spaced { margin-top: 6px; }
input { flex: 1; min-width: 120px; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: inherit; font: inherit; }
button { padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); color: inherit; font: inherit; cursor: pointer; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button.danger { color: var(--danger); }
.code { font: 600 26px/1.2 ui-monospace, monospace; letter-spacing: 2px; margin: 6px 0; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--muted); margin-right: 6px; }
.dot.on { background: var(--ok); } .dot.busy { background: #f59e0b; } .dot.off { background: var(--danger); }
ul { list-style: none; margin: 0; padding: 0; }
li { padding: 3px 0; border-top: 1px solid var(--border); display: flex; justify-content: space-between; gap: 8px; }
li:first-child { border-top: 0; }
.err { color: var(--danger); }
.pill { font-size: 11px; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--border); }
`;

export function mountControlPanel(container: HTMLElement, options: ControlPanelOptions = {}) {
  const root = container.attachShadow ? container.attachShadow({ mode: "open" }) : container;
  const style = document.createElement("style");
  style.textContent = CSS;
  const view = document.createElement("div");
  root.append(style, view);

  let port: chrome.runtime.Port | undefined;
  let state: UiState | undefined;
  let relayDraft: string | undefined;
  let nameDraft = options.deviceName ?? defaultDeviceName();

  const send = (cmd: UiCommand) => port?.postMessage(cmd);

  function connectPort() {
    port = chrome.runtime.connect({ name: UI_PORT });
    port.onMessage.addListener((s: UiState) => {
      state = s;
      render();
    });
    // The service worker may restart; reconnect so the panel stays live.
    port.onDisconnect.addListener(() => setTimeout(connectPort, 500));
  }

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {}, ...children: (Node | string | undefined | false)[]) => {
    const node = document.createElement(tag);
    const { class: cls, ...rest } = props;
    Object.assign(node, rest);
    if (cls) node.className = cls;
    for (const c of children) if (c) node.append(c);
    return node;
  };
  const button = (label: string, onClick: () => void, cls = "") => el("button", { class: cls, onclick: onClick, type: "button" }, label);
  const time = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  function render() {
    if (!state) {
      view.replaceChildren(el("p", { class: "muted" }, "Connecting to the extension…"));
      return;
    }
    const s = state;
    const parts: Node[] = [];

    // Kill switch
    parts.push(
      el(
        "section",
        {},
        el("h2", {}, el("span", {}, s.paused ? "Control is paused" : "Control is on"), s.paused ? button("Resume", () => send({ cmd: "resume" }), "primary") : button("Pause all control", () => send({ cmd: "pause" }), "danger")),
        el("p", { class: "muted" }, s.paused ? "No web app, website or remote script can act on your tabs until you resume." : "Stop every controller at once, right now."),
      ),
    );

    // Remote
    if (s.remote) {
      const r = s.remote;
      const link = r.link;
      const status = !r.paired ? "Not paired" : link?.status === "connected" ? `Connected to ${link.relay}` : link?.status === "connecting" ? "Connecting…" : link?.status === "unauthorized" ? "The relay no longer knows this browser" : "Disconnected (retrying)";
      const dot = !r.paired ? "" : link?.status === "connected" ? "on" : link?.status === "unauthorized" ? "off" : "busy";
      const remoteParts: (Node | false)[] = [el("h2", {}, el("span", {}, el("span", { class: `dot ${dot}` }), "Remote control"), el("span", { class: "muted" }, status))];

      if (r.pairing && r.pairing.status === "pending") {
        remoteParts.push(
          el("p", {}, "Confirm this code on the relay:"),
          el("div", { class: "code" }, r.pairing.code),
          el("p", { class: "muted" }, `Waiting for approval at ${r.pairing.relay}…`),
          button("Cancel", () => send({ cmd: "cancel-pairing" })),
        );
      } else if (!r.paired) {
        const relayInput = el("input", { value: relayDraft ?? r.defaultRelay, placeholder: "http://127.0.0.1:7777", oninput: (e: Event) => (relayDraft = (e.target as HTMLInputElement).value) } as Partial<HTMLInputElement>);
        relayInput.setAttribute("aria-label", "Relay URL");
        const nameInput = el("input", { value: nameDraft, oninput: (e: Event) => (nameDraft = (e.target as HTMLInputElement).value) } as Partial<HTMLInputElement>);
        nameInput.setAttribute("aria-label", "Name for this browser");
        remoteParts.push(
          el("p", { class: "muted" }, "Let scripts and agents you trust drive this browser through a relay. Start one with: npx @extension-use/relay"),
          el("div", { class: "row" }, relayInput),
          el("div", { class: "row spaced" }, nameInput, button("Connect to relay", () => send({ cmd: "pair", relay: relayInput.value, name: nameInput.value }), "primary")),
          r.pairing ? el("p", { class: "err" }, r.pairing.status === "denied" ? "The relay denied the request." : r.pairing.status === "expired" ? "The code expired. Try again." : `Pairing failed: ${r.pairing.error ?? ""}`) : false,
        );
      } else {
        remoteParts.push(
          el("p", {}, link?.name ? `This browser is "${link.name}"` : "", link?.deviceId ? el("span", { class: "muted" }, ` (${link.deviceId})`) : ""),
          link?.error ? el("p", { class: "err" }, link.error) : false,
          el("div", { class: "row" }, link?.status !== "connected" ? button("Reconnect", () => send({ cmd: "reconnect" })) : false, button("Disconnect and forget", () => send({ cmd: "unpair" }), "danger")),
        );
      }
      parts.push(el("section", {}, ...remoteParts.filter(Boolean)));
    }

    // Sessions
    parts.push(
      el(
        "section",
        {},
        el("h2", {}, el("span", {}, "Connected controllers"), el("span", { class: "pill" }, String(s.sessions.length))),
        s.sessions.length
          ? el("ul", {}, ...s.sessions.map((x) => el("li", {}, el("span", {}, x.origin), el("span", { class: "muted" }, x.transport))))
          : el("p", { class: "muted" }, "None right now."),
      ),
    );

    // Activity
    parts.push(
      el(
        "section",
        {},
        el("h2", {}, el("span", {}, "Recent activity")),
        s.audit.length
          ? el(
              "ul",
              {},
              ...s.audit.slice(0, 15).map((a) =>
                el("li", {}, el("span", {}, `${time(a.ts)} ${a.action}`), el("span", { class: a.ok ? "muted" : "err" }, a.ok ? `${a.origin} · ${a.ms} ms` : `${a.code} · ${a.origin}`)),
              ),
            )
          : el("p", { class: "muted" }, "Nothing yet."),
      ),
    );

    if (s.error) parts.unshift(el("p", { class: "err" }, s.error));
    view.replaceChildren(...parts);
  }

  render();
  connectPort();
  return {
    destroy() {
      port?.disconnect();
      view.remove();
    },
  };
}

function defaultDeviceName() {
  const ua = navigator.userAgent;
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : /CrOS/.test(ua) ? "ChromeOS" : "this computer";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : "Browser";
  return `${browser} on ${os}`;
}
