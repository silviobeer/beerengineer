const PREVIEW_MAX_CHARS = 2048;
const SECRET_PATTERNS = [
    /sk-[A-Za-z0-9_-]{16,}/g,
    /ghp_[A-Za-z0-9]{20,}/g,
    /xox[baprs]-[A-Za-z0-9-]+/g,
];
function redactSecrets(value) {
    let redacted = value;
    for (const pattern of SECRET_PATTERNS)
        redacted = redacted.replace(pattern, "[redacted]");
    return redacted;
}
export function truncatePreview(value, maxChars = PREVIEW_MAX_CHARS) {
    if (value.length <= maxChars)
        return value;
    return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}
export function sanitizePreviewText(value, maxChars = PREVIEW_MAX_CHARS) {
    return truncatePreview(redactSecrets(value), maxChars);
}
export function sanitizePreviewValue(value, maxChars = PREVIEW_MAX_CHARS) {
    if (value === undefined)
        return undefined;
    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (!text)
        return undefined;
    return sanitizePreviewText(text, maxChars);
}
