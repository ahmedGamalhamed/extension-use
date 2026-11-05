import { ExtensionUseError, randomId } from "@extension-use/protocol";
import type { ContentGroup } from "./context.js";
import { OVERLAY_HOST_ID, type In } from "./dom.js";
import { nameOf, roleOf } from "./aria.js";
import { cssPath, describe, findAll, refFor, resolve } from "./locator.js";

// ---------------------------------------------------------------------------
// Overlay root: one fixed, click-through layer in a shadow root
// ---------------------------------------------------------------------------

const STYLE = `
:host { all: initial; }
.layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; font: 13px/1.4 system-ui, sans-serif; }
.box { position: fixed; box-sizing: border-box; border: 2px solid var(--c); background: color-mix(in srgb, var(--c) 12%, transparent); border-radius: 3px; transition: all 60ms linear; }
.label { position: absolute; left: -2px; bottom: 100%; margin-bottom: 2px; background: var(--c); color: #fff; padding: 1px 6px; border-radius: 3px; font-size: 12px; white-space: nowrap; max-width: 320px; overflow: hidden; text-overflow: ellipsis; }
.box.below .label { bottom: auto; top: 100%; margin: 2px 0 0; }
.toasts { position: fixed; right: 16px; bottom: 16px; display: flex; flex-direction: column; gap: 8px; align-items: flex-end; }
.toast { background: #1f2937; color: #f9fafb; padding: 8px 12px; border-radius: 8px; box-shadow: 0 4px 16px rgb(0 0 0 / 25%); max-width: 360px; border-left: 4px solid #60a5fa; }
.toast.success { border-left-color: #34d399; }
.toast.error { border-left-color: #f87171; }
.banner { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); background: #111827; color: #fff; padding: 8px 14px; border-radius: 999px; box-shadow: 0 4px 16px rgb(0 0 0 / 30%); }
.banner kbd { background: #374151; border-radius: 4px; padding: 0 5px; font: inherit; }
`;

let layer: HTMLElement | undefined;

function overlayLayer(): HTMLElement {
  if (layer?.isConnected) return layer;
  const host = document.createElement("div");
  host.id = OVERLAY_HOST_ID;
  host.setAttribute("aria-hidden", "true");
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = STYLE;
  layer = document.createElement("div");
  layer.className = "layer";
  shadow.append(style, layer);
  document.documentElement.append(host);
  return layer;
}

// ---------------------------------------------------------------------------
// Highlights
// ---------------------------------------------------------------------------

interface Highlight {
  boxes: { el: Element; div: HTMLElement }[];
  timer?: ReturnType<typeof setTimeout>;
}

const highlights = new Map<string, Highlight>();
let raf = 0;

function place(div: HTMLElement, el: Element) {
  const r = el.getBoundingClientRect();
  const hidden = !el.isConnected || (r.width === 0 && r.height === 0);
  div.style.display = hidden ? "none" : "block";
  div.style.left = `${r.left - 2}px`;
  div.style.top = `${r.top - 2}px`;
  div.style.width = `${r.width + 4}px`;
  div.style.height = `${r.height + 4}px`;
  div.classList.toggle("below", r.top < 24);
}

function tick() {
  for (const h of highlights.values()) for (const b of h.boxes) place(b.div, b.el);
  raf = highlights.size ? requestAnimationFrame(tick) : 0;
}

function makeBox(el: Element, color: string, label?: string) {
  const div = document.createElement("div");
  div.className = "box";
  div.style.setProperty("--c", color);
  if (label) {
    const l = document.createElement("div");
    l.className = "label";
    l.textContent = label;
    div.append(l);
  }
  overlayLayer().append(div);
  place(div, el);
  return div;
}

