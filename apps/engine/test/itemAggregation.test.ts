/**
 * Tests for item state aggregation — specifically that a failed side-run
 * (e.g. an abandoned rerun_design_prep that crashes in visual-companion) does
 * not clobber the item's displayed stage/status when a separate, newer or
 * concurrent run is still healthy.
 *
 * Live repro: ITEM-0001 had a main run at requirements/running, then a
 * rerun_design_prep side-run was started. The side-run crashed in
 * visual-companion. The item's DB row flipped to implementation/failed
 * (from run_finished status=failed) even though the main run was still live.
 *
 * Approach (Option A): failed / completing side-runs must not write
 * items.current_column / items.phase_status when a newer live run exists for
 * the same item. The guard lives in attachDbSync so run-scoped event
 * subscribers can never pollute the item row from a stale run.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { attachDbSync, busToWorkflowIO } from "../src/core/runOrchestrator.js"
import { createBus } from "../src/core/bus.js"

function tmpDb() {
  const dir = mkdtempSync(join(tmpdir(), "be2-itemagg-"))
  return initDatabase(join(dir, "test.sqlite"))
}

function makeBus() {
  const bus = createBus()
  return bus
}

// ---------------------------------------------------------------------------
// Core repro: side-run failure must not clobber main run's item state
// ---------------------------------------------------------------------------

test("side-run failure does not clobber item state when main run is still live", () => {
  const db = tmpDb()
  const repos = new Repos(db)
  try {
    const ws = repos.upsertWorkspace({ key: "test", name: "Test" })
    const item = repos.createItem({ workspaceId: ws.id, title: "My Feature", description: "desc" })

    // --- Main run: started, advanced to requirements ---
    const mainRun = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "main run" })
    const mainBus = makeBus()
    attachDbSync(mainBus, repos, { runId: mainRun.id, itemId: item.id })

    mainBus.emit({ type: "run_started", runId: mainRun.id, itemId: item.id, title: "main run" })
    mainBus.emit({ type: "stage_started", runId: mainRun.id, stageRunId: "main-stage-1", stageKey: "brainstorm" })
    mainBus.emit({ type: "stage_completed", runId: mainRun.id, stageRunId: "main-stage-1", stageKey: "brainstorm", status: "completed" })
    mainBus.emit({ type: "stage_started", runId: mainRun.id, stageRunId: "main-stage-2", stageKey: "requirements" })
    // Main run is now at requirements/running — do NOT complete it yet

    const itemAfterMainProgress = repos.getItem(item.id)!
    assert.equal(itemAfterMainProgress.current_column, "requirements", "item should be in requirements after main run advances")
    assert.equal(itemAfterMainProgress.phase_status, "running", "item should be running")

    // --- Side-run: rerun_design_prep — a *newer* run created after main run ---
    // Give it a slightly later created_at by using a fresh createRun call
    const sideRun = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "rerun_design_prep" })
    const sideBus = makeBus()
    attachDbSync(sideBus, repos, { runId: sideRun.id, itemId: item.id })

    sideBus.emit({ type: "run_started", runId: sideRun.id, itemId: item.id, title: "rerun_design_prep" })
    sideBus.emit({ type: "stage_started", runId: sideRun.id, stageRunId: "side-stage-1", stageKey: "brainstorm" })
    sideBus.emit({ type: "stage_completed", runId: sideRun.id, stageRunId: "side-stage-1", stageKey: "brainstorm", status: "completed" })
    sideBus.emit({ type: "stage_started", runId: sideRun.id, stageRunId: "side-stage-vc", stageKey: "visual-companion" })

    // Side-run crashes in visual-companion
    sideBus.emit({
      type: "stage_completed",
      runId: sideRun.id,
      stageRunId: "side-stage-vc",
      stageKey: "visual-companion",
      status: "failed",
      error: "LLM timeout",
    })
    sideBus.emit({
      type: "run_finished",
      runId: sideRun.id,
      itemId: item.id,
      title: "rerun_design_prep",
      status: "failed",
      error: "LLM timeout",
    })

    // --- Assert: item must still reflect the main run, not the failed side-run ---
    const itemAfterSideRunFailure = repos.getItem(item.id)!
    assert.equal(
      itemAfterSideRunFailure.current_column,
      "requirements",
      "item current_column must not be clobbered by side-run failure (expected requirements, got " +
        itemAfterSideRunFailure.current_column + ")"
    )
    assert.equal(
      itemAfterSideRunFailure.phase_status,
      "running",
      "item phase_status must not be clobbered by side-run failure (expected running, got " +
        itemAfterSideRunFailure.phase_status + ")"
    )

    // The side-run row itself should record its failure
    const sideRunRow = repos.getRun(sideRun.id)!
    assert.equal(sideRunRow.status, "failed", "side-run.status must be failed")

    // The main run should still be running
    const mainRunRow = repos.getRun(mainRun.id)!
    assert.equal(mainRunRow.status, "running", "main run must still be running")
  } finally {
    db.close()
  }
})

// ---------------------------------------------------------------------------
// Option A: failed run_finished never writes item state, even when sole run.
// The item retains the column/phase written by the last successful stage event.
// The run row itself records status=failed so recovery/display can read it.
// ---------------------------------------------------------------------------

test("sole run failure does not overwrite item state — item retains last stage-written state", () => {
  const db = tmpDb()
  const repos = new Repos(db)
  try {
    const ws = repos.upsertWorkspace({ key: "test", name: "Test" })
    const item = repos.createItem({ workspaceId: ws.id, title: "Solo Run Item", description: "desc" })

    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "solo run" })
    const bus = makeBus()
    attachDbSync(bus, repos, { runId: run.id, itemId: item.id })

    bus.emit({ type: "run_started", runId: run.id, itemId: item.id, title: "solo run" })
    // stage_started writes requirements/running to the item
    bus.emit({ type: "stage_started", runId: run.id, stageRunId: "stage-1", stageKey: "requirements" })
    // run_finished(failed) must NOT overwrite the item — item stays at requirements/running
    bus.emit({
      type: "run_finished",
      runId: run.id,
      itemId: item.id,
      title: "solo run",
      status: "failed",
      error: "boom",
    })

    const itemAfter = repos.getItem(item.id)!
    assert.equal(
      itemAfter.current_column,
      "requirements",
      "item column must not be clobbered by run_finished(failed) — expected requirements, got " +
        itemAfter.current_column
    )
    assert.equal(
      itemAfter.phase_status,
      "running",
      "item phase_status must not be clobbered by run_finished(failed) — expected running, got " +
        itemAfter.phase_status
    )
    // The run row itself must record the failure for recovery/CLI display
    const runRow = repos.getRun(run.id)!
    assert.equal(runRow.status, "failed", "run.status must be failed")
  } finally {
    db.close()
  }
})

// ---------------------------------------------------------------------------
// Side-run stage_started must not advance item column when main run is live
// ---------------------------------------------------------------------------

test("side-run stage_started does not overwrite item column when main run is live", () => {
  const db = tmpDb()
  const repos = new Repos(db)
  try {
    const ws = repos.upsertWorkspace({ key: "test", name: "Test" })
    const item = repos.createItem({ workspaceId: ws.id, title: "Parallel Runs Item", description: "desc" })

    // Main run: advanced to requirements
    const mainRun = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "main" })
    const mainBus = makeBus()
    attachDbSync(mainBus, repos, { runId: mainRun.id, itemId: item.id })

    mainBus.emit({ type: "run_started", runId: mainRun.id, itemId: item.id, title: "main" })
    mainBus.emit({ type: "stage_started", runId: mainRun.id, stageRunId: "m-req", stageKey: "requirements" })

    const itemAtRequirements = repos.getItem(item.id)!
    assert.equal(itemAtRequirements.current_column, "requirements")

    // Side-run: starts brainstorm stage (which maps to column=brainstorm)
    const sideRun = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "side" })
    const sideBus = makeBus()
    attachDbSync(sideBus, repos, { runId: sideRun.id, itemId: item.id })

    sideBus.emit({ type: "run_started", runId: sideRun.id, itemId: item.id, title: "side" })
    // side-run starts a brainstorm stage — would regress item to brainstorm/running
    sideBus.emit({ type: "stage_started", runId: sideRun.id, stageRunId: "s-brn", stageKey: "brainstorm" })

    // Item must remain at requirements/running (main run's state), not regress to brainstorm
    const itemAfterSideStart = repos.getItem(item.id)!
    assert.equal(
      itemAfterSideStart.current_column,
      "requirements",
      "side-run stage_started must not regress item column (expected requirements, got " +
        itemAfterSideStart.current_column + ")"
    )
  } finally {
    db.close()
  }
})

// ---------------------------------------------------------------------------
// Completed side-run must not steal item state from a live main run
// ---------------------------------------------------------------------------

test("side-run completion does not steal item state from live main run", () => {
  const db = tmpDb()
  const repos = new Repos(db)
  try {
    const ws = repos.upsertWorkspace({ key: "test", name: "Test" })
    const item = repos.createItem({ workspaceId: ws.id, title: "Completion Theft Item", description: "desc" })

    // Main run: live at requirements
    const mainRun = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "main" })
    const mainBus = makeBus()
    attachDbSync(mainBus, repos, { runId: mainRun.id, itemId: item.id })

    mainBus.emit({ type: "run_started", runId: mainRun.id, itemId: item.id, title: "main" })
    mainBus.emit({ type: "stage_started", runId: mainRun.id, stageRunId: "m-req", stageKey: "requirements" })

    // Side-run: completes fully (design_prep completed)
    const sideRun = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "side" })
    const sideBus = makeBus()
    attachDbSync(sideBus, repos, { runId: sideRun.id, itemId: item.id })

    sideBus.emit({ type: "run_started", runId: sideRun.id, itemId: item.id, title: "side" })
    sideBus.emit({ type: "stage_started", runId: sideRun.id, stageRunId: "s-brn", stageKey: "brainstorm" })
    sideBus.emit({ type: "stage_completed", runId: sideRun.id, stageRunId: "s-brn", stageKey: "brainstorm", status: "completed" })
    sideBus.emit({ type: "run_finished", runId: sideRun.id, itemId: item.id, title: "side", status: "completed" })

    // Item must remain at requirements/running (main run's state)
    const itemAfter = repos.getItem(item.id)!
    assert.equal(
      itemAfter.current_column,
      "requirements",
      "side-run completion must not steal item column from live main run"
    )
    assert.equal(itemAfter.phase_status, "running")
  } finally {
    db.close()
  }
})
