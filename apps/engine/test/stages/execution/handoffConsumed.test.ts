import { test } from "node:test"
import assert from "node:assert/strict"
import { detectHandoffConsumed, resetHandoffUsageForTests } from "../../../src/stages/execution/handoffUsage.js"

test("PROJ-4 PRD-6 US-4: handoff consumed event emits once per worker", () => {
  resetHandoffUsageForTests()
  assert.deepEqual(detectHandoffConsumed({ runId: "run", waveId: "wave", workerId: "w1", line: "[supabase] connected" }), {
    runId: "run",
    waveId: "wave",
    workerId: "w1",
  })
  assert.equal(detectHandoffConsumed({ runId: "run", waveId: "wave", workerId: "w1", line: "[supabase] again" }), null)
  assert.notEqual(detectHandoffConsumed({ runId: "run", waveId: "wave", workerId: "w2", line: "https://x.supabase.co" }), null)
})
