import type { EventBus } from "../core/bus.js"
import type { WorkflowEvent } from "../core/io.js"
import type { Repos } from "../db/repositories.js"
import type { AppConfig } from "../setup/types.js"
import { TelegramNotificationDispatcher, type TelegramMessageClient } from "./dispatcher.js"

function shouldAttachTelegram(config: AppConfig): boolean {
  return config.notifications?.telegram?.enabled === true
}

function isTelegramEvent(event: WorkflowEvent): event is Extract<WorkflowEvent, { type: "run_started" | "run_blocked" | "run_finished" | "stage_completed" }> {
  return (
    event.type === "run_started" ||
    event.type === "run_blocked" ||
    event.type === "run_finished" ||
    event.type === "stage_completed"
  )
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
    if (!isTelegramEvent(event)) return
    void dispatcher.deliver(event).catch(err => {
      console.error("[notifications.telegram]", (err as Error).message)
    })
  })
}
