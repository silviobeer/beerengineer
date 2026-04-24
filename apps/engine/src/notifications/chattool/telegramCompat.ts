import type { IncomingMessage, ServerResponse } from "node:http"
import type { EventBus } from "../../core/bus.js"
import type { MessageEntry } from "../../core/messagingProjection.js"
import type { Repos } from "../../db/repositories.js"
import type { AppConfig } from "../../setup/types.js"
import { ChatToolDispatcher } from "./dispatcher.js"
import { attachChatToolNotifications } from "./index.js"
import { resolveTelegramChatToolConfig, TelegramChatToolProvider, type TelegramChatToolDeps } from "./providers/telegram.js"
import {
  handleTelegramChatToolWebhook,
  resetTelegramChatToolWebhookRateLimit,
} from "./webhooks/telegram.js"

export type TelegramMessageClient = NonNullable<TelegramChatToolDeps["send"]>
type TelegramDispatcherClientLike = TelegramMessageClient | TelegramChatToolDeps | undefined

export type NotificationDispatchResult =
  | { delivered: true; eventType: MessageEntry["type"] }
  | { delivered: false; eventType: MessageEntry["type"]; reason: string }

export type SupportedTelegramMessage = MessageEntry

export function isSupportedTelegramEvent(event: MessageEntry): boolean {
  return (
    event.type === "run_started" ||
    event.type === "run_blocked" ||
    event.type === "run_finished" ||
    event.type === "phase_completed" ||
    event.type === "phase_failed" ||
    event.type === "prompt_requested"
  )
}

export class TelegramNotificationDispatcher {
  private readonly delegate: ChatToolDispatcher | null

  constructor(private readonly config: AppConfig, private readonly repos: Repos, client?: TelegramDispatcherClientLike) {
    const resolved = resolveTelegramChatToolConfig(config)
    if (!resolved.enabled) {
      this.delegate = null
      return
    }
    const deps = typeof client === "function" ? { send: client } : client ?? {}
    const provider = new TelegramChatToolProvider(resolved.botToken, deps)
    this.delegate = new ChatToolDispatcher(provider, resolved.level, repos, resolved.publicBaseUrl, resolved.chatId)
  }

  async deliver(event: MessageEntry): Promise<NotificationDispatchResult> {
    if (!this.delegate) {
      return { delivered: false, eventType: event.type, reason: "telegram not configured" }
    }
    if (!isSupportedTelegramEvent(event)) {
      return { delivered: false, eventType: event.type, reason: "event not supported" }
    }
    const result = await this.delegate.onMessage(event)
    if (!result) return { delivered: false, eventType: event.type, reason: "event not supported" }
    if (!result.ok) return { delivered: false, eventType: event.type, reason: result.error }
    return { delivered: true, eventType: event.type }
  }
}

export function attachTelegramNotifications(
  bus: EventBus,
  repos: Repos,
  config: AppConfig,
  opts: { client?: TelegramChatToolDeps["send"] } = {},
): (() => void) | null {
  return attachChatToolNotifications(bus, repos, config, {
    telegram: opts.client ? { send: opts.client } : undefined,
  })
}

export function resetTelegramWebhookRateLimit(): void {
  return resetTelegramChatToolWebhookRateLimit()
}

export async function handleTelegramWebhook(
  repos: Repos,
  config: AppConfig,
  req: IncomingMessage,
  res: ServerResponse,
  deps: TelegramChatToolDeps = {},
): Promise<void> {
  return handleTelegramChatToolWebhook(repos, config, req, res, deps)
}

export const __internals = {
  handleTelegramChatToolWebhook,
}
