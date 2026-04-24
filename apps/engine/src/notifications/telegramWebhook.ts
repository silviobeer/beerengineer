import type { IncomingMessage, ServerResponse } from "node:http"
import { recordAnswer, type AnswerResult } from "../core/conversation.js"
import type { Repos } from "../db/repositories.js"
import type { AppConfig } from "../setup/types.js"
import {
  sanitizeTelegramText,
  sendTelegramMessage,
  sendTelegramReaction,
  type TelegramDeliveryResult,
} from "./telegram.js"

/**
 * Inbound Telegram webhook. The route lives here on purpose — it is the one
 * place that bridges Telegram traffic back into the canonical answer write
 * path. Per `spec/telegram-refactor.md` § 8, this module may only depend on
 * `core/conversation` and `db/repositories`. No imports from
 * `../core/runOrchestrator`, `../core/runService`, or anything under
 * `../workflow`.
 */

const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_WRITES = 20
const MAX_BODY_BYTES = 32 * 1024

type TelegramUpdate = {
  message?: {
    message_id?: number
    chat?: { id?: number | string }
    from?: { username?: string; id?: number | string }
    text?: string
    reply_to_message?: { message_id?: number }
  }
}

type HandlerDeps = {
  send?: (input: { token: string; chatId: string; text: string }) => Promise<TelegramDeliveryResult>
  react?: (input: { token: string; chatId: string; messageId: number; emoji: string }) => Promise<void>
  now?: () => number
}

type Resolved = {
  enabled: true
  chatId: string
  secretToken: string
  botToken: string
  publicBaseUrl: string
}

function resolveConfig(config: AppConfig): Resolved | { enabled: false; reason: string } {
  const telegram = config.notifications?.telegram
  if (telegram?.enabled !== true) return { enabled: false, reason: "telegram disabled" }
  if (telegram.inbound?.enabled !== true) return { enabled: false, reason: "inbound disabled" }

  const botTokenEnv = telegram.botTokenEnv?.trim()
  const chatId = telegram.defaultChatId?.trim()
  const publicBaseUrl = config.publicBaseUrl?.trim()
  const secretEnv = telegram.inbound.webhookSecretEnv?.trim()
  if (!botTokenEnv || !chatId || !publicBaseUrl || !secretEnv) {
    return { enabled: false, reason: "telegram inbound: missing config" }
  }
  const botToken = process.env[botTokenEnv]?.trim()
  const secretToken = process.env[secretEnv]?.trim()
  if (!botToken || !secretToken) {
    return { enabled: false, reason: "telegram inbound: env vars not set" }
  }
  return { enabled: true, chatId, secretToken, botToken, publicBaseUrl }
}

// Simple rolling-window limiter keyed by chat. Shared memory, not persisted —
// a crash resets the window, which is the desired behaviour for a soft bot
// rate-limit.
const writesByChat = new Map<string, number[]>()

function isRateLimited(chatId: string, now: number): boolean {
  const timestamps = writesByChat.get(chatId) ?? []
  const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS)
  if (recent.length >= RATE_LIMIT_MAX_WRITES) {
    writesByChat.set(chatId, recent)
    return true
  }
  recent.push(now)
  writesByChat.set(chatId, recent)
  return false
}

export function resetTelegramWebhookRateLimit(): void {
  writesByChat.clear()
}

function plainOk(res: ServerResponse): void {
  res.writeHead(200, { "content-type": "application/json" })
  res.end(`{"ok":true}`)
}

function plainStatus(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify({ ok: false, error: body }))
}

function replyTextForAnswerResult(result: AnswerResult): string | null {
  if (result.ok) return null
  switch (result.code) {
    case "empty_answer":
      return "Send a non-empty answer."
    case "run_not_found":
      return "That run no longer exists."
    case "prompt_not_open":
    case "prompt_mismatch":
      return "That prompt was already answered."
  }
}

async function readBodyBounded(req: IncomingMessage): Promise<unknown> {
  let total = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    total += (chunk as Buffer).length
    if (total > MAX_BODY_BYTES) throw new Error("payload too large")
    chunks.push(chunk as Buffer)
  }
  const raw = Buffer.concat(chunks).toString("utf8")
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

