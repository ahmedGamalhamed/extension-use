/**
 * @extension-use/wxt
 *
 *   // wxt.config.ts
 *   export default defineConfig({
 *     modules: ["@extension-use/wxt"],
 *     extensionUse: {
 *       groups: ["tabs", "page", "dom", "overlay"],
 *       controllerOrigins: ["https://app.example.com"],
 *     },
 *   });
 *
 * Adds the manifest permissions for the action groups you enable and lets your
 * web app connect through externally_connectable.
 */
import "wxt";
import { defineWxtModule } from "wxt/modules";
import { withExtensionUse, type ManifestFields, type ManifestOptions } from "@extension-use/host/permissions";

export type ExtensionUseModuleOptions = ManifestOptions;

declare module "wxt" {
  export interface InlineConfig {
    extensionUse?: ExtensionUseModuleOptions;
  }
}

export default defineWxtModule<ExtensionUseModuleOptions>({
  name: "@extension-use/wxt",
  configKey: "extensionUse",
  setup(wxt, options = {}) {
    withExtensionUse({}, options); // fail early on unknown groups
    wxt.hook("build:manifestGenerated", (_wxt, manifest) => {
      Object.assign(manifest, withExtensionUse(manifest as unknown as ManifestFields, options));
    });
  },
});
