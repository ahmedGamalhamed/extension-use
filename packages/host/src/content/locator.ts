import { ExtensionUseError, type Locator } from "@extension-use/protocol";
import type { ElementInfo } from "@extension-use/protocol/schemas";
import { isDisabled, isSensitive, isVisible, nameOf, roleOf } from "./aria.js";

// ---------------------------------------------------------------------------
// Refs: stable ids for elements within one page load
// ---------------------------------------------------------------------------

const refByEl = new WeakMap<Element, string>();
const elByRef = new Map<string, WeakRef<Element>>();
let nextRef = 1;

export function refFor(el: Element): string {
  let ref = refByEl.get(el);
  if (!ref) {
    ref = `e${nextRef++}`;
    refByEl.set(el, ref);
    elByRef.set(ref, new WeakRef(el));
  }
  return ref;
}

function elementForRef(ref: string): Element | undefined {
  const el = elByRef.get(ref)?.deref();
  if (el && !el.isConnected) return undefined;
  return el;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

function textMatches(actual: string, wanted: string, exact: boolean | undefined) {
  const a = actual.replace(/\s+/g, " ").trim();
  const w = wanted.replace(/\s+/g, " ").trim();
  return exact ? a === w : a.toLowerCase().includes(w.toLowerCase());
}

/** All elements in the document (including open shadow roots). */
function* walkAll(root: ParentNode): Generator<Element> {
  const stack: ParentNode[] = [root];
  while (stack.length) {
    const node = stack.pop()!;
    const children = (node as Element).children ?? (node as Document).children;
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i]!;
      yield child;
      if (child.shadowRoot) stack.push(child.shadowRoot);
      stack.push(child);
    }
  }
}

function candidates(locator: Locator, root: ParentNode): Element[] {
  if (locator.ref) {
    const el = elementForRef(locator.ref);
    return el ? [el] : [];
  }
  let list: Element[];
  if (locator.css) {
    try {
      list = [...root.querySelectorAll(locator.css)];
    } catch {
      throw new ExtensionUseError("INVALID_INPUT", `Invalid CSS selector: ${locator.css}`);
    }
  } else if (locator.testId) {
    list = [...root.querySelectorAll(`[data-testid="${CSS.escape(locator.testId)}"], [data-test-id="${CSS.escape(locator.testId)}"]`)];
  } else {
    list = [...walkAll(root)];
  }
  if (locator.testId && locator.css) {
    list = list.filter((el) => el.getAttribute("data-testid") === locator.testId || el.getAttribute("data-test-id") === locator.testId);
  }
  if (locator.role) {
    const role = locator.role.toLowerCase();
    list = list.filter((el) => roleOf(el) === role);
  }
  if (locator.name !== undefined) {
    list = list.filter((el) => textMatches(nameOf(el), locator.name!, locator.exact));
  }
  if (locator.text !== undefined) {
    const matching = list.filter((el) => {
      if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "HTML", "BODY"].includes(el.tagName)) return false;
      return textMatches((el as HTMLElement).innerText ?? el.textContent ?? "", locator.text!, locator.exact);
    });
    // Keep the deepest matches: drop elements that contain another match.
    const set = new Set(matching);
    list = matching.filter((el) => ![...el.querySelectorAll("*")].some((c) => set.has(c)));
  }
  return list;
}

export function findAll(locator: Locator, root: ParentNode = document): Element[] {
  return candidates(locator, root);
}

export interface ResolveOptions {
  timeoutMs: number;
  signal?: AbortSignal;
  /** Require the element to be visible. Default true. */
  visible?: boolean;
  root?: ParentNode;
}

/** Find one element, waiting for it up to `timeoutMs`. */
export async function resolve(locator: Locator, opts: ResolveOptions): Promise<Element> {
  const deadline = Date.now() + opts.timeoutMs;
  const wantVisible = opts.visible ?? true;
  for (;;) {
    if (opts.signal?.aborted) throw opts.signal.reason ?? new ExtensionUseError("CANCELLED", "Cancelled");
    let found = candidates(locator, opts.root ?? document);
    if (wantVisible) found = found.filter(isVisible);
    const el = found[locator.nth ?? 0];
    if (el) return el;
    if (Date.now() >= deadline) {
      throw new ExtensionUseError("ELEMENT_NOT_FOUND", `No ${wantVisible ? "visible " : ""}element matches ${JSON.stringify(locator)}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

// ---------------------------------------------------------------------------
// Description
// ---------------------------------------------------------------------------

const KEPT_ATTRIBUTES = ["id", "class", "type", "name", "placeholder", "aria-label", "data-testid", "title", "alt", "src", "role"];

export function describe(el: Element, textMaxLength = 200): ElementInfo {
  const rect = el.getBoundingClientRect();
  const attributes: Record<string, string> = {};
  for (const name of KEPT_ATTRIBUTES) {
    const v = el.getAttribute(name);
    if (v !== null) attributes[name] = v.length > 200 ? `${v.slice(0, 200)}…` : v;
  }
  const info: ElementInfo = {
    ref: refFor(el),
    tag: el.tagName.toLowerCase(),
    role: roleOf(el),
    name: nameOf(el),
    attributes,
    box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    visible: isVisible(el),
  };
  if (textMaxLength > 0) {
    const text = ((el as HTMLElement).innerText ?? el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text) info.text = text.length > textMaxLength ? `${text.slice(0, textMaxLength)}…` : text;
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    info.value = isSensitive(el) ? "••••" : el.value;
  }
  if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) info.checked = el.checked;
  else if (el.hasAttribute("aria-checked")) info.checked = el.getAttribute("aria-checked") === "true";
  if (isDisabled(el)) info.disabled = true;
  if (el instanceof HTMLAnchorElement && el.href) info.href = el.href;
  return info;
}

/** A short, reasonably stable CSS selector for an element. */
export function cssPath(el: Element): string {
  if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) return `#${CSS.escape(el.id)}`;
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== document.documentElement && parts.length < 8) {
    if (node.id && document.querySelectorAll(`#${CSS.escape(node.id)}`).length === 1) {
      parts.unshift(`#${CSS.escape(node.id)}`);
      break;
    }
    const tag = node.tagName.toLowerCase();
    const parentEl: Element | null = node.parentElement;
    if (!parentEl) {
      parts.unshift(tag);
      break;
    }
    const same = [...parentEl.children].filter((c) => c.tagName === node!.tagName);
    parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(node) + 1})` : tag);
    node = parentEl;
  }
  return parts.join(" > ");
}
