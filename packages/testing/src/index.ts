/**
 * @extension-use/testing
 *
 * An in-memory host for unit tests of controllers. It runs the real router, so
 * inputs are validated, grants and site policy apply, and errors have the same
 * codes as in the browser. You provide the results of the actions you use.
 *
 *   const host = createMockHost({
 *     handlers: { "dom.click": () => ({ ref: "e1" }) },
 *   });
 *   const ext = await host.connect();
 *   await ext.dom.click({ locator: { role: "button", name: "Save" } });
 *   expect(host.calls).toEqual([{ action: "dom.click", input: { ... }, target: undefined }]);
 */
import { connect, type Client, type ConnectOptions } from "@extension-use/client";
import { memoryPair } from "@extension-use/client/memory";
import { createRouter, type ActionDef, type Policy, type ResolvedTab } from "@extension-use/host/background";
import { ExtensionUseError, type Target } from "@extension-use/protocol";
import { coreActionSchemas, type CoreActionName, type CoreActions } from "@extension-use/protocol/schemas";

export interface MockCall {
  action: string;
  input: unknown;
  target: Target | undefined;
}

export interface MockContext {
  target: Target | undefined;
  tab: ResolvedTab;
}

type CoreHandlers = {
  [K in CoreActionName]?: (input: Required<CoreActions[K]["input"]>, ctx: MockContext) => CoreActions[K]["output"] | Promise<CoreActions[K]["output"]>;
};

export type MockHandler = (input: any, ctx: MockContext) => unknown; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface MockHostOptions {
  /** Results for built-in actions. Actions without a handler are not offered (UNKNOWN_ACTION). */
  handlers?: CoreHandlers & Record<string, MockHandler>;
  /** Host-defined actions, run for real. */
  actions?: ActionDef[];
  /** Grants for connected controllers. Default ["*"]. */
  grants?: string[];
  /** The tab every call targets. Default: tab 1 on https://example.com/. */
  tab?: Partial<ResolvedTab> | ((target: Target | undefined) => ResolvedTab | Promise<ResolvedTab>);
  policy?: Policy;
  /** Check handler results against the action's output schema. Default true. */
  validateOutput?: boolean;
}

export interface MockHost {
  /** Connect a new controller. */
  connect<A extends Record<string, { input: unknown; output: unknown }> = CoreActions>(options?: ConnectOptions): Promise<Client<A>>;
  /** Every call that reached a handler, in order. */
  readonly calls: MockCall[];
  /** Calls to one action. */
  callsTo(action: string): MockCall[];
  /** Push an event to subscribed controllers. */
  emit(name: string, payload: unknown, tabId?: number): void;
  /** Replace or add a handler while the test runs. */
  setHandler(action: string, handler: MockHandler): void;
  /** The real router underneath (pause(), audit()...). */
  readonly router: ReturnType<typeof createRouter>;
}

export function createMockHost(options: MockHostOptions = {}): MockHost {
  const handlers = new Map<string, MockHandler>(Object.entries(options.handlers ?? {}) as [string, MockHandler][]);
  if (!handlers.has("runtime.ping")) handlers.set("runtime.ping", () => ({ pong: true, ts: Date.now() }));
  const calls: MockCall[] = [];
  const validate = options.validateOutput ?? true;
  const schemas = coreActionSchemas as Record<string, (typeof coreActionSchemas)[CoreActionName]>;

  const resolveTab = async (target: Target | undefined): Promise<ResolvedTab> => {
    if (typeof options.tab === "function") return options.tab(target);
    return { tabId: 1, windowId: 1, url: "https://example.com/", ...options.tab };
  };

  const run = async (action: string, input: unknown, target: Target | undefined, tab: ResolvedTab) => {
    const handler = handlers.get(action);
    if (!handler) throw new ExtensionUseError("UNKNOWN_ACTION", `No mock handler for "${action}"`);
    calls.push({ action, input, target });
    const output = await handler(input, { target, tab });
    const schema = schemas[action];
    if (validate && schema) {
      const parsed = schema.output.safeParse(output ?? {});
      if (!parsed.success) {
        throw new ExtensionUseError("INTERNAL", `Mock for "${action}" returned an invalid result: ${parsed.error.issues.map((i) => `${i.path.join(".") || "output"} ${i.message}`).join("; ")}`);
      }
    }
    return output ?? {};
  };

  // Built-in actions with a handler are registered with their real schema.
  // Background and bridge ones run the handler; content ones go through
  // sendToContent like in a browser.
  const defs: ActionDef[] = [];
  for (const name of handlers.keys()) {
    const schema = schemas[name];
    if (!schema) continue; // custom names must come with `actions`
    if (schema.where === "content") defs.push({ name, schema });
    else
      defs.push({
        name,
        schema,
        handler: async (input, ctx) => run(name, input, ctx.target, await ctx.tab()),
      } as ActionDef);
  }
  const custom = new Set((options.actions ?? []).map((a) => a.name));
  for (const name of handlers.keys()) {
    if (!schemas[name] && !custom.has(name)) throw new Error(`Mock handler "${name}" is not a built-in action; pass its definition in \`actions\``);
  }
  const router = createRouter({
    host: { id: "mock-host", name: "Mock host", version: "0.0.0" },
    actions: [...defs, ...(options.actions ?? [])],
    ...(options.policy ? { policy: options.policy } : {}),
    env: {
      resolveTab: (target) => resolveTab(target),
      sendToContent: async (tab, _frameId, req) => run(req.action, req.input, req.target, tab),
    },
  });

  return {
    async connect(connectOptions) {
      const { transport, server } = memoryPair();
      const conn = router.connect({
        transport: "memory",
        origin: "mock://controller",
        grants: options.grants ?? ["*"],
        send: (env) => server.send(env),
      });
      server.onMessage((env) => conn.receive(env));
      return connect(transport, connectOptions);
    },
    calls,
    callsTo: (action) => calls.filter((c) => c.action === action),
    emit: (name, payload, tabId) => router.emit(name, payload, tabId),
    setHandler(action, handler) {
      if (!handlers.has(action)) throw new Error(`"${action}" was not registered when the host was created; add a handler for it in createMockHost()`);
      handlers.set(action, handler);
    },
    router,
  };
}

/** Assert that a promise rejects with an Extension-use error code. Returns the error. */
export async function expectErrorCode(promise: Promise<unknown>, code: string): Promise<ExtensionUseError> {
  try {
    await promise;
  } catch (err) {
    const e = ExtensionUseError.from(err);
    if (e.code !== code) throw new Error(`Expected error ${code}, got ${e.code}: ${e.message}`);
    return e;
  }
  throw new Error(`Expected error ${code}, but the call succeeded`);
}
