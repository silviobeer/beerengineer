import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
            appTestConfigJson: null,
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
            appTestConfigJson: null,
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

  it("loads agent runtime config and honors per-step local overrides", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-app-context-"));
    const dbPath = join(root, "app.sqlite");
    const configPath = join(root, "agent-runtime.json");
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          defaultProvider: "codex",
          policy: {
            autonomyMode: "yolo",
            approvalMode: "never",
            filesystemMode: "danger-full-access",
            networkMode: "enabled",
            interactionMode: "non_blocking"
          },
          defaults: {
            autonomous: {
              provider: "codex",
              model: "gpt-5.4"
            },
            interactive: {
              provider: "codex",
              model: "gpt-5.4"
            }
          },
          interactive: {},
          stages: {
            brainstorm: {
              provider: "local",
              model: "local-brainstorm"
            }
          },
          workers: {},
          providers: {
            codex: {
              adapterKey: "codex",
              model: "gpt-5.4",
              command: ["codex"],
              env: {},
              timeoutMs: 1800000
            },
            local: {
              adapterKey: "local-cli",
              model: "local-fixture",
              command: ["node", "scripts/local-agent.mjs"],
              env: {},
              timeoutMs: 120000
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );
    const context = createAppContext(dbPath, {
      agentRuntimeConfigPath: configPath
    });

    try {
      expect(context.effectiveConfig.agentRuntimeConfigPath).toBe(configPath);
      expect(context.agentRuntime.resolver.resolveStage("brainstorm")).toMatchObject({
        providerKey: "local",
        adapterKey: "local-cli",
        model: "local-brainstorm"
      });

      const item = context.repositories.itemRepository.create({
        workspaceId: context.workspace.id,
        title: "Config Driven Brainstorm",
        description: "Use a local adapter only for brainstorm"
      });
      const result = await context.workflowService.startStage({
        stageKey: "brainstorm",
        itemId: item.id
      });
      const session = context.repositories.agentSessionRepository.listByStageRunId(result.runId)[0];

      expect(result.status).toBe("completed");
      expect(session?.adapterKey).toBe("local-cli");
    } finally {
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
