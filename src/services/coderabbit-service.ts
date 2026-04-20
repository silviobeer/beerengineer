import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import type {
  IntegrationValidationStatus,
  QualityGatingMode,
  ReviewFindingSeverity,
  Workspace,
  WorkspaceCoderabbitSettings
} from "../domain/types.js";
import type { QualityKnowledgeEntryRepository, WorkspaceCoderabbitSettingsRepository } from "../persistence/repositories.js";
import { detectCoderabbitCliState, type CoderabbitCliState } from "../shared/coderabbit-cli.js";
import { parseGitRemoteRepository } from "../shared/git-remote.js";
import { parseDotEnv } from "./env-config.js";
import { QualityKnowledgeService } from "./quality-knowledge-service.js";

type CoderabbitConfigSource = "db" | "env" | "none";
type CoderabbitRepositorySource = "db" | "env" | "git" | "none";
type CoderabbitAuthSource = "token" | "coderabbit_cli" | "none";
const MAX_PERSISTED_FINDINGS = 25;

type CoderabbitRepositoryIdentity = {
  organization: string;
  repository: string;
};

type CoderabbitScanScopeInput = {
  projectId?: string | null;
  waveId?: string | null;
  storyId?: string | null;
  storyCode?: string | null;
  filePaths?: string[];
  modules?: string[];
  live?: boolean;
  timeoutMs?: number;
};

export type CoderabbitConfigView = {
  enabled: boolean;
  providerType: string;
  hostUrl: string | null;
  organization: string | null;
  repository: string | null;
  hasToken: boolean;
  defaultBranch: string | null;
  gatingMode: QualityGatingMode;
  validationStatus: IntegrationValidationStatus;
  lastTestedAt: number | null;
  lastError: string | null;
  source: CoderabbitConfigSource;
  repositorySource: CoderabbitRepositorySource;
  projectConfigured: boolean;
  configured: boolean;
  authSource: CoderabbitAuthSource;
  authCliAvailable: boolean;
  authCliLoggedIn: boolean;
  authCliBinary: "cr" | "coderabbit" | null;
};

export type CoderabbitBranchContext = {
  gitAvailable: boolean;
  gitRepository: boolean;
  branchName: string | null;
  baseBranch: string | null;
  defaultBranch: string | null;
  branchRole: "main" | "project" | "story" | "story-remediation" | "other" | null;
  analysisTarget: "none" | "main" | "branch" | "pull_request";
  pullRequestKey: string | null;
  remoteOrigin: string | null;
};

export type CoderabbitReviewInvocation = {
  command: "cr" | "coderabbit" | null;
  args: string[];
  auth: {
    usesApiKey: boolean;
    authSource: CoderabbitAuthSource;
  };
};

export type CoderabbitReviewFinding = {
  reviewerRole: "coderabbit";
  findingType: "live_review" | "recurring_issue";
  normalizedSeverity: ReviewFindingSeverity;
  sourceSeverity: string;
  title: string;
  detail: string;
  evidence: string | null;
  filePath: string | null;
  line: number | null;
  fieldPath: string | null;
  suggestions: string[];
  codegenInstructions: string[];
  source: "live" | "quality_knowledge";
};

export type CoderabbitReviewResult = {
  config: CoderabbitConfigView;
  branchContext: CoderabbitBranchContext;
  reviewInvocation: CoderabbitReviewInvocation;
  findings: CoderabbitReviewFinding[];
  knowledgeEntries: ReturnType<QualityKnowledgeService["createEntries"]>;
  warnings: string[];
  execution: {
    mode: "quality_knowledge" | "live";
    executed: boolean;
    analysisTarget: CoderabbitBranchContext["analysisTarget"];
    attemptedLiveReview: boolean;
    fallbackReason: string | null;
  };
};

export type CoderabbitPreflightResult = {
  config: CoderabbitConfigView;
  branchContext: CoderabbitBranchContext;
  reviewInvocation: CoderabbitReviewInvocation;
  warnings: string[];
  errors: string[];
  checks: {
    gitAvailable: boolean;
    gitRepository: boolean;
    cliAvailable: boolean;
    authCliAvailable: boolean;
    authCliLoggedIn: boolean;
    tokenAvailable: boolean;
    repositoryConfigured: boolean;
    branchContextAvailable: boolean;
    liveReviewReady: boolean;
  };
  ready: boolean;
};

