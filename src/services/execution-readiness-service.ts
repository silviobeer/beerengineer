import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import type {
  ExecutionReadinessAction,
  ExecutionReadinessFinding,
  ExecutionReadinessFindingClassification,
  ExecutionReadinessFindingSeverity,
  ExecutionReadinessFindingStatus,
  ExecutionReadinessRun,
  ExecutionReadinessRunStatus,
  Project,
  Wave,
  UserStory,
  WorkspaceSettings
} from "../domain/types.js";
import { AppError } from "../shared/errors.js";

type CoreProfileKey = "node-next-playwright" | "unknown";

export type CoreReadinessCommand = {
  label: "build" | "typecheck" | "e2e";
  command: string[];
  cwd: string;
};

export type CoreReadinessFinding = {
  code: string;
  doctorCategory: "executionReadiness" | "dependencyTooling" | "appBuild" | "typecheck" | "e2eReadiness";
  severity: ExecutionReadinessFindingSeverity;
  scopeType: string;
  scopePath: string | null;
  summary: string;
  detail: string;
  detectedBy: string;
  classification: ExecutionReadinessFindingClassification;
  recommendedAction: string | null;
  isAutoFixable: boolean;
  status: Exclude<ExecutionReadinessFindingStatus, "resolved">;
};

export type CoreReadinessActionPlan = {
  actionType: string;
  initiator: "engine_rule";
  command: string[];
  cwd: string;
};

export type CoreReadinessReport = {
  status: ExecutionReadinessRunStatus;
  profileKey: CoreProfileKey;
  workspaceRoot: string;
  canonicalCommands: CoreReadinessCommand[];
  findings: CoreReadinessFinding[];
};

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type ReadinessInputSnapshot = {
  workspaceRoot: string;
  projectId: string;
  waveId: string | null;
  storyId: string | null;
  appTestConfigJson: string | null;
  watchedPaths: Array<{
    path: string;
    state: string;
  }>;
};

type ExecutionReadinessRepositories = {
  runRepository: {
    create(input: Omit<ExecutionReadinessRun, "id" | "startedAt" | "updatedAt" | "completedAt">): ExecutionReadinessRun;
    getById(id: string): ExecutionReadinessRun | null;
    getLatestByProjectId(projectId: string): ExecutionReadinessRun | null;
    findLatestReusable(input: {
      projectId: string;
      waveId: string | null;
      storyId: string | null;
      workspaceRoot: string;
      inputSnapshotJson: string;
    }): ExecutionReadinessRun | null;
    update(
      id: string,
      input: Partial<Pick<ExecutionReadinessRun, "status" | "summaryJson" | "errorMessage" | "completedAt">>
    ): void;
  };
  findingRepository: {
    createMany(input: Omit<ExecutionReadinessFinding, "id" | "createdAt" | "updatedAt">[]): ExecutionReadinessFinding[];
    listByRunId(runId: string): ExecutionReadinessFinding[];
    listLatestByRunId(runId: string): ExecutionReadinessFinding[];
    markByIterationResolved(runId: string, checkIteration: number): void;
  };
  actionRepository: {
    create(input: Omit<ExecutionReadinessAction, "id" | "createdAt" | "updatedAt">): ExecutionReadinessAction;
    listByRunId(runId: string): ExecutionReadinessAction[];
    update(
      id: string,
      input: Partial<
        Pick<ExecutionReadinessAction, "status" | "stdout" | "stderr" | "exitCode" | "startedAt" | "completedAt">
      >
    ): void;
  };
};

const executionReadinessReuseMaxAgeMs = 15 * 60 * 1000;

