import { test } from "node:test"
import assert from "node:assert/strict"
import { provisionWaveIfDbRelevant } from "../../../src/core/supabase/waveProvision.js"

test("PROJ-4 PRD-5 US-1: DB waves provision exactly once before worker dispatch", async () => {
  const order: string[] = []
  const result = await provisionWaveIfDbRelevant({
    dbRelevantWave: true,
    adapter: { provisionBranch: async () => { order.push("provision"); return { ok: true } } },
    context: {},
    dispatchWorker: () => order.push("worker"),
  })
  assert.deepEqual(order, ["provision", "worker"])
  assert.deepEqual(result, { ok: true, provisioned: true, events: ["orchestration:provision_branch", "orchestration:dispatch_worker"] })
})

test("PROJ-4 PRD-5 US-1: non-DB and already-provisioned waves do not provision", async () => {
  let calls = 0
  const adapter = { provisionBranch: async () => { calls += 1; return { ok: true } } }
  assert.equal((await provisionWaveIfDbRelevant({ dbRelevantWave: false, adapter, context: {} })).provisioned, false)
  assert.equal((await provisionWaveIfDbRelevant({ dbRelevantWave: true, existingBranchRef: "br", adapter, context: {} })).provisioned, false)
  assert.equal(calls, 0)
})
