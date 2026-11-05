/**
 * Build-time helpers: work out the manifest entries a host needs from the
 * action groups it enables, so extensions ask for no more than they use.
 *
 *   // Any build setup (plain JS/TS, or a custom bundler):
 *   import { withExtensionUse } from "@extension-use/host/permissions";
 *   const manifest = withExtensionUse(baseManifest, {
 *     groups: ["tabs", "page", "dom", "overlay"],
 *     controllerOrigins: ["https://app.example.com"],
 *   });
 *
 *   // Lower level:
 *   const { permissions, host_permissions } = permissionsFor([builtinGroups.dom, builtinGroups.tabs]);
 */
import { builtinGroups } from "./background/groups.js";
import type { ActionGroup } from "./registry.js";

export type GroupName = keyof typeof builtinGroups;
export const GROUP_NAMES = Object.keys(builtinGroups) as GroupName[];

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

export interface ManifestOptions extends Omit<PermissionOptions, "sidePanel"> {
  /** Built-in groups the host enables (must match defineHost). Default: all. */
  groups?: GroupName[];
  /** Web app origins allowed to connect from a normal tab (externally_connectable). */
  controllerOrigins?: string[];
  /** Add the "sidePanel" permission. Default true. */
  sidePanel?: boolean;
}

export interface ManifestFields {
  permissions?: string[];
  host_permissions?: string[];
  externally_connectable?: { matches?: string[]; ids?: string[]; accepts_tls_channel_id?: boolean };
  [key: string]: unknown;
}

/** Return a copy of `manifest` with the permissions and externally_connectable entries Extension-use needs. */
export function withExtensionUse<M extends ManifestFields>(manifest: M, options: ManifestOptions = {}): M {
  const names = options.groups ?? GROUP_NAMES;
  const unknown = names.filter((n) => !(n in builtinGroups));
  if (unknown.length) throw new Error(`Unknown Extension-use groups: ${unknown.join(", ")}. Known: ${GROUP_NAMES.join(", ")}`);
  const perms = permissionsFor(
    names.map((n) => builtinGroups[n]),
    { ...(options.matches ? { matches: options.matches } : {}), ...(options.injectOnDemand !== undefined ? { injectOnDemand: options.injectOnDemand } : {}), sidePanel: options.sidePanel ?? true },
  );
  const out: M = { ...manifest };
  out.permissions = unique([...(manifest.permissions ?? []), ...perms.permissions]);
  if (perms.host_permissions.length) out.host_permissions = unique([...(manifest.host_permissions ?? []), ...perms.host_permissions]);
  if (options.controllerOrigins?.length) {
    const matches = options.controllerOrigins.map((o) => `${o.replace(/\/+$/, "")}/*`);
    out.externally_connectable = {
      ...manifest.externally_connectable,
      matches: unique([...(manifest.externally_connectable?.matches ?? []), ...matches]),
    };
  }
  return out;
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
