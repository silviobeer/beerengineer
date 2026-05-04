import { test } from "node:test"
import assert from "node:assert/strict"
import { finalWaveValidationGate } from "../../../src/stages/mergeGate/supabaseGates.js"

test("PROJ-4 PRD-7 US-1: final wave validation gates DB-relevant merges only", () => {
  assert.equal(finalWaveValidationGate({ dbRelevant: true, lifecycleState: "validated" }).ok, true)
  assert.equal(finalWaveValidationGate({ dbRelevant: false, lifecycleState: "failed" }).ok, true)
  const blocked = finalWaveValidationGate({ dbRelevant: true, lifecycleState: "retained-for-diagnosis", failingStep: "migration smoke", providerMessage: "duplicate 0123_init.sql" })
  assert.equal(blocked.ok, false)
  assert.deepEqual(blocked.details, { failingStep: "migration smoke", message: "duplicate 0123_init.sql" })
})
