import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { setWorkflowIO, type WorkflowIO, type WorkflowEvent } from "../src/core/io.js"
import { attachDbSync, mapStageToColumn } from "../src/core/runOrchestrator.js"

function makeIO(events: WorkflowEvent[]): WorkflowIO {
  return {
    async ask() { return "" },
    emit(ev) { events.push(ev) },
    close() {}
  }
}

function tmpDb() {
  const dir = mkdtempSync(join(tmpdir(), "be2-dbsync-"))
  return initDatabase(join(dir, "test.sqlite"))
}

test("mapStageToColumn projects engine stages to board columns", () => {
  assert.equal(mapStageToColumn("brainstorm", "running").column, "brainstorm")
  assert.equal(mapStageToColumn("requirements", "running").column, "requirements")
  assert.equal(mapStageToColumn("execution", "running").column, "implementation")
  assert.equal(mapStageToColumn("qa", "running").column, "implementation")
  assert.equal(mapStageToColumn("documentation", "completed").column, "done")
  assert.equal(mapStageToColumn(undefined, "running").column, "idea")
})

test("attachDbSync persists stage lifecycle into DB", () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "test", name: "Test" })
  const item = repos.createItem({ workspaceId: ws.id, title: "T", description: "D" })
  const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "T" })
  const events: WorkflowEvent[] = []
  const io = makeIO(events)
  setWorkflowIO(io)

  try {
    attachDbSync(io, repos, { runId: run.id, itemId: item.id })
    io.emit({ type: "run_started", runId: run.id, itemId: item.id, title: "T" })
    io.emit({ type: "stage_started", runId: run.id, stageRunId: "x", stageKey: "brainstorm" })
    io.emit({ type: "stage_completed", runId: run.id, stageRunId: "x", stageKey: "brainstorm", status: "completed" })
    io.emit({ type: "run_finished", runId: run.id, status: "completed" })

    const stages = repos.listStageRunsForRun(run.id)
    assert.equal(stages.length, 1)
    assert.equal(stages[0].stage_key, "brainstorm")
    assert.equal(stages[0].status, "completed")

    const logs = repos.listLogsForRun(run.id)
    const types = logs.map(l => l.event_type).sort()
    assert.deepEqual(types, ["run_finished", "stage_completed", "stage_started"].sort())

    const updatedRun = repos.getRun(run.id)
    assert.equal(updatedRun?.status, "completed")
  } finally {
    setWorkflowIO(null)
    db.close()
  }
})

test("pending prompts round-trip via repos", () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "test", name: "Test" })
  const item = repos.createItem({ workspaceId: ws.id, title: "T", description: "D" })
  const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "T" })

  const p1 = repos.createPendingPrompt({ runId: run.id, prompt: "question?" })
  assert.equal(repos.getOpenPrompt(run.id)?.id, p1.id)
  const answered = repos.answerPendingPrompt(p1.id, "answer!")
  assert.equal(answered?.answer, "answer!")
  assert.equal(repos.getOpenPrompt(run.id), undefined)
  db.close()
})
