import type { IncomingMessage } from "node:http"
import type { MessagingLevel } from "../../core/messagingLevel.js"
import type { MessageEntry } from "../../core/messagingProjection.js"

export type ChatToolId = "telegram" | "slack" | "teams" | "discord"

export type ChatToolOutboundMessage = {
  channelRef: string
  text: string
  correlationKey: string
  messageRole: "summary" | "prompt" | "event"
  linkback?: string
}

export type ChatToolOutboundResult =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; error: string }

export type ChatToolInboundUpdate = {
  providerMessageId: string | null
  replyToProviderMessageId: string | null
  channelRef: string
  userHandle: string
  text: string
}

export interface ChatToolProvider {
  readonly id: ChatToolId
  send(message: ChatToolOutboundMessage): Promise<ChatToolOutboundResult>
  parseWebhook(req: IncomingMessage): Promise<ChatToolInboundUpdate | null>
}

export type ChatToolConfig = {
  enabled: boolean
  level: MessagingLevel
}

export type ChatToolSupportedMessage = MessageEntry

