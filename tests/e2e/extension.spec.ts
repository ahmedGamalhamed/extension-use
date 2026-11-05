import { CONTROLLER_URL, FIXTURE_TARGET, FIXTURE_URL, controllerFor, expect, test } from "./fixtures.js";

const T = { target: FIXTURE_TARGET };

test("frame transport: handshake and reading the page", async ({ panel, extensionId }) => {
  expect(extensionId).toBe("ejlkhbfhhdbmbpkodphamcebpfecmhdb");

  const info = await panel.ok("page.info", {}, T);
  expect(info).toMatchObject({ url: FIXTURE_URL, title: "Fixture: form" });

  const snap = await panel.ok("dom.snapshot", { format: "text" }, T);
  expect(snap.text).toContain('heading "Order form" [level=1]');
  expect(snap.text).toMatch(/button "Save draft" \[ref=e\d+\]/);
  expect(snap.text).toMatch(/textbox "Email" \[ref=e\d+\]: ""/);
  expect(snap.text).toMatch(/combobox "Size" \[ref=e\d+\]: "Small"/);
  expect(snap.text).toMatch(/button "Disabled" \[disabled\]/);

  const q = await panel.ok("dom.query", { locator: { testId: "save-btn" } }, T);
  expect(q.elements[0]).toMatchObject({ tag: "button", role: "button", name: "Save draft", visible: true });

  // A ref from the snapshot works as a locator.
  const ref = /button "Save draft" \[ref=(e\d+)\]/.exec(snap.text)![1];
  const byRef = await panel.ok("dom.query", { locator: { ref } }, T);
  expect(byRef.elements[0].name).toBe("Save draft");

  const text = await panel.ok("dom.text", {}, T);
  expect(text.text).toContain("Order form");
});

test("interactions", async ({ panel, fixture }) => {
  const events = () => fixture.locator("#events li").allTextContents();

  await panel.ok("dom.fill", { locator: { role: "textbox", name: "Email" }, value: "a@b.co" }, T);
  await expect(fixture.locator("#email")).toHaveValue("a@b.co");

  await panel.ok("dom.type", { locator: { css: "#notes" }, text: "hi there" }, T);
  await expect(fixture.locator("#notes")).toHaveValue("hi there");

  await panel.ok("dom.click", { locator: { role: "button", name: "Save draft" } }, T);
  await expect(fixture.locator("#status")).toHaveText("saved:false"); // synthetic events are untrusted

  const sel = await panel.ok("dom.select", { locator: { css: "#size" }, values: ["Large"] }, T);
  expect(sel.selected).toEqual(["l"]);

  const chk = await panel.ok("dom.check", { locator: { role: "checkbox", name: "Gift wrap" } }, T);
  expect(chk.checked).toBe(true);
  await expect(fixture.locator("#gift")).toBeChecked();

  await panel.ok("dom.press", { locator: { css: "#email" }, key: "Enter" }, T);
  await expect(fixture.locator("#status")).toHaveText("submitted");

  await panel.ok("dom.click", { locator: { text: "Far away button" } }, T);
  expect(await events()).toContain("click far");

  await panel.ok("wait.for", { locator: { text: "Appears later" }, state: "visible" }, T);

  expect(await events()).toEqual(
    expect.arrayContaining(["input email=a@b.co", "click save", "change size=l", "change gift=true", "submit", "click far"]),
  );
});

test("guard rails: disabled, sensitive and missing elements", async ({ panel }) => {
  const disabled = await panel.call("dom.click", { locator: { role: "button", name: "Disabled" } }, { ...T, timeoutMs: 400 });
  expect(disabled).toMatchObject({ ok: false, code: "TIMEOUT" });

  const password = await panel.call("dom.type", { locator: { css: "#password" }, text: "secret" }, T);
  expect(password).toMatchObject({ ok: false, code: "BLOCKED_BY_POLICY" });

  const missing = await panel.call("dom.click", { locator: { css: "#nope" } }, { ...T, timeoutMs: 300 });
  expect(missing.ok).toBe(false);
  expect(["ELEMENT_NOT_FOUND", "TIMEOUT"]).toContain((missing as { code: string }).code);

  const invalid = await panel.call("dom.click", { locator: {} }, T);
  expect(invalid).toMatchObject({ ok: false, code: "INVALID_INPUT" });
});

