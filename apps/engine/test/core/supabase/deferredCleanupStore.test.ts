import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initDatabase } from "../../../src/db/connection.js"
import { Repos } from "../../../src/db/repositories.js"
import { SupabaseDeferredCleanupStore } from "../../../src/core/supabase/deferredCleanupStore.js"

test("PROJ-4 PRD-8 US-1: deferred cleanup jobs persist and migration is idempotent", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-deferred-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
  try {
    const store = new SupabaseDeferredCleanupStore(db)
    store.schedule({ workspaceId: workspace.id, branchRef: "br", scheduledAt: 1000 })
    assert.equal(store.get(workspace.id, "br")?.scheduled_at, 1000)
    store.schedule({ workspaceId: workspace.id, branchRef: "br", scheduledAt: 2000 })
    assert.equal(store.get(workspace.id, "br")?.scheduled_at, 2000)
    assert.deepEqual(store.listDue(2000).map(job => job.branch_ref), ["br"])
    assert.equal(store.remainingHours(workspace.id, "br", 1000), 0)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
