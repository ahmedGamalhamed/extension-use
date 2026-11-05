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
  for (const template of ["plain", "wxt"] as const) {
    it(`creates the ${template} template with every placeholder filled`, () => {
      const dir = join(root, template);
      const out = execFileSync(process.execPath, [cli, dir, "--template", template, "--url", "https://app.example.com/ext", "--name", "My Ext", "--yes"], { encoding: "utf8" });
      const id = JSON.parse(readFileSync(join(dir, "extension-key.json"), "utf8")).id;
      expect(id).toMatch(/^[a-p]{32}$/);
      expect(out).toContain(id);

      const list = files(dir);
      expect(list).toContain(".gitignore");
      expect(list).toContain("web/main.ts");
      expect(list).toContain(template === "wxt" ? "wxt.config.ts" : "build.mjs");
      for (const f of list) expect(readFileSync(join(dir, f), "utf8"), f).not.toMatch(/\{\{\w+\}\}/);

      expect(readFileSync(join(dir, "web/main.ts"), "utf8")).toContain(`const EXTENSION_ID = "${id}"`);
      expect(readFileSync(join(dir, "web/serve.mjs"), "utf8")).toContain('port: 443, host: "app.example.com"');
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
