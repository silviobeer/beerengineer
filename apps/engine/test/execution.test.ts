import { test } from "node:test"
import assert from "node:assert/strict"

import { assertWaveSucceeded } from "../src/stages/execution/index.js"

test("assertWaveSucceeded rejects blocked stories", () => {
  assert.throws(
    () =>
      assertWaveSucceeded(
        { id: "W2", number: 2, goal: "Parallel work", dependencies: [], parallel: true, stories: [] },
        {
          waveId: "W2",
          storiesMerged: [],
          storiesBlocked: ["US-02"],
        },
      ),
    /Wave W2 blocked stories: US-02/,
  )
})

test("assertWaveSucceeded accepts fully merged waves", () => {
  assert.doesNotThrow(() =>
    assertWaveSucceeded(
      { id: "W1", number: 1, goal: "Sequential work", dependencies: [], parallel: false, stories: [] },
      {
        waveId: "W1",
        storiesMerged: [{ storyId: "US-01", branch: "story/p01-us-01", commitCount: 3, filesIntegrated: [] }],
        storiesBlocked: [],
      },
    ),
  )
})
