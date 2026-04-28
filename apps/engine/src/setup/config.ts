import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, resolve } from "node:path"
import envPaths from "env-paths"
import type { AppConfig, ConfigFileState, LlmProvider, SetupOverrides } from "./types.js"
import type { HarnessProfile } from "../types/workspace.js"

export const CONFIG_SCHEMA_VERSION = 1
// Hold at 1 until we introduce a real from→to migrate runner. The idempotent
// ALTER TABLE helpers in db/connection.ts bring any DB up to current shape on
// every open, so bumping this number without a discrete step-2 runner would be
// a concept leak — `user_version` would claim "level 2" purely by side effect.
export const REQUIRED_MIGRATION_LEVEL = 1
export const KNOWN_GROUP_IDS = [
  "core",
  "notifications",
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

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"])

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  return LOOPBACK_HOSTS.has(normalized) || normalized.endsWith(".local")
}

export function normalizePublicBaseUrl(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error("publicBaseUrl must be a valid absolute URL")
  }

  if (!parsed.protocol || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
    throw new Error("publicBaseUrl must use http or https")
  }
  if (isLoopbackHostname(parsed.hostname)) {
    throw new Error("publicBaseUrl must not use a loopback or .local hostname")
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, "")
  if (!parsed.pathname) parsed.pathname = "/"
  return parsed.toString().replace(/\/$/, "")
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
    publicBaseUrl: undefined,
    llm: {
      provider: "anthropic",
      model: "claude-opus-4-7",
      apiKeyRef: "ANTHROPIC_API_KEY",
      defaultHarnessProfile: { mode: "claude-first" },
    },
    notifications: {
      telegram: {
        enabled: false,
        level: 2,
        inbound: {
          enabled: false,
        },
      },
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

export function validateHarnessProfileShape(input: unknown): HarnessProfile {
  if (!isObject(input) || typeof input.mode !== "string") {
    throw new Error("llm.defaultHarnessProfile must be an object with a mode")
  }

  if (
    input.mode === "codex-first" ||
    input.mode === "claude-first" ||
    input.mode === "codex-only" ||
    input.mode === "claude-only" ||
    input.mode === "fast" ||
    input.mode === "claude-sdk-first" ||
    input.mode === "codex-sdk-first" ||
    input.mode === "opencode-china" ||
    input.mode === "opencode-euro"
  ) {
    return { mode: input.mode }
  }

  if (input.mode === "opencode") {
    return validateOpenCodeHarnessProfile(input.roles)
  }

  if (input.mode === "self") {
    return validateSelfHarnessProfile(input.roles)
  }

  throw new TypeError("llm.defaultHarnessProfile.mode is invalid")
}

function validateOpenCodeHarnessProfile(roles: unknown): HarnessProfile {
  const parsedRoles = requireProviderRoles(roles, "opencode roles")
  return {
    mode: "opencode",
    roles: {
      coder: { provider: parsedRoles.coder.provider, model: parsedRoles.coder.model },
      reviewer: { provider: parsedRoles.reviewer.provider, model: parsedRoles.reviewer.model },
    },
  }
}

function validateSelfHarnessProfile(roles: unknown): HarnessProfile {
  const parsedRoles = requireProviderRoles(roles, "self roles")
  const coder = requireHarnessRole(parsedRoles.coder, "self roles")
  const reviewer = requireHarnessRole(parsedRoles.reviewer, "self roles")
  const mergeResolver = isObject(parsedRoles["merge-resolver"])
    ? requireHarnessRole(parsedRoles["merge-resolver"], "self roles[merge-resolver]")
    : undefined
  return {
    mode: "self",
    roles: {
      coder: serializeHarnessRole(coder),
      reviewer: serializeHarnessRole(reviewer),
      ...(mergeResolver ? { "merge-resolver": serializeHarnessRole(mergeResolver) } : {}),
    },
  }
}

function requireProviderRoles(roles: unknown, context: string) {
  if (!isObject(roles) || !isObject(roles.coder) || !isObject(roles.reviewer)) {
    throw new TypeError("llm.defaultHarnessProfile.roles must define coder and reviewer")
  }
  if (
    typeof roles.coder.provider !== "string"
    || typeof roles.coder.model !== "string"
    || typeof roles.reviewer.provider !== "string"
    || typeof roles.reviewer.model !== "string"
  ) {
    throw new TypeError(`${context} must define provider and model`)
  }
  return roles as {
    coder: { provider: string; model: string; harness?: unknown; runtime?: unknown }
    reviewer: { provider: string; model: string; harness?: unknown; runtime?: unknown }
    "merge-resolver"?: Record<string, unknown>
  }
}

function requireHarnessRole(role: Record<string, unknown>, context: string) {
  const isHarness = (value: unknown): value is "claude" | "codex" | "opencode" =>
    value === "claude" || value === "codex" || value === "opencode"
  const isRuntime = (value: unknown): value is "cli" | "sdk" | undefined =>
    value === undefined || value === "cli" || value === "sdk"
  if (!isHarness(role.harness)) {
    throw new TypeError(`${context} must define a valid harness`)
  }
  if (!isRuntime(role.runtime)) {
    throw new TypeError(`${context} "runtime" must be "cli" or "sdk" when set`)
  }
  return {
    harness: role.harness,
    provider: role.provider as string,
    model: role.model as string,
    ...(role.runtime ? { runtime: role.runtime } : {}),
  }
}

function serializeHarnessRole(role: {
  harness: "claude" | "codex" | "opencode"
  provider: string
  model: string
  runtime?: "cli" | "sdk"
}) {
  return {
    harness: role.harness,
    provider: role.provider,
    model: role.model,
    ...(role.runtime ? { runtime: role.runtime } : {}),
  }
}

function validateConfig(input: unknown): AppConfig {
  if (!input || typeof input !== "object") throw new TypeError("config must be an object")
  const config = input as Partial<AppConfig>
  const core = validateCoreConfig(config)
  const publicBaseUrl = validatePublicBaseUrl(config.publicBaseUrl)
  const llm = validateLlmConfig(config.llm)
  const defaultHarnessProfile = validateHarnessProfileShape((config.llm as AppConfig["llm"]).defaultHarnessProfile)
  const notifications = validateNotificationsConfig(config.notifications)
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    dataDir: core.dataDir,
    allowedRoots: [...core.allowedRoots],
    enginePort: core.enginePort,
    publicBaseUrl,
    llm: {
      provider: llm.provider,
      model: llm.model,
      apiKeyRef: llm.apiKeyRef,
      defaultHarnessProfile,
      defaultSonarOrganization: llm.defaultSonarOrganization,
    },
    notifications,
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

function validateCoreConfig(config: Partial<AppConfig>): Pick<AppConfig, "dataDir" | "allowedRoots" | "enginePort"> {
  if (config.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    throw new TypeError(`schemaVersion must be ${CONFIG_SCHEMA_VERSION}`)
  }
  if (typeof config.dataDir !== "string" || config.dataDir.length === 0) {
    throw new TypeError("dataDir must be a non-empty string")
  }
  if (!Array.isArray(config.allowedRoots) || config.allowedRoots.some(root => typeof root !== "string" || root.length === 0)) {
    throw new TypeError("allowedRoots must be a string array")
  }
  if (typeof config.enginePort !== "number" || !Number.isInteger(config.enginePort) || config.enginePort <= 0) {
    throw new TypeError("enginePort must be a positive integer")
  }
  return {
    dataDir: config.dataDir,
    allowedRoots: config.allowedRoots,
    enginePort: config.enginePort,
  }
}

function validatePublicBaseUrl(publicBaseUrl: unknown): string | undefined {
  if (publicBaseUrl === undefined) return undefined
  if (typeof publicBaseUrl !== "string") {
    throw new TypeError("publicBaseUrl must be a string when set")
  }
  return normalizePublicBaseUrl(publicBaseUrl)
}

function validateLlmConfig(llm: unknown): {
  provider: AppConfig["llm"]["provider"]
  model: string
  apiKeyRef: string
  defaultSonarOrganization?: string
} {
  if (!llm || typeof llm !== "object") throw new TypeError("llm config is required")
  const parsed = llm as Partial<AppConfig["llm"]>
  const provider = parseProvider(parsed.provider)
  if (!provider) throw new TypeError("llm.provider must be anthropic, openai, or opencode")
  if (typeof parsed.model !== "string" || parsed.model.length === 0) {
    throw new TypeError("llm.model must be a non-empty string")
  }
  if (typeof parsed.apiKeyRef !== "string" || parsed.apiKeyRef.length === 0) {
    throw new TypeError("llm.apiKeyRef must be a non-empty string")
  }
  if (parsed.defaultSonarOrganization !== undefined && typeof parsed.defaultSonarOrganization !== "string") {
    throw new TypeError("llm.defaultSonarOrganization must be a string when set")
  }
  return {
    provider,
    model: parsed.model,
    apiKeyRef: parsed.apiKeyRef,
    defaultSonarOrganization: parsed.defaultSonarOrganization,
  }
}

function validateNotificationsConfig(notifications: AppConfig["notifications"] | undefined): AppConfig["notifications"] {
  const telegram = validateTelegramConfig(notifications?.telegram)
  return {
    telegram: {
      enabled: telegram.enabled ?? false,
      botTokenEnv: telegram.botTokenEnv,
      defaultChatId: telegram.defaultChatId,
      level: telegram.level ?? 2,
      inbound: {
        enabled: telegram.inboundEnabled ?? false,
        webhookSecretEnv: telegram.webhookSecretEnv,
      },
    },
  }
}

function validateTelegramConfig(telegram: unknown): {
  enabled?: boolean
  botTokenEnv?: string
  defaultChatId?: string
  level?: 0 | 1 | 2
  inboundEnabled?: boolean
  webhookSecretEnv?: string
} {
  if (telegram !== undefined && !isObject(telegram)) {
    throw new TypeError("notifications.telegram must be an object when set")
  }
  const inbound = isObject(telegram?.inbound) ? telegram.inbound : telegram?.inbound
  if (inbound !== undefined && !isObject(inbound)) {
    throw new TypeError("notifications.telegram.inbound must be an object when set")
  }
  return {
    enabled: validateOptionalBoolean(telegram?.enabled, "notifications.telegram.enabled"),
    botTokenEnv: validateOptionalRequiredString(telegram?.botTokenEnv, "notifications.telegram.botTokenEnv"),
    defaultChatId: validateOptionalRequiredString(telegram?.defaultChatId, "notifications.telegram.defaultChatId"),
    level: validateTelegramLevel(telegram?.level),
    inboundEnabled: validateOptionalBoolean(inbound?.enabled, "notifications.telegram.inbound.enabled"),
    webhookSecretEnv: validateOptionalRequiredString(inbound?.webhookSecretEnv, "notifications.telegram.inbound.webhookSecretEnv"),
  }
}

function validateOptionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value === "boolean") return value
  throw new TypeError(`${field} must be a boolean when set`)
}

