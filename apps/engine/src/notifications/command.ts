import type { AppConfig } from "../setup/types.js"
import type { Repos } from "../db/repositories.js"
import { TelegramNotificationDispatcher } from "./dispatcher.js"

type TestConfigResult =
  | { ok: true; config: { publicBaseUrl: string; botTokenEnv: string; chatId: string; token: string } }
  | { ok: false; error: string }

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
  const chatId = config.notifications.telegram.defaultChatId?.trim()
  if (!chatId) {
    return { ok: false, error: "Missing notifications.telegram.defaultChatId in config." }
  }
  return { ok: true, config: { publicBaseUrl, botTokenEnv, chatId, token } }
}

export async function sendTelegramTestNotification(config: AppConfig, repos: Repos): Promise<{ ok: true } | { ok: false; error: string }> {
  const resolved = resolveTelegramTestConfig(config)
  if (!resolved.ok) return resolved

  const dispatcher = new TelegramNotificationDispatcher(config, repos)
  const runId = `telegram-test-${Date.now()}`
  const result = await dispatcher.deliver({
    type: "run_finished",
    runId,
    itemId: `${runId}-item`,
    title: "Telegram notification test",
    status: "completed",
  })
  if (!result.delivered) {
    return { ok: false, error: result.reason }
  }
  return { ok: true }
}
