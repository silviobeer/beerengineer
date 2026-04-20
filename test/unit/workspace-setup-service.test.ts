import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { AppError } from "../../src/shared/errors.js";
import { WorkspaceSetupService } from "../../src/services/workspace-setup-service.js";

function createRuntimeConfig(root: string, overrides?: Record<string, unknown>): string {
  const configPath = join(root, "agent-runtime.json");
  const config = {
    defaultProvider: "codex",
    policy: {
      autonomyMode: "yolo",
      approvalMode: "never",
      filesystemMode: "workspace-write",
      networkMode: "enabled",
      interactionMode: "non_blocking"
    },
    defaults: {
      interactive: { provider: "codex" },
      autonomous: { provider: "codex" }
    },
    interactive: {},
    stages: {},
    workers: {},
    providers: {
      codex: { adapterKey: "codex", command: ["node"], timeoutMs: 1000, env: {} },
      claude: { adapterKey: "claude", command: ["node"], timeoutMs: 1000, env: {} }
    },
    ...overrides
  };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return configPath;
}

function createService(root: string, configPath: string, overrides: Record<string, unknown> = {}) {
  return new WorkspaceSetupService({
    workspace: {
      id: "workspace_1",
      key: "hello-world",
      name: "Hello World",
      description: null,
      rootPath: root,
      archivedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    },
    workspaceRoot: root,
    rootPathSource: "workspace",
    agentRuntimeConfigPath: configPath,
    ...overrides
  });
}

describe("WorkspaceSetupService", () => {
  it("falls back to safe autonomy when the runtime config violates required engine policy", () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-workspace-setup-"));
    const configPath = createRuntimeConfig(root);

    try {
      const report = createService(root, configPath).doctor();
      expect(report.harnesses.find((harness: { providerKey: string }) => harness.providerKey === "codex")?.autonomyLevel).toBe("safe");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("simulates parent directory creation and uses Python install commands for the python stack", () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-workspace-setup-"));
    const configPath = createRuntimeConfig(root, {
      policy: {
        autonomyMode: "yolo",
        approvalMode: "never",
        filesystemMode: "danger-full-access",
        networkMode: "enabled",
        interactionMode: "non_blocking"
      }
    });

    try {
      const result = createService(root, configPath).bootstrap({
        stack: "python",
        scaffoldProjectFiles: true,
        createRoot: false,
        initGit: false,
        installDeps: true,
        withSonar: false,
        withCoderabbit: false,
        dryRun: true
      });

      expect(result.actions.some((action: { id: string }) => action.id === "bootstrap-python-main-parent-directory")).toBe(true);
      const installAction = result.actions.find((action: { id: string }) => action.id === "bootstrap-install-deps") as
        | { command?: string[] }
        | undefined;
      expect(installAction?.command?.slice(1)).toEqual(["-m", "pip", "install", "-e", "."]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("guards resolved sessions from being resolved again and recommends a fresh assist flow", () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-workspace-setup-"));
    const configPath = createRuntimeConfig(root);
    const session = {
      id: "workspace_assist_session_1",
      workspaceId: "workspace_1",
      status: "resolved",
      currentPlanJson: JSON.stringify({
        version: 1,
        workspaceKey: "hello-world",
        rootPath: root,
        mode: "greenfield",
        stack: "node-ts",
        scaffoldProjectFiles: true,
        createRoot: false,
        initGit: false,
        installDeps: false,
        withSonar: true,
        withCoderabbit: true,
        generatedAt: Date.now()
      }),
      startedAt: Date.now(),
      updatedAt: Date.now(),
      resolvedAt: Date.now(),
      lastAssistantMessageId: null,
      lastUserMessageId: null
    };
    const service = createService(root, configPath, {
      assistSessionRepository: {
        getById: (id: string) => (id === session.id ? session : null),
        getLatestByWorkspaceId: () => session,
        findOpenByWorkspaceId: () => null,
        listByWorkspaceId: () => [session],
        update: () => {
          throw new Error("update should not be called for a resolved session");
        }
      },
      assistMessageRepository: {
        listBySessionId: () => []
      }
    });

    try {
      expect(() => service.resolveAssistSession({ sessionId: session.id })).toThrowError(AppError);
      expect(service.showAssistSession(session.id).recommendedNextCommand).toContain("workspace:assist");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("adds the managed worktree ignore entry during workspace init", () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-workspace-setup-"));
    const configPath = createRuntimeConfig(root);

    try {
      const result = createService(root, configPath).init({
        createRoot: false,
        initGit: false,
        dryRun: false
      });
      expect(result.actions.some((action: { id: string; status: string }) => action.id === "ensure-beerengineer-worktrees-gitignore")).toBe(
        true
      );
      expect(readFileSync(join(root, ".gitignore"), "utf8")).toContain(".beerengineer/");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("upgrades legacy worktree-only gitignore entries to the runtime-wide ignore rule", () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-workspace-setup-"));
    const configPath = createRuntimeConfig(root);
    writeFileSync(join(root, ".gitignore"), ".beerengineer/worktrees/\nnode_modules/\n", "utf8");

    try {
      createService(root, configPath).init({
        createRoot: false,
        initGit: false,
        dryRun: false
      });

      const gitignore = readFileSync(join(root, ".gitignore"), "utf8");
      expect(gitignore).toContain(".beerengineer/\n");
      expect(gitignore).not.toContain(".beerengineer/worktrees/");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
