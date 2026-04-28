import { projectWorkflowEvent } from "../../core/messagingProjection.js";
import { ChatToolDispatcher } from "./dispatcher.js";
import { resolveTelegramChatToolConfig, TelegramChatToolProvider } from "./providers/telegram.js";
export function attachChatToolNotifications(bus, repos, config, opts = {}) {
    const telegram = resolveTelegramChatToolConfig(config);
    if (!telegram.enabled)
        return null;
    const provider = new TelegramChatToolProvider(telegram.botToken, opts.telegram);
    const dispatcher = new ChatToolDispatcher(provider, telegram.level, repos, telegram.publicBaseUrl, telegram.chatId);
    return bus.subscribe(event => {
        const entry = projectWorkflowEvent(event, {
            id: event.streamId ?? `bus:${event.type}:${event.at ?? Date.now()}`,
            ts: event.at ?? Date.now(),
        });
        void dispatcher.onMessage(entry).catch(err => {
            console.error(`[notifications.${provider.id}]`, err.message);
        });
    });
}
