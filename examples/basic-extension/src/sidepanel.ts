import { mountFrameBridge } from "@extension-use/host/frame";

declare const CONTROLLER_URL: string;

mountFrameBridge({
  url: CONTROLLER_URL,
  container: document.getElementById("app")!,
  fallback: `Could not load ${CONTROLLER_URL}. Start it with "pnpm example:serve".`,
  debug: true,
});
