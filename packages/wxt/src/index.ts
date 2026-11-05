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
 * Works out the manifest permissions from the action groups you enable and
 * lets your web app connect through externally_connectable.
 */
import "wxt";
import { defineWxtModule } from "wxt/modules";
import { builtinGroups } from "@extension-use/host/background";
import { permissionsFor } from "@extension-use/host/permissions";

export type GroupName = keyof typeof builtinGroups;

export interface ExtensionUseModuleOptions {
  /** Built-in action groups the host enables. Default: all of them. Must match `groups` in defineHost(). */
  groups?: GroupName[];
  /** Origins of web apps that control the extension. Added to externally_connectable (page transport). */
  controllerOrigins?: string[];
  /** Pages the content runtime runs on. Default ["<all_urls>"]. */
  matches?: string[];
  /** Add the "sidePanel" permission. Default true. */
  sidePanel?: boolean;
}

declare module "wxt" {
  export interface InlineConfig {
    extensionUse?: ExtensionUseModuleOptions;
  }
}

export default defineWxtModule<ExtensionUseModuleOptions>({
  name: "@extension-use/wxt",
  configKey: "extensionUse",
  setup(wxt, options = {}) {
    const names = options.groups ?? (Object.keys(builtinGroups) as GroupName[]);
    const unknown = names.filter((n) => !(n in builtinGroups));
    if (unknown.length) throw new Error(`@extension-use/wxt: unknown groups ${unknown.join(", ")}`);

    const perms = permissionsFor(
      names.map((n) => builtinGroups[n]),
      { ...(options.matches ? { matches: options.matches } : {}), sidePanel: options.sidePanel ?? true },
    );

    wxt.hook("build:manifestGenerated", (_wxt, manifest) => {
      manifest.permissions = unique([...(manifest.permissions ?? []), ...perms.permissions]);
      if (perms.host_permissions.length) {
        manifest.host_permissions = unique([...(manifest.host_permissions ?? []), ...perms.host_permissions]);
      }
      const origins = options.controllerOrigins ?? [];
      if (origins.length) {
        const matches = origins.map((o) => `${o.replace(/\/$/, "")}/*`);
        manifest.externally_connectable = {
          ...manifest.externally_connectable,
          matches: unique([...(manifest.externally_connectable?.matches ?? []), ...matches]),
        };
      }
    });
  },
});

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
