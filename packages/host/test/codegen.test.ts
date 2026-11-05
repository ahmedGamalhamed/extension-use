import { describe, expect, it } from "vitest";
import { z } from "@extension-use/protocol/schemas";
import { generateTypes, jsonSchemaToTs } from "../src/codegen.js";

const toJson = (s: z.ZodType, io: "input" | "output" = "input") => z.toJSONSchema(s, { io, unrepresentable: "any", reused: "inline" }) as never;

describe("codegen", () => {
  it("converts JSON schemas from zod into TypeScript", () => {
    const schema = z.object({
      id: z.string(),
      count: z.number().int().default(1),
      mode: z.enum(["a", "b"]),
      tags: z.array(z.union([z.string(), z.number()])).optional(),
      meta: z.record(z.string(), z.boolean()),
      "odd-key": z.literal(true),
      nested: z.object({ ok: z.boolean() }).describe("A nested object"),
    });
    expect(jsonSchemaToTs(toJson(schema))).toBe(`{
  id: string;
  count?: number;
  mode: "a" | "b";
  tags?: (string | number)[];
  meta: Record<string, boolean>;
  "odd-key": true;
  /** A nested object */
  nested: {
    ok: boolean;
  };
}`);
    // Output types: defaults make fields required.
    expect(jsonSchemaToTs(toJson(z.object({ n: z.number().default(1) }), "output"))).toContain("n: number;");
  });

  it("writes host-defined actions only, unless asked for all", () => {
    const describe = {
      host: { id: "my-ext", name: "My extension", version: "1.2.0" },
      actions: [
        { name: "runtime.ping", description: "Check the connection.", where: "background", input: toJson(z.object({})), output: toJson(z.object({ pong: z.literal(true) }), "output") },
        { name: "app.save", description: "Save the page.", where: "background", input: toJson(z.object({ note: z.string().optional() })), output: toJson(z.object({ saved: z.boolean() }), "output") },
      ],
    };
    const code = generateTypes(describe);
    expect(code).toContain("from My extension (my-ext) 1.2.0");
    expect(code).toContain(`  /** Save the page. */\n  "app.save": {\n    input: {\n      note?: string;\n    };\n    output: {\n      saved: boolean;\n    };\n  };`);
    expect(code).not.toContain("runtime.ping");
    expect(generateTypes(describe, { all: true, typeName: "All" })).toMatch(/export type All = \{[\s\S]*"runtime\.ping"/);
  });
});
