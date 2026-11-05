import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { withExtensionUse } from "../src/permissions.js";

describe("withExtensionUse", () => {
  it("merges permissions and externally_connectable without dropping existing entries", () => {
    const out = withExtensionUse(
      { name: "x", permissions: ["storage"], externally_connectable: { matches: ["https://old.example/*"] } },
      { groups: ["tabs", "dom"], controllerOrigins: ["https://app.example.com/"] },
    );
    expect(out).toEqual({
      name: "x",
      permissions: ["storage", "scripting", "sidePanel", "tabs"],
      host_permissions: ["<all_urls>"],
      externally_connectable: { matches: ["https://old.example/*", "https://app.example.com/*"] },
    });
  });

  it("asks for nothing extra for background-only groups and rejects unknown groups", () => {
    expect(withExtensionUse({}, { groups: ["runtime"], sidePanel: false })).toEqual({ permissions: [] });
    expect(() => withExtensionUse({}, { groups: ["nope" as never] })).toThrow(/Unknown Extension-use groups: nope/);
  });
});

describe("extension-use CLI", () => {
  const dir = mkdtempSync(join(tmpdir(), "eu-cli-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const cli = (args: string[]) =>
    // Runs the built CLI (run `pnpm build` first), as users would.
    execFileSync(process.execPath, [join(__dirname, "../dist/cli.js"), ...args], { encoding: "utf8" });

  it("writes into the manifest key of a package.json", () => {
    const pkg = join(dir, "package.json");
    writeFileSync(pkg, JSON.stringify({ name: "app", manifest: { permissions: ["storage"] } }));
    cli(["manifest", "--groups", "dom,overlay", "--origins", "https://app.example.com", "--write", pkg]);
    expect(JSON.parse(readFileSync(pkg, "utf8"))).toEqual({
      name: "app",
      manifest: {
        permissions: ["storage", "scripting", "sidePanel"],
        host_permissions: ["<all_urls>"],
        externally_connectable: { matches: ["https://app.example.com/*"] },
      },
    });
  });

  it("merges into a manifest.json", () => {
    const file = join(dir, "manifest.json");
    writeFileSync(file, JSON.stringify({ manifest_version: 3, name: "x", permissions: ["storage"] }));
    cli(["manifest", "--groups", "tabs", "--write", file]);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ manifest_version: 3, name: "x", permissions: ["storage", "sidePanel", "tabs"] });
  });

  it("prints the fields as JSON", () => {
    expect(JSON.parse(cli(["manifest", "--groups", "tabs", "--no-side-panel"]))).toEqual({ permissions: ["tabs"] });
  });
});