type CoderabbitLiveReviewResult =
  | {
      mode: "live";
      attempted: true;
      fallbackReason: null;
      findings: CoderabbitReviewFinding[];
      knowledgeEntries: ReturnType<QualityKnowledgeService["createEntries"]>;
    }
  | {
      mode: "quality_knowledge";
      attempted: boolean;
      fallbackReason: string;
      findings: [];
      knowledgeEntries: [];
    };

type EffectiveConfigResolution = {
  config: CoderabbitConfigView;
  warnings: string[];
  storedConfig: WorkspaceCoderabbitSettings | null;
  cliState: CoderabbitCliState;
  remoteOrigin: string | null;
};

export class CoderabbitService {
  public constructor(
    private readonly workspace: Workspace,
    private readonly workspaceRoot: string,
    private readonly repository: WorkspaceCoderabbitSettingsRepository,
    knowledgeRepository: QualityKnowledgeEntryRepository
  ) {
    this.qualityKnowledgeService = new QualityKnowledgeService(knowledgeRepository, workspace);
  }

  private readonly qualityKnowledgeService: QualityKnowledgeService;

  public showConfig(): { config: CoderabbitConfigView; warnings: string[] } {
    const { config, warnings } = this.resolveEffectiveConfig();
    return { config, warnings };
  }

  public context(): {
    config: CoderabbitConfigView;
    branchContext: CoderabbitBranchContext;
    reviewInvocation: CoderabbitReviewInvocation;
    warnings: string[];
  } {
    const { config, warnings, remoteOrigin } = this.resolveEffectiveConfig();
    const branchContext = this.resolveBranchContext(config.defaultBranch, remoteOrigin);
    return {
      config,
      branchContext,
      reviewInvocation: this.buildReviewInvocation(config, branchContext),
      warnings
    };
  }

  public preflight(): CoderabbitPreflightResult {
    const { config, warnings, remoteOrigin } = this.resolveEffectiveConfig();
    const branchContext = this.resolveBranchContext(config.defaultBranch, remoteOrigin);
    const cliAvailable = config.authCliAvailable;
    const branchContextAvailable = branchContext.analysisTarget !== "none";
    const repositoryConfigured = config.projectConfigured;
    const liveReviewReady = cliAvailable && branchContext.gitRepository && repositoryConfigured && branchContextAvailable;
    const errors = [
      branchContext.gitAvailable ? null : "git is missing",
      branchContext.gitRepository ? null : "workspace root is not a git repository",
      cliAvailable ? null : "CodeRabbit CLI is missing",
      repositoryConfigured ? null : "organization or repository is missing",
      branchContextAvailable ? null : "no active git branch or pull request context was detected"
    ].filter((value): value is string => Boolean(value));
    const runtimeWarnings = [...warnings];
    if (config.authSource === "none") {
      runtimeWarnings.push("CodeRabbit can review without authentication, but `cr auth login` or an API key improves review quality and rate limits.");
    }
    if (!liveReviewReady) {
      runtimeWarnings.push("BeerEngineer falls back to persisted CodeRabbit quality knowledge until live branch review prerequisites are available.");
    }
    return {
      config,
      branchContext,
      reviewInvocation: this.buildReviewInvocation(config, branchContext),
      warnings: Array.from(new Set(runtimeWarnings)),
      errors,
      checks: {
        gitAvailable: branchContext.gitAvailable,
        gitRepository: branchContext.gitRepository,
        cliAvailable,
        authCliAvailable: config.authCliAvailable,
        authCliLoggedIn: config.authCliLoggedIn,
        tokenAvailable: config.hasToken,
        repositoryConfigured,
        branchContextAvailable,
        liveReviewReady
      },
      ready: liveReviewReady
    };
  }

