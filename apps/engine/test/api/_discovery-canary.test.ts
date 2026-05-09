import { test } from "node:test"
import assert from "node:assert/strict"

// Permanent canary placed in a subdirectory so its collection depends on
// recursive engine-test discovery (PROJ-8-PRD-1-US-1). The test name below is
// a globally unique string the public acceptance check searches for in the
// ordinary command output. Do not rename.
test("PROJ-8-PRD-1-US-1: nested-discovery-canary", () => {
  assert.equal(1 + 1, 2)
})
