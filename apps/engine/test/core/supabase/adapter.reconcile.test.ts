import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initDatabase } from "../../../src/db/connection.js"
import { Repos } from "../../../src/db/repositories.js"
import { createSupabaseAdapter } from "../../../src/core/supabase/adapter.js"

test("PROJ-4 PRD-8 US-3: reconcile classifies owned branches", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-reconcile-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
  const item = repos.createItem({ workspaceId: workspace.id, title: "Item", description: "Desc" })
  const active = repos.createRun({ workspaceId: workspace.id, itemId: item.id, title: "Run" })
  repos.setRunSupabaseBranch(active.id, { ref: "br-active", name: "beerengineer-demo-active", lifecycleState: "provisioning" })
  const done = repos.createRun({ workspaceId: workspace.id, itemId: item.id, title: "Done" })
  repos.setRunSupabaseBranch(done.id, { ref: "br-done", name: "beerengineer-demo-done", lifecycleState: "validated" })
  repos.updateRun(done.id, { status: "completed" })
  try {
    const adapter = createSupabaseAdapter({ repos, client: {
      listBranches: async () => [
        { id: "1", ref: "br-active", name: "beerengineer-demo-active", status: "ACTIVE_HEALTHY" },
        { id: "2", ref: "br-done", name: "beerengineer-demo-done", status: "ACTIVE_HEALTHY" },
        { id: "3", ref: "br-error", name: "beerengineer-demo-error", status: "FAILED" },
        { id: "4", ref: "br-other", name: "other" },
      ],
      createBranch: async () => ({ id: "br", ref: "br" }),
      runQuery: async () => undefined,
    } })
    const result = await adapter.reconcile({ workspaceId: workspace.id, workspaceKey: "demo", projectRef: "proj" })
    assert.equal(result.ok, true)
    const classes = result.context?.classifications as Array<{ classification: string }>
    assert.deepEqual(classes.map(entry => entry.classification).sort(), ["adoptable", "cleanup-candidate", "retained-for-diagnosis"])
    assert.equal(repos.getRun(active.id)?.supabase_branch_lifecycle_state, "ready")
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
