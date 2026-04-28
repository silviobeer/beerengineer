const MESSAGE_MAX_CHARS = 3500;
const FIELD_MAX_CHARS = 500;
const TELEGRAM_TIMEOUT_MS = 5_000;
const SECRET_PATTERNS = [
    /sk-[A-Za-z0-9_-]{16,}/g,
    /ghp_[A-Za-z0-9]{20,}/g,
    /xox[baprs]-[A-Za-z0-9-]+/g,
];
function resolveTelegramApiBaseUrl() {
    return (process.env.BEERENGINEER_TELEGRAM_API_BASE_URL ?? "https://api.telegram.org").replace(/\/+$/, "");
}
export function truncateForTelegram(value, maxChars = FIELD_MAX_CHARS) {
    if (value.length <= maxChars)
        return value;
    return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}
export function redactSecrets(value, secrets = []) {
    let redacted = value;
    for (const pattern of SECRET_PATTERNS) {
        redacted = redacted.replace(pattern, "[redacted]");
    }
    for (const secret of secrets.filter(Boolean)) {
        redacted = redacted.split(secret).join("[redacted]");
    }
    return redacted;
}
export function sanitizeTelegramText(value, secrets = []) {
    const lines = value
        .split("\n")
        .map(line => truncateForTelegram(redactSecrets(line, secrets)));
    return truncateForTelegram(lines.join("\n"), MESSAGE_MAX_CHARS);
}
function timeoutSignal(timeoutMs) {
    return AbortSignal.timeout(timeoutMs);
}
function parseRetryAfter(response) {
    // RFC 7231 allows `Retry-After: <HTTP-date>` too, but the Telegram Bot API
    // always returns integer seconds, so we only handle the numeric form here.
    const header = response.headers.get("retry-after");
    if (!header)
        return null;
    const seconds = Number(header);
    if (!Number.isFinite(seconds) || seconds < 0)
        return null;
    return seconds * 1000;
}
async function sleep(ms) {
    await new Promise(resolve => setTimeout(resolve, ms));
}
async function sendOnce(request, fetchImpl, timeoutMs) {
    return fetchImpl(`${resolveTelegramApiBaseUrl()}/bot${encodeURIComponent(request.token)}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            chat_id: request.chatId,
            text: request.text,
        }),
        signal: timeoutSignal(timeoutMs),
    });
}
async function extractMessageId(response) {
    try {
        const body = (await response.clone().json());
        const id = body?.result?.message_id;
        return typeof id === "number" ? id : undefined;
    }
    catch {
        return undefined;
    }
}
export async function sendTelegramMessage(request, opts = {}) {
    const fetchImpl = opts.fetchImpl ?? fetch;
    const timeoutMs = opts.timeoutMs ?? TELEGRAM_TIMEOUT_MS;
    try {
        let response = await sendOnce(request, fetchImpl, timeoutMs);
        if (response.status === 429) {
            const retryAfter = parseRetryAfter(response);
            if (retryAfter !== null) {
                await sleep(retryAfter);
                response = await sendOnce(request, fetchImpl, timeoutMs);
            }
        }
        if (response.ok) {
            const messageId = await extractMessageId(response);
            return { ok: true, status: response.status, messageId };
        }
        return {
            ok: false,
            status: response.status,
            error: `telegram send failed with HTTP ${response.status}`,
            dropped: true,
        };
    }
    catch (err) {
        return {
            ok: false,
            error: err.message,
            dropped: true,
        };
    }
}
/**
 * Best-effort reaction (e.g. 👍) on an existing message to acknowledge an
 * inbound answer. Failures are swallowed — acknowledgement is a nicety, not
 * a correctness requirement.
 */
export async function sendTelegramReaction(request, opts = {}) {
    const fetchImpl = opts.fetchImpl ?? fetch;
    const timeoutMs = opts.timeoutMs ?? TELEGRAM_TIMEOUT_MS;
    try {
        await fetchImpl(`${resolveTelegramApiBaseUrl()}/bot${encodeURIComponent(request.token)}/setMessageReaction`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                chat_id: request.chatId,
                message_id: request.messageId,
                reaction: [{ type: "emoji", emoji: request.emoji }],
            }),
            signal: timeoutSignal(timeoutMs),
        });
    }
    catch {
        // noop: the operator already got a human-readable reply-text, reaction is optional.
    }
}
