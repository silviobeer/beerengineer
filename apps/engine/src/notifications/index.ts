import type { EventBus } from "../core/bus.js"
import type { Repos } from "../db/repositories.js"
import type { AppConfig } from "../setup/types.js"
import {
  TelegramNotificationDispatcher,
  isSupportedTelegramEvent,
  type TelegramMessageClient,
} from "./dispatcher.js"

function shouldAttachTelegram(config: AppConfig): boolean {
  return config.notifications?.telegram?.enabled === true
}

export function attachTelegramNotifications(
  bus: EventBus,
  repos: Repos,
  config: AppConfig,
  opts: { client?: TelegramMessageClient } = {},
): (() => void) | null {
  if (!shouldAttachTelegram(config)) return null
  const dispatcher = new TelegramNotificationDispatcher(config, repos, opts.client)
  return bus.subscribe(event => {
    if (!isSupportedTelegramEvent(event)) return
    void dispatcher.deliver(event).catch(err => {
      console.error("[notifications.telegram]", (err as Error).message)
    })
  })
}
