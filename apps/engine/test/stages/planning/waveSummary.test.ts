import { test } from "node:test"
import assert from "node:assert/strict"

import { summarizeWaveDbRelevance } from "../../../src/stages/planning/index.js"
import type { WaveDefinition } from "../../../src/types.js"

function wave(stories: WaveDefinition["stories"]): WaveDefinition {
  return {
    id: "W1",
    number: 1,
    goal: "g",
    kind: "feature",
    stories,
    internallyParallelizable: false,
    dependencies: [],
    exitCriteria: [],
  }
}

test("PROJ-4 PRD-4 US-1: wave summary marks all non-DB stories as non-DB wave", () => {
  assert.deepEqual(summarizeWaveDbRelevance(wave([
    { id: "US-1", title: "copy", dbRelevant: false },
    { id: "US-2", title: "docs", dbRelevant: false },
  ])), { dbRelevantStoryCount: 0, dbRelevantWave: false })
})

test("PROJ-4 PRD-4 US-1: wave summary marks any DB-relevant story as DB wave", () => {
  assert.deepEqual(summarizeWaveDbRelevance(wave([
    { id: "US-1", title: "schema", dbRelevant: true },
    { id: "US-2", title: "copy", dbRelevant: false },
  ])), { dbRelevantStoryCount: 1, dbRelevantWave: true })
})

