import type { AppConfig } from "../setup/types.js"
import type { Repos } from "../db/repositories.js"
import { createExternalLinkBuilder } from "./links.js"
import { sanitizeTelegramText, sendTelegramMessage, type TelegramDeliveryResult } from "./telegram.js"

type TestConfigResult =
  | { ok: true; config: { publicBaseUrl: string; botTokenEnv: string; chatId: string; token: string } }
  | { ok: false; error: string }

export type TelegramTestSendClient = {
  send(input: { token: string; chatId: string; text: string }): Promise<TelegramDeliveryResult>
}

function resolveTelegramTestConfig(config: AppConfig): TestConfigResult {
  if (config.notifications?.telegram?.enabled !== true) {
    return { ok: false, error: "Telegram notifications are disabled in config." }
  }
  const publicBaseUrl = config.publicBaseUrl?.trim()
  if (!publicBaseUrl) {
    return { ok: false, error: "Missing publicBaseUrl in config." }
  }
  const botTokenEnv = config.notifications.telegram.botTokenEnv?.trim()
  if (!botTokenEnv) {
    return { ok: false, error: "Missing notifications.telegram.botTokenEnv in config." }
  }
  const token = process.env[botTokenEnv]?.trim()
  if (!token) {
    return { ok: false, error: `${botTokenEnv} is not set.` }
  }
  if (token.startsWith("bot")) {
    return {
      ok: false,
      error: `${botTokenEnv} starts with "bot" — BotFather tokens look like "123456:ABC-DEF…". Drop the "bot" prefix.`,
    }
  }
  const chatId = config.notifications.telegram.defaultChatId?.trim()
  if (!chatId) {
    return { ok: false, error: "Missing notifications.telegram.defaultChatId in config." }
  }
  return { ok: true, config: { publicBaseUrl, botTokenEnv, chatId, token } }
}

export async function sendTelegramTestNotification(
  config: AppConfig,
  _repos: Repos,
  opts: { client?: TelegramTestSendClient } = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const resolved = resolveTelegramTestConfig(config)
  if (!resolved.ok) return resolved

  // Bypass the durable dedupe table: a smoke test should exercise the HTTP
  // path (token shape, base URL, chat id) without writing a row for a
  // synthetic runId that isn't tied to any real run.
  const links = createExternalLinkBuilder(resolved.config.publicBaseUrl)
  const runId = `telegram-test-${Date.now()}`
  const message = [
    "BeerEngineer test notification",
    `Run: ${runId}`,
    `Open: ${links.run(runId)}`,
  ].join("\n")
  const text = sanitizeTelegramText(message, [resolved.config.token])

  const client = opts.client ?? { send: sendTelegramMessage }
  const result = await client.send({
    token: resolved.config.token,
    chatId: resolved.config.chatId,
    text,
  })
  if (!result.ok) {
    return { ok: false, error: result.error }
  }
  return { ok: true }
}