export class ExecutionReadinessCoreService {
  public inspect(input: { workspaceRoot: string; workspaceSettings: Pick<WorkspaceSettings, "appTestConfigJson"> }): CoreReadinessReport {
    const findings: CoreReadinessFinding[] = [];
    const canonicalCommands: CoreReadinessCommand[] = [];
    const workspaceRoot = input.workspaceRoot;

    if (!existsSync(workspaceRoot)) {
      findings.push({
        code: "workspace_root_missing",
        doctorCategory: "executionReadiness",
        severity: "error",
        scopeType: "workspace",
        scopePath: workspaceRoot,
        summary: "The resolved workspace root does not exist.",
        detail: `BeerEngineer resolved ${workspaceRoot} as the execution root, but that path is missing.`,
        detectedBy: "core.workspace_root",
        classification: "manual_blocker",
        recommendedAction: "Configure a valid workspace root before starting execution.",
        isAutoFixable: false,
        status: "manual"
      });
      return { status: "blocked", profileKey: "unknown", workspaceRoot, canonicalCommands, findings };
    }

    if (!existsSync(resolve(workspaceRoot, ".git"))) {
      findings.push({
        code: "workspace_not_git_repo",
        doctorCategory: "executionReadiness",
        severity: "error",
        scopeType: "workspace",
        scopePath: workspaceRoot,
        summary: "The target workspace is not a git repository.",
        detail: "Execution branches and worktrees require a real git repository at the resolved workspace root.",
        detectedBy: "core.git",
        classification: "manual_blocker",
        recommendedAction: "Initialize or point BeerEngineer at the correct git workspace before execution.",
        isAutoFixable: false,
        status: "manual"
      });
    }

    const profileKey = existsSync(resolve(workspaceRoot, "apps/ui", "package.json")) ? "node-next-playwright" : "unknown";
    if (profileKey === "unknown") {
      findings.push({
        code: "unsupported_readiness_profile",
        doctorCategory: "executionReadiness",
        severity: "error",
        scopeType: "workspace",
        scopePath: workspaceRoot,
        summary: "BeerEngineer could not resolve a supported execution readiness profile.",
        detail: "The current implementation expects a Next.js UI project at apps/ui for deterministic execution readiness checks.",
        detectedBy: "core.profile",
        classification: "manual_blocker",
        recommendedAction: "Add a supported workspace profile or configure the project layout that matches node-next-playwright.",
        isAutoFixable: false,
        status: "manual"
      });
      return {
        status: findings.some((finding) => finding.isAutoFixable) ? "auto_fixable" : "blocked",
        profileKey,
        workspaceRoot,
        canonicalCommands,
        findings
      };
    }

    const appRoot = resolve(workspaceRoot, "apps/ui");
    const appManifestPath = resolve(appRoot, "package.json");
    const appTsconfigPath = resolve(appRoot, "tsconfig.json");
    canonicalCommands.push(
      { label: "build", command: ["npm", "--prefix", "apps/ui", "run", "build"], cwd: workspaceRoot },
      {
        label: "typecheck",
        command: ["npm", "--prefix", "apps/ui", "exec", "tsc", "--", "-p", "tsconfig.json", "--noEmit"],
        cwd: workspaceRoot
      }
    );

    if (!existsSync(appManifestPath)) {
      findings.push({
        code: "workspace_manifest_missing",
        doctorCategory: "executionReadiness",
        severity: "error",
        scopeType: "project",
        scopePath: appManifestPath,
        summary: "The apps/ui package manifest is missing.",
        detail: "The node-next-playwright profile requires apps/ui/package.json to resolve build and verification commands.",
        detectedBy: "profile.node-next-playwright.manifest",
        classification: "manual_blocker",
        recommendedAction: "Restore apps/ui/package.json or configure a different readiness profile.",
        isAutoFixable: false,
        status: "manual"
      });
    }

    if (!existsSync(appTsconfigPath)) {
      findings.push({
        code: "typecheck_config_missing",
        doctorCategory: "typecheck",
        severity: "error",
        scopeType: "project",
        scopePath: appTsconfigPath,
        summary: "The TypeScript project configuration for apps/ui is missing.",
        detail: "BeerEngineer cannot run the canonical typecheck command without apps/ui/tsconfig.json.",
        detectedBy: "profile.node-next-playwright.typecheck",
        classification: "manual_blocker",
        recommendedAction: "Restore apps/ui/tsconfig.json before execution.",
        isAutoFixable: false,
        status: "manual"
      });
    }

    const appNodeModulesPath = resolve(appRoot, "node_modules");
    const nextBinaryPath = resolve(appNodeModulesPath, ".bin", "next");
    const tscBinaryPath = resolve(appNodeModulesPath, ".bin", "tsc");

    if (!existsSync(appNodeModulesPath)) {
      findings.push({
        code: "node_modules_missing",
        doctorCategory: "dependencyTooling",
        severity: "error",
        scopeType: "project",
        scopePath: appNodeModulesPath,
        summary: "The apps/ui dependency tree is missing.",
        detail: "The target worktree does not contain apps/ui/node_modules, so the Next.js toolchain is not runnable.",
        detectedBy: "profile.node-next-playwright.dependencies",
        classification: "auto_fixable",
        recommendedAction: "Run npm --prefix apps/ui install.",
        isAutoFixable: true,
        status: "auto_fixable"
      });
    }

    if (!existsSync(nextBinaryPath)) {
      findings.push({
        code: "next_binary_missing",
        doctorCategory: "dependencyTooling",
        severity: "error",
        scopeType: "project",
        scopePath: nextBinaryPath,
        summary: "The Next.js binary is not available in apps/ui.",
        detail: "BeerEngineer expects apps/ui/node_modules/.bin/next for the canonical build command.",
        detectedBy: "profile.node-next-playwright.dependencies",
        classification: "auto_fixable",
        recommendedAction: "Run npm --prefix apps/ui install.",
        isAutoFixable: true,
        status: "auto_fixable"
      });
    }

    if (!existsSync(tscBinaryPath)) {
      findings.push({
        code: "typescript_binary_missing",
        doctorCategory: "typecheck",
        severity: "error",
        scopeType: "project",
        scopePath: tscBinaryPath,
        summary: "The TypeScript compiler is not available in apps/ui.",
        detail: "BeerEngineer expects apps/ui/node_modules/.bin/tsc for the canonical typecheck command.",
        detectedBy: "profile.node-next-playwright.dependencies",
        classification: "auto_fixable",
        recommendedAction: "Run npm --prefix apps/ui install.",
        isAutoFixable: true,
        status: "auto_fixable"
      });
    }

    const appTestConfig = this.parseAppTestConfig(input.workspaceSettings.appTestConfigJson);
    const runnerPreference = Array.isArray(appTestConfig?.runnerPreference) ? appTestConfig.runnerPreference : [];
    if (runnerPreference.includes("playwright")) {
      const packageJson = this.safeReadJson(appManifestPath);
      const hasPlaywrightDependency = Boolean(
        packageJson &&
          typeof packageJson === "object" &&
          packageJson !== null &&
          (this.hasDependency(packageJson, "@playwright/test") || this.hasDependency(packageJson, "playwright"))
      );
      canonicalCommands.push({
        label: "e2e",
        command: ["npm", "--prefix", "apps/ui", "exec", "playwright", "--", "--version"],
        cwd: workspaceRoot
      });
      if (!hasPlaywrightDependency) {
        findings.push({
          code: "playwright_missing",
          doctorCategory: "e2eReadiness",
          severity: "error",
          scopeType: "project",
          scopePath: appManifestPath,
          summary: "Playwright is configured as a preferred runner but is not installed in apps/ui.",
          detail: "The workspace app test configuration requests Playwright, but apps/ui/package.json has no Playwright dependency.",
          detectedBy: "profile.node-next-playwright.e2e",
          classification: "manual_blocker",
          recommendedAction: "Add a Playwright dependency or remove Playwright from runnerPreference.",
          isAutoFixable: false,
          status: "manual"
        });
      }
    }

    if (!findings.some((finding) => finding.code === "node_modules_missing" || finding.code === "next_binary_missing")) {
      const buildResult = this.runCommand(canonicalCommands[0]!);
      if (buildResult.exitCode !== 0) {
        findings.push({
          code: "build_command_failed",
          doctorCategory: "appBuild",
          severity: "error",
          scopeType: "project",
          scopePath: appRoot,
          summary: "The canonical UI build command failed.",
          detail: this.formatCommandFailure(canonicalCommands[0]!, buildResult),
          detectedBy: "profile.node-next-playwright.build",
          classification: "llm_fixable",
          recommendedAction: "Fix the build failure or run bounded readiness remediation on the UI config/code paths.",
          isAutoFixable: false,
          status: "manual"
        });
      }
    }

    if (!findings.some((finding) => finding.code === "node_modules_missing" || finding.code === "typescript_binary_missing")) {
      const typecheckCommand = canonicalCommands.find((command) => command.label === "typecheck");
      if (typecheckCommand) {
        const typecheckResult = this.runCommand(typecheckCommand);
        if (typecheckResult.exitCode !== 0) {
          findings.push({
            code: "typecheck_failed",
            doctorCategory: "typecheck",
            severity: "error",
            scopeType: "project",
            scopePath: appRoot,
            summary: "The canonical UI typecheck command failed.",
            detail: this.formatCommandFailure(typecheckCommand, typecheckResult),
            detectedBy: "profile.node-next-playwright.typecheck",
            classification: "llm_fixable",
            recommendedAction: "Fix the TypeScript/config errors before execution continues.",
            isAutoFixable: false,
            status: "manual"
          });
        }
      }
    }

    return {
      status: this.deriveStatus(findings),
      profileKey,
      workspaceRoot,
      canonicalCommands,
      findings
    };
  }

