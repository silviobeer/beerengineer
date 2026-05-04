export type DbWaveStartResult =
  | { ok: true; queued: false }
  | { ok: false; queued: true; error: "db_relevant_wave_active"; message: string }

export function canStartDbRelevantWave(input: {
  dbRelevant: boolean
  activeDbRelevantWaveIds: string[]
}): DbWaveStartResult {
  if (!input.dbRelevant) return { ok: true, queued: false }
  if (input.activeDbRelevantWaveIds.length > 0) {
    return {
      ok: false,
      queued: true,
      error: "db_relevant_wave_active",
      message: "Another DB-relevant wave for this item is still active.",
    }
  }
  return { ok: true, queued: false }
}
