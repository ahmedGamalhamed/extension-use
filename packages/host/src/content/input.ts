/**
 * Interactions beyond click and type: drag and drop, file upload, scrolling
 * inside elements, mouse wheel, text selection, paste, blur and low-level
 * pointer events. All events are synthetic (isTrusted false).
 */
import { ExtensionUseError } from "@extension-use/protocol";
import type { ContentContext, ContentHandler } from "./context.js";
import {
  center,
  find,
  focusTarget,
  guardSensitive,
  hoverSequence,
  insertText,
  isTextField,
  mouse,
  pointer,
  prepare,
  OVERLAY_HOST_ID,
  type In,
} from "./dom.js";
import { refFor } from "./locator.js";

type Point = { clientX: number; clientY: number };

/** The element under a viewport point, ignoring our own overlay. */
function elementAt(p: Point): Element {
  const hits = document.elementsFromPoint(p.clientX, p.clientY);
  return hits.find((e) => e.id !== OVERLAY_HOST_ID && !e.closest(`#${OVERLAY_HOST_ID}`)) ?? document.body;
}

function dragEvent(el: Element, type: string, dataTransfer: DataTransfer, p: Point) {
  return el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, composed: true, view: window, dataTransfer, ...p }));
}

const lerp = (a: Point, b: Point, t: number): Point => ({ clientX: a.clientX + (b.clientX - a.clientX) * t, clientY: a.clientY + (b.clientY - a.clientY) * t });
// Background tabs pause requestAnimationFrame and throttle timers to ~1 s, so
// waits must not depend on either alone.
/** Let the page's task queue run between steps (not throttled in background tabs). */
const yieldTask = () =>
  new Promise<void>((r) => {
    const c = new MessageChannel();
    c.port1.onmessage = () => r();
    c.port2.postMessage(0);
  });
/** Let scroll listeners run: the next frame, or a short wait when the tab is hidden. */
const settle = () => Promise.race([new Promise<void>((r) => requestAnimationFrame(() => r())), new Promise<void>((r) => setTimeout(r, 50))]);

function isScrollable(el: Element, axis: "x" | "y" | "any" = "any") {
  if (el === document.scrollingElement) return true;
  const s = getComputedStyle(el);
  const canY = /(auto|scroll|overlay)/.test(s.overflowY) && el.scrollHeight > el.clientHeight;
  const canX = /(auto|scroll|overlay)/.test(s.overflowX) && el.scrollWidth > el.clientWidth;
  return axis === "y" ? canY : axis === "x" ? canX : canX || canY;
}

/** The element itself if it scrolls, else the nearest scrolling ancestor, else the page. */
function scrollContainer(el: Element, axis: "x" | "y" | "any" = "any"): Element {
  let node: Element | null = el;
  while (node) {
    if (isScrollable(node, axis)) return node;
    node = node.parentElement ?? ((node.getRootNode() as ShadowRoot).host as Element | undefined) ?? null;
  }
  return document.scrollingElement ?? document.documentElement;
}

function scrollMetrics(el: Element) {
  return { scrollTop: el.scrollTop, scrollLeft: el.scrollLeft, scrollHeight: el.scrollHeight, scrollWidth: el.scrollWidth, clientHeight: el.clientHeight, clientWidth: el.clientWidth };
}

function base64ToBytes(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Text nodes under an element, and how to map character offsets to them. */
function textRange(el: Element, start: number, end: number): Range | undefined {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let offset = 0;
  let started = false;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const len = n.data.length;
    if (!started && start <= offset + len) {
      range.setStart(n, start - offset);
      started = true;
    }
    if (started && end <= offset + len) {
      range.setEnd(n, end - offset);
      return range;
    }
    offset += len;
  }
  return undefined;
}

// Low-level pointer state across dom.pointer calls.
let pressedButtons = 0;

