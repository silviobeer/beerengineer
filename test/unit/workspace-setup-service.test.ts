import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
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

  it("names the Sonar CLIs explicitly in doctor runtime checks", () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-workspace-setup-"));
    const configPath = createRuntimeConfig(root);

    try {
      const report = createService(root, configPath).doctor();
      const sonarCliCheck = report.checks.runtime.find((check: { id: string }) => check.id === "sonar-binary") as
        | { message: string; status: string }
        | undefined;
      const sonarCheck = report.checks.runtime.find((check: { id: string }) => check.id === "sonar-scanner-binary") as
        | { message: string; status: string }
        | undefined;
      expect(sonarCliCheck?.message).toContain("SonarQube CLI");
      expect(sonarCliCheck?.message).toContain("sonar");
      expect(sonarCheck?.message).toContain("SonarScanner CLI");
      expect(sonarCheck?.message).toContain("sonar-scanner");
      if (sonarCliCheck?.status !== "ok") {
        expect(report.suggestedActions.some((action: string) => action.includes("SonarQube CLI"))).toBe(true);
      }
      if (sonarCheck?.status !== "ok") {
        expect(report.suggestedActions.some((action: string) => action.includes("SonarScanner CLI"))).toBe(true);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("names agent-browser, Playwright, GitHub CLI, and CodeRabbit explicitly in doctor runtime checks", () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-workspace-setup-"));
    const configPath = createRuntimeConfig(root);

    try {
      const report = createService(root, configPath).doctor();
      const runtimeChecks = report.checks.runtime as Array<{ id: string; message: string; status: string }>;
      const ghCheck = runtimeChecks.find((check) => check.id === "gh-binary");
      const agentBrowserCheck = runtimeChecks.find((check) => check.id === "agent-browser-binary");
      const playwrightCheck = runtimeChecks.find((check) => check.id === "playwright-binary");
      const coderabbitCheck = runtimeChecks.find((check) => check.id === "coderabbit-binary");

      expect(ghCheck?.message).toContain("GitHub CLI");
      expect(ghCheck?.message).toContain("gh");
      expect(agentBrowserCheck?.message).toContain("Agent Browser CLI");
      expect(agentBrowserCheck?.message).toContain("agent-browser");
      expect(playwrightCheck?.message).toContain("Playwright CLI");
      expect(playwrightCheck?.message).toContain("npx playwright");
      expect(coderabbitCheck?.message).toContain("CodeRabbit CLI");

      if (ghCheck?.status !== "ok") {
        expect(report.suggestedActions.some((action: string) => action.includes("GitHub CLI"))).toBe(true);
      }
      if (agentBrowserCheck?.status !== "ok") {
        expect(report.suggestedActions.some((action: string) => action.includes("Agent Browser CLI"))).toBe(true);
      }
      if (playwrightCheck?.status !== "ok") {
        expect(report.suggestedActions.some((action: string) => action.includes("npx playwright"))).toBe(true);
      }
      if (coderabbitCheck?.status !== "ok") {
        expect(report.suggestedActions.some((action: string) => action.includes("CodeRabbit CLI"))).toBe(true);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("detects PATH binaries and local playwright CLI without relying on which", () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-workspace-setup-"));
    const configPath = createRuntimeConfig(root);
    const binDir = join(root, "bin");
    const playwrightBinDir = join(root, "node_modules", ".bin");
    mkdirSync(binDir, { recursive: true });
    mkdirSync(playwrightBinDir, { recursive: true });

    const binaryExtension = process.platform === "win32" ? ".cmd" : "";
    const scriptBody = process.platform === "win32" ? "@echo off\r\nexit /b 0\r\n" : "#!/bin/sh\nexit 0\n";
    for (const binary of ["gh", "agent-browser", "cr", "sonar", "sonar-scanner"]) {
      const binaryPath = join(binDir, `${binary}${binaryExtension}`);
      writeFileSync(binaryPath, scriptBody, "utf8");
      if (process.platform !== "win32") {
        chmodSync(binaryPath, 0o755);
      }
    }
    const playwrightPath = join(playwrightBinDir, `playwright${binaryExtension}`);
    writeFileSync(playwrightPath, scriptBody, "utf8");
    if (process.platform !== "win32") {
      chmodSync(playwrightPath, 0o755);
    }

    const previousPath = process.env.PATH;
    const previousPathExt = process.env.PATHEXT;

    try {
      process.env.PATH = previousPath ? `${binDir}${process.platform === "win32" ? ";" : ":"}${previousPath}` : binDir;
      if (process.platform === "win32") {
        process.env.PATHEXT = ".COM;.EXE;.BAT;.CMD";
      }

      const report = createService(root, configPath).doctor();
      const runtimeChecks = report.checks.runtime as Array<{ id: string; status: string }>;
      expect(runtimeChecks.find((check) => check.id === "gh-binary")?.status).toBe("ok");
      expect(runtimeChecks.find((check) => check.id === "agent-browser-binary")?.status).toBe("ok");
      expect(runtimeChecks.find((check) => check.id === "coderabbit-binary")?.status).toBe("ok");
      expect(runtimeChecks.find((check) => check.id === "sonar-binary")?.status).toBe("ok");
      expect(runtimeChecks.find((check) => check.id === "sonar-scanner-binary")?.status).toBe("ok");
      expect(runtimeChecks.find((check) => check.id === "playwright-binary")?.status).toBe("ok");
    } finally {
      process.env.PATH = previousPath;
      if (process.platform === "win32") {
        process.env.PATHEXT = previousPathExt;
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("recognizes CodeRabbit CLI auth and current-branch live review readiness in doctor", () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-workspace-setup-"));
    const configPath = createRuntimeConfig(root);
    const binDir = join(root, "bin");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(root, "README.md"), "# test\n", "utf8");
    execFileSync("git", ["init", "-b", "main"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "Test User"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["add", "README.md"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["remote", "add", "origin", "git@github.com:silviobeer/beerengineer.git"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["checkout", "-b", "story/ITEM-0001-P01/ITEM-0001-P01-US01"], { cwd: root, stdio: "ignore" });

    const binaryExtension = process.platform === "win32" ? ".cmd" : "";
    const scriptBody =
      process.platform === "win32"
        ? "@echo off\r\nif \"%1 %2\"==\"auth status\" (\r\necho {\"authenticated\":true}\r\nexit /b 0\r\n)\r\nexit /b 0\r\n"
        : "#!/bin/sh\nif [ \"$1 $2\" = \"auth status\" ]; then\n  printf '%s\\n' '{\"authenticated\":true}'\n  exit 0\nfi\nexit 0\n";
    const coderabbitPath = join(binDir, `cr${binaryExtension}`);
    writeFileSync(coderabbitPath, scriptBody, "utf8");
    if (process.platform !== "win32") {
      chmodSync(coderabbitPath, 0o755);
    }

    const previousPath = process.env.PATH;
    const previousPr = process.env.GITHUB_PR_NUMBER;
    const previousBase = process.env.GITHUB_BASE_REF;

    try {
      process.env.PATH = previousPath ? `${binDir}${process.platform === "win32" ? ";" : ":"}${previousPath}` : binDir;
      delete process.env.GITHUB_PR_NUMBER;
      delete process.env.GITHUB_BASE_REF;
      const report = createService(root, configPath, {
        coderabbitSettings: {
          workspaceId: "workspace_1",
          enabled: 1,
          providerType: "coderabbit",
          hostUrl: "https://api.coderabbit.ai",
          organization: "silviobeer",
          repository: "beerengineer",
          token: null,
          defaultBranch: "main",
          gatingMode: "advisory",
          validationStatus: "untested",
          lastTestedAt: null,
          lastError: null,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      }).doctor();
      const integrationChecks = report.checks.integrations as Array<{ id: string; status: string; message: string }>;
      expect(integrationChecks.find((check) => check.id === "coderabbit-config")?.status).toBe("ok");
      expect(integrationChecks.find((check) => check.id === "coderabbit-config")?.message).toContain("`cr auth login`");
      expect(integrationChecks.find((check) => check.id === "coderabbit-live-review")?.status).toBe("ok");
      expect(integrationChecks.find((check) => check.id === "coderabbit-live-review")?.message).toContain("branch");
    } finally {
      process.env.PATH = previousPath;
      if (previousPr === undefined) {
        delete process.env.GITHUB_PR_NUMBER;
      } else {
        process.env.GITHUB_PR_NUMBER = previousPr;
      }
      if (previousBase === undefined) {
        delete process.env.GITHUB_BASE_REF;
      } else {
        process.env.GITHUB_BASE_REF = previousBase;
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("checks all supported MCP harness configs for an agent-browser server entry", () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-workspace-setup-"));
    const configPath = createRuntimeConfig(root);
    const binDir = join(root, "bin");
    mkdirSync(binDir, { recursive: true });

    const binaryExtension = process.platform === "win32" ? ".cmd" : "";
    const scriptBody = process.platform === "win32" ? "@echo off\r\nexit /b 0\r\n" : "#!/bin/sh\nexit 0\n";
    const agentBrowserPath = join(binDir, `agent-browser${binaryExtension}`);
    writeFileSync(agentBrowserPath, scriptBody, "utf8");
    if (process.platform !== "win32") {
      chmodSync(agentBrowserPath, 0o755);
    }

    const previousPath = process.env.PATH;
    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    const previousAppData = process.env.APPDATA;

    try {
      process.env.PATH = previousPath ? `${binDir}${process.platform === "win32" ? ";" : ":"}${previousPath}` : binDir;
      process.env.HOME = root;
      process.env.USERPROFILE = root;
      process.env.APPDATA = join(root, "AppData", "Roaming");

      const claudeConfigPath = join(root, ".mcp.json");
      mkdirSync(root, { recursive: true });
      writeFileSync(
        claudeConfigPath,
        JSON.stringify({
          mcpServers: {
            "agent-browser": {
              command: "agent-browser",
              args: ["mcp"]
            }
          }
        }),
        "utf8"
      );

      const cursorConfigPath = join(root, ".cursor", "mcp.json");
      mkdirSync(join(root, ".cursor"), { recursive: true });
      writeFileSync(
        cursorConfigPath,
        JSON.stringify({
          mcpServers: {
            "agent-browser": {
              command: "agent-browser",
              args: ["mcp"]
            }
          }
        }),
        "utf8"
      );

      const report = createService(root, configPath).doctor();
      const integrationChecks = report.checks.integrations as Array<{ id: string; status: string; message: string }>;
      expect(integrationChecks.find((check) => check.id === "mcp-claude-agent-browser")?.status).toBe("ok");
      expect(integrationChecks.find((check) => check.id === "mcp-cursor-agent-browser")?.status).toBe("ok");
      expect(integrationChecks.find((check) => check.id === "mcp-opencode-agent-browser")?.status).toBe("warning");
      expect(integrationChecks.find((check) => check.id === "mcp-codex-agent-browser")?.status).toBe("warning");
    } finally {
      process.env.PATH = previousPath;
      process.env.HOME = previousHome;
      process.env.USERPROFILE = previousUserProfile;
      process.env.APPDATA = previousAppData;
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

  it("keeps bootstrap running when an MCP target config is malformed", () => {
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
    writeFileSync(join(root, ".mcp.json"), "{ invalid json", "utf8");

    try {
      const result = createService(root, configPath).bootstrap({
        stack: "node-ts",
        scaffoldProjectFiles: false,
        createRoot: false,
        initGit: false,
        installDeps: false,
        withSonar: false,
        withCoderabbit: false,
        mcpTargets: ["claude", "cursor"],
        dryRun: false
      });

      const claudeAction = result.actions.find((action: { id: string }) => action.id === "bootstrap-mcp-claude") as
        | { status: string; message: string }
        | undefined;
      const cursorAction = result.actions.find((action: { id: string }) => action.id === "bootstrap-mcp-cursor") as
        | { status: string }
        | undefined;

      expect(claudeAction?.status).toBe("blocked");
      expect(claudeAction?.message).toContain("Failed to configure");
      expect(cursorAction?.status).toBe("created");
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

  it("surfaces the suggested runtime profile and whether it is already applied", () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-workspace-setup-"));
    const configPath = createRuntimeConfig(root);
    const session = {
      id: "workspace_assist_session_1",
      workspaceId: "workspace_1",
      status: "open",
      currentPlanJson: JSON.stringify({
        version: 1,
        workspaceKey: "hello-world",
        rootPath: root,
        runtimeProfileKey: "codex_primary",
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
      resolvedAt: null,
      lastAssistantMessageId: null,
      lastUserMessageId: null
    };
    const service = createService(root, configPath, {
      workspaceSettings: {
        runtimeProfileJson: JSON.stringify({
          version: 1,
          profileKey: "codex_primary"
        })
      },
      assistSessionRepository: {
        getById: (id: string) => (id === session.id ? session : null),
        getLatestByWorkspaceId: () => session,
        findOpenByWorkspaceId: () => session,
        listByWorkspaceId: () => [session],
        update: () => session
      },
      assistMessageRepository: {
        listBySessionId: () => []
      }
    });

    try {
      expect(service.showAssistSession(session.id).runtimeProfile).toEqual({
        suggestedProfileKey: "codex_primary",
        appliedProfileKey: "codex_primary",
        alreadyApplied: true
      });
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

  it("treats stored Sonar project config plus sonar CLI auth as configured integration", () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-workspace-setup-"));
    const configPath = createRuntimeConfig(root);
    const binDir = join(root, "bin");
    mkdirSync(binDir, { recursive: true });

    const binaryExtension = process.platform === "win32" ? ".cmd" : "";
    const scriptBody =
      process.platform === "win32"
        ? "@echo off\r\nif \"%1 %2\"==\"auth status\" exit /b 0\r\nexit /b 0\r\n"
        : "#!/bin/sh\nif [ \"$1 $2\" = \"auth status\" ]; then\n  exit 0\nfi\nexit 0\n";
    const sonarPath = join(binDir, `sonar${binaryExtension}`);
    writeFileSync(sonarPath, scriptBody, "utf8");
    if (process.platform !== "win32") {
      chmodSync(sonarPath, 0o755);
    }

    const previousPath = process.env.PATH;

    try {
      process.env.PATH = previousPath ? `${binDir}${process.platform === "win32" ? ";" : ":"}${previousPath}` : binDir;
      const report = createService(root, configPath, {
        sonarSettings: {
          workspaceId: "workspace_1",
          enabled: 1,
          providerType: "sonarcloud",
          hostUrl: "https://sonarcloud.io",
          organization: "silviobeer",
          projectKey: "silviobeer_beerengineer",
          token: null,
          defaultBranch: "main",
          gatingMode: "advisory",
          validationStatus: "untested",
          lastTestedAt: null,
          lastError: null,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      }).doctor();

      const sonarConfigCheck = (report.checks.integrations as Array<{ id: string; status: string; message: string }>).find(
        (check) => check.id === "sonar-config"
      );
      expect(sonarConfigCheck?.status).toBe("ok");
      expect(sonarConfigCheck?.message).toContain("sonar auth login");
    } finally {
      process.env.PATH = previousPath;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports Sonar live-scan readiness for the current story branch", () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-workspace-setup-"));
    const configPath = createRuntimeConfig(root);
    const binDir = join(root, "bin");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(root, "README.md"), "# test\n", "utf8");
    execFileSync("git", ["init", "-b", "main"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "Test User"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["add", "README.md"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["checkout", "-b", "story/ITEM-0001-P01/ITEM-0001-P01-US01"], { cwd: root, stdio: "ignore" });

    const binaryExtension = process.platform === "win32" ? ".cmd" : "";
    const scriptBody = process.platform === "win32" ? "@echo off\r\nexit /b 0\r\n" : "#!/bin/sh\nexit 0\n";
    for (const binary of ["java", "sonar-scanner"]) {
      const binaryPath = join(binDir, `${binary}${binaryExtension}`);
      writeFileSync(binaryPath, scriptBody, "utf8");
      if (process.platform !== "win32") {
        chmodSync(binaryPath, 0o755);
      }
    }

    const previousPath = process.env.PATH;

    try {
      process.env.PATH = previousPath ? `${binDir}${process.platform === "win32" ? ";" : ":"}${previousPath}` : binDir;
      const report = createService(root, configPath, {
        sonarSettings: {
          workspaceId: "workspace_1",
          enabled: 1,
          providerType: "sonarcloud",
          hostUrl: "https://sonarcloud.io",
          organization: "silviobeer",
          projectKey: "silviobeer_beerengineer",
          token: "secret-token",
          defaultBranch: "main",
          gatingMode: "advisory",
          validationStatus: "untested",
          lastTestedAt: null,
          lastError: null,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      }).doctor();
      const sonarLiveCheck = (report.checks.integrations as Array<{ id: string; status: string; message: string }>).find(
        (check) => check.id === "sonar-live-scan"
      );
      expect(sonarLiveCheck?.status).toBe("ok");
      expect(sonarLiveCheck?.message).toContain("story/ITEM-0001-P01/ITEM-0001-P01-US01");
    } finally {
      process.env.PATH = previousPath;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports Sonar live-scan as not ready when branch context or scanner prerequisites are missing", () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-workspace-setup-"));
    const configPath = createRuntimeConfig(root);

    try {
      const report = createService(root, configPath, {
        sonarSettings: {
          workspaceId: "workspace_1",
          enabled: 1,
          providerType: "sonarcloud",
          hostUrl: "https://sonarcloud.io",
          organization: "silviobeer",
          projectKey: "silviobeer_beerengineer",
          token: null,
          defaultBranch: "main",
          gatingMode: "advisory",
          validationStatus: "untested",
          lastTestedAt: null,
          lastError: null,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      }).doctor();
      const sonarLiveCheck = (report.checks.integrations as Array<{ id: string; status: string; message: string }>).find(
        (check) => check.id === "sonar-live-scan"
      );
      expect(sonarLiveCheck?.status).toBe("warning");
      expect(sonarLiveCheck?.message).toContain("not ready");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
