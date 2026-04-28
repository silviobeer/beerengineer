import { normalizePublicBaseUrl } from "../config.js"
import type { AppConfig, CheckResult, SetupStatus } from "../types.js"
import { createCheck } from "./shared.js"

export async function runNotificationChecks(config: AppConfig | null): Promise<CheckResult[]> {
  if (!config) return unavailableNotificationChecks()

  const checks: CheckResult[] = [checkNotificationBaseUrl(config.publicBaseUrl?.trim())]

  const telegramEnabled = config.notifications?.telegram?.enabled === true
  checks.push(createCheck(
    "notifications.telegram.enabled",
    "Telegram notifications enabled",
    telegramEnabled ? "ok" : "skipped",
    telegramEnabled ? "Enabled in config" : "Disabled in config",
  ))

  const tokenEnv = config.notifications?.telegram?.botTokenEnv?.trim()
  if (!telegramEnabled) return [...checks, ...disabledTelegramChecks()]
  const inboundEnabled = config.notifications?.telegram?.inbound?.enabled === true
  const webhookSecretEnv = config.notifications?.telegram?.inbound?.webhookSecretEnv?.trim()

  return [
    ...checks,
    createCheck(
      "notifications.telegram.level",
      "Telegram message level",
      "ok",
      `L${config.notifications?.telegram?.level ?? 2}`,
    ),
    checkTelegramTokenEnv(tokenEnv),
    checkTelegramTokenPresent(tokenEnv),
    checkTelegramDefaultChatId(config.notifications?.telegram?.defaultChatId?.trim()),
    createCheck(
      "notifications.telegram.inbound.enabled",
      "Telegram inbound replies enabled",
      inboundEnabled ? "ok" : "skipped",
      inboundEnabled ? "Enabled in config" : "Disabled in config",
    ),
    checkTelegramWebhookSecretEnv(inboundEnabled, webhookSecretEnv),
    checkTelegramWebhookSecretPresent(inboundEnabled, webhookSecretEnv),
  ]
}

function unavailableNotificationChecks(): CheckResult[] {
  const detail = "effective config is unavailable"
  return [
    createCheck("notifications.public-base-url", "Public base URL", "skipped", detail),
    createCheck("notifications.telegram.enabled", "Telegram notifications enabled", "skipped", detail),
    createCheck("notifications.telegram.level", "Telegram message level", "skipped", detail),
    createCheck("notifications.telegram.bot-token-env", "Telegram bot token env var", "skipped", detail),
    createCheck("notifications.telegram.bot-token-present", "Telegram bot token present", "skipped", detail),
    createCheck("notifications.telegram.default-chat-id", "Telegram default chat id", "skipped", detail),
    createCheck("notifications.telegram.inbound.enabled", "Telegram inbound replies enabled", "skipped", detail),
    createCheck("notifications.telegram.inbound.webhook-secret-env", "Telegram webhook secret env var", "skipped", detail),
    createCheck("notifications.telegram.inbound.webhook-secret-present", "Telegram webhook secret present", "skipped", detail),
  ]
}

function checkNotificationBaseUrl(baseUrl: string | undefined): CheckResult {
  if (!baseUrl) {
    return createCheck(
      "notifications.public-base-url",
      "Public base URL",
      "missing",
      "Missing publicBaseUrl. Telegram links need a Tailscale-reachable absolute URL.",
      { remedy: { hint: "Set publicBaseUrl to the externally reachable UI address, for example http://100.x.y.z:3100." } },
    )
  }
  try {
    return createCheck("notifications.public-base-url", "Public base URL", "ok", normalizePublicBaseUrl(baseUrl))
  } catch (err) {
    return createCheck(
      "notifications.public-base-url",
      "Public base URL",
      "misconfigured",
      (err as Error).message,
      { remedy: { hint: "Use an absolute http(s) URL that is reachable over Tailscale and not localhost.", command: "BEERENGINEER_PUBLIC_BASE_URL=http://100.x.y.z:3100" } },
    )
  }
}

