import type { WorkflowEvent } from "../core/io.js"
import type { Repos } from "../db/repositories.js"
import type { AppConfig } from "../setup/types.js"
import { createExternalLinkBuilder } from "./links.js"
import { sanitizeTelegramText, sendTelegramMessage, type TelegramDeliveryResult } from "./telegram.js"

export type TelegramMessageClient = {
  send(input: { token: string; chatId: string; text: string }): Promise<TelegramDeliveryResult>
}

export type NotificationDispatchResult =
  | { delivered: true; eventType: WorkflowEvent["type"] }
  | { delivered: false; eventType: WorkflowEvent["type"]; reason: string }

export type SupportedTelegramEvent = Extract<
  WorkflowEvent,
  { type: "run_started" | "run_blocked" | "run_finished" | "stage_completed" }
>

export function isSupportedTelegramEvent(event: WorkflowEvent): event is SupportedTelegramEvent {
  return (
    event.type === "run_started" ||
    event.type === "run_blocked" ||
    event.type === "run_finished" ||
    event.type === "stage_completed"
  )
}

function isTelegramEnabled(config: AppConfig): boolean {
  return config.notifications?.telegram?.enabled === true
}

function getTelegramConfig(config: AppConfig): { botTokenEnv: string; chatId: string; publicBaseUrl: string } | null {
  if (!isTelegramEnabled(config)) return null
  const botTokenEnv = config.notifications?.telegram?.botTokenEnv?.trim()
  const chatId = config.notifications?.telegram?.defaultChatId?.trim()
  const publicBaseUrl = config.publicBaseUrl?.trim()
  if (!botTokenEnv || !chatId || !publicBaseUrl) return null
  return { botTokenEnv, chatId, publicBaseUrl }
}

function formatBlockedScope(event: Extract<WorkflowEvent, { type: "run_blocked" }>): string {
  switch (event.scope.type) {
    case "run":
      return "run"
    case "stage":
      return `stage ${event.scope.stageId}`
    case "story":
      return `story ${event.scope.waveNumber}/${event.scope.storyId}`
  }
}

function buildMessage(event: WorkflowEvent, runLink: string): string | null {
  switch (event.type) {
    case "run_started":
      return [
        "BeerEngineer run started",
        `Item: ${event.title}`,
        `Run: ${event.runId}`,
        `Open: ${runLink}`,
      ].join("\n")
    case "run_blocked":
      return [
        "BeerEngineer run blocked",
        `Item: ${event.title}`,
        `Run: ${event.runId}`,
        `Scope: ${formatBlockedScope(event)}`,
        `Summary: ${event.summary}`,
        `Open: ${runLink}`,
      ].join("\n")
    case "run_finished":
      return [
        `BeerEngineer run ${event.status}`,
        `Item: ${event.title}`,
        `Run: ${event.runId}`,
        event.error ? `Error: ${event.error}` : undefined,
        `Open: ${runLink}`,
      ]
        .filter(Boolean)
        .join("\n")
    case "stage_completed":
      return [
        "BeerEngineer stage completed",
        `Run: ${event.runId}`,
        `Stage: ${event.stageKey}`,
        `Outcome: ${event.status}`,
        event.error ? `Error: ${event.error}` : undefined,
        `Open: ${runLink}`,
      ]
        .filter(Boolean)
        .join("\n")
    default:
      return null
  }
}

function dedupKeyForEvent(event: SupportedTelegramEvent): string {
  switch (event.type) {
    case "run_started":
      return `${event.runId}:run_started`
    case "run_finished":
      return `${event.runId}:run_finished`
    case "stage_completed":
      return `${event.runId}:stage_completed:${event.stageRunId}`
    case "run_blocked": {
      const scope =
        event.scope.type === "run"
          ? "run"
          : event.scope.type === "stage"
          ? `stage:${event.scope.stageId}`
          : `story:${event.scope.waveNumber}:${event.scope.storyId}`
      return `${event.runId}:run_blocked:${scope}`
    }
  }
}

export class TelegramNotificationDispatcher {
  constructor(
    private readonly config: AppConfig,
    private readonly repos: Repos,
    private readonly client: TelegramMessageClient = { send: sendTelegramMessage },
  ) {}

  async deliver(event: WorkflowEvent): Promise<NotificationDispatchResult> {
    const telegram = getTelegramConfig(this.config)
    if (!telegram) {
      return { delivered: false, eventType: event.type, reason: "telegram not configured" }
    }
    if (!isSupportedTelegramEvent(event)) {
      return { delivered: false, eventType: event.type, reason: "event not supported" }
    }
    const message = buildMessage(event, createExternalLinkBuilder(telegram.publicBaseUrl).run(event.runId))
    if (!message) {
      return { delivered: false, eventType: event.type, reason: "event not supported" }
    }

    const token = process.env[telegram.botTokenEnv]?.trim()
    if (!token) {
      return { delivered: false, eventType: event.type, reason: `${telegram.botTokenEnv} is not set` }
    }

    const dedupKey = dedupKeyForEvent(event)
    const claimed = this.repos.claimNotificationDelivery({
      dedupKey,
      channel: "telegram",
      chatId: telegram.chatId,
    })
    if (!claimed) {
      return { delivered: false, eventType: event.type, reason: `duplicate notification skipped (${dedupKey})` }
    }

    const text = sanitizeTelegramText(message, [token])
    const result = await this.client.send({
      token,
      chatId: telegram.chatId,
      text,
    })
    if (!result.ok) {
      this.repos.completeNotificationDelivery(dedupKey, {
        status: "failed",
        errorMessage: result.error,
      })
      console.error("[notifications.telegram]", result.error)
      return { delivered: false, eventType: event.type, reason: result.error }
    }
    this.repos.completeNotificationDelivery(dedupKey, { status: "delivered" })
    return { delivered: true, eventType: event.type }
  }
}