function validateOptionalRequiredString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  const normalized = normalizeOptionalString(value)
  if (!normalized) {
    throw new TypeError(`${field} must be a non-empty string when set`)
  }
  return normalized
}

function validateTelegramLevel(value: unknown): 0 | 1 | 2 | undefined {
  if (value === undefined) return undefined
  if (value === 0 || value === 1 || value === 2) return value
  throw new TypeError("notifications.telegram.level must be 0, 1, or 2 when set")
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
    publicBaseUrl: process.env.BEERENGINEER_PUBLIC_BASE_URL,
    llmProvider: parseProvider(process.env.BEERENGINEER_LLM_PROVIDER),
    llmModel: process.env.BEERENGINEER_LLM_MODEL,
    llmApiKeyRef: process.env.BEERENGINEER_LLM_API_KEY_REF,
    llmDefaultSonarOrganization: process.env.BEERENGINEER_LLM_DEFAULT_SONAR_ORG,
    telegramEnabled: coerceBoolean(process.env.BEERENGINEER_TELEGRAM_ENABLED),
    telegramBotTokenEnv: process.env.BEERENGINEER_TELEGRAM_BOT_TOKEN_ENV,
    telegramDefaultChatId: process.env.BEERENGINEER_TELEGRAM_DEFAULT_CHAT_ID,
    telegramLevel:
      process.env.BEERENGINEER_TELEGRAM_LEVEL === "0" || process.env.BEERENGINEER_TELEGRAM_LEVEL === "1" || process.env.BEERENGINEER_TELEGRAM_LEVEL === "2"
        ? Number(process.env.BEERENGINEER_TELEGRAM_LEVEL) as 0 | 1 | 2
        : undefined,
    telegramInboundEnabled: coerceBoolean(process.env.BEERENGINEER_TELEGRAM_INBOUND_ENABLED),
    telegramWebhookSecretEnv: process.env.BEERENGINEER_TELEGRAM_WEBHOOK_SECRET_ENV,
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
    publicBaseUrl: overrides.publicBaseUrl ?? base.publicBaseUrl,
    llm: {
      provider: overrides.llmProvider ?? base.llm.provider,
      model: overrides.llmModel ?? base.llm.model,
      apiKeyRef: overrides.llmApiKeyRef ?? base.llm.apiKeyRef,
      defaultHarnessProfile: base.llm.defaultHarnessProfile,
      defaultSonarOrganization: overrides.llmDefaultSonarOrganization ?? base.llm.defaultSonarOrganization,
    },
    notifications: {
      telegram: {
        enabled: overrides.telegramEnabled ?? base.notifications?.telegram?.enabled ?? false,
        botTokenEnv: overrides.telegramBotTokenEnv ?? base.notifications?.telegram?.botTokenEnv,
        defaultChatId: overrides.telegramDefaultChatId ?? base.notifications?.telegram?.defaultChatId,
        level: overrides.telegramLevel ?? base.notifications?.telegram?.level ?? 2,
        inbound: {
          enabled:
            overrides.telegramInboundEnabled ?? base.notifications?.telegram?.inbound?.enabled ?? false,
          webhookSecretEnv:
            overrides.telegramWebhookSecretEnv ?? base.notifications?.telegram?.inbound?.webhookSecretEnv,
        },
      },
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

/**
 * Returns the `dataDir` from the effective on-disk config, or `null` when the
 * config file is absent or unreadable.  Connection logic uses this to resolve
 * the DB path without importing the full merged-config machinery.
 *
 * Honors `BEERENGINEER_CONFIG_PATH` and `BEERENGINEER_DATA_DIR` so that test
 * harnesses can redirect both the config file and the data directory without
 * calling the full setup flow.
 */
export function getConfiguredDataDirOrNull(): string | null {
  // BEERENGINEER_DATA_DIR is the most direct override — respect it first.
  if (process.env.BEERENGINEER_DATA_DIR) return process.env.BEERENGINEER_DATA_DIR
  const configPath = process.env.BEERENGINEER_CONFIG_PATH ?? defaultConfigPath()
  const state = readConfigFile(configPath)
  if (state.kind === "ok") return state.config.dataDir
  return null
}
