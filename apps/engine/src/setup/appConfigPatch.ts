import { isAbsolute, parse as parsePath, resolve as resolvePath } from "node:path"
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

type PatchContext = {
  input: Record<string, unknown>
  next: AppConfig
  saved: string[]
  rejected: AppConfigPatchResult["rejected"]
}

function applyRootPatch({ input, next, saved, rejected }: PatchContext): void {
  if (!("allowedRoots" in input)) return
  applyField(saved, rejected, "allowedRoots", () => {
    if (
      !Array.isArray(input.allowedRoots)
      || input.allowedRoots.length === 0
      || input.allowedRoots.some(root => typeof root !== "string" || root.trim().length === 0)
    ) {
      throw new TypeError("allowedRoots must be a non-empty string array")
    }
    next.allowedRoots = input.allowedRoots.map(root => {
      const trimmed = root.trim()
      if (trimmed.split(/[\\/]+/).includes("..")) throw new TypeError("allowedRoots must not contain traversal segments")
      if (!isAbsolute(trimmed)) throw new TypeError("allowedRoots must contain absolute paths")
      const resolvedRoot = resolvePath(trimmed)
      if (resolvedRoot === parsePath(resolvedRoot).root) throw new TypeError("allowedRoots must not include filesystem root")
      return resolvedRoot
    })
  })
}

function applyEnginePatch({ input, next, saved, rejected }: PatchContext): void {
  if (!("enginePort" in input)) return
  applyField(saved, rejected, "enginePort", () => {
    if (!Number.isInteger(input.enginePort) || Number(input.enginePort) <= 0 || Number(input.enginePort) > 65535) {
      throw new TypeError("enginePort must be an integer between 1 and 65535")
    }
    next.enginePort = Number(input.enginePort)
  })
}

function applyPublicUrlPatch({ input, next, saved, rejected }: PatchContext): void {
  if (!("publicBaseUrl" in input)) return
  applyField(saved, rejected, "publicBaseUrl", () => {
    if (input.publicBaseUrl === undefined || input.publicBaseUrl === null || input.publicBaseUrl === "") {
      next.publicBaseUrl = undefined
      return
    }
    next.publicBaseUrl = normalizePublicBaseUrl(parseString(input.publicBaseUrl, "publicBaseUrl"))
  })
}

function applyLlmPatch({ input, next, saved, rejected }: PatchContext): void {
  const llm = optionalObject(input.llm)
  if ("provider" in llm) applyField(saved, rejected, "llm.provider", () => { next.llm.provider = parseProvider(llm.provider) })
  if ("model" in llm) applyField(saved, rejected, "llm.model", () => { next.llm.model = parseString(llm.model, "llm.model") })
  if ("apiKeyRef" in llm) applyField(saved, rejected, "llm.apiKeyRef", () => { next.llm.apiKeyRef = parseString(llm.apiKeyRef, "llm.apiKeyRef") })
  if ("defaultSonarOrganization" in llm) {
    applyField(saved, rejected, "llm.defaultSonarOrganization", () => {
      if (llm.defaultSonarOrganization === undefined || llm.defaultSonarOrganization === null || llm.defaultSonarOrganization === "") {
        next.llm.defaultSonarOrganization = undefined
        return
      }
      next.llm.defaultSonarOrganization = parseString(llm.defaultSonarOrganization, "llm.defaultSonarOrganization")
    })
  }
}

function applyVcsPatch({ input, next, saved, rejected }: PatchContext): void {
  const github = optionalObject(optionalObject(input.vcs).github)
  if (!("enabled" in github)) return
  applyField(saved, rejected, "vcs.github.enabled", () => {
    next.vcs ??= { github: { enabled: false } }
    next.vcs.github ??= { enabled: false }
    next.vcs.github.enabled = parseBoolean(github.enabled, "vcs.github.enabled")
  })
}

