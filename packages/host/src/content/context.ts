export interface ContentContext {
  signal: AbortSignal;
  timeoutMs: number;
  policy: { sensitiveFields: "refuse" | "allow" };
  emit(name: string, payload: unknown): void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ContentHandler = (input: any, ctx: ContentContext) => unknown | Promise<unknown>;

export interface ContentGroup {
  name: string;
  handlers: Record<string, ContentHandler>;
}
