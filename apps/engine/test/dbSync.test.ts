import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { runWithWorkflowIO, type WorkflowIO, type WorkflowEvent } from "../src/core/io.js"
import { attachDbSync, mapStageToColumn, withDbSync } from "../src/core/runOrchestrator.js"
import { runWithActiveRun } from "../src/core/runContext.js"
import { createApiIOSession } from "../src/core/ioApi.js"
import { ask } from "../src/sim/human.js"
import { createStageRun, writeArtifactFiles } from "../src/core/stageRuntime.js"

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
    assert.equal(stages[0].id, "x")

    const logs = repos.listLogsForRun(run.id)
    const types = logs.map(l => l.event_type).sort()
    assert.deepEqual(types, ["run_finished", "stage_completed", "stage_started"].sort())

    const updatedRun = repos.getRun(run.id)
    assert.equal(updatedRun?.status, "completed")
  } finally {
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

test("workflow IO and active run context stay isolated across parallel async chains", async () => {
  const ioA: WorkflowIO = { async ask() { return "A" }, emit() {}, close() {} }
  const ioB: WorkflowIO = { async ask() { return "B" }, emit() {}, close() {} }

  const [answerA, answerB] = await Promise.all([
    runWithWorkflowIO(ioA, async () =>
      runWithActiveRun({ runId: "run-a", itemId: "item-a" }, async () => {
        await new Promise(resolve => setTimeout(resolve, 20))
        return ask("A?")
      })
    ),
    runWithWorkflowIO(ioB, async () =>
      runWithActiveRun({ runId: "run-b", itemId: "item-b" }, async () => {
        await new Promise(resolve => setTimeout(resolve, 5))
        return ask("B?")
      })
    ),
  ])

  assert.equal(answerA, "A")
  assert.equal(answerB, "B")
})

test("project_created events persist project rows used by later stage runs", () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "test", name: "Test" })
  const item = repos.createItem({ workspaceId: ws.id, title: "T", description: "D" })
  const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "T" })
  const io = makeIO([])

  attachDbSync(io, repos, { runId: run.id, itemId: item.id })
  io.emit({
    type: "project_created",
    runId: run.id,
    itemId: item.id,
    projectId: "PRJ-1",
    code: "PRJ-1",
    name: "Project 1",
    summary: "Summary",
    position: 0,
  })
  io.emit({ type: "stage_started", runId: run.id, stageRunId: "stage-1", stageKey: "requirements", projectId: "PRJ-1" })

  const projects = db.prepare("SELECT * FROM projects WHERE item_id = ?").all(item.id) as Array<{ id: string; code: string }>
  const stages = repos.listStageRunsForRun(run.id)

  assert.deepEqual(projects.map(project => project.id), ["PRJ-1"])
  assert.deepEqual(projects.map(project => project.code), ["PRJ-1"])
  assert.equal(stages[0].project_id, "PRJ-1")
  db.close()
})

test("API prompt answers and artifact writes are persisted through the db sync layer", async () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "test", name: "Test" })
  const item = repos.createItem({ workspaceId: ws.id, title: "T", description: "D" })
  const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "T" })
  const session = createApiIOSession(repos)
  const dbSyncedIo = withDbSync(session.io, repos, { runId: run.id, itemId: item.id })
  repos.createStageRun({ id: "stage-1", runId: run.id, stageKey: "requirements" })

  await runWithWorkflowIO(dbSyncedIo, async () =>
    runWithActiveRun({ runId: run.id, itemId: item.id, stageRunId: "stage-1" }, async () => {
      const promptPromise = dbSyncedIo.ask("question?")
      const prompt = repos.getOpenPrompt(run.id)
      assert.ok(prompt)
      assert.equal(session.answerPrompt(prompt.id, "answer!"), true)
      await promptPromise

      const stageRuntimeRun = createStageRun({
        stageId: "requirements",
        workspaceId: "ws-1",
        runId: run.id,
        createInitialState: () => ({}),
      })
      const files = await writeArtifactFiles(stageRuntimeRun.stageArtifactsDir, [
        { kind: "json", label: "Artifact", fileName: "artifact.json", content: "{}\n" },
      ])
      files.forEach(file =>
        dbSyncedIo.emit({
          type: "artifact_written",
          runId: run.id,
          stageRunId: "stage-1",
          label: file.label,
          kind: file.kind,
          path: file.path,
        })
      )
    })
  )

  const logs = repos.listLogsForRun(run.id)
  const eventTypes = logs.map(log => log.event_type)
  const artifacts = repos.listArtifactsForRun(run.id)

  assert.ok(eventTypes.includes("prompt_requested"))
  assert.ok(eventTypes.includes("prompt_answered"))
  assert.ok(eventTypes.includes("artifact_written"))
  assert.equal(artifacts.length, 1)
  assert.equal(artifacts[0].stage_run_id, "stage-1")
  db.close()
})

test("withDbSync is idempotent on re-emitted stage_started events", () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "test", name: "Test" })
  const item = repos.createItem({ workspaceId: ws.id, title: "T", description: "D" })
  const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "T" })
  const events: WorkflowEvent[] = []
  const inner = makeIO(events)
  const io = withDbSync(inner, repos, { runId: run.id, itemId: item.id })

  io.emit({ type: "stage_started", runId: run.id, stageRunId: "dup", stageKey: "brainstorm" })
  io.emit({ type: "stage_started", runId: run.id, stageRunId: "dup", stageKey: "brainstorm" })

  const stages = repos.listStageRunsForRun(run.id)
  assert.equal(stages.length, 1, "stage_runs row must not be duplicated")
  assert.equal(events.length, 2, "both events still forwarded to the inner IO")
  db.close()
})

test("withDbSync stamps streamId+at on persisted events without mutating the original", () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "test", name: "Test" })
  const item = repos.createItem({ workspaceId: ws.id, title: "T", description: "D" })
  const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "T" })
  const captured: WorkflowEvent[] = []
  const inner: WorkflowIO = { async ask() { return "" }, emit(ev) { captured.push(ev) }, close() {} }
  const io = withDbSync(inner, repos, { runId: run.id, itemId: item.id })

  const original: WorkflowEvent = { type: "log", runId: run.id, message: "hello" }
  io.emit(original)

  assert.equal((original as { streamId?: string }).streamId, undefined, "input event must not be mutated")
  assert.ok(captured[0].streamId, "forwarded event carries the persisted streamId")
  assert.ok(captured[0].at, "forwarded event carries the persisted timestamp")
  db.close()
})
