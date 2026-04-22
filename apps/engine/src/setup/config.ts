import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, resolve } from "node:path"
import envPaths from "env-paths"
import type { AppConfig, ConfigFileState, LlmProvider, SetupOverrides } from "./types.js"
import type { HarnessProfile } from "../types/workspace.js"

export const CONFIG_SCHEMA_VERSION = 1
export const REQUIRED_MIGRATION_LEVEL = 2
export const KNOWN_GROUP_IDS = [
  "core",
  "vcs.github",
  "llm.anthropic",
  "llm.openai",
  "llm.opencode",
  "browser-agent",
  "review",
] as const

const appPaths = envPaths("beerengineer")

function coerceBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined
  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) return true
  if (["0", "false", "no", "off"].includes(value.toLowerCase())) return false
  return undefined
}

function parseAllowedRoots(value: string | undefined): string[] | undefined {
  if (!value) return undefined
  return value
    .split(process.platform === "win32" ? ";" : ":")
    .map(part => part.trim())
    .filter(Boolean)
}

function parseProvider(value: string | undefined): LlmProvider | undefined {
  if (value === "anthropic" || value === "openai" || value === "opencode") return value
  return undefined
}

export function defaultConfigPath(): string {
  return resolve(appPaths.config, "config.json")
}

export function defaultDataDir(): string {
  return appPaths.data
}

export function defaultAppConfig(): AppConfig {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    dataDir: defaultDataDir(),
    allowedRoots: [resolve(homedir(), "projects")],
    enginePort: 4100,
    llm: {
      provider: "anthropic",
      model: "claude-opus-4-7",
      apiKeyRef: "ANTHROPIC_API_KEY",
      defaultHarnessProfile: { mode: "claude-first" },
    },
    vcs: {
      github: {
        enabled: false,
      },
    },
    browser: {
      enabled: false,
    },
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object"
}

function validateHarnessProfileShape(input: unknown): HarnessProfile {
  if (!isObject(input) || typeof input.mode !== "string") {
    throw new Error("llm.defaultHarnessProfile must be an object with a mode")
  }

  if (
    input.mode === "codex-first" ||
    input.mode === "claude-first" ||
    input.mode === "codex-only" ||
    input.mode === "claude-only" ||
    input.mode === "fast"
  ) {
    return { mode: input.mode }
  }

  if (input.mode === "opencode") {
    const roles = input.roles
    if (!isObject(roles) || !isObject(roles.coder) || !isObject(roles.reviewer)) {
      throw new Error("llm.defaultHarnessProfile.roles must define coder and reviewer")
    }
    if (typeof roles.coder.provider !== "string" || typeof roles.coder.model !== "string" || typeof roles.reviewer.provider !== "string" || typeof roles.reviewer.model !== "string") {
      throw new Error("opencode roles must define provider and model")
    }
    return {
      mode: "opencode",
      roles: {
        coder: { provider: roles.coder.provider, model: roles.coder.model },
        reviewer: { provider: roles.reviewer.provider, model: roles.reviewer.model },
      },
    }
  }

  if (input.mode === "self") {
    const roles = input.roles
    if (!isObject(roles) || !isObject(roles.coder) || !isObject(roles.reviewer)) {
      throw new Error("llm.defaultHarnessProfile.roles must define coder and reviewer")
    }
    const isHarness = (value: unknown): value is "claude" | "codex" | "opencode" =>
      value === "claude" || value === "codex" || value === "opencode"
    if (!isHarness(roles.coder.harness) || !isHarness(roles.reviewer.harness)) {
      throw new Error("self roles must define a valid harness")
    }
    if (typeof roles.coder.provider !== "string" || typeof roles.coder.model !== "string" || typeof roles.reviewer.provider !== "string" || typeof roles.reviewer.model !== "string") {
      throw new Error("self roles must define provider and model")
    }
    return {
      mode: "self",
      roles: {
        coder: { harness: roles.coder.harness, provider: roles.coder.provider, model: roles.coder.model },
        reviewer: { harness: roles.reviewer.harness, provider: roles.reviewer.provider, model: roles.reviewer.model },
      },
    }
  }

  throw new Error("llm.defaultHarnessProfile.mode is invalid")
}

