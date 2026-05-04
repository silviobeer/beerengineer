/**
 * Parse HTTP `Retry-After` header values.
 *
 * Supports both forms defined in RFC 7231:
 *   - Numeric seconds: e.g. "120"
 *   - HTTP-date: e.g. "Mon, 04 May 2026 12:00:30 GMT"
 *
 * Returns the delay in milliseconds, or `null` when the header is absent
 * or unparseable. The result is clamped to {@link RETRY_AFTER_CEILING_MS}
 * so a hostile or buggy server can't make us sleep for hours.
 *
 * QA-027: previously call sites used `Number(value)` directly which silently
 * produced `NaN` for the HTTP-date form, defeating retry/backoff logic.
 */

export const RETRY_AFTER_CEILING_MS = 5 * 60_000 // 5 minutes

export function parseRetryAfter(value: string | undefined | null, now: Date = new Date()): number | null {
  if (value === undefined || value === null) return null
  const trimmed = value.trim()
  if (trimmed === "") return null

  // Numeric seconds form. Per RFC 7231, this MUST be a non-negative integer.
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed)
    if (!Number.isFinite(seconds) || seconds < 0) return null
    return clamp(seconds * 1_000)
  }

  // HTTP-date form. Date.parse handles RFC 7231 IMF-fixdate.
  const parsed = Date.parse(trimmed)
  if (!Number.isFinite(parsed)) return null
  const delta = parsed - now.getTime()
  if (delta < 0) return 0
  return clamp(delta)
}

function clamp(ms: number): number {
  return Math.min(ms, RETRY_AFTER_CEILING_MS)
}
