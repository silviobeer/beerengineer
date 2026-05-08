import { readWorkspaceConfigSync } from "../core/workspaces.js"
import type { Repos, TelegramSetupStateRow } from "../db/repositories.js"
import { redactSecrets, sanitizeTelegramText } from "../notifications/telegram.js"
import { readActiveSecretValue } from "./secretStore.js"
import type { AppConfig } from "./types.js"
import type { WorkspaceTelegramInboundConfig } from "../types/workspace.js"

const TELEGRAM_TIMEOUT_MS = 5_000
const DEFAULT_VERIFICATION_TIMEOUT_MS = 60_000

export type TelegramProviderWebhookState = {
  url?: string
  pendingUpdateCount: number
  hasCustomCertificate: boolean
  ipAddress?: string
  lastErrorDate?: number
  lastErrorMessage?: string
  lastSynchronizationErrorDate?: number
  maxConnections?: number
  allowedUpdates?: string[]
}

export type TelegramBaselineView = {
  state: "not-run" | "ready" | "blocked"
  message?: string
  checkedAt?: number
}

export type TelegramLiveVerificationView = {
  state: "not-run" | "pending" | "succeeded" | "failed" | "timed_out"
  message?: string
  startedAt?: number
  completedAt?: number
  deadlineAt?: number
}

export type TelegramSetupStatusViews = {
  baseline: TelegramBaselineView
  liveVerification: TelegramLiveVerificationView
  provider?: TelegramProviderWebhookState
  providerCheckedAt?: number
}

type TelegramWorkspaceTargetOk = {
  ok: true
  workspaceKey?: string
  workspaceName?: string
  workspaceOverride?: WorkspaceTelegramInboundConfig
}

type TelegramWorkspaceTarget =
  | TelegramWorkspaceTargetOk
  | {
      ok: false
      workspaceKey: string
      error: "workspace_not_found"
    }

export type ResolvedTelegramSetupScope =
  | (TelegramWorkspaceTargetOk & {
      scopeKey: string
      tokenRef?: string
      token?: string
      chatId?: string
      webhookSecretRef?: string
      webhookSecret?: string
      publicBaseUrl?: string
      expectedWebhookUrl?: string
      localBlockers: string[]
    })
  | Extract<TelegramWorkspaceTarget, { ok: false }>

type TelegramApiResponse<T> =
  | { ok: true; result: T }
  | { ok: false; error: string; message: string }

type TelegramActionResult =
  | {
      ok: true
      scopeKey: string
      baseline: TelegramBaselineView
      liveVerification: TelegramLiveVerificationView
      provider: TelegramProviderWebhookState
      providerCheckedAt?: number
    }
  | {
      ok: false
      status: number
      error: string
      message: string
      baseline: TelegramBaselineView
      liveVerification: TelegramLiveVerificationView
      provider?: TelegramProviderWebhookState
      providerCheckedAt?: number
    }

function now(): number {
  return Date.now()
}

function resolveTelegramApiBaseUrl(): string {
  return (process.env.BEERENGINEER_TELEGRAM_API_BASE_URL ?? "https://api.telegram.org").replace(/\/+$/, "")
}

function readSecret(ref: string | undefined): string | undefined {
  if (!ref) return undefined
  const env = process.env[ref]?.trim()
  if (env) return env
  const stored = readActiveSecretValue(ref)?.trim()
  return stored || undefined
}

function readWorkspaceTarget(repos: Repos | undefined, workspaceKey: string | undefined): TelegramWorkspaceTarget {
  if (!workspaceKey) return { ok: true }
  const workspace = repos?.getWorkspaceByKey(workspaceKey)
  if (!workspace?.root_path) {
    return { ok: false, workspaceKey, error: "workspace_not_found" }
  }
  const workspaceConfig = readWorkspaceConfigSync(workspace.root_path)
  return {
    ok: true,
    workspaceKey: workspace.key,
    workspaceName: workspace.name,
    workspaceOverride: workspaceConfig?.telegram,
  }
}

function validateWebhookUrl(publicBaseUrl: string | undefined): { ok: true; url: string } | { ok: false; message: string } {
  if (!publicBaseUrl?.trim()) {
    return { ok: false, message: "Telegram webhook setup requires a public HTTPS callback URL." }
  }

  let parsed: URL
  try {
    parsed = new URL(publicBaseUrl)
  } catch {
    return { ok: false, message: "Telegram webhook setup requires a valid public callback URL." }
  }

  if (parsed.protocol !== "https:") {
    return { ok: false, message: "Telegram webhook setup requires an HTTPS callback URL." }
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, "")
  const base = parsed.toString().replace(/\/$/, "")
  return { ok: true, url: `${base}/webhooks/telegram` }
}

