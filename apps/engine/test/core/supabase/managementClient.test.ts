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

test("PROJ-4 PRD-2 US-1: management requests time out instead of hanging", async () => {
  const client = new SupabaseManagementClient({
    token: "sbp_secret",
    timeoutMs: 5,
    fetch: (async (_url, init) => {
      await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true })
      })
      return Response.json([])
    }) as typeof fetch,
  })
  await assert.rejects(() => client.listProjects(), (err: unknown) =>
    err instanceof SupabaseManagementError
    && err.kind === "timeout"
    && err.message === "Supabase Management API request timed out after 5ms",
  )
})

test("PROJ-4 QA-021: createBranch uses a 30s timeout independent of the global 8s default", async () => {
  // Track the timeout used: a global 5ms timeout would abort instantly,
  // but createBranch should still complete after a 50ms upstream delay.
  const client = new SupabaseManagementClient({
    token: "sbp_secret",
    timeoutMs: 5,
    fetch: (async (_url, init) => {
      // Simulate a slow Supabase create-branch — would blow through a 5ms
      // global timeout, but must succeed under createBranch's 30s override.
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, 50)
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(t)
          reject(new DOMException("aborted", "AbortError"))
        }, { once: true })
      })
      return Response.json({ id: "br", ref: "br_ref", name: "test" })
    }) as typeof fetch,
  })
  const branch = await client.createBranch("proj", { name: "test" })
  assert.equal(branch.ref, "br_ref")
})

test("createBranch sends Supabase Management API branch_name payload", async () => {
  let capturedBody: unknown
  const client = new SupabaseManagementClient({
    token: "sbp_secret",
    baseUrl: "https://example.test",
    fetch: (async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body))
      return Response.json({ id: "br", ref: "br_ref", name: "test" })
    }) as typeof fetch,
  })

  await client.createBranch("proj", { name: "test", parentRef: "parent_ref" })

  assert.deepEqual(capturedBody, {
    branch_name: "test",
    parent_ref: "parent_ref",
  })
})

test("branch responses normalize id-only provider payloads to ref", async () => {
  const client = new SupabaseManagementClient({
    token: "sbp_secret",
    baseUrl: "https://example.test",
    fetch: (async (url) => {
      if (String(url).endsWith("/branches")) {
        return Response.json([{ id: "branch_id", name: "branch", status: "FUNCTIONS_DEPLOYED" }])
      }
      return Response.json({ id: "branch_id", name: "branch", status: "FUNCTIONS_DEPLOYED" })
    }) as typeof fetch,
  })

  assert.equal((await client.listBranches("proj"))[0]?.ref, "branch_id")
  assert.equal((await client.getBranch("proj", "branch_id")).ref, "branch_id")
})
