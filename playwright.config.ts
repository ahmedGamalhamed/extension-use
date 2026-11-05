import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { extensionPath: "examples/basic-extension/dist" } as Record<string, unknown>,
  webServer: {
    command: "node examples/controller-app/serve.mjs",
    url: "http://localhost:5173/",
    reuseExistingServer: true,
  },
});
