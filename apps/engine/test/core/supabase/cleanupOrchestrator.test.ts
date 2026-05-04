import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initDatabase } from "../../../src/db/connection.js"
import { Repos } from "../../../src/db/repositories.js"
import { cleanupSuccessfulBranch } from "../../../src/core/supabase/cleanupOrchestrator.js"
import { SupabaseDeferredCleanupStore } from "../../../src/core/supabase/deferredCleanupStore.js"

test("PROJ-4 PRD-8 US-1: cleanup policy dispatch destroys, schedules, or retains", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-cleanup-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
  const item = repos.createItem({ workspaceId: workspace.id, title: "Item", description: "Desc" })
  const run = repos.createRun({ workspaceId: workspace.id, itemId: item.id, title: "Run" })
  const handoff = join(dir, "handoff.env")
  writeFileSync(handoff, "x")
  try {
    const destroyed = await cleanupSuccessfulBranch({ repos, adapter: { destroyBranch: async () => ({ ok: true }) }, workspaceId: workspace.id, projectRef: "proj", branchRef: "br", runId: run.id, handoffPath: handoff, policy: "on-success-immediate" })
    assert.equal(destroyed.action, "destroyed")
    assert.equal(existsSync(handoff), false)
    const store = new SupabaseDeferredCleanupStore(db)
    const scheduled = await cleanupSuccessfulBranch({ repos, adapter: { destroyBranch: async () => ({ ok: true }) }, deferredStore: store, workspaceId: workspace.id, projectRef: "proj", branchRef: "ttl", policy: "ttl-after-success", ttlHours: 2, now: 1000 })
    assert.equal(scheduled.action, "scheduled")
    assert.equal(store.get(workspace.id, "ttl")?.scheduled_at, 1000 + 2 * 3_600_000)
    const retained = await cleanupSuccessfulBranch({ repos, adapter: { destroyBranch: async () => ({ ok: true }) }, workspaceId: workspace.id, projectRef: "proj", branchRef: "manual", policy: "manual" })
    assert.equal(retained.action, "retained")
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