function disabledTelegramChecks(): CheckResult[] {
  const detail = "Telegram notifications are disabled in config"
  return [
    createCheck("notifications.telegram.level", "Telegram message level", "skipped", detail),
    createCheck("notifications.telegram.bot-token-env", "Telegram bot token env var", "skipped", detail),
    createCheck("notifications.telegram.bot-token-present", "Telegram bot token present", "skipped", detail),
    createCheck("notifications.telegram.default-chat-id", "Telegram default chat id", "skipped", detail),
    createCheck("notifications.telegram.inbound.enabled", "Telegram inbound replies enabled", "skipped", detail),
    createCheck("notifications.telegram.inbound.webhook-secret-env", "Telegram webhook secret env var", "skipped", detail),
    createCheck("notifications.telegram.inbound.webhook-secret-present", "Telegram webhook secret present", "skipped", detail),
  ]
}

function checkTelegramTokenEnv(tokenEnv: string | undefined): CheckResult {
  if (tokenEnv) return createCheck("notifications.telegram.bot-token-env", "Telegram bot token env var", "ok", tokenEnv)
  return createCheck(
    "notifications.telegram.bot-token-env",
    "Telegram bot token env var",
    "missing",
    "Missing notifications.telegram.botTokenEnv",
    { remedy: { hint: "Store the Telegram bot token in an env var and record that env var name in config." } },
  )
}

function checkTelegramTokenPresent(tokenEnv: string | undefined): CheckResult {
  const tokenPresent = tokenEnv ? Boolean(process.env[tokenEnv]) : false
  return createCheck(
    "notifications.telegram.bot-token-present",
    "Telegram bot token present",
    tokenPresent ? "ok" : "missing",
    tokenPresent ? `${tokenEnv} is set` : `${tokenEnv ?? "bot token env"} is not set in this shell`,
    tokenPresent || !tokenEnv
      ? {}
      : { remedy: { hint: "Export the Telegram bot token before starting the engine.", command: buildTelegramExportCommand(tokenEnv) } },
  )
}

function checkTelegramDefaultChatId(chatId: string | undefined): CheckResult {
  return createCheck(
    "notifications.telegram.default-chat-id",
    "Telegram default chat id",
    chatId ? "ok" : "missing",
    chatId ?? "Missing notifications.telegram.defaultChatId",
    chatId ? {} : { remedy: { hint: "Record the chat id that should receive beerengineer_ notifications." } },
  )
}

function checkTelegramWebhookSecretEnv(inboundEnabled: boolean, webhookSecretEnv: string | undefined): CheckResult {
  let status: SetupStatus = "skipped"
  let detail = "Telegram inbound replies are disabled in config"
  if (inboundEnabled) {
    status = webhookSecretEnv ? "ok" : "missing"
    detail = webhookSecretEnv ?? "Missing notifications.telegram.inbound.webhookSecretEnv"
  }
  return createCheck(
    "notifications.telegram.inbound.webhook-secret-env",
    "Telegram webhook secret env var",
    status,
    detail,
    inboundEnabled && !webhookSecretEnv
      ? { remedy: { hint: "Store the Telegram webhook secret in an env var and record that env var name in config." } }
      : {},
  )
}

function checkTelegramWebhookSecretPresent(inboundEnabled: boolean, webhookSecretEnv: string | undefined): CheckResult {
  const webhookSecretPresent = webhookSecretEnv ? Boolean(process.env[webhookSecretEnv]) : false
  let status: SetupStatus = "skipped"
  let detail = "Telegram inbound replies are disabled in config"
  if (inboundEnabled && webhookSecretEnv) {
    status = webhookSecretPresent ? "ok" : "missing"
    detail = webhookSecretPresent ? `${webhookSecretEnv} is set` : `${webhookSecretEnv} is not set in this shell`
  } else if (inboundEnabled) {
    status = "missing"
    detail = "Webhook secret env var is not configured"
  }
  return createCheck(
    "notifications.telegram.inbound.webhook-secret-present",
    "Telegram webhook secret present",
    status,
    detail,
    inboundEnabled && webhookSecretEnv && !webhookSecretPresent
      ? { remedy: { hint: "Export the Telegram webhook secret before starting the engine.", command: buildTelegramWebhookSecretExportCommand(webhookSecretEnv) } }
      : {},
  )
}

function buildTelegramExportCommand(envName: string): string {
  return `export ${envName}=<telegram-bot-token>`
}

function buildTelegramWebhookSecretExportCommand(envName: string): string {
  return `export ${envName}=<telegram-webhook-secret>`
}
