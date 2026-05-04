import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initDatabase } from "../../../src/db/connection.js"
import { Repos } from "../../../src/db/repositories.js"
import { cleanupSuccessfulBranch, explicitDestroyBranch } from "../../../src/core/supabase/cleanupOrchestrator.js"

test("PROJ-4 PRD-8 US-2: retained branches skip auto cleanup but explicit destroy is gated", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-retained-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
  const handoff = join(dir, "handoff.env")
  writeFileSync(handoff, "x")
  try {
    let calls = 0
    const skipped = await cleanupSuccessfulBranch({ repos, adapter: { destroyBranch: async () => { calls += 1; return { ok: true } } }, workspaceId: workspace.id, projectRef: "proj", branchRef: "br", lifecycleState: "retained-for-diagnosis", policy: "on-success-immediate" })
    assert.equal(skipped.action, "skipped")
    assert.equal(calls, 0)
    assert.equal((await explicitDestroyBranch({ repos, adapter: { destroyBranch: async () => ({ ok: true }) }, workspaceId: workspace.id, projectRef: "proj", branchRef: "br", branchName: "branch", confirmedName: "wrong", handoffPath: handoff })).ok, false)
    assert.equal(existsSync(handoff), true)
    assert.equal((await explicitDestroyBranch({ repos, adapter: { destroyBranch: async () => ({ ok: true }) }, workspaceId: workspace.id, projectRef: "proj", branchRef: "br", branchName: "branch", confirmedName: "branch", handoffPath: handoff })).ok, true)
    assert.equal(existsSync(handoff), false)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
