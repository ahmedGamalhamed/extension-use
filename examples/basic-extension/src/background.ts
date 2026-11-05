import { defineHost } from "@extension-use/host/background";

declare const CONTROLLER_ORIGIN: string;

defineHost({
  id: "example-basic",
  name: "Extension-use example",
  controllers: {
    // The web app shown in the side panel.
    frame: { origins: [CONTROLLER_ORIGIN] },
    // The same web app opened in a normal tab (externally_connectable).
    page: { origins: [CONTROLLER_ORIGIN], grants: ["runtime.*", "tabs.*", "page.*", "dom.query", "dom.text", "dom.snapshot", "overlay.*"] },
    // Scripts and agents through a relay the person pairs with in control.html.
    remote: {},
  },
  contentScript: "content.js",
  debug: true,
});

// Clicking the toolbar icon opens the side panel.
chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
