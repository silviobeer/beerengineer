import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type {
  IntegrationValidationStatus,
  QualityDecisionStatus,
  QualityGatingMode,
  Workspace,
  WorkspaceSonarSettings
} from "../domain/types.js";
import type { QualityKnowledgeEntryRepository, WorkspaceSonarSettingsRepository } from "../persistence/repositories.js";
import { detectSonarCliState, type SonarCliState } from "../shared/sonar-cli.js";
import { parseDotEnv } from "./env-config.js";
import { QualityKnowledgeService } from "./quality-knowledge-service.js";

export type SonarConfigView = {
  enabled: boolean;
  providerType: string;
  hostUrl: string | null;
  organization: string | null;
  projectKey: string | null;
  hasToken: boolean;
  defaultBranch: string | null;
  gatingMode: QualityGatingMode;
  validationStatus: IntegrationValidationStatus;
  lastTestedAt: number | null;
  lastError: string | null;
  source: "db" | "env" | "none";
  projectConfigured: boolean;
  configured: boolean;
  authSource: "token" | "sonar_cli" | "none";
  authCliAvailable: boolean;
  authCliLoggedIn: boolean;
};

export type SonarIssueSummary = {
  key: string;
  severity: string;
  type: string;
  category: string;
  message: string;
  filePath: string | null;
  line: number | null;
  status: string;
};

export type SonarHotspotSummary = {
  key: string;
  severity: string;
  message: string;
  filePath: string | null;
  line: number | null;
  status: string;
};

export type SonarGateStatus = {
  status: QualityDecisionStatus;
  coverage: number | null;
  bugs: number | null;
  vulnerabilities: number | null;
  duplicatedLinesDensity: number | null;
  codeSmells: number | null;
  reasons: string[];
};

export type SonarScanResult = {
  config: SonarConfigView;
  branchContext: SonarBranchContext;
  scannerInvocation: SonarScannerInvocation;
  gate: SonarGateStatus;
  issues: SonarIssueSummary[];
  hotspots: SonarHotspotSummary[];
  findings: {
    issueCount: number;
    hotspotCount: number;
  };
  lessonsLearned: string[];
  futureGuardrails: string[];
  knowledgeEntries: ReturnType<QualityKnowledgeService["createEntries"]>;
  execution: {
    mode: "fixture" | "live";
    executed: boolean;
    analysisTarget: SonarBranchContext["analysisTarget"];
    attemptedLiveScan: boolean;
    fallbackReason: string | null;
  };
};

type SonarScanScopeInput = {
  projectId?: string | null;
  waveId?: string | null;
  storyId?: string | null;
  storyCode?: string | null;
  live?: boolean;
};

export type SonarBranchContext = {
  gitAvailable: boolean;
  gitRepository: boolean;
  branchName: string | null;
  baseBranch: string | null;
  defaultBranch: string | null;
  branchRole: "main" | "project" | "story" | "story-remediation" | "other" | null;
  analysisTarget: "none" | "main" | "branch" | "pull_request";
  pullRequestKey: string | null;
};

export type SonarScannerInvocation = {
  command: "sonar-scanner";
  args: string[];
  env: {
    usesSonarToken: boolean;
  };
};

export type SonarPreflightResult = {
  config: SonarConfigView;
  branchContext: SonarBranchContext;
  scannerInvocation: SonarScannerInvocation;
  warnings: string[];
  errors: string[];
  checks: {
    javaAvailable: boolean;
    scannerAvailable: boolean;
    authCliAvailable: boolean;
    authCliLoggedIn: boolean;
    tokenAvailable: boolean;
    projectConfigured: boolean;
    configured: boolean;
    liveScanReady: boolean;
  };
  ready: boolean;
};

export class SonarService {
  public constructor(
    private readonly workspace: Workspace,
    private readonly workspaceRoot: string,
    private readonly repository: WorkspaceSonarSettingsRepository,
    knowledgeRepository: QualityKnowledgeEntryRepository,
    private readonly repoRoot: string
  ) {
    this.knowledgeService = new QualityKnowledgeService(knowledgeRepository, workspace);
  }

