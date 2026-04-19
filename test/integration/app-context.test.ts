import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { createAppContext } from "../../src/app-context.js";

describe("app context", () => {
  it("rolls back workspace creation when settings creation fails inside one transaction", () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-app-context-"));
    const dbPath = join(root, "app.sqlite");
    const context = createAppContext(dbPath);

    try {
      expect(() =>
        context.runInTransaction(() => {
          const workspace = context.repositories.workspaceRepository.create({
            key: "broken",
            name: "Broken Workspace",
            description: null,
            rootPath: null
          });

          context.repositories.workspaceSettingsRepository.create({
            workspaceId: workspace.id,
            defaultAdapterKey: null,
            defaultModel: null,
            autorunPolicyJson: null,
            promptOverridesJson: null,
            skillOverridesJson: null,
            verificationDefaultsJson: null,
            qaDefaultsJson: null,
            gitDefaultsJson: null,
            executionDefaultsJson: null,
            uiMetadataJson: null
          });

          context.repositories.workspaceSettingsRepository.create({
            workspaceId: workspace.id,
            defaultAdapterKey: null,
            defaultModel: null,
            autorunPolicyJson: null,
            promptOverridesJson: null,
            skillOverridesJson: null,
            verificationDefaultsJson: null,
            qaDefaultsJson: null,
            gitDefaultsJson: null,
            executionDefaultsJson: null,
            uiMetadataJson: null
          });
        })
      ).toThrow();

      expect(context.repositories.workspaceRepository.getByKey("broken")).toBeNull();
    } finally {
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
