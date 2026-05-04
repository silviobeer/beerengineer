import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initDatabase } from "../../../src/db/connection.js"
import { Repos } from "../../../src/db/repositories.js"
import { recordSupabaseLifecycle } from "../../../src/core/supabase/lifecycleEvents.js"
import { projectStageLogRow } from "../../../src/core/messagingProjection.js"

test("PROJ-4 PRD-9 US-1: Supabase lifecycle events use canonical SSE names", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-life-events-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  try {
    const ws = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
    const item = repos.createItem({ workspaceId: ws.id, title: "Item", description: "Desc" })
    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "Run" })
    recordSupabaseLifecycle({ repos, runId: run.id, waveId: "wave-1", branchRef: "br_1", step: "branch_creation", status: "in_progress", timestamp: 1 })
    recordSupabaseLifecycle({ repos, runId: run.id, waveId: "wave-1", branchRef: "br_1", step: "migrations", status: "passed", timestamp: 2 })
    recordSupabaseLifecycle({ repos, runId: run.id, waveId: "wave-1", branchRef: "br_1", step: "cleanup", status: "passed", timestamp: 3 })
    const projected = repos.listLogsForRun(run.id).map(row => projectStageLogRow(row)?.type)
    assert.deepEqual(projected, ["supabase.branch.provisioning_started", "supabase.branch.migration_passed", "supabase.branch.destroyed"])
    const payload = projectStageLogRow(repos.listLogsForRun(run.id)[0])?.payload
    assert.equal(payload?.waveId, "wave-1")
    assert.equal(payload?.branchRef, "br_1")
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