function applyBrowserPatch({ input, next, saved, rejected }: PatchContext): void {
  const browser = optionalObject(input.browser)
  if (!("enabled" in browser)) return
  applyField(saved, rejected, "browser.enabled", () => {
    next.browser ??= { enabled: false }
    next.browser.enabled = parseBoolean(browser.enabled, "browser.enabled")
  })
}

function applyNotificationsPatch({ input, next, saved, rejected }: PatchContext): void {
  const telegram = optionalObject(optionalObject(input.notifications).telegram)
  const inbound = optionalObject(telegram.inbound)
  if (Object.keys(telegram).length === 0 && Object.keys(inbound).length === 0) return
  next.notifications ??= { telegram: { enabled: false, level: 2, inbound: { enabled: false } } }
  next.notifications.telegram ??= { enabled: false, level: 2, inbound: { enabled: false } }
  const nextTelegram = next.notifications.telegram

  if ("enabled" in telegram) applyField(saved, rejected, "notifications.telegram.enabled", () => { nextTelegram.enabled = parseBoolean(telegram.enabled, "notifications.telegram.enabled") })
  if ("level" in telegram) applyField(saved, rejected, "notifications.telegram.level", () => { nextTelegram.level = parseTelegramLevel(telegram.level) })
  if ("defaultChatId" in telegram) {
    applyField(saved, rejected, "notifications.telegram.defaultChatId", () => {
      nextTelegram.defaultChatId = telegram.defaultChatId === undefined || telegram.defaultChatId === null || telegram.defaultChatId === ""
        ? undefined
        : parseString(telegram.defaultChatId, "notifications.telegram.defaultChatId")
    })
  }
  if ("botTokenEnv" in telegram) {
    applyField(saved, rejected, "notifications.telegram.botTokenEnv", () => {
      nextTelegram.botTokenEnv = telegram.botTokenEnv === undefined || telegram.botTokenEnv === null || telegram.botTokenEnv === ""
        ? undefined
        : parseString(telegram.botTokenEnv, "notifications.telegram.botTokenEnv")
    })
  }
  nextTelegram.inbound ??= { enabled: false }
  if ("enabled" in inbound) applyField(saved, rejected, "notifications.telegram.inbound.enabled", () => { nextTelegram.inbound!.enabled = parseBoolean(inbound.enabled, "notifications.telegram.inbound.enabled") })
  if ("webhookSecretEnv" in inbound) {
    applyField(saved, rejected, "notifications.telegram.inbound.webhookSecretEnv", () => {
      nextTelegram.inbound!.webhookSecretEnv = inbound.webhookSecretEnv === undefined || inbound.webhookSecretEnv === null || inbound.webhookSecretEnv === ""
        ? undefined
        : parseString(inbound.webhookSecretEnv, "notifications.telegram.inbound.webhookSecretEnv")
    })
  }
}

export function patchAppConfig(overrides: SetupOverrides = {}, patch: unknown = {}): AppConfigPatchResult {
  const resolved = resolveOverrides(overrides)
  const configPath = resolveConfigPath(resolved)
  const state = readConfigFile(configPath)
  if (state.kind === "missing") {
    return {
      ok: false,
      saved: [],
      rejected: [{ field: "config", error: "setup_config_missing" }],
      config: defaultAppConfig(),
    }
  }
  const current = resolveMergedConfig(state, resolved) ?? defaultAppConfig()
  const next: AppConfig = structuredClone(current)
  const context: PatchContext = {
    input: optionalObject(patch),
    next,
    saved: [],
    rejected: [],
  }

  applyRootPatch(context)
  applyEnginePatch(context)
  applyPublicUrlPatch(context)
  applyLlmPatch(context)
  applyVcsPatch(context)
  applyBrowserPatch(context)
  applyNotificationsPatch(context)

  if (context.saved.length > 0) writeConfigFile(configPath, next)
  return { ok: context.rejected.length === 0, saved: context.saved, rejected: context.rejected, config: next }
}
