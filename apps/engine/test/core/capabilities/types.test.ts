import { test } from "node:test"
import assert from "node:assert/strict"

import { CAPABILITY_IDS, isCapabilityId, type CapabilityId } from "../../../src/core/capabilities/types.js"

test("PROJ-4 PRD-1 US-1: supabase joins the exact closed capability ID set", () => {
  const expected: CapabilityId[] = ["git", "github", "sonar", "coderabbit", "supabase"]

  assert.deepEqual([...CAPABILITY_IDS].sort(), [...expected].sort())
  assert.equal(isCapabilityId("supabase"), true)
  assert.equal(isCapabilityId("supabase-cloud"), false)
  assert.equal(isCapabilityId("database"), false)
})

