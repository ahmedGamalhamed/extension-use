import { FIXTURE_TARGET, FIXTURE_URL, expect, test } from "./fixtures.js";

const T = { target: FIXTURE_TARGET };

test("dom.html: the page's markup as it is now, with secrets masked", async ({ panel, fixture }) => {
  await fixture.locator("#email").fill("a@b.co");
  await fixture.locator("#password").fill("hunter2");
  await fixture.locator("#gift").check();
  await panel.call("overlay.toast", { message: "toast-text" }, T);

  const page = await panel.call("dom.html", {}, T);
  expect(page.html.startsWith("<!DOCTYPE html>")).toBe(true);
  expect(page.html).toContain("<h1>Order form</h1>");
  expect(page.truncated).toBe(false);
  expect(page.length).toBe(page.html.length);
  // Live form values, not just the initial attributes.
  expect(page.html).toMatch(/id="email"[^>]*value="a@b.co"/);
  expect(page.html).toMatch(/id="gift"[^>]*checked/);
  expect(page.html).not.toContain("hunter2");
  expect(page.html).toMatch(/id="password"[^>]*value="••••"/);
  // Our own overlay is left out.
  expect(page.html).not.toContain("extension-use-overlay");

  const nav = await panel.call("dom.html", { locator: { css: "nav" } }, T);
  expect(nav.html).toBe('<nav><a href="#top">Home</a> <a href="#help">Help</a></nav>');
  const inner = await panel.call("dom.html", { locator: { css: "nav" }, outer: false }, T);
  expect(inner.html).toBe('<a href="#top">Home</a> <a href="#help">Help</a>');

  // Reading must not make the page's images load again or fire their handlers.
  await fixture.evaluate(() => {
    const img = document.createElement("img");
    img.setAttribute("onerror", "window.__imgErrors = (window.__imgErrors || 0) + 1");
    img.src = "/missing.png";
    document.body.append(img);
  });
  const errors = () => fixture.evaluate(() => (window as { __imgErrors?: number }).__imgErrors ?? 0);
  await expect.poll(errors).toBe(1);
  await panel.call("dom.html", {}, T);
  await fixture.waitForTimeout(300);
  expect(await errors()).toBe(1);

  const cut = await panel.call("dom.html", { maxLength: 50 }, T);
  expect(cut).toMatchObject({ truncated: true });
  expect(cut.html).toHaveLength(50);
});

