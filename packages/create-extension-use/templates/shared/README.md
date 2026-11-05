# {{name}}

A browser extension whose side panel is your web app, built with Extension-use.

- `web/` is the web app. It runs at {{controllerUrl}} and drives the extension through `@extension-use/client`.
- The extension only relays commands and runs a fixed set of actions (read the page, click, type, highlight, pick elements, tabs, screenshots).

Extension ID: `{{extensionId}}` (pinned by `extension-key.json`).

## Develop

```bash
npm install
npm run dev
```

## Ship

1. Deploy `web/` somewhere (for example `https://app.example.com/ext`) and send `Content-Security-Policy: frame-ancestors chrome-extension://{{extensionId}}` with it, so only your extension can frame it.
2. Change the web app URL in the extension and in `controllers.*.origins` in the background script.
3. Build the extension and upload it to the Chrome Web Store. Remove `key` from the manifest for the store build; the store assigns the ID.