  private readonly knowledgeService: QualityKnowledgeService;

  public showConfig(): { config: SonarConfigView; warnings: string[] } {
    return this.resolveEffectiveConfig();
  }

  public context(): {
    config: SonarConfigView;
    branchContext: SonarBranchContext;
    scannerInvocation: SonarScannerInvocation;
    warnings: string[];
  } {
    const { config, warnings } = this.resolveEffectiveConfig();
    const branchContext = this.resolveBranchContext(config.defaultBranch);
    return {
      config,
      branchContext,
      scannerInvocation: this.buildScannerInvocation(config, branchContext),
      warnings
    };
  }

  public preflight(): SonarPreflightResult {
    const { config, warnings } = this.resolveEffectiveConfig();
    const branchContext = this.resolveBranchContext(config.defaultBranch);
    const javaAvailable = this.isCommandAvailable("java");
    const scannerAvailable = this.isCommandAvailable("sonar-scanner");
    const tokenAvailable = config.hasToken;
    const projectConfigured = config.projectConfigured;
    const liveScanReady = projectConfigured && javaAvailable && scannerAvailable && tokenAvailable;
    const errors = [
      javaAvailable ? null : "java is missing",
      scannerAvailable ? null : "sonar-scanner is missing",
      tokenAvailable ? null : "token is missing for live sonar-scanner runs",
      projectConfigured ? null : "Sonar project configuration is incomplete"
    ].filter((value): value is string => Boolean(value));
    const runtimeWarnings = [...warnings];
    if (config.authCliLoggedIn && !config.hasToken) {
      runtimeWarnings.push("sonar CLI is logged in, but live sonar-scanner runs still require a workspace token.");
    }
    if (!liveScanReady) {
      runtimeWarnings.push("BeerEngineer falls back to fixture-backed Sonar data until the live scan toolchain is fully available.");
    }
    return {
      config,
      branchContext,
      scannerInvocation: this.buildScannerInvocation(config, branchContext),
      warnings: Array.from(new Set(runtimeWarnings)),
      errors,
      checks: {
        javaAvailable,
        scannerAvailable,
        authCliAvailable: config.authCliAvailable,
        authCliLoggedIn: config.authCliLoggedIn,
        tokenAvailable,
        projectConfigured,
        configured: config.configured,
        liveScanReady
      },
      ready: liveScanReady
    };
  }

  public setConfig(input: {
    enabled?: boolean;
    providerType?: string;
    hostUrl?: string | null;
    organization?: string | null;
    projectKey?: string | null;
    token?: string | null;
    defaultBranch?: string | null;
    gatingMode?: QualityGatingMode;
  }): { config: SonarConfigView } {
    const current = this.repository.getByWorkspaceId(this.workspace.id);
    const next = this.repository.upsertByWorkspaceId({
      workspaceId: this.workspace.id,
      enabled: Number(input.enabled ?? (current?.enabled ?? 1)),
      providerType: input.providerType ?? current?.providerType ?? "sonarcloud",
      hostUrl: input.hostUrl ?? current?.hostUrl ?? "https://sonarcloud.io",
      organization: input.organization ?? current?.organization ?? null,
      projectKey: input.projectKey ?? current?.projectKey ?? null,
      token: input.token === undefined ? current?.token ?? null : input.token,
      defaultBranch: input.defaultBranch ?? current?.defaultBranch ?? "main",
      gatingMode: input.gatingMode ?? current?.gatingMode ?? "advisory",
      validationStatus: "untested",
      lastError: null,
      lastTestedAt: null
    });
    return {
      config: this.maskConfig(next, "db", detectSonarCliState(this.workspaceRoot))
    };
  }