  public setConfig(input: {
    enabled?: boolean;
    providerType?: string;
    hostUrl?: string | null;
    organization?: string | null;
    repository?: string | null;
    token?: string | null;
    defaultBranch?: string | null;
    gatingMode?: QualityGatingMode;
  }): { config: CoderabbitConfigView } {
    const current = this.repository.getByWorkspaceId(this.workspace.id);
    const next = this.repository.upsertByWorkspaceId({
      workspaceId: this.workspace.id,
      enabled: Number(input.enabled ?? (current?.enabled ?? 1)),
      providerType: input.providerType ?? current?.providerType ?? "coderabbit",
      hostUrl: input.hostUrl ?? current?.hostUrl ?? "https://api.coderabbit.ai",
      organization: input.organization ?? current?.organization ?? null,
      repository: input.repository ?? current?.repository ?? null,
      token: input.token === undefined ? current?.token ?? null : input.token,
      defaultBranch: input.defaultBranch ?? current?.defaultBranch ?? "main",
      gatingMode: input.gatingMode ?? current?.gatingMode ?? "advisory",
      validationStatus: "untested",
      lastError: null,
      lastTestedAt: null
    });
    return {
      config: this.maskConfig(next, "db", detectCoderabbitCliState(this.workspaceRoot), this.resolveGitRemoteOrigin())
    };
  }

  public clearToken(): { config: CoderabbitConfigView } {
    this.repository.clearToken(this.workspace.id);
    const updated = this.repository.getByWorkspaceId(this.workspace.id);
    return {
      config: this.maskConfig(updated, updated ? "db" : "none", detectCoderabbitCliState(this.workspaceRoot), this.resolveGitRemoteOrigin())
    };
  }

