# Custom actions

Your extension can offer its own actions next to the built-in ones, such as `app.saveNote` or `app.syncNow`. Controllers call them like any other action. The router gives them the same grants, input and output checks, site policy, audit log and kill switch.

Name them with your own prefix (`app.`, `myext.`), never a built-in group's.

## Background actions

A background action runs in the service worker with your handler:

```ts
// actions.ts
import { defineAction } from "@extension-use/host/background";
import * as z from "zod";

export const saveNote = defineAction(
  "app.saveNote",
  {
    where: "background",
    version: 1,
    description: "Save a note about the page in the target tab.",
    input: z.object({ text: z.string().min(1).max(2000) }),
    output: z.object({ id: z.string() }),
  },
  async ({ text }, ctx) => {
    const tab = await ctx.tab(); // the call's target tab, checked against site policy
    const id = crypto.randomUUID();
    await chrome.storage.local.set({ [id]: { text, url: tab.url } });
    return { id };
  },
);
```

```ts
// background.ts
import { defineHost } from "@extension-use/host/background";
import { saveNote } from "./actions";

defineHost({
  id: "my-extension",
  actions: [saveNote],
  controllers: { frame: { origins: ["https://app.example.com"] } },
});
```

Schemas use [zod](https://zod.dev) v4. Install it next to `@extension-use/host`. With no build step, you can't import zod, so custom actions need a bundler or WXT.

### The schema

| Field | Meaning |
|---|---|
| `where` | `"background"` (your handler runs in the service worker) or `"content"` (it runs in the page). |
| `version` | Bump it when the input or output changes in a breaking way. Controllers see it in `runtime.describe`. |
| `description` | Shown in `runtime.describe` and as the MCP tool description, so write it for the caller. |
| `input`, `output` | zod schemas. Input is checked (and defaults filled in) before your handler runs, and wrong input fails with `INVALID_INPUT`. The output schema types your handler and feeds `runtime.describe`; the mock host also checks it in tests. |
| `timeoutMs` | Default timeout for the whole call. |
| `nestable` | `false` keeps it out of `run.sequence`. Default `true`. |

### The context

The handler's second argument:

| Member | What it does |
|---|---|
| `ctx.tab()` | Resolves the call's target tab: `{ tabId, windowId, url }`. Throws `TARGET_NOT_FOUND` or `BLOCKED_BY_POLICY`. |
| `ctx.callContent(action, input)` | Runs a content action in the target tab. |
| `ctx.call(action, input, { target?, timeoutMs? })` | Runs another action as the same controller, with its grants and checks. |
| `ctx.assertAllowedUrl(url)` | Checks a URL against the site policy. Use it before you touch a URL from the input. |
| `ctx.emit(name, payload, tabId?)` | Sends an event to the controller (`ext.on(name, …)`). |
| `ctx.signal` | Aborts when the call is cancelled or times out. |
| `ctx.session` | `{ id, transport, origin, granted, windowId? }`: who is calling. |
| `ctx.target`, `ctx.timeoutMs`, `ctx.host`, `ctx.listActions()` | The raw target, the call's timeout, the host info, and the actions this controller may call. |

Throw an `ExtensionUseError` to fail with a specific code. `@extension-use/host/background` and `@extension-use/host/content` both export it. Any other error comes back as `INTERNAL`.

```ts
import { ExtensionUseError } from "@extension-use/host/background";

if (!loggedIn) throw new ExtensionUseError("NEEDS_PERMISSION", "Sign in to the extension first");
```

## Content actions

A content action runs in the page, in the content runtime. Declare its schema in the background with no handler, and give the handler to `startContentRuntime()`:

```ts
// actions.ts: shared by background and content
import { defineAction } from "@extension-use/host/background";
import * as z from "zod";

export const wordCount = defineAction("app.wordCount", {
  where: "content",
  version: 1,
  description: "Count the words in the page or in one element.",
  input: z.object({ selector: z.string().optional() }),
  output: z.object({ words: z.number() }),
});
```

```ts
// background.ts
defineHost({ id: "my-extension", actions: [wordCount], contentScript: "content.js", controllers: { /* … */ } });
```

```ts
// content.ts
import { startContentRuntime } from "@extension-use/host/content";

startContentRuntime({
  handlers: {
    "app.wordCount": ({ selector }: { selector?: string }, ctx) => {
      const root = selector ? document.querySelector(selector) : document.body;
      return { words: (root?.textContent ?? "").split(/\s+/).filter(Boolean).length };
    },
  },
});
```

The router checks the input, the grants and the site policy before the call reaches the page. The content handler gets `ctx.signal`, `ctx.timeoutMs`, `ctx.policy` and `ctx.emit()`.

::: warning Keep actions declarative
Actions must not run code, scripts or HTML a controller sends. That's what keeps an extension within Chrome Web Store policy, and it's what makes grants mean something. Take data as input, and do the work with code that ships inside the extension.
:::

## Calling them

Before you have types, use `callRaw()`:

```ts
const { id } = (await ext.callRaw("app.saveNote", { text: "Read later" })) as { id: string };
```

`ext.has("app.saveNote")` tells you whether the host offers it to this controller.

### Generate types

`runtime.describe` returns every action with JSON schemas for its input and output. The `extension-use codegen` command turns that into a type map:

```bash
# From a browser paired with a relay
EXTENSION_USE_TOKEN=eu_ctl_… npx extension-use codegen --relay http://127.0.0.1:7777 --out src/extension-actions.ts
```

```bash
# Or from saved output: JSON.stringify(await ext.runtime.describe())
npx extension-use codegen --from describe.json --out src/extension-actions.ts
```

```ts
import { connect, type CoreActions } from "@extension-use/client";
import type { HostActions } from "./extension-actions";

const ext = await connect<CoreActions & HostActions>(frame());
const { id } = await ext.app.saveNote({ text: "Read later" }); // typed input and output
```

`--all` includes the built-in actions too.

## With agents

Through [MCP](./agents.md), your actions become tools named with underscores (`app_saveNote`). Their descriptions and schemas come from `runtime.describe`.

## Testing

`createMockHost({ actions: [saveNote] })` runs your real handler behind the real router. See [testing](./testing.md).
