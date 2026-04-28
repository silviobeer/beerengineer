import { recordAnswer, recordUserMessage } from "../../core/conversation.js";
export function handleChatToolInbound(repos, providerId, update) {
    if (providerId !== "telegram")
        return { ok: false, error: `unsupported provider ${providerId}` };
    const replyTo = update.replyToProviderMessageId ? Number(update.replyToProviderMessageId) : null;
    let delivery = replyTo !== null && Number.isFinite(replyTo)
        ? repos.findTelegramDeliveryByMessage({ chatId: update.channelRef, messageId: replyTo })
        : undefined;
    if (!delivery && replyTo === null) {
        delivery = repos.findLatestTelegramPromptDeliveryForChat(update.channelRef);
    }
    if (delivery?.run_id && delivery?.prompt_id) {
        const result = recordAnswer(repos, {
            runId: delivery.run_id,
            promptId: delivery.prompt_id,
            answer: update.text,
            source: "webhook",
        });
        if (!result.ok)
            return { ok: false, error: result.code };
        return { ok: true, kind: "answer" };
    }
    if (delivery?.run_id) {
        const result = recordUserMessage(repos, {
            runId: delivery.run_id,
            text: update.text,
            source: "webhook",
        });
        if (!result.ok)
            return { ok: false, error: result.code };
        return { ok: true, kind: "message" };
    }
    return { ok: true, kind: "ignored" };
}
