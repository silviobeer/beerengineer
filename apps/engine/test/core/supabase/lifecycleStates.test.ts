import { test } from "node:test"
import assert from "node:assert/strict"
import { canAutoCleanup, retainForDiagnosis, SUPABASE_LIFECYCLE_STATES } from "../../../src/core/supabase/lifecycleStates.js"

test("PROJ-4 PRD-5 US-2: failed, timeout, and aborted branches retain for diagnosis", () => {
  assert.ok(SUPABASE_LIFECYCLE_STATES.includes("retained-for-diagnosis"))
  assert.equal(retainForDiagnosis("failed"), "retained-for-diagnosis")
  assert.equal(retainForDiagnosis("timeout"), "retained-for-diagnosis")
  assert.equal(retainForDiagnosis("aborted"), "retained-for-diagnosis")
  assert.equal(canAutoCleanup("retained-for-diagnosis"), false)
})
