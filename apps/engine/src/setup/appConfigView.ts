import {
  readConfigFile,
  resolveConfigPath,
  resolveMergedConfig,
  resolveOverrides,
} from "./config.js"
import { readActiveSecretValue } from "./secretStore.js"
import type { Repos } from "../db/repositories.js"
import { SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, readSecretMetadata } from "./secretMetadata.js"
import type { AppConfig, ConfigFileState, SetupOverrides } from "./types.js"
import { resolveTelegramInboundStatus, type TelegramInboundStatusView } from "./telegramInboundStatus.js"

export type SecretRefView = {
  ref: string
  present: boolean
}

export type AppConfigSetupState = "uninitialized" | "partial" | "complete"

export type AppConfigView = {
  setupState: AppConfigSetupState
  configPath: string
  configFile: Pick<ConfigFileState, "kind" | "path"> & { error?: string }
  workspace?: {
    id: string
    key: string
    name: string
  } | null
  telegramInbound: TelegramInboundStatusView | null
  supabase: {
    workspaceId?: string
    projectRef?: string
    region?: string
    persistentTestBranchName?: string
    persistentTestBranchRef?: string
    persistentTestBranchStatus?: string
    lastCheckedAt?: number
    tokenPresent: boolean
    branchGranularity: "wave"
    cleanupPolicy: "on-success-immediate" | "ttl-after-success" | "manual"
    cleanupTtlHours?: number
    productionMigrationProtection: "off" | "on"
    settingsVersion: number
    costRisk: {
      retainedBranchCount: number
      planLimitRatio: number
    }
  }
  config: {
    allowedRoots: string[]
    enginePort: number
    publicBaseUrl?: string
    gitIdentityDefault?: AppConfig["gitIdentityDefault"]
    llm: {
      provider: AppConfig["llm"]["provider"]
      model: string
      defaultHarnessProfile: AppConfig["llm"]["defaultHarnessProfile"]
      defaultSonarOrganization?: string
      apiKey: SecretRefView
    }
    vcs: {
      github: {
        enabled: boolean
      }
    }
    browser: {
      enabled: boolean
    }
    notifications: {
      telegram: {
        enabled: boolean
        level: 0 | 1 | 2
        defaultChatId?: string
        botToken?: SecretRefView
        inbound: {
          enabled: boolean
          webhookSecret?: SecretRefView
        }
      }
    }
  }
}

export function getAppConfigView(
  overrides: SetupOverrides = {},
  deps: { repos?: Repos; workspaceKey?: string } = {},
): AppConfigView {
  const resolved = resolveOverrides(overrides)
  const configPath = resolveConfigPath(resolved)
  const configState = readConfigFile(configPath)
  const config = resolveMergedConfig(configState, resolved)
  const workspace = currentWorkspaceView(deps.repos, deps.workspaceKey)
  const supabase = supabaseView(deps.repos)
  const telegramInbound = resolveTelegramInboundStatus(config, deps)
  if (!config) {
    return {
      setupState: configState.kind === "missing" ? "uninitialized" : "partial",
      configPath,
      configFile: fileStateView(configState),
      workspace,
      telegramInbound,
      supabase,
      config: emptyConfigView(),
    }
  }

  const telegram = config.notifications?.telegram
  return {
    setupState: configState.kind === "missing" ? "uninitialized" : "complete",
    configPath,
    configFile: fileStateView(configState),
    workspace,
    telegramInbound,
    supabase,
    config: {
      allowedRoots: [...config.allowedRoots],
      enginePort: config.enginePort,
      publicBaseUrl: config.publicBaseUrl,
      gitIdentityDefault: config.gitIdentityDefault,
      llm: {
        provider: config.llm.provider,
        model: config.llm.model,
        defaultHarnessProfile: config.llm.defaultHarnessProfile,
        defaultSonarOrganization: config.llm.defaultSonarOrganization,
        apiKey: secretRef(config.llm.apiKeyRef),
      },
      vcs: {
        github: {
          enabled: config.vcs?.github?.enabled === true,
        },
      },
      browser: {
        enabled: config.browser?.enabled === true,
      },
      notifications: {
        telegram: {
          enabled: telegram?.enabled === true,
          level: telegram?.level ?? 2,
          defaultChatId: telegram?.defaultChatId,
          botToken: telegram?.botTokenEnv ? secretRef(telegram.botTokenEnv) : undefined,
          inbound: {
            enabled: telegram?.inbound?.enabled === true,
            webhookSecret: telegram?.inbound?.webhookSecretEnv
              ? secretRef(telegram.inbound.webhookSecretEnv)
              : undefined,
          },
        },
      },
    },
  }
}

