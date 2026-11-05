// No build step: this file runs as-is. The bundles in ./vendor come from
// `npm install` (extension-use vendor). Reload the extension after edits.
import { defineHost } from "./vendor/extension-use-background.js";

const CONTROLLER_ORIGIN = "{{controllerOrigin}}";

defineHost({
  id: "{{packageName}}",
  name: "{{name}}",
  controllers: {
    // Your web app in the side panel.
    frame: { origins: [CONTROLLER_ORIGIN] },
    // Your web app in a normal tab: read-only by default. Widen as needed.
    page: { origins: [CONTROLLER_ORIGIN], grants: ["runtime.*", "tabs.list", "page.info", "dom.snapshot", "dom.query", "dom.text", "overlay.*"] },
  },
  contentScript: "vendor/extension-use-content.js",
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
