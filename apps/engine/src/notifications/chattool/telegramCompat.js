import { ChatToolDispatcher } from "./dispatcher.js";
import { attachChatToolNotifications } from "./index.js";
import { resolveTelegramChatToolConfig, TelegramChatToolProvider } from "./providers/telegram.js";
import { handleTelegramChatToolWebhook, resetTelegramChatToolWebhookRateLimit, } from "./webhooks/telegram.js";
export function isSupportedTelegramEvent(event) {
    return (event.type === "run_started" ||
        event.type === "run_blocked" ||
        event.type === "run_finished" ||
        event.type === "phase_completed" ||
        event.type === "phase_failed" ||
        event.type === "prompt_requested");
}
export class TelegramNotificationDispatcher {
    config;
    repos;
    delegate;
    constructor(config, repos, client) {
        this.config = config;
        this.repos = repos;
        const resolved = resolveTelegramChatToolConfig(config);
        if (!resolved.enabled) {
            this.delegate = null;
            return;
        }
        const deps = typeof client === "function" ? { send: client } : client ?? {};
        const provider = new TelegramChatToolProvider(resolved.botToken, deps);
        this.delegate = new ChatToolDispatcher(provider, resolved.level, repos, resolved.publicBaseUrl, resolved.chatId);
    }
    async deliver(event) {
        if (!this.delegate) {
            return { delivered: false, eventType: event.type, reason: "telegram not configured" };
        }
        if (!isSupportedTelegramEvent(event)) {
            return { delivered: false, eventType: event.type, reason: "event not supported" };
        }
        const result = await this.delegate.onMessage(event);
        if (!result)
            return { delivered: false, eventType: event.type, reason: "event not supported" };
        if (!result.ok)
            return { delivered: false, eventType: event.type, reason: result.error };
        return { delivered: true, eventType: event.type };
    }
}
export function attachTelegramNotifications(bus, repos, config, opts = {}) {
    return attachChatToolNotifications(bus, repos, config, {
        telegram: opts.client ? { send: opts.client } : undefined,
    });
}
export function resetTelegramWebhookRateLimit() {
    return resetTelegramChatToolWebhookRateLimit();
}
export async function handleTelegramWebhook(repos, config, req, res, deps = {}) {
    return handleTelegramChatToolWebhook(repos, config, req, res, deps);
}
export const __internals = {
    handleTelegramChatToolWebhook,
};
