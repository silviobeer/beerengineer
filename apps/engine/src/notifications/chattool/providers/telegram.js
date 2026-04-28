import { sanitizeTelegramText, sendTelegramMessage, sendTelegramReaction, } from "../../telegram.js";
const MAX_WEBHOOK_BYTES = 128 * 1024;
export function resolveTelegramChatToolConfig(config) {
    const telegram = config.notifications?.telegram;
    if (telegram?.enabled !== true)
        return { enabled: false, reason: "telegram disabled" };
    const botTokenEnv = telegram.botTokenEnv?.trim();
    const chatId = telegram.defaultChatId?.trim();
    const publicBaseUrl = config.publicBaseUrl?.trim();
    if (!botTokenEnv || !chatId || !publicBaseUrl)
        return { enabled: false, reason: "telegram misconfigured" };
    const botToken = process.env[botTokenEnv]?.trim();
    if (!botToken)
        return { enabled: false, reason: `${botTokenEnv} is not set` };
    const secretEnv = telegram.inbound?.webhookSecretEnv?.trim();
    const secretToken = secretEnv ? process.env[secretEnv]?.trim() : undefined;
    return {
        enabled: true,
        level: telegram.level ?? 2,
        botToken,
        botTokenEnv,
        chatId,
        publicBaseUrl,
        secretToken,
    };
}
async function readJson(req) {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buffer.byteLength;
        if (total > MAX_WEBHOOK_BYTES)
            return {};
        chunks.push(buffer);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    if (!raw)
        return {};
    try {
        return JSON.parse(raw);
    }
    catch {
        return {};
    }
}
export class TelegramChatToolProvider {
    botToken;
    deps;
    id = "telegram";
    constructor(botToken, deps = {}) {
        this.botToken = botToken;
        this.deps = deps;
    }
    async send(message) {
        const impl = this.deps.send ?? sendTelegramMessage;
        const result = await impl({
            token: this.botToken,
            chatId: message.channelRef,
            text: sanitizeTelegramText(message.text, [this.botToken]),
        });
        if (!result.ok)
            return { ok: false, error: result.error };
        return { ok: true, providerMessageId: result.messageId ? String(result.messageId) : null };
    }
    async parseWebhook(req) {
        const update = (await readJson(req));
        const message = update.message;
        if (!message?.text || !message.chat?.id)
            return null;
        return {
            providerMessageId: typeof message.message_id === "number" ? String(message.message_id) : null,
            replyToProviderMessageId: typeof message.reply_to_message?.message_id === "number" ? String(message.reply_to_message.message_id) : null,
            channelRef: String(message.chat.id),
            userHandle: message.from?.username ?? String(message.from?.id ?? "unknown"),
            text: message.text.trim(),
        };
    }
    async react(chatId, messageId, emoji) {
        const impl = this.deps.react ?? sendTelegramReaction;
        const numeric = Number(messageId);
        if (!Number.isFinite(numeric))
            return;
        await impl({ token: this.botToken, chatId, messageId: numeric, emoji });
    }
}
