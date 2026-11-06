import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { envelope, PROTOCOL_VERSION, type Envelope } from "@extension-use/protocol";
import { z } from "@extension-use/protocol/schemas";
import { createRouter } from "../src/background/router.js";
import { mountFrameBridge, type FrameBridge } from "../src/frame/index.js";
import { defineAction } from "../src/registry.js";
import type { BridgeHello } from "../src/wire.js";

const APP = "https://app.example.com";

const echo = defineAction(
  "test.echo",
  { where: "background", version: 1, description: "echo", input: z.object({ text: z.string() }), output: z.object({ text: z.string() }) },
  async (input) => ({ text: input.text }),
);
const hang = defineAction(
  "test.hang",
  { where: "background", version: 1, description: "never answers", input: z.object({}), output: z.object({}) },
  () => new Promise(() => {}),
);

type Listener<T> = (arg: T) => void;

/**
 * A fake extension: `chrome.runtime.connect` pipes to a router the way defineHost
 * does, and `stopWorker()` drops every port and loses all state, like Chrome
 * stopping an idle MV3 service worker.
 */
function fakeExtension() {
  const makeRouter = () =>
    createRouter({
      host: { id: "test-host", version: "1.0.0" },
      actions: [echo, hang],
      env: {
        resolveTab: async () => ({ tabId: 1, windowId: 1, url: "https://example.com/" }),
        sendToContent: async () => ({}),
        cancelContent: () => {},
      },
    });
  let router = makeRouter();
  const ports: { disconnect(): void }[] = [];
  let connects = 0;
  let refuse = false;

  const connect = () => {
    connects++;
    const onMessage: Listener<Envelope>[] = [];
    const onDisconnect: Listener<void>[] = [];
    let open = true;
    let conn: ReturnType<typeof router.connect> | undefined;
    const r = router;
    const toBridge = (env: Envelope) => queueMicrotask(() => open && onMessage.forEach((l) => l(env)));
    const drop = () => {
      if (!open) return;
      open = false;
      conn?.close();
      onDisconnect.forEach((l) => l());
    };
    ports.push({ disconnect: drop });
    return {
      name: "extension-use:frame",
      postMessage(msg: unknown) {
        queueMicrotask(() => {
          if (!open) return;
          if (!conn) {
            const hello = msg as BridgeHello;
            if (refuse) return drop();
            conn = r.connect({ transport: "frame", origin: hello.origin, grants: ["*"], send: toBridge });
            return;
          }
          conn.receive(msg);
        });
      },
      disconnect() {
        open = false; // Chrome doesn't fire onDisconnect on the side that disconnects
        conn?.close();
      },
      onMessage: { addListener: (l: Listener<Envelope>) => onMessage.push(l) },
      onDisconnect: { addListener: (l: Listener<void>) => onDisconnect.push(l) },
    };
  };

  return {
    chrome: { runtime: { connect, lastError: undefined }, windows: { getCurrent: async () => ({ id: 1 }) } },
    get router() {
      return router;
    },
    get connects() {
      return connects;
    },
    set refuse(v: boolean) {
      refuse = v;
    },
    stopWorker() {
      router = makeRouter(); // the next connect wakes a fresh worker
      for (const p of ports.splice(0)) p.disconnect();
    },
  };
}

let ext: ReturnType<typeof fakeExtension>;
let bridge: FrameBridge;
let received: Envelope[];
let send: (env: Envelope) => void;

const flush = () => new Promise((r) => setTimeout(r, 0));
const results = (id: string) => received.filter((e) => e.kind === "result" && e.id === id);
const hello = () => envelope({ kind: "hello", client: { protocols: [PROTOCOL_VERSION] } });
const call = (id: string, action: string, input: unknown = {}) => envelope({ kind: "call", id, action, input });

beforeEach(async () => {
  ext = fakeExtension();
  received = [];
  const appWindow = { postMessage: (env: Envelope) => received.push(env) };
  const listeners: Listener<MessageEvent>[] = [];
  vi.stubGlobal("chrome", ext.chrome);
  vi.stubGlobal("navigator", { userActivation: { isActive: false } });
  vi.stubGlobal("window", {
    addEventListener: (_: string, l: Listener<MessageEvent>) => listeners.push(l),
    removeEventListener: () => {},
  });
  vi.stubGlobal("document", {
    body: { append: () => {} },
    createElement: () => ({ style: {}, setAttribute: () => {}, remove: () => {}, replaceWith: () => {}, contentWindow: appWindow }),
  });
  send = (data) => listeners.forEach((l) => l({ source: appWindow, origin: APP, data } as unknown as MessageEvent));

  bridge = mountFrameBridge({ url: `${APP}/ext` });
  send(hello());
  await flush();
  expect(received.filter((e) => e.kind === "welcome")).toHaveLength(1);
});

afterEach(() => {
  bridge.destroy();
  vi.unstubAllGlobals();
});

describe("frame bridge after the service worker stops", () => {
  it("resumes the session for the next call instead of failing with NOT_CONNECTED", async () => {
    ext.stopWorker();
    send(call("c1", "test.echo", { text: "hi" }));
    await flush();
    expect(results("c1")).toEqual([expect.objectContaining({ ok: true, output: { text: "hi" } })]);
    // The resumed session's welcome stays in the bridge: the app already has one.
    expect(received.filter((e) => e.kind === "welcome")).toHaveLength(1);
  });

  it("fails in-flight calls right away instead of letting them time out", async () => {
    send(call("c1", "test.hang"));
    await flush();
    ext.stopWorker();
    expect(results("c1")).toEqual([expect.objectContaining({ ok: false, error: expect.objectContaining({ code: "NOT_CONNECTED" }) })]);
  });

  it("restores event subscriptions, reconnecting at once so events keep arriving", async () => {
    send(envelope({ kind: "subscribe", events: ["tabs.*"] }));
    await flush();
    ext.stopWorker();
    await flush();
    ext.router.emit("tabs.updated", { tabId: 1 });
    await flush();
    expect(received.filter((e) => e.kind === "event")).toEqual([expect.objectContaining({ name: "tabs.updated" })]);
  });

  it("does not reconnect at once when the app has no subscriptions", async () => {
    const before = ext.connects;
    ext.stopWorker();
    await flush();
    expect(ext.connects).toBe(before);
  });

  it("does not loop when the background refuses the resumed session", async () => {
    send(envelope({ kind: "subscribe", events: ["tabs.*"] }));
    await flush();
    ext.refuse = true;
    const before = ext.connects;
    ext.stopWorker();
    await flush();
    await flush();
    expect(ext.connects).toBe(before + 1);
  });
});