  public planDeterministicActions(report: CoreReadinessReport): CoreReadinessActionPlan[] {
    const plans: CoreReadinessActionPlan[] = [];
    if (
      report.findings.some((finding) =>
        ["node_modules_missing", "next_binary_missing", "typescript_binary_missing"].includes(finding.code)
      )
    ) {
      plans.push({
        actionType: "install_ui_dependencies",
        initiator: "engine_rule",
        command: ["npm", "--prefix", "apps/ui", "install"],
        cwd: report.workspaceRoot
      });
    }
    return plans;
  }

  private deriveStatus(findings: CoreReadinessFinding[]): ExecutionReadinessRunStatus {
    if (findings.length === 0) {
      return "ready";
    }
    return findings.every((finding) => finding.isAutoFixable) ? "auto_fixable" : "blocked";
  }

  private parseAppTestConfig(raw: string | null): { runnerPreference?: string[] } | null {
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as { runnerPreference?: string[] };
      return typeof parsed === "object" && parsed !== null ? parsed : null;
    } catch {
      return null;
    }
  }

  private safeReadJson(path: string): Record<string, unknown> | null {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private hasDependency(packageJson: Record<string, unknown>, dependency: string): boolean {
    return this.hasKeyedDependency(packageJson.dependencies, dependency) || this.hasKeyedDependency(packageJson.devDependencies, dependency);
  }

  private hasKeyedDependency(value: unknown, dependency: string): boolean {
    return typeof value === "object" && value !== null && dependency in value;
  }

  private runCommand(command: CoreReadinessCommand): CommandResult {
    const result = spawnSync(command.command[0]!, command.command.slice(1), {
      cwd: command.cwd,
      encoding: "utf8",
      timeout: 300000,
      maxBuffer: 1024 * 1024
    });
    if (result.error) {
      throw result.error;
    }
    return {
      exitCode: result.status ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? ""
    };
  }

  private formatCommandFailure(command: CoreReadinessCommand, result: CommandResult): string {
    const stderr = result.stderr.trim();
    const stdout = result.stdout.trim();
    const output = stderr || stdout || "No command output was captured.";
    return `Command \`${command.command.join(" ")}\` failed with exit code ${result.exitCode}. ${output.slice(0, 2000)}`;
  }
}

