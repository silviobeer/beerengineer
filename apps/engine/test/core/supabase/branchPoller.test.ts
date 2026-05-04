import { test } from "node:test"
import assert from "node:assert/strict"
import { pollSupabaseBranch, SupabaseBranchPollTimeoutError } from "../../../src/core/supabase/branchPoller.js"
import { SupabaseManagementError } from "../../../src/core/supabase/managementClient.js"

function clock() {
  let t = 0
  const sleeps: number[] = []
  return {
    sleeps,
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms)
      t += ms
    },
  }
}

test("PROJ-4 PRD-2 US-3: branch poller respects 5s/30s/10min contract", async () => {
  const c = clock()
  let count = 0
  const branch = await pollSupabaseBranch({
    clock: c,
    poll: async () => (++count >= 4 ? { id: "br", ref: "br", status: "ACTIVE_HEALTHY" } : { id: "br", ref: "br", status: "CREATING" }),
  })
  assert.equal(branch.status, "ACTIVE_HEALTHY")
  assert.deepEqual(c.sleeps, [5_000, 10_000, 20_000])
})

test("PROJ-4 PRD-2 US-3: branch poller times out and honors retry-after without extending budget", async () => {
  const c = clock()
  await assert.rejects(() => pollSupabaseBranch({
    clock: c,
    timeoutMs: 20_000,
    poll: async () => {
      throw new SupabaseManagementError("rate_limit", "slow", 429, "30")
    },
  }), SupabaseBranchPollTimeoutError)
})
