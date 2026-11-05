# Testing

`@extension-use/testing` covers two levels:

- **Unit tests of your web app's logic** against an in-memory host. This is fast, needs no browser, and runs in Vitest or Jest.
- **Browser tests** that load your real extension in Chromium with Playwright and drive it through your web app.

```bash
npm install -D @extension-use/testing
```

## Unit tests: `createMockHost`

The mock host runs the real router, so input checks, grants, site policy and error codes behave as in the browser. You supply the results of the actions your code uses. Actions you don't mock aren't offered (`ext.has()` is false, and calls fail with `UNKNOWN_ACTION`).

```ts
import { createMockHost, expectErrorCode } from "@extension-use/testing";
import { saveCurrentArticle } from "../src/save"; // your code, which takes a client

test("saves the article text", async () => {
  const host = createMockHost({
    handlers: {
      "page.info": () => ({ url: "https://blog.example/post", title: "Post", viewport: { width: 1280, height: 800, devicePixelRatio: 1 }, scroll: { x: 0, y: 0 }, document: { width: 1280, height: 4000 } }),
      "dom.text": () => ({ text: "Hello world", truncated: false }),
    },
  });
  const ext = await host.connect();

  await saveCurrentArticle(ext);

  expect(host.callsTo("dom.text")[0]!.input).toMatchObject({ maxLength: 20000 });
});

test("shows a message when the page is blocked", async () => {
  const host = createMockHost({ handlers: { "dom.text": () => ({ text: "", truncated: false }) }, tab: { url: "chrome://settings" } });
  await expectErrorCode((await host.connect()).dom.text(), "BLOCKED_BY_POLICY");
});
```

Mock results are checked against each action's output schema, so a wrong mock fails loudly instead of passing silently. `host.emit("tab.updated", ...)` sends events, and `host.router.pause()` tests the kill switch.

## Browser tests: `@extension-use/testing/playwright`

1. In your web app, connect with `expose: true` in development builds, so tests can reach the client:

   ```ts
   const ext = await connect(frame(), { expose: import.meta.env.DEV });
   ```

2. Point Playwright at your built extension:

   ```ts
   // playwright.config.ts
   export default defineConfig({
     use: { extensionPath: "dist/extension" }, // WXT: ".output/chrome-mv3"
     webServer: { command: "npm run dev:web", url: "http://localhost:5173/" },
   });
   ```

3. Write tests with the fixtures:

   ```ts
   import { test, expect } from "@extension-use/testing/playwright";

   test("highlights the buy button", async ({ context, openPanel }) => {
     const shop = await context.newPage();
     await shop.goto("https://example.com/");

     const { ext, frame } = await openPanel(); // the side panel page, opened as a tab
     const target = { tab: { urlMatch: "https://example.com/*" } };

     const snap = await ext.dom.snapshot({ format: "text" }, { target });
     expect(snap.text).toContain("- link ");

     await frame.getByRole("button", { name: "Highlight links" }).click(); // drive your UI too
     await expect(ext.overlay.clear({}, { target })).resolves.toEqual({});
   });
   ```

Fixtures: `context` (Chromium with your extension), `extensionId`, `serviceWorker`, and `openPanel({ path?, frameUrl? })`. Use `controllerIn(pageOrFrame)` to drive a client in any page, for example your web app opened in a normal tab (page transport).

Notes:
- Playwright can't open Chrome's real side panel, so `openPanel()` opens the side panel page as a tab. The bridge code is the same.
- Run `npx playwright install chromium` once. Extensions need Playwright's `chromium` channel, which the fixture uses.
- `ext.call()` rejects with an `ExtensionUseError`, and `ext.try()` returns `{ ok, output | code }` for checking failures.
