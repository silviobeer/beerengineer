import {
  defaultAppConfig,
  normalizePublicBaseUrl,
  readConfigFile,
  resolveConfigPath,
  resolveMergedConfig,
  resolveOverrides,
  writeConfigFile,
} from "./config.js"
import type { AppConfig, LlmProvider, SetupOverrides } from "./types.js"

export type AppConfigPatchResult = {
  ok: boolean
  saved: string[]
  rejected: Array<{ field: string; error: string }>
  config: AppConfig
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function optionalObject(value: unknown): Record<string, unknown> {
  return isObject(value) ? value : {}
}

function parseBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${field} must be a boolean`)
  return value
}

function parseString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`)
  }
  return value.trim()
}

function parseProvider(value: unknown): LlmProvider {
  if (value === "anthropic" || value === "openai" || value === "opencode") return value
  throw new TypeError("llm.provider must be anthropic, openai, or opencode")
}

function parseTelegramLevel(value: unknown): 0 | 1 | 2 {
  if (value === 0 || value === 1 || value === 2) return value
  throw new TypeError("notifications.telegram.level must be 0, 1, or 2")
}

function applyField(
  saved: string[],
  rejected: AppConfigPatchResult["rejected"],
  field: string,
  apply: () => void,
): void {
  try {
    apply()
    saved.push(field)
  } catch (err) {
    rejected.push({ field, error: (err as Error).message })
  }
}

export function patchAppConfig(overrides: SetupOverrides = {}, patch: unknown = {}): AppConfigPatchResult {
  const resolved = resolveOverrides(overrides)
  const configPath = resolveConfigPath(resolved)
  const state = readConfigFile(configPath)
  const current = resolveMergedConfig(state, resolved) ?? defaultAppConfig()
  const next: AppConfig = structuredClone(current)
  const input = optionalObject(patch)
  const saved: string[] = []
  const rejected: AppConfigPatchResult["rejected"] = []

  if ("allowedRoots" in input) {
    applyField(saved, rejected, "allowedRoots", () => {
      if (
        !Array.isArray(input.allowedRoots)
        || input.allowedRoots.length === 0
        || input.allowedRoots.some(root => typeof root !== "string" || root.trim().length === 0)
      ) {
        throw new TypeError("allowedRoots must be a non-empty string array")
      }
      next.allowedRoots = input.allowedRoots.map(root => root.trim())
    })
  }

  if ("enginePort" in input) {
    applyField(saved, rejected, "enginePort", () => {
      if (!Number.isInteger(input.enginePort) || Number(input.enginePort) <= 0) {
        throw new TypeError("enginePort must be a positive integer")
      }
      next.enginePort = Number(input.enginePort)
    })
  }

  if ("publicBaseUrl" in input) {
    applyField(saved, rejected, "publicBaseUrl", () => {
      next.publicBaseUrl = input.publicBaseUrl === undefined || input.publicBaseUrl === null || input.publicBaseUrl === ""
        ? undefined
        : normalizePublicBaseUrl(parseString(input.publicBaseUrl, "publicBaseUrl"))
    })
  }

  const llm = optionalObject(input.llm)
  if ("provider" in llm) applyField(saved, rejected, "llm.provider", () => { next.llm.provider = parseProvider(llm.provider) })
  if ("model" in llm) applyField(saved, rejected, "llm.model", () => { next.llm.model = parseString(llm.model, "llm.model") })
  if ("apiKeyRef" in llm) applyField(saved, rejected, "llm.apiKeyRef", () => { next.llm.apiKeyRef = parseString(llm.apiKeyRef, "llm.apiKeyRef") })
  if ("defaultSonarOrganization" in llm) {
    applyField(saved, rejected, "llm.defaultSonarOrganization", () => {
      next.llm.defaultSonarOrganization = llm.defaultSonarOrganization === undefined || llm.defaultSonarOrganization === null || llm.defaultSonarOrganization === ""
        ? undefined
        : parseString(llm.defaultSonarOrganization, "llm.defaultSonarOrganization")
    })
  }

  const vcs = optionalObject(input.vcs)
  const github = optionalObject(vcs.github)
  if ("enabled" in github) {
    applyField(saved, rejected, "vcs.github.enabled", () => {
      next.vcs ??= { github: { enabled: false } }
      next.vcs.github ??= { enabled: false }
      next.vcs.github.enabled = parseBoolean(github.enabled, "vcs.github.enabled")
    })
  }

  const browser = optionalObject(input.browser)
  if ("enabled" in browser) {
    applyField(saved, rejected, "browser.enabled", () => {
      next.browser ??= { enabled: false }
      next.browser.enabled = parseBoolean(browser.enabled, "browser.enabled")
    })
  }

  const notifications = optionalObject(input.notifications)
  const telegram = optionalObject(notifications.telegram)
  next.notifications ??= { telegram: { enabled: false, level: 2, inbound: { enabled: false } } }
  next.notifications.telegram ??= { enabled: false, level: 2, inbound: { enabled: false } }
  if ("enabled" in telegram) applyField(saved, rejected, "notifications.telegram.enabled", () => { next.notifications!.telegram!.enabled = parseBoolean(telegram.enabled, "notifications.telegram.enabled") })
  if ("level" in telegram) applyField(saved, rejected, "notifications.telegram.level", () => { next.notifications!.telegram!.level = parseTelegramLevel(telegram.level) })
  if ("defaultChatId" in telegram) {
    applyField(saved, rejected, "notifications.telegram.defaultChatId", () => {
      next.notifications!.telegram!.defaultChatId = telegram.defaultChatId === undefined || telegram.defaultChatId === null || telegram.defaultChatId === ""
        ? undefined
        : parseString(telegram.defaultChatId, "notifications.telegram.defaultChatId")
    })
  }
  if ("botTokenEnv" in telegram) {
    applyField(saved, rejected, "notifications.telegram.botTokenEnv", () => {
      next.notifications!.telegram!.botTokenEnv = telegram.botTokenEnv === undefined || telegram.botTokenEnv === null || telegram.botTokenEnv === ""
        ? undefined
        : parseString(telegram.botTokenEnv, "notifications.telegram.botTokenEnv")
    })
  }
  const inbound = optionalObject(telegram.inbound)
  next.notifications.telegram.inbound ??= { enabled: false }
  if ("enabled" in inbound) applyField(saved, rejected, "notifications.telegram.inbound.enabled", () => { next.notifications!.telegram!.inbound!.enabled = parseBoolean(inbound.enabled, "notifications.telegram.inbound.enabled") })
  if ("webhookSecretEnv" in inbound) {
    applyField(saved, rejected, "notifications.telegram.inbound.webhookSecretEnv", () => {
      next.notifications!.telegram!.inbound!.webhookSecretEnv = inbound.webhookSecretEnv === undefined || inbound.webhookSecretEnv === null || inbound.webhookSecretEnv === ""
        ? undefined
        : parseString(inbound.webhookSecretEnv, "notifications.telegram.inbound.webhookSecretEnv")
    })
  }

  if (saved.length > 0) writeConfigFile(configPath, next)
  return { ok: rejected.length === 0, saved, rejected, config: next }
}