  public clearToken(): { config: SonarConfigView } {
    this.repository.clearToken(this.workspace.id);
    const updated = this.repository.getByWorkspaceId(this.workspace.id);
    return {
      config: this.maskConfig(updated, updated ? "db" : "none", detectSonarCliState(this.workspaceRoot))
    };
  }

  public testConfig(): { config: SonarConfigView; valid: boolean; warnings: string[]; errors: string[] } {
    const { config, warnings, storedConfig } = this.resolveEffectiveConfig();
    const errors = [
      !config.hostUrl ? "hostUrl is missing" : null,
      !config.organization ? "organization is missing" : null,
      !config.projectKey ? "projectKey is missing" : null,
      config.hasToken || config.authCliLoggedIn ? null : "authentication is missing (set a token or login via `sonar auth login`)"
    ].filter((value): value is string => Boolean(value));
    const valid = errors.length === 0;
    const testedAt = Date.now();
    const nextWarnings = [...warnings];
    if (config.authCliLoggedIn && !config.hasToken) {
      nextWarnings.push("Configuration is usable via sonar CLI auth, but live sonar-scanner runs still require a token.");
    }
    if (storedConfig) {
      this.repository.upsertByWorkspaceId({
        ...storedConfig,
        validationStatus: valid ? "valid" : "invalid",
        lastTestedAt: testedAt,
        lastError: valid ? null : errors.join("; ")
      });
    }
    return {
      config: {
        ...config,
        validationStatus: valid ? "valid" : "invalid",
        lastTestedAt: testedAt,
        lastError: valid ? null : errors.join("; ")
      },
      valid,
      warnings: Array.from(new Set(nextWarnings)),
      errors
    };
  }

  public status(): { config: SonarConfigView; branchContext: SonarBranchContext; gate: SonarGateStatus; warnings: string[] } {
    const { config, warnings } = this.resolveEffectiveConfig();
    return {
      config,
      branchContext: this.resolveBranchContext(config.defaultBranch),
      gate: this.loadGateStatus(),
      warnings
    };
  }

  public issues(): { config: SonarConfigView; branchContext: SonarBranchContext; issues: SonarIssueSummary[]; warnings: string[] } {
    const { config, warnings } = this.resolveEffectiveConfig();
    return {
      config,
      branchContext: this.resolveBranchContext(config.defaultBranch),
      issues: this.loadIssueSummaries(),
      warnings
    };
  }

  public hotspots(): { config: SonarConfigView; branchContext: SonarBranchContext; hotspots: SonarHotspotSummary[]; warnings: string[] } {
    const { config, warnings } = this.resolveEffectiveConfig();
    return {
      config,
      branchContext: this.resolveBranchContext(config.defaultBranch),
      hotspots: this.loadHotspotSummaries(),
      warnings
    };
  }

