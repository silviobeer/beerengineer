import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { z } from "zod";

import type {
  Project,
  UserStory,
  VerificationReadinessAction,
  VerificationReadinessFinding,
  VerificationReadinessFindingClassification,
  VerificationReadinessFindingSeverity,
  VerificationReadinessFindingStatus,
  VerificationReadinessRun,
  VerificationReadinessRunStatus,
  Wave,
  WorkspaceSettings
} from "../domain/types.js";
import { AppError } from "../shared/errors.js";
import { resolveWorkspaceBrowserUrl } from "../shared/workspace-browser-url.js";

const appTestConfigSchema = z.object({
  baseUrl: z.string().min(1).optional(),
  runnerPreference: z.array(z.enum(["agent_browser", "playwright"])).min(1).optional(),
  readiness: z.object({
    healthUrl: z.string().min(1).optional(),
    command: z.string().min(1).optional(),
    timeoutMs: z.number().int().positive().optional()
  }).nullable().optional(),
  routes: z.record(z.string(), z.string().min(1)).optional()
});

type VerificationProfileKey = "node-next-browser-verification" | "unknown";

type ParsedAppTestConfig = {
  baseUrl: string;
  runnerPreference: Array<"agent_browser" | "playwright">;
  readiness: {
    healthUrl?: string;
    command?: string;
    timeoutMs?: number;
  } | null;
  routes: Record<string, string>;
  source: "workspace_settings" | "engine_default";
};

type CoreVerificationFinding = {
  code: string;
  doctorCategory: "browserVerification" | "agentBrowser" | "playwrightSetup" | "uiServerContract";
  severity: VerificationReadinessFindingSeverity;
  scopeType: string;
  scopePath: string | null;
  summary: string;
  detail: string;
  detectedBy: string;
  classification: VerificationReadinessFindingClassification;
  recommendedAction: string | null;
  isAutoFixable: boolean;
  status: Exclude<VerificationReadinessFindingStatus, "resolved">;
};

type CoreVerificationActionPlan = {
  actionType: string;
  initiator: "engine_rule";
  command: string[];
  cwd: string;
};

type CoreVerificationReport = {
  status: VerificationReadinessRunStatus;
  profileKey: VerificationProfileKey;
  workspaceRoot: string;
  findings: CoreVerificationFinding[];
  resolvedBaseUrl: string | null;
  resolvedRoute: string | null;
  runnerPreference: Array<"agent_browser" | "playwright">;
};

type BinaryProbeResult = {
  available: boolean;
  timedOut: boolean;
  detail: string | null;
};

type ParsedAppTestConfigResult =
  | { ok: true; config: ParsedAppTestConfig }
  | { ok: false; detail: string; fallbackConfig: ParsedAppTestConfig };

const verificationReadinessReuseMaxAgeMs = 15 * 60 * 1000;

