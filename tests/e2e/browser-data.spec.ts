// The opt-in browser-data groups. The example extension enables all of them.
// Playwright routes downloads into its own temp folder, so nothing lands in ~/Downloads.
import { FIXTURE_URL, expect, test } from "./fixtures.js";

const ORIGIN = new URL(FIXTURE_URL).origin;

test("bookmarks: create, find, move, rename and delete", async ({ panel }) => {
  const top = await panel.call("bookmarks.list", {});
  const bar = top.bookmarks.find((b: { folder: boolean }) => b.folder);
  expect(bar).toBeTruthy();

  const folder = await panel.call("bookmarks.create", { title: "eu-folder", parentId: bar.id });
  expect(folder).toMatchObject({ title: "eu-folder", folder: true, parentId: bar.id });
  const mark = await panel.call("bookmarks.create", { title: "eu-fixture", url: FIXTURE_URL, parentId: folder.id });
  expect(mark).toMatchObject({ url: FIXTURE_URL, folder: false, parentId: folder.id });

  const found = await panel.call("bookmarks.search", { query: "eu-fixture" });
  expect(found.bookmarks.map((b: { id: string }) => b.id)).toContain(mark.id);
  expect((await panel.call("bookmarks.list", { parentId: folder.id })).bookmarks).toHaveLength(1);

  const moved = await panel.call("bookmarks.update", { id: mark.id, title: "eu-renamed", parentId: bar.id, index: 0 });
  expect(moved).toMatchObject({ title: "eu-renamed", parentId: bar.id, index: 0 });
  await panel.call("bookmarks.update", { id: mark.id, parentId: folder.id });

  // A folder with contents needs recursive: true.
  expect(await panel.try("bookmarks.remove", { id: folder.id })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  await panel.call("bookmarks.remove", { id: folder.id, recursive: true });
  expect((await panel.call("bookmarks.search", { query: "eu-renamed" })).bookmarks).toHaveLength(0);
  expect(await panel.try("bookmarks.remove", { id: mark.id })).toMatchObject({ ok: false, code: "TARGET_NOT_FOUND" });

  // Bookmarklets run code when clicked; blocked sites stay blocked.
  expect(await panel.try("bookmarks.create", { title: "x", url: "javascript:alert(1)" })).toMatchObject({ ok: false, code: "BLOCKED_BY_POLICY" });
  expect(await panel.try("bookmarks.create", { title: "x", url: "chrome://settings" })).toMatchObject({ ok: false, code: "BLOCKED_BY_POLICY" });
});

test("history: search and delete", async ({ panel, fixture }) => {
  await fixture.goto(`${FIXTURE_URL}?history-probe`);
  const url = `${FIXTURE_URL}?history-probe`;
  await expect
    .poll(async () => (await panel.call("history.search", { text: "history-probe" })).items.map((i: { url: string }) => i.url))
    .toContain(url);
  const [item] = (await panel.call("history.search", { text: "history-probe" })).items;
  expect(item).toMatchObject({ url, title: "Fixture: form" });
  expect(item.visitCount).toBeGreaterThanOrEqual(1);

  await panel.call("history.delete", { url });
  expect((await panel.call("history.search", { text: "history-probe" })).items).toHaveLength(0);
});

test("cookies: set, read in the page, list and remove", async ({ panel, fixture }) => {
  const set = await panel.call("cookies.set", { url: ORIGIN, name: "eu_cookie", value: "v1", path: "/" });
  expect(set).toMatchObject({ name: "eu_cookie", value: "v1", domain: "127.0.0.1", session: true });
  expect(await fixture.evaluate(() => document.cookie)).toContain("eu_cookie=v1");

  const byUrl = await panel.call("cookies.list", { url: FIXTURE_URL, name: "eu_cookie" });
  expect(byUrl.cookies).toEqual([expect.objectContaining({ name: "eu_cookie", value: "v1" })]);
  const byDomain = await panel.call("cookies.list", { domain: "127.0.0.1" });
  expect(byDomain.cookies.map((c: { name: string }) => c.name)).toContain("eu_cookie");

  expect(await panel.call("cookies.remove", { url: ORIGIN, name: "eu_cookie" })).toEqual({ removed: true });
  expect(await panel.call("cookies.remove", { url: ORIGIN, name: "eu_cookie" })).toEqual({ removed: false });
  expect(await fixture.evaluate(() => document.cookie)).not.toContain("eu_cookie");

  expect(await panel.try("cookies.list", {})).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  expect(await panel.try("cookies.set", { url: "chrome://settings", name: "a", value: "b" })).toMatchObject({ ok: false, code: "BLOCKED_BY_POLICY" });
  expect(await panel.try("cookies.list", { domain: "chromewebstore.google.com" })).toMatchObject({ ok: false, code: "BLOCKED_BY_POLICY" });
});

test("downloads: start, wait, list", async ({ panel }) => {
  const done = await panel.call("downloads.start", { url: `${ORIGIN}/fixtures/form.html`, filename: "eu-download.html" });
  expect(done).toMatchObject({ state: "complete", url: `${ORIGIN}/fixtures/form.html` });
  expect(done.bytesReceived).toBeGreaterThan(100);

  const listed = await panel.call("downloads.list", { state: "complete" });
  expect(listed.downloads.map((d: { id: number }) => d.id)).toContain(done.id);

  expect(await panel.try("downloads.cancel", { id: 987_654 })).toMatchObject({ ok: false, code: "TARGET_NOT_FOUND" });
  expect(await panel.try("downloads.start", { url: "chrome://settings" })).toMatchObject({ ok: false, code: "BLOCKED_BY_POLICY" });
});
