export type HandoffUsageRecord = {
  runId: string
  waveId: string
  workerId: string
}

const DEFAULT_HANDOFF_USAGE_TTL_MS = 10 * 60 * 1000
const DEFAULT_HANDOFF_USAGE_MAX_ENTRIES = 10_000

export type HandoffUsageDetector = {
  detect(input: {
    runId: string
    waveId: string
    workerId: string
    line: string
  }): HandoffUsageRecord | null
  dispose(): void
}

export function createHandoffUsageDetector(
  input: { ttlMs?: number; maxEntries?: number } = {},
): HandoffUsageDetector {
  const seen = new Map<string, number>()
  const ttlMs = input.ttlMs ?? DEFAULT_HANDOFF_USAGE_TTL_MS
  const maxEntries = input.maxEntries ?? DEFAULT_HANDOFF_USAGE_MAX_ENTRIES
  let cleanupTimer: ReturnType<typeof setInterval> | null = null
  let disposed = false

  const cleanupExpired = (now: number): void => {
    for (const [key, ts] of seen) {
      if (now - ts > ttlMs) seen.delete(key)
    }
  }

  const ensureCleanupTimer = (): void => {
    if (cleanupTimer || disposed) return
    cleanupTimer = setInterval(() => cleanupExpired(Date.now()), Math.min(ttlMs, 60_000))
    cleanupTimer.unref?.()
  }

  const evictIfOverCapacity = (): void => {
    while (seen.size > maxEntries) {
      // Map preserves insertion order — first key is the oldest.
      const oldest = seen.keys().next()
      if (oldest.done) return
      seen.delete(oldest.value)
    }
  }

  return {
    detect(input): HandoffUsageRecord | null {
      if (disposed) return null
      if (!input.line.includes("[supabase]") && !/https?:\/\/[^ ]*supabase/i.test(input.line)) return null
      const now = Date.now()
      const key = `${input.runId}:${input.waveId}:${input.workerId}`
      if (seen.has(key)) return null
      seen.set(key, now)
      evictIfOverCapacity()
      ensureCleanupTimer()
      return { runId: input.runId, waveId: input.waveId, workerId: input.workerId }
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      if (cleanupTimer) {
        clearInterval(cleanupTimer)
        cleanupTimer = null
      }
      seen.clear()
    },
  }
}

// Module-level default detector preserved for the existing log-stream wiring
// and the legacy `detectHandoffConsumed` API. The factory above is the path
// forward; new call sites should construct their own bounded detector.
let defaultDetector: HandoffUsageDetector = createHandoffUsageDetector()

export function resetHandoffUsageForTests(): void {
  defaultDetector.dispose()
  defaultDetector = createHandoffUsageDetector()
}

export function configureHandoffUsageRetentionForTests(input: { ttlMs?: number; maxEntries?: number } = {}): void {
  defaultDetector.dispose()
  defaultDetector = createHandoffUsageDetector(input)
}

export function detectHandoffConsumed(input: {
  runId: string
  waveId: string
  workerId: string
  line: string
}): HandoffUsageRecord | null {
  return defaultDetector.detect(input)
}

export function handoffUsageWarning(input: { dbRelevantWave: boolean; consumedEvents: HandoffUsageRecord[] }): string | null {
  if (!input.dbRelevantWave || input.consumedEvents.length > 0) return null
  return "DB-relevant wave with no Supabase usage observed"
}
