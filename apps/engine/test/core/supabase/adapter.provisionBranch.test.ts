import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initDatabase } from "../../../src/db/connection.js"
import { Repos } from "../../../src/db/repositories.js"
import { createSupabaseAdapter } from "../../../src/core/supabase/adapter.js"

test("PROJ-4 PRD-5 US-1: adapter provisions wave branch from persistent parent and persists run metadata", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-wave-provision-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
  const item = repos.createItem({ workspaceId: workspace.id, title: "Item", description: "Desc" })
  const run = repos.createRun({ workspaceId: workspace.id, itemId: item.id, title: "Run" })
  const calls: unknown[] = []
  try {
    const adapter = createSupabaseAdapter({
      repos,
      client: {
        listBranches: async () => [],
        createBranch: async (_project, input) => {
          calls.push(input)
          return { id: "br_wave", ref: "br_wave", name: input.name, status: "CREATING" }
        },
        runQuery: async () => undefined,
      },
    })
    const result = await adapter.provisionBranch({
      workspaceId: workspace.id,
      workspaceKey: workspace.key,
      runId: run.id,
      itemId: item.id,
      projectId: "project-1",
      waveId: "wave-1",
      projectRef: "proj_1",
      parentBranchRef: "br_persistent",
    })
    assert.equal(result.ok, true)
    assert.deepEqual(calls, [{ name: `beerengineer-demo-${run.id.toLowerCase()}-${item.id.toLowerCase()}-project-1-wave-1`, parentRef: "br_persistent" }])
    assert.equal(repos.getRun(run.id)?.supabase_branch_ref, "br_wave")
    assert.equal(repos.getRun(run.id)?.supabase_branch_lifecycle_state, "provisioning")
    assert.equal((await adapter.provisionBranch({ workspaceId: workspace.id, waveId: "wave-1", projectRef: "proj_1", parentBranchRef: "main", runId: run.id, itemId: item.id, projectId: "p" })).ok, false)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
