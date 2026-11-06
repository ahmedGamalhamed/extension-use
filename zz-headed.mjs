import { chromium } from "@playwright/test";
import { controllerIn } from "@extension-use/testing/playwright";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
const path = resolve("examples/basic-extension/dist");
const { id } = JSON.parse(readFileSync("examples/basic-extension/dev-key.json", "utf8"));
const ctx = await chromium.launchPersistentContext("", {
  channel: "chromium", headless: false, viewport: null,
  ignoreDefaultArgs: ["--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding"],
  args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`, `--allowlisted-extension-id=${id}`],
});
let [sw] = ctx.serviceWorkers(); sw ??= await ctx.waitForEvent("serviceworker");
const panelPage = await ctx.newPage();
await panelPage.goto(`chrome-extension://${id}/sidepanel.html`);
let frame; for (let i = 0; i < 100 && !frame; i++) { frame = panelPage.frames().find((f) => f !== panelPage.mainFrame() && f.url().startsWith("http://localhost:5173")); if (!frame) await panelPage.waitForTimeout(100); }
const ext = await controllerIn(frame);
const tab = await ext.call("tabs.open", { url: "http://127.0.0.1:5174/fixtures/form.html?h", active: false });
const measure = (tabId) => sw.evaluate(async (tabId) => {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: () => new Promise((resolve) => { let raf = 0, t = 0; const tick = () => { raf++; requestAnimationFrame(tick); }; requestAnimationFrame(tick); const iv = setInterval(() => t++, 10); setTimeout(() => { clearInterval(iv); resolve({ vis: document.visibilityState, raf, timers: t }); }, 1000); }) });
  return r.result;
}, tabId);
await new Promise((r) => setTimeout(r, 2000));
console.log("before ", JSON.stringify(await measure(tab.id)));
const on = { target: { tab: tab.id } };
console.log("bg shot", JSON.stringify(await ext.call("capture.screenshot", {}, on).then((s) => [s.width, s.height])));
await ext.call("tabCapture.start", {}, on);
await new Promise((r) => setTimeout(r, 500));
console.log("during ", JSON.stringify(await measure(tab.id)));
await ext.call("tabCapture.stop", {}, on);
await new Promise((r) => setTimeout(r, 1000));
console.log("after  ", JSON.stringify(await measure(tab.id)));
await ctx.close();
