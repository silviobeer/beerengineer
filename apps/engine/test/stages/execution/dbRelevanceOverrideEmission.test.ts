import { test } from "node:test"
import assert from "node:assert/strict"

import { buildDbRelevanceWaveStatus } from "../../../src/core/dbRelevance/waveStatus.js"

test("PROJ-4 PRD-4 US-3: wave status emits override and reason", () => {
  const status = buildDbRelevanceWaveStatus({
    id: "W1",
    number: 1,
    goal: "g",
    kind: "feature",
    stories: [{ id: "US-1", title: "docs", dbRelevant: false, dbRelevanceOverride: "not-db-relevant", dbRelevanceOverrideReason: "docs-only" }],
    internallyParallelizable: false,
    dependencies: [],
    exitCriteria: [],
  })
  assert.deepEqual(status.stories[0], { storyId: "US-1", value: false, source: "override", reason: "docs-only" })
})

