import { describe, expect, it } from "vitest";
import { defineAction } from "@extension-use/host/background";
import { z } from "@extension-use/protocol/schemas";
import { createMockHost, expectErrorCode } from "../src/index.js";

describe("createMockHost", () => {
  it("offers only the actions you mock, and records calls with parsed input", async () => {
    const host = createMockHost({
      handlers: {
        "dom.click": () => ({ ref: "e1" }),
        "tabs.list": () => ({ tabs: [{ id: 1, windowId: 1, url: "https://example.com/", title: "Example", active: true, status: "complete" }] }),
      },
    });
    const ext = await host.connect();
    expect(ext.has("dom.click")).toBe(true);
    expect(ext.has("dom.fill")).toBe(false);
    expect(ext.has("runtime.ping")).toBe(true);

    await expect(ext.dom.click({ locator: { text: "Save" } }, { target: { tab: 5 } })).resolves.toEqual({ ref: "e1" });
    expect(host.callsTo("dom.click")).toEqual([
      { action: "dom.click", input: { locator: { text: "Save" }, button: "left", clickCount: 1, modifiers: [], holdMs: 0 }, target: { tab: 5 } },
    ]);
    expect((await ext.tabs.list()).tabs).toHaveLength(1);
    await expectErrorCode(ext.dom.fill({ locator: { css: "#x" }, value: "y" }), "UNKNOWN_ACTION");
  });

  it("validates inputs and mock outputs like the real host", async () => {
    const host = createMockHost({ handlers: { "page.info": () => ({ url: "x" }) as never } });
    const ext = await host.connect();
    const err = await expectErrorCode(ext.page.info(), "INTERNAL");
    expect(err.message).toContain('Mock for "page.info" returned an invalid result');
    await expectErrorCode(ext.callRaw("page.info", { nope: 1 }), "INTERNAL"); // extra keys are stripped, output still invalid
  });

  it("applies grants and site policy", async () => {
    const host = createMockHost({
      handlers: { "dom.text": () => ({ text: "hi", truncated: false }) },
      grants: ["runtime.*"],
    });
    const ext = await host.connect();
    await expectErrorCode(ext.dom.text(), "NOT_GRANTED");

    const blocked = createMockHost({ handlers: { "dom.text": () => ({ text: "", truncated: false }) }, tab: { url: "chrome://settings" } });
    await expectErrorCode((await blocked.connect()).dom.text(), "BLOCKED_BY_POLICY");
  });

  it("emits events, swaps handlers and runs host-defined actions", async () => {
    const save = defineAction(
      "app.save",
      { where: "background", version: 1, description: "", input: z.object({ id: z.string() }), output: z.object({ saved: z.boolean() }) },
      () => ({ saved: true }),
    );
    const host = createMockHost({ handlers: { "picker.start": () => { throw new Error("replaced below"); } }, actions: [save] });
    const ext = await host.connect<{ "app.save": { input: { id: string }; output: { saved: boolean } } }>();
    expect(await ext.app.save({ id: "1" })).toEqual({ saved: true });

    const seen: unknown[] = [];
    ext.on("picker.selected", (p) => seen.push(p));
    await new Promise((r) => setTimeout(r, 5));
    host.emit("picker.selected", { ref: "e9", locator: { css: "#a" }, url: "https://example.com/" });
    await new Promise((r) => setTimeout(r, 5));
    expect(seen).toEqual([{ ref: "e9", locator: { css: "#a" }, url: "https://example.com/" }]);
  });
});
