import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(here, "."),
    },
  },
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: [resolve(here, "vitest.setup.ts"), resolve(here, "tests/setup.ts")],
    include: ["app/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
  },
});
