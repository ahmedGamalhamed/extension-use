import { defineConfig } from "vitest/config";

// Workspace packages export their TypeScript sources under the "source" condition.
const conditions = ["source", "module", "import", "default"];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions, externalConditions: ["source"] } },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    server: { deps: { inline: [/@extension-use\//] } },
  },
});
