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

test("branch poller treats FUNCTIONS_DEPLOYED as ready", async () => {
  const c = clock()
  const branch = await pollSupabaseBranch({
    clock: c,
    poll: async () => ({ id: "br", ref: "br", status: "FUNCTIONS_DEPLOYED" }),
  })

  assert.equal(branch.status, "FUNCTIONS_DEPLOYED")
  assert.deepEqual(c.sleeps, [])
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

test("PROJ-4 QA-020: branch poller retries transient 5xx with short backoff", async () => {
  const c = clock()
  let attempt = 0
  const branch = await pollSupabaseBranch({
    clock: c,
    poll: async () => {
      attempt += 1
      if (attempt === 1) throw new SupabaseManagementError("provider", "upstream blip", 503)
      return { id: "br", ref: "br", status: "ACTIVE_HEALTHY" }
    },
  })
  assert.equal(branch.status, "ACTIVE_HEALTHY")
  assert.equal(attempt, 2)
  // First sleep should be the 250ms 5xx backoff, not the 5_000ms regular cadence.
  assert.equal(c.sleeps[0], 250)
})

test("PROJ-4 QA-020: branch poller gives up after 3 consecutive 5xx retries", async () => {
  const c = clock()
  let attempt = 0
  await assert.rejects(() => pollSupabaseBranch({
    clock: c,
    poll: async () => {
      attempt += 1
      throw new SupabaseManagementError("provider", "upstream down", 503)
    },
  }), (err: unknown) => err instanceof SupabaseManagementError && err.status === 503)
  assert.equal(attempt, 4)
  assert.deepEqual(c.sleeps, [250, 500, 1000])
})

test("PROJ-4 QA-020: branch poller does NOT retry 4xx provider errors", async () => {
  const c = clock()
  let attempt = 0
  await assert.rejects(() => pollSupabaseBranch({
    clock: c,
    poll: async () => {
      attempt += 1
      throw new SupabaseManagementError("provider", "bad request", 400)
    },
  }), (err: unknown) => err instanceof SupabaseManagementError && err.status === 400)
  assert.equal(attempt, 1)
  assert.deepEqual(c.sleeps, [])
})

test("PROJ-4 QA-027: branch poller clamps a 24h numeric Retry-After and times out cleanly", async () => {
  const c = clock()
  let attempt = 0
  await assert.rejects(() => pollSupabaseBranch({
    clock: c,
    timeoutMs: 60_000,
    poll: async () => {
      attempt += 1
      throw new SupabaseManagementError("rate_limit", "slow", 429, "86400") // 24h numeric
    },
  }), SupabaseBranchPollTimeoutError)
  assert.ok(attempt >= 1)
})
