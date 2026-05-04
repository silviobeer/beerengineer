import { test } from "node:test"
import assert from "node:assert/strict"
import { canStartDbRelevantWave } from "../../../src/stages/execution/dbWaveScheduler.js"

test("PROJ-4 PRD-5 US-5: scheduler blocks parallel DB-relevant waves only", () => {
  assert.deepEqual(canStartDbRelevantWave({ dbRelevant: true, activeDbRelevantWaveIds: ["wave-1"] }), {
    ok: false,
    queued: true,
    error: "db_relevant_wave_active",
    message: "Another DB-relevant wave for this item is still active.",
  })
  assert.deepEqual(canStartDbRelevantWave({ dbRelevant: true, activeDbRelevantWaveIds: [] }), { ok: true, queued: false })
  assert.deepEqual(canStartDbRelevantWave({ dbRelevant: false, activeDbRelevantWaveIds: ["wave-1"] }), { ok: true, queued: false })
})
