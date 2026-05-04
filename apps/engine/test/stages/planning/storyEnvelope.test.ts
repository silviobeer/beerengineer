import { test } from "node:test"
import assert from "node:assert/strict"

import { validatePlanStoryEnvelope } from "../../../src/stages/planning/index.js"

test("PROJ-4 PRD-4 US-1: story envelope accepts explicit dbRelevant booleans", () => {
  assert.equal(validatePlanStoryEnvelope(1, { id: "US-1", title: "schema", dbRelevant: true }), null)
  assert.equal(validatePlanStoryEnvelope(1, { id: "US-2", title: "copy", dbRelevant: false }), null)
})

test("PROJ-4 PRD-4 US-1: story envelope rejects missing or non-boolean dbRelevant", () => {
  assert.match(validatePlanStoryEnvelope(1, { id: "US-1", title: "missing" }) ?? "", /dbRelevant/)
  assert.match(validatePlanStoryEnvelope(1, { id: "US-2", title: "wrong", dbRelevant: "yes" }) ?? "", /dbRelevant/)
  assert.match(validatePlanStoryEnvelope(1, { id: "US-3", title: "null", dbRelevant: null }) ?? "", /dbRelevant/)
})

