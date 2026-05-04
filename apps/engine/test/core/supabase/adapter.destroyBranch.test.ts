import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initDatabase } from "../../../src/db/connection.js"
import { Repos } from "../../../src/db/repositories.js"
import { createSupabaseAdapter } from "../../../src/core/supabase/adapter.js"

test("PROJ-4 QA-023: destroyBranch treats provider 410 Gone as success (idempotent)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-destroy-410-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  try {
    const adapter = createSupabaseAdapter({
      repos,
      client: {
        listBranches: async () => [],
        createBranch: async () => ({ id: "br", ref: "br" }),
        runQuery: async () => undefined,
        deleteBranch: async () => {
          const err = new Error("gone") as Error & { status: number }
          err.status = 410
          throw err
        },
      },
    })
    const result = await adapter.destroyBranch({ projectRef: "proj", branchRef: "br" })
    assert.equal(result.ok, true)
    assert.equal(result.context?.idempotent, true)
    assert.equal(result.context?.status, "destroyed")
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("PROJ-4 PRD-8 US-1: destroyBranch is idempotent and retains on provider failure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-destroy-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
  const item = repos.createItem({ workspaceId: workspace.id, title: "Item", description: "Desc" })
  const run = repos.createRun({ workspaceId: workspace.id, itemId: item.id, title: "Run" })
  try {
    const calls: string[] = []
    const adapter = createSupabaseAdapter({ repos, client: { listBranches: async () => [], createBranch: async () => ({ id: "br", ref: "br" }), runQuery: async () => undefined, deleteBranch: async (_p, b) => { calls.push(b) } } })
    assert.equal((await adapter.destroyBranch({ workspaceId: workspace.id, projectRef: "proj", branchRef: "br", runId: run.id })).ok, true)
    assert.deepEqual(calls, ["br"])
    assert.equal(repos.getRun(run.id)?.supabase_branch_lifecycle_state, "destroyed")
    const missing = createSupabaseAdapter({ repos, client: { listBranches: async () => [], createBranch: async () => ({ id: "br", ref: "br" }), runQuery: async () => undefined, deleteBranch: async () => { const err = new Error("missing") as Error & { status: number }; err.status = 404; throw err } } })
    assert.equal((await missing.destroyBranch({ projectRef: "proj", branchRef: "gone" })).ok, true)
    const failingRun = repos.createRun({ workspaceId: workspace.id, itemId: item.id, title: "Fail" })
    const failing = createSupabaseAdapter({ repos, client: { listBranches: async () => [], createBranch: async () => ({ id: "br", ref: "br" }), runQuery: async () => undefined, deleteBranch: async () => { throw new Error("non-deletable") } } })
    assert.equal((await failing.destroyBranch({ projectRef: "proj", branchRef: "br", runId: failingRun.id })).ok, false)
    assert.equal(repos.getRun(failingRun.id)?.supabase_branch_lifecycle_state, "retained-for-diagnosis")
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