  public testConfig(): { config: CoderabbitConfigView; valid: boolean; warnings: string[]; errors: string[] } {
    const { config, warnings, storedConfig } = this.resolveEffectiveConfig();
    const errors = [
      !config.hostUrl ? "hostUrl is missing" : null,
      !config.organization ? "organization is missing" : null,
      !config.repository ? "repository is missing" : null
    ].filter((value): value is string => Boolean(value));
    const valid = errors.length === 0;
    const testedAt = Date.now();
    const nextWarnings = [...warnings];
    if (config.authSource === "none") {
      nextWarnings.push("CodeRabbit authentication is optional for CLI reviews, but `cr auth login` or an API key is recommended.");
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

  public review(input?: CoderabbitScanScopeInput): CoderabbitReviewResult {
    const { config, warnings, remoteOrigin } = this.resolveEffectiveConfig();
    const branchContext = this.resolveBranchContext(config.defaultBranch, remoteOrigin);
    const reviewInvocation = this.buildReviewInvocation(config, branchContext);
    const liveReview = input?.live
      ? this.tryLiveReview(config, branchContext, reviewInvocation, input)
      : {
          mode: "quality_knowledge" as const,
          attempted: false,
          fallbackReason: "live CodeRabbit review was not requested",
          findings: [],
          knowledgeEntries: []
        };
    const fallbackFindings = this.replayQualityKnowledge(input);
    return {
      config,
      branchContext,
      reviewInvocation,
      findings: liveReview.mode === "live" ? liveReview.findings : fallbackFindings,
      knowledgeEntries: liveReview.knowledgeEntries,
      warnings,
      execution: {
        mode: liveReview.mode,
        executed: true,
        analysisTarget: branchContext.analysisTarget,
        attemptedLiveReview: liveReview.attempted,
        fallbackReason: liveReview.fallbackReason
      }
    };
  }

  private resolveEffectiveConfig(): EffectiveConfigResolution {
    const cliState = detectCoderabbitCliState(this.workspaceRoot);
    const storedConfig = this.repository.getByWorkspaceId(this.workspace.id);
    const remoteOrigin = this.resolveGitRemoteOrigin();
    if (storedConfig) {
      const config = this.maskConfig(storedConfig, "db", cliState, remoteOrigin);
      return {
        config,
        warnings: this.configWarnings(config, "db"),
        storedConfig,
        cliState,
        remoteOrigin
      };
    }

    const envConfig = parseDotEnv(resolve(this.workspaceRoot, ".env.local"));
    const hasEnvConfig = Boolean(
      envConfig.CODERABBIT_HOST_URL ||
        envConfig.CODERABBIT_ORGANIZATION ||
        envConfig.CODERABBIT_REPOSITORY ||
        envConfig.CODERABBIT_TOKEN ||
        envConfig.CODERABBIT_DEFAULT_BRANCH
    );
    if (!hasEnvConfig) {
      const config = this.maskConfig(null, "none", cliState, remoteOrigin);
      return {
        config,
        warnings: this.configWarnings(config, "none"),
        storedConfig: null,
        cliState,
        remoteOrigin
      };
    }

    const inferredRepository = parseGitRemoteRepository(remoteOrigin);
    const organization = envConfig.CODERABBIT_ORGANIZATION ?? inferredRepository?.organization ?? null;
    const repository = envConfig.CODERABBIT_REPOSITORY ?? inferredRepository?.repository ?? null;
    const repositorySource: CoderabbitRepositorySource =
      envConfig.CODERABBIT_ORGANIZATION && envConfig.CODERABBIT_REPOSITORY ? "env" : inferredRepository ? "git" : "none";
    const hasToken = Boolean(envConfig.CODERABBIT_TOKEN);
    const config: CoderabbitConfigView = {
      enabled: envConfig.CODERABBIT_ENABLED !== "false",
      providerType: envConfig.CODERABBIT_PROVIDER_TYPE ?? "coderabbit",
      hostUrl: envConfig.CODERABBIT_HOST_URL ?? "https://api.coderabbit.ai",
      organization,
      repository,
      hasToken,
      defaultBranch: envConfig.CODERABBIT_DEFAULT_BRANCH ?? "main",
      gatingMode: (envConfig.CODERABBIT_GATING_MODE as QualityGatingMode | undefined) ?? "advisory",
      validationStatus: "untested",
      lastTestedAt: null,
      lastError: null,
      source: "env",
      repositorySource,
      projectConfigured: Boolean((envConfig.CODERABBIT_HOST_URL ?? "https://api.coderabbit.ai") && organization && repository),
      configured: Boolean(envConfig.CODERABBIT_ENABLED !== "false" && (envConfig.CODERABBIT_HOST_URL ?? "https://api.coderabbit.ai") && organization && repository),
      authSource: hasToken ? "token" : cliState.loggedIn ? "coderabbit_cli" : "none",
      authCliAvailable: cliState.available,
      authCliLoggedIn: cliState.loggedIn,
      authCliBinary: cliState.binary
    };
    return {
      config,
      warnings: this.configWarnings(config, "env"),
      storedConfig: null,
      cliState,
      remoteOrigin
    };
  }

  private maskConfig(
    config: WorkspaceCoderabbitSettings | null,
    source: CoderabbitConfigSource,
    cliState: CoderabbitCliState,
    remoteOrigin: string | null
  ): CoderabbitConfigView {
    const inferredRepository = parseGitRemoteRepository(remoteOrigin);
    const explicitRepository = config?.organization && config?.repository
      ? { organization: config.organization, repository: config.repository }
      : null;
    const repositoryIdentity = explicitRepository ?? inferredRepository;
    const hostUrl = config?.hostUrl ?? (source === "none" && repositoryIdentity ? "https://api.coderabbit.ai" : null);
    const hasToken = Boolean(config?.token);
    const projectConfigured = Boolean(hostUrl && repositoryIdentity?.organization && repositoryIdentity?.repository);
    return {
      enabled: Boolean(config?.enabled ?? 0),
      providerType: config?.providerType ?? "coderabbit",
      hostUrl,
      organization: repositoryIdentity?.organization ?? null,
      repository: repositoryIdentity?.repository ?? null,
      hasToken,
      defaultBranch: config?.defaultBranch ?? "main",
      gatingMode: config?.gatingMode ?? "advisory",
      validationStatus: config?.validationStatus ?? "untested",
      lastTestedAt: config?.lastTestedAt ?? null,
      lastError: config?.lastError ?? null,
      source,
      repositorySource: explicitRepository ? source : inferredRepository ? "git" : "none",
      projectConfigured,
      configured: Boolean(projectConfigured && (config ? Boolean(config.enabled) : true)),
      authSource: hasToken ? "token" : cliState.loggedIn ? "coderabbit_cli" : "none",
      authCliAvailable: cliState.available,
      authCliLoggedIn: cliState.loggedIn,
      authCliBinary: cliState.binary
    };
  }

  private configWarnings(config: CoderabbitConfigView, source: CoderabbitConfigSource): string[] {
    const warnings: string[] = [];
    if (source === "env") {
      warnings.push("Using .env.local fallback for Coderabbit configuration. Persist it with `beerengineer coderabbit config set`.");
    }
    if (config.repositorySource === "git") {
      warnings.push("Using git remote origin fallback for CodeRabbit organization/repository. Persist it with `beerengineer coderabbit config set`.");
    }
    return warnings;
  }

  private buildReviewInvocation(config: CoderabbitConfigView, branchContext: CoderabbitBranchContext): CoderabbitReviewInvocation {
    const command = config.authCliAvailable ? config.authCliBinary : null;
    const args = ["review", "--agent"];
    const baseBranch = branchContext.baseBranch ?? branchContext.defaultBranch ?? config.defaultBranch ?? "main";
    if (baseBranch) {
      args.push("--base", baseBranch);
    }
    args.push("--dir", this.workspaceRoot);
    const instructionsPath = resolve(this.workspaceRoot, "coderabbit.md");
    if (existsSync(instructionsPath)) {
      args.push("--config", instructionsPath);
    }
    return {
      command,
      args,
      auth: {
        usesApiKey: config.hasToken,
        authSource: config.authSource
      }
    };
  }

  private tryLiveReview(
    config: CoderabbitConfigView,
    branchContext: CoderabbitBranchContext,
    reviewInvocation: CoderabbitReviewInvocation,
    input?: CoderabbitScanScopeInput
  ): CoderabbitLiveReviewResult {
    if (!branchContext.gitAvailable) {
      return this.qualityKnowledgeFallback("git is missing");
    }
    if (!branchContext.gitRepository) {
      return this.qualityKnowledgeFallback("workspace root is not a git repository");
    }
    if (!config.projectConfigured) {
      return this.qualityKnowledgeFallback("CodeRabbit organization/repository context is incomplete");
    }
    if (branchContext.analysisTarget === "none") {
      return this.qualityKnowledgeFallback("no active branch or pull request context was detected");
    }
    if (!reviewInvocation.command) {
      return this.qualityKnowledgeFallback("CodeRabbit CLI is not available");
    }

    const apiKey = config.hasToken ? this.resolveStoredToken() : null;
    const reviewProcess = spawnSync(reviewInvocation.command, reviewInvocation.args, {
      cwd: this.workspaceRoot,
      encoding: "utf8",
      timeout: input?.timeoutMs,
      env: {
        ...process.env,
        ...(apiKey ? { CODERABBIT_API_KEY: apiKey } : {})
      }
    });

    if (reviewProcess.error) {
      return this.qualityKnowledgeFallback(reviewProcess.error.message, true);
    }

    if (reviewProcess.status !== 0) {
      const failureOutput = `${reviewProcess.stderr ?? ""}\n${reviewProcess.stdout ?? ""}`.trim();
      return this.qualityKnowledgeFallback(failureOutput || "CodeRabbit review failed", true);
    }

    const findings = this.parseAgentReviewOutput(reviewProcess.stdout ?? "");
    const knowledgeEntries = findings.length > 0 ? this.persistLiveFindings(findings, input) : [];
    return {
      mode: "live",
      attempted: true,
      fallbackReason: null,
      findings,
      knowledgeEntries
    };
  }

  private parseAgentReviewOutput(output: string): CoderabbitReviewFinding[] {
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((value): value is Record<string, unknown> => value !== null)
      .filter((event) => event.type === "finding")
      .map((event) => this.mapLiveFinding(event));
  }

  private mapLiveFinding(event: Record<string, unknown>): CoderabbitReviewFinding {
    const sourceSeverity = typeof event.severity === "string" ? event.severity.toLowerCase() : "info";
    const suggestions = Array.isArray(event.suggestions)
      ? event.suggestions.filter((value): value is string => typeof value === "string")
      : typeof event.suggestions === "string"
        ? [event.suggestions]
        : [];
    const codegenInstructions = Array.isArray(event.codegenInstructions)
      ? event.codegenInstructions.filter((value): value is string => typeof value === "string")
      : typeof event.codegenInstructions === "string"
        ? [event.codegenInstructions]
        : [];
    const title =
      this.readString(event.title) ??
      this.readString(event.message) ??
      this.readString(event.summary) ??
      this.readString(event.fileName) ??
      "CodeRabbit finding";
    const detail =
      this.readString(event.detail) ??
      codegenInstructions[0] ??
      this.readString(event.message) ??
      `${title}.`;
    return {
      reviewerRole: "coderabbit",
      findingType: "live_review",
      normalizedSeverity: this.normalizeSeverity(sourceSeverity),
      sourceSeverity,
      title,
      detail,
      evidence: JSON.stringify(event),
      filePath: this.readString(event.fileName) ?? this.readString(event.filePath),
      line: this.readNumber(event.line),
      fieldPath: null,
      suggestions,
      codegenInstructions,
      source: "live"
    };
  }

  private replayQualityKnowledge(input?: CoderabbitScanScopeInput): CoderabbitReviewFinding[] {
    if (!input?.projectId || !input.storyId) {
      return [];
    }
    const entries = this.qualityKnowledgeService.listRelevantForStory({
      projectId: input.projectId,
      waveId: input.waveId ?? null,
      storyId: input.storyId,
      filePaths: input.filePaths ?? [],
      modules: input.modules ?? [],
      limit: 20
    });
    return entries
      .filter((entry) => entry.source === "coderabbit")
      .map((entry) => ({
        reviewerRole: "coderabbit",
        findingType: entry.kind === "recurring_issue" ? "recurring_issue" : "live_review",
        normalizedSeverity: this.normalizeSeverity(
          typeof entry.evidence.severity === "string" ? entry.evidence.severity.toLowerCase() : entry.status
        ),
        sourceSeverity: entry.status,
        title: entry.summary,
        detail: typeof entry.evidence.detail === "string" ? entry.evidence.detail : "Persisted CodeRabbit quality knowledge entry.",
        evidence: JSON.stringify(entry.evidence),
        filePath: entry.scopeType === "file" ? entry.scopeId : null,
        line: this.readNumber(entry.evidence.line),
        fieldPath: null,
        suggestions: Array.isArray(entry.evidence.suggestions)
          ? entry.evidence.suggestions.filter((value): value is string => typeof value === "string")
          : [],
        codegenInstructions: Array.isArray(entry.evidence.codegenInstructions)
          ? entry.evidence.codegenInstructions.filter((value): value is string => typeof value === "string")
          : [],
        source: "quality_knowledge"
      }));
  }

  private persistLiveFindings(findings: CoderabbitReviewFinding[], input?: CoderabbitScanScopeInput) {
    return this.qualityKnowledgeService.createEntries(
      findings.slice(0, MAX_PERSISTED_FINDINGS).map((finding) => {
        const scopeType = finding.filePath ? "file" : input?.storyId ? "story" : input?.projectId ? "project" : "workspace";
        return {
          workspaceId: this.workspace.id,
          projectId: input?.projectId ?? null,
          waveId: input?.waveId ?? null,
          storyId: input?.storyId ?? null,
          source: "coderabbit" as const,
          scopeType,
          scopeId: finding.filePath ?? input?.storyId ?? input?.projectId ?? this.workspace.id,
          kind: "recurring_issue" as const,
          summary: finding.title,
          evidenceJson: JSON.stringify(
            {
              source: "live_review",
              severity: finding.sourceSeverity,
              detail: finding.detail,
              filePath: finding.filePath,
              line: finding.line,
              suggestions: finding.suggestions,
              codegenInstructions: finding.codegenInstructions
            },
            null,
            2
          ),
          status: "open",
          relevanceTagsJson: JSON.stringify(
            {
              files: finding.filePath ? [finding.filePath] : [],
              storyCodes: input?.storyCode ? [input.storyCode] : [],
              modules: finding.filePath ? [this.normalizeModuleFromPath(finding.filePath)].filter((value): value is string => Boolean(value)) : [],
              categories: ["coderabbit", finding.normalizedSeverity]
            },
            null,
            2
          )
        };
      })
    );
  }

  private qualityKnowledgeFallback(reason: string, attempted = false): CoderabbitLiveReviewResult {
    return {
      mode: "quality_knowledge",
      attempted,
      fallbackReason: reason,
      findings: [],
      knowledgeEntries: []
    };
  }

  private resolveBranchContext(defaultBranch: string | null, remoteOrigin: string | null): CoderabbitBranchContext {
    const pullRequestKey = this.resolvePullRequestKey();
    const baseBranch = this.resolvePullRequestBaseBranch();
    const gitAvailable = this.isCommandAvailable("git");
    const resolvedRemoteOrigin = gitAvailable ? remoteOrigin : null;
    if (!gitAvailable) {
      return {
        gitAvailable: false,
        gitRepository: false,
        branchName: null,
        baseBranch,
        defaultBranch: defaultBranch ?? "main",
        branchRole: null,
        analysisTarget: pullRequestKey ? "pull_request" : "none",
        pullRequestKey,
        remoteOrigin: resolvedRemoteOrigin
      };
    }

    const gitRepository = this.isGitRepository();
    if (!gitRepository) {
      return {
        gitAvailable: true,
        gitRepository: false,
        branchName: null,
        baseBranch,
        defaultBranch: defaultBranch ?? "main",
        branchRole: null,
        analysisTarget: pullRequestKey ? "pull_request" : "none",
        pullRequestKey,
        remoteOrigin: resolvedRemoteOrigin
      };
    }

    const branchName = this.currentGitBranchName();
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
      baseBranch: baseBranch ?? defaultBranch ?? "main",
      defaultBranch: defaultBranch ?? "main",
      branchRole,
      analysisTarget,
      pullRequestKey,
      remoteOrigin: resolvedRemoteOrigin
    };
  }

  private resolveBranchRole(branchName: string | null, defaultBranch: string | null): CoderabbitBranchContext["branchRole"] {
    if (!branchName) {
      return null;
    }
    if (branchName === (defaultBranch ?? "main") || branchName === "main") {
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
      process.env.GITHUB_EVENT_PULL_REQUEST_NUMBER ??
      process.env.GITHUB_PR_NUMBER ??
      process.env.CI_MERGE_REQUEST_IID ??
      process.env.CODERABBIT_PULL_REQUEST_NUMBER ??
      null
    );
  }

  private resolvePullRequestBaseBranch(): string | null {
    return process.env.GITHUB_BASE_REF ?? process.env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME ?? process.env.CODERABBIT_BASE_BRANCH ?? null;
  }

  private resolveStoredToken(): string | null {
    const storedConfig = this.repository.getByWorkspaceId(this.workspace.id);
    if (storedConfig?.token) {
      return storedConfig.token;
    }
    const envConfig = parseDotEnv(resolve(this.workspaceRoot, ".env.local"));
    return envConfig.CODERABBIT_TOKEN ?? null;
  }

  private resolveGitRemoteOrigin(): string | null {
    try {
      const output = execFileSync("git", ["remote", "get-url", "origin"], {
        cwd: this.workspaceRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      }).trim();
      return output.length > 0 ? output : null;
    } catch {
      return null;
    }
  }

  private currentGitBranchName(): string | null {
    try {
      const output = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: this.workspaceRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      }).trim();
      return output.length > 0 && output !== "HEAD" ? output : null;
    } catch {
      return null;
    }
  }

  private isGitRepository(): boolean {
    try {
      return (
        execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
          cwd: this.workspaceRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"]
        }).trim() === "true"
      );
    } catch {
      return false;
    }
  }

  private isCommandAvailable(command: string): boolean {
    const lookupCommand = process.platform === "win32" ? "where" : "which";
    const result = spawnSync(lookupCommand, [command], {
      cwd: this.workspaceRoot,
      encoding: "utf8"
    });
    return result.status === 0;
  }

  private normalizeModuleFromPath(filePath: string): string | null {
    const [topLevel, secondLevel] = filePath.split(/[\\/]+/);
    if (!topLevel) {
      return null;
    }
    return secondLevel ? `${topLevel}/${secondLevel}` : topLevel;
  }

  private normalizeSeverity(sourceSeverity: string): ReviewFindingSeverity {
    switch (sourceSeverity) {
      case "critical":
        return "critical";
      case "major":
        return "high";
      case "minor":
        return "medium";
      case "trivial":
      case "info":
      default:
        return "low";
    }
  }

  private readString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  private readNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
}
