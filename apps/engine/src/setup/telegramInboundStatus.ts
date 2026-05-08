import { readWorkspaceConfigSync } from "../core/workspaces.js"
import type { Repos } from "../db/repositories.js"
import { normalizePublicBaseUrl } from "./config.js"
import { readActiveSecretValue } from "./secretStore.js"
import type { AppConfig } from "./types.js"
import type { WorkspaceTelegramInboundConfig } from "../types/workspace.js"

export type TelegramConfigSource = "app-default" | "workspace-override"
export type TelegramReadinessState = "ready" | "blocked"

type TelegramScopeView =
  | {
      kind: "app-default"
      description: string
    }
  | {
      kind: "workspace"
      workspaceKey: string
      workspaceName: string
      inheritance: "inherited" | "mixed" | "override"
      description: string
    }

type TelegramFieldBase = {
  source: TelegramConfigSource
  configured: boolean
}

type TelegramFieldSources = {
  bot: TelegramConfigSource
  chat: TelegramConfigSource
  webhookSecret: TelegramConfigSource
  publicWebhook: TelegramConfigSource
}

type EffectiveTelegramInboundConfig = {
  enabled: boolean
  tokenRef?: string
  chatId?: string
  inboundEnabled: boolean
  webhookSecretRef?: string
  webhookSecretPresent: boolean
  publicBaseUrl?: string
  tokenPresent: boolean
  publicWebhook: {
    valid: boolean
    error?: string
    webhookUrl?: string
  }
}

export type TelegramInboundStatusView = {
  scope: TelegramScopeView
  readiness: {
    state: TelegramReadinessState
    blockers: string[]
  }
  fields: {
    bot: TelegramFieldBase & {
      enabled: boolean
      tokenRef?: string
      tokenPresent: boolean
    }
    chat: TelegramFieldBase & {
      chatId?: string
    }
    webhookSecret: TelegramFieldBase & {
      enabled: boolean
      secretRef?: string
      secretPresent: boolean
    }
    publicWebhook: TelegramFieldBase & {
      publicBaseUrl?: string
      valid: boolean
      error?: string
      webhookUrl?: string
    }
  }
}

type ResolvedWorkspaceTarget =
  | {
      ok: true
      workspace: NonNullable<Repos["getWorkspaceByKey"] extends (...args: never[]) => infer T ? T : never>
      override?: WorkspaceTelegramInboundConfig
    }
  | {
      ok: false
      error: "workspace_not_found"
      workspaceKey: string
    }

export function resolveTelegramInboundStatus(
  config: AppConfig | null,
  deps: { repos?: Repos; workspaceKey?: string } = {},
): TelegramInboundStatusView | null {
  if (!config) return null

  const workspaceTarget = resolveWorkspaceTarget(deps.repos, deps.workspaceKey)
  if (workspaceTarget && !workspaceTarget.ok) return null
  const workspaceOverride = workspaceTarget?.ok ? workspaceTarget.override : undefined
  const sources = resolveFieldSources(workspaceOverride)
  const effectiveConfig = resolveEffectiveTelegramConfig(config, workspaceOverride)
  const blockers = collectReadinessBlockers(effectiveConfig)

  return {
    scope: buildScopeView(workspaceTarget?.ok ? workspaceTarget.workspace : undefined, Object.values(sources)),
    readiness: {
      state: blockers.length === 0 ? "ready" : "blocked",
      blockers,
    },
    fields: buildFieldViews(sources, effectiveConfig),
  }
}

export function resolveTelegramWorkspaceTarget(
  repos: Repos | undefined,
  workspaceKey: string | undefined,
): ResolvedWorkspaceTarget | null {
  return resolveWorkspaceTarget(repos, workspaceKey)
}

function resolveWorkspaceTarget(repos: Repos | undefined, workspaceKey: string | undefined): ResolvedWorkspaceTarget | null {
  if (!workspaceKey) return null
  const workspace = repos?.getWorkspaceByKey(workspaceKey)
  if (!workspace?.root_path) {
    return { ok: false, error: "workspace_not_found", workspaceKey }
  }
  const config = readWorkspaceConfigSync(workspace.root_path)
  return { ok: true, workspace, override: config?.telegram }
}

function resolveFieldSources(workspaceOverride: WorkspaceTelegramInboundConfig | undefined): TelegramFieldSources {
  return {
    bot: sourceForWorkspaceOverride(
      workspaceOverride?.enabled !== undefined || workspaceOverride?.botTokenEnv !== undefined,
    ),
    chat: sourceForWorkspaceOverride(workspaceOverride?.defaultChatId !== undefined),
    webhookSecret: sourceForWorkspaceOverride(
      workspaceOverride?.inbound?.enabled !== undefined || workspaceOverride?.inbound?.webhookSecretEnv !== undefined,
    ),
    publicWebhook: sourceForWorkspaceOverride(workspaceOverride?.publicBaseUrl !== undefined),
  }
}

function sourceForWorkspaceOverride(overridden: boolean): TelegramConfigSource {
  return overridden ? "workspace-override" : "app-default"
}

