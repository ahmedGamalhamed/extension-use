import { mountFrameBridge } from "./vendor/extension-use-frame.js";

const CONTROLLER_URL = "{{controllerUrl}}";

mountFrameBridge({
  url: CONTROLLER_URL,
  container: document.getElementById("app"),
  fallback: `Can't reach ${CONTROLLER_URL}. Is "npm run dev" running?`,
});
