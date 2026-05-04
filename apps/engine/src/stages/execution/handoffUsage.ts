export type HandoffUsageRecord = {
  runId: string
  waveId: string
  workerId: string
}

const seen = new Set<string>()

export function resetHandoffUsageForTests(): void {
  seen.clear()
}

export function detectHandoffConsumed(input: {
  runId: string
  waveId: string
  workerId: string
  line: string
}): HandoffUsageRecord | null {
  if (!input.line.includes("[supabase]") && !/https?:\/\/[^ ]*supabase/i.test(input.line)) return null
  const key = `${input.runId}:${input.waveId}:${input.workerId}`
  if (seen.has(key)) return null
  seen.add(key)
  return { runId: input.runId, waveId: input.waveId, workerId: input.workerId }
}

export function handoffUsageWarning(input: { dbRelevantWave: boolean; consumedEvents: HandoffUsageRecord[] }): string | null {
  if (!input.dbRelevantWave || input.consumedEvents.length > 0) return null
  return "DB-relevant wave with no Supabase usage observed"
}