export const inputHandlers: Record<string, ContentHandler> = {
  "dom.blur": async (input: In<"dom.blur">, ctx: ContentContext) => {
    const el = input.locator ? await find(input.locator, ctx, false) : focusTarget();
    (el as HTMLElement).blur?.();
    return el === document.body ? {} : { ref: refFor(el) };
  },

  "dom.drag": async (input: In<"dom.drag">, ctx: ContentContext) => {
    const src = await find(input.from, ctx);
    prepare(src);
    const dst = input.to ? await find(input.to, ctx) : undefined;
    if (dst) dst.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    const start = center(src);
    const end = dst ? center(dst) : { clientX: start.clientX + input.offset!.x, clientY: start.clientY + input.offset!.y };

    hoverSequence(src);
    pointer(src, "pointerdown", { ...start, button: 0, buttons: 1 });
    mouse(src, "mousedown", { ...start, button: 0, buttons: 1, detail: 1 });

    const draggable = src.closest('[draggable="true"]');
    let html5 = false;
    if (draggable) {
      // HTML5 drag and drop: the page reads the DataTransfer it filled in dragstart.
      const dataTransfer = new DataTransfer();
      if (dragEvent(draggable, "dragstart", dataTransfer, start)) {
        html5 = true;
        let over: Element | undefined;
        let dropAllowed = false;
        for (let i = 1; i <= input.steps; i++) {
          if (ctx.signal.aborted) throw ctx.signal.reason;
          const p = lerp(start, end, i / input.steps);
          const target = i === input.steps && dst ? dst : elementAt(p);
          dragEvent(draggable, "drag", dataTransfer, p);
          if (target !== over) {
            if (over) dragEvent(over, "dragleave", dataTransfer, p);
            dragEvent(target, "dragenter", dataTransfer, p);
            over = target;
          }
          // A drop happens only if the target cancelled dragover (that's how pages accept drops).
          dropAllowed = !dragEvent(target, "dragover", dataTransfer, p);
          await yieldTask();
        }
        if (over && dropAllowed) dragEvent(over, "drop", dataTransfer, end);
        else if (over) dragEvent(over, "dragleave", dataTransfer, end);
        dragEvent(draggable, "dragend", dataTransfer, end);
      }
    }
    if (!html5) {
      // Pointer-driven dragging (sliders, sortable libraries, canvases).
      for (let i = 1; i <= input.steps; i++) {
        if (ctx.signal.aborted) throw ctx.signal.reason;
        const p = lerp(start, end, i / input.steps);
        const target = elementAt(p);
        pointer(target, "pointermove", { ...p, buttons: 1 });
        mouse(target, "mousemove", { ...p, buttons: 1 });
        await yieldTask();
      }
    }
    const last = dst ?? elementAt(end);
    pointer(last, "pointerup", { ...end, button: 0, buttons: 0 });
    mouse(last, "mouseup", { ...end, button: 0, buttons: 0, detail: 1 });
    return { from: refFor(src), ...(dst ? { to: refFor(dst) } : {}), html5 };
  },

  "dom.upload": async (input: In<"dom.upload">, ctx: ContentContext) => {
    // File inputs are often hidden behind a styled button, so don't require visibility.
    const el = await find(input.locator, ctx, false);
    const total = input.files.reduce((n, f) => n + (f.text?.length ?? Math.ceil(((f.base64?.length ?? 0) * 3) / 4)), 0);
    if (total > 25 * 1024 * 1024) throw new ExtensionUseError("INVALID_INPUT", "Files are limited to 25 MB in total");
    const files = input.files.map((f) => new File([f.text !== undefined ? f.text : base64ToBytes(f.base64!)], f.name, { type: f.mimeType, lastModified: Date.now() }));
    const dataTransfer = new DataTransfer();
    for (const f of files) dataTransfer.items.add(f);

    const fileInput =
      el instanceof HTMLInputElement && el.type === "file"
        ? el
        : el instanceof HTMLLabelElement && el.control instanceof HTMLInputElement && el.control.type === "file"
          ? el.control
          : el.querySelector<HTMLInputElement>('input[type="file"]');
    if (fileInput) {
      if (fileInput.disabled) throw new ExtensionUseError("INVALID_INPUT", "The file input is disabled");
      if (!fileInput.multiple && files.length > 1) throw new ExtensionUseError("INVALID_INPUT", "This file input takes one file");
      fileInput.files = dataTransfer.files;
      fileInput.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      return { ref: refFor(fileInput), files: files.length, via: "input" as const };
    }
    // A drop zone.
    prepare(el);
    const p = center(el);
    dragEvent(el, "dragenter", dataTransfer, p);
    dragEvent(el, "dragover", dataTransfer, p);
    dragEvent(el, "drop", dataTransfer, p);
    return { ref: refFor(el), files: files.length, via: "drop" as const };
  },

  "dom.scroll": async (input: In<"dom.scroll">, ctx: ContentContext) => {
    const el = await find(input.locator, ctx, false);
    const box = scrollContainer(el, input.y !== undefined || input.to === "top" || input.to === "bottom" ? "y" : input.x !== undefined ? "x" : "any");
    const behavior = input.behavior as ScrollBehavior;
    if (input.to === "top") box.scrollTo({ top: 0, behavior });
    else if (input.to === "bottom") box.scrollTo({ top: box.scrollHeight, behavior });
    else if (input.to === "left") box.scrollTo({ left: 0, behavior });
    else if (input.to === "right") box.scrollTo({ left: box.scrollWidth, behavior });
    else if (input.by) box.scrollBy({ left: input.x ?? 0, top: input.y ?? 0, behavior });
    else box.scrollTo({ ...(input.x !== undefined ? { left: input.x } : {}), ...(input.y !== undefined ? { top: input.y } : {}), behavior });
    // Let scroll listeners (infinite lists) run before reporting.
    await settle();
    return { ref: refFor(box), ...scrollMetrics(box) };
  },

  "dom.wheel": async (input: In<"dom.wheel">, ctx: ContentContext) => {
    const el = input.locator ? await find(input.locator, ctx) : elementAt({ clientX: window.innerWidth / 2, clientY: window.innerHeight / 2 });
    const p = center(el);
    const dx = input.deltaX / input.steps;
    const dy = input.deltaY / input.steps;
    hoverSequence(el);
    let box: Element | undefined;
    const before = new Map<Element, [number, number]>();
    for (let i = 0; i < input.steps; i++) {
      if (ctx.signal.aborted) throw ctx.signal.reason;
      const notCancelled = el.dispatchEvent(new WheelEvent("wheel", { deltaX: dx, deltaY: dy, deltaMode: WheelEvent.DOM_DELTA_PIXEL, bubbles: true, cancelable: true, composed: true, view: window, ...p }));
      // Synthetic wheel events don't scroll by themselves; do what the browser would.
      if (notCancelled) {
        box = scrollContainer(el, dy !== 0 ? "y" : "x");
        if (!before.has(box)) before.set(box, [box.scrollTop, box.scrollLeft]);
        box.scrollBy({ left: dx, top: dy, behavior: "instant" });
      }
      await settle();
    }
    const scrolled = [...before.entries()].some(([b, [t, l]]) => b.scrollTop !== t || b.scrollLeft !== l);
    const metrics = box ?? document.scrollingElement ?? document.documentElement;
    return { ...(el !== document.body ? { ref: refFor(el) } : {}), scrolled, scrollTop: metrics.scrollTop, scrollLeft: metrics.scrollLeft };
  },

  "dom.selectText": async (input: In<"dom.selectText">, ctx: ContentContext) => {
    const el = await find(input.locator, ctx);
    if (isTextField(el)) {
      const value = el.value;
      let start = input.start ?? 0;
      let end = input.end ?? value.length;
      if (input.text !== undefined) {
        start = value.indexOf(input.text);
        if (start < 0) throw new ExtensionUseError("ELEMENT_NOT_FOUND", `"${input.text}" is not in the field`);
        end = start + input.text.length;
      }
      el.focus();
      try {
        el.setSelectionRange(Math.min(start, value.length), Math.min(end, value.length));
      } catch {
        el.select(); // email/number inputs only support selecting everything
      }
      return { ref: refFor(el), selected: value.slice(el.selectionStart ?? 0, el.selectionEnd ?? value.length) };
    }
    const text = el.textContent ?? "";
    let start = input.start ?? 0;
    let end = input.end ?? text.length;
    if (input.text !== undefined) {
      start = text.indexOf(input.text);
      if (start < 0) throw new ExtensionUseError("ELEMENT_NOT_FOUND", `"${input.text}" is not in the element`);
      end = start + input.text.length;
    }
    const range = textRange(el, Math.min(start, text.length), Math.min(end, text.length));
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    if (range) selection.addRange(range);
    else selection.selectAllChildren(el);
    return { ref: refFor(el), selected: selection.toString() };
  },

  "dom.paste": async (input: In<"dom.paste">, ctx: ContentContext) => {
    const el = input.locator ? await find(input.locator, ctx) : focusTarget();
    guardSensitive(el, ctx);
    if (input.locator) (el as HTMLElement).focus();
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", input.text);
    const handledByPage = !el.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true, composed: true }));
    if (!handledByPage && (isTextField(el) || (el as HTMLElement).isContentEditable)) insertText(el, input.text);
    return { ref: refFor(el), handledByPage };
  },

  "dom.pointer": async (input: In<"dom.pointer">, ctx: ContentContext) => {
    const el = input.locator ? await find(input.locator, ctx) : undefined;
    const p = el ? center(el) : { clientX: input.x!, clientY: input.y! };
    const target = el ?? elementAt(p);
    const button = input.button === "middle" ? 1 : input.button === "right" ? 2 : 0;
    const mask = button === 0 ? 1 : button === 1 ? 4 : 2;
    if (input.type === "down") {
      pressedButtons |= mask;
      pointer(target, "pointerdown", { ...p, button, buttons: pressedButtons });
      if (mouse(target, "mousedown", { ...p, button, buttons: pressedButtons, detail: 1 }) && target instanceof HTMLElement) target.focus({ preventScroll: true });
    } else if (input.type === "move") {
      pointer(target, "pointermove", { ...p, buttons: pressedButtons });
      mouse(target, "mousemove", { ...p, buttons: pressedButtons });
    } else {
      pressedButtons &= ~mask;
      pointer(target, "pointerup", { ...p, button, buttons: pressedButtons });
      mouse(target, "mouseup", { ...p, button, buttons: pressedButtons, detail: 1 });
    }
    return { ...(el ? { ref: refFor(el) } : {}), x: p.clientX, y: p.clientY };
  },
};
