import type { ActionSchema } from "@extension-use/protocol/schemas";
import type { Target } from "@extension-use/protocol";
import type * as z from "zod";

export interface SessionInfo {
  id: string;
  transport: string;
  origin: string;
  windowId?: number;
  granted: string[];
}

export interface ResolvedTab {
  tabId: number;
  windowId: number;
  url: string;
}

export interface ActionContext {
  session: SessionInfo;
  host: { id: string; name?: string; version?: string };
  target: Target | undefined;
  signal: AbortSignal;
  timeoutMs: number;
  /** Resolve the call's target tab. Throws TARGET_NOT_FOUND or BLOCKED_BY_POLICY. */
  tab(): Promise<ResolvedTab>;
  /** Run a content action in the call's target tab. */
  callContent<O = unknown>(action: string, input: unknown): Promise<O>;
  /**
   * Run another action as the same controller, through the full pipeline
   * (grants, input checks, policy, audit). Used by run.sequence.
   */
  call(action: string, input: unknown, options?: { target?: Target; timeoutMs?: number }): Promise<unknown>;
  /** The actions this controller may call. */
  listActions(): ActionDef[];
  /** Check a URL against the site policy. Throws BLOCKED_BY_POLICY. */
  assertAllowedUrl(url: string): void;
  emit(name: string, payload: unknown, tabId?: number): void;
}

export interface ActionDef<S extends ActionSchema = ActionSchema> {
  name: string;
  schema: S;
  /** Required for background actions. Content actions are forwarded to the content runtime. */
  handler?: (input: z.output<S["input"]>, ctx: ActionContext) => Promise<z.input<S["output"]>> | z.input<S["output"]>;
}

export interface ActionGroup {
  name: string;
  /** Manifest `permissions` this group needs. */
  permissions: string[];
  /** Whether this group needs host access to pages (content script or capture). */
  needsHostAccess: boolean;
  actions: ActionDef[];
}

/** Define a host-specific action, such as `emaki.captureItems`. */
export function defineAction<S extends ActionSchema>(name: string, schema: S, handler?: ActionDef<S>["handler"]): ActionDef<S> {
  if (schema.where === "background" && !handler) {
    throw new Error(`Background action "${name}" needs a handler`);
  }
  return handler ? { name, schema, handler } : { name, schema };
}
