import {
  readConfigFile,
  resolveConfigPath,
  resolveMergedConfig,
  resolveOverrides,
} from "./config.js"
import type { AppConfig, ConfigFileState, SetupOverrides } from "./types.js"

export type SecretRefView = {
  ref: string
  present: boolean
}

export type AppConfigSetupState = "uninitialized" | "partial" | "complete"

export type AppConfigView = {
  setupState: AppConfigSetupState
  configPath: string
  configFile: Pick<ConfigFileState, "kind" | "path"> & { error?: string }
  config: {
    allowedRoots: string[]
    enginePort: number
    publicBaseUrl?: string
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

export function getAppConfigView(overrides: SetupOverrides = {}): AppConfigView {
  const resolved = resolveOverrides(overrides)
  const configPath = resolveConfigPath(resolved)
  const configState = readConfigFile(configPath)
  const config = resolveMergedConfig(configState, resolved)
  if (!config) {
    return {
      setupState: configState.kind === "missing" ? "uninitialized" : "partial",
      configPath,
      configFile: fileStateView(configState),
      config: emptyConfigView(),
    }
  }

  const telegram = config.notifications?.telegram
  return {
    setupState: configState.kind === "missing" ? "uninitialized" : "complete",
    configPath,
    configFile: fileStateView(configState),
    config: {
      allowedRoots: [...config.allowedRoots],
      enginePort: config.enginePort,
      publicBaseUrl: config.publicBaseUrl,
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

function fileStateView(state: ConfigFileState): AppConfigView["configFile"] {
  if (state.kind === "invalid") return { kind: state.kind, path: state.path, error: state.error }
  return { kind: state.kind, path: state.path }
}

function secretRef(ref: string): SecretRefView {
  return { ref, present: Boolean(process.env[ref]) }
}

function emptyConfigView(): AppConfigView["config"] {
  return {
    allowedRoots: [],
    enginePort: 4100,
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
