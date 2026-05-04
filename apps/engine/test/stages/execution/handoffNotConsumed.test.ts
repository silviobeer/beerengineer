import { test } from "node:test"
import assert from "node:assert/strict"
import { handoffUsageWarning } from "../../../src/stages/execution/handoffUsage.js"

test("PROJ-4 PRD-6 US-4: DB wave without handoff consumption warns but does not fail", () => {
  assert.equal(handoffUsageWarning({ dbRelevantWave: true, consumedEvents: [] }), "DB-relevant wave with no Supabase usage observed")
  assert.equal(handoffUsageWarning({ dbRelevantWave: true, consumedEvents: [{ runId: "r", waveId: "w", workerId: "a" }] }), null)
  assert.equal(handoffUsageWarning({ dbRelevantWave: false, consumedEvents: [] }), null)
})
