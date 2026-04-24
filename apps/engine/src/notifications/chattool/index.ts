import type { EventBus } from "../../core/bus.js"
import { projectWorkflowEvent } from "../../core/messagingProjection.js"
import type { Repos } from "../../db/repositories.js"
import type { AppConfig } from "../../setup/types.js"
import { ChatToolDispatcher } from "./dispatcher.js"
import { resolveTelegramChatToolConfig, TelegramChatToolProvider, type TelegramChatToolDeps } from "./providers/telegram.js"

export function attachChatToolNotifications(
  bus: EventBus,
  repos: Repos,
  config: AppConfig,
  opts: { telegram?: TelegramChatToolDeps } = {},
): (() => void) | null {
  const telegram = resolveTelegramChatToolConfig(config)
  if (!telegram.enabled) return null

  const provider = new TelegramChatToolProvider(telegram.botToken, opts.telegram)
  const dispatcher = new ChatToolDispatcher(
    provider,
    telegram.level,
    repos,
    telegram.publicBaseUrl,
    telegram.chatId,
  )

  return bus.subscribe(event => {
    const entry = projectWorkflowEvent(event, {
      id: event.streamId ?? `bus:${event.type}:${event.at ?? Date.now()}`,
      ts: event.at ?? Date.now(),
    })
    void dispatcher.onMessage(entry).catch(err => {
      console.error(`[notifications.${provider.id}]`, (err as Error).message)
    })
  })
}

