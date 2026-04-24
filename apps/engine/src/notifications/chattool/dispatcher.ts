import type { MessageEntry } from "../../core/messagingProjection.js"
import { shouldDeliverAtLevel, type MessagingLevel } from "../../core/messagingLevel.js"
import type { Repos } from "../../db/repositories.js"
import { createExternalLinkBuilder } from "../links.js"
import { correlationKeyForMessage, describeChatMessage, messageRoleForEntry } from "./render.js"
import type { ChatToolOutboundResult, ChatToolProvider } from "./types.js"

export class ChatToolDispatcher {
  constructor(
    private readonly provider: ChatToolProvider,
    private readonly subscribedLevel: MessagingLevel,
    private readonly repos: Repos,
    private readonly publicBaseUrl: string,
    private readonly channelRef: string,
  ) {}

  async onMessage(entry: MessageEntry): Promise<ChatToolOutboundResult | null> {
    if (!shouldDeliverAtLevel(entry, this.subscribedLevel)) return null
    const message = describeChatMessage(entry, this.repos)
    if (!message) return null

    const correlationKey = correlationKeyForMessage(entry)
    const claimed = this.repos.claimNotificationDelivery({
      dedupKey: correlationKey,
      channel: this.provider.id,
      chatId: this.channelRef,
      runId: entry.runId,
      promptId: message.promptId,
      expiresAt: entry.type === "prompt_requested" ? Date.now() + 45_000 : null,
    })
    if (!claimed) return { ok: false, error: `duplicate notification skipped (${correlationKey})` }

    const links = createExternalLinkBuilder(this.publicBaseUrl)
    const result = await this.provider.send({
      channelRef: this.channelRef,
      text: `${message.text}\nOpen: ${links.run(entry.runId)}`,
      correlationKey,
      messageRole: messageRoleForEntry(entry),
      linkback: links.run(entry.runId),
    })

    if (!result.ok) {
      this.repos.completeNotificationDelivery(correlationKey, {
        status: "failed",
        errorMessage: result.error,
      })
      return result
    }

    const telegramMessageId =
      this.provider.id === "telegram" && result.providerMessageId ? Number(result.providerMessageId) : null
    this.repos.completeNotificationDelivery(correlationKey, {
      status: "delivered",
      telegramMessageId: Number.isFinite(telegramMessageId) ? telegramMessageId : null,
    })
    return result
  }
}
