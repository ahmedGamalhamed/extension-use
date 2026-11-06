/**
 * @extension-use/mcp
 *
 * An MCP server whose tools are the actions of a paired browser. Tool lists
 * come from the extension itself (runtime.describe), so host-defined actions
 * show up too, and every call goes through the extension's grants, site
 * policy, kill switch and visible-control indicators.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Client } from "@extension-use/client";
import { ExtensionUseError } from "@extension-use/protocol";

export const MCP_VERSION = "0.1.0";
export { listenForBrowser, type LocalAgentOptions, type LocalAgentLink } from "./local.js";

export interface ExtensionUseMcpOptions {
  /**
   * Returns a connected client (for example `connect(remote({ relay, token }))`). Called again after a disconnect.
   * `purpose` says why: "list" (listing tools, so don't wait long for a browser) or "call" (a tool call).
   */
  connect(context?: { purpose: "list" | "call" }): Promise<Client>;
  /** Only expose these actions (patterns like "dom.*"). Default: everything the token allows. */
  include?: string[];
  /** Hide these actions. Default: none. */
  exclude?: string[];
  name?: string;
}

interface Described {
  name: string;
  description: string;
  where: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}

const INSTRUCTIONS = `These tools act in the user's real browser, signed in as them. Work like this:
1. Call dom_snapshot (it defaults to the visible part of the page) to see the page as an accessibility tree. Interactive elements have refs like [ref=e12].
2. Act with a locator that uses a ref, e.g. dom_click { "locator": { "ref": "e12" } }. Refs stay valid until the page reloads.
3. Take a new snapshot after actions that change the page.
Use tabs_list / tabs_open / tabs_activate to pick a tab; most tools also take an optional "target" ({ "tab": <id> } or { "tab": { "urlMatch": "https://example.com/*" } }).
Typing into password and payment fields is refused. If a tool returns BLOCKED_BY_POLICY with "paused", the user pressed the kill switch: stop and ask them.
Use run_sequence to batch several known steps in one call.`;

const TARGET_SCHEMA = {
  type: "object",
  description: 'Which tab to act on. Default: the active tab. { "tab": <tabId> } or { "tab": { "urlMatch": "https://example.com/*" } }.',
  properties: {
    tab: {
      anyOf: [{ type: "number" }, { type: "string", enum: ["active"] }, { type: "object", properties: { urlMatch: { type: "string" } }, required: ["urlMatch"] }],
    },
    frame: { anyOf: [{ type: "number" }, { type: "string", enum: ["top"] }] },
  },
};

const toolName = (action: string) => action.replace(/\./g, "_");

function matches(patterns: string[] | undefined, name: string) {
  return patterns?.some((p) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`).test(name));
}

export function createExtensionUseMcpServer(options: ExtensionUseMcpOptions) {
  let client: Client | undefined;
  let connecting: Promise<Client> | undefined;
  let described: { at: number; actions: Described[] } | undefined;

  async function ext(purpose: "list" | "call"): Promise<Client> {
    if (client?.connected) return client;
    connecting ??= options
      .connect({ purpose })
      .then((c) => {
        client = c;
        described = undefined;
        c.onDisconnect(() => {
          if (client === c) client = undefined;
        });
        return c;
      })
      .finally(() => (connecting = undefined));
    return connecting;
  }

  async function describe(purpose: "list" | "call"): Promise<Described[]> {
    if (described && Date.now() - described.at < 60_000) return described.actions;
    const c = await ext(purpose);
    const out = (await c.callRaw("runtime.describe", {}, { timeoutMs: 10_000 })) as { actions: Described[] };
    // c.has() also checks the welcome's capabilities, which the relay narrows to the token.
    const actions = out.actions.filter(
      (a) => a.name !== "runtime.describe" && c.has(a.name) && (!options.include || matches(options.include, a.name)) && !matches(options.exclude, a.name),
    );
    described = { at: Date.now(), actions };
    return actions;
  }

  const server = new Server({ name: options.name ?? "extension-use", version: MCP_VERSION }, { capabilities: { tools: { listChanged: true } }, instructions: INSTRUCTIONS });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    let actions: Described[];
    try {
      actions = await describe("list");
    } catch (err) {
      // No browser yet: offer a status tool that explains how to connect.
      const e = ExtensionUseError.from(err);
      return {
        tools: [
          {
            name: "browser_status",
            description: `The browser is not connected (${e.code}: ${e.message}). Call this tool to check again once the user has connected the browser.`,
            inputSchema: { type: "object", properties: {} },
          },
        ],
      };
    }
    const tools: Tool[] = actions.map((a) => {
      const input = { ...a.input } as { type?: string; properties?: Record<string, unknown>; required?: string[] };
      const properties = { ...(input.properties ?? {}) };
      if (a.where !== "bridge" && !a.name.startsWith("runtime.") && a.name !== "run.sequence") {
        properties.target = TARGET_SCHEMA;
      }
      properties.timeoutMs = { type: "number", description: "Optional timeout for this call, in milliseconds." };
      return {
        name: toolName(a.name),
        description: describeTool(a),
        inputSchema: { type: "object", properties, ...(input.required?.length ? { required: input.required } : {}) },
        annotations: { readOnlyHint: READ_ONLY.has(a.name), destructiveHint: DESTRUCTIVE.has(a.name), openWorldHint: true },
      } as Tool;
    });
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    const name = req.params.name;
    const args = { ...(req.params.arguments ?? {}) } as Record<string, unknown>;
    try {
      if (name === "browser_status") {
        const c = await ext("call");
        return text(`Connected to "${c.host.name ?? c.host.id}" with ${c.capabilities.length} actions. List the tools again to see them.`);
      }
      const actions = await describe("call");
      const action = actions.find((a) => toolName(a.name) === name)?.name;
      if (!action) return error("UNKNOWN_ACTION", `No tool "${name}". List the tools again; the browser's actions may have changed.`);

      const { target, timeoutMs, ...input } = args;
      // Snapshots for a model: text form, visible part of the page, unless asked otherwise.
      if (action === "dom.snapshot") {
        input.format ??= "text";
        input.viewportOnly ??= true;
      }
      // Whole pages of HTML swamp a model's context; ask for more when needed.
      if (action === "dom.html") input.maxLength ??= 50_000;
      const c = await ext("call");
      const output = await c.callRaw(action, input, {
        ...(target ? { target: target as never } : {}),
        ...(typeof timeoutMs === "number" ? { timeoutMs } : {}),
      });
      return format(action, output);
    } catch (err) {
      const e = ExtensionUseError.from(err);
      return error(e.code, e.message);
    }
  });

  return {
    server,
    /** Tell the MCP client to list the tools again, e.g. after a browser connects. */
    notifyToolsChanged() {
      described = undefined;
      server.sendToolListChanged().catch(() => {});
    },
    async close() {
      client?.close();
      await server.close();
    },
  };
}

