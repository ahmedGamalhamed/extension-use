import { readFileSync } from "node:fs";
import { defineConfig } from "wxt";
import { GROUPS } from "./groups";

const CONTROLLER_URL = process.env.CONTROLLER_URL ?? "{{controllerUrl}}";
const CONTROLLER_ORIGIN = new URL(CONTROLLER_URL).origin;
const { key } = JSON.parse(readFileSync("extension-key.json", "utf8"));

export default defineConfig({
  modules: ["@extension-use/wxt"],
  // Permissions and externally_connectable are added from these settings.
  extensionUse: {
    groups: [...GROUPS],
    controllerOrigins: [CONTROLLER_ORIGIN],
  },
  manifest: {
    name: "{{name}}",
    action: { default_title: "Open {{name}}" },
    ...(process.env.STORE_BUILD ? {} : { key }), // the Web Store assigns its own ID
  },
  vite: () => ({
    define: {
      CONTROLLER_URL: JSON.stringify(CONTROLLER_URL),
      CONTROLLER_ORIGIN: JSON.stringify(CONTROLLER_ORIGIN),
    },
  }),
});
