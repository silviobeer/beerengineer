import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { createItemActionsService, type ItemAction } from "../src/core/itemActions.js"
import { layout } from "../src/core/workspaceLayout.js"

function tmpDb() {
  const dir = mkdtempSync(join(tmpdir(), "be2-itemactions-"))
  return initDatabase(join(dir, "test.sqlite"))
}

function makeItem(
  repos: Repos,
  column: "idea" | "brainstorm" | "frontend" | "requirements" | "implementation" | "done",
  phase: "draft" | "running" | "review_required" | "completed" | "failed"
) {
  const ws = repos.upsertWorkspace({ key: "t", name: "T" })
  const item = repos.createItem({ workspaceId: ws.id, title: "t", description: "d" })
  repos.setItemColumn(item.id, column, phase)
  return repos.getItem(item.id)!
}

// The action/state matrix. Every cell: either a target transition, "reject",
// "start-run" (service records intent + returns needs_spawn), or "resume".
const MATRIX_CASES: Array<{
  action: ItemAction
  column: "idea" | "brainstorm" | "frontend" | "requirements" | "implementation" | "done"
  phase: "draft" | "running" | "review_required" | "completed" | "failed"
  expect: "reject" | { column: string; phaseStatus: string } | "start-run" | "resume"
}> = [
  { action: "start_brainstorm", column: "idea", phase: "draft", expect: "start-run" },
  { action: "start_brainstorm", column: "brainstorm", phase: "running", expect: "reject" },
  { action: "start_brainstorm", column: "requirements", phase: "draft", expect: "reject" },
  { action: "start_brainstorm", column: "implementation", phase: "running", expect: "reject" },
  { action: "start_brainstorm", column: "implementation", phase: "review_required", expect: "reject" },
  { action: "start_brainstorm", column: "done", phase: "completed", expect: "reject" },

  // Manual design-prep entry. Only reachable from a settled brainstorm or
  // from inside the frontend column (e.g. "redo wireframes").
  { action: "start_visual_companion", column: "idea", phase: "draft", expect: "reject" },
  { action: "start_visual_companion", column: "brainstorm", phase: "running", expect: "reject" },
  { action: "start_visual_companion", column: "brainstorm", phase: "completed", expect: "start-run" },
  { action: "start_visual_companion", column: "brainstorm", phase: "review_required", expect: "start-run" },
  { action: "start_visual_companion", column: "frontend", phase: "running", expect: "reject" },
  { action: "start_visual_companion", column: "frontend", phase: "review_required", expect: "start-run" },
  { action: "start_visual_companion", column: "frontend", phase: "completed", expect: "start-run" },
  { action: "start_visual_companion", column: "requirements", phase: "draft", expect: "reject" },
  { action: "start_visual_companion", column: "done", phase: "completed", expect: "reject" },

  // Frontend-design only legal once visual-companion has settled. The
  // service relies on runService to verify wireframes exist; the matrix
  // gate is purely on column/phase.
  { action: "start_frontend_design", column: "brainstorm", phase: "completed", expect: "reject" },
  { action: "start_frontend_design", column: "frontend", phase: "running", expect: "reject" },
  { action: "start_frontend_design", column: "frontend", phase: "review_required", expect: "start-run" },
  { action: "start_frontend_design", column: "frontend", phase: "completed", expect: "start-run" },
  { action: "start_frontend_design", column: "requirements", phase: "draft", expect: "reject" },

  { action: "promote_to_requirements", column: "idea", phase: "draft", expect: "reject" },
  { action: "promote_to_requirements", column: "brainstorm", phase: "running", expect: { column: "requirements", phaseStatus: "draft" } },
  { action: "promote_to_requirements", column: "brainstorm", phase: "completed", expect: { column: "requirements", phaseStatus: "draft" } },
  // Promote also exits the frontend column post-design.
  { action: "promote_to_requirements", column: "frontend", phase: "review_required", expect: { column: "requirements", phaseStatus: "draft" } },
  { action: "promote_to_requirements", column: "frontend", phase: "completed", expect: { column: "requirements", phaseStatus: "draft" } },
  { action: "promote_to_requirements", column: "requirements", phase: "draft", expect: "reject" },
  { action: "promote_to_requirements", column: "implementation", phase: "running", expect: "reject" },
  { action: "promote_to_requirements", column: "done", phase: "completed", expect: "reject" },

  { action: "start_implementation", column: "idea", phase: "draft", expect: "reject" },
  { action: "start_implementation", column: "brainstorm", phase: "running", expect: "reject" },
  { action: "start_implementation", column: "requirements", phase: "draft", expect: "start-run" },
  { action: "start_implementation", column: "requirements", phase: "completed", expect: "start-run" },
  { action: "start_implementation", column: "implementation", phase: "running", expect: "reject" },
  { action: "start_implementation", column: "done", phase: "completed", expect: "reject" },

  { action: "rerun_design_prep", column: "brainstorm", phase: "running", expect: "start-run" },
  { action: "rerun_design_prep", column: "requirements", phase: "draft", expect: "start-run" },
  { action: "rerun_design_prep", column: "implementation", phase: "failed", expect: "start-run" },
  { action: "rerun_design_prep", column: "done", phase: "completed", expect: "start-run" },

  { action: "resume_run", column: "idea", phase: "draft", expect: "reject" },
  { action: "resume_run", column: "brainstorm", phase: "running", expect: "resume" },
  { action: "resume_run", column: "requirements", phase: "draft", expect: "resume" },
  { action: "resume_run", column: "implementation", phase: "running", expect: "resume" },
  { action: "resume_run", column: "implementation", phase: "failed", expect: "resume" },
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
    const service = createItemActionsService(repos)
    try {
      if (c.expect === "resume") {
        // Seed a resumable run with no recovery record — the service should
        // return `needs_spawn` pointing at it.
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
        if (result.ok) {
          assert.equal(result.kind, "needs_spawn")
          if (result.kind === "needs_spawn") {
            assert.equal(result.action, c.action)
            assert.equal(result.phaseStatus, "running")
          }
        }
      } else if (c.expect === "resume") {
        assert.equal(result.ok, true)
        if (result.ok) {
          assert.equal(result.kind, "needs_spawn")
          if (result.kind === "needs_spawn") assert.ok(result.runId)
        }
      } else {
        assert.equal(result.ok, true)
        if (result.ok) {
          assert.equal(result.kind, "state")
          if (result.kind === "state") {
            assert.equal(result.column, c.expect.column)
            assert.equal(result.phaseStatus, c.expect.phaseStatus)
          }
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
  const service = createItemActionsService(repos)
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
  const service = createItemActionsService(repos)
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

test("start-run action records column change and returns needs_spawn without creating a run", async () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const item = makeItem(repos, "idea", "draft")
  const service = createItemActionsService(repos)
  try {
    const result = await service.perform(item.id, "start_brainstorm")
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.kind, "needs_spawn")
    if (result.kind !== "needs_spawn") return
    assert.equal(result.action, "start_brainstorm")
    assert.equal(result.column, "brainstorm")
    assert.equal(result.phaseStatus, "running")
    assert.equal(result.runId, undefined, "service must not create a run row — the CLI does that on spawn")
    const persisted = repos.getItem(item.id)!
    assert.equal(persisted.current_column, "brainstorm")
    assert.equal(persisted.phase_status, "running")
    assert.equal(repos.listRuns().length, 0, "no run row should have been created")
  } finally {
    service.dispose()
    db.close()
  }
})

test("resume_run requires remediation details when the latest resumable run has recovery state", async () => {
  const prev = process.cwd()
  const dir = mkdtempSync(join(tmpdir(), "be2-itemactions-cwd-"))
  process.chdir(dir)
  const db = tmpDb()
  const repos = new Repos(db)
  const item = makeItem(repos, "implementation", "failed")
  const service = createItemActionsService(repos)
  try {
    const run = repos.createRun({ workspaceId: item.workspace_id, itemId: item.id, title: item.title, owner: "api" })
    repos.updateRun(run.id, { status: "failed" })
    repos.setRunRecovery(run.id, { status: "blocked", scope: "story", scopeRef: "1/US-01", summary: "blocked" })
    const ctx = { workspaceId: `t-${item.id.toLowerCase()}`, runId: run.id }
    await import("node:fs/promises").then(fs =>
      fs.mkdir(layout.runDir(ctx), { recursive: true }).then(() =>
        fs.writeFile(layout.runFile(ctx), JSON.stringify({ id: run.id }, null, 2)),
      ),
    )

    const result = await service.perform(item.id, "resume_run")
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.status, 422)
      assert.equal(result.error, "remediation_required")
    }
  } finally {
    service.dispose()
    db.close()
    process.chdir(prev)
  }
})

