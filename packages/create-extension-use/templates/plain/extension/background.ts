import { builtinGroups, defineHost } from "@extension-use/host/background";
import { GROUPS } from "./groups";

declare const CONTROLLER_ORIGIN: string;

defineHost({
  id: "{{packageName}}",
  name: "{{name}}",
  groups: GROUPS.map((g) => builtinGroups[g]),
  controllers: {
    // Your web app in the side panel.
    frame: { origins: [CONTROLLER_ORIGIN] },
    // Your web app in a normal tab: read-only by default. Widen as needed.
    page: { origins: [CONTROLLER_ORIGIN], grants: ["runtime.*", "tabs.list", "page.info", "dom.snapshot", "dom.query", "dom.text", "overlay.*"] },
  },
  contentScript: "content.js",
});

chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
