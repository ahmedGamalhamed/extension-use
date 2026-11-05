import type { Frame, Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";

const URL_ = "http://127.0.0.1:5174/fixtures/interactions.html";
const T = { target: { tab: { urlMatch: `${URL_}*` } } };
const b64 = (s: string) => Buffer.from(s).toString("base64");

test.describe("DOM interactions", () => {
  let page: Page;
  test.beforeEach(async ({ context }) => {
    page = await context.newPage();
    await page.goto(URL_);
  });

  test("drag and drop: HTML5 and pointer-driven, even in a background tab", async ({ panel }) => {
    // Act on a tab that isn't in front: Chrome may throttle its animation frames and timers.
    // (Headless Chromium still reports it as "visible", so we can't assert hidden here.)
    await (panel.frame as Frame).page().bringToFront();
    const html5 = await panel.call("dom.drag", { from: { css: "#item-a" }, to: { css: "#bin" } }, T);
    expect(html5).toMatchObject({ html5: true });
    await expect(page.locator("#bin-log")).toHaveText("dropped item-a");

    const slider = await panel.call("dom.drag", { from: { role: "slider", name: "Volume" }, offset: { x: 150, y: 0 } }, T);
    expect(slider).toMatchObject({ html5: false });
    await expect(page.locator("#slider-value")).toHaveText("150");

    expect(await panel.try("dom.drag", { from: { css: "#item-a" } }, T)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });

  test("file upload: hidden input, multiple files, and a drop zone", async ({ panel }) => {
    // The input is display:none behind a styled label, like most upload buttons.
    const one = await panel.call("dom.upload", { locator: { css: "#file" }, files: [{ name: "a.txt", mimeType: "text/plain", text: "hello" }] }, T);
    expect(one).toMatchObject({ files: 1, via: "input" });
    await expect(page.locator("#file-result")).toHaveText("a.txt:5:text/plain:hello");

    // Pointing at the label finds its input.
    await panel.call("dom.upload", { locator: { css: "label.upload" }, files: [{ name: "b.csv", mimeType: "text/csv", base64: b64("x,y") }] }, T);
    await expect(page.locator("#file-result")).toHaveText("b.csv:3:text/csv:x,y");

    expect(await panel.try("dom.upload", { locator: { css: "#file" }, files: [{ name: "1", text: "a" }, { name: "2", text: "b" }] }, T)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await panel.call("dom.upload", { locator: { css: "#files-multi" }, files: [{ name: "1.txt", text: "a" }, { name: "2.txt", text: "bb" }] }, T);
    await expect(page.locator("#file-result")).toHaveText("1.txt:1:application/octet-stream:a|2.txt:2:application/octet-stream:bb");

    const drop = await panel.call("dom.upload", { locator: { css: "#dropzone" }, files: [{ name: "photo.png", mimeType: "image/png", base64: b64("PNG") }] }, T);
    expect(drop).toMatchObject({ via: "drop" });
    await expect(page.locator("#drop-result")).toHaveText("photo.png:3:image/png:PNG");
  });

  test("scrolling inside elements and with the wheel", async ({ panel }) => {
    const before = Number(await page.locator("#loaded").textContent());
    const down = await panel.call("dom.scroll", { locator: { css: "#list" }, to: "bottom" }, T);
    expect(down.scrollTop).toBeGreaterThan(0);
    await expect.poll(async () => Number(await page.locator("#loaded").textContent())).toBeGreaterThan(before); // infinite list loaded more

    const by = await panel.call("dom.scroll", { locator: { css: "#list" }, to: "top" }, T);
    expect(by.scrollTop).toBe(0);
    expect((await panel.call("dom.scroll", { locator: { css: "#list" }, y: 50 }, T)).scrollTop).toBe(50);
    // Pointing at a child scrolls its scrolling container.
    expect((await panel.call("dom.scroll", { locator: { text: "Row 1" }, y: 10 }, T)).scrollTop).toBe(60);

    // A page that handles the wheel itself (cancels it): no scrolling.
    const zoom = await panel.call("dom.wheel", { locator: { css: "#wheelbox" }, deltaY: 120, steps: 2 }, T);
    expect(zoom).toMatchObject({ scrolled: false });
    await expect(page.locator("#wheel-total")).toHaveText("120");

    // Otherwise the wheel scrolls the nearest scrollable box.
    const wheel = await panel.call("dom.wheel", { locator: { text: "Tall content" }, deltaY: 200 }, T);
    expect(wheel).toMatchObject({ scrolled: true, scrollTop: 200 });
  });

  test("text selection, paste and blur", async ({ panel }) => {
    expect(await panel.call("dom.selectText", { locator: { css: "#sel" }, text: "world" }, T)).toMatchObject({ selected: "world" });
    expect(await page.evaluate(() => [(document.activeElement as HTMLInputElement).selectionStart, (document.activeElement as HTMLInputElement).selectionEnd])).toEqual([6, 11]);
    expect(await panel.call("dom.selectText", { locator: { css: "#para" }, text: "brown fox" }, T)).toMatchObject({ selected: "brown fox" });
    expect(await page.evaluate(() => document.getSelection()!.toString())).toBe("brown fox");
    expect(await panel.call("dom.selectText", { locator: { css: "#para" } }, T)).toMatchObject({ selected: "The quick brown fox jumps over the lazy dog" });

    expect(await panel.call("dom.paste", { locator: { css: "#paste-plain" }, text: "pasted text" }, T)).toMatchObject({ handledByPage: false });
    await expect(page.locator("#paste-plain")).toHaveValue("pasted text");
    expect(await panel.call("dom.paste", { locator: { css: "#paste-custom" }, text: "hello" }, T)).toMatchObject({ handledByPage: true });
    await expect(page.locator("#paste-result")).toHaveText("HELLO");
    await expect(page.locator("#paste-custom")).toHaveValue("");

    await panel.call("dom.focus", { locator: { css: "#blur-me" } }, T);
    await panel.call("dom.blur", {}, T);
    await expect(page.locator("#blur-result")).toHaveText("blurred");
  });

  test("keys do what a browser does: Tab, arrows, Home/End, select all, Delete", async ({ panel }) => {
    const active = () => page.evaluate(() => document.activeElement?.id);
    await panel.call("dom.focus", { locator: { css: "#t1" } }, T);
    await panel.call("dom.press", { key: "Tab" }, T);
    expect(await active()).toBe("t2"); // skips the disabled and tabindex=-1 inputs
    await panel.call("dom.press", { key: "Tab", modifiers: ["Shift"] }, T);
    expect(await active()).toBe("t1");

    const caret = { locator: { css: "#caret" } };
    await panel.call("dom.focus", caret, T);
    await panel.call("dom.press", { key: "Home" }, T);
    await panel.call("dom.press", { key: "ArrowRight" }, T);
    await panel.call("dom.press", { key: "ArrowRight" }, T);
    await panel.call("dom.type", { text: "X" }, T);
    await expect(page.locator("#caret")).toHaveValue("abXcdef");
    await panel.call("dom.press", { key: "End", modifiers: ["Shift"] }, T);
    await panel.call("dom.press", { key: "Backspace" }, T);
    await expect(page.locator("#caret")).toHaveValue("abX");
    await panel.call("dom.press", { key: "ArrowLeft" }, T);
    await panel.call("dom.press", { key: "Delete" }, T);
    await expect(page.locator("#caret")).toHaveValue("ab");
    await panel.call("dom.press", { key: "a", modifiers: ["Control"] }, T);
    await panel.call("dom.press", { key: "Delete" }, T);
    await expect(page.locator("#caret")).toHaveValue("");

    await panel.call("dom.press", { locator: { css: "#pick" }, key: "ArrowDown" }, T);
    await expect(page.locator("#pick")).toHaveValue("two");
    await expect(page.locator("#pick-log")).toHaveText("change two");

    await panel.call("dom.press", { locator: { css: "#r-s" }, key: "ArrowDown" }, T);
    await expect(page.locator("#r-m")).toBeChecked();
  });

  test("long press and low-level pointer events", async ({ panel }) => {
    await panel.call("dom.click", { locator: { css: "#hold" }, holdMs: 600 }, T);
    await expect(page.locator("#hold-result")).toHaveText("long");
    await panel.call("dom.click", { locator: { css: "#hold" } }, T);
    await expect(page.locator("#hold-result")).toHaveText("short");

    await panel.call("dom.pointer", { type: "down", locator: { css: "#ptr" } }, T);
    const box = (await page.locator("#ptr").boundingBox())!;
    await panel.call("dom.pointer", { type: "move", x: box.x + 10, y: box.y + 10 }, T);
    await panel.call("dom.pointer", { type: "up", locator: { css: "#ptr" } }, T);
    await expect(page.locator("#ptr-log")).toHaveText("down:1,move:1,up:0");
    expect(await panel.try("dom.pointer", { type: "down" }, T)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });

  test("shadow DOM: CSS and test-id locators reach open shadow roots", async ({ panel }) => {
    await panel.call("dom.click", { locator: { css: "button.inner" } }, T);
    await expect(page.locator("#shadow-result")).toHaveText("shadow clicked");
    expect((await panel.call("dom.query", { locator: { testId: "shadow-btn" } }, T)).elements[0]).toMatchObject({ name: "Shadow button" });
  });

  test("iframes: list them and act inside same-origin and cross-origin frames", async ({ panel }) => {
    const { frames } = await panel.call("frames.list", {}, T);
    expect(frames.map((f: { url: string }) => f.url)).toEqual(
      expect.arrayContaining([URL_, "http://127.0.0.1:5174/fixtures/frame.html", "http://localhost:5173/fixtures/frame.html"]),
    );

    for (const [frameUrl, iframe, host] of [
      ["http://127.0.0.1:5174/fixtures/frame.html*", "#same", "127.0.0.1:5174"],
      ["http://localhost:5173/fixtures/frame.html*", "#cross", "localhost:5173"],
    ] as const) {
      const target = { tab: { urlMatch: `${URL_}*` }, frame: { urlMatch: frameUrl } };
      await panel.call("dom.click", { locator: { role: "button", name: "Button in frame" } }, { target });
      await expect(page.frameLocator(iframe).locator("#frame-result")).toHaveText(`clicked in ${host}`);
      await panel.call("dom.fill", { locator: { role: "textbox", name: "Frame input" }, value: host }, { target });
      await expect(page.frameLocator(iframe).locator("#frame-input")).toHaveValue(host);
    }

    // By frame id too.
    const cross = frames.find((f: { url: string }) => f.url.startsWith("http://localhost:5173/"))!;
    const text = await panel.call("dom.text", {}, { target: { tab: { urlMatch: `${URL_}*` }, frame: cross.frameId } });
    expect(text.text).toContain("Button in frame");

    expect(await panel.try("dom.text", {}, { target: { tab: { urlMatch: `${URL_}*` }, frame: { urlMatch: "https://nowhere.example/*" } } })).toMatchObject({ ok: false, code: "TARGET_NOT_FOUND" });
  });
});
