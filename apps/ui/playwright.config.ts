import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const browserUrl = {
  baseUrl: "http://127.0.0.1:3100"
};
const fixtureDbPath = resolve(__dirname, ".tmp", "board-e2e.sqlite");

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: {
    baseURL: browserUrl.baseUrl,
    trace: "on-first-retry"
  },
  webServer: {
    command: "npm run dev:e2e",
    env: {
      ...process.env,
      BEERENGINEER_UI_DB_PATH: fixtureDbPath,
      BEERENGINEER_UI_FAIL_WORKSPACE_KEY: "broken",
      NEXT_PUBLIC_ENGINE_BASE_URL: "http://127.0.0.1:4101"
    },
    url: browserUrl.baseUrl,
    reuseExistingServer: false,
    timeout: 120000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
