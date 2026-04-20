import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { createAppContext } from "../../src/app-context.js";

describe("quality integrations", () => {
  it("uses .env.local as bootstrap-only fallback for Sonar and Coderabbit config", () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-quality-"));
    const dbPath = join(root, "app.sqlite");
    writeFileSync(
      join(root, ".env.local"),
      [
        "SONAR_HOST_URL=https://sonarcloud.io",
        "SONAR_ORGANIZATION=silviobeer",
        "SONAR_PROJECT_KEY=silviobeer_beerengineer",
        "SONAR_TOKEN=test-token",
        "CODERABBIT_HOST_URL=https://api.coderabbit.ai",
        "CODERABBIT_ORGANIZATION=silviobeer",
        "CODERABBIT_REPOSITORY=beerengineer",
        "CODERABBIT_TOKEN=test-token"
      ].join("\n"),
      "utf8"
    );
    const context = createAppContext(dbPath, { workspaceRoot: root });

    try {
      const sonar = context.services.sonarService.showConfig();
      const coderabbit = context.services.coderabbitService.showConfig();

      expect(sonar.config.source).toBe("env");
      expect(sonar.config.configured).toBe(true);
      expect(sonar.warnings[0]).toContain(".env.local fallback");
      expect(coderabbit.config.source).toBe("env");
      expect(coderabbit.config.configured).toBe(true);
    } finally {
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("persists Sonar scan knowledge and masks stored tokens", () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-quality-"));
    const dbPath = join(root, "app.sqlite");
    const context = createAppContext(dbPath, { workspaceRoot: root });

    try {
      const configured = context.services.sonarService.setConfig({
        hostUrl: "https://sonarcloud.io",
        organization: "silviobeer",
        projectKey: "silviobeer_beerengineer",
        token: "secret-token",
        gatingMode: "story_gate"
      });
      const scan = context.services.sonarService.scan();

      expect(configured.config.hasToken).toBe(true);
      expect(scan.execution.mode).toBe("fixture");
      expect(scan.gate.status).toMatch(/passed|review_required|failed/);
      expect(scan.knowledgeEntries.length).toBeGreaterThan(0);
      expect(context.repositories.qualityKnowledgeEntryRepository.listByWorkspaceId(context.workspace.id).length).toBeGreaterThan(0);

      context.services.sonarService.clearToken();
      expect(context.services.sonarService.showConfig().config.hasToken).toBe(false);
    } finally {
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
