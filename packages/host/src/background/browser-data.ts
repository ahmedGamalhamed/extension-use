/**
 * The person's browser data: downloads, bookmarks, history and cookies.
 *
 * These groups are opt-in (see OPT_IN_GROUPS): each needs its own manifest
 * permission, and cookies and history are sensitive, so no host gets them
 * unless it enables them by name. Site policy still applies to every URL.
 */
import { ExtensionUseError } from "@extension-use/protocol";
import { coreActionSchemas, type CoreActionName } from "@extension-use/protocol/schemas";
import type * as z from "zod";
import type { ActionContext, ActionDef, ActionGroup } from "../registry.js";

type S = typeof coreActionSchemas;
type Handler<K extends CoreActionName> = NonNullable<ActionDef<S[K]>["handler"]>;
type Out<K extends CoreActionName> = z.input<S[K]["output"]>;

function bg<K extends CoreActionName>(name: K, handler: Handler<K>): ActionDef {
  return { name, schema: coreActionSchemas[name], handler } as unknown as ActionDef;
}

const message = (err: unknown) => String((err as Error)?.message ?? err);

/** Chrome API errors are mostly bad input (unknown id, bad path); report them as such. */
async function chromeCall<T>(p: Promise<T>, code: "INVALID_INPUT" | "TARGET_NOT_FOUND" = "INVALID_INPUT"): Promise<T> {
  try {
    return await p;
  } catch (err) {
    throw new ExtensionUseError(code, message(err));
  }
}

function checkScheme(ctx: ActionContext, url: string, schemes: RegExp, what: string) {
  ctx.assertAllowedUrl(url);
  if (!schemes.test(url)) throw new ExtensionUseError("BLOCKED_BY_POLICY", `${what} must be ${schemes.source.replace(/[\^():|]/g, " ").trim()} URLs, got ${url}`);
}

// ---------------------------------------------------------------------------
// downloads
// ---------------------------------------------------------------------------

function toDownload(d: chrome.downloads.DownloadItem): Out<"downloads.start"> {
  return {
    id: d.id,
    url: d.finalUrl || d.url,
    filename: d.filename,
    state: d.state,
    mime: d.mime ?? "",
    bytesReceived: d.bytesReceived,
    totalBytes: d.totalBytes,
    startTime: d.startTime,
    ...(d.error ? { error: d.error } : {}),
  };
}

async function getDownload(id: number) {
  const [d] = await chrome.downloads.search({ id });
  if (!d) throw new ExtensionUseError("TARGET_NOT_FOUND", `No download ${id}`);
  return d;
}

function waitForDownload(id: number, signal: AbortSignal): Promise<chrome.downloads.DownloadItem> {
  return new Promise((resolve, reject) => {
    const finish = () => getDownload(id).then((d) => {
      if (d.state === "in_progress") return;
      cleanup();
      resolve(d);
    }, (err: unknown) => {
      cleanup();
      reject(err);
    });
    const onChanged = (delta: chrome.downloads.DownloadDelta) => {
      if (delta.id === id && delta.state) void finish();
    };
    const onAbort = () => {
      cleanup();
      reject(signal.reason);
    };
    const cleanup = () => {
      chrome.downloads.onChanged.removeListener(onChanged);
      signal.removeEventListener("abort", onAbort);
    };
    chrome.downloads.onChanged.addListener(onChanged);
    signal.addEventListener("abort", onAbort, { once: true });
    void finish(); // it may have finished before the listener was added
  });
}