export function resolveTelegramSetupScope(
  config: AppConfig | null,
  deps: { repos?: Repos; workspaceKey?: string } = {},
): ResolvedTelegramSetupScope {
  const target = readWorkspaceTarget(deps.repos, deps.workspaceKey)
  if (!target.ok) return target
  if (!config) {
    return {
      ...target,
      ok: true,
      scopeKey: target.workspaceKey ?? "app-default",
      localBlockers: ["App config is missing or invalid. Run `beerengineer setup` first."],
    }
  }

  const telegram = config.notifications?.telegram
  const tokenRef = target.workspaceOverride?.botTokenEnv ?? telegram?.botTokenEnv
  const chatId = target.workspaceOverride?.defaultChatId ?? telegram?.defaultChatId
  const webhookSecretRef = target.workspaceOverride?.inbound?.webhookSecretEnv ?? telegram?.inbound?.webhookSecretEnv
  const publicBaseUrl = target.workspaceOverride?.publicBaseUrl ?? config.publicBaseUrl
  const validation = validateWebhookUrl(publicBaseUrl)
  const blockers: string[] = []

  if (target.workspaceOverride?.enabled ?? telegram?.enabled ?? false) {
    if (!tokenRef) blockers.push("Telegram bot configuration is missing the bot token env var.")
    else if (!readSecret(tokenRef)) blockers.push(`Telegram bot token is not present in ${tokenRef}.`)
    if (!chatId) blockers.push("Telegram chat configuration is missing the default chat id.")
    if (!(target.workspaceOverride?.inbound?.enabled ?? telegram?.inbound?.enabled ?? false)) {
      blockers.push("Telegram inbound replies are disabled.")
    }
    if (!webhookSecretRef) blockers.push("Telegram webhook secret presence is not configured.")
    else if (!readSecret(webhookSecretRef)) blockers.push(`Telegram webhook secret is not present in ${webhookSecretRef}.`)
  } else {
    blockers.push("Telegram notifications are disabled.")
  }

  if (!validation.ok) blockers.push(validation.message)

  return {
    ...target,
    ok: true,
    scopeKey: target.workspaceKey ?? "app-default",
    tokenRef,
    token: readSecret(tokenRef),
    chatId,
    webhookSecretRef,
    webhookSecret: readSecret(webhookSecretRef),
    publicBaseUrl,
    expectedWebhookUrl: validation.ok ? validation.url : undefined,
    localBlockers: blockers,
  }
}

function redactTelegramMessage(message: string, secrets: string[]): string {
  return sanitizeTelegramText(message, secrets)
}

async function callTelegramApi<T>(
  token: string,
  method: string,
  opts: { httpMethod?: "GET" | "POST"; body?: Record<string, unknown>; secrets?: string[] } = {},
): Promise<TelegramApiResponse<T>> {
  const response = await fetch(`${resolveTelegramApiBaseUrl()}/bot${encodeURIComponent(token)}/${method}`, {
    method: opts.httpMethod ?? "POST",
    headers: opts.body ? { "content-type": "application/json" } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
  }).catch(error => ({ ok: false, error } as const))

  if (!("ok" in response) || response instanceof Response) {
    // no-op
  } else {
    return {
      ok: false,
      error: "telegram_request_failed",
      message: redactTelegramMessage(`Telegram request failed: ${(response.error as Error).message}`, opts.secrets ?? []),
    }
  }

  let body: { ok?: boolean; result?: T; description?: string; error_code?: number }
  try {
    body = await response.json() as { ok?: boolean; result?: T; description?: string; error_code?: number }
  } catch {
    return {
      ok: false,
      error: "telegram_response_invalid",
      message: redactTelegramMessage(`Telegram returned HTTP ${response.status} with an unreadable response body.`, opts.secrets ?? []),
    }
  }

  if (!response.ok || body.ok !== true) {
    const detail = body.description?.trim() || `Telegram returned HTTP ${response.status}.`
    return {
      ok: false,
      error: "telegram_request_failed",
      message: redactTelegramMessage(detail, opts.secrets ?? []),
    }
  }

  return { ok: true, result: body.result as T }
}

