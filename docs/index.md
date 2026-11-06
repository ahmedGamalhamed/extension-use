---
layout: home

hero:
  name: Extension-use
  text: Let anything drive your browser extension
  tagline: Packages you add to your own extension, so a web app, a website, a script or an AI agent can read pages and act on them through a typed, declarative set of actions. Your extension keeps the privileges.
  actions:
    - theme: brand
      text: Pick your packages
      link: /start/picker
    - theme: alt
      text: Introduction
      link: /start/introduction
    - theme: alt
      text: Action reference
      link: /actions

features:
  - icon: 🧩
    title: A library, not an extension
    details: Install the packages into the extension you already have, built with WXT, any bundler, or no build step at all.
  - icon: 🌐
    title: Ship features as web deploys
    details: Your side panel can be your web app. New features that use existing actions ship as web deploys, not store reviews.
  - icon: 🤖
    title: Scripts and AI agents
    details: Pair the browser with a local relay and call it over HTTP or WebSocket, or give an MCP agent one tool per action.
  - icon: 🛡️
    title: Guard rails on by default
    details: Origin checks, grants per controller, blocked sites, refused password fields, a visible indicator, a kill switch and an audit log.
  - icon: 📐
    title: 72 typed actions
    details: Tabs, windows, reading, clicking, typing, forms, scrolling, screenshots, overlays, an element picker, plus opt-in browser data.
  - icon: 🧪
    title: Testable
    details: A mock host for fast unit tests, and Playwright fixtures that load your real extension in Chromium.
---

## How it fits together

```
web app (iframe in side panel)  ──postMessage──▶  frame bridge ─┐
website (externally_connectable) ─────────────────────────────┤──▶ router (background) ──▶ content runtime (tab)
script / agent (remote)         ──relay──────────────────────┘        grants · policy · audit
```

Your extension runs the **host**: a router in the background, a runtime in each page, and a bridge for your web app. **Controllers** connect from outside and call actions by name. They can only call the actions you enable, on the sites your policy allows. No controller code ever runs inside the extension, so it stays within Chrome Web Store rules.

## In your extension and in your app

```ts
// Your extension: background
import { defineHost } from "@extension-use/host/background";

defineHost({
  id: "my-extension",
  controllers: { frame: { origins: ["https://app.example.com"] } },
  contentScript: "content.js",
});
```

```ts
// Your web app
import { connect } from "@extension-use/client";
import { frame } from "@extension-use/client/frame";

const ext = await connect(frame());
const { text } = await ext.dom.snapshot({ format: "text" }); // the page as a tree with refs
await ext.dom.click({ locator: { role: "button", name: "Save" } });
```

Not sure which packages you need? The [package picker](./start/picker.md) asks three questions and writes the setup for you.
