import { mountFrameBridge } from "@extension-use/host/frame";

declare const CONTROLLER_URL: string;

mountFrameBridge({
  url: CONTROLLER_URL,
  container: document.getElementById("app")!,
  fallback: `Can't reach ${CONTROLLER_URL}. Is "npm run dev" running?`,
});
