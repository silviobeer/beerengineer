import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initDatabase } from "../../../src/db/connection.js"
import { Repos } from "../../../src/db/repositories.js"
import { cleanupSuccessfulBranch } from "../../../src/core/supabase/cleanupOrchestrator.js"
import { SupabaseDeferredCleanupStore } from "../../../src/core/supabase/deferredCleanupStore.js"

test("PROJ-4 PRD-8 US-5: TTL cleanup exposes remaining hours and destroy event", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-ttl-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
  const store = new SupabaseDeferredCleanupStore(db)
  try {
    await cleanupSuccessfulBranch({ repos, adapter: { destroyBranch: async () => ({ ok: true }) }, deferredStore: store, workspaceId: workspace.id, projectRef: "proj", branchRef: "br", policy: "ttl-after-success", ttlHours: 3, now: 0 })
    assert.equal(store.remainingHours(workspace.id, "br", 1), 2)
    const destroyed = await cleanupSuccessfulBranch({ repos, adapter: { destroyBranch: async () => ({ ok: true }) }, workspaceId: workspace.id, projectRef: "proj", branchRef: "br", policy: "on-success-immediate" })
    assert.deepEqual(destroyed.events, ["supabase.branch.destroyed"])
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
