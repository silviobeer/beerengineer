import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initDatabase } from "../../../src/db/connection.js"
import { Repos } from "../../../src/db/repositories.js"
import { cleanupSuccessfulBranch } from "../../../src/core/supabase/cleanupOrchestrator.js"

test("PROJ-4 PRD-6 US-3: handoff lifecycle follows branch retention", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-handoff-parity-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
  const retained = join(dir, "retained.env")
  writeFileSync(retained, "x")
  try {
    await cleanupSuccessfulBranch({ repos, adapter: { destroyBranch: async () => ({ ok: false, context: { error: "failed" } }) }, workspaceId: workspace.id, projectRef: "proj", branchRef: "br", handoffPath: retained, policy: "on-success-immediate" })
    assert.equal(existsSync(retained), true)
    await cleanupSuccessfulBranch({ repos, adapter: { destroyBranch: async () => ({ ok: true }) }, workspaceId: workspace.id, projectRef: "proj", branchRef: "br", handoffPath: retained, policy: "on-success-immediate" })
    assert.equal(existsSync(retained), false)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
