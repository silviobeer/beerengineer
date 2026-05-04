import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initDatabase } from "../../../src/db/connection.js"
import { Repos } from "../../../src/db/repositories.js"
import { recreatePersistentTestBranch } from "../../../src/core/supabase/adapter.js"

test("PROJ-4 PRD-3 US-4: recreate persistent test branch destroys then provisions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-recreate-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
  try {
    const order: string[] = []
    const adapter = {
      destroyBranch: async () => { order.push("destroy"); return { ok: true } },
      provisionBranch: async () => { order.push("provision"); return { ok: true, context: { branchRef: "new" } } },
      pollBranchStatus: async () => ({ ok: true }),
      validateBranch: async () => ({ ok: true }),
      migrateProduction: async () => ({ ok: true }),
      reconcile: async () => ({ ok: true }),
    }
    assert.equal((await recreatePersistentTestBranch({ repos, adapter, workspaceId: workspace.id, projectRef: "proj", branchRef: "old", branchName: "old-name", workspaceRoot: dir })).ok, true)
    assert.deepEqual(order, ["destroy", "provision"])
    const failing = { ...adapter, destroyBranch: async () => ({ ok: false }) }
    assert.equal((await recreatePersistentTestBranch({ repos, adapter: failing, workspaceId: workspace.id, projectRef: "proj", branchRef: "old", branchName: "old-name", workspaceRoot: dir })).ok, false)
    assert.equal(repos.getWorkspace(workspace.id)?.supabase_persistent_test_branch_status, "retained-for-diagnosis")
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