test("edit: writing to the page, without ever running code", async ({ panel, fixture }) => {
  const evil =
    '<b id="new" onclick="window.__pwned=1">hi</b>' +
    "<script>window.__pwned=2</script>" +
    '<img id="img" src="data:," onerror="window.__pwned=3">' +
    '<a id="link" href=" javascript:window.__pwned=4">x</a>' +
    '<iframe srcdoc="<script>parent.__pwned=5</script>"></iframe>' +
    '<template><script>window.__pwned=6</script></template>';
  const set = await panel.call("edit.setHtml", { locator: { css: "#status" }, html: evil }, T);
  expect(set.refs).toHaveLength(4); // b, img, a, template
  expect(set.removed).toBeGreaterThanOrEqual(6);
  await expect(fixture.locator("#status #new")).toHaveText("hi");
  await fixture.locator("#status #new").click();
  await fixture.waitForTimeout(100);
  expect(await fixture.evaluate(() => (window as { __pwned?: number }).__pwned)).toBeUndefined();
  expect(await fixture.locator("#status").innerHTML()).not.toMatch(/onclick|onerror|javascript|script|iframe/);

  await panel.call("edit.setHtml", { locator: { css: "h1" }, html: "<p id='after-h1'>below</p>", position: "afterend" }, T);
  await expect(fixture.locator("h1 + #after-h1")).toHaveText("below");
  await panel.call("edit.setHtml", { locator: { css: "#after-h1" }, html: "<h2 id='swapped'>swapped</h2>", position: "outer" }, T);
  await expect(fixture.locator("#after-h1")).toHaveCount(0);
  await expect(fixture.locator("#swapped")).toHaveText("swapped");

  await panel.call("edit.setText", { locator: { css: "h1" }, text: "<b>New</b> title" }, T);
  await expect(fixture.locator("h1")).toHaveText("<b>New</b> title");
  expect(await panel.try("edit.setText", { locator: { css: "#email" }, text: "x" }, T)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  expect(await panel.try("edit.setText", { locator: { css: "script" }, text: "window.__pwned=7" }, T)).toMatchObject({ ok: false, code: "BLOCKED_BY_POLICY" });

  const attrs = await panel.call("edit.setAttributes", { locator: { css: "#save" }, attributes: { "data-x": "1", "data-testid": null, title: "Save it" } }, T);
  expect(attrs.attributes).toMatchObject({ "data-x": "1", title: "Save it" });
  expect(attrs.attributes["data-testid"]).toBeUndefined();
  await expect(fixture.locator("#save")).toHaveAttribute("title", "Save it");
  for (const attributes of [{ onclick: "alert(1)" }, { href: "JavaScript:alert(1)" }, { srcdoc: "<b>x</b>" }]) {
    expect(await panel.try("edit.setAttributes", { locator: { css: "#save" }, attributes }, T)).toMatchObject({ ok: false, code: "BLOCKED_BY_POLICY" });
  }
  expect(await panel.try("edit.setAttributes", { locator: { css: "#password" }, attributes: { value: "x" } }, T)).toMatchObject({ ok: false, code: "BLOCKED_BY_POLICY" });

  expect(await panel.call("edit.remove", { locator: { css: "nav a" }, all: true }, T)).toEqual({ removed: 2 });
  await expect(fixture.locator("nav a")).toHaveCount(0);
  expect(await panel.try("edit.remove", { locator: { css: "body" } }, T)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
});

test("tabs: history, pin, mute and zoom", async ({ panel }) => {
  const tab = await panel.call("tabs.open", { url: `${FIXTURE_URL}?a`, active: false });
  const on = { target: { tab: tab.id } };
  await panel.call("tabs.navigate", { url: `${FIXTURE_URL}?b` }, on);
  expect((await panel.call("tabs.goBack", {}, on)).url).toBe(`${FIXTURE_URL}?a`);
  expect((await panel.call("tabs.goForward", {}, on)).url).toBe(`${FIXTURE_URL}?b`);
  expect(await panel.try("tabs.goForward", {}, on)).toMatchObject({ ok: false, code: "INVALID_INPUT" });

  const updated = await panel.call("tabs.update", { pinned: true, muted: true, zoom: 1.5 }, on);
  expect(updated).toMatchObject({ id: tab.id, pinned: true, muted: true, zoom: 1.5 });
  expect(await panel.try("tabs.update", {}, on)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  await panel.call("tabs.close", { tabId: tab.id });
});

test("windows: list, open, update and close", async ({ panel }) => {
  const before = await panel.call("windows.list", {});
  expect(before.windows.length).toBeGreaterThanOrEqual(1);

  const win = await panel.call("windows.open", { url: `${FIXTURE_URL}?win`, focused: false, width: 640, height: 480 });
  expect(win.tab).toMatchObject({ url: `${FIXTURE_URL}?win`, status: "complete" });
  expect(win.tabCount).toBe(1);
  const listed = await panel.call("windows.list", {});
  expect(listed.windows.map((w: { id: number }) => w.id)).toContain(win.id);

  // Headless screens are tiny, so don't move windows around; Chrome rejects off-screen bounds.
  const updated = await panel.call("windows.update", { windowId: win.id, state: "normal" });
  expect(updated).toMatchObject({ id: win.id, state: "normal" });
  expect(await panel.try("windows.update", { windowId: 999_999, focused: true })).toMatchObject({ ok: false, code: "TARGET_NOT_FOUND" });

  // A new-tab window can be closed, though controllers can't act on the new-tab page itself.
  const blank = await panel.call("windows.open", { focused: false });
  await panel.call("windows.close", { windowId: blank.id });
  await panel.call("windows.close", { windowId: win.id });
  const after = await panel.call("windows.list", {});
  expect(after.windows.map((w: { id: number }) => w.id)).not.toContain(win.id);
  expect(await panel.try("windows.close", { windowId: win.id })).toMatchObject({ ok: false, code: "TARGET_NOT_FOUND" });
  expect(await panel.try("windows.open", { url: "chrome://settings" })).toMatchObject({ ok: false, code: "BLOCKED_BY_POLICY" });
});

test("capture.fullPage: scrolls, stitches, and puts the scroll back", async ({ panel, fixture }) => {
  const { tabs } = await panel.call("tabs.list", {});
  await panel.call("tabs.activate", { tabId: tabs.find((t: { url: string }) => t.url === FIXTURE_URL).id });
  await fixture.bringToFront();
  // The fixture shows #later 400 ms after load, above the spacer. If it appears
  // after we scroll, scroll anchoring moves the page down by its height.
  await expect(fixture.locator("#later")).toBeVisible();
  await panel.call("page.scroll", { y: 200 }, T);
  expect((await panel.call("page.info", {}, T)).scroll.y).toBe(200);

  const view = await panel.call("capture.screenshot", {}, T);
  const full = await panel.call("capture.fullPage", {}, T);
  expect(full.dataUrl).toMatch(/^data:image\/png;base64,/);
  expect(full.width).toBe(view.width);
  expect(full.height).toBeGreaterThan(view.height * 1.5);
  expect(full.truncated).toBe(false);
  expect((await panel.call("page.info", {}, T)).scroll.y).toBe(200);

  const short = await panel.call("capture.fullPage", { maxHeight: 500, format: "jpeg" }, T);
  expect(short.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
  expect(short.truncated).toBe(true);
});
