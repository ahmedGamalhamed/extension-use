/**
 * Zod schemas for the built-in actions and events.
 *
 * The host validates every input against these. The client only imports the
 * *types* (`import type`), so zod never ends up in a controller's bundle.
 */
import * as z from "zod";

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

export const locatorSchema = z
  .object({
    ref: z.string(),
    role: z.string(),
    name: z.string(),
    text: z.string(),
    testId: z.string(),
    css: z.string(),
    nth: z.number().int().min(0),
    exact: z.boolean(),
  })
  .partial()
  .refine((l) => Boolean(l.ref || l.role || l.text || l.testId || l.css), {
    message: "A locator needs at least one of ref, role, text, testId or css",
  });

export const boxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

export const elementInfoSchema = z.object({
  ref: z.string(),
  tag: z.string(),
  role: z.string(),
  name: z.string(),
  text: z.string().optional(),
  value: z.string().optional(),
  checked: z.boolean().optional(),
  disabled: z.boolean().optional(),
  href: z.string().optional(),
  attributes: z.record(z.string(), z.string()),
  box: boxSchema,
  visible: z.boolean(),
});

export const tabInfoSchema = z.object({
  id: z.number(),
  windowId: z.number(),
  url: z.string(),
  title: z.string(),
  active: z.boolean(),
  status: z.string(),
});

export interface SnapshotNode {
  ref?: string;
  role: string;
  name?: string;
  value?: string;
  checked?: boolean;
  disabled?: boolean;
  level?: number;
  href?: string;
  children?: SnapshotNode[];
}

export const snapshotNodeSchema: z.ZodType<SnapshotNode> = z.lazy(() =>
  z.object({
    ref: z.string().optional(),
    role: z.string(),
    name: z.string().optional(),
    value: z.string().optional(),
    checked: z.boolean().optional(),
    disabled: z.boolean().optional(),
    level: z.number().optional(),
    href: z.string().optional(),
    children: z.array(snapshotNodeSchema).optional(),
  }),
);

const empty = z.object({});
const refOut = z.object({ ref: z.string() });
const scrollBehavior = z.enum(["auto", "smooth", "instant"]);

// ---------------------------------------------------------------------------
// Action definitions
// ---------------------------------------------------------------------------

export interface ActionSchema<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> {
  input: I;
  output: O;
  where: "background" | "content";
  version: number;
  /** Default timeout for the whole call, in ms. */
  timeoutMs?: number;
  description: string;
}

function action<I extends z.ZodType, O extends z.ZodType>(
  where: "background" | "content",
  description: string,
  input: I,
  output: O,
  extra: { timeoutMs?: number; version?: number } = {},
): ActionSchema<I, O> {
  return { input, output, where, description, version: extra.version ?? 1, ...(extra.timeoutMs ? { timeoutMs: extra.timeoutMs } : {}) };
}

