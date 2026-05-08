import type { IncomingMessage, ServerResponse } from "node:http"
import type { Repos } from "../../../db/repositories.js"
import type { AppConfig } from "../../../setup/types.js"
import { sanitizeTelegramText, sendTelegramMessage } from "../../telegram.js"
import { handleChatToolInbound } from "../inbound.js"
import { resolveTelegramChatToolConfig, TelegramChatToolProvider, type TelegramChatToolDeps } from "../providers/telegram.js"

const WEBHOOK_WINDOW_MS = 60_000
const WEBHOOK_MAX_WRITES_PER_WINDOW = 20
const webhookWritesByChat = new Map<string, number[]>()

function plainStatus(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify({ ok: false, error: body }))
}

function plainOk(res: ServerResponse): void {
  res.writeHead(200, { "content-type": "application/json" })
  res.end(`{"ok":true}`)
}

async function softReply(
  botToken: string,
  chatId: string,
  text: string,
  sendImpl: TelegramChatToolDeps["send"] | undefined,
): Promise<void> {
  const impl = sendImpl ?? sendTelegramMessage
  await impl({
    token: botToken,
    chatId,
    text: sanitizeTelegramText(text, [botToken]),
  }).catch(() => undefined)
}

function allowWebhookWrite(chatId: string): boolean {
  const cutoff = Date.now() - WEBHOOK_WINDOW_MS
  const active = (webhookWritesByChat.get(chatId) ?? []).filter(ts => ts > cutoff)
  if (active.length >= WEBHOOK_MAX_WRITES_PER_WINDOW) {
    webhookWritesByChat.set(chatId, active)
    return false
  }
  active.push(Date.now())
  webhookWritesByChat.set(chatId, active)
  return true
}

function inboundFailureMessage(error: string): string {
  switch (error) {
    case "reply_required":
      return "Your message was not applied as a prompt answer. Reply directly to a beerengineer_ prompt message."
    case "prompt_delivery_not_found":
    case "prompt_not_open":
    case "prompt_mismatch":
      return "Your reply could not be applied as a prompt answer because the referenced prompt is missing or already closed."
    case "empty_answer":
      return "Your reply could not be applied as a prompt answer because it was empty."
    case "run_not_found":
      return "Your reply could not be applied as a prompt answer because that run no longer exists."
    default:
      return "Your reply could not be applied as a prompt answer."
  }
}

export function resetTelegramChatToolWebhookRateLimit(): void {
  webhookWritesByChat.clear()
}

export async function handleTelegramChatToolWebhook(
  repos: Repos,
  config: AppConfig,
  req: IncomingMessage,
  res: ServerResponse,
  deps: TelegramChatToolDeps = {},
): Promise<void> {
  if (req.method !== "POST") return plainStatus(res, 405, "method_not_allowed")
  const resolved = resolveTelegramChatToolConfig(config)
  if (!resolved.enabled) return plainStatus(res, 404, resolved.reason)
  if (config.notifications?.telegram?.inbound?.enabled !== true) return plainStatus(res, 404, "inbound disabled")

  const configuredSecretEnv = config.notifications?.telegram?.inbound?.webhookSecretEnv?.trim()
  const headerRaw = req.headers["x-telegram-bot-api-secret-token"]
  const header = Array.isArray(headerRaw) ? headerRaw[0] : headerRaw
  if (configuredSecretEnv && !resolved.secretToken) {
    return plainStatus(res, 503, "telegram_webhook_secret_unavailable")
  }
  if (configuredSecretEnv && header !== resolved.secretToken) {
    return plainStatus(res, 401, "invalid_secret_token")
  }

  const provider = new TelegramChatToolProvider(resolved.botToken, deps)
  const update = await provider.parseWebhook(req)
  if (!update) return plainOk(res)
  if (!allowWebhookWrite(update.channelRef)) return plainOk(res)
  if (!update.text) return plainOk(res)
  if (update.text.startsWith("/") && !update.replyToProviderMessageId) {
    await softReply(
      resolved.botToken,
      update.channelRef,
      "Reply to a beerengineer_ prompt to answer it. Commands are not supported yet.",
      deps.send,
    )
    return plainOk(res)
  }

  const result = handleChatToolInbound(repos, "telegram", update)
  if (!result.ok) {
    await softReply(resolved.botToken, update.channelRef, inboundFailureMessage(result.error), deps.send)
    return plainOk(res)
  }

  if (result.kind === "answer" && update.providerMessageId) {
    await provider.react(update.channelRef, update.providerMessageId, "👍")
  }
  return plainOk(res)
}
