import { test } from "node:test"
import assert from "node:assert/strict"

import { qaDbRelevanceMismatch } from "../../../src/stages/qa/dbRelevance.js"

test("PROJ-4 PRD-4 US-4: QA blocks mismatches and clears after corrected metadata", () => {
  const signal = [{ kind: "path" as const, path: "supabase/seed.sql", reason: "seed changed" }]
  assert.equal(qaDbRelevanceMismatch({ id: "US-1", dbRelevant: false }, signal).blocked, true)
  assert.equal(qaDbRelevanceMismatch({ id: "US-1", dbRelevant: true }, signal).blocked, false)
})

