import { shouldDeliverAtLevel } from "../../core/messagingLevel.js";
import { CHATTOOL_PROMPT_RENOTIFY_WINDOW_MS } from "../../core/constants.js";
import { createExternalLinkBuilder } from "../links.js";
import { correlationKeyForMessage, describeChatMessage, messageRoleForEntry } from "./render.js";
export class ChatToolDispatcher {
    provider;
    subscribedLevel;
    repos;
    publicBaseUrl;
    channelRef;
    constructor(provider, subscribedLevel, repos, publicBaseUrl, channelRef) {
        this.provider = provider;
        this.subscribedLevel = subscribedLevel;
        this.repos = repos;
        this.publicBaseUrl = publicBaseUrl;
        this.channelRef = channelRef;
    }
    async onMessage(entry) {
        if (!shouldDeliverAtLevel(entry, this.subscribedLevel))
            return null;
        const message = describeChatMessage(entry, this.repos);
        if (!message)
            return null;
        const correlationKey = correlationKeyForMessage(entry);
        const claimed = this.repos.claimNotificationDelivery({
            dedupKey: correlationKey,
            channel: this.provider.id,
            chatId: this.channelRef,
            runId: entry.runId,
            promptId: message.promptId,
            expiresAt: entry.type === "prompt_requested" ? Date.now() + CHATTOOL_PROMPT_RENOTIFY_WINDOW_MS : null,
        });
        // Dedup suppression is not a provider-side failure, but callers still
        // need to distinguish it from "no matching template" (null). Keep the
        // `{ ok: false, error }` shape with a stable prefix so the compat layer
        // can report `duplicate notification skipped (...)` as the reason.
        if (!claimed)
            return { ok: false, error: `duplicate notification skipped (${correlationKey})` };
        const links = createExternalLinkBuilder(this.publicBaseUrl);
        const result = await this.provider.send({
            channelRef: this.channelRef,
            text: `${message.text}\nOpen: ${links.run(entry.runId)}`,
            correlationKey,
            messageRole: messageRoleForEntry(entry),
            linkback: links.run(entry.runId),
        });
        if (!result.ok) {
            this.repos.completeNotificationDelivery(correlationKey, {
                status: "failed",
                errorMessage: result.error,
            });
            return result;
        }
        const telegramMessageId = this.provider.id === "telegram" && result.providerMessageId ? Number(result.providerMessageId) : null;
        this.repos.completeNotificationDelivery(correlationKey, {
            status: "delivered",
            telegramMessageId: Number.isFinite(telegramMessageId) ? telegramMessageId : null,
        });
        return result;
    }
}