test("overlay, picker and events", async ({ panel, fixture }) => {
  const hl = await panel.ok("overlay.highlight", { locator: { role: "button" }, all: true, label: "btn" }, T);
  expect(hl.count).toBeGreaterThanOrEqual(4);
  await expect(fixture.locator("#extension-use-overlay")).toBeAttached();
  const boxes = await fixture.evaluate(() => document.getElementById("extension-use-overlay")!.shadowRoot!.querySelectorAll(".box").length);
  expect(boxes).toBe(hl.count);
  await panel.ok("overlay.clear", {}, T);
  await panel.ok("overlay.toast", { message: "hello" }, T);

  // The snapshot must not include our own overlay.
  const snap = await panel.ok("dom.snapshot", { format: "text" }, T);
  expect(snap.text).not.toContain("hello");

  // Picker: start it from the controller, click in the page.
  await panel.frame.evaluate((target) => {
    window.__events = [];
    return window.extReady.then((ext) => {
      ext.on("picker.selected", (p) => window.__events.push(p));
      window.__pick = ext.callRaw("picker.start", { prompt: "pick" }, { target });
    });
  }, FIXTURE_TARGET);
  await fixture.waitForTimeout(300);
  await fixture.bringToFront();
  await fixture.locator("#save").click();
  const picked = (await panel.frame.evaluate(() => window.__pick)) as { locator: Record<string, string>; element: { name: string } };
  expect(picked.locator).toMatchObject({ css: "#save", role: "button", name: "Save draft", testId: "save-btn" });
  // The click was swallowed by the picker, so the page's own handler didn't run.
  await expect(fixture.locator("#status")).toHaveText("idle");
  await expect.poll(() => panel.frame.evaluate(() => window.__events.length)).toBe(1);

  // Esc cancels.
  await panel.frame.evaluate((target) => {
    window.__pick = window.extReady.then((ext) => ext.callRaw("picker.start", {}, { target }).catch((e: { code: string }) => e.code));
  }, FIXTURE_TARGET);
  await fixture.waitForTimeout(300);
  await fixture.keyboard.press("Escape");
  expect(await panel.frame.evaluate(() => window.__pick)).toBe("CANCELLED");
});

test("tabs and capture", async ({ panel, fixture }) => {
  const list = await panel.ok("tabs.list", {});
  expect(list.tabs.map((t: { url: string }) => t.url)).toContain(FIXTURE_URL);

  const fixtureTab = list.tabs.find((t: { url: string }) => t.url === FIXTURE_URL);
  await panel.ok("tabs.activate", { tabId: fixtureTab.id });
  await fixture.bringToFront();

  const shot = await panel.ok("capture.screenshot", {}, T);
  expect(shot.dataUrl).toMatch(/^data:image\/png;base64,/);
  expect(shot.width).toBeGreaterThan(100);

  const crop = await panel.ok("capture.screenshot", { locator: { css: "#save" } }, T);
  expect(crop.width).toBeLessThan(shot.width / 2);
  expect(crop.height).toBeLessThan(100);

  const opened = await panel.ok("tabs.open", { url: `${FIXTURE_URL}?second`, active: false });
  expect(opened.url).toBe(`${FIXTURE_URL}?second`);
  expect(opened.status).toBe("complete");
  const nav = await panel.ok("tabs.navigate", { url: `${FIXTURE_URL}?third` }, { target: { tab: opened.id } });
  expect(nav.url).toBe(`${FIXTURE_URL}?third`);
  await panel.ok("tabs.close", { tabId: opened.id });

  expect(await panel.call("tabs.open", { url: "chrome://settings" })).toMatchObject({ ok: false, code: "BLOCKED_BY_POLICY" });
});

test("page transport uses its own grants", async ({ context, fixture }) => {
  void fixture;
  const page = await context.newPage();
  await page.goto(CONTROLLER_URL);
  const ctl = controllerFor(page);
  await page.evaluate(() => window.extReady.then(() => true));
  expect(await ctl.ok("runtime.ping")).toMatchObject({ pong: true });
  expect(await ctl.ok("page.info", {}, T)).toMatchObject({ url: FIXTURE_URL });
  expect(await ctl.call("dom.click", { locator: { css: "#save" } }, T)).toMatchObject({ ok: false, code: "NOT_GRANTED" });
  expect(await page.evaluate(() => window.extReady.then((e) => [e.has("dom.snapshot"), e.has("dom.click")]))).toEqual([true, false]);
});

test("frame origin checks: other sites can't drive the extension", async ({ context, extensionId, fixture }) => {
  void fixture;
  // A page that is not in externally_connectable has no chrome.runtime.connect to the extension.
  const page = await context.newPage();
  await page.goto(FIXTURE_URL);
  const hasConnect = await page.evaluate(() => typeof (globalThis as { chrome?: { runtime?: { connect?: unknown } } }).chrome?.runtime?.connect);
  expect(hasConnect).toBe("undefined");
  void extensionId;
});