export class ExecutionReadinessService {
  private readonly core = new ExecutionReadinessCoreService();

  public constructor(
    private readonly repositories: ExecutionReadinessRepositories,
    private readonly workspaceRoot: string,
    private readonly workspaceSettings: Pick<WorkspaceSettings, "appTestConfigJson">
  ) {}

  public runForProject(input: {
    project: Project;
    wave?: Wave | null;
    story?: UserStory | null;
    workspaceRoot?: string;
    allowDeterministicRemediation?: boolean;
  }) {
    const targetWorkspaceRoot = input.workspaceRoot ?? this.workspaceRoot;
    const inputSnapshot = this.buildInputSnapshot({
      projectId: input.project.id,
      waveId: input.wave?.id ?? null,
      storyId: input.story?.id ?? null,
      workspaceRoot: targetWorkspaceRoot
    });
    const inputSnapshotJson = JSON.stringify(inputSnapshot, null, 2);
    const reusableRun = this.repositories.runRepository.findLatestReusable({
      projectId: input.project.id,
      waveId: input.wave?.id ?? null,
      storyId: input.story?.id ?? null,
      workspaceRoot: targetWorkspaceRoot,
      inputSnapshotJson
    });
    if (reusableRun && this.isReusableRunFresh(reusableRun)) {
      return this.show(reusableRun.id);
    }

    const run = this.repositories.runRepository.create({
      projectId: input.project.id,
      waveId: input.wave?.id ?? null,
      storyId: input.story?.id ?? null,
      status: "running",
      profileKey: "unknown",
      workspaceRoot: targetWorkspaceRoot,
      inputSnapshotJson,
      summaryJson: null,
      errorMessage: null
    });

    try {
      const report = this.core.inspect({
        workspaceRoot: targetWorkspaceRoot,
        workspaceSettings: this.workspaceSettings
      });
      const firstIteration = 1;
      this.persistFindings(run.id, firstIteration, report.findings);

      let latestReport = report;
      if (report.status === "auto_fixable" && input.allowDeterministicRemediation !== false) {
        const plannedActions = this.core.planDeterministicActions(report);
        for (const actionPlan of plannedActions) {
          this.runDeterministicAction(run.id, firstIteration, actionPlan);
        }

        this.repositories.findingRepository.markByIterationResolved(run.id, firstIteration);
        latestReport = this.core.inspect({
          workspaceRoot: targetWorkspaceRoot,
          workspaceSettings: this.workspaceSettings
        });
        this.persistFindings(run.id, firstIteration + 1, latestReport.findings);
      }

      this.repositories.runRepository.update(run.id, {
        status: latestReport.status,
        summaryJson: JSON.stringify(
          {
            status: latestReport.status,
            profileKey: latestReport.profileKey,
            workspaceRoot: latestReport.workspaceRoot,
            canonicalCommands: latestReport.canonicalCommands,
            findingCount: latestReport.findings.length
          },
          null,
          2
        ),
        completedAt: Date.now(),
        errorMessage: null
      });
    } catch (error) {
      this.repositories.runRepository.update(run.id, {
        status: "failed",
        completedAt: Date.now(),
        errorMessage: error instanceof Error ? error.message : String(error)
      });
    }

    return this.show(run.id);
  }