export const downloadsGroup: ActionGroup = {
  name: "downloads",
  permissions: ["downloads"],
  needsHostAccess: false,
  actions: [
    bg("downloads.start", async (input, ctx) => {
      checkScheme(ctx, input.url, /^(https?|data):/i, "Downloads");
      const options: chrome.downloads.DownloadOptions = { url: input.url, conflictAction: input.conflictAction, saveAs: input.saveAs };
      if (input.filename) options.filename = input.filename;
      const id = await chromeCall(chrome.downloads.download(options));
      const item = input.waitForComplete ? await waitForDownload(id, ctx.signal) : await getDownload(id);
      return toDownload(item);
    }),
    bg("downloads.list", async (input) => {
      const query: chrome.downloads.DownloadQuery = { limit: input.limit, orderBy: ["-startTime"] };
      if (input.query) query.query = [input.query];
      if (input.state) query.state = input.state;
      return { downloads: (await chrome.downloads.search(query)).map(toDownload) };
    }),
    bg("downloads.cancel", async (input) => {
      await getDownload(input.id);
      await chromeCall(chrome.downloads.cancel(input.id));
      return {};
    }),
  ],
};

// ---------------------------------------------------------------------------
// bookmarks
// ---------------------------------------------------------------------------

function toBookmark(n: chrome.bookmarks.BookmarkTreeNode): Out<"bookmarks.create"> {
  return {
    id: n.id,
    title: n.title,
    ...(n.url !== undefined ? { url: n.url } : {}),
    ...(n.parentId !== undefined ? { parentId: n.parentId } : {}),
    ...(n.index !== undefined ? { index: n.index } : {}),
    ...(n.dateAdded !== undefined ? { dateAdded: n.dateAdded } : {}),
    folder: n.url === undefined,
  };
}

async function getBookmark(id: string) {
  const [n] = await chromeCall(chrome.bookmarks.get(id), "TARGET_NOT_FOUND");
  if (!n) throw new ExtensionUseError("TARGET_NOT_FOUND", `No bookmark ${id}`);
  return n;
}

// A javascript: bookmark (bookmarklet) runs code when the person clicks it.
const checkBookmarkUrl = (ctx: ActionContext, url: string) => checkScheme(ctx, url, /^(https?|file):/i, "Bookmarks");

export const bookmarksGroup: ActionGroup = {
  name: "bookmarks",
  permissions: ["bookmarks"],
  needsHostAccess: false,
  actions: [
    bg("bookmarks.search", async (input) => ({
      bookmarks: (await chrome.bookmarks.search(input.query)).slice(0, input.limit).map(toBookmark),
    })),
    bg("bookmarks.list", async (input) => ({
      bookmarks: (await chromeCall(chrome.bookmarks.getChildren(input.parentId), "TARGET_NOT_FOUND")).map(toBookmark),
    })),
    bg("bookmarks.create", async (input, ctx) => {
      const details: chrome.bookmarks.CreateDetails = { title: input.title };
      if (input.url !== undefined) {
        checkBookmarkUrl(ctx, input.url);
        details.url = input.url;
      }
      if (input.parentId !== undefined) details.parentId = input.parentId;
      if (input.index !== undefined) details.index = input.index;
      return toBookmark(await chromeCall(chrome.bookmarks.create(details)));
    }),
    bg("bookmarks.update", async (input, ctx) => {
      await getBookmark(input.id);
      const changes: chrome.bookmarks.UpdateChanges = {};
      if (input.title !== undefined) changes.title = input.title;
      if (input.url !== undefined) {
        checkBookmarkUrl(ctx, input.url);
        changes.url = input.url;
      }
      if (Object.keys(changes).length) await chromeCall(chrome.bookmarks.update(input.id, changes));
      if (input.parentId !== undefined || input.index !== undefined) {
        const dest: chrome.bookmarks.MoveDestination = {};
        if (input.parentId !== undefined) dest.parentId = input.parentId;
        if (input.index !== undefined) dest.index = input.index;
        await chromeCall(chrome.bookmarks.move(input.id, dest));
      }
      return toBookmark(await getBookmark(input.id));
    }),
    bg("bookmarks.remove", async (input) => {
      const node = await getBookmark(input.id);
      if (node.url === undefined && input.recursive) await chromeCall(chrome.bookmarks.removeTree(input.id));
      else {
        await chromeCall(chrome.bookmarks.remove(input.id)).catch((err: ExtensionUseError) => {
          throw node.url === undefined ? new ExtensionUseError("INVALID_INPUT", `${err.message} Pass recursive: true to delete a folder and its contents.`) : err;
        });
      }
      return {};
    }),
  ],
};

