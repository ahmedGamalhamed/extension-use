# Introduction

Extension-use is a set of npm packages for browser extension developers. You add them to **your own extension**, and then something outside the extension can drive it:

- a **web app** shown in your side panel or popup,
- your **website**, open in a normal tab,
- a **script, server or CI job**, through a relay,
- an **AI agent**, through MCP.

These controllers call actions such as `dom.click`, `tabs.open` or `capture.screenshot` by name, with typed input and output. The extension does the work and keeps every privilege. It decides who may connect, which actions each one may call, and on which sites.

::: tip Not an extension you install
Extension-use doesn't ship an extension of its own. It's the code you put inside yours. The repository's `examples/basic-extension` shows a complete one.
:::

## Why

- **Ship features without a store review.** Your side panel can be your hosted web app. Features that use existing actions ship as web deploys.
- **One integration, many controllers.** The same actions work from the side panel, from your site, from a script and from an AI agent.
- **Safe by default.** Controllers send data, never code. Grants, site policy, blocked password fields, a visible indicator, a kill switch and an audit log are all on by default.

## The pieces

```
web app (iframe in side panel)  ──postMessage──▶  frame bridge ─┐
website (externally_connectable) ─────────────────────────────┤──▶ router (background) ──▶ content runtime (tab)
script / agent (remote)         ──relay──────────────────────┘        grants · policy · audit
```

| Piece | Where it runs | Package |
|---|---|---|
| **Host**: `defineHost()` sets up the router, which checks every call and runs background actions | Your extension's service worker | `@extension-use/host/background` |
| **Content runtime**: runs page actions (read, click, type, overlays, picker) | A content script in every frame | `@extension-use/host/content` |
| **Frame bridge**: loads your web app in an iframe and passes its calls on | An extension page (side panel, popup) | `@extension-use/host/frame` |
| **Control panel**: pairing with a relay, a kill switch, an activity log | An extension page (options) | `@extension-use/host/ui` |
| **Client**: `connect()` and typed calls like `ext.dom.click()` | Your web app, site or script | `@extension-use/client` |
| **Relay**: a server that scripts and agents call, and the browser dials out to | Your machine or server | `@extension-use/relay` |
| **MCP server**: the browser's actions as MCP tools | Next to your AI agent | `@extension-use/mcp` |

## Concepts

**Actions** have names like `dom.click`. Each has a schema for its input and output, a place where it runs (background, content or bridge), and a version. Wrong input fails with `INVALID_INPUT`. See the [action reference](../actions.md).

**Groups** bundle related actions: `tabs`, `dom`, `capture` and so on. You choose which groups the extension enables, and the manifest permissions follow from that. Five groups are opt-in because they reach data outside any page: `tabCapture`, `downloads`, `bookmarks`, `history` and `cookies`. See [action groups and permissions](../guides/permissions.md).

**Controllers** connect through a **transport**:

| Transport | Controller | How it connects |
|---|---|---|
| `frame` | A web app in an iframe in an extension page | `postMessage` to the frame bridge |
| `page` | A website in a normal tab | `chrome.runtime.connect` through `externally_connectable` |
| `remote` | A script, server or agent | HTTP, SSE or WebSocket to a relay the browser is paired with |

**Grants** list the actions each controller may call, with patterns like `"dom.*"`. **Site policy** blocks URLs: browser pages and extension stores always, plus your own list. See [controllers and transports](../guides/controllers.md) and [security](../guides/security.md).

**Targets** pick the tab and frame a call acts on: `{ tab: "active" | tabId | { urlMatch }, frame? }`. **Locators** find elements: a `ref` from a snapshot, `role` + `name`, `text`, `testId` or `css`.

## Requirements

- Chrome or another Chromium browser, Manifest V3.
- For your extension: WXT, any bundler, or no build step at all.
- For the relay, the MCP server and remote scripts: Node.js 22 or newer.

## Status

Version 0.1. The frame, page and remote transports, the MCP server, the setup command and the test kit all work end to end. The protocol may still change before 1.0. Firefox isn't supported yet.

## Next

- [Pick your packages](./picker.md): answer three questions and get the setup for your extension.
- [Add to your extension](./installation.md): the same steps, explained.
- [Start a new extension](./new-project.md) with `npm create extension-use`.