function normalizeProviderState(raw: Record<string, unknown>): TelegramProviderWebhookState {
  return {
    url: typeof raw.url === "string" && raw.url.trim() ? raw.url.trim() : undefined,
    pendingUpdateCount: typeof raw.pending_update_count === "number" ? raw.pending_update_count : 0,
    hasCustomCertificate: raw.has_custom_certificate === true,
    ipAddress: typeof raw.ip_address === "string" ? raw.ip_address : undefined,
    lastErrorDate: typeof raw.last_error_date === "number" ? raw.last_error_date : undefined,
    lastErrorMessage: typeof raw.last_error_message === "string" ? raw.last_error_message : undefined,
    lastSynchronizationErrorDate:
      typeof raw.last_synchronization_error_date === "number" ? raw.last_synchronization_error_date : undefined,
    maxConnections: typeof raw.max_connections === "number" ? raw.max_connections : undefined,
    allowedUpdates: Array.isArray(raw.allowed_updates)
      ? raw.allowed_updates.filter((entry): entry is string => typeof entry === "string")
      : undefined,
  }
}

function parseStoredProviderState(row: TelegramSetupStateRow | undefined): TelegramProviderWebhookState | undefined {
  if (!row?.provider_state_json) return undefined
  try {
    return normalizeProviderState(JSON.parse(row.provider_state_json) as Record<string, unknown>)
  } catch {
    return undefined
  }
}

export function readTelegramSetupStatusViews(
  scope: Extract<ResolvedTelegramSetupScope, { ok: true }>,
  repos: Repos | undefined,
): TelegramSetupStatusViews {
  const row = repos?.getTelegramSetupState(scope.scopeKey)
  const provider = parseStoredProviderState(row)
  const baseline = resolveBaselineView(scope, row)
  const liveVerification = resolveLiveVerificationView(row)
  return {
    baseline,
    liveVerification,
    provider,
    providerCheckedAt: row?.baseline_checked_at ?? undefined,
  }
}

function resolveBaselineView(
  scope: Extract<ResolvedTelegramSetupScope, { ok: true }>,
  row: TelegramSetupStateRow | undefined,
): TelegramBaselineView {
  if (scope.localBlockers.length > 0) {
    return {
      state: "blocked",
      message: scope.localBlockers.join(" "),
      checkedAt: row?.baseline_checked_at ?? undefined,
    }
  }

  if (!row) return { state: "not-run" }
  if (row.expected_webhook_url !== scope.expectedWebhookUrl) {
    return {
      state: "blocked",
      message: "Telegram webhook configuration changed since the last setup run. Re-run setup to confirm the current callback URL.",
      checkedAt: row.baseline_checked_at ?? undefined,
    }
  }
  return {
    state: row.baseline_status,
    message: row.baseline_message ?? undefined,
    checkedAt: row.baseline_checked_at ?? undefined,
  }
}

function resolveLiveVerificationView(row: TelegramSetupStateRow | undefined): TelegramLiveVerificationView {
  if (!row) return { state: "not-run" }
  if (row.verification_status === "pending" && row.verification_deadline_at && row.verification_deadline_at <= now()) {
    return {
      state: "timed_out",
      message: "Live verification timed out before a matching Telegram reply arrived.",
      startedAt: row.verification_started_at ?? undefined,
      deadlineAt: row.verification_deadline_at,
    }
  }
  return {
    state: row.verification_status,
    message: row.verification_message ?? undefined,
    startedAt: row.verification_started_at ?? undefined,
    completedAt: row.verification_completed_at ?? undefined,
    deadlineAt: row.verification_deadline_at ?? undefined,
  }
}

function actionFailure(
  status: number,
  error: string,
  message: string,
  scopeKey: string,
  repos: Repos,
): TelegramActionResult {
  const scope = repos.getTelegramSetupState(scopeKey)
  const provider = parseStoredProviderState(scope)
  return {
    ok: false,
    status,
    error,
    message,
    baseline: {
      state: scope?.baseline_status ?? "blocked",
      message: scope?.baseline_message ?? message,
      checkedAt: scope?.baseline_checked_at ?? undefined,
    },
    liveVerification: resolveLiveVerificationView(scope),
    provider,
    providerCheckedAt: scope?.baseline_checked_at ?? undefined,
  }
}

