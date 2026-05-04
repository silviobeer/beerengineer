import { test } from "node:test"
import assert from "node:assert/strict"

import { SupabaseManagementClient, SupabaseManagementError } from "../../../src/core/supabase/managementClient.js"

test("PROJ-4 PRD-2 US-1: list-projects returns parsed Supabase projects", async () => {
  const calls: string[] = []
  const client = new SupabaseManagementClient({
    token: "sbp_token",
    baseUrl: "https://example.test",
    fetch: (async (url) => {
      calls.push(String(url))
      return Response.json([{ id: "1", ref: "proj_1", region: "eu" }])
    }) as typeof fetch,
  })
  assert.deepEqual(await client.listProjects(), [{ id: "1", ref: "proj_1", region: "eu" }])
  assert.deepEqual(calls, ["https://example.test/projects"])
})

test("PROJ-4 PRD-2 US-1: provider errors surface redacted provider message", async () => {
  const client = new SupabaseManagementClient({
    token: "sbp_secret",
    fetch: (async () => Response.json({ message: "Invalid token sbp_secret" }, { status: 401 })) as typeof fetch,
  })
  await assert.rejects(() => client.listProjects(), (err: unknown) =>
    err instanceof SupabaseManagementError
    && err.status === 401
    && err.message === "Invalid token sbp_[redacted]",
  )
})

test("PROJ-4 PRD-2 US-1: rate limit errors include Retry-After", async () => {
  const client = new SupabaseManagementClient({
    token: "sbp_secret",
    fetch: (async () => Response.json({ message: "Slow down" }, { status: 429, headers: { "retry-after": "12" } })) as typeof fetch,
  })
  await assert.rejects(() => client.listProjects(), (err: unknown) =>
    err instanceof SupabaseManagementError && err.kind === "rate_limit" && err.retryAfter === "12",
  )
})

