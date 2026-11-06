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
  /** Chrome unloaded the tab to save memory. It reloads when it is activated or reloaded. */
  discarded: z.boolean().optional(),
  /** false: Chrome won't discard the tab when memory is low (see tabs.update). */
  autoDiscardable: z.boolean().optional(),
});

export const windowInfoSchema = z.object({
  id: z.number(),
  focused: z.boolean(),
  state: z.string(),
  type: z.string(),
  incognito: z.boolean(),
  left: z.number().optional(),
  top: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  tabCount: z.number(),
});

export const downloadInfoSchema = z.object({
  id: z.number(),
  url: z.string(),
  /** Full path on disk; empty until Chrome has picked it. */
  filename: z.string(),
  state: z.string(),
  mime: z.string(),
  bytesReceived: z.number(),
  totalBytes: z.number(),
  startTime: z.string(),
  error: z.string().optional(),
});

export const bookmarkSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().optional(),
  parentId: z.string().optional(),
  index: z.number().optional(),
  dateAdded: z.number().optional(),
  folder: z.boolean(),
});

export const historyItemSchema = z.object({
  url: z.string(),
  title: z.string(),
  lastVisitTime: z.number().optional(),
  visitCount: z.number(),
  typedCount: z.number(),
});

export const cookieSchema = z.object({
  name: z.string(),
  value: z.string(),
  domain: z.string(),
  path: z.string(),
  secure: z.boolean(),
  httpOnly: z.boolean(),
  sameSite: z.string(),
  session: z.boolean(),
  hostOnly: z.boolean(),
  expirationDate: z.number().optional(),
});

const windowBoundsShape = {
  left: z.number().int().optional(),
  top: z.number().int().optional(),
  width: z.number().int().min(100).optional(),
  height: z.number().int().min(100).optional(),
};

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
  where: "background" | "content" | "bridge";
  version: number;
  /** Default timeout for the whole call, in ms. */
  timeoutMs?: number;
  description: string;
  /** false: can't run inside another action (run.sequence). Default true. */
  nestable?: boolean;
}

function action<I extends z.ZodType, O extends z.ZodType>(
  where: "background" | "content" | "bridge",
  description: string,
  input: I,
  output: O,
  extra: { timeoutMs?: number; version?: number; nestable?: boolean } = {},
): ActionSchema<I, O> {
  return {
    input,
    output,
    where,
    description,
    version: extra.version ?? 1,
    ...(extra.timeoutMs ? { timeoutMs: extra.timeoutMs } : {}),
    ...(extra.nestable === false ? { nestable: false } : {}),
  };
}

const jsonSchemaLike = z.record(z.string(), z.unknown());

/** One step of run.sequence: data only, no expressions or branches. */
export const sequenceStepSchema = z.object({
  action: z.string(),
  input: z.unknown().optional(),
  target: z
    .object({
      tab: z.union([z.literal("active"), z.number(), z.object({ urlMatch: z.string() })]).optional(),
      frame: z.union([z.literal("top"), z.number(), z.object({ urlMatch: z.string() })]).optional(),
    })
    .optional(),
  timeoutMs: z.number().int().min(1).max(120_000).optional(),
  /** What to do if this step fails. Default: the sequence's onError. */
  onError: z.enum(["stop", "continue"]).optional(),
  /** Wait this long after the step succeeds (for animations, debounced UIs). */
  pauseMs: z.number().int().min(0).max(10_000).optional(),
});