const READ_ONLY = new Set([
  "runtime.ping",
  "tabs.list",
  "windows.list",
  "frames.list",
  "page.info",
  "dom.query",
  "dom.text",
  "dom.snapshot",
  "dom.html",
  "wait.for",
  "capture.screenshot",
  "capture.fullPage",
  "permissions.contains",
  "permissions.getAll",
  "downloads.list",
  "bookmarks.search",
  "bookmarks.list",
  "history.search",
  "cookies.list",
]);
const DESTRUCTIVE = new Set([
  "tabs.close",
  "windows.close",
  "edit.setHtml",
  "edit.setText",
  "edit.remove",
  "downloads.cancel",
  "bookmarks.remove",
  "history.delete",
  "cookies.set",
  "cookies.remove",
]);
const IMAGE_ACTIONS = new Set(["capture.screenshot", "capture.fullPage"]);

function describeTool(a: Described) {
  const extra =
    a.name === "dom.snapshot"
      ? " Returns a text tree; interactive elements carry [ref=…] for use in locators. Defaults: format text, viewportOnly true (set false for the whole page)."
      : IMAGE_ACTIONS.has(a.name)
        ? " Returns an image. The tab must be the visible one in its window (tabs_activate first)."
        : a.name === "dom.html"
          ? " Prefer dom_snapshot or dom_text for reading; use this when you need the markup. Default maxLength here is 50000; pass a locator to get one part."
        : a.where === "content"
          ? " Locators: { ref } from dom_snapshot is most reliable; also { role, name }, { text }, { testId }, { css }."
          : "";
  return `${a.description}${extra}`;
}

function text(t: string): CallToolResult {
  return { content: [{ type: "text", text: t }] };
}

function error(code: string, message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: `${code}: ${message}` }] };
}

function format(action: string, output: unknown): CallToolResult {
  if (action === "dom.snapshot") {
    const o = output as { text?: string; nodeCount: number; truncated: boolean };
    if (o.text !== undefined) return text(`${o.text}${o.truncated ? "\n(truncated: pass maxNodes or viewportOnly to see other parts)" : ""}`);
  }
  if (IMAGE_ACTIONS.has(action)) {
    const o = output as { dataUrl: string; width: number; height: number; truncated?: boolean };
    const m = /^data:([^;]+);base64,(.*)$/.exec(o.dataUrl);
    const size = `${o.width}×${o.height}${o.truncated ? " (truncated: the page is taller; pass maxHeight)" : ""}`;
    if (m) return { content: [{ type: "image", mimeType: m[1]!, data: m[2]! }, { type: "text", text: size }] };
  }
  if (action === "dom.html") {
    const o = output as { html: string; length: number; truncated: boolean };
    return text(`${o.html}${o.truncated ? `
(truncated at ${o.html.length} of ${o.length} characters: pass a locator or a larger maxLength)` : ""}`);
  }
  if (action === "dom.text") {
    const o = output as { text: string; truncated: boolean };
    return text(`${o.text}${o.truncated ? "\n(truncated)" : ""}`);
  }
  return text(JSON.stringify(output, null, 2));
}
