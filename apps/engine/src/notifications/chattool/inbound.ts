import type { Repos } from "../../db/repositories.js"
import { answerRunPromptInProcess } from "../../core/runService.js"
import type { ChatToolId, ChatToolInboundUpdate } from "./types.js"

export type InboundHandleResult =
  | { ok: true; kind: "answer" }
  | { ok: false; error: string }

export async function handleChatToolInbound(
  repos: Repos,
  providerId: ChatToolId,
  update: ChatToolInboundUpdate,
): Promise<InboundHandleResult> {
  if (providerId !== "telegram") return { ok: false, error: `unsupported provider ${providerId}` }

  const replyTo = update.replyToProviderMessageId ? Number(update.replyToProviderMessageId) : null
  if (replyTo === null || !Number.isFinite(replyTo)) return { ok: false, error: "reply_required" }

  const delivery = repos.findTelegramDeliveryByMessage({ chatId: update.channelRef, messageId: replyTo })
  if (!delivery?.run_id || !delivery?.prompt_id) return { ok: false, error: "prompt_delivery_not_found" }

  const result = await answerRunPromptInProcess(repos, {
    runId: delivery.run_id,
    promptId: delivery.prompt_id,
    answer: update.text,
    source: "webhook",
  }, {
    resumeBlockedRunInProcess: true,
  })
  if (!result.ok) return { ok: false, error: result.code }
  return { ok: true, kind: "answer" }
}
