import { test } from "node:test"
import assert from "node:assert/strict"
import { assertSeedIdempotent } from "../../../../src/core/supabase/dbTests/seedIdempotency.js"

test("PROJ-4 PRD-5 US-4: seed idempotency detects state changes", async () => {
  let state = 1
  assert.deepEqual(await assertSeedIdempotent({ runSeed: async () => undefined, snapshot: async () => ({ state }) }), { ok: true })
  assert.equal((await assertSeedIdempotent({ runSeed: async () => { state += 1 }, snapshot: async () => ({ state }) })).ok, false)
})