// ---------------------------------------------------------------------------
// history
// ---------------------------------------------------------------------------

export const historyGroup: ActionGroup = {
  name: "history",
  permissions: ["history"],
  needsHostAccess: false,
  actions: [
    bg("history.search", async (input) => {
      // Chrome's default startTime is 24 hours ago; search everything unless told otherwise.
      const query: chrome.history.HistoryQuery = { text: input.text, startTime: input.startTime ?? 0, maxResults: input.limit };
      if (input.endTime !== undefined) query.endTime = input.endTime;
      const items = await chrome.history.search(query);
      return {
        items: items.map((h) => ({
          url: h.url ?? "",
          title: h.title ?? "",
          ...(h.lastVisitTime !== undefined ? { lastVisitTime: h.lastVisitTime } : {}),
          visitCount: h.visitCount ?? 0,
          typedCount: h.typedCount ?? 0,
        })),
      };
    }),
    bg("history.delete", async (input) => {
      await chromeCall(chrome.history.deleteUrl({ url: input.url }));
      return {};
    }),
  ],
};

// ---------------------------------------------------------------------------
// cookies
// ---------------------------------------------------------------------------

function toCookie(c: chrome.cookies.Cookie): Out<"cookies.set"> {
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite,
    session: c.session,
    hostOnly: c.hostOnly,
    ...(c.expirationDate !== undefined ? { expirationDate: c.expirationDate } : {}),
  };
}

const checkCookieUrl = (ctx: ActionContext, url: string) => checkScheme(ctx, url, /^https?:/i, "Cookies");

function cookieApi() {
  if (!chrome.cookies) throw new ExtensionUseError("NEEDS_PERMISSION", 'The cookies group needs the "cookies" permission');
  return chrome.cookies;
}

export const cookiesGroup: ActionGroup = {
  name: "cookies",
  permissions: ["cookies"],
  // Chrome only shows cookies of sites the extension has host access to.
  needsHostAccess: true,
  actions: [
    bg("cookies.list", async (input, ctx) => {
      const filter: chrome.cookies.GetAllDetails = {};
      if (input.url) {
        checkCookieUrl(ctx, input.url);
        filter.url = input.url;
      }
      if (input.domain) {
        ctx.assertAllowedUrl(`https://${input.domain.replace(/^\./, "")}/`);
        filter.domain = input.domain;
      }
      if (input.name) filter.name = input.name;
      return { cookies: (await cookieApi().getAll(filter)).map(toCookie) };
    }),
    bg("cookies.set", async (input, ctx) => {
      checkCookieUrl(ctx, input.url);
      const details: chrome.cookies.SetDetails = { url: input.url, name: input.name, value: input.value };
      if (input.domain !== undefined) details.domain = input.domain;
      if (input.path !== undefined) details.path = input.path;
      if (input.secure !== undefined) details.secure = input.secure;
      if (input.httpOnly !== undefined) details.httpOnly = input.httpOnly;
      if (input.sameSite !== undefined) details.sameSite = input.sameSite as chrome.cookies.SameSiteStatus;
      if (input.expirationDate !== undefined) details.expirationDate = input.expirationDate;
      const cookie = await chromeCall(cookieApi().set(details));
      if (!cookie) throw new ExtensionUseError("INVALID_INPUT", "Chrome refused the cookie (check url, domain, secure and sameSite)");
      return toCookie(cookie);
    }),
    bg("cookies.remove", async (input, ctx) => {
      checkCookieUrl(ctx, input.url);
      const existing = await cookieApi().get({ url: input.url, name: input.name });
      if (existing) await chromeCall(cookieApi().remove({ url: input.url, name: input.name }));
      return { removed: Boolean(existing) };
    }),
  ],
};
