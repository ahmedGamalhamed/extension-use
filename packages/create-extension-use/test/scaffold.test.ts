import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const cli = join(__dirname, "../index.mjs");
const root = mkdtempSync(join(tmpdir(), "create-extension-use-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function files(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p, base) : [p.slice(base.length + 1).replace(/\\/g, "/")];
  });
}

describe("create-extension-use", () => {
  const layout = {
    plain: { main: "web/main.ts", serve: "web/serve.mjs", marker: "build.mjs" },
    wxt: { main: "web/main.ts", serve: "web/serve.mjs", marker: "wxt.config.ts" },
    vanilla: { main: "web/main.js", serve: "serve.mjs", marker: "extension/manifest.json" },
  } as const;

  for (const template of ["plain", "wxt", "vanilla"] as const) {
    it(`creates the ${template} template with every placeholder filled`, () => {
      const dir = join(root, template);
      const out = execFileSync(process.execPath, [cli, dir, "--template", template, "--url", "https://app.example.com/ext", "--name", "My Ext", "--yes"], { encoding: "utf8" });
      const id = JSON.parse(readFileSync(join(dir, "extension-key.json"), "utf8")).id;
      expect(id).toMatch(/^[a-p]{32}$/);
      expect(out).toContain(id);

      const list = files(dir);
      expect(list).toContain(".gitignore");
      const { main, serve, marker } = layout[template];
      expect(list).toContain(main);
      expect(list).toContain(marker);
      expect(list).not.toContain(".skip");
      for (const f of list) expect(readFileSync(join(dir, f), "utf8"), f).not.toMatch(/\{\{\w+\}\}/);

      expect(readFileSync(join(dir, main), "utf8")).toContain(`const EXTENSION_ID = "${id}"`);
      expect(readFileSync(join(dir, serve), "utf8")).toMatch(/443.*"app\.example\.com"/);
      if (template === "vanilla") {
        expect(list).not.toContain("web/main.ts");
        expect(list).not.toContain("tsconfig.json");
        const manifest = JSON.parse(readFileSync(join(dir, "extension/manifest.json"), "utf8"));
        expect(manifest.key).toBe(JSON.parse(readFileSync(join(dir, "extension-key.json"), "utf8")).key);
        expect(manifest.externally_connectable).toEqual({ matches: ["https://app.example.com/*"] });
      }
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      expect(pkg.name).toBe(template);
      expect(pkg.dependencies["@extension-use/host"]).toBe("^0.1.0");
    });
  }

  it("refuses a non-empty folder and unknown templates", () => {
    const run = (args: string[]) => {
      try {
        execFileSync(process.execPath, [cli, ...args, "--yes"], { encoding: "utf8", stdio: "pipe" });
        return "ok";
      } catch (e) {
        return String((e as { stderr: string }).stderr);
      }
    };
    expect(run([join(root, "plain")])).toContain("is not empty");
    expect(run([join(root, "x"), "--template", "vue"])).toContain('Unknown template "vue"');
  });
});
