import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initDatabase } from "../../../src/db/connection.js"
import { Repos } from "../../../src/db/repositories.js"
import { completeMergeWithProductionMigration } from "../../../src/stages/mergeGate/supabaseGates.js"

test("PROJ-4 PRD-7 US-5: production migration failure aborts cleanup and retains branch", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-prod-failure-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
  const item = repos.createItem({ workspaceId: workspace.id, title: "Item", description: "Desc" })
  const run = repos.createRun({ workspaceId: workspace.id, itemId: item.id, title: "Run" })
  let cleanupCalls = 0
  let attempts = 0
  try {
    const result = await completeMergeWithProductionMigration({
      repos,
      cleanup: () => { cleanupCalls += 1 },
      context: { workspaceId: workspace.id, projectRef: "proj", branchRef: "main", runId: run.id, workspaceRoot: dir },
      adapter: { migrateProduction: async () => { attempts += 1; return { ok: false, context: { migration: "001.sql", message: "provider [redacted]", retryAfter: attempts === 1 ? "1" : undefined } } } },
    })
    assert.equal(result.ok, false)
    assert.equal(attempts, 2)
    assert.equal(cleanupCalls, 0)
    assert.equal(repos.getRun(run.id)?.supabase_branch_lifecycle_state, "retained-for-diagnosis")
    assert.deepEqual((result.details as { diagnosisHref: string }).diagnosisHref, "#supabase-diagnosis")
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
