const PREVIEW_MAX_CHARS = 2048
const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{16,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]+/g,
]

function redactSecrets(value: string): string {
  let redacted = value
  for (const pattern of SECRET_PATTERNS) redacted = redacted.replace(pattern, "[redacted]")
  return redacted
}

export function truncatePreview(value: string, maxChars = PREVIEW_MAX_CHARS): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`
}

export function sanitizePreviewText(value: string, maxChars = PREVIEW_MAX_CHARS): string {
  return truncatePreview(redactSecrets(value), maxChars)
}

export function sanitizePreviewValue(value: unknown, maxChars = PREVIEW_MAX_CHARS): string | undefined {
  if (value === undefined) return undefined
  const text = typeof value === "string" ? value : JSON.stringify(value)
  if (!text) return undefined
  return sanitizePreviewText(text, maxChars)
}