export async function registerTelegramWebhook(input: {
  repos: Repos
  config: AppConfig | null
  workspaceKey?: string
}): Promise<TelegramActionResult> {
  const scope = resolveTelegramSetupScope(input.config, { repos: input.repos, workspaceKey: input.workspaceKey })
  if (!scope.ok) {
    return {
      ok: false,
      status: 404,
      error: "workspace_not_found",
      message: `Workspace not found: ${scope.workspaceKey}`,
      baseline: { state: "blocked", message: `Workspace not found: ${scope.workspaceKey}` },
      liveVerification: { state: "not-run" },
    }
  }
  if (scope.localBlockers.length > 0 || !scope.expectedWebhookUrl || !scope.token || !scope.webhookSecret) {
    return {
      ok: false,
      status: 400,
      error: "telegram_webhook_setup_invalid",
      message: scope.localBlockers[0] ?? "Telegram webhook setup is not ready to run.",
      baseline: { state: "blocked", message: scope.localBlockers.join(" ") },
      liveVerification: { state: "not-run" },
    }
  }

  const secrets = [scope.token, scope.webhookSecret]
  const setWebhook = await callTelegramApi<boolean>(scope.token, "setWebhook", {
    body: {
      url: scope.expectedWebhookUrl,
      secret_token: scope.webhookSecret,
    },
    secrets,
  })
  if (!setWebhook.ok) {
    input.repos.upsertTelegramSetupState({
      scopeKey: scope.scopeKey,
      workspaceKey: scope.workspaceKey ?? null,
      expectedWebhookUrl: scope.expectedWebhookUrl,
      baselineStatus: "blocked",
      baselineMessage: setWebhook.message,
      providerStateJson: null,
      baselineCheckedAt: now(),
    })
    return actionFailure(400, setWebhook.error, setWebhook.message, scope.scopeKey, input.repos)
  }

  const webhookInfo = await callTelegramApi<Record<string, unknown>>(scope.token, "getWebhookInfo", {
    httpMethod: "GET",
    secrets,
  })
  if (!webhookInfo.ok) {
    input.repos.upsertTelegramSetupState({
      scopeKey: scope.scopeKey,
      workspaceKey: scope.workspaceKey ?? null,
      expectedWebhookUrl: scope.expectedWebhookUrl,
      baselineStatus: "blocked",
      baselineMessage: webhookInfo.message,
      providerStateJson: null,
      baselineCheckedAt: now(),
    })
    return actionFailure(400, webhookInfo.error, webhookInfo.message, scope.scopeKey, input.repos)
  }

  const provider = normalizeProviderState(webhookInfo.result)
  const checkedAt = now()
  const baselineMessage = provider.url === scope.expectedWebhookUrl
    ? "Telegram webhook matches the configured callback URL."
    : `Telegram reports webhook URL ${provider.url ?? "missing"} instead of the configured callback URL.`

  const persisted = input.repos.upsertTelegramSetupState({
    scopeKey: scope.scopeKey,
    workspaceKey: scope.workspaceKey ?? null,
    expectedWebhookUrl: scope.expectedWebhookUrl,
    baselineStatus: provider.url === scope.expectedWebhookUrl ? "ready" : "blocked",
    baselineMessage,
    providerStateJson: JSON.stringify(webhookInfo.result),
    baselineCheckedAt: checkedAt,
  })

  if (persisted.baseline_status !== "ready") {
    return {
      ok: false,
      status: 400,
      error: "telegram_webhook_mismatch",
      message: baselineMessage,
      baseline: { state: "blocked", message: baselineMessage, checkedAt },
      liveVerification: resolveLiveVerificationView(persisted),
      provider,
      providerCheckedAt: checkedAt,
    }
  }

  return {
    ok: true,
    scopeKey: scope.scopeKey,
    baseline: { state: "ready", message: baselineMessage, checkedAt },
    liveVerification: resolveLiveVerificationView(persisted),
    provider,
    providerCheckedAt: checkedAt,
  }
}

