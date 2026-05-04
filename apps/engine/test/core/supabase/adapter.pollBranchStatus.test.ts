import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initDatabase } from "../../../src/db/connection.js"
import { Repos } from "../../../src/db/repositories.js"
import { createSupabaseAdapter } from "../../../src/core/supabase/adapter.js"

test("PROJ-4 PRD-5 US-2: adapter polls branch status to ready", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-poll-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
  const item = repos.createItem({ workspaceId: workspace.id, title: "Item", description: "Desc" })
  const run = repos.createRun({ workspaceId: workspace.id, itemId: item.id, title: "Run" })
  try {
    const adapter = createSupabaseAdapter({
      repos,
      client: {
        listBranches: async () => [],
        createBranch: async () => ({ id: "br", ref: "br" }),
        runQuery: async () => undefined,
        getBranch: async () => ({ id: "br", ref: "br", status: "ACTIVE_HEALTHY" }),
      },
    })
    const result = await adapter.pollBranchStatus({ projectRef: "proj", branchRef: "br", runId: run.id })
    assert.equal(result.ok, true)
    assert.equal(repos.getRun(run.id)?.supabase_branch_lifecycle_state, "ready")
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