function resolveEffectiveTelegramConfig(
  config: AppConfig,
  workspaceOverride: WorkspaceTelegramInboundConfig | undefined,
): EffectiveTelegramInboundConfig {
  const tokenRef = workspaceOverride?.botTokenEnv ?? config.notifications?.telegram?.botTokenEnv
  const webhookSecretRef =
    workspaceOverride?.inbound?.webhookSecretEnv ?? config.notifications?.telegram?.inbound?.webhookSecretEnv
  const publicBaseUrl = workspaceOverride?.publicBaseUrl ?? config.publicBaseUrl

  return {
    enabled: workspaceOverride?.enabled ?? config.notifications?.telegram?.enabled ?? false,
    tokenRef,
    chatId: workspaceOverride?.defaultChatId ?? config.notifications?.telegram?.defaultChatId,
    inboundEnabled: workspaceOverride?.inbound?.enabled ?? config.notifications?.telegram?.inbound?.enabled ?? false,
    webhookSecretRef,
    webhookSecretPresent: secretPresent(webhookSecretRef),
    publicBaseUrl,
    tokenPresent: secretPresent(tokenRef),
    publicWebhook: resolvePublicWebhook(publicBaseUrl),
  }
}

function buildFieldViews(
  sources: TelegramFieldSources,
  effectiveConfig: EffectiveTelegramInboundConfig,
): TelegramInboundStatusView["fields"] {
  return {
    bot: {
      source: sources.bot,
      configured: effectiveConfig.enabled && Boolean(effectiveConfig.tokenRef),
      enabled: effectiveConfig.enabled,
      tokenRef: effectiveConfig.tokenRef,
      tokenPresent: effectiveConfig.tokenPresent,
    },
    chat: {
      source: sources.chat,
      configured: Boolean(effectiveConfig.chatId),
      chatId: effectiveConfig.chatId,
    },
    webhookSecret: {
      source: sources.webhookSecret,
      configured: effectiveConfig.inboundEnabled && Boolean(effectiveConfig.webhookSecretRef),
      enabled: effectiveConfig.inboundEnabled,
      secretRef: effectiveConfig.webhookSecretRef,
      secretPresent: effectiveConfig.webhookSecretPresent,
    },
    publicWebhook: {
      source: sources.publicWebhook,
      configured: Boolean(effectiveConfig.publicBaseUrl),
      publicBaseUrl: effectiveConfig.publicBaseUrl,
      valid: effectiveConfig.publicWebhook.valid,
      error: effectiveConfig.publicWebhook.error,
      webhookUrl: effectiveConfig.publicWebhook.webhookUrl,
    },
  }
}

function buildScopeView(
  workspace: { key: string; name: string } | undefined,
  sources: TelegramConfigSource[],
): TelegramInboundStatusView["scope"] {
  if (!workspace) {
    return {
      kind: "app-default",
      description: "Using app-level defaults.",
    }
  }
  const overrideCount = sources.filter(source => source === "workspace-override").length
  if (overrideCount === 0) {
    return {
      kind: "workspace",
      workspaceKey: workspace.key,
      workspaceName: workspace.name,
      inheritance: "inherited",
      description: `Workspace ${workspace.key} is inheriting the app-level Telegram inbound defaults.`,
    }
  }
  if (overrideCount === sources.length) {
    return {
      kind: "workspace",
      workspaceKey: workspace.key,
      workspaceName: workspace.name,
      inheritance: "override",
      description: `Workspace ${workspace.key} is using its own Telegram inbound override for this workspace only.`,
    }
  }
  return {
    kind: "workspace",
    workspaceKey: workspace.key,
    workspaceName: workspace.name,
    inheritance: "mixed",
    description: `Workspace ${workspace.key} mixes app-level defaults with a workspace-specific Telegram inbound override.`,
  }
}

function secretPresent(ref: string | undefined): boolean {
  if (!ref) return false
  return Boolean(process.env[ref]) || readActiveSecretValue(ref) !== null
}

function resolvePublicWebhook(publicBaseUrl: string | undefined): {
  valid: boolean
  error?: string
  webhookUrl?: string
} {
  if (!publicBaseUrl) return { valid: false }
  try {
    const normalized = normalizePublicBaseUrl(publicBaseUrl)
    return { valid: true, webhookUrl: `${normalized}/webhooks/telegram` }
  } catch (error) {
    return { valid: false, error: (error as Error).message }
  }
}

function collectReadinessBlockers(input: EffectiveTelegramInboundConfig): string[] {
  const blockers: string[] = []
  if (!input.enabled) blockers.push("Telegram notifications are disabled.")
  if (!input.tokenRef) blockers.push("Telegram bot configuration is missing the bot token env var.")
  else if (!input.tokenPresent) blockers.push(`Telegram bot token is not present in ${input.tokenRef}.`)
  if (!input.chatId) blockers.push("Telegram chat configuration is missing the default chat id.")
  if (!input.inboundEnabled) blockers.push("Telegram inbound replies are disabled.")
  if (!input.webhookSecretRef) blockers.push("Telegram webhook secret presence is not configured.")
  else if (!input.webhookSecretPresent) blockers.push(`Telegram webhook secret is not present in ${input.webhookSecretRef}.`)
  if (!input.publicWebhook.valid) {
    blockers.push(input.publicWebhook.error
      ? `Public webhook configuration is invalid: ${input.publicWebhook.error}.`
      : "Public webhook configuration is missing the public base URL.")
  }
  return blockers
}
