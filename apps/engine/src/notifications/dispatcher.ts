import { buildConversation, type OpenPrompt } from "../core/conversation.js"
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
  { type: "run_started" | "run_blocked" | "run_finished" | "stage_completed" | "prompt_requested" }
>

/**
 * Rapid back-and-forth chats can fire many `prompt_requested` events per minute;
 * without an expiring dedup the operator's phone buzzes for each. N is the
 * minimum gap between two "answer me" notifications for the same run.
 */
const PROMPT_NOTIFY_MIN_GAP_MS = 45_000
const OPEN_PROMPT_SUMMARY_MAX_CHARS = 240

export function isSupportedTelegramEvent(event: WorkflowEvent): event is SupportedTelegramEvent {
  return (
    event.type === "run_started" ||
    event.type === "run_blocked" ||
    event.type === "run_finished" ||
    event.type === "stage_completed" ||
    event.type === "prompt_requested"
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

function summarizeOpenPrompt(prompt: OpenPrompt): string {
  const collapsed = prompt.text.replace(/\s+/g, " ").trim()
  if (collapsed.length <= OPEN_PROMPT_SUMMARY_MAX_CHARS) return collapsed
  return `${collapsed.slice(0, OPEN_PROMPT_SUMMARY_MAX_CHARS - 1)}…`
}

function footerLines(runLink: string, hasOpenPrompt: boolean): string[] {
  if (!hasOpenPrompt) return [`Open: ${runLink}`]
  return [`Open: ${runLink}`, "Reply to answer"]
}

function buildMessage(
  event: SupportedTelegramEvent,
  runLink: string,
  openPrompt: OpenPrompt | null,
): string | null {
  switch (event.type) {
    case "run_started":
      return [
        "BeerEngineer run started",
        `Item: ${event.title}`,
        `Run: ${event.runId}`,
        ...footerLines(runLink, false),
      ].join("\n")
    case "run_blocked": {
      const lines: (string | undefined)[] = [
        "BeerEngineer run blocked",
        `Item: ${event.title}`,
        `Run: ${event.runId}`,
        `Scope: ${formatBlockedScope(event)}`,
        `Summary: ${event.summary}`,
      ]
      if (openPrompt) lines.push(`Question: ${summarizeOpenPrompt(openPrompt)}`)
      lines.push(...footerLines(runLink, openPrompt !== null))
      return lines.filter(Boolean).join("\n")
    }
    case "run_finished":
      return [
        `BeerEngineer run ${event.status}`,
        `Item: ${event.title}`,
        `Run: ${event.runId}`,
        event.error ? `Error: ${event.error}` : undefined,
        ...footerLines(runLink, false),
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
        ...footerLines(runLink, false),
      ]
        .filter(Boolean)
        .join("\n")
    case "prompt_requested": {
      if (!openPrompt) return null
      return [
        "BeerEngineer needs an answer",
        `Run: ${event.runId}`,
        `Question: ${summarizeOpenPrompt(openPrompt)}`,
        ...footerLines(runLink, true),
      ].join("\n")
    }
    default:
      return null
  }
}

type DedupPlan = {
  key: string
  expiresAt: number | null
}

function dedupPlanForEvent(event: SupportedTelegramEvent, now: number): DedupPlan {
  switch (event.type) {
    case "run_started":
      return { key: `${event.runId}:run_started`, expiresAt: null }
    case "run_finished":
      return { key: `${event.runId}:run_finished`, expiresAt: null }
    case "stage_completed":
      return { key: `${event.runId}:stage_completed:${event.stageRunId}`, expiresAt: null }
    case "run_blocked": {
      const scope =
        event.scope.type === "run"
          ? "run"
          : event.scope.type === "stage"
          ? `stage:${event.scope.stageId}`
          : `story:${event.scope.waveNumber}:${event.scope.storyId}`
      return { key: `${event.runId}:run_blocked:${scope}`, expiresAt: null }
    }
    case "prompt_requested":
      return {
        key: `${event.runId}:prompt_requested`,
        expiresAt: now + PROMPT_NOTIFY_MIN_GAP_MS,
      }
  }
}

function shouldFetchOpenPrompt(event: SupportedTelegramEvent): boolean {
  return event.type === "run_blocked" || event.type === "prompt_requested"
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

    const openPrompt = shouldFetchOpenPrompt(event)
      ? buildConversation(this.repos, event.runId)?.openPrompt ?? null
      : null

    // prompt_requested needs an open prompt to be actionable — if it resolved
    // faster than the bus delivered the event, skip rather than send a bare
    // "something happened" ping.
    if (event.type === "prompt_requested" && !openPrompt) {
      return { delivered: false, eventType: event.type, reason: "prompt already answered" }
    }

    const message = buildMessage(
      event,
      createExternalLinkBuilder(telegram.publicBaseUrl).run(event.runId),
      openPrompt,
    )
    if (!message) {
      return { delivered: false, eventType: event.type, reason: "event not supported" }
    }

    const token = process.env[telegram.botTokenEnv]?.trim()
    if (!token) {
      return { delivered: false, eventType: event.type, reason: `${telegram.botTokenEnv} is not set` }
    }

    const plan = dedupPlanForEvent(event, Date.now())
    const claimed = this.repos.claimNotificationDelivery({
      dedupKey: plan.key,
      channel: "telegram",
      chatId: telegram.chatId,
      runId: event.runId,
      promptId: openPrompt?.promptId ?? null,
      expiresAt: plan.expiresAt,
    })
    if (!claimed) {
      return { delivered: false, eventType: event.type, reason: `duplicate notification skipped (${plan.key})` }
    }

    const text = sanitizeTelegramText(message, [token])
    const result = await this.client.send({
      token,
      chatId: telegram.chatId,
      text,
    })
    if (!result.ok) {
      this.repos.completeNotificationDelivery(plan.key, {
        status: "failed",
        errorMessage: result.error,
      })
      console.error("[notifications.telegram]", result.error)
      return { delivered: false, eventType: event.type, reason: result.error }
    }
    this.repos.completeNotificationDelivery(plan.key, {
      status: "delivered",
      telegramMessageId: result.messageId ?? null,
    })
    return { delivered: true, eventType: event.type }
  }
}
