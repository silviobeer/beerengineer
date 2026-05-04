import { test } from "node:test"
import assert from "node:assert/strict"

import { reviewDbRelevanceMismatch } from "../../src/review/dbRelevance.js"

test("PROJ-4 PRD-4 US-4: review blocks DB signals on story marked non-DB", () => {
  const result = reviewDbRelevanceMismatch({ id: "US-1", dbRelevant: false }, [{ kind: "sql", path: "src/a.ts", reason: "drop table" }])
  assert.equal(result.blocked, true)
  if (result.blocked) assert.match(result.message, /src\/a\.ts/)
})

test("PROJ-4 PRD-4 US-4: review accepts valid override", () => {
  const result = reviewDbRelevanceMismatch(
    { id: "US-1", dbRelevant: false, dbRelevanceOverride: "not-db-relevant", dbRelevanceOverrideReason: "docs" },
    [{ kind: "sql", path: "docs/a.md", reason: "drop table" }],
  )
  assert.equal(result.blocked, false)
})

