import { describe, expect, it } from "vitest";
import { builtinGroups, allBuiltinGroups } from "../src/background/groups.js";
import { permissionsFor } from "../src/permissions.js";

describe("permissionsFor", () => {
  it("asks only for what the chosen groups need", () => {
    expect(permissionsFor([builtinGroups.runtime])).toEqual({ permissions: [], host_permissions: [] });
    expect(permissionsFor([builtinGroups.tabs])).toEqual({ permissions: ["tabs"], host_permissions: [] });
    expect(permissionsFor([builtinGroups.dom], { matches: ["https://*.example.com/*"] })).toEqual({
      permissions: ["scripting"],
      host_permissions: ["https://*.example.com/*"],
    });
  });

  it("covers every built-in group", () => {
    expect(permissionsFor(allBuiltinGroups, { sidePanel: true })).toEqual({
      permissions: ["scripting", "sidePanel", "tabs", "webNavigation"],
      host_permissions: ["<all_urls>"],
    });
  });

  it("leaves the browser-data groups out of the defaults and asks for their permissions when enabled", () => {
    const names = allBuiltinGroups.map((g) => g.name);
    for (const g of ["downloads", "bookmarks", "history", "cookies"]) expect(names).not.toContain(g);
    const { downloads, bookmarks, history, cookies } = builtinGroups;
    expect(permissionsFor([downloads, bookmarks, history])).toEqual({ permissions: ["bookmarks", "downloads", "history"], host_permissions: [] });
    // Chrome shows only the cookies of sites the extension has host access to.
    expect(permissionsFor([cookies], { injectOnDemand: false })).toEqual({ permissions: ["cookies"], host_permissions: ["<all_urls>"] });
  });
});
