export type HandoffUsageRecord = {
  runId: string
  waveId: string
  workerId: string
}

const seen = new Map<string, number>()
const DEFAULT_HANDOFF_USAGE_TTL_MS = 10 * 60 * 1000
let ttlMs = DEFAULT_HANDOFF_USAGE_TTL_MS
let cleanupTimer: ReturnType<typeof setInterval> | null = null

export function resetHandoffUsageForTests(): void {
  seen.clear()
  ttlMs = DEFAULT_HANDOFF_USAGE_TTL_MS
  if (cleanupTimer) clearInterval(cleanupTimer)
  cleanupTimer = null
}

export function configureHandoffUsageRetentionForTests(input: { ttlMs?: number } = {}): void {
  ttlMs = input.ttlMs ?? DEFAULT_HANDOFF_USAGE_TTL_MS
}

function cleanupExpired(now: number): void {
  for (const [key, ts] of seen) {
    if (now - ts > ttlMs) seen.delete(key)
  }
}

function ensureCleanupTimer(): void {
  if (cleanupTimer) return
  cleanupTimer = setInterval(() => cleanupExpired(Date.now()), Math.min(ttlMs, 60_000))
  cleanupTimer.unref?.()
}

export function detectHandoffConsumed(input: {
  runId: string
  waveId: string
  workerId: string
  line: string
}): HandoffUsageRecord | null {
  if (!input.line.includes("[supabase]") && !/https?:\/\/[^ ]*supabase/i.test(input.line)) return null
  const now = Date.now()
  cleanupExpired(now)
  const key = `${input.runId}:${input.waveId}:${input.workerId}`
  if (seen.has(key)) return null
  seen.set(key, now)
  ensureCleanupTimer()
  return { runId: input.runId, waveId: input.waveId, workerId: input.workerId }
}

export function handoffUsageWarning(input: { dbRelevantWave: boolean; consumedEvents: HandoffUsageRecord[] }): string | null {
  if (!input.dbRelevantWave || input.consumedEvents.length > 0) return null
  return "DB-relevant wave with no Supabase usage observed"
}