  public show(runId: string) {
    const run = this.repositories.runRepository.getById(runId);
    if (!run) {
      throw new AppError("EXECUTION_READINESS_RUN_NOT_FOUND", `Execution readiness run ${runId} not found.`);
    }
    return {
      run,
      latestFindings: this.repositories.findingRepository.listLatestByRunId(runId),
      findings: this.repositories.findingRepository.listByRunId(runId),
      actions: this.repositories.actionRepository.listByRunId(runId)
    };
  }

  public showLatestByProjectId(projectId: string) {
    const run = this.repositories.runRepository.getLatestByProjectId(projectId);
    return run ? this.show(run.id) : null;
  }

  private persistFindings(runId: string, checkIteration: number, findings: CoreReadinessFinding[]): void {
    this.repositories.findingRepository.createMany(
      findings.map((finding) => ({
        runId,
        checkIteration,
        code: finding.code,
        severity: finding.severity,
        scopeType: finding.scopeType,
        scopePath: finding.scopePath,
        summary: finding.summary,
        detail: finding.detail,
        detectedBy: finding.detectedBy,
        classification: finding.classification,
        recommendedAction: finding.recommendedAction,
        isAutoFixable: finding.isAutoFixable,
        status: finding.status
      }))
    );
  }

  private runDeterministicAction(runId: string, checkIteration: number, plan: CoreReadinessActionPlan): void {
    const startedAt = Date.now();
    const action = this.repositories.actionRepository.create({
      runId,
      checkIteration,
      actionType: plan.actionType,
      initiator: plan.initiator,
      commandJson: JSON.stringify(plan.command),
      cwd: plan.cwd,
      status: "pending",
      stdout: null,
      stderr: null,
      exitCode: null,
      startedAt: null,
      completedAt: null
    });
    this.repositories.actionRepository.update(action.id, {
      status: "running",
      startedAt
    });

    try {
      const result = spawnSync(plan.command[0]!, plan.command.slice(1), {
        cwd: plan.cwd,
        encoding: "utf8",
        timeout: 600000,
        maxBuffer: 1024 * 1024
      });
      if (result.error) {
        throw result.error;
      }
      const completedAt = Date.now();
      this.repositories.actionRepository.update(action.id, {
        status: result.status === 0 ? "completed" : "failed",
        stdout: this.truncateCapturedOutput(result.stdout ?? ""),
        stderr: this.truncateCapturedOutput(result.stderr ?? ""),
        exitCode: result.status ?? 1,
        completedAt
      });
    } catch (error) {
      this.repositories.actionRepository.update(action.id, {
        status: "failed",
        stderr: this.truncateCapturedOutput(error instanceof Error ? error.message : String(error)),
        completedAt: Date.now()
      });
      throw error;
    }
  }

