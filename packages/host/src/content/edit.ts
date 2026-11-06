/**
 * Changing the page's DOM: set HTML, text and attributes, remove elements.
 *
 * Nothing here can run code. HTML is parsed in a separate document with no
 * window, then rebuilt node by node in the page with only safe tags and
 * attributes; event-handler attributes and javascript: URLs are refused, and
 * <script> elements can't be edited (adding text to an empty script runs it).
 *
 * Why rebuild instead of deleting bad attributes: Blink ties inline event
 * handlers to the JS world that created them. Parsing makes page-world
 * listeners, and removeAttribute from the content script's isolated world
 * drops the attribute but leaves the page's listener attached.
 */
import { ExtensionUseError } from "@extension-use/protocol";
import type { ContentContext, ContentGroup } from "./context.js";
import { OVERLAY_HOST_ID, find, guardSensitive, type In } from "./dom.js";
import { findAll, refFor } from "./locator.js";

const BLOCKED_TAGS = new Set(["script", "iframe", "frame", "frameset", "object", "embed", "applet", "base", "meta", "portal", "fencedframe", "noscript"]);
const PROTECTED = new Set(["HTML", "HEAD", "BODY"]);
const HTML_NS = "http://www.w3.org/1999/xhtml";

function isCodeUrl(value: string) {
  // Browsers ignore control characters and whitespace before the scheme.
  return /^(javascript|vbscript):/i.test(value.replace(/[\u0000- ]/g, ""));
}

function isBadAttribute(name: string, value: string) {
  const n = name.toLowerCase();
  return n.startsWith("on") || n === "srcdoc" || isCodeUrl(value);
}

/** A document with no window: parsing into it runs nothing, loads nothing and upgrades no custom elements. */
export function inertDocument(): Document {
  return document.implementation.createHTMLDocument("");
}

/** Parse HTML without running or loading anything, and rebuild it in the page with only safe parts. */
export function sanitize(html: string): { fragment: DocumentFragment; removed: number } {
  const tpl = inertDocument().createElement("template");
  try {
    tpl.innerHTML = html;
  } catch (err) {
    throw new ExtensionUseError("BLOCKED_BY_POLICY", `The page doesn't allow inserting HTML: ${String((err as Error)?.message ?? err)}`);
  }
  let removed = 0;
  const rebuild = (node: Node): Node | null => {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.nodeValue ?? "");
    if (node.nodeType === Node.COMMENT_NODE) return document.createComment(node.nodeValue ?? "");
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const src = node as Element;
    const tag = src.localName.toLowerCase();
    // SVG animations can set href to a javascript: URL later.
    const hrefAnimation = (tag === "animate" || tag === "set") && /href/i.test(src.getAttribute("attributeName") ?? "");
    if (BLOCKED_TAGS.has(tag) || hrefAnimation) {
      removed++;
      return null;
    }
    const is = src.namespaceURI === HTML_NS ? src.getAttribute("is") : null;
    const el = src.namespaceURI === HTML_NS ? document.createElement(src.localName, is ? { is } : undefined) : document.createElementNS(src.namespaceURI, src.localName);
    for (const attr of src.attributes) {
      if (isBadAttribute(attr.name, attr.value)) removed++;
      else el.setAttributeNS(attr.namespaceURI, attr.name, attr.value);
    }
    const [from, to] = src instanceof HTMLTemplateElement ? [src.content, (el as HTMLTemplateElement).content] : [src, el];
    for (const child of from.childNodes) {
      const copy = rebuild(child);
      if (copy) to.appendChild(copy);
    }
    return el;
  };
  const fragment = document.createDocumentFragment();
  for (const child of tpl.content.childNodes) {
    const copy = rebuild(child);
    if (copy) fragment.appendChild(copy);
  }
  return { fragment, removed };
}

function assertEditable(el: Element) {
  if (el.closest(`#${OVERLAY_HOST_ID}`)) throw new ExtensionUseError("INVALID_INPUT", "That element belongs to Extension-use's own overlay");
  if (el.tagName.toUpperCase() === "SCRIPT") throw new ExtensionUseError("BLOCKED_BY_POLICY", "<script> elements can't be edited");
}

const target = (input: { locator: In<"edit.setText">["locator"] }, ctx: ContentContext) => find(input.locator, ctx, false);

export const editContent: ContentGroup = {
  name: "edit",
  handlers: {
    "edit.setHtml": async (input: In<"edit.setHtml">, ctx) => {
      const el = await target(input, ctx);
      assertEditable(el);
      if (input.position === "outer" && PROTECTED.has(el.tagName.toUpperCase())) {
        throw new ExtensionUseError("INVALID_INPUT", `Can't replace <${el.tagName.toLowerCase()}>; use position "inner"`);
      }
      if ((input.position === "beforebegin" || input.position === "afterbegin") && el === document.documentElement) {
        throw new ExtensionUseError("INVALID_INPUT", "Can't insert outside <html>");
      }
      const { fragment, removed } = sanitize(input.html);
      const inserted = [...fragment.children];
      switch (input.position) {
        case "inner":
          el.replaceChildren(fragment);
          break;
        case "outer":
          el.replaceWith(fragment);
          break;
        case "beforebegin":
          el.before(fragment);
          break;
        case "afterbegin":
          el.prepend(fragment);
          break;
        case "beforeend":
          el.append(fragment);
          break;
        case "afterend":
          el.after(fragment);
          break;
      }
      return { refs: inserted.filter((n) => n.isConnected).map(refFor), removed };
    },
    "edit.setText": async (input: In<"edit.setText">, ctx) => {
      const el = await target(input, ctx);
      assertEditable(el);
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
        throw new ExtensionUseError("INVALID_INPUT", "Use dom.fill to change a form field's value");
      }
      el.textContent = input.text;
      return { ref: refFor(el) };
    },
    "edit.setAttributes": async (input: In<"edit.setAttributes">, ctx) => {
      const el = await target(input, ctx);
      assertEditable(el);
      const entries = Object.entries(input.attributes);
      for (const [name, value] of entries) {
        if (!/^[^\s"'<>/=\u0000-\u001f]+$/.test(name)) throw new ExtensionUseError("INVALID_INPUT", `"${name}" is not a valid attribute name`);
        if (value !== null && isBadAttribute(name, value)) {
          throw new ExtensionUseError("BLOCKED_BY_POLICY", `Setting "${name}" could run code, so it's not allowed`);
        }
        if (name.toLowerCase() === "value") guardSensitive(el, ctx);
      }
      for (const [name, value] of entries) {
        if (value === null) el.removeAttribute(name);
        else el.setAttribute(name, value);
      }
      return { ref: refFor(el), attributes: Object.fromEntries([...el.attributes].map((a) => [a.name, a.value])) };
    },
    "edit.remove": async (input: In<"edit.remove">, ctx) => {
      const first = await target(input, ctx);
      const els = input.all ? findAll(input.locator) : [first];
      for (const el of els) {
        assertEditable(el);
        if (PROTECTED.has(el.tagName.toUpperCase())) throw new ExtensionUseError("INVALID_INPUT", `Can't remove <${el.tagName.toLowerCase()}>`);
      }
      for (const el of els) el.remove();
      return { removed: els.length };
    },
  },
};