/**
 * Handle a Telegram `Update` POST. Responds 200 on every accepted request —
 * Telegram retries 5xx and disables webhooks after repeated failures, and a
 * logically-ignored update (no reply-to, unknown message, etc.) is still an
 * accepted delivery.
 */
export async function handleTelegramWebhook(
  repos: Repos,
  config: AppConfig,
  req: IncomingMessage,
  res: ServerResponse,
  deps: HandlerDeps = {},
): Promise<void> {
  if (req.method !== "POST") return plainStatus(res, 405, "method_not_allowed")

  const resolved = resolveConfig(config)
  if (!resolved.enabled) return plainStatus(res, 404, resolved.reason)

  const headerRaw = req.headers["x-telegram-bot-api-secret-token"]
  const headerValue = Array.isArray(headerRaw) ? headerRaw[0] : headerRaw
  if (typeof headerValue !== "string" || headerValue !== resolved.secretToken) {
    return plainStatus(res, 401, "invalid_secret_token")
  }

  let update: TelegramUpdate
  try {
    update = (await readBodyBounded(req)) as TelegramUpdate
  } catch {
    return plainStatus(res, 413, "payload_too_large")
  }

  const message = update?.message
  if (!message || typeof message.text !== "string" || !message.chat?.id) {
    // Reactions, edits, join events, empty updates — nothing to do, but ack
    // so Telegram doesn't retry.
    return plainOk(res)
  }
  const chatId = String(message.chat.id)

  // Hard-bind the webhook to the one configured chat. Anything else is ignored
  // (and not rate-charged against the real chat).
  if (chatId !== resolved.chatId) return plainOk(res)

  const now = deps.now?.() ?? Date.now()
  if (isRateLimited(chatId, now)) {
    await softReply(
      resolved,
      chatId,
      "Too many messages — slow down and try again in a minute.",
      deps.send,
    )
    return plainOk(res)
  }

  // Phase B deliberately ignores command-style input. Phase C is where
  // /resume and other buttons live. Free-text replies are the whole contract.
  const answerText = message.text.trim()
  if (!answerText || answerText.startsWith("/")) {
    await softReply(
      resolved,
      chatId,
      "Reply to a BeerEngineer prompt to answer it. Commands are not supported yet.",
      deps.send,
    )
    return plainOk(res)
  }

  const replyToMessageId = message.reply_to_message?.message_id
  let delivery = replyToMessageId
    ? repos.findTelegramDeliveryByMessage({ chatId, messageId: replyToMessageId })
    : undefined

  // Fallback: no reply-to, but the single-chat deployment has exactly one
  // most-recent outbound delivery that carries an open prompt. Still subject
  // to the "prompt must be open" guard inside the canonical write path.
  if (!delivery && !replyToMessageId) {
    delivery = repos.findLatestTelegramPromptDeliveryForChat(chatId)
  }

  if (!delivery?.run_id || !delivery?.prompt_id) {
    await softReply(
      resolved,
      chatId,
      "Reply to a BeerEngineer prompt to answer it.",
      deps.send,
    )
    return plainOk(res)
  }

  const result = recordAnswer(repos, {
    runId: delivery.run_id,
    promptId: delivery.prompt_id,
    answer: answerText,
    source: "webhook",
  })

  if (result.ok) {
    if (message.message_id !== undefined) {
      const react = deps.react ?? sendTelegramReaction
      await react({
        token: resolved.botToken,
        chatId,
        messageId: message.message_id,
        emoji: "👍",
      })
    }
    return plainOk(res)
  }

  const text = replyTextForAnswerResult(result)
  if (text) await softReply(resolved, chatId, text, deps.send)
  return plainOk(res)
}

async function softReply(
  resolved: Resolved,
  chatId: string,
  text: string,
  send: HandlerDeps["send"],
): Promise<void> {
  const impl = send ?? sendTelegramMessage
  await impl({
    token: resolved.botToken,
    chatId,
    text: sanitizeTelegramText(text, [resolved.botToken]),
  }).catch(() => undefined)
}

// Exported for tests and ops tooling so they can call the handler without
// routing through node:http.
export const __internals = {
  resolveConfig,
  isRateLimited,
  readBodyBounded,
  MAX_BODY_BYTES,
  RATE_LIMIT_MAX_WRITES,
  RATE_LIMIT_WINDOW_MS,
}