function validateConfig(input: unknown): AppConfig {
  if (!input || typeof input !== "object") throw new Error("config must be an object")
  const config = input as Partial<AppConfig>
  if (config.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    throw new Error(`schemaVersion must be ${CONFIG_SCHEMA_VERSION}`)
  }
  if (typeof config.dataDir !== "string" || config.dataDir.length === 0) {
    throw new Error("dataDir must be a non-empty string")
  }
  if (!Array.isArray(config.allowedRoots) || config.allowedRoots.some(root => typeof root !== "string" || root.length === 0)) {
    throw new Error("allowedRoots must be a string array")
  }
  if (typeof config.enginePort !== "number" || !Number.isInteger(config.enginePort) || config.enginePort <= 0) {
    throw new Error("enginePort must be a positive integer")
  }
  if (!config.llm || typeof config.llm !== "object") throw new Error("llm config is required")
  if (!parseProvider(config.llm.provider)) throw new Error("llm.provider must be anthropic, openai, or opencode")
  if (typeof config.llm.model !== "string" || config.llm.model.length === 0) {
    throw new Error("llm.model must be a non-empty string")
  }
  if (typeof config.llm.apiKeyRef !== "string" || config.llm.apiKeyRef.length === 0) {
    throw new Error("llm.apiKeyRef must be a non-empty string")
  }
  const defaultHarnessProfile = validateHarnessProfileShape(config.llm.defaultHarnessProfile)
  if (config.llm.defaultSonarOrganization !== undefined && typeof config.llm.defaultSonarOrganization !== "string") {
    throw new Error("llm.defaultSonarOrganization must be a string when set")
  }
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    dataDir: config.dataDir,
    allowedRoots: [...config.allowedRoots],
    enginePort: config.enginePort,
    llm: {
      provider: config.llm.provider,
      model: config.llm.model,
      apiKeyRef: config.llm.apiKeyRef,
      defaultHarnessProfile,
      defaultSonarOrganization: config.llm.defaultSonarOrganization,
    },
    vcs: {
      github: {
        enabled: config.vcs?.github?.enabled === true,
      },
    },
    browser: {
      enabled: config.browser?.enabled === true,
    },
  }
}

export function readConfigFile(configPath = defaultConfigPath()): ConfigFileState {
  if (!existsSync(configPath)) return { kind: "missing", path: configPath }
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf8")) as unknown
    return { kind: "ok", path: configPath, config: validateConfig(raw) }
  } catch (err) {
    return { kind: "invalid", path: configPath, error: (err as Error).message }
  }
}

function envOverrides(): SetupOverrides {
  const enginePort = process.env.BEERENGINEER_ENGINE_PORT
  const parsedPort = enginePort ? Number(enginePort) : undefined
  return {
    configPath: process.env.BEERENGINEER_CONFIG_PATH,
    dataDir: process.env.BEERENGINEER_DATA_DIR,
    allowedRoots: parseAllowedRoots(process.env.BEERENGINEER_ALLOWED_ROOTS),
    enginePort: Number.isInteger(parsedPort) ? parsedPort : undefined,
    llmProvider: parseProvider(process.env.BEERENGINEER_LLM_PROVIDER),
    llmModel: process.env.BEERENGINEER_LLM_MODEL,
    llmApiKeyRef: process.env.BEERENGINEER_LLM_API_KEY_REF,
    llmDefaultSonarOrganization: process.env.BEERENGINEER_LLM_DEFAULT_SONAR_ORG,
    githubEnabled: coerceBoolean(process.env.BEERENGINEER_GITHUB_ENABLED),
    browserEnabled: coerceBoolean(process.env.BEERENGINEER_BROWSER_ENABLED),
  }
}

export function resolveOverrides(cli: SetupOverrides = {}): SetupOverrides {
  return { ...envOverrides(), ...cli }
}

export function resolveConfigPath(overrides: SetupOverrides = {}): string {
  return overrides.configPath ?? defaultConfigPath()
}

export function resolveMergedConfig(state: ConfigFileState, overrides: SetupOverrides = {}): AppConfig | null {
  if (state.kind === "invalid") return null
  const base = state.kind === "ok" ? state.config : defaultAppConfig()
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    dataDir: overrides.dataDir ?? base.dataDir,
    allowedRoots: overrides.allowedRoots ?? base.allowedRoots,
    enginePort: overrides.enginePort ?? base.enginePort,
    llm: {
      provider: overrides.llmProvider ?? base.llm.provider,
      model: overrides.llmModel ?? base.llm.model,
      apiKeyRef: overrides.llmApiKeyRef ?? base.llm.apiKeyRef,
      defaultHarnessProfile: base.llm.defaultHarnessProfile,
      defaultSonarOrganization: overrides.llmDefaultSonarOrganization ?? base.llm.defaultSonarOrganization,
    },
    vcs: {
      github: {
        enabled: overrides.githubEnabled ?? base.vcs?.github?.enabled ?? false,
      },
    },
    browser: {
      enabled: overrides.browserEnabled ?? base.browser?.enabled ?? false,
    },
  }
}

export function writeConfigFile(configPath: string, config: AppConfig): void {
  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8")
}

export function resolveConfiguredDbPath(config: Pick<AppConfig, "dataDir">): string {
  return resolve(config.dataDir, "beerengineer.sqlite")
}
