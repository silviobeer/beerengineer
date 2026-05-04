import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initDatabase } from "../../../src/db/connection.js"
import { Repos } from "../../../src/db/repositories.js"
import { getAppConfigView } from "../../../src/setup/appConfigView.js"

test("PROJ-4 PRD-3 US-3: settings read exposes Supabase cost-risk values", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cost-risk-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir, lastOpenedAt: 1 })
  repos.setWorkspaceSupabaseBranchQuota(workspace.id, { usage: 8, limit: 10 })
  const item = repos.createItem({ workspaceId: workspace.id, title: "Item", description: "Desc" })
  const run = repos.createRun({ workspaceId: workspace.id, itemId: item.id, title: "Run" })
  repos.setRunSupabaseLifecycleState(run.id, "retained-for-diagnosis")
  try {
    const view = getAppConfigView({ configPath: join(dir, "missing.json"), dataDir: dir }, { repos })
    assert.equal(view.supabase.costRisk.retainedBranchCount, 1)
    assert.equal(view.supabase.costRisk.planLimitRatio, 0.8)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
