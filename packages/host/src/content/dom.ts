import { ExtensionUseError, matchPattern, type Locator } from "@extension-use/protocol";
import type { coreActionSchemas, SnapshotNode } from "@extension-use/protocol/schemas";
import type * as z from "zod";
import { INTERACTIVE_ROLES, isDisabled, isSensitive, isVisible, nameOf, roleOf } from "./aria.js";
import type { ContentContext, ContentGroup } from "./context.js";
import { describe, findAll, refFor, resolve } from "./locator.js";

/** Parsed input (defaults applied) of a built-in action. */
export type In<K extends keyof typeof coreActionSchemas> = z.output<(typeof coreActionSchemas)[K]["input"]>;
type Mods = ("Alt" | "Control" | "Meta" | "Shift")[];

const find = (locator: Locator, ctx: ContentContext, visible = true) => resolve(locator, { timeoutMs: ctx.timeoutMs, signal: ctx.signal, visible });

// ---------------------------------------------------------------------------
// Synthetic input
// ---------------------------------------------------------------------------

function center(el: Element) {
  const r = el.getBoundingClientRect();
  return { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
}

function modifierFlags(mods: Mods = []) {
  return { altKey: mods.includes("Alt"), ctrlKey: mods.includes("Control"), metaKey: mods.includes("Meta"), shiftKey: mods.includes("Shift") };
}

function pointer(el: Element, type: string, init: PointerEventInit) {
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: "mouse", isPrimary: true, view: window, ...init }));
}

function mouse(el: Element, type: string, init: MouseEventInit) {
  return el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: window, ...init }));
}

function hoverSequence(el: Element) {
  const pos = center(el);
  for (const t of ["pointerover", "pointerenter", "pointermove"]) pointer(el, t, { ...pos, bubbles: t !== "pointerenter" });
  for (const t of ["mouseover", "mouseenter", "mousemove"]) mouse(el, t, { ...pos, bubbles: t !== "mouseenter" });
}

async function waitEnabled(el: Element, ctx: ContentContext) {
  const deadline = Date.now() + ctx.timeoutMs;
  while (isDisabled(el)) {
    if (Date.now() >= deadline) throw new ExtensionUseError("TIMEOUT", "The element stayed disabled");
    if (ctx.signal.aborted) throw ctx.signal.reason;
    await new Promise((r) => setTimeout(r, 50));
  }
}

function prepare(el: Element) {
  el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
}

export function clickElement(el: Element, opts: { button?: "left" | "middle" | "right"; clickCount?: number; modifiers?: Mods } = {}) {
  const button = opts.button === "middle" ? 1 : opts.button === "right" ? 2 : 0;
  const buttons = button === 0 ? 1 : button === 1 ? 4 : 2;
  const base = { ...center(el), ...modifierFlags(opts.modifiers), button };
  hoverSequence(el);
  for (let i = 1; i <= (opts.clickCount ?? 1); i++) {
    pointer(el, "pointerdown", { ...base, buttons });
    const allowDefault = mouse(el, "mousedown", { ...base, buttons, detail: i });
    if (allowDefault && el instanceof HTMLElement) {
      const focusTarget = el.closest<HTMLElement>("a[href], button, input, select, textarea, [tabindex], [contenteditable]") ?? el;
      if (document.activeElement !== focusTarget) focusTarget.focus({ preventScroll: true });
    }
    pointer(el, "pointerup", { ...base, buttons: 0 });
    mouse(el, "mouseup", { ...base, buttons: 0, detail: i });
    if (button === 2) mouse(el, "contextmenu", { ...base, buttons: 0, detail: i });
    else if (button === 0) mouse(el, "click", { ...base, buttons: 0, detail: i });
    else mouse(el, "auxclick", { ...base, buttons: 0, detail: i });
  }
  if ((opts.clickCount ?? 1) === 2 && button === 0) mouse(el, "dblclick", { ...base, detail: 2 });
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  // Use the prototype setter so frameworks that track `value` (React) notice the change.
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
}

function isTextField(el: Element): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return true;
  if (!(el instanceof HTMLInputElement)) return false;
  return !["checkbox", "radio", "button", "submit", "reset", "file", "image", "range", "color", "hidden"].includes(el.type);
}

function codeFor(key: string) {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  if (key === " ") return "Space";
  return key;
}

function keyboard(el: Element, type: "keydown" | "keypress" | "keyup", key: string, mods: Mods = []) {
  return el.dispatchEvent(
    new KeyboardEvent(type, { key, code: codeFor(key), bubbles: true, cancelable: true, composed: true, view: window, ...modifierFlags(mods) }),
  );
}

