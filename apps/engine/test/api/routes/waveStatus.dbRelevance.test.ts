import { test } from "node:test"
import assert from "node:assert/strict"

import { buildDbRelevanceWaveStatus } from "../../../src/core/dbRelevance/waveStatus.js"

test("PROJ-4 PRD-4 US-5: wave status exposes per-story and wave-level db relevance", () => {
  const status = buildDbRelevanceWaveStatus({
    id: "W1",
    number: 1,
    goal: "g",
    kind: "feature",
    stories: [
      { id: "US-1", title: "schema", dbRelevant: true },
      { id: "US-2", title: "copy", dbRelevant: false },
    ],
    internallyParallelizable: false,
    dependencies: [],
    exitCriteria: [],
  })
  assert.equal(status.dbRelevantWave, true)
  assert.equal(status.willInvokeSupabase, true)
  assert.deepEqual(status.stories.map(story => story.source), ["explicit", "explicit"])
})