  public scan(input?: SonarScanScopeInput): SonarScanResult {
    const { config } = this.resolveEffectiveConfig();
    const branchContext = this.resolveBranchContext(config.defaultBranch);
    const scannerInvocation = this.buildScannerInvocation(config, branchContext);
    const liveScan = input?.live ? this.tryLiveScan(config, branchContext, scannerInvocation) : {
      mode: "fixture" as const,
      attempted: false,
      fallbackReason: "live Sonar scan was not requested"
    };
    const executionMode = liveScan.mode;
    const gate = this.loadGateStatus();
    const issues = this.loadIssueSummaries();
    const hotspots = this.loadHotspotSummaries();
    const lessonsLearned = [
      ...issues.slice(0, 5).map((issue) => `${issue.category}: ${issue.message}`),
      ...hotspots.slice(0, 3).map((hotspot) => `security hotspot: ${hotspot.message}`)
    ];
    const futureGuardrails = Array.from(
      new Set(
        issues
          .filter((issue) => issue.filePath)
          .map((issue) => `Recheck ${issue.filePath} for ${issue.category.toLowerCase()} regressions before merge.`)
      )
    ).slice(0, 5);

    const knowledgeEntries = this.knowledgeService.createEntries(
      issues.slice(0, 25).map((issue) => ({
        workspaceId: this.workspace.id,
        projectId: input?.projectId ?? null,
        waveId: input?.waveId ?? null,
        storyId: input?.storyId ?? null,
        source: "sonar" as const,
        scopeType: issue.filePath ? "file" : input?.storyId ? "story" : input?.projectId ? "project" : "workspace",
        scopeId: issue.filePath ?? input?.storyId ?? input?.projectId ?? this.workspace.id,
        kind: "recurring_issue" as const,
        summary: issue.message,
        evidenceJson: JSON.stringify(issue, null, 2),
        status: issue.status.toLowerCase(),
        relevanceTagsJson: JSON.stringify(
          {
            files: issue.filePath ? [issue.filePath] : [],
            storyCodes: input?.storyCode ? [input.storyCode] : [],
            modules: issue.filePath ? [issue.filePath.split("/").slice(0, 2).join("/")] : [],
            categories: [issue.category]
          },
          null,
          2
        )
      }))
    );

    return {
      config,
      branchContext,
      scannerInvocation,
      gate,
      issues,
      hotspots,
      findings: {
        issueCount: issues.length,
        hotspotCount: hotspots.length
      },
      lessonsLearned,
      futureGuardrails,
      knowledgeEntries,
      execution: {
        mode: executionMode,
        executed: true,
        analysisTarget: branchContext.analysisTarget,
        attemptedLiveScan: liveScan.attempted,
        fallbackReason: liveScan.fallbackReason
      }
    };
  }

  private resolveEffectiveConfig(): {
    config: SonarConfigView;
    warnings: string[];
    storedConfig: WorkspaceSonarSettings | null;
  } {
    const sonarCliState = detectSonarCliState(this.workspaceRoot);
    const storedConfig = this.repository.getByWorkspaceId(this.workspace.id);
    if (storedConfig) {
      return {
        config: this.maskConfig(storedConfig, "db", sonarCliState),
        warnings: [],
        storedConfig
      };
    }
    const envConfig = parseDotEnv(resolve(this.workspaceRoot, ".env.local"));
    const hasEnvConfig = Boolean(
      envConfig.SONAR_HOST_URL || envConfig.SONAR_ORGANIZATION || envConfig.SONAR_PROJECT_KEY || envConfig.SONAR_TOKEN
    );
    if (!hasEnvConfig) {
      return {
        config: this.maskConfig(null, "none", sonarCliState),
        warnings: [],
        storedConfig: null
      };
    }
    const projectConfigured = Boolean((envConfig.SONAR_HOST_URL ?? "https://sonarcloud.io") && envConfig.SONAR_ORGANIZATION && envConfig.SONAR_PROJECT_KEY);
    const hasToken = Boolean(envConfig.SONAR_TOKEN);
    return {
      config: {
        enabled: envConfig.SONAR_ENABLED !== "false",
        providerType: envConfig.SONAR_PROVIDER_TYPE ?? "sonarcloud",
        hostUrl: envConfig.SONAR_HOST_URL ?? "https://sonarcloud.io",
        organization: envConfig.SONAR_ORGANIZATION ?? null,
        projectKey: envConfig.SONAR_PROJECT_KEY ?? null,
        hasToken,
        defaultBranch: envConfig.SONAR_DEFAULT_BRANCH ?? "main",
        gatingMode: (envConfig.SONAR_GATING_MODE as QualityGatingMode | undefined) ?? "advisory",
        validationStatus: "untested",
        lastTestedAt: null,
        lastError: null,
        source: "env",
        projectConfigured,
        configured: projectConfigured && (hasToken || sonarCliState.loggedIn),
        authSource: hasToken ? "token" : sonarCliState.loggedIn ? "sonar_cli" : "none",
        authCliAvailable: sonarCliState.available,
        authCliLoggedIn: sonarCliState.loggedIn
      },
      warnings: ["Using .env.local fallback for Sonar configuration. Persist it with `beerengineer sonar config set`."],
      storedConfig: null
    };
  }

