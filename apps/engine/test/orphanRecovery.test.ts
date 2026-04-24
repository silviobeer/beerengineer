import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { markOrphanedRunsFailed } from "../src/core/orphanRecovery.js"

function tmpDb() {
  const dir = mkdtempSync(join(tmpdir(), "be2-orphan-"))
  return initDatabase(join(dir, "test.sqlite"))
}

test("markOrphanedRunsFailed — running run becomes failed with resume-compatible recovery", async () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "test", name: "Test" })
  const item = repos.createItem({ workspaceId: ws.id, title: "Test item", description: "d" })

  // Seed a run that looks like it was mid-flight when the process died
  const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "Test item" })
  repos.updateRun(run.id, { current_stage: "brainstorm" })

  // Assert the precondition: run is currently "running"
  assert.equal(repos.getRun(run.id)?.status, "running")

  const result = await markOrphanedRunsFailed(repos)
  assert.equal(result.recovered, 1)

  const updated = repos.getRun(run.id)
  assert.ok(updated, "run row must still exist")
  assert.equal(updated.status, "failed", "orphaned run must be marked failed")
  assert.equal(updated.recovery_status, "failed", "recovery_status must be set to failed")
  assert.equal(updated.recovery_scope, "run", "recovery_scope must be run so resume is accepted")
  assert.ok(updated.recovery_summary?.includes("API restart"), "recovery_summary must mention API restart")
})

test("markOrphanedRunsFailed — completed run is not touched", async () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "test", name: "Test" })
  const item = repos.createItem({ workspaceId: ws.id, title: "Done item", description: "d" })

  const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "Done item" })
  repos.updateRun(run.id, { status: "completed" })

  const result = await markOrphanedRunsFailed(repos)
  assert.equal(result.recovered, 0)
  assert.equal(repos.getRun(run.id)?.status, "completed", "completed run must not be touched")
})

test("markOrphanedRunsFailed — already-failed run is not touched", async () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "test", name: "Test" })
  const item = repos.createItem({ workspaceId: ws.id, title: "Failed item", description: "d" })

  const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "Failed item" })
  repos.updateRun(run.id, { status: "failed", recovery_status: "failed" })

  const result = await markOrphanedRunsFailed(repos)
  assert.equal(result.recovered, 0)
})

test("markOrphanedRunsFailed — returns zero when no running runs exist", async () => {
  const db = tmpDb()
  const repos = new Repos(db)

  const result = await markOrphanedRunsFailed(repos)
  assert.equal(result.recovered, 0)
})

test("markOrphanedRunsFailed — multiple orphaned runs are all recovered", async () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "test", name: "Test" })
  const item = repos.createItem({ workspaceId: ws.id, title: "Multi item", description: "d" })

  const runA = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "Multi item" })
  const runB = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "Multi item" })
  repos.updateRun(runA.id, { current_stage: "requirements" })
  repos.updateRun(runB.id, { current_stage: "execution" })

  const result = await markOrphanedRunsFailed(repos)
  assert.equal(result.recovered, 2)

  for (const r of [runA, runB]) {
    const updated = repos.getRun(r.id)
    assert.equal(updated?.status, "failed")
    assert.equal(updated?.recovery_status, "failed")
    assert.equal(updated?.recovery_scope, "run")
  }
})
