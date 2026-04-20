import { resolve } from "node:path";

import type { IntegrationValidationStatus, QualityGatingMode, Workspace, WorkspaceCoderabbitSettings } from "../domain/types.js";
import type { WorkspaceCoderabbitSettingsRepository } from "../persistence/repositories.js";
import { parseDotEnv } from "./env-config.js";

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
  source: "db" | "env" | "none";
  configured: boolean;
};

export class CoderabbitService {
  public constructor(
    private readonly workspace: Workspace,
    private readonly workspaceRoot: string,
    private readonly repository: WorkspaceCoderabbitSettingsRepository
  ) {}

  public showConfig(): { config: CoderabbitConfigView; warnings: string[] } {
    return this.resolveEffectiveConfig();
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
      config: this.maskConfig(next, "db")
    };
  }

  public clearToken(): { config: CoderabbitConfigView } {
    this.repository.clearToken(this.workspace.id);
    const updated = this.repository.getByWorkspaceId(this.workspace.id);
    return {
      config: this.maskConfig(updated, updated ? "db" : "none")
    };
  }

  public testConfig(): { config: CoderabbitConfigView; valid: boolean; warnings: string[]; errors: string[] } {
    const { config, warnings, storedConfig } = this.resolveEffectiveConfig();
    const errors = [
      !config.hostUrl ? "hostUrl is missing" : null,
      !config.organization ? "organization is missing" : null,
      !config.repository ? "repository is missing" : null,
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

  private resolveEffectiveConfig(): {
    config: CoderabbitConfigView;
    warnings: string[];
    storedConfig: WorkspaceCoderabbitSettings | null;
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
      envConfig.CODERABBIT_HOST_URL || envConfig.CODERABBIT_ORGANIZATION || envConfig.CODERABBIT_REPOSITORY || envConfig.CODERABBIT_TOKEN
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
        enabled: envConfig.CODERABBIT_ENABLED !== "false",
        providerType: envConfig.CODERABBIT_PROVIDER_TYPE ?? "coderabbit",
        hostUrl: envConfig.CODERABBIT_HOST_URL ?? "https://api.coderabbit.ai",
        organization: envConfig.CODERABBIT_ORGANIZATION ?? null,
        repository: envConfig.CODERABBIT_REPOSITORY ?? null,
        hasToken: Boolean(envConfig.CODERABBIT_TOKEN),
        defaultBranch: envConfig.CODERABBIT_DEFAULT_BRANCH ?? "main",
        gatingMode: (envConfig.CODERABBIT_GATING_MODE as QualityGatingMode | undefined) ?? "advisory",
        validationStatus: "untested",
        lastTestedAt: null,
        lastError: null,
        source: "env",
        configured: Boolean(envConfig.CODERABBIT_ORGANIZATION && envConfig.CODERABBIT_REPOSITORY && envConfig.CODERABBIT_TOKEN)
      },
      warnings: ["Using .env.local fallback for Coderabbit configuration. Persist it with `beerengineer coderabbit config set`."],
      storedConfig: null
    };
  }

  private maskConfig(config: WorkspaceCoderabbitSettings | null, source: CoderabbitConfigView["source"]): CoderabbitConfigView {
    return {
      enabled: Boolean(config?.enabled ?? 0),
      providerType: config?.providerType ?? "coderabbit",
      hostUrl: config?.hostUrl ?? null,
      organization: config?.organization ?? null,
      repository: config?.repository ?? null,
      hasToken: Boolean(config?.token),
      defaultBranch: config?.defaultBranch ?? null,
      gatingMode: config?.gatingMode ?? "advisory",
      validationStatus: config?.validationStatus ?? "untested",
      lastTestedAt: config?.lastTestedAt ?? null,
      lastError: config?.lastError ?? null,
      source,
      configured: Boolean(config?.hostUrl && config.organization && config.repository && config.token)
    };
  }
}