  private maskConfig(config: WorkspaceSonarSettings | null, source: SonarConfigView["source"], sonarCliState: SonarCliState): SonarConfigView {
    const hostUrl = config?.hostUrl ?? null;
    const organization = config?.organization ?? null;
    const projectKey = config?.projectKey ?? null;
    const hasToken = Boolean(config?.token);
    const projectConfigured = Boolean(hostUrl && organization && projectKey);
    return {
      enabled: Boolean(config?.enabled ?? 0),
      providerType: config?.providerType ?? "sonarcloud",
      hostUrl,
      organization,
      projectKey,
      hasToken,
      defaultBranch: config?.defaultBranch ?? null,
      gatingMode: config?.gatingMode ?? "advisory",
      validationStatus: config?.validationStatus ?? "untested",
      lastTestedAt: config?.lastTestedAt ?? null,
      lastError: config?.lastError ?? null,
      source,
      projectConfigured,
      configured: projectConfigured && (hasToken || sonarCliState.loggedIn),
      authSource: hasToken ? "token" : sonarCliState.loggedIn ? "sonar_cli" : "none",
      authCliAvailable: sonarCliState.available,
      authCliLoggedIn: sonarCliState.loggedIn
    };
  }

  private isCommandAvailable(command: string): boolean {
    const lookupCommand = process.platform === "win32" ? "where" : "which";
    const result = spawnSync(lookupCommand, [command], {
      cwd: this.workspaceRoot,
      encoding: "utf8"
    });
    return result.status === 0;
  }

  private loadGateStatus(): SonarGateStatus {
    const metricsPath = process.env.BEERENGINEER_SONAR_METRICS_PATH ?? resolve(this.repoRoot, "scripts/sonar-metrics.json");
    if (!existsSync(metricsPath)) {
      return {
        status: "blocked",
        coverage: null,
        bugs: null,
        vulnerabilities: null,
        duplicatedLinesDensity: null,
        codeSmells: null,
        reasons: ["No Sonar metrics fixture is available."]
      };
    }
    const parsed = this.readJsonFile<{ component?: { measures?: Array<{ metric: string; value: string }> } }>(metricsPath);
    if (!parsed) {
      return {
        status: "blocked",
        coverage: null,
        bugs: null,
        vulnerabilities: null,
        duplicatedLinesDensity: null,
        codeSmells: null,
        reasons: ["Sonar metrics fixture could not be parsed."]
      };
    }
    const measures = new Map(
      (parsed.component?.measures ?? []).map((measure) => [measure.metric, this.parseNumericMeasure(measure.value)])
    );
    const coverage = measures.get("coverage") ?? null;
    const bugs = measures.get("bugs") ?? null;
    const vulnerabilities = measures.get("vulnerabilities") ?? null;
    const duplicatedLinesDensity = measures.get("duplicated_lines_density") ?? null;
    const codeSmells = measures.get("code_smells") ?? null;
    const reasons: string[] = [];
    if ((bugs ?? 0) > 0) {
      reasons.push("Open bugs are present.");
    }
    if ((vulnerabilities ?? 0) > 0) {
      reasons.push("Open vulnerabilities are present.");
    }
    if (coverage !== null && coverage < 70) {
      reasons.push(`Coverage is below target (${coverage}%).`);
    }
    if (duplicatedLinesDensity !== null && duplicatedLinesDensity > 5) {
      reasons.push(`Duplication drift is elevated (${duplicatedLinesDensity}%).`);
    }
    const hasOpenReliabilityIssues = (bugs ?? 0) > 0 || (vulnerabilities ?? 0) > 0;
    const status: QualityDecisionStatus = hasOpenReliabilityIssues ? "failed" : reasons.length > 0 ? "review_required" : "passed";
    return {
      status,
      coverage,
      bugs,
      vulnerabilities,
      duplicatedLinesDensity,
      codeSmells,
      reasons
    };
  }