test("bridge actions: permissions need the person's click", async ({ panel, context }) => {
  test.setTimeout(30_000);
  expect(await panel.ok("permissions.contains", { permissions: ["tabs"] })).toEqual({ granted: true });
  const all = await panel.ok("permissions.getAll");
  expect(all.permissions).toContain("tabs");
  expect(await panel.frame.evaluate(() => window.extReady.then((e) => e.has("permissions.request")))).toBe(true);
  expect(await panel.call("permissions.request", {})).toMatchObject({ ok: false, code: "INVALID_INPUT" });

  // evaluate() itself counts as a gesture for ~5 s, so the no-click call waits it out.
  await panel.frame.evaluate(() => {
    const w = window as unknown as { __late: Promise<string>; __clicked: Promise<unknown> };
    w.__late = new Promise((resolve) =>
      setTimeout(() => {
        window.extReady.then((ext) => ext.callRaw("permissions.request", { permissions: ["tabs"] }).then(() => "granted", (e: { code: string }) => e.code)).then(resolve);
      }, 6000),
    );
    const btn = Object.assign(document.createElement("button"), { id: "perm-test", textContent: "perm" });
    w.__clicked = new Promise((resolve) => {
      btn.onclick = () => window.extReady.then((ext) => ext.callRaw("permissions.request", { permissions: ["tabs"] }).then(resolve, (e: { code: string }) => resolve(e.code)));
    });
    document.body.prepend(btn);
  });
  expect(await panel.frame.evaluate(() => (window as unknown as { __late: Promise<string> }).__late)).toBe("NEEDS_USER_GESTURE");

  await panel.frame.locator("#perm-test").click(); // a real click
  expect(await panel.frame.evaluate(() => (window as unknown as { __clicked: Promise<unknown> }).__clicked)).toEqual({ granted: true });

  // Page controllers don't get bridge actions.
  const page = await context.newPage();
  await page.goto(CONTROLLER_URL);
  expect(await page.evaluate(() => window.extReady.then((e) => e.has("permissions.request")))).toBe(false);
});

test("spike: storage for the app inside the extension frame", async ({ panel, context }) => {
  const framed = await panel.frame.evaluate(async () => {
    localStorage.setItem("eu-shared", "from-frame");
    return window.storageProbe();
  });
  const top = await context.newPage();
  await top.goto(CONTROLLER_URL);
  const topLevel = await top.evaluate(() => window.storageProbe());
  const sharedLocalStorage = (await top.evaluate(() => localStorage.getItem("eu-shared"))) === "from-frame";
  const report = { framed, topLevel, sharedLocalStorage };
  console.log("storage spike:", JSON.stringify(report, null, 2));
  test.info().annotations.push({ type: "storage-spike", description: JSON.stringify(report) });
  expect(framed.localStorage).toBe(true);
  expect(framed.indexedDB).toBe(true);
});

test("spike: does a click inside the iframe give the extension page a user gesture?", async ({ context, extensionId }) => {
  test.setTimeout(30_000);
  // Playwright's evaluate() counts as a gesture, so record everything from init scripts instead.
  const page = await context.newPage();
  await page.addInitScript(() => {
    const w = window as unknown as { __acts: unknown[] };
    if (location.protocol === "chrome-extension:") {
      w.__acts = [];
      // Record whether the extension page has transient activation when the frame's message arrives.
      window.addEventListener("message", (e) => {
        if (e.data?.probe) w.__acts.push({ probe: e.data.probe, extensionPageActive: navigator.userActivation.isActive });
      });
    } else {
      const send = (probe: string) => parent.postMessage({ probe }, "*");
      addEventListener("click", () => send("click"), true);
      setTimeout(() => send("no-click"), 1500);
    }
  });
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await page.waitForTimeout(2000);
  const frame = page.frames().find((f) => f.url().startsWith(CONTROLLER_URL))!;
  await frame.locator("h1").click(); // trusted input via CDP
  await page.waitForTimeout(300);
  const acts = await page.evaluate(() => (window as unknown as { __acts: unknown[] }).__acts);
  console.log("gesture spike:", JSON.stringify(acts));
  test.info().annotations.push({ type: "gesture-spike", description: JSON.stringify(acts) });
  expect(acts).toContainEqual({ probe: "no-click", extensionPageActive: false });
  // User activation propagates to ancestor frames, so the side panel page can call gesture-gated APIs.
  expect(acts).toContainEqual({ probe: "click", extensionPageActive: true });
});
