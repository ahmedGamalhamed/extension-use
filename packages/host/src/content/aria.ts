/**
 * Small, dependency-free role and accessible-name computation.
 * It covers the common cases (native controls, landmarks, headings, ARIA
 * attributes). It is not a full implementation of the accname spec.
 */

const INPUT_ROLES: Record<string, string> = {
  button: "button",
  submit: "button",
  reset: "button",
  image: "button",
  checkbox: "checkbox",
  radio: "radio",
  range: "slider",
  number: "spinbutton",
  search: "searchbox",
  email: "textbox",
  tel: "textbox",
  text: "textbox",
  url: "textbox",
  password: "textbox",
  "": "textbox",
};

const TAG_ROLES: Record<string, string> = {
  button: "button",
  select: "combobox",
  textarea: "textbox",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  img: "img",
  nav: "navigation",
  main: "main",
  header: "banner",
  footer: "contentinfo",
  aside: "complementary",
  form: "form",
  ul: "list",
  ol: "list",
  li: "listitem",
  table: "table",
  tr: "row",
  td: "cell",
  th: "columnheader",
  dialog: "dialog",
  option: "option",
  progress: "progressbar",
  summary: "button",
  details: "group",
  fieldset: "group",
  article: "article",
  p: "paragraph",
  label: "label",
  iframe: "iframe",
  video: "video",
  audio: "audio",
};

export const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "checkbox",
  "radio",
  "textbox",
  "searchbox",
  "combobox",
  "listbox",
  "option",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "treeitem",
]);

export function roleOf(el: Element): string {
  const explicit = el.getAttribute("role")?.trim().split(/\s+/)[0];
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  if (tag === "a" || tag === "area") return el.hasAttribute("href") ? "link" : "generic";
  if (tag === "input") {
    const type = (el.getAttribute("type") ?? "").toLowerCase();
    if (type === "hidden") return "none";
    return INPUT_ROLES[type] ?? "textbox";
  }
  if (tag === "select" && ((el as HTMLSelectElement).multiple || (el as HTMLSelectElement).size > 1)) return "listbox";
  if (tag === "section" && (el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby"))) return "region";
  if (tag === "img" && el.getAttribute("alt") === "") return "presentation";
  if ((el as HTMLElement).isContentEditable && !(el.parentElement as HTMLElement | null)?.isContentEditable) return "textbox";
  return TAG_ROLES[tag] ?? "generic";
}

function collapse(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

function textOf(el: Element, depth = 0): string {
  if (depth > 20) return "";
  let out = "";
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) out += node.textContent ?? "";
    else if (node.nodeType === Node.ELEMENT_NODE) {
      const child = node as Element;
      if (child.getAttribute("aria-hidden") === "true" || ["script", "style", "noscript", "template"].includes(child.tagName.toLowerCase())) continue;
      const tag = child.tagName.toLowerCase();
      out += tag === "img" ? (child.getAttribute("alt") ?? "") : textOf(child, depth + 1);
      out += " ";
    }
  }
  return out;
}

export function nameOf(el: Element): string {
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const doc = el.ownerDocument;
    const text = labelledBy
      .split(/\s+/)
      .map((id) => doc.getElementById(id))
      .filter(Boolean)
      .map((n) => textOf(n!))
      .join(" ");
    if (collapse(text)) return collapse(text);
  }
  const aria = collapse(el.getAttribute("aria-label"));
  if (aria) return aria;

  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") {
    const input = el as HTMLInputElement;
    const type = (input.type ?? "").toLowerCase();
    if (type === "button" || type === "submit" || type === "reset") return collapse(input.value) || (type === "submit" ? "Submit" : type === "reset" ? "Reset" : "");
    if (type === "image") return collapse(input.alt);
    const labels = input.labels ? [...input.labels].map((l) => textOf(l)).join(" ") : "";
    if (collapse(labels)) return collapse(labels);
    return collapse(input.getAttribute("placeholder")) || collapse(el.getAttribute("title"));
  }
  if (tag === "img" || tag === "area") return collapse(el.getAttribute("alt")) || collapse(el.getAttribute("title"));
  if (tag === "fieldset") {
    const legend = el.querySelector(":scope > legend");
    if (legend) return collapse(textOf(legend));
  }
  if (tag === "table") {
    const caption = el.querySelector(":scope > caption");
    if (caption) return collapse(textOf(caption));
  }

  const role = roleOf(el);
  const nameFromContent = INTERACTIVE_ROLES.has(role) || ["heading", "cell", "columnheader", "listitem", "row", "tooltip", "option", "label"].includes(role);
  if (nameFromContent) {
    const text = collapse(textOf(el));
    if (text) return text.slice(0, 300);
  }
  return collapse(el.getAttribute("title"));
}

export function isVisible(el: Element): boolean {
  if (!el.isConnected) return false;
  const anyEl = el as Element & { checkVisibility?: (o?: object) => boolean };
  if (typeof anyEl.checkVisibility === "function") {
    if (!anyEl.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
  } else {
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function isDisabled(el: Element): boolean {
  if ((el as HTMLButtonElement).disabled) return true;
  if (el.getAttribute("aria-disabled") === "true") return true;
  return Boolean(el.closest("fieldset[disabled]") && !el.closest("legend"));
}

export function isSensitive(el: Element): boolean {
  if (el.tagName === "INPUT") {
    const input = el as HTMLInputElement;
    if (input.type === "password") return true;
    const ac = (input.autocomplete || input.getAttribute("autocomplete") || "").toLowerCase();
    if (/\bcc-|current-password|new-password|one-time-code/.test(ac)) return true;
  }
  return false;
}
