import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { createItemActionsService, type ItemAction } from "../src/core/itemActions.js"
import type { ItemRow } from "../src/db/repositories.js"

/** Stub run starter: creates a real `runs` row (owner=api) but does not fire
 *  the workflow — lets tests assert run-creation without hanging on prompts. */
function stubRunStarter(repos: Repos) {
  return (item: ItemRow) => {
    const run = repos.createRun({ workspaceId: item.workspace_id, itemId: item.id, title: item.title, owner: "api" })
    return { runId: run.id }
  }
}

function tmpDb() {
  const dir = mkdtempSync(join(tmpdir(), "be2-itemactions-"))
  return initDatabase(join(dir, "test.sqlite"))
}

function makeItem(
  repos: Repos,
  column: "idea" | "brainstorm" | "requirements" | "implementation" | "done",
  phase: "draft" | "running" | "review_required" | "completed" | "failed"
) {
  const ws = repos.upsertWorkspace({ key: "t", name: "T" })
  const item = repos.createItem({ workspaceId: ws.id, title: "t", description: "d" })
  repos.setItemColumn(item.id, column, phase)
  return repos.getItem(item.id)!
}

// The matrix from the plan — every cell, either a target transition or "reject".
const MATRIX_CASES: Array<{
  action: ItemAction
  column: "idea" | "brainstorm" | "requirements" | "implementation" | "done"
  phase: "draft" | "running" | "review_required" | "completed" | "failed"
  expect: "reject" | { column: string; phaseStatus: string } | "start-run" | "resume"
}> = [
  { action: "start_brainstorm", column: "idea", phase: "draft", expect: "start-run" },
  { action: "start_brainstorm", column: "brainstorm", phase: "running", expect: "reject" },
  { action: "start_brainstorm", column: "requirements", phase: "draft", expect: "reject" },
  { action: "start_brainstorm", column: "implementation", phase: "running", expect: "reject" },
  { action: "start_brainstorm", column: "implementation", phase: "review_required", expect: "reject" },
  { action: "start_brainstorm", column: "done", phase: "completed", expect: "reject" },

  { action: "promote_to_requirements", column: "idea", phase: "draft", expect: "reject" },
  { action: "promote_to_requirements", column: "brainstorm", phase: "running", expect: { column: "requirements", phaseStatus: "draft" } },
  { action: "promote_to_requirements", column: "brainstorm", phase: "completed", expect: { column: "requirements", phaseStatus: "draft" } },
  { action: "promote_to_requirements", column: "requirements", phase: "draft", expect: "reject" },
  { action: "promote_to_requirements", column: "implementation", phase: "running", expect: "reject" },
  { action: "promote_to_requirements", column: "done", phase: "completed", expect: "reject" },

  { action: "start_implementation", column: "idea", phase: "draft", expect: "reject" },
  { action: "start_implementation", column: "brainstorm", phase: "running", expect: "reject" },
  { action: "start_implementation", column: "requirements", phase: "draft", expect: "start-run" },
  { action: "start_implementation", column: "requirements", phase: "completed", expect: "start-run" },
  { action: "start_implementation", column: "implementation", phase: "running", expect: "reject" },
  { action: "start_implementation", column: "done", phase: "completed", expect: "reject" },

  { action: "resume_run", column: "idea", phase: "draft", expect: "reject" },
  { action: "resume_run", column: "brainstorm", phase: "running", expect: "resume" },
  { action: "resume_run", column: "requirements", phase: "draft", expect: "resume" },
  { action: "resume_run", column: "implementation", phase: "running", expect: "resume" },
  { action: "resume_run", column: "implementation", phase: "review_required", expect: "reject" },
  { action: "resume_run", column: "done", phase: "completed", expect: "reject" },

  { action: "mark_done", column: "idea", phase: "draft", expect: "reject" },
  { action: "mark_done", column: "brainstorm", phase: "running", expect: "reject" },
  { action: "mark_done", column: "requirements", phase: "draft", expect: "reject" },
  { action: "mark_done", column: "implementation", phase: "running", expect: "reject" },
  { action: "mark_done", column: "implementation", phase: "review_required", expect: { column: "done", phaseStatus: "completed" } },
  { action: "mark_done", column: "done", phase: "completed", expect: "reject" }
]