  private loadIssueSummaries(): SonarIssueSummary[] {
    const issuesPath = process.env.BEERENGINEER_SONAR_ISSUES_PATH ?? resolve(this.repoRoot, "scripts/sonar-issues.json");
    if (!existsSync(issuesPath)) {
      return [];
    }
    const parsed = this.readJsonFile<{
      issues?: Array<{
        key: string;
        type?: string;
        severity?: string;
        message: string;
        line?: number;
        status?: string;
        component?: string;
        impacts?: Array<{ softwareQuality: string }>;
      }>;
    }>(issuesPath);
    if (!parsed) {
      return [];
    }
    return (parsed.issues ?? []).map((issue) => ({
      key: issue.key,
      severity: issue.severity ?? "UNKNOWN",
      type: issue.type ?? "CODE_SMELL",
      category: issue.impacts?.[0]?.softwareQuality ?? "MAINTAINABILITY",
      message: issue.message,
      filePath: issue.component?.split(":").at(1) ?? null,
      line: issue.line ?? null,
      status: issue.status ?? "OPEN"
    }));
  }

  private loadHotspotSummaries(): SonarHotspotSummary[] {
    // Fixture-mode approximation only: real Sonar hotspots come from a dedicated endpoint.
    return this.loadIssueSummaries()
      .filter((issue) => issue.category === "SECURITY")
      .map((issue) => ({
        key: issue.key,
        severity: issue.severity,
        message: issue.message,
        filePath: issue.filePath,
        line: issue.line,
        status: issue.status
      }));
  }

  private tryLiveScan(
    config: SonarConfigView,
    branchContext: SonarBranchContext,
    scannerInvocation: SonarScannerInvocation
  ): { mode: "fixture" | "live"; attempted: boolean; fallbackReason: string | null } {
    const liveScanReady =
      config.projectConfigured &&
      config.hasToken &&
      this.isCommandAvailable("java") &&
      this.isCommandAvailable("sonar-scanner");
    if (!liveScanReady) {
      return {
        mode: "fixture",
        attempted: false,
        fallbackReason: "live Sonar scanner prerequisites are incomplete"
      };
    }

    const result = spawnSync(scannerInvocation.command, scannerInvocation.args, {
      cwd: this.workspaceRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        ...(config.hasToken && this.resolveStoredToken() ? { SONAR_TOKEN: this.resolveStoredToken()! } : {})
      }
    });

    if (result.status === 0) {
      return {
        mode: "live",
        attempted: true,
        fallbackReason: null
      };
    }

