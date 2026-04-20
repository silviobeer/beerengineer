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
  configured: boolean;
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
  };
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
      config: this.maskConfig(next, "db")
    };
  }

  public clearToken(): { config: SonarConfigView } {
    this.repository.clearToken(this.workspace.id);
    const updated = this.repository.getByWorkspaceId(this.workspace.id);
    return {
      config: this.maskConfig(updated, updated ? "db" : "none")
    };
  }

  public testConfig(): { config: SonarConfigView; valid: boolean; warnings: string[]; errors: string[] } {
    const { config, warnings, storedConfig } = this.resolveEffectiveConfig();
    const errors = [
      !config.hostUrl ? "hostUrl is missing" : null,
      !config.organization ? "organization is missing" : null,
      !config.projectKey ? "projectKey is missing" : null,
      !config.hasToken ? "token is missing" : null
    ].filter((value): value is string => Boolean(value));
    const valid = errors.length === 0;
    const testedAt = Date.now();
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
      warnings,
      errors
    };
  }

  public status(): { config: SonarConfigView; gate: SonarGateStatus; warnings: string[] } {
    const { config, warnings } = this.resolveEffectiveConfig();
    return {
      config,
      gate: this.loadGateStatus(),
      warnings
    };
  }

  public issues(): { config: SonarConfigView; issues: SonarIssueSummary[]; warnings: string[] } {
    const { config, warnings } = this.resolveEffectiveConfig();
    return {
      config,
      issues: this.loadIssueSummaries(),
      warnings
    };
  }

  public hotspots(): { config: SonarConfigView; hotspots: SonarHotspotSummary[]; warnings: string[] } {
    const { config, warnings } = this.resolveEffectiveConfig();
    return {
      config,
      hotspots: this.loadHotspotSummaries(),
      warnings
    };
  }

  public scan(): SonarScanResult {
    const { config } = this.resolveEffectiveConfig();
    const executionMode = this.resolveExecutionMode();
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
        projectId: null,
        waveId: null,
        storyId: null,
        source: "sonar" as const,
        scopeType: issue.filePath ? "file" : "workspace",
        scopeId: issue.filePath ?? this.workspace.id,
        kind: "recurring_issue" as const,
        summary: issue.message,
        evidenceJson: JSON.stringify(issue, null, 2),
        status: issue.status.toLowerCase(),
        relevanceTagsJson: JSON.stringify(
          {
            files: issue.filePath ? [issue.filePath] : [],
            storyCodes: [],
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
        executed: true
      }
    };
  }

  private resolveEffectiveConfig(): {
    config: SonarConfigView;
    warnings: string[];
    storedConfig: WorkspaceSonarSettings | null;
  } {
    const storedConfig = this.repository.getByWorkspaceId(this.workspace.id);
    if (storedConfig) {
      return {
        config: this.maskConfig(storedConfig, "db"),
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
        config: this.maskConfig(null, "none"),
        warnings: [],
        storedConfig: null
      };
    }
    return {
      config: {
        enabled: envConfig.SONAR_ENABLED !== "false",
        providerType: envConfig.SONAR_PROVIDER_TYPE ?? "sonarcloud",
        hostUrl: envConfig.SONAR_HOST_URL ?? "https://sonarcloud.io",
        organization: envConfig.SONAR_ORGANIZATION ?? null,
        projectKey: envConfig.SONAR_PROJECT_KEY ?? null,
        hasToken: Boolean(envConfig.SONAR_TOKEN),
        defaultBranch: envConfig.SONAR_DEFAULT_BRANCH ?? "main",
        gatingMode: (envConfig.SONAR_GATING_MODE as QualityGatingMode | undefined) ?? "advisory",
        validationStatus: "untested",
        lastTestedAt: null,
        lastError: null,
        source: "env",
        configured: Boolean(envConfig.SONAR_ORGANIZATION && envConfig.SONAR_PROJECT_KEY && envConfig.SONAR_TOKEN)
      },
      warnings: ["Using .env.local fallback for Sonar configuration. Persist it with `beerengineer sonar config set`."],
      storedConfig: null
    };
  }

  private maskConfig(config: WorkspaceSonarSettings | null, source: SonarConfigView["source"]): SonarConfigView {
    return {
      enabled: Boolean(config?.enabled ?? 0),
      providerType: config?.providerType ?? "sonarcloud",
      hostUrl: config?.hostUrl ?? null,
      organization: config?.organization ?? null,
      projectKey: config?.projectKey ?? null,
      hasToken: Boolean(config?.token),
      defaultBranch: config?.defaultBranch ?? null,
      gatingMode: config?.gatingMode ?? "advisory",
      validationStatus: config?.validationStatus ?? "untested",
      lastTestedAt: config?.lastTestedAt ?? null,
      lastError: config?.lastError ?? null,
      source,
      configured: Boolean(config?.hostUrl && config.organization && config.projectKey && config.token)
    };
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

  private resolveExecutionMode(): "fixture" | "live" {
    // TODO: derive "live" once the service executes real Sonar scans instead of fixture-backed reads.
    return "fixture";
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
}