export const coreActionSchemas = {
  // runtime ----------------------------------------------------------------
  "runtime.ping": action("background", "Check the connection.", empty, z.object({ pong: z.literal(true), ts: z.number() })),

  // tabs ------------------------------------------------------------------
  "tabs.list": action(
    "background",
    "List open tabs.",
    z.object({ currentWindow: z.boolean().optional(), urlMatch: z.string().optional() }),
    z.object({ tabs: z.array(tabInfoSchema) }),
  ),
  "tabs.open": action(
    "background",
    "Open a URL in a new tab.",
    z.object({ url: z.string(), active: z.boolean().default(true), waitForLoad: z.boolean().default(true) }),
    tabInfoSchema,
    { timeoutMs: 30_000 },
  ),
  "tabs.close": action("background", "Close a tab.", z.object({ tabId: z.number() }), empty),
  "tabs.activate": action("background", "Focus a tab.", z.object({ tabId: z.number() }), tabInfoSchema),
  "tabs.navigate": action(
    "background",
    "Navigate the target tab to a URL.",
    z.object({ url: z.string(), waitForLoad: z.boolean().default(true) }),
    tabInfoSchema,
    { timeoutMs: 30_000 },
  ),
  "tabs.reload": action(
    "background",
    "Reload the target tab.",
    z.object({ waitForLoad: z.boolean().default(true) }),
    tabInfoSchema,
    { timeoutMs: 30_000 },
  ),
  "tabs.waitForLoad": action("background", "Wait until the target tab has loaded.", empty, tabInfoSchema, { timeoutMs: 30_000 }),

  // capture ---------------------------------------------------------------
  "capture.screenshot": action(
    "background",
    "Capture the visible part of the target tab, or crop to one element.",
    z.object({
      format: z.enum(["png", "jpeg"]).default("png"),
      quality: z.number().int().min(0).max(100).optional(),
      locator: locatorSchema.optional(),
    }),
    z.object({ dataUrl: z.string(), width: z.number(), height: z.number() }),
    { timeoutMs: 15_000 },
  ),

  // page ------------------------------------------------------------------
  "page.info": action(
    "content",
    "URL, title, viewport, scroll position and document size.",
    empty,
    z.object({
      url: z.string(),
      title: z.string(),
      viewport: z.object({ width: z.number(), height: z.number(), devicePixelRatio: z.number() }),
      scroll: z.object({ x: z.number(), y: z.number() }),
      document: z.object({ width: z.number(), height: z.number() }),
    }),
  ),
  "page.scroll": action(
    "content",
    "Scroll the page to a position, by an amount, or to the top or bottom.",
    z.object({
      x: z.number().optional(),
      y: z.number().optional(),
      by: z.boolean().default(false),
      to: z.enum(["top", "bottom"]).optional(),
      behavior: scrollBehavior.default("instant"),
    }),
    z.object({ scroll: z.object({ x: z.number(), y: z.number() }) }),
  ),

  // dom: reading ------------------------------------------------------------
  "dom.query": action(
    "content",
    "Find elements and describe them.",
    z.object({
      locator: locatorSchema,
      all: z.boolean().default(false),
      limit: z.number().int().min(1).max(500).default(50),
      textMaxLength: z.number().int().min(0).default(200),
      wait: z.boolean().default(true),
    }),
    z.object({ elements: z.array(elementInfoSchema) }),
  ),
  "dom.text": action(
    "content",
    "Readable text of the page or of one element.",
    z.object({ locator: locatorSchema.optional(), maxLength: z.number().int().min(1).default(20_000) }),
    z.object({ text: z.string(), truncated: z.boolean() }),
  ),
  "dom.snapshot": action(
    "content",
    "Compact accessibility-style tree with refs for interactive elements.",
    z.object({
      locator: locatorSchema.optional(),
      maxNodes: z.number().int().min(1).max(20_000).default(1500),
      interactiveOnly: z.boolean().default(false),
      format: z.enum(["tree", "text", "both"]).default("both"),
    }),
    z.object({
      root: snapshotNodeSchema.optional(),
      text: z.string().optional(),
      nodeCount: z.number(),
      truncated: z.boolean(),
    }),
  ),

  // dom: interacting --------------------------------------------------------
  "dom.click": action(
    "content",
    "Click an element.",
    z.object({
      locator: locatorSchema,
      button: z.enum(["left", "middle", "right"]).default("left"),
      clickCount: z.number().int().min(1).max(3).default(1),
      modifiers: z.array(z.enum(["Alt", "Control", "Meta", "Shift"])).default([]),
    }),
    refOut,
  ),
  "dom.hover": action("content", "Move the pointer over an element.", z.object({ locator: locatorSchema }), refOut),
  "dom.focus": action("content", "Focus an element.", z.object({ locator: locatorSchema }), refOut),
  "dom.type": action(
    "content",
    "Type text key by key into an element (or the focused element).",
    z.object({
      locator: locatorSchema.optional(),
      text: z.string(),
      delayMs: z.number().int().min(0).max(1000).default(0),
      clear: z.boolean().default(false),
    }),
    refOut,
    { timeoutMs: 30_000 },
  ),
  "dom.fill": action("content", "Set the value of an input in one step.", z.object({ locator: locatorSchema, value: z.string() }), refOut),
  "dom.select": action(
    "content",
    "Choose options in a <select> by value or label.",
    z.object({ locator: locatorSchema, values: z.array(z.string()).min(1) }),
    z.object({ ref: z.string(), selected: z.array(z.string()) }),
  ),
  "dom.check": action(
    "content",
    "Check or uncheck a checkbox or radio.",
    z.object({ locator: locatorSchema, checked: z.boolean().default(true) }),
    z.object({ ref: z.string(), checked: z.boolean() }),
  ),
  "dom.press": action(
    "content",
    "Press a key on an element (or the focused element).",
    z.object({
      locator: locatorSchema.optional(),
      key: z.string(),
      modifiers: z.array(z.enum(["Alt", "Control", "Meta", "Shift"])).default([]),
    }),
    empty,
  ),
  "dom.scrollTo": action(
    "content",
    "Scroll an element into view.",
    z.object({
      locator: locatorSchema,
      block: z.enum(["start", "center", "end", "nearest"]).default("center"),
      behavior: scrollBehavior.default("instant"),
    }),
    refOut,
  ),

  // wait ------------------------------------------------------------------
  "wait.for": action(
    "content",
    "Wait for an element state or a URL.",
    z
      .object({
        locator: locatorSchema.optional(),
        state: z.enum(["attached", "detached", "visible", "hidden"]).default("visible"),
        urlMatch: z.string().optional(),
      })
      .refine((v) => v.locator || v.urlMatch, { message: "Give a locator or a urlMatch" }),
    z.object({ ref: z.string().optional() }),
    { timeoutMs: 15_000 },
  ),

  // overlay ---------------------------------------------------------------
  "overlay.highlight": action(
    "content",
    "Outline elements on the page, with an optional label.",
    z.object({
      locator: locatorSchema,
      all: z.boolean().default(false),
      label: z.string().optional(),
      color: z.string().default("#7c3aed"),
      durationMs: z.number().int().min(0).default(0),
      id: z.string().optional(),
    }),
    z.object({ id: z.string(), count: z.number() }),
  ),
  "overlay.clear": action("content", "Remove highlights (one id, or all).", z.object({ id: z.string().optional() }), empty),
  "overlay.toast": action(
    "content",
    "Show a short message on the page.",
    z.object({
      message: z.string().max(500),
      kind: z.enum(["info", "success", "error"]).default("info"),
      durationMs: z.number().int().min(500).max(30_000).default(3000),
    }),
    empty,
  ),

  // picker ----------------------------------------------------------------
  "picker.start": action(
    "content",
    "Let the person pick an element. Resolves with its locator; Esc cancels.",
    z.object({ prompt: z.string().max(200).optional() }),
    z.object({
      ref: z.string(),
      locator: z.object({
        css: z.string(),
        role: z.string().optional(),
        name: z.string().optional(),
        testId: z.string().optional(),
        text: z.string().optional(),
      }),
      element: elementInfoSchema,
    }),
    { timeoutMs: 120_000 },
  ),
  "picker.cancel": action("content", "Stop an active picker.", empty, empty),
} satisfies Record<string, ActionSchema>;

export type CoreActionName = keyof typeof coreActionSchemas;

/** Turn a record of action schemas into the input/output type map the client uses. */
export type ActionTypesOf<S extends Record<string, ActionSchema>> = {
  [K in keyof S]: { input: z.input<S[K]["input"]>; output: z.output<S[K]["output"]> };
};

export type CoreActions = ActionTypesOf<typeof coreActionSchemas>;

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export const coreEventSchemas = {
  "tab.updated": z.object({ tab: tabInfoSchema, changes: z.record(z.string(), z.unknown()) }),
  "tab.activated": z.object({ tabId: z.number(), windowId: z.number() }),
  "tab.removed": z.object({ tabId: z.number() }),
  "picker.selected": z.object({ ref: z.string(), locator: z.record(z.string(), z.string()), url: z.string() }),
  "picker.hovered": z.object({ ref: z.string(), role: z.string(), name: z.string() }),
};

export type CoreEvents = { [K in keyof typeof coreEventSchemas]: z.output<(typeof coreEventSchemas)[K]> };

export type ElementInfo = z.output<typeof elementInfoSchema>;
export type TabInfo = z.output<typeof tabInfoSchema>;
export type Box = z.output<typeof boxSchema>;

export { z };
