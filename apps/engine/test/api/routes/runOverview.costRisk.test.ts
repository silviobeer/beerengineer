import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initDatabase } from "../../../src/db/connection.js"
import { Repos } from "../../../src/db/repositories.js"
import { getBoard } from "../../../src/api/board.js"

test("PROJ-4 PRD-9 US-5: run overview exposes workspace cost-risk values", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-overview-risk-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  try {
    const ws = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
    repos.setWorkspaceSupabaseBranchQuota(ws.id, { usage: 8, limit: 10 })
    const item = repos.createItem({ workspaceId: ws.id, title: "Item", description: "Desc" })
    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "Run" })
    repos.setRunSupabaseLifecycleState(run.id, "retained-for-diagnosis")
    const board = getBoard(db, "demo")
    assert.equal(board.costRisk.retainedBranchCount, 1)
    assert.equal(board.costRisk.planLimitRatio, 0.8)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
