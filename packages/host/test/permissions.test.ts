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
});