function insertText(el: Element, text: string) {
  if (isTextField(el)) {
    let start = el.value.length;
    let end = start;
    try {
      start = el.selectionStart ?? start;
      end = el.selectionEnd ?? end;
    } catch {
      /* email/number inputs have no selection API */
    }
    const before = el.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: text, bubbles: true, cancelable: true, composed: true }));
    if (!before) return;
    setNativeValue(el, el.value.slice(0, start) + text + el.value.slice(end));
    try {
      el.setSelectionRange(start + text.length, start + text.length);
    } catch {
      /* not supported for this input type */
    }
    el.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: text, bubbles: true, composed: true }));
  } else if ((el as HTMLElement).isContentEditable) {
    document.execCommand("insertText", false, text);
  } else {
    throw new ExtensionUseError("INVALID_INPUT", "The element does not accept text");
  }
}

function guardSensitive(el: Element, ctx: ContentContext) {
  if (ctx.policy.sensitiveFields === "refuse" && isSensitive(el)) {
    throw new ExtensionUseError("BLOCKED_BY_POLICY", "Typing into password and payment fields is not allowed for controllers");
  }
}

function focusTarget(): Element {
  let el: Element | null = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el ?? document.body;
}

async function pressKey(el: Element, key: string, mods: Mods) {
  const allowed = keyboard(el, "keydown", key, mods);
  const printable = key.length === 1;
  if (allowed && (printable || key === "Enter")) keyboard(el, "keypress", key, mods);
  if (allowed) {
    if (printable && !mods.some((m) => m === "Control" || m === "Meta" || m === "Alt")) {
      if (isTextField(el) || (el as HTMLElement).isContentEditable) insertText(el, key);
    } else if (key === "Enter") {
      if (el instanceof HTMLInputElement && el.form) el.form.requestSubmit();
      else if (el instanceof HTMLAnchorElement || el instanceof HTMLButtonElement) clickElement(el);
      else if (el instanceof HTMLTextAreaElement || (el as HTMLElement).isContentEditable) insertText(el, "\n");
    } else if (key === "Backspace" && isTextField(el)) {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? start;
      const from = start === end ? Math.max(0, start - 1) : start;
      setNativeValue(el, el.value.slice(0, from) + el.value.slice(end));
      el.dispatchEvent(new InputEvent("input", { inputType: "deleteContentBackward", bubbles: true, composed: true }));
    }
  }
  keyboard(el, "keyup", key, mods);
  if (allowed && key === " " && (el instanceof HTMLButtonElement || (el instanceof HTMLInputElement && ["checkbox", "radio", "button", "submit"].includes(el.type)))) {
    clickElement(el);
  }
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "META", "LINK", "SVG"]);
const STRUCTURAL_ROLES = new Set(["generic", "none", "presentation", "label", "group"]);

function buildSnapshot(root: Element, maxNodes: number, interactiveOnly: boolean) {
  let count = 0;
  let truncated = false;

  const visit = (el: Element): SnapshotNode[] => {
    if (count >= maxNodes) {
      truncated = true;
      return [];
    }
    if (SKIP_TAGS.has(el.tagName.toUpperCase()) || el.getAttribute("aria-hidden") === "true") return [];
    if (el.id === OVERLAY_HOST_ID) return [];
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return [];

    const role = roleOf(el);
    const interactive = INTERACTIVE_ROLES.has(role) || (el as HTMLElement).isContentEditable;

    const children: SnapshotNode[] = [];
    if (!interactive) {
      const kids = el.shadowRoot ? [...el.shadowRoot.childNodes, ...el.childNodes] : [...el.childNodes];
      for (const node of kids) {
        if (node.nodeType === Node.TEXT_NODE) {
          if (interactiveOnly) continue;
          const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
          if (text) {
            count++;
            children.push({ role: "text", name: text.length > 300 ? `${text.slice(0, 300)}…` : text });
          }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          children.push(...visit(node as Element));
        }
      }
    }

    const keep = interactive || (!interactiveOnly && !STRUCTURAL_ROLES.has(role) && role !== "paragraph") || (!interactiveOnly && role === "paragraph" && children.length > 0);
    if (!keep) return children; // flatten wrappers
    if (!interactive && !isVisible(el) && children.length === 0) return [];

    count++;
    const node: SnapshotNode = { role, ref: refFor(el) };
    const name = nameOf(el);
    if (name) node.name = name;
    if (isTextField(el)) node.value = isSensitive(el) ? "••••" : el.value;
    if (el instanceof HTMLSelectElement) node.value = [...el.selectedOptions].map((o) => o.label).join(", ");
    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) node.checked = el.checked;
    else if (el.hasAttribute("aria-checked")) node.checked = el.getAttribute("aria-checked") === "true";
    if (isDisabled(el)) node.disabled = true;
    if (role === "heading") node.level = Number(el.getAttribute("aria-level") ?? el.tagName.slice(1)) || 2;
    if (el instanceof HTMLAnchorElement && el.href) node.href = el.href;
    // A single text child that repeats the name adds nothing.
    const onlyText = children.length === 1 && children[0]!.role === "text" ? children[0]!.name : undefined;
    if (onlyText && onlyText === name) children.length = 0;
    if (children.length) node.children = children;
    return [node];
  };

  const rootNode: SnapshotNode = { role: "document", children: visit(root) };
  return { root: rootNode, nodeCount: count, truncated };
}