function clearHighlight(id?: string) {
  for (const [key, h] of highlights) {
    if (id !== undefined && key !== id) continue;
    clearTimeout(h.timer);
    for (const b of h.boxes) b.div.remove();
    highlights.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Picker
// ---------------------------------------------------------------------------

let activePicker: AbortController | undefined;

function pickLocator(el: Element) {
  const role = roleOf(el);
  const name = nameOf(el);
  const testId = el.getAttribute("data-testid") ?? el.getAttribute("data-test-id");
  const text = ((el as HTMLElement).innerText ?? "").replace(/\s+/g, " ").trim();
  return {
    css: cssPath(el),
    ...(role !== "generic" ? { role } : {}),
    ...(name && role !== "generic" ? { name } : {}),
    ...(testId ? { testId } : {}),
    ...(text && text.length <= 80 ? { text } : {}),
  };
}

export const overlayContent: ContentGroup = {
  name: "overlay",
  handlers: {
    "overlay.highlight": async (input: In<"overlay.highlight">, ctx) => {
      await resolve(input.locator, { timeoutMs: ctx.timeoutMs, signal: ctx.signal, visible: false });
      let els = findAll(input.locator);
      if (!input.all) els = els.slice(input.locator.nth ?? 0, (input.locator.nth ?? 0) + 1);
      const id = input.id ?? randomId();
      clearHighlight(id);
      const h: Highlight = { boxes: els.map((el, i) => ({ el, div: makeBox(el, input.color, input.label && els.length > 1 ? `${input.label} ${i + 1}` : input.label) })) };
      if (input.durationMs > 0) h.timer = setTimeout(() => clearHighlight(id), input.durationMs);
      highlights.set(id, h);
      if (!raf) raf = requestAnimationFrame(tick);
      return { id, count: els.length };
    },
    "overlay.clear": (input: In<"overlay.clear">) => {
      clearHighlight(input.id);
      return {};
    },
    "overlay.toast": (input: In<"overlay.toast">) => {
      const root = overlayLayer();
      let stack = root.querySelector<HTMLElement>(".toasts");
      if (!stack) {
        stack = document.createElement("div");
        stack.className = "toasts";
        root.append(stack);
      }
      const toast = document.createElement("div");
      toast.className = `toast ${input.kind}`;
      toast.setAttribute("role", "status");
      toast.textContent = input.message;
      stack.append(toast);
      setTimeout(() => toast.remove(), input.durationMs);
      return {};
    },
  },
};

export const pickerContent: ContentGroup = {
  name: "picker",
  handlers: {
    "picker.start": (input: In<"picker.start">, ctx) => {
      activePicker?.abort(new ExtensionUseError("CANCELLED", "Another picker started"));
      const controller = new AbortController();
      activePicker = controller;

      return new Promise((resolvePick, reject) => {
        const root = overlayLayer();
        const banner = document.createElement("div");
        banner.className = "banner";
        banner.append(input.prompt ?? "Click an element to select it", " · ");
        const kbd = document.createElement("kbd");
        kbd.textContent = "Esc";
        banner.append(kbd, " to cancel");
        root.append(banner);

        let hovered: Element | undefined;
        const box = makeBox(document.body, "#2563eb");
        box.style.display = "none";

        const isOurs = (el: Element | null) => !el || el.id === OVERLAY_HOST_ID;

        const onMove = (e: MouseEvent) => {
          const el = document.elementFromPoint(e.clientX, e.clientY);
          if (isOurs(el) || el === hovered) return;
          hovered = el!;
          place(box, hovered);
          const role = roleOf(hovered);
          const label = box.querySelector(".label") ?? box.appendChild(Object.assign(document.createElement("div"), { className: "label" }));
          label.textContent = `${hovered.tagName.toLowerCase()}${role !== "generic" ? ` · ${role}` : ""}`;
          ctx.emit("picker.hovered", { ref: refFor(hovered), role, name: nameOf(hovered) });
        };
        const swallow = (e: Event) => {
          e.preventDefault();
          e.stopImmediatePropagation();
        };
        const onClick = (e: MouseEvent) => {
          swallow(e);
          const el = document.elementFromPoint(e.clientX, e.clientY);
          if (isOurs(el)) return;
          const locator = pickLocator(el!);
          const result = { ref: refFor(el!), locator, element: describe(el!) };
          ctx.emit("picker.selected", { ref: result.ref, locator, url: location.href });
          cleanup();
          resolvePick(result);
        };
        const onKey = (e: KeyboardEvent) => {
          if (e.key !== "Escape") return;
          swallow(e);
          cleanup();
          reject(new ExtensionUseError("CANCELLED", "The person cancelled the picker"));
        };
        const onAbort = () => {
          cleanup();
          reject(controller.signal.aborted ? controller.signal.reason : ctx.signal.reason);
        };

        const opts = { capture: true } as const;
        const blocked = ["mousedown", "mouseup", "pointerdown", "pointerup", "dblclick", "contextmenu"] as const;
        function cleanup() {
          window.removeEventListener("mousemove", onMove, opts);
          window.removeEventListener("click", onClick, opts);
          window.removeEventListener("keydown", onKey, opts);
          for (const t of blocked) window.removeEventListener(t, swallow, opts);
          ctx.signal.removeEventListener("abort", onAbort);
          controller.signal.removeEventListener("abort", onAbort);
          banner.remove();
          box.remove();
          if (activePicker === controller) activePicker = undefined;
        }

        window.addEventListener("mousemove", onMove, opts);
        window.addEventListener("click", onClick, opts);
        window.addEventListener("keydown", onKey, opts);
        for (const t of blocked) window.addEventListener(t, swallow, opts);
        ctx.signal.addEventListener("abort", onAbort, { once: true });
        controller.signal.addEventListener("abort", onAbort, { once: true });
      });
    },
    "picker.cancel": () => {
      activePicker?.abort(new ExtensionUseError("CANCELLED", "Picker cancelled by controller"));
      return {};
    },
  },
};