    return {
      mode: "fixture",
      attempted: true,
      fallbackReason: `live Sonar scan failed: ${(result.stderr ?? result.stdout ?? "").trim() || `exit ${result.status ?? "unknown"}`}`
    };
  }

  private buildScannerInvocation(config: SonarConfigView, branchContext: SonarBranchContext): SonarScannerInvocation {
    const args = [
      `-Dsonar.host.url=${config.hostUrl ?? "https://sonarcloud.io"}`,
      `-Dsonar.projectKey=${config.projectKey ?? ""}`
    ];
    if (config.organization) {
      args.push(`-Dsonar.organization=${config.organization}`);
    }
    const revision = this.currentHeadSha();
    if (revision) {
      args.push(`-Dsonar.scm.revision=${revision}`);
    }
    if (branchContext.analysisTarget === "pull_request" && branchContext.pullRequestKey && branchContext.branchName) {
      args.push(`-Dsonar.pullrequest.key=${branchContext.pullRequestKey}`);
      args.push(`-Dsonar.pullrequest.branch=${branchContext.branchName}`);
      args.push(`-Dsonar.pullrequest.base=${branchContext.baseBranch ?? branchContext.defaultBranch ?? "main"}`);
    } else if (branchContext.analysisTarget === "branch" && branchContext.branchName) {
      args.push(`-Dsonar.branch.name=${branchContext.branchName}`);
    }
    return {
      command: "sonar-scanner",
      args,
      env: {
        usesSonarToken: config.hasToken
      }
    };
  }

  private resolveBranchContext(defaultBranch: string | null): SonarBranchContext {
    const pullRequestKey = this.resolvePullRequestKey();
    const baseBranch = this.resolvePullRequestBaseBranch();
    const gitAvailable = this.isCommandAvailable("git");
    if (!gitAvailable) {
      return {
        gitAvailable: false,
        gitRepository: false,
        branchName: null,
        baseBranch,
        defaultBranch,
        branchRole: null,
        analysisTarget: pullRequestKey ? "pull_request" : "none",
        pullRequestKey
      };
    }
    const gitRepository = this.isGitRepository();
    if (!gitRepository) {
      return {
        gitAvailable: true,
        gitRepository: false,
        branchName: null,
        baseBranch,
        defaultBranch,
        branchRole: null,
        analysisTarget: pullRequestKey ? "pull_request" : "none",
        pullRequestKey
      };
    }
    const branchName = this.currentBranchName();
    const branchRole = this.resolveBranchRole(branchName, defaultBranch);
    const analysisTarget = pullRequestKey
      ? "pull_request"
      : branchRole === "main"
        ? "main"
        : branchName
          ? "branch"
          : "none";
    return {
      gitAvailable: true,
      gitRepository: true,
      branchName,
      baseBranch,
      defaultBranch,
      branchRole,
      analysisTarget,
      pullRequestKey
    };
  }

  private resolveBranchRole(branchName: string | null, defaultBranch: string | null): SonarBranchContext["branchRole"] {
    if (!branchName) {
      return null;
    }
    if (defaultBranch && branchName === defaultBranch) {
      return "main";
    }
    if (branchName === "main") {
      return "main";
    }
    if (branchName.startsWith("proj/")) {
      return "project";
    }
    if (branchName.startsWith("story/")) {
      return "story";
    }
    if (branchName.startsWith("fix/")) {
      return "story-remediation";
    }
    return "other";
  }

  private resolvePullRequestKey(): string | null {
    return (
      process.env.SONAR_PULLREQUEST_KEY ??
      process.env.GITHUB_EVENT_PULL_REQUEST_NUMBER ??
      process.env.GITHUB_PR_NUMBER ??
      process.env.CI_MERGE_REQUEST_IID ??
      null
    );
  }

  private resolvePullRequestBaseBranch(): string | null {
    return process.env.SONAR_PULLREQUEST_BASE ?? process.env.GITHUB_BASE_REF ?? process.env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME ?? null;
  }

  private isGitRepository(): boolean {
    try {
      return this.runCommand("git", ["rev-parse", "--is-inside-work-tree"]) === "true";
    } catch {
      return false;
    }
  }

  private currentBranchName(): string | null {
    try {
      const branch = this.runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
      return branch === "HEAD" ? null : branch;
    } catch {
      return null;
    }
  }

  private currentHeadSha(): string | null {
    try {
      return this.runCommand("git", ["rev-parse", "HEAD"]);
    } catch {
      return null;
    }
  }

  private resolveStoredToken(): string | null {
    const stored = this.repository.getByWorkspaceId(this.workspace.id);
    if (stored?.token) {
      return stored.token;
    }
    const envConfig = parseDotEnv(resolve(this.workspaceRoot, ".env.local"));
    return envConfig.SONAR_TOKEN ?? null;
  }

  private readJsonFile<TValue>(filePath: string): TValue | null {
    try {
      return JSON.parse(readFileSync(filePath, "utf8")) as TValue;
    } catch {
      return null;
    }
  }

  private parseNumericMeasure(value: string): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private runCommand(command: string, args: string[]): string {
    return execFileSync(command, args, {
      cwd: this.workspaceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  }
}
