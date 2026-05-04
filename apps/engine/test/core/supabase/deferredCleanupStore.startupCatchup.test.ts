import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initDatabase } from "../../../src/db/connection.js"
import { Repos } from "../../../src/db/repositories.js"
import { SupabaseDeferredCleanupStore } from "../../../src/core/supabase/deferredCleanupStore.js"
import { runDueSupabaseCleanups } from "../../../src/core/supabase/cleanupOrchestrator.js"

test("PROJ-4 PRD-8 US-5: startup catch-up dispatches elapsed TTL cleanups", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-catchup-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
  const store = new SupabaseDeferredCleanupStore(db)
  store.schedule({ workspaceId: workspace.id, branchRef: "br", scheduledAt: 10 })
  try {
    const destroyed: string[] = []
    const result = await runDueSupabaseCleanups({ repos, deferredStore: store, workspaceId: workspace.id, projectRef: "proj", now: 11, adapter: { destroyBranch: async (ctx) => { destroyed.push(ctx.branchRef ?? ""); return { ok: true } } } })
    assert.deepEqual(destroyed, ["br"])
    assert.deepEqual(result, [{ branchRef: "br", ok: true }])
    assert.equal(store.get(workspace.id, "br"), undefined)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