function snapshotText(node: SnapshotNode, depth = 0, lines: string[] = []): string[] {
  for (const child of node.children ?? []) {
    const pad = "  ".repeat(depth);
    if (child.role === "text") {
      lines.push(`${pad}- text: ${child.name}`);
      continue;
    }
    let line = `${pad}- ${child.role}`;
    if (child.name) line += ` ${JSON.stringify(child.name)}`;
    if (child.level) line += ` [level=${child.level}]`;
    if (child.checked !== undefined) line += ` [checked=${child.checked}]`;
    if (child.disabled) line += " [disabled]";
    if (child.ref) line += ` [ref=${child.ref}]`;
    const onlyText = child.children?.length === 1 && child.children[0]!.role === "text" ? child.children[0]!.name : undefined;
    if (child.value !== undefined) line += `: ${JSON.stringify(child.value)}`;
    else if (onlyText) line += `: ${onlyText}`;
    else if (child.children?.length) line += ":";
    lines.push(line);
    if (child.children?.length && !onlyText) snapshotText(child, depth + 1, lines);
  }
  return lines;
}

// Shared with overlay.ts so snapshots skip our own UI.
export const OVERLAY_HOST_ID = "extension-use-overlay";

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const pageContent: ContentGroup = {
  name: "page",
  handlers: {
    "page.info": () => ({
      url: location.href,
      title: document.title,
      viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
      scroll: { x: window.scrollX, y: window.scrollY },
      document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
    }),
    "page.scroll": (input: In<"page.scroll">) => {
      const behavior = input.behavior as ScrollBehavior;
      if (input.to === "top") window.scrollTo({ top: 0, behavior });
      else if (input.to === "bottom") window.scrollTo({ top: document.documentElement.scrollHeight, behavior });
      else if (input.by) window.scrollBy({ left: input.x ?? 0, top: input.y ?? 0, behavior });
      else window.scrollTo({ ...(input.x !== undefined ? { left: input.x } : {}), ...(input.y !== undefined ? { top: input.y } : {}), behavior });
      return { scroll: { x: window.scrollX, y: window.scrollY } };
    },
  },
};