  private buildInputSnapshot(input: {
    projectId: string;
    waveId: string | null;
    storyId: string | null;
    workspaceRoot: string;
  }): ReadinessInputSnapshot {
    const watchedPaths = [
      ".git",
      "apps/ui/package.json",
      "apps/ui/tsconfig.json",
      "apps/ui/node_modules",
      "apps/ui/node_modules/.bin/next",
      "apps/ui/node_modules/.bin/tsc"
    ].map((relativePath) => {
      const absolutePath = resolve(input.workspaceRoot, relativePath);
      return {
        path: relativePath,
        state: this.describePathState(absolutePath)
      };
    });
    return {
      workspaceRoot: input.workspaceRoot,
      projectId: input.projectId,
      waveId: input.waveId,
      storyId: input.storyId,
      appTestConfigJson: this.workspaceSettings.appTestConfigJson ?? null,
      watchedPaths
    };
  }

  private describePathState(path: string): string {
    if (!existsSync(path)) {
      return "missing";
    }
    const stat = statSync(path);
    if (stat.isDirectory()) {
      return `dir:${stat.size}:${Math.trunc(stat.mtimeMs)}`;
    }
    const contentHash = createHash("sha1").update(readFileSync(path)).digest("hex").slice(0, 12);
    return `file:${stat.size}:${Math.trunc(stat.mtimeMs)}:${contentHash}`;
  }

  private truncateCapturedOutput(output: string): string {
    return output.length > 4000 ? `${output.slice(0, 4000)}\n...[truncated]` : output;
  }

  private isReusableRunFresh(run: ExecutionReadinessRun): boolean {
    const completedAt = run.completedAt ?? run.updatedAt;
    return Date.now() - completedAt <= executionReadinessReuseMaxAgeMs;
  }
}
