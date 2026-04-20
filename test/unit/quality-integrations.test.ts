import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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

  it("accepts sonar CLI auth as an integration fallback while keeping live scans degraded without a token", () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-quality-"));
    const dbPath = join(root, "app.sqlite");
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
    process.env.PATH = previousPath ? `${binDir}${process.platform === "win32" ? ";" : ":"}${previousPath}` : binDir;
    const context = createAppContext(dbPath, { workspaceRoot: root });

    try {
      context.services.sonarService.setConfig({
        hostUrl: "https://sonarcloud.io",
        organization: "silviobeer",
        projectKey: "silviobeer_beerengineer"
      });

      const shown = context.services.sonarService.showConfig();
      const preflight = context.services.sonarService.preflight();
      const tested = context.services.sonarService.testConfig();
      const sonarContext = context.services.sonarService.context();

      expect(shown.config.configured).toBe(true);
      expect(shown.config.authSource).toBe("sonar_cli");
      expect(shown.config.authCliLoggedIn).toBe(true);
      expect(tested.valid).toBe(true);
      expect(preflight.ready).toBe(false);
      expect(preflight.checks.authCliLoggedIn).toBe(true);
      expect(preflight.errors).toContain("token is missing for live sonar-scanner runs");
      expect(preflight.warnings.some((warning) => warning.includes("falls back to fixture-backed Sonar data"))).toBe(true);
      expect(sonarContext.scannerInvocation.command).toBe("sonar-scanner");
    } finally {
      process.env.PATH = previousPath;
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("derives branch-aware Sonar context from the current BeerEngineer git branch", () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-quality-"));
    const dbPath = join(root, "app.sqlite");
    writeFileSync(join(root, "README.md"), "# test\n", "utf8");
    execFileSync("git", ["init", "-b", "main"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "Test User"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["add", "README.md"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["branch", "proj/ITEM-0001-P01"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["checkout", "-b", "story/ITEM-0001-P01/ITEM-0001-P01-US01"], { cwd: root, stdio: "ignore" });
    const context = createAppContext(dbPath, { workspaceRoot: root });

    try {
      context.services.sonarService.setConfig({
        hostUrl: "https://sonarcloud.io",
        organization: "silviobeer",
        projectKey: "silviobeer_beerengineer",
        token: "secret-token",
        defaultBranch: "main"
      });

      const branchContext = context.services.sonarService.context().branchContext;
      const scannerInvocation = context.services.sonarService.context().scannerInvocation;
      const scan = context.services.sonarService.scan();

      expect(branchContext.branchName).toBe("story/ITEM-0001-P01/ITEM-0001-P01-US01");
      expect(branchContext.branchRole).toBe("story");
      expect(branchContext.analysisTarget).toBe("branch");
      expect(scannerInvocation.args.some((value) => value.includes("sonar.branch.name=story/ITEM-0001-P01/ITEM-0001-P01-US01"))).toBe(true);
      expect(scannerInvocation.args.some((value) => value.includes("sonar.branch.target="))).toBe(false);
      expect(scan.execution.analysisTarget).toBe("branch");
      expect(scan.execution.fallbackReason).toContain("not requested");
    } finally {
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("prefers pull-request Sonar context when PR environment variables are present", () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-quality-"));
    const dbPath = join(root, "app.sqlite");
    writeFileSync(join(root, "README.md"), "# test\n", "utf8");
    execFileSync("git", ["init", "-b", "main"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "Test User"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["add", "README.md"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["checkout", "-b", "fix/ITEM-0001-P01-US01/review-1"], { cwd: root, stdio: "ignore" });
    const previousPr = process.env.GITHUB_PR_NUMBER;
    const previousBase = process.env.GITHUB_BASE_REF;
    process.env.GITHUB_PR_NUMBER = "42";
    process.env.GITHUB_BASE_REF = "main";
    const context = createAppContext(dbPath, { workspaceRoot: root });

    try {
      context.services.sonarService.setConfig({
        hostUrl: "https://sonarcloud.io",
        organization: "silviobeer",
        projectKey: "silviobeer_beerengineer",
        token: "secret-token",
        defaultBranch: "main"
      });

      const branchContext = context.services.sonarService.preflight().branchContext;
      const scannerInvocation = context.services.sonarService.context().scannerInvocation;
      expect(branchContext.branchRole).toBe("story-remediation");
      expect(branchContext.analysisTarget).toBe("pull_request");
      expect(branchContext.pullRequestKey).toBe("42");
      expect(branchContext.baseBranch).toBe("main");
      expect(scannerInvocation.args.some((value) => value.includes("sonar.pullrequest.key=42"))).toBe(true);
      expect(scannerInvocation.args.some((value) => value.includes("sonar.pullrequest.base=main"))).toBe(true);
    } finally {
      process.env.GITHUB_PR_NUMBER = previousPr;
      process.env.GITHUB_BASE_REF = previousBase;
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts CodeRabbit CLI auth, infers repository context from git remote origin, and stays ready for live reviews", () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-quality-"));
    const dbPath = join(root, "app.sqlite");
    const binDir = join(root, "bin");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(root, "README.md"), "# test\n", "utf8");
    execFileSync("git", ["init", "-b", "main"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "Test User"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["add", "README.md"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["remote", "add", "origin", "git@github.com:silviobeer/beerengineer.git"], { cwd: root, stdio: "ignore" });

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
    process.env.PATH = previousPath ? `${binDir}${process.platform === "win32" ? ";" : ":"}${previousPath}` : binDir;
    delete process.env.GITHUB_PR_NUMBER;
    delete process.env.GITHUB_BASE_REF;
    const context = createAppContext(dbPath, { workspaceRoot: root });

    try {
      context.services.coderabbitService.setConfig({
        hostUrl: "https://api.coderabbit.ai",
        defaultBranch: "main"
      });

      const shown = context.services.coderabbitService.showConfig();
      const tested = context.services.coderabbitService.testConfig();
      const preflight = context.services.coderabbitService.preflight();
      const coderabbitContext = context.services.coderabbitService.context();

      expect(shown.config.organization).toBe("silviobeer");
      expect(shown.config.repository).toBe("beerengineer");
      expect(shown.config.repositorySource).toBe("git");
      expect(shown.config.authSource).toBe("coderabbit_cli");
      expect(tested.valid).toBe(true);
      expect(preflight.ready).toBe(true);
      expect(preflight.checks.authCliLoggedIn).toBe(true);
      expect(coderabbitContext.branchContext.analysisTarget).toBe("main");
      expect(coderabbitContext.reviewInvocation.command).toBe("cr");
      expect(coderabbitContext.reviewInvocation.args).toContain("--base");
      expect(coderabbitContext.reviewInvocation.args).toContain("main");
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
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("runs a live CodeRabbit review in agent mode and persists findings as quality knowledge", () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-quality-"));
    const dbPath = join(root, "app.sqlite");
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
        ? "@echo off\r\nif \"%1 %2\"==\"auth status\" (\r\necho {\"authenticated\":true}\r\nexit /b 0\r\n)\r\nif \"%1 %2\"==\"review --agent\" (\r\necho {\"type\":\"review_context\",\"branch\":\"story/ITEM-0001-P01/ITEM-0001-P01-US01\"}\r\necho {\"type\":\"finding\",\"severity\":\"major\",\"fileName\":\"src/app.ts\",\"message\":\"Guard nullish state transitions\",\"codegenInstructions\":\"Add a branch-specific null guard\"}\r\necho {\"type\":\"complete\"}\r\nexit /b 0\r\n)\r\nexit /b 0\r\n"
        : "#!/bin/sh\nif [ \"$1 $2\" = \"auth status\" ]; then\n  printf '%s\\n' '{\"authenticated\":true}'\n  exit 0\nfi\nif [ \"$1 $2\" = \"review --agent\" ]; then\n  printf '%s\\n' '{\"type\":\"review_context\",\"branch\":\"story/ITEM-0001-P01/ITEM-0001-P01-US01\"}'\n  printf '%s\\n' '{\"type\":\"finding\",\"severity\":\"major\",\"fileName\":\"src/app.ts\",\"message\":\"Guard nullish state transitions\",\"codegenInstructions\":\"Add a branch-specific null guard\"}'\n  printf '%s\\n' '{\"type\":\"complete\"}'\n  exit 0\nfi\nexit 0\n";
    const coderabbitPath = join(binDir, `cr${binaryExtension}`);
    writeFileSync(coderabbitPath, scriptBody, "utf8");
    if (process.platform !== "win32") {
      chmodSync(coderabbitPath, 0o755);
    }

    const previousPath = process.env.PATH;
    const previousPr = process.env.GITHUB_PR_NUMBER;
    const previousBase = process.env.GITHUB_BASE_REF;
    process.env.PATH = previousPath ? `${binDir}${process.platform === "win32" ? ";" : ":"}${previousPath}` : binDir;
    delete process.env.GITHUB_PR_NUMBER;
    delete process.env.GITHUB_BASE_REF;
    const context = createAppContext(dbPath, { workspaceRoot: root });

    try {
      context.services.coderabbitService.setConfig({
        hostUrl: "https://api.coderabbit.ai",
        organization: "silviobeer",
        repository: "beerengineer",
        defaultBranch: "main"
      });

      const review = context.services.coderabbitService.review({
        storyCode: "ITEM-0001-P01-US01",
        filePaths: ["src/app.ts"],
        modules: ["src/app"],
        live: true
      });

      expect(review.execution.mode).toBe("live");
      expect(review.findings).toHaveLength(1);
      expect(review.findings[0]?.title).toBe("Guard nullish state transitions");
      expect(review.findings[0]?.normalizedSeverity).toBe("high");
      expect(review.knowledgeEntries).toHaveLength(1);
      expect(context.repositories.qualityKnowledgeEntryRepository.listByWorkspaceId(context.workspace.id).some((entry) => entry.source === "coderabbit")).toBe(true);
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
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
