import { test } from "node:test"
import assert from "node:assert/strict"

import { runSupabaseProvisionIfDbRelevant } from "../../../src/stages/execution/supabaseWaveGate.js"
import type { WaveDefinition } from "../../../src/types.js"

test("PROJ-4 PRD-1 US-5: non-DB-relevant waves bypass Supabase adapter operations", async () => {
  const wave: WaveDefinition = {
    id: "W1",
    number: 1,
    goal: "non-db work",
    kind: "feature",
    stories: [{ id: "US-1", title: "copy change", dbRelevant: false }],
    dbRelevantStoryCount: 0,
    dbRelevantWave: false,
    internallyParallelizable: false,
    dependencies: [],
    exitCriteria: [],
  }

  const result = await runSupabaseProvisionIfDbRelevant(wave, {
    provisionBranch: async () => { throw new Error("adapter must not be called") },
    pollBranchStatus: async () => { throw new Error("adapter must not be called") },
    validateBranch: async () => { throw new Error("adapter must not be called") },
    destroyBranch: async () => { throw new Error("adapter must not be called") },
    migrateProduction: async () => { throw new Error("adapter must not be called") },
    reconcile: async () => { throw new Error("adapter must not be called") },
  }, { workspaceId: "ws-1" })

  assert.deepEqual(result, { dbRelevantWave: false, provisioned: false, reason: "wave is not DB-relevant" })
})

