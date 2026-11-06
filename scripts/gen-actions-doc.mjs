// Generates docs/actions.md from the action schemas, so the reference can't drift from the code.
//   node scripts/gen-actions-doc.mjs
import { build } from "esbuild";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = await build({
  stdin: { contents: `export * from "./packages/protocol/src/schemas.ts";`, resolveDir: root, loader: "ts" },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  conditions: ["source"],
  logLevel: "warning",
});
const { coreActionSchemas, coreEventSchemas, z } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

const WHERE = {
  background: "extension background",
  content: "the page (content runtime)",
  bridge: "the frame bridge (side panel page); frame controllers only",
};

function typeOf(s) {
  if (!s) return "unknown";
  if (s.$ref) return s.$ref.includes("__schema") ? "SnapshotNode" : s.$ref.split("/").pop(); // the only recursive schema
  if (s.anyOf) return s.anyOf.map(typeOf).join(" \\| ");
  if (s.const !== undefined) return JSON.stringify(s.const);
  if (s.enum) return s.enum.map((e) => JSON.stringify(e)).join(" \\| ");
  if (s.type === "array") {
    const t = typeOf(s.items);
    return t.includes(" \\| ") ? `(${t})[]` : `${t}[]`;
  }
  if (s.type === "object") {
    if (!s.properties) return s.additionalProperties ? `Record<string, ${typeOf(s.additionalProperties)}>` : "object";
    return `{ ${Object.entries(s.properties).map(([k, v]) => `${k}${(s.required ?? []).includes(k) ? "" : "?"}: ${typeOf(v)}`).join("; ")} }`;
  }
  if (s.type === "integer") return "number";
  return s.type ?? "unknown";
}

function fieldsTable(schema) {
  const props = schema.properties ?? {};
  const keys = Object.keys(props);
  if (!keys.length) return "_No fields._\n";
  const rows = keys.map((k) => {
    const p = props[k];
    const required = (schema.required ?? []).includes(k) && p.default === undefined;
    const notes = [p.default !== undefined ? `default \`${JSON.stringify(p.default)}\`` : "", p.minimum !== undefined ? `min ${p.minimum}` : "", p.maximum !== undefined ? `max ${p.maximum}` : "", p.maxLength !== undefined ? `max length ${p.maxLength}` : ""]
      .filter(Boolean)
      .join(", ");
    const type = k === "locator" && p.properties?.css ? "Locator" : typeOf(p).replace(/(?<!\\)\|/g, "\\|");
    return `| \`${k}\` | \`${type}\` | ${required ? "yes" : ""} | ${notes} |`;
  });
  return `| Field | Type | Required | Notes |\n|---|---|---|---|\n${rows.join("\n")}\n`;
}

// Descriptions mention tags like <select>: escape them so GitHub and the docs site show them as text.
const escapeHtml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const toJson = (s, io) => z.toJSONSchema(s, { io, unrepresentable: "any", reused: "inline" });

let md = `# Action reference

Generated from \`packages/protocol/src/schemas.ts\` by \`pnpm docs:actions\`. Don't edit by hand.

Every action is called as \`ext.<group>.<name>(input, { target?, timeoutMs?, signal? })\`, or \`ext.call("group.name", input, options)\`.
Inputs are checked by the extension. Wrong input comes back as \`INVALID_INPUT\`.

A **locator** finds elements: \`{ ref?, role?, name?, text?, testId?, css?, nth?, exact? }\`. Give at least one of \`ref\`, \`role\`, \`text\`, \`testId\` or \`css\`; fields combine.
A **target** picks the tab: \`{ tab?: "active" | tabId | { urlMatch }, frame?: "top" | frameId }\`. The default is the active tab of the controller's window.

`;

const groups = {};
for (const [name, schema] of Object.entries(coreActionSchemas)) (groups[name.split(".")[0]] ??= []).push([name, schema]);
md += `## Contents\n\n${Object.entries(groups).map(([g, list]) => `- **${g}**: ${list.map(([n]) => `[\`${n}\`](#${n.replace(".", "").toLowerCase()})`).join(", ")}`).join("\n")}\n- [Events](#events)\n\n`;

for (const [group, list] of Object.entries(groups)) {
  md += `## ${group}\n\n`;
  for (const [name, s] of list) {
    md += `### \`${name}\`\n\n${escapeHtml(s.description)}\n\nRuns in ${WHERE[s.where]}.${s.timeoutMs ? ` Default timeout ${s.timeoutMs / 1000} s.` : ""}\n\n**Input**\n\n${fieldsTable(toJson(s.input, "input"))}\n**Output**\n\n${fieldsTable(toJson(s.output, "output"))}\n`;
  }
}

md += `## Events\n\nSubscribe with \`ext.on(name, handler)\`. Patterns like \`"tab.*"\` work.\n\n`;
for (const [name, s] of Object.entries(coreEventSchemas)) md += `### \`${name}\`\n\n${fieldsTable(toJson(s, "output"))}\n`;

await writeFile(join(root, "docs/actions.md"), md);
console.log(`docs/actions.md: ${Object.keys(coreActionSchemas).length} actions, ${Object.keys(coreEventSchemas).length} events`);