function supabaseView(repos: Repos | undefined): AppConfigView["supabase"] {
  const workspace = currentWorkspaceRow(repos)
  const token = readSecretMetadata(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF)
  return {
    workspaceId: workspace?.id,
    projectRef: workspace?.supabase_project_ref ?? undefined,
    region: workspace?.supabase_region ?? undefined,
    persistentTestBranchName: workspace?.supabase_persistent_test_branch_name ?? undefined,
    persistentTestBranchRef: workspace?.supabase_persistent_test_branch_ref ?? undefined,
    persistentTestBranchStatus: workspace?.supabase_persistent_test_branch_status ?? undefined,
    lastCheckedAt: workspace?.supabase_last_checked_at ?? undefined,
    tokenPresent: token.present && token.active,
    branchGranularity: "wave",
    cleanupPolicy: workspace?.supabase_cleanup_policy ?? "on-success-immediate",
    cleanupTtlHours: workspace?.supabase_cleanup_ttl_hours ?? undefined,
    productionMigrationProtection: workspace?.supabase_protection_switch ?? "off",
    settingsVersion: workspace?.supabase_settings_version ?? 1,
    costRisk: {
      retainedBranchCount: repos?.countSupabaseRunsByLifecycle(["retained-for-diagnosis", "quota-exceeded"]) ?? 0,
      planLimitRatio: workspace?.supabase_branch_quota_usage != null && workspace.supabase_branch_quota_limit
        ? workspace.supabase_branch_quota_usage / workspace.supabase_branch_quota_limit
        : 0,
    },
  }
}

function currentWorkspaceView(repos: Repos | undefined, workspaceKey?: string): AppConfigView["workspace"] {
  const workspace = currentWorkspaceRow(repos, workspaceKey)
  if (!workspace) return null
  return { id: workspace.id, key: workspace.key, name: workspace.name }
}

function currentWorkspaceRow(repos: Repos | undefined, workspaceKey?: string) {
  if (workspaceKey) return repos?.getWorkspaceByKey(workspaceKey)
  return repos?.listWorkspaces()
    .sort((a, b) => (b.last_opened_at ?? 0) - (a.last_opened_at ?? 0) || a.key.localeCompare(b.key))
    .at(0)
}

function fileStateView(state: ConfigFileState): AppConfigView["configFile"] {
  if (state.kind === "invalid") return { kind: state.kind, path: state.path, error: state.error }
  return { kind: state.kind, path: state.path }
}

function secretRef(ref: string): SecretRefView {
  return { ref, present: Boolean(process.env[ref]) || readActiveSecretValue(ref) !== null }
}

function emptyConfigView(): AppConfigView["config"] {
  return {
    allowedRoots: [],
    enginePort: 4100,
    gitIdentityDefault: undefined,
    llm: {
      provider: "anthropic",
      model: "",
      defaultHarnessProfile: { mode: "claude-first" },
      apiKey: { ref: "ANTHROPIC_API_KEY", present: false },
    },
    vcs: { github: { enabled: false } },
    browser: { enabled: false },
    notifications: {
      telegram: {
        enabled: false,
        level: 2,
        inbound: { enabled: false },
      },
    },
  }
}