test("resume_run records remediation and returns needs_spawn with runId + remediationId", async () => {
  const prev = process.cwd()
  const dir = mkdtempSync(join(tmpdir(), "be2-itemactions-resume-"))
  process.chdir(dir)
  const db = tmpDb()
  const repos = new Repos(db)
  const item = makeItem(repos, "implementation", "failed")
  const service = createItemActionsService(repos)
  try {
    const run = repos.createRun({ workspaceId: item.workspace_id, itemId: item.id, title: item.title, owner: "api" })
    repos.updateRun(run.id, { status: "failed" })
    repos.setRunRecovery(run.id, { status: "blocked", scope: "run", scopeRef: null, summary: "blocked" })
    const ctx = { workspaceId: `t-${item.id.toLowerCase()}`, runId: run.id }
    await import("node:fs/promises").then(fs =>
      fs.mkdir(layout.runDir(ctx), { recursive: true }).then(() =>
        fs.writeFile(layout.runFile(ctx), JSON.stringify({ id: run.id }, null, 2)),
      ),
    )

    const result = await service.perform(item.id, "resume_run", {
      resume: { summary: "manual fix", branch: "feature/x" },
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.kind, "needs_spawn")
    if (result.kind !== "needs_spawn") return
    assert.equal(result.runId, run.id)
    assert.ok(result.remediationId, "remediationId should be returned")
    assert.equal(repos.listExternalRemediations(run.id).length, 1)
  } finally {
    service.dispose()
    db.close()
    process.chdir(prev)
  }
})