function verificationTimeoutMs(): number {
  const raw = Number(process.env.BEERENGINEER_TELEGRAM_VERIFICATION_TIMEOUT_MS ?? DEFAULT_VERIFICATION_TIMEOUT_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_VERIFICATION_TIMEOUT_MS
}

export async function startTelegramLiveVerification(input: {
  repos: Repos
  config: AppConfig | null
  workspaceKey?: string
}): Promise<TelegramActionResult> {
  const scope = resolveTelegramSetupScope(input.config, { repos: input.repos, workspaceKey: input.workspaceKey })
  if (!scope.ok) {
    return {
      ok: false,
      status: 404,
      error: "workspace_not_found",
      message: `Workspace not found: ${scope.workspaceKey}`,
      baseline: { state: "blocked", message: `Workspace not found: ${scope.workspaceKey}` },
      liveVerification: { state: "not-run" },
    }
  }

  const statusViews = readTelegramSetupStatusViews(scope, input.repos)
  if (statusViews.baseline.state !== "ready" || !scope.token || !scope.chatId) {
    return {
      ok: false,
      status: 400,
      error: "telegram_baseline_not_ready",
      message: statusViews.baseline.message ?? "Telegram baseline setup is not ready.",
      baseline: statusViews.baseline,
      liveVerification: statusViews.liveVerification,
      provider: statusViews.provider,
      providerCheckedAt: statusViews.providerCheckedAt,
    }
  }

  const deliveryKey = `telegram-verification:${scope.scopeKey}`
  input.repos.claimNotificationDelivery({
    dedupKey: deliveryKey,
    channel: "telegram",
    chatId: scope.chatId,
  })

  const startedAt = now()
  const deadlineAt = startedAt + verificationTimeoutMs()
  input.repos.upsertTelegramSetupState({
    scopeKey: scope.scopeKey,
    workspaceKey: scope.workspaceKey ?? null,
    expectedWebhookUrl: scope.expectedWebhookUrl ?? null,
    verificationStatus: "pending",
    verificationMessage: "Live verification is waiting for a Telegram reply to the verification prompt.",
    verificationStartedAt: startedAt,
    verificationCompletedAt: null,
    verificationDeadlineAt: deadlineAt,
    verificationDeliveryKey: deliveryKey,
  })

  const message = await callTelegramApi<{ message_id?: number }>(scope.token, "sendMessage", {
    body: {
      chat_id: scope.chatId,
      text: sanitizeTelegramText("beerengineer_ live verification: reply to this message to confirm inbound Telegram setup.", [scope.token]),
    },
    secrets: [scope.token, scope.webhookSecret ?? ""],
  })
  if (!message.ok) {
    input.repos.completeNotificationDelivery(deliveryKey, { status: "failed", errorMessage: message.message })
    input.repos.upsertTelegramSetupState({
      scopeKey: scope.scopeKey,
      verificationStatus: "failed",
      verificationMessage: message.message,
      verificationCompletedAt: now(),
      verificationDeadlineAt: deadlineAt,
      verificationDeliveryKey: deliveryKey,
    })
    return actionFailure(400, message.error, message.message, scope.scopeKey, input.repos)
  }

  const telegramMessageId = typeof message.result?.message_id === "number" ? message.result.message_id : null
  input.repos.completeNotificationDelivery(deliveryKey, { status: "delivered", telegramMessageId })
  const persisted = input.repos.getTelegramSetupState(scope.scopeKey)
  return {
    ok: true,
    scopeKey: scope.scopeKey,
    baseline: statusViews.baseline,
    liveVerification: resolveLiveVerificationView(persisted),
    provider: statusViews.provider ?? { pendingUpdateCount: 0, hasCustomCertificate: false },
    providerCheckedAt: statusViews.providerCheckedAt,
  }
}

export function completeTelegramLiveVerificationFromReply(
  repos: Repos,
  input: { chatId: string; replyToMessageId: number },
): boolean {
  const delivery = repos.findTelegramDeliveryByMessage({
    chatId: input.chatId,
    messageId: input.replyToMessageId,
  })
  if (!delivery?.dedup_key) return false
  const state = repos.getTelegramSetupStateByVerificationDeliveryKey(delivery.dedup_key)
  if (!state) return false
  if (state.verification_status !== "pending") return true
  if (state.verification_deadline_at && state.verification_deadline_at <= now()) {
    repos.upsertTelegramSetupState({
      scopeKey: state.scope_key,
      verificationStatus: "timed_out",
      verificationMessage: "Live verification timed out before a matching Telegram reply arrived.",
      verificationCompletedAt: now(),
    })
    return true
  }
  repos.upsertTelegramSetupState({
    scopeKey: state.scope_key,
    verificationStatus: "succeeded",
    verificationMessage: "Live verification succeeded through the Telegram webhook reply path.",
    verificationCompletedAt: now(),
  })
  return true
}