type VerificationInputSnapshot = {
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

type VerificationReadinessRepositories = {
  runRepository: {
    create(input: Omit<VerificationReadinessRun, "id" | "startedAt" | "updatedAt" | "completedAt">): VerificationReadinessRun;
    getById(id: string): VerificationReadinessRun | null;
    getLatestByProjectId(projectId: string): VerificationReadinessRun | null;
    findLatestReusable(input: {
      projectId: string;
      waveId: string | null;
      storyId: string | null;
      workspaceRoot: string;
      inputSnapshotJson: string;
    }): VerificationReadinessRun | null;
    update(
      id: string,
      input: Partial<Pick<VerificationReadinessRun, "status" | "summaryJson" | "errorMessage" | "completedAt">>
    ): void;
  };
  findingRepository: {
    createMany(input: Omit<VerificationReadinessFinding, "id" | "createdAt" | "updatedAt">[]): VerificationReadinessFinding[];
    listByRunId(runId: string): VerificationReadinessFinding[];
    listLatestByRunId(runId: string): VerificationReadinessFinding[];
    markByIterationResolved(runId: string, checkIteration: number): void;
  };
  actionRepository: {
    create(input: Omit<VerificationReadinessAction, "id" | "createdAt" | "updatedAt">): VerificationReadinessAction;
    listByRunId(runId: string): VerificationReadinessAction[];
    update(
      id: string,
      input: Partial<
        Pick<VerificationReadinessAction, "status" | "stdout" | "stderr" | "exitCode" | "startedAt" | "completedAt">
      >
    ): void;
  };
};

export class VerificationReadinessCoreService {
  public inspect(input: {
    workspaceRoot: string;
    workspaceSettings: Pick<WorkspaceSettings, "appTestConfigJson">;
    story: UserStory;
    workspaceKey: string;
    skipBinaryProbes?: boolean;
  }): CoreVerificationReport {
    const findings: CoreVerificationFinding[] = [];
    const workspaceRoot = input.workspaceRoot;
    const appRoot = resolve(workspaceRoot, "apps/ui");
    const appManifestPath = resolve(appRoot, "package.json");

    if (!existsSync(workspaceRoot)) {
      findings.push({
        code: "workspace_root_missing",
        doctorCategory: "browserVerification",
        severity: "error",
        scopeType: "workspace",
        scopePath: workspaceRoot,
        summary: "The resolved workspace root for UI verification is missing.",
        detail: `BeerEngineer resolved ${workspaceRoot} as the verification root, but that path does not exist.`,
        detectedBy: "verification.core.workspace_root",
        classification: "manual_blocker",
        recommendedAction: "Point the project at a valid workspace or story worktree before execution.",
        isAutoFixable: false,
        status: "manual"
      });
      return {
        status: "blocked",
        profileKey: "unknown",
        workspaceRoot,
        findings,
        resolvedBaseUrl: null,
        resolvedRoute: null,
        runnerPreference: []
      };
    }

    const profileKey = existsSync(appManifestPath) ? "node-next-browser-verification" : "unknown";
    if (profileKey === "unknown") {
      findings.push({
        code: "unsupported_verification_profile",
        doctorCategory: "browserVerification",
        severity: "error",
        scopeType: "workspace",
        scopePath: appRoot,
        summary: "BeerEngineer could not resolve a supported browser verification profile.",
        detail: "The current implementation expects a Next.js UI project at apps/ui for deterministic verification readiness checks.",
        detectedBy: "verification.core.profile",
        classification: "manual_blocker",
        recommendedAction: "Configure a supported UI workspace profile before running browser-verified stories.",
        isAutoFixable: false,
        status: "manual"
      });
      return {
        status: "blocked",
        profileKey,
        workspaceRoot,
        findings,
        resolvedBaseUrl: null,
        resolvedRoute: null,
        runnerPreference: []
      };
    }

    const workspaceBrowserUrl = resolveWorkspaceBrowserUrl(input.workspaceKey);
    const appConfigResult = this.parseAppTestConfig(input.workspaceSettings.appTestConfigJson, workspaceBrowserUrl);
    if (!appConfigResult.ok) {
      findings.push({
        code: "app_test_config_invalid",
        doctorCategory: "browserVerification",
        severity: "error",
        scopeType: "workspace_settings",
        scopePath: null,
        summary: "WorkspaceSettings.appTestConfigJson is invalid for browser verification.",
        detail: appConfigResult.detail,
        detectedBy: "verification.contract.parse",
        classification: "manual_blocker",
        recommendedAction: "Fix appTestConfigJson so baseUrl, runnerPreference and readiness are valid JSON fields.",
        isAutoFixable: false,
        status: "manual"
      });
    }
    const appConfig = appConfigResult.ok ? appConfigResult.config : appConfigResult.fallbackConfig;
    const packageJson = this.safeReadJson(appManifestPath);
    const resolvedRoute = appConfig.routes[input.story.code] ?? appConfig.routes.default ?? "/";
    const parsedBaseUrl = this.parseBaseUrl(appConfig.baseUrl);
    const dedicatedPortOkay = parsedBaseUrl?.port !== "3000";
    const playwrightConfigPath = this.findPlaywrightConfig(workspaceRoot);
    const playwrightConfigSource = playwrightConfigPath ? readFileSync(playwrightConfigPath, "utf8") : null;
    const testsRoot = this.findFirstExistingPath([resolve(appRoot, "tests"), resolve(appRoot, "tests", "e2e"), resolve(appRoot, "e2e")]);

    if (!parsedBaseUrl) {
      findings.push({
        code: "app_test_baseurl_invalid",
        doctorCategory: "browserVerification",
        severity: "error",
        scopeType: "workspace_settings",
        scopePath: null,
        summary: "The UI verification baseUrl is not a valid URL.",
        detail: `The resolved app test baseUrl "${appConfig.baseUrl}" is not parseable as a URL.`,
        detectedBy: "verification.contract.baseurl",
        classification: "manual_blocker",
        recommendedAction: "Configure a valid dedicated localhost baseUrl in WorkspaceSettings.appTestConfigJson.",
        isAutoFixable: false,
        status: "manual"
      });
    } else {
      if (!["127.0.0.1", "localhost"].includes(parsedBaseUrl.hostname)) {
        findings.push({
          code: "app_test_baseurl_not_localhost",
          doctorCategory: "browserVerification",
          severity: "error",
          scopeType: "workspace_settings",
          scopePath: null,
          summary: "The UI verification baseUrl must resolve to localhost.",
          detail: `The resolved baseUrl ${appConfig.baseUrl} is not a localhost URL.`,
          detectedBy: "verification.contract.baseurl",
          classification: "manual_blocker",
          recommendedAction: "Assign a dedicated localhost URL for the project browser contract.",
          isAutoFixable: false,
          status: "manual"
        });
      }
      if (!dedicatedPortOkay) {
        findings.push({
          code: "app_test_baseurl_uses_shared_port_3000",
          doctorCategory: "uiServerContract",
          severity: "error",
          scopeType: "workspace_settings",
          scopePath: null,
          summary: "The UI verification contract may not use shared port 3000.",
          detail: "Port 3000 is intentionally rejected here because multiple local projects compete for it. Use a dedicated localhost URL such as http://127.0.0.1:3100.",
          detectedBy: "verification.contract.baseurl",
          classification: "manual_blocker",
          recommendedAction: "Assign a dedicated non-3000 localhost URL in WorkspaceSettings.appTestConfigJson.",
          isAutoFixable: false,
          status: "manual"
        });
      }
    }

    if (!resolvedRoute.startsWith("/")) {
      findings.push({
        code: "story_route_invalid",
        doctorCategory: "browserVerification",
        severity: "error",
        scopeType: "story",
        scopePath: input.story.code,
        summary: "The UI verification route for the story is invalid.",
        detail: `The resolved route "${resolvedRoute}" must start with "/".`,
        detectedBy: "verification.contract.route",
        classification: "manual_blocker",
        recommendedAction: "Add a valid story route in WorkspaceSettings.appTestConfigJson.routes.",
        isAutoFixable: false,
        status: "manual"
      });
    }

    if (!playwrightConfigPath) {
      findings.push({
        code: "playwright_config_missing",
        doctorCategory: "playwrightSetup",
        severity: "error",
        scopeType: "project",
        scopePath: appRoot,
        summary: "The UI project has no Playwright configuration.",
        detail: "BeerEngineer requires apps/ui/playwright.config.* for deterministic browser verification fallback and server orchestration.",
        detectedBy: "verification.playwright.config",
        classification: "manual_blocker",
        recommendedAction: "Add apps/ui/playwright.config.ts that matches the central app test contract.",
        isAutoFixable: false,
        status: "manual"
      });
    }

    const hasPlaywrightDependency = Boolean(
      packageJson &&
        typeof packageJson === "object" &&
        packageJson !== null &&
        (this.hasDependency(packageJson, "@playwright/test") || this.hasDependency(packageJson, "playwright"))
    );
    const playwrightBinaryPath = resolve(appRoot, "node_modules", ".bin", "playwright");
    if (appConfig.runnerPreference.includes("playwright")) {
      if (!hasPlaywrightDependency) {
        findings.push({
          code: "playwright_dependency_missing",
          doctorCategory: "playwrightSetup",
          severity: "error",
          scopeType: "project",
          scopePath: appManifestPath,
          summary: "Playwright is required but not declared in apps/ui/package.json.",
          detail: "The current runner preference includes Playwright, but apps/ui/package.json has no Playwright dependency.",
          detectedBy: "verification.playwright.dependency",
          classification: "manual_blocker",
          recommendedAction: "Add @playwright/test to apps/ui or remove Playwright from runnerPreference.",
          isAutoFixable: false,
          status: "manual"
        });
      } else if (!this.isExecutableFile(playwrightBinaryPath)) {
        findings.push({
          code: "playwright_cli_missing",
          doctorCategory: "playwrightSetup",
          severity: "error",
          scopeType: "project",
          scopePath: playwrightBinaryPath,
          summary: "The Playwright CLI is not installed in apps/ui.",
          detail: "The dependency is declared, but apps/ui/node_modules/.bin/playwright is missing in the target worktree.",
          detectedBy: "verification.playwright.cli",
          classification: "auto_fixable",
          recommendedAction: "Run npm --prefix apps/ui install.",
          isAutoFixable: true,
          status: "auto_fixable"
        });
      }
    }

    if (!testsRoot) {
      findings.push({
        code: "playwright_test_path_missing",
        doctorCategory: "playwrightSetup",
        severity: "error",
        scopeType: "project",
        scopePath: appRoot,
        summary: "The UI project has no verifiable Playwright test path.",
        detail: "Expected apps/ui/tests, apps/ui/tests/e2e or apps/ui/e2e so that browser verification can resolve a deterministic test target.",
        detectedBy: "verification.playwright.tests",
        classification: "manual_blocker",
        recommendedAction: "Add a maintained Playwright test path under apps/ui.",
        isAutoFixable: false,
        status: "manual"
      });
    }

    const hasReadinessCommand = Boolean(appConfig.readiness?.command);
    const hasPlaywrightWebServer = Boolean(playwrightConfigSource && /webServer\s*:\s*\{[^}]*command\s*:/ms.test(playwrightConfigSource));
    if (!hasReadinessCommand && !hasPlaywrightWebServer) {
      findings.push({
        code: "ui_server_contract_missing",
        doctorCategory: "uiServerContract",
        severity: "error",
        scopeType: "workspace_settings",
        scopePath: playwrightConfigPath ?? appRoot,
        summary: "The UI verification server contract is missing.",
        detail: "BeerEngineer could not find a central readiness.command or a Playwright webServer.command, so it cannot start the UI app deterministically before browser verification.",
        detectedBy: "verification.server_contract",
        classification: "manual_blocker",
        recommendedAction: "Define readiness.command in appTestConfigJson or add webServer.command in Playwright config.",
        isAutoFixable: false,
        status: "manual"
      });
    }
    if (playwrightConfigSource && parsedBaseUrl) {
      const configuredPlaywrightBaseUrl = this.extractConfiguredStringLiteral(playwrightConfigSource, "baseURL");
      const configuredPlaywrightServerUrl = this.extractWebServerUrl(playwrightConfigSource);
      const explicitMismatch =
        (configuredPlaywrightBaseUrl !== null &&
          !configuredPlaywrightBaseUrl.includes("${") &&
          configuredPlaywrightBaseUrl !== appConfig.baseUrl) ||
        (configuredPlaywrightServerUrl !== null &&
          !configuredPlaywrightServerUrl.includes("${") &&
          configuredPlaywrightServerUrl !== appConfig.baseUrl);
      if (explicitMismatch) {
        findings.push({
          code: "playwright_baseurl_mismatch",
          doctorCategory: "uiServerContract",
          severity: "error",
          scopeType: "project",
          scopePath: playwrightConfigPath,
          summary: "Playwright is not aligned with the central app test baseUrl.",
          detail: `The central browser contract resolves to ${appConfig.baseUrl}, but the Playwright config does not reference that URL.`,
          detectedBy: "verification.server_contract",
          classification: "manual_blocker",
          recommendedAction: "Align Playwright baseURL/webServer.url with WorkspaceSettings.appTestConfigJson.baseUrl.",
          isAutoFixable: false,
          status: "manual"
        });
      }
    }

    const playwrightProbe =
      !input.skipBinaryProbes &&
      appConfig.runnerPreference.includes("playwright") &&
      this.isExecutableFile(playwrightBinaryPath)
        ? this.probeBinary(playwrightBinaryPath)
        : null;
    if (playwrightProbe && !playwrightProbe.available) {
      findings.push({
        code: "playwright_cli_unusable",
        doctorCategory: "playwrightSetup",
        severity: "error",
        scopeType: "project",
        scopePath: playwrightBinaryPath,
        summary: "The Playwright CLI exists but is not runnable.",
        detail: playwrightProbe.detail ?? "BeerEngineer could not execute the Playwright CLI in this workspace.",
        detectedBy: "verification.playwright.probe",
        classification: "manual_blocker",
        recommendedAction: "Repair or reinstall the Playwright CLI in apps/ui before execution continues.",
        isAutoFixable: false,
        status: "manual"
      });
    }

    const canUsePlaywrightFallback =
      appConfig.runnerPreference.includes("playwright") &&
      hasPlaywrightDependency &&
      this.isExecutableFile(playwrightBinaryPath) &&
      (playwrightProbe === null || playwrightProbe.available) &&
      Boolean(playwrightConfigPath);
    const agentBrowserProbe =
      !input.skipBinaryProbes && appConfig.runnerPreference.includes("agent_browser")
        ? this.probeBinary("agent-browser")
        : null;
    if (appConfig.runnerPreference.includes("agent_browser") && !(agentBrowserProbe?.available ?? false) && !canUsePlaywrightFallback) {
      findings.push({
        code: "agent_browser_unavailable",
        doctorCategory: "agentBrowser",
        severity: "error",
        scopeType: "runtime",
        scopePath: "agent-browser",
        summary: "The preferred agent_browser runner is not available.",
        detail:
          agentBrowserProbe?.detail ??
          "BeerEngineer could not resolve agent-browser on PATH, and no runnable Playwright fallback is available.",
        detectedBy: "verification.agent_browser",
        classification: "manual_blocker",
        recommendedAction: "Install/configure agent-browser or make Playwright runnable as fallback.",
        isAutoFixable: false,
        status: "manual"
      });
    }

    return {
      status: this.deriveStatus(findings),
      profileKey,
      workspaceRoot,
      findings,
      resolvedBaseUrl: parsedBaseUrl ? appConfig.baseUrl : null,
      resolvedRoute,
      runnerPreference: appConfig.runnerPreference
    };
  }

  public planDeterministicActions(report: CoreVerificationReport): CoreVerificationActionPlan[] {
    if (!report.findings.some((finding) => finding.code === "playwright_cli_missing")) {
      return [];
    }
    return [
      {
        actionType: "install_ui_dependencies",
        initiator: "engine_rule",
        command: ["npm", "--prefix", "apps/ui", "install"],
        cwd: report.workspaceRoot
      }
    ];
  }

  private deriveStatus(findings: CoreVerificationFinding[]): VerificationReadinessRunStatus {
    if (findings.length === 0) {
      return "ready";
    }
    return findings.every((finding) => finding.isAutoFixable) ? "auto_fixable" : "blocked";
  }

  private parseAppTestConfig(
    raw: string | null,
    workspaceBrowserUrl: ReturnType<typeof resolveWorkspaceBrowserUrl>
  ): ParsedAppTestConfigResult {
    const fallbackConfig: ParsedAppTestConfig = {
      baseUrl: workspaceBrowserUrl.baseUrl,
      runnerPreference: ["agent_browser", "playwright"],
      readiness: {
        command: workspaceBrowserUrl.readinessCommand
      },
      routes: {},
      source: "engine_default"
    };
    if (!raw) {
      return { ok: true, config: fallbackConfig };
    }
    try {
      const parsed = appTestConfigSchema.parse(JSON.parse(raw));
      return {
        ok: true,
        config: {
          baseUrl: parsed.baseUrl ?? workspaceBrowserUrl.baseUrl,
          runnerPreference: parsed.runnerPreference ?? ["agent_browser", "playwright"],
          readiness:
            parsed.readiness === undefined
              ? {
                  command: workspaceBrowserUrl.readinessCommand
                }
              : parsed.readiness,
          routes: parsed.routes ?? {},
          source: "workspace_settings"
        }
      };
    } catch (error) {
      return {
        ok: false,
        detail: `BeerEngineer could not parse the central app verification contract: ${error instanceof Error ? error.message : String(error)}`,
        fallbackConfig: {
          ...fallbackConfig,
          readiness: null
        }
      };
    }
  }

  private parseBaseUrl(value: string): URL | null {
    try {
      return new URL(value);
    } catch {
      return null;
    }
  }

  private findPlaywrightConfig(workspaceRoot: string): string | null {
    return this.findFirstExistingPath([
      resolve(workspaceRoot, "apps/ui/playwright.config.ts"),
      resolve(workspaceRoot, "apps/ui/playwright.config.mjs"),
      resolve(workspaceRoot, "apps/ui/playwright.config.js")
    ]);
  }

  private findFirstExistingPath(paths: string[]): string | null {
    return paths.find((candidate) => existsSync(candidate)) ?? null;
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

  private isExecutableFile(path: string): boolean {
    if (!existsSync(path)) {
      return false;
    }
    try {
      const stat = statSync(path);
      return stat.isFile() && (stat.mode & 0o111) !== 0;
    } catch {
      return false;
    }
  }

  private probeBinary(binary: string): BinaryProbeResult {
    const result = spawnSync(binary, ["--version"], {
      encoding: "utf8",
      timeout: 10000,
      maxBuffer: 64 * 1024
    });
    if (result.error) {
      const timedOut = result.signal === "SIGTERM";
      return {
        available: false,
        timedOut,
        detail: timedOut
          ? `Probe for ${binary} timed out after 10s.`
          : `Probe for ${binary} failed: ${result.error.message}`
      };
    }
    if (result.status !== 0) {
      return {
        available: false,
        timedOut: false,
        detail: `Probe for ${binary} exited with code ${result.status ?? "unknown"}.`
      };
    }
    return {
      available: true,
      timedOut: false,
      detail: null
    };
  }

  private extractConfiguredStringLiteral(source: string, property: "baseURL"): string | null {
    const match = source.match(new RegExp(`${property}\\s*:\\s*["'\`]([^"'\`]+)["'\`]`, "m"));
    return match?.[1] ?? null;
  }

  private extractWebServerUrl(source: string): string | null {
    const match = source.match(/webServer\s*:\s*\{[^}]*url\s*:\s*["'`]([^"'`]+)["'`]/ms);
    return match?.[1] ?? null;
  }
}

export class VerificationReadinessService {
  private readonly core = new VerificationReadinessCoreService();

  public constructor(
    private readonly repositories: VerificationReadinessRepositories,
    private readonly workspaceRoot: string,
    private readonly workspaceSettings: Pick<WorkspaceSettings, "appTestConfigJson">,
    private readonly workspaceKey: string
  ) {}

  public runForProject(input: {
    project: Project;
    wave?: Wave | null;
    story: UserStory;
    workspaceRoot?: string;
    allowDeterministicRemediation?: boolean;
  }) {
    const targetWorkspaceRoot = input.workspaceRoot ?? this.workspaceRoot;
    const inputSnapshot = this.buildInputSnapshot({
      projectId: input.project.id,
      waveId: input.wave?.id ?? null,
      storyId: input.story.id,
      workspaceRoot: targetWorkspaceRoot
    });
    const inputSnapshotJson = JSON.stringify(inputSnapshot, null, 2);
    const reusableRun = this.repositories.runRepository.findLatestReusable({
      projectId: input.project.id,
      waveId: input.wave?.id ?? null,
      storyId: input.story.id,
      workspaceRoot: targetWorkspaceRoot,
      inputSnapshotJson
    });
    if (reusableRun && this.isReusableRunFresh(reusableRun)) {
      return this.show(reusableRun.id);
    }

    const run = this.repositories.runRepository.create({
      projectId: input.project.id,
      waveId: input.wave?.id ?? null,
      storyId: input.story.id,
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
        workspaceSettings: this.workspaceSettings,
        story: input.story,
        workspaceKey: this.workspaceKey
      });
      this.persistFindings(run.id, 1, report.findings);

      let latestReport = report;
      if (report.status === "auto_fixable" && input.allowDeterministicRemediation !== false) {
        for (const actionPlan of this.core.planDeterministicActions(report)) {
          this.runDeterministicAction(run.id, 1, actionPlan);
        }
        this.repositories.findingRepository.markByIterationResolved(run.id, 1);
        latestReport = this.core.inspect({
          workspaceRoot: targetWorkspaceRoot,
          workspaceSettings: this.workspaceSettings,
          story: input.story,
          workspaceKey: this.workspaceKey
        });
        this.persistFindings(run.id, 2, latestReport.findings);
      }

      this.repositories.runRepository.update(run.id, {
        status: latestReport.status,
        summaryJson: JSON.stringify(
          {
            status: latestReport.status,
            profileKey: latestReport.profileKey,
            workspaceRoot: latestReport.workspaceRoot,
            runnerPreference: latestReport.runnerPreference,
            resolvedBaseUrl: latestReport.resolvedBaseUrl,
            resolvedRoute: latestReport.resolvedRoute,
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
      throw new AppError("VERIFICATION_READINESS_RUN_NOT_FOUND", `Verification readiness run ${runId} not found.`);
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

  private persistFindings(runId: string, checkIteration: number, findings: CoreVerificationFinding[]) {
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

  private runDeterministicAction(runId: string, checkIteration: number, plan: CoreVerificationActionPlan): void {
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
      this.repositories.actionRepository.update(action.id, {
        status: result.status === 0 ? "completed" : "failed",
        stdout: this.truncateCapturedOutput(result.stdout ?? ""),
        stderr: this.truncateCapturedOutput(result.stderr ?? ""),
        exitCode: result.status ?? 1,
        completedAt: Date.now()
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
    storyId: string;
    workspaceRoot: string;
  }): VerificationInputSnapshot {
    const watchedPaths = [
      ".git",
      "apps/ui/package.json",
      "apps/ui/playwright.config.ts",
      "apps/ui/playwright.config.js",
      "apps/ui/playwright.config.mjs",
      "apps/ui/tests",
      "apps/ui/tests/e2e",
      "apps/ui/node_modules",
      "apps/ui/node_modules/.bin/playwright"
    ].map((relativePath) => ({
      path: relativePath,
      state: this.describePathState(resolve(input.workspaceRoot, relativePath))
    }));
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

  private isReusableRunFresh(run: VerificationReadinessRun): boolean {
    const completedAt = run.completedAt ?? run.updatedAt;
    return Date.now() - completedAt <= verificationReadinessReuseMaxAgeMs;
  }
}