export const coreActionSchemas = {
  // runtime ----------------------------------------------------------------
  "runtime.ping": action("background", "Check the connection.", empty, z.object({ pong: z.literal(true), ts: z.number() })),
  "runtime.describe": action(
    "background",
    "List the actions this controller may call, with JSON schemas for their input and output. Includes host-defined actions.",
    z.object({ actions: z.array(z.string()).optional() }),
    z.object({
      host: z.object({ id: z.string(), name: z.string().optional(), version: z.string().optional() }),
      actions: z.array(
        z.object({
          name: z.string(),
          description: z.string(),
          where: z.enum(["background", "content", "bridge"]),
          version: z.number(),
          input: jsonSchemaLike,
          output: jsonSchemaLike,
        }),
      ),
    }),
  ),

  // run -------------------------------------------------------------------
  "run.sequence": action(
    "background",
    "Run several actions in order in one round trip. Steps are plain data: no conditions or expressions. Each step is checked like a separate call.",
    z.object({
      steps: z.array(sequenceStepSchema).min(1).max(50),
      onError: z.enum(["stop", "continue"]).default("stop"),
    }),
    z.object({
      completed: z.number(),
      ok: z.boolean(),
      results: z.array(
        z.union([
          z.object({ ok: z.literal(true), action: z.string(), output: z.unknown() }),
          z.object({ ok: z.literal(false), action: z.string(), error: z.object({ code: z.string(), message: z.string() }) }),
        ]),
      ),
    }),
    { timeoutMs: 120_000, nestable: false },
  ),

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
  "tabs.goBack": action(
    "background",
    "Go back one step in the target tab's history.",
    z.object({ waitForLoad: z.boolean().default(true) }),
    tabInfoSchema,
    { timeoutMs: 30_000 },
  ),
  "tabs.goForward": action(
    "background",
    "Go forward one step in the target tab's history.",
    z.object({ waitForLoad: z.boolean().default(true) }),
    tabInfoSchema,
    { timeoutMs: 30_000 },
  ),
  "tabs.update": action(
    "background",
    "Pin, mute or zoom the target tab, or keep Chrome from discarding it (autoDiscardable: false) while it works in the background.",
    z
      .object({
        pinned: z.boolean().optional(),
        muted: z.boolean().optional(),
        /** Page zoom factor; 1 is 100%. */
        zoom: z.number().min(0.25).max(5).optional(),
        /** false: Chrome won't unload the tab to save memory. */
        autoDiscardable: z.boolean().optional(),
      })
      .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Give pinned, muted, zoom or autoDiscardable" }),
    tabInfoSchema.extend({ pinned: z.boolean(), muted: z.boolean(), zoom: z.number(), autoDiscardable: z.boolean() }),
  ),

  // windows ---------------------------------------------------------------
  "windows.list": action(
    "background",
    "List browser windows.",
    empty,
    z.object({ windows: z.array(windowInfoSchema) }),
  ),
  "windows.open": action(
    "background",
    "Open a new browser window, optionally at a URL.",
    z.object({
      url: z.string().optional(),
      focused: z.boolean().default(true),
      type: z.enum(["normal", "popup"]).default("normal"),
      ...windowBoundsShape,
      waitForLoad: z.boolean().default(true),
    }),
    windowInfoSchema.extend({ tab: tabInfoSchema.optional() }),
    { timeoutMs: 30_000 },
  ),
  "windows.update": action(
    "background",
    "Focus, resize, move, minimize or maximize a window.",
    z.object({
      windowId: z.number(),
      focused: z.boolean().optional(),
      state: z.enum(["normal", "minimized", "maximized", "fullscreen"]).optional(),
      ...windowBoundsShape,
    }),
    windowInfoSchema,
  ),
  "windows.close": action("background", "Close a window and all its tabs.", z.object({ windowId: z.number() }), empty),

  // capture ---------------------------------------------------------------
  "capture.screenshot": action(
    "background",
    "Capture the visible part of the target tab, or crop to one element. A tab in the background is captured through tab capture (the tabCapture group).",
    z.object({
      format: z.enum(["png", "jpeg"]).default("png"),
      quality: z.number().int().min(0).max(100).optional(),
      locator: locatorSchema.optional(),
    }),
    z.object({ dataUrl: z.string(), width: z.number(), height: z.number() }),
    { timeoutMs: 15_000 },
  ),
  "capture.fullPage": action(
    "background",
    "Capture the whole page by scrolling and stitching. A tab in the background is captured through tab capture (the tabCapture group). Fixed headers may show more than once.",
    z.object({
      format: z.enum(["png", "jpeg"]).default("png"),
      quality: z.number().int().min(0).max(100).optional(),
      /** Stop after this many CSS pixels of page height. */
      maxHeight: z.number().int().min(100).max(30_000).default(15_000),
    }),
    z.object({ dataUrl: z.string(), width: z.number(), height: z.number(), truncated: z.boolean() }),
    { timeoutMs: 90_000 },
  ),

  // tabCapture ------------------------------------------------------------
  "tabCapture.start": action(
    "background",
    "Keep the target tab rendering in the background by capturing it: Chrome keeps painting it, runs its animation frames and timers at full speed, and doesn't discard it. Screenshots of it then work without bringing it to the front. The extension must have been invoked on the tab (toolbar button, side panel, shortcut or context menu) since it last navigated; otherwise this fails with NEEDS_USER_GESTURE.",
    empty,
    z.object({ tabId: z.number(), width: z.number(), height: z.number() }),
    { timeoutMs: 15_000 },
  ),
  "tabCapture.stop": action("background", "Stop capturing the target tab, so Chrome can throttle it again.", empty, z.object({ stopped: z.boolean() })),
  "tabCapture.list": action("background", "List the tabs being captured to keep them rendering.", empty, z.object({ tabIds: z.array(z.number()) })),

  // frames ----------------------------------------------------------------
  "frames.list": action(
    "background",
    "List the frames (iframes) in the target tab, to target one with { frame: frameId } or { frame: { urlMatch } }.",
    empty,
    z.object({ frames: z.array(z.object({ frameId: z.number(), parentFrameId: z.number(), url: z.string() })) }),
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
      /** Only elements at least partly inside the visible viewport. Keeps snapshots of long pages small. */
      viewportOnly: z.boolean().default(false),
      /** Cut text nodes longer than this. */
      textMaxLength: z.number().int().min(10).max(5000).default(300),
      format: z.enum(["tree", "text", "both"]).default("both"),
    }),
    z.object({
      root: snapshotNodeSchema.optional(),
      text: z.string().optional(),
      nodeCount: z.number(),
      truncated: z.boolean(),
    }),
  ),
  "dom.html": action(
    "content",
    "HTML of the page or of one element. Password and payment field values are masked; shadow roots are not included.",
    z.object({
      locator: locatorSchema.optional(),
      /** Include the element's own tag (outerHTML), or only its children (innerHTML). */
      outer: z.boolean().default(true),
      maxLength: z.number().int().min(1).max(5_000_000).default(500_000),
    }),
    z.object({ html: z.string(), length: z.number(), truncated: z.boolean() }),
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
      /** Hold the button down this long before releasing (long press). */
      holdMs: z.number().int().min(0).max(10_000).default(0),
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
  "dom.blur": action("content", "Take focus away from an element (or the focused element).", z.object({ locator: locatorSchema.optional() }), z.object({ ref: z.string().optional() })),
  "dom.drag": action(
    "content",
    "Drag an element onto another element, or by an offset (sliders, sortable lists, HTML5 drag and drop).",
    z
      .object({
        from: locatorSchema,
        to: locatorSchema.optional(),
        /** Move by this many pixels from the source's center instead of onto an element. */
        offset: z.object({ x: z.number(), y: z.number() }).optional(),
        /** Pointer moves between start and end. */
        steps: z.number().int().min(1).max(100).default(10),
      })
      .refine((v) => Boolean(v.to) !== Boolean(v.offset), { message: "Give either to or offset" }),
    z.object({ from: z.string(), to: z.string().optional(), html5: z.boolean() }),
  ),
  "dom.upload": action(
    "content",
    "Give files to an <input type=file>, or drop them on a drop zone. Content is base64 (or text).",
    z.object({
      locator: locatorSchema,
      files: z
        .array(
          z
            .object({
              name: z.string().min(1).max(255),
              mimeType: z.string().default("application/octet-stream"),
              base64: z.string().optional(),
              text: z.string().optional(),
            })
            .refine((f) => (f.base64 === undefined) !== (f.text === undefined), { message: "Give base64 or text" }),
        )
        .min(1)
        .max(20),
    }),
    z.object({ ref: z.string(), files: z.number(), via: z.enum(["input", "drop"]) }),
    { timeoutMs: 30_000 },
  ),
  "dom.scroll": action(
    "content",
    "Scroll inside a scrollable element (a list, a panel) by an amount, to a position, or to an edge.",
    z.object({
      locator: locatorSchema,
      x: z.number().optional(),
      y: z.number().optional(),
      by: z.boolean().default(true),
      to: z.enum(["top", "bottom", "left", "right"]).optional(),
      behavior: scrollBehavior.default("instant"),
    }),
    z.object({ ref: z.string(), scrollTop: z.number(), scrollLeft: z.number(), scrollHeight: z.number(), scrollWidth: z.number(), clientHeight: z.number(), clientWidth: z.number() }),
  ),
  "dom.wheel": action(
    "content",
    "Turn the mouse wheel over an element (or the page). Fires wheel events, then scrolls if the page didn't cancel them.",
    z.object({
      locator: locatorSchema.optional(),
      deltaX: z.number().default(0),
      deltaY: z.number().default(100),
      steps: z.number().int().min(1).max(50).default(1),
    }),
    z.object({ ref: z.string().optional(), scrolled: z.boolean(), scrollTop: z.number(), scrollLeft: z.number() }),
  ),
  "dom.selectText": action(
    "content",
    "Select text: a range in an input, part of an element's text, or all of it.",
    z.object({
      locator: locatorSchema,
      /** Character offsets (inputs and textareas, or within the element's text). */
      start: z.number().int().min(0).optional(),
      end: z.number().int().min(0).optional(),
      /** Select the first occurrence of this text inside the element. */
      text: z.string().optional(),
    }),
    z.object({ ref: z.string(), selected: z.string() }),
  ),
  "dom.paste": action(
    "content",
    "Paste text into an element (or the focused element): fires a paste event, then inserts the text unless the page handled it.",
    z.object({ locator: locatorSchema.optional(), text: z.string() }),
    z.object({ ref: z.string(), handledByPage: z.boolean() }),
  ),
  "dom.pointer": action(
    "content",
    "Low-level pointer: press, move or release at an element (or viewport point). For custom gestures.",
    z
      .object({
        type: z.enum(["down", "move", "up"]),
        locator: locatorSchema.optional(),
        /** Viewport coordinates, instead of an element's center. */
        x: z.number().optional(),
        y: z.number().optional(),
        button: z.enum(["left", "middle", "right"]).default("left"),
      })
      .refine((v) => v.locator || (v.x !== undefined && v.y !== undefined), { message: "Give a locator or x and y" }),
    z.object({ ref: z.string().optional(), x: z.number(), y: z.number() }),
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

  // edit: changing the page's DOM -----------------------------------------
  "edit.setHtml": action(
    "content",
    "Replace or insert HTML at an element. The HTML is sanitized first: scripts, frames, plugins, event-handler attributes and javascript: URLs are removed.",
    z.object({
      locator: locatorSchema,
      html: z.string().max(5_000_000),
      /** inner: replace children; outer: replace the element; or insert next to it (insertAdjacentHTML positions). */
      position: z.enum(["inner", "outer", "beforebegin", "afterbegin", "beforeend", "afterend"]).default("inner"),
    }),
    z.object({
      /** Refs of the top-level elements that were inserted. */
      refs: z.array(z.string()),
      /** Elements and attributes the sanitizer removed. */
      removed: z.number(),
    }),
  ),
  "edit.setText": action(
    "content",
    "Replace an element's text content (removes its children).",
    z.object({ locator: locatorSchema, text: z.string().max(5_000_000) }),
    refOut,
  ),
  "edit.setAttributes": action(
    "content",
    "Set or remove attributes on an element (null removes). Event-handler attributes and javascript: URLs are refused.",
    z.object({ locator: locatorSchema, attributes: z.record(z.string().min(1), z.string().nullable()) }),
    z.object({ ref: z.string(), attributes: z.record(z.string(), z.string()) }),
  ),
  "edit.remove": action(
    "content",
    "Remove elements from the page.",
    z.object({ locator: locatorSchema, all: z.boolean().default(false) }),
    z.object({ removed: z.number() }),
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

  // downloads (opt-in) ----------------------------------------------------
  "downloads.start": action(
    "background",
    "Download a URL to the person's Downloads folder, and by default wait until it finishes.",
    z.object({
      url: z.string(),
      /** Path relative to the Downloads folder. */
      filename: z.string().min(1).max(255).optional(),
      conflictAction: z.enum(["uniquify", "overwrite", "prompt"]).default("uniquify"),
      /** Show the Save As dialog. */
      saveAs: z.boolean().default(false),
      waitForComplete: z.boolean().default(true),
    }),
    downloadInfoSchema,
    { timeoutMs: 120_000 },
  ),
  "downloads.list": action(
    "background",
    "List recent downloads, newest first.",
    z.object({
      query: z.string().optional(),
      state: z.enum(["in_progress", "interrupted", "complete"]).optional(),
      limit: z.number().int().min(1).max(1000).default(50),
    }),
    z.object({ downloads: z.array(downloadInfoSchema) }),
  ),
  "downloads.cancel": action("background", "Cancel a download that is in progress.", z.object({ id: z.number() }), empty),

  // bookmarks (opt-in) ----------------------------------------------------
  "bookmarks.search": action(
    "background",
    "Find bookmarks whose title or URL contains the text.",
    z.object({ query: z.string().min(1), limit: z.number().int().min(1).max(1000).default(100) }),
    z.object({ bookmarks: z.array(bookmarkSchema) }),
  ),
  "bookmarks.list": action(
    "background",
    "List the bookmarks and folders inside a folder (default: the top-level folders).",
    z.object({ parentId: z.string().default("0") }),
    z.object({ bookmarks: z.array(bookmarkSchema) }),
  ),
  "bookmarks.create": action(
    "background",
    "Add a bookmark, or a folder when no url is given.",
    z.object({ title: z.string(), url: z.string().optional(), parentId: z.string().optional(), index: z.number().int().min(0).optional() }),
    bookmarkSchema,
  ),
  "bookmarks.update": action(
    "background",
    "Rename a bookmark, change its URL, or move it to another folder or position.",
    z
      .object({ id: z.string(), title: z.string().optional(), url: z.string().optional(), parentId: z.string().optional(), index: z.number().int().min(0).optional() })
      .refine((v) => v.title !== undefined || v.url !== undefined || v.parentId !== undefined || v.index !== undefined, { message: "Give title, url, parentId or index" }),
    bookmarkSchema,
  ),
  "bookmarks.remove": action(
    "background",
    "Delete a bookmark, or a folder (a folder with contents needs recursive: true).",
    z.object({ id: z.string(), recursive: z.boolean().default(false) }),
    empty,
  ),

  // history (opt-in) ------------------------------------------------------
  "history.search": action(
    "background",
    "Search the browsing history, most recent first. Times are ms since the epoch.",
    z.object({
      text: z.string().default(""),
      startTime: z.number().optional(),
      endTime: z.number().optional(),
      limit: z.number().int().min(1).max(1000).default(100),
    }),
    z.object({ items: z.array(historyItemSchema) }),
  ),
  "history.delete": action("background", "Remove every visit to a URL from the history.", z.object({ url: z.string() }), empty),

  // cookies (opt-in) ------------------------------------------------------
  "cookies.list": action(
    "background",
    "List cookies for a URL or a domain, optionally by name.",
    z
      .object({ url: z.string().optional(), domain: z.string().optional(), name: z.string().optional() })
      .refine((v) => v.url || v.domain, { message: "Give a url or a domain" }),
    z.object({ cookies: z.array(cookieSchema) }),
  ),
  "cookies.set": action(
    "background",
    "Set a cookie. Without expirationDate (seconds since the epoch) it is a session cookie.",
    z.object({
      url: z.string(),
      name: z.string(),
      value: z.string(),
      domain: z.string().optional(),
      path: z.string().optional(),
      secure: z.boolean().optional(),
      httpOnly: z.boolean().optional(),
      sameSite: z.enum(["no_restriction", "lax", "strict", "unspecified"]).optional(),
      expirationDate: z.number().optional(),
    }),
    cookieSchema,
  ),
  "cookies.remove": action(
    "background",
    "Delete a cookie by URL and name.",
    z.object({ url: z.string(), name: z.string() }),
    z.object({ removed: z.boolean() }),
  ),

  // permissions (run in the frame bridge, which has the person's click) ----
  "permissions.contains": action(
    "bridge",
    "Check whether the extension has these permissions or host origins.",
    permissionSetSchema(),
    z.object({ granted: z.boolean() }),
  ),
  "permissions.request": action(
    "bridge",
    "Ask the person for optional permissions or host origins. Needs a click in the frame within the last few seconds.",
    permissionSetSchema(),
    z.object({ granted: z.boolean() }),
    { timeoutMs: 120_000 },
  ),
  "permissions.getAll": action(
    "bridge",
    "List the permissions and host origins the extension has now.",
    empty,
    z.object({ permissions: z.array(z.string()), origins: z.array(z.string()) }),
  ),
} satisfies Record<string, ActionSchema>;

function permissionSetSchema() {
  return z
    .object({ permissions: z.array(z.string()).optional(), origins: z.array(z.string()).optional() })
    .refine((p) => (p.permissions?.length ?? 0) + (p.origins?.length ?? 0) > 0, { message: "Give permissions or origins" });
}

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
export type WindowInfo = z.output<typeof windowInfoSchema>;
export type Box = z.output<typeof boxSchema>;

export { z };
