import { test } from "node:test"
import assert from "node:assert/strict"

import { defaultSupabaseAdapter, NotImplementedError } from "../../../src/core/supabase/adapter.js"

const ADAPTER_METHODS = [
  "provisionBranch",
  "pollBranchStatus",
  "validateBranch",
  "destroyBranch",
  "migrateProduction",
  "reconcile",
] as const

test("PROJ-4 PRD-1 US-2: default Supabase adapter exposes the closed operation surface", () => {
  assert.deepEqual(Object.keys(defaultSupabaseAdapter).sort(), [...ADAPTER_METHODS].sort())
})

test("PROJ-4 PRD-1 US-2: default Supabase adapter methods fail fast until later waves implement them", async () => {
  for (const method of ADAPTER_METHODS) {
    await assert.rejects(
      () => defaultSupabaseAdapter[method]({ workspaceId: "ws-1" }),
      (err: unknown) => err instanceof NotImplementedError && (err as Error).message.includes(method),
    )
  }
})