export const domContent: ContentGroup = {
  name: "dom",
  handlers: {
    "dom.query": async (input: In<"dom.query">, ctx) => {
      if (input.wait) await find(input.locator, ctx, false);
      let els = findAll(input.locator);
      if (input.locator.nth !== undefined && !input.all) els = els.slice(input.locator.nth, input.locator.nth + 1);
      if (!input.all) els = els.slice(0, 1);
      return { elements: els.slice(0, input.limit).map((el) => describe(el, input.textMaxLength)) };
    },
    "dom.text": async (input: In<"dom.text">, ctx) => {
      const el = input.locator ? await find(input.locator, ctx, false) : document.body;
      const text = ((el as HTMLElement).innerText ?? el.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
      return { text: text.slice(0, input.maxLength), truncated: text.length > input.maxLength };
    },
    "dom.snapshot": async (input: In<"dom.snapshot">, ctx) => {
      const root = input.locator ? await find(input.locator, ctx, false) : document.body;
      const snap = buildSnapshot(root, input.maxNodes, input.interactiveOnly);
      return {
        ...(input.format !== "text" ? { root: snap.root } : {}),
        ...(input.format !== "tree" ? { text: snapshotText(snap.root).join("\n") } : {}),
        nodeCount: snap.nodeCount,
        truncated: snap.truncated,
      };
    },
    "dom.click": async (input: In<"dom.click">, ctx) => {
      const el = await find(input.locator, ctx);
      await waitEnabled(el, ctx);
      prepare(el);
      clickElement(el, input);
      return { ref: refFor(el) };
    },
    "dom.hover": async (input: In<"dom.hover">, ctx) => {
      const el = await find(input.locator, ctx);
      prepare(el);
      hoverSequence(el);
      return { ref: refFor(el) };
    },
    "dom.focus": async (input: In<"dom.focus">, ctx) => {
      const el = await find(input.locator, ctx);
      (el as HTMLElement).focus();
      return { ref: refFor(el) };
    },
    "dom.type": async (input: In<"dom.type">, ctx) => {
      const el = input.locator ? await find(input.locator, ctx) : focusTarget();
      guardSensitive(el, ctx);
      await waitEnabled(el, ctx);
      if (input.locator) {
        prepare(el);
        (el as HTMLElement).focus();
      }
      if (input.clear && isTextField(el)) {
        setNativeValue(el, "");
        el.dispatchEvent(new InputEvent("input", { inputType: "deleteContentBackward", bubbles: true, composed: true }));
      }
      for (const ch of input.text) {
        if (ctx.signal.aborted) throw ctx.signal.reason;
        await pressKey(el, ch === "\n" ? "Enter" : ch, []);
        if (input.delayMs) await new Promise((r) => setTimeout(r, input.delayMs));
      }
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ref: refFor(el) };
    },
    "dom.fill": async (input: In<"dom.fill">, ctx) => {
      const el = await find(input.locator, ctx);
      guardSensitive(el, ctx);
      await waitEnabled(el, ctx);
      prepare(el);
      (el as HTMLElement).focus();
      if (isTextField(el)) {
        setNativeValue(el, input.value);
        el.dispatchEvent(new InputEvent("input", { inputType: "insertReplacementText", data: input.value, bubbles: true, composed: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      } else if ((el as HTMLElement).isContentEditable) {
        document.getSelection()?.selectAllChildren(el);
        document.execCommand("insertText", false, input.value);
      } else {
        throw new ExtensionUseError("INVALID_INPUT", "dom.fill needs an input, textarea or contenteditable element");
      }
      return { ref: refFor(el) };
    },
    "dom.select": async (input: In<"dom.select">, ctx) => {
      const el = await find(input.locator, ctx);
      if (!(el instanceof HTMLSelectElement)) throw new ExtensionUseError("INVALID_INPUT", "dom.select needs a <select> element");
      await waitEnabled(el, ctx);
      const options = [...el.options];
      const picked = input.values.map((v) => {
        const opt = options.find((o) => o.value === v) ?? options.find((o) => o.label.trim() === v.trim());
        if (!opt) throw new ExtensionUseError("ELEMENT_NOT_FOUND", `No option "${v}"`);
        return opt;
      });
      if (!el.multiple && picked.length > 1) throw new ExtensionUseError("INVALID_INPUT", "This <select> allows one option");
      for (const o of options) o.selected = picked.includes(o);
      el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ref: refFor(el), selected: picked.map((o) => o.value) };
    },
    "dom.check": async (input: In<"dom.check">, ctx) => {
      const el = await find(input.locator, ctx);
      await waitEnabled(el, ctx);
      const state = () => (el instanceof HTMLInputElement ? el.checked : el.getAttribute("aria-checked") === "true");
      if (state() !== input.checked) {
        prepare(el);
        clickElement(el);
      }
      if (state() !== input.checked) throw new ExtensionUseError("INTERNAL", "The element did not change state");
      return { ref: refFor(el), checked: state() };
    },
    "dom.press": async (input: In<"dom.press">, ctx) => {
      const el = input.locator ? await find(input.locator, ctx) : focusTarget();
      if (input.locator) (el as HTMLElement).focus();
      guardSensitive(el, ctx);
      await pressKey(el, input.key, input.modifiers);
      return {};
    },
    "dom.scrollTo": async (input: In<"dom.scrollTo">, ctx) => {
      const el = await find(input.locator, ctx, false);
      el.scrollIntoView({ block: input.block, inline: "nearest", behavior: input.behavior as ScrollBehavior });
      return { ref: refFor(el) };
    },
  },
};

export const waitContent: ContentGroup = {
  name: "wait",
  handlers: {
    "wait.for": async (input: In<"wait.for">, ctx) => {
      const deadline = Date.now() + ctx.timeoutMs;
      for (;;) {
        if (ctx.signal.aborted) throw ctx.signal.reason;
        let ok = true;
        let ref: string | undefined;
        if (input.urlMatch && !matchPattern(input.urlMatch, location.href)) ok = false;
        if (ok && input.locator) {
          const els = findAll(input.locator);
          const el = els[input.locator.nth ?? 0];
          switch (input.state) {
            case "attached":
              ok = Boolean(el);
              break;
            case "detached":
              ok = !el;
              break;
            case "visible":
              ok = Boolean(el && isVisible(el));
              break;
            case "hidden":
              ok = !el || !isVisible(el);
              break;
          }
          if (ok && el && el.isConnected) ref = refFor(el);
        }
        if (ok) return ref ? { ref } : {};
        if (Date.now() >= deadline) throw new ExtensionUseError("TIMEOUT", "Condition not met in time");
        await new Promise((r) => setTimeout(r, 50));
      }
    },
  },
};
