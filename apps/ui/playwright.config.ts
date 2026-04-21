import { defineConfig, devices } from "@playwright/test";
import { resolveWorkspaceBrowserUrl } from "../../src/shared/workspace-browser-url.js";

const browserUrl = resolveWorkspaceBrowserUrl("default");

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: {
    baseURL: browserUrl.baseUrl,
    trace: "on-first-retry"
  },
  webServer: {
    command: "npm run dev:e2e",
    url: browserUrl.baseUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 120000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
