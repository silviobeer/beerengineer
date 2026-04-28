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

  const headerRaw = req.headers["x-telegram-bot-api-secret-token"]
  const header = Array.isArray(headerRaw) ? headerRaw[0] : headerRaw
  if (resolved.secretToken && header !== resolved.secretToken) {
    return plainStatus(res, 401, "invalid_secret_token")
  }

  const provider = new TelegramChatToolProvider(resolved.botToken, deps)
  const update = await provider.parseWebhook(req)
  if (!update) return plainOk(res)
  if (update.channelRef !== resolved.chatId) return plainOk(res)
  if (!allowWebhookWrite(update.channelRef)) return plainOk(res)
  if (!update.text || update.text.startsWith("/")) {
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
    let message = "Reply to a beerengineer_ prompt to answer it."
    if (result.error === "prompt_not_open" || result.error === "prompt_mismatch") {
      message = "That prompt was already answered."
    } else if (result.error === "empty_answer") {
      message = "Empty answers are ignored."
    } else if (result.error === "run_not_found") {
      message = "That run no longer exists."
    }
    await softReply(resolved.botToken, update.channelRef, message, deps.send)
    return plainOk(res)
  }

  if (result.kind === "ignored") {
    await softReply(
      resolved.botToken,
      update.channelRef,
      "Reply to a beerengineer_ prompt to answer it.",
      deps.send,
    )
    return plainOk(res)
  }
  if (result.kind === "answer" && update.providerMessageId) {
    await provider.react(update.channelRef, update.providerMessageId, "👍")
  }
  return plainOk(res)
}
