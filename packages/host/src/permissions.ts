/**
 * Build-time helper: work out the manifest permissions a host needs from the
 * action groups it enables, so extensions ask for no more than they use.
 *
 *   import { builtinGroups } from "@extension-use/host/background";
 *   import { permissionsFor } from "@extension-use/host/permissions";
 *   const { permissions, host_permissions } = permissionsFor([builtinGroups.dom, builtinGroups.tabs]);
 */
import type { ActionGroup } from "./registry.js";

export interface PermissionOptions {
  /** Pages the content runtime runs on. Default ["<all_urls>"]. */
  matches?: string[];
  /** Inject the content script on demand (adds "scripting"). Default true. */
  injectOnDemand?: boolean;
  /** Extension pages host a frame controller in the side panel (adds "sidePanel"). */
  sidePanel?: boolean;
}

export function permissionsFor(groups: ActionGroup[], options: PermissionOptions = {}) {
  const permissions = new Set<string>();
  let hostAccess = false;
  for (const g of groups) {
    for (const p of g.permissions) permissions.add(p);
    if (g.needsHostAccess) hostAccess = true;
  }
  if (hostAccess && options.injectOnDemand !== false) permissions.add("scripting");
  if (options.sidePanel) permissions.add("sidePanel");
  return {
    permissions: [...permissions].sort(),
    host_permissions: hostAccess ? (options.matches ?? ["<all_urls>"]) : [],
  };
}