for (const c of MATRIX_CASES) {
  test(`matrix: ${c.action} @ ${c.column}/${c.phase} -> ${typeof c.expect === "string" ? c.expect : `${c.expect.column}/${c.expect.phaseStatus}`}`, async () => {
    const db = tmpDb()
    const repos = new Repos(db)
    const item = makeItem(repos, c.column, c.phase)
    const service = createItemActionsService(repos, { startRun: stubRunStarter(repos) })
    try {
      if (c.expect === "resume") {
        // For resume: seed an active run if expected to succeed.
        repos.createRun({ workspaceId: item.workspace_id, itemId: item.id, title: "t" })
      }
      const result = await service.perform(item.id, c.action)
      if (c.expect === "reject") {
        assert.equal(result.ok, false)
        if (!result.ok) {
          assert.equal(result.status, 409)
          assert.equal(result.error, "invalid_transition")
        }
      } else if (c.expect === "start-run") {
        assert.equal(result.ok, true)
        if (result.ok) assert.ok(result.runId)
      } else if (c.expect === "resume") {
        assert.equal(result.ok, true)
        if (result.ok) assert.ok(result.runId)
      } else {
        assert.equal(result.ok, true)
        if (result.ok) {
          assert.equal(result.column, c.expect.column)
          assert.equal(result.phaseStatus, c.expect.phaseStatus)
          const persisted = repos.getItem(item.id)!
          assert.equal(persisted.current_column, c.expect.column)
          assert.equal(persisted.phase_status, c.expect.phaseStatus)
        }
      }
    } finally {
      service.dispose()
      db.close()
    }
  })
}

test("perform on unknown item returns 404", async () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const service = createItemActionsService(repos, { startRun: stubRunStarter(repos) })
  try {
    const result = await service.perform("no-such-id", "start_brainstorm")
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.status, 404)
      assert.equal(result.error, "item_not_found")
    }
  } finally {
    service.dispose()
    db.close()
  }
})

test("state mutation emits item_column_changed event", async () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const item = makeItem(repos, "brainstorm", "running")
  const service = createItemActionsService(repos, { startRun: stubRunStarter(repos) })
  const events: Array<{ type: string }> = []
  service.on("event", ev => events.push(ev))
  try {
    const result = await service.perform(item.id, "promote_to_requirements")
    assert.equal(result.ok, true)
    const change = events.find(e => e.type === "item_column_changed") as
      | { type: string; itemId: string; from: string; to: string; phaseStatus: string }
      | undefined
    assert.ok(change, "item_column_changed event must be emitted")
    assert.equal(change.from, "brainstorm")
    assert.equal(change.to, "requirements")
    assert.equal(change.phaseStatus, "draft")
  } finally {
    service.dispose()
    db.close()
  }
})

test("start-run action creates a run with owner='api'", async () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const item = makeItem(repos, "idea", "draft")
  const service = createItemActionsService(repos, { startRun: stubRunStarter(repos) })
  try {
    const result = await service.perform(item.id, "start_brainstorm")
    assert.equal(result.ok, true)
    if (!result.ok || !result.runId) throw new Error("expected runId")
    const run = repos.getRun(result.runId)
    assert.ok(run)
    assert.equal(run!.owner, "api")
    assert.equal(run!.item_id, item.id)
  } finally {
    service.dispose()
    db.close()
  }
})

test("start_implementation creates an implementation-entry run without rerunning brainstorm", async () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const item = makeItem(repos, "requirements", "draft")
  const service = createItemActionsService(repos)
  try {
    const result = await service.perform(item.id, "start_implementation")
    assert.equal(result.ok, true)
    if (!result.ok || !result.runId) throw new Error("expected runId")

    const run = repos.getRun(result.runId)
    const persisted = repos.getItem(item.id)
    const stages = repos.listStageRunsForRun(result.runId)

    assert.equal(run?.current_stage, "execution")
    assert.equal(persisted?.current_column, "implementation")
    assert.equal(persisted?.phase_status, "running")
    assert.deepEqual(stages.map(stage => stage.stage_key), ["execution"])
  } finally {
    service.dispose()
    db.close()
  }
})
