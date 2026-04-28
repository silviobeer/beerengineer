import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PassThrough } from "node:stream"

import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { runWithWorkflowIO, type WorkflowIO } from "../src/core/io.js"
import {
  attachDbSync,
  busToWorkflowIO,
  mapStageToColumn,
  prepareRun,
} from "../src/core/runOrchestrator.js"
import { runWithActiveRun } from "../src/core/runContext.js"
import { createApiIOSession } from "../src/core/ioApi.js"
import { createCliIO } from "../src/core/ioCli.js"
import { createBus } from "../src/core/bus.js"
import { attachNdjsonRenderer } from "../src/core/renderers/ndjson.js"
import { ask } from "../src/sim/human.js"
import { createStageRun, persistWorkflowRunState, writeArtifactFiles } from "../src/core/stageRuntime.js"
import { layout } from "../src/core/workspaceLayout.js"

function tmpDb() {
  const dir = mkdtempSync(join(tmpdir(), "be2-dbsync-"))
  return initDatabase(join(dir, "test.sqlite"))
}

/** Helper: a bus + the adapter io that tests emit through. */
function makeBusIO() {
  const bus = createBus()
  const io = busToWorkflowIO(bus)
  return { bus, io }
}

test("mapStageToColumn projects engine stages to board columns", () => {
  assert.equal(mapStageToColumn("brainstorm", "running").column, "brainstorm")
  assert.equal(mapStageToColumn("requirements", "running").column, "requirements")
  assert.equal(mapStageToColumn("execution", "running").column, "implementation")
  assert.equal(mapStageToColumn("qa", "running").column, "implementation")
  assert.equal(mapStageToColumn("documentation", "completed").column, "implementation")
  assert.equal(mapStageToColumn("merge-gate", "running").column, "merge")
  assert.equal(mapStageToColumn("merge-gate", "running").phaseStatus, "review_required")
  assert.equal(mapStageToColumn("merge-gate", "completed").column, "done")
  assert.equal(mapStageToColumn("merge-gate", "failed").column, "merge")
  assert.equal(mapStageToColumn("merge-gate", "failed").phaseStatus, "review_required")
  assert.equal(mapStageToColumn(undefined, "running").column, "idea")
})

test("attachDbSync persists stage lifecycle into DB", () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "test", name: "Test" })
  const item = repos.createItem({ workspaceId: ws.id, title: "T", description: "D" })
  const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "T" })
  const { bus } = makeBusIO()

  try {
    attachDbSync(bus, repos, { runId: run.id, itemId: item.id })
    bus.emit({ type: "run_started", runId: run.id, itemId: item.id, title: "T" })
    bus.emit({ type: "stage_started", runId: run.id, stageRunId: "x", stageKey: "brainstorm" })
    bus.emit({ type: "stage_completed", runId: run.id, stageRunId: "x", stageKey: "brainstorm", status: "completed" })
    bus.emit({ type: "run_finished", runId: run.id, itemId: item.id, title: "T", status: "completed" })

    const stages = repos.listStageRunsForRun(run.id)
    assert.equal(stages.length, 1)
    assert.equal(stages[0].stage_key, "brainstorm")
    assert.equal(stages[0].status, "completed")
    assert.equal(stages[0].id, "x")

    const logs = repos.listLogsForRun(run.id)
    const types = logs.map(l => l.event_type).sort()
    assert.deepEqual(types, ["run_started", "run_finished", "stage_completed", "stage_started"].sort())

    const updatedRun = repos.getRun(run.id)
    assert.equal(updatedRun?.status, "completed")
  } finally {
    db.close()
  }
})

test("attachDbSync persists synthetic messaging-level events", () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "test", name: "Test" })
  const item = repos.createItem({ workspaceId: ws.id, title: "T", description: "D" })
  const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "T" })
  const { bus } = makeBusIO()

  try {
    attachDbSync(bus, repos, { runId: run.id, itemId: item.id })
    repos.createStageRun({ id: "stage-1", runId: run.id, stageKey: "requirements" })
    bus.emit({ type: "loop_iteration", runId: run.id, stageRunId: "stage-1", n: 1, phase: "begin", stageKey: "requirements" })
    bus.emit({ type: "tool_called", runId: run.id, stageRunId: "stage-1", name: "Bash", argsPreview: "{\"cmd\":\"pwd\"}", provider: "claude" })
    bus.emit({ type: "tool_result", runId: run.id, stageRunId: "stage-1", name: "Bash", resultPreview: "/workspace", provider: "claude" })
    bus.emit({ type: "llm_thinking", runId: run.id, stageRunId: "stage-1", text: "Planning next step", provider: "claude" })
    bus.emit({ type: "llm_tokens", runId: run.id, stageRunId: "stage-1", in: 12, out: 8, cached: 5, provider: "claude" })

    const logs = repos.listLogsForRun(run.id)
    assert.deepEqual(
      logs.map(log => log.event_type),
      ["loop_iteration", "tool_called", "tool_result", "llm_thinking", "llm_tokens"],
    )
    assert.match(logs[0]?.data_json ?? "", /"phase":"begin"/)
    assert.match(logs[1]?.data_json ?? "", /"argsPreview":/)
    assert.match(logs[1]?.data_json ?? "", /pwd/)
    assert.match(logs[4]?.data_json ?? "", /"in":12/)
    assert.match(logs[4]?.data_json ?? "", /"out":8/)
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

test("pending prompts persist structured actions", () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "test", name: "Test" })
  const item = repos.createItem({ workspaceId: ws.id, title: "T", description: "D" })
  const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "T" })

  const prompt = repos.createPendingPrompt({
    runId: run.id,
    prompt: "Promote this item?",
    actions: [
      { label: "Promote", value: "promote" },
      { label: "Cancel", value: "cancel" },
    ],
  })
  assert.match(prompt.actions_json ?? "", /promote/)
  assert.match(prompt.actions_json ?? "", /cancel/)
  db.close()
})

test("notification delivery claims are durable and deduplicate by key", () => {
  const db = tmpDb()
  const repos = new Repos(db)

  const first = repos.claimNotificationDelivery({
    dedupKey: "run-1:run_finished",
    channel: "telegram",
    chatId: "123",
  })
  const second = repos.claimNotificationDelivery({
    dedupKey: "run-1:run_finished",
    channel: "telegram",
    chatId: "123",
  })

  assert.equal(first, true)
  assert.equal(second, false)

  repos.completeNotificationDelivery("run-1:run_finished", { status: "delivered" })
  const delivery = repos.getNotificationDelivery("run-1:run_finished")
  assert.equal(delivery?.status, "delivered")
  assert.equal(delivery?.attempt_count, 1)
  assert.equal(delivery?.chat_id, "123")

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
  const { bus } = makeBusIO()

  attachDbSync(bus, repos, { runId: run.id, itemId: item.id })
  bus.emit({
    type: "project_created",
    runId: run.id,
    itemId: item.id,
    projectId: "PRJ-1",
    code: "PRJ-1",
    name: "Project 1",
    summary: "Summary",
    position: 0,
  })
  bus.emit({ type: "stage_started", runId: run.id, stageRunId: "stage-1", stageKey: "requirements", projectId: "PRJ-1" })

  const projects = db.prepare("SELECT * FROM projects WHERE item_id = ?").all(item.id) as Array<{ id: string; code: string }>
  const stages = repos.listStageRunsForRun(run.id)

  assert.deepEqual(projects.map(project => project.id), ["PRJ-1"])
  assert.deepEqual(projects.map(project => project.code), ["PRJ-1"])
  assert.equal(stages[0].project_id, "PRJ-1")
  db.close()
})

test("project codes are item-scoped, so different items can each have P01", () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "test", name: "Test" })
  const itemA = repos.createItem({ workspaceId: ws.id, title: "A", description: "DA" })
  const itemB = repos.createItem({ workspaceId: ws.id, title: "B", description: "DB" })

  const projectA = repos.createProject({ id: "PRJ-A", itemId: itemA.id, code: "P01", name: "Project A" })
  const projectB = repos.createProject({ id: "PRJ-B", itemId: itemB.id, code: "P01", name: "Project B" })

  assert.equal(projectA.id, "PRJ-A")
  assert.equal(projectB.id, "PRJ-B")
  const rows = db.prepare("SELECT id, item_id, code FROM projects ORDER BY id ASC").all() as Array<{ id: string; item_id: string; code: string }>
  assert.deepEqual(rows, [
    { id: "PRJ-A", item_id: itemA.id, code: "P01" },
    { id: "PRJ-B", item_id: itemB.id, code: "P01" },
  ])
  db.close()
})

test("attachDbSync remaps logical project ids when different items reuse the same project ref", () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "test", name: "Test" })
  const itemA = repos.createItem({ workspaceId: ws.id, title: "A", description: "DA" })
  const itemB = repos.createItem({ workspaceId: ws.id, title: "B", description: "DB" })
  const runA = repos.createRun({ workspaceId: ws.id, itemId: itemA.id, title: "A" })
  const runB = repos.createRun({ workspaceId: ws.id, itemId: itemB.id, title: "B" })
  const { bus: busA } = makeBusIO()
  const { bus: busB } = makeBusIO()
  attachDbSync(busA, repos, { runId: runA.id, itemId: itemA.id })
  attachDbSync(busB, repos, { runId: runB.id, itemId: itemB.id })

  busA.emit({
    type: "project_created",
    runId: runA.id,
    itemId: itemA.id,
    projectId: "P01",
    code: "P01",
    name: "Project A",
    summary: "A",
    position: 0,
  })
  busB.emit({
    type: "project_created",
    runId: runB.id,
    itemId: itemB.id,
    projectId: "P01",
    code: "P01",
    name: "Project B",
    summary: "B",
    position: 0,
  })
  busA.emit({ type: "stage_started", runId: runA.id, stageRunId: "stage-a", stageKey: "requirements", projectId: "P01" })
  busB.emit({ type: "stage_started", runId: runB.id, stageRunId: "stage-b", stageKey: "requirements", projectId: "P01" })

  const projects = db.prepare("SELECT id, item_id, code FROM projects ORDER BY item_id ASC").all() as Array<{ id: string; item_id: string; code: string }>
  const stagesA = repos.listStageRunsForRun(runA.id)
  const stagesB = repos.listStageRunsForRun(runB.id)

  assert.equal(projects.length, 2)
  assert.equal(projects[0]?.code, "P01")
  assert.equal(projects[1]?.code, "P01")
  assert.notEqual(projects[0]?.id, projects[1]?.id)
  assert.equal(stagesA[0]?.project_id, projects.find(project => project.item_id === itemA.id)?.id)
  assert.equal(stagesB[0]?.project_id, projects.find(project => project.item_id === itemB.id)?.id)
  db.close()
})

test("API prompt answers and artifact writes are persisted through the bus subscribers", async () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const workspaceRoot = mkdtempSync(join(tmpdir(), "be2-dbsync-api-"))
  const ws = repos.upsertWorkspace({ key: "test", name: "Test", rootPath: workspaceRoot })
  const item = repos.createItem({ workspaceId: ws.id, title: "T", description: "D" })
  const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "T" })
  const session = createApiIOSession(repos)
  attachDbSync(session.bus, repos, { runId: run.id, itemId: item.id })
  repos.createStageRun({ id: "stage-1", runId: run.id, stageKey: "requirements" })

  await runWithWorkflowIO(session.io, async () =>
    runWithActiveRun({ runId: run.id, itemId: item.id, stageRunId: "stage-1" }, async () => {
      const promptPromise = session.io.ask("question?")
      const prompt = repos.getOpenPrompt(run.id)
      assert.ok(prompt)
      assert.equal(session.answerPrompt(prompt.id, "answer!"), true)
      await promptPromise

      const stageRuntimeRun = createStageRun({
        stageId: "requirements",
        workspaceId: "ws-1",
        workspaceRoot,
        runId: run.id,
        createInitialState: () => ({}),
      })
      const files = await writeArtifactFiles(stageRuntimeRun.stageArtifactsDir, [
        { kind: "json", label: "Artifact", fileName: "artifact.json", content: "{}\n" },
      ])
      files.forEach(file =>
        session.bus.emit({
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
  session.dispose()
  db.close()
})

test("NDJSON prompt answers are persisted through the bus subscribers", async () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "test", name: "Test" })
  const item = repos.createItem({ workspaceId: ws.id, title: "T", description: "D" })
  const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "T", owner: "cli" })
  const out = new PassThrough()
  const input = new PassThrough()
  const io = createCliIO(repos, {
    renderer: bus => attachNdjsonRenderer(bus, { out, in: input }),
    externalPromptResolver: true,
  })
  attachDbSync(io.bus, repos, { runId: run.id, itemId: item.id })

  try {
    await runWithWorkflowIO(io, async () =>
      runWithActiveRun({ runId: run.id, itemId: item.id }, async () => {
        const promptPromise = io.ask("question?")
        // Give the bus a tick so prompt_requested reaches subscribers and
        // pending_prompts is populated before we query for it.
        await new Promise(r => setTimeout(r, 10))
        const prompt = repos.getOpenPrompt(run.id)
        assert.ok(prompt)
        input.write(`${JSON.stringify({ type: "prompt_answered", promptId: prompt.id, answer: "answer!" })}\n`)
        await promptPromise
      })
    )

    const eventTypes = repos.listLogsForRun(run.id).map(log => log.event_type)
    assert.ok(eventTypes.includes("prompt_requested"))
    assert.ok(eventTypes.includes("prompt_answered"))
  } finally {
    io.close?.()
    db.close()
  }
})

test("chat_message and presentation are persisted through the bus subscribers", () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "test", name: "Test" })
  const item = repos.createItem({ workspaceId: ws.id, title: "T", description: "D" })
  const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "T" })
  repos.createStageRun({ id: "stage-1", runId: run.id, stageKey: "brainstorm" })
  const { bus } = makeBusIO()
  attachDbSync(bus, repos, { runId: run.id, itemId: item.id })

  bus.emit({
    type: "chat_message",
    runId: run.id,
    stageRunId: "stage-1",
    role: "LLM-1",
    source: "stage-agent",
    text: "What problem should the product solve?",
    requiresResponse: true,
  })
  bus.emit({
    type: "presentation",
    runId: run.id,
    stageRunId: "stage-1",
    kind: "step",
    text: "Interactive session via LLM adapter",
  })

  const logs = repos.listLogsForRun(run.id)
  const chat = logs.find(log => log.event_type === "chat_message")
  const presentation = logs.find(log => log.event_type === "presentation")

  assert.equal(chat?.message, "What problem should the product solve?")
  assert.ok(chat?.data_json?.includes("\"role\":\"LLM-1\""))
  assert.equal(presentation?.message, "Interactive session via LLM adapter")
  assert.ok(presentation?.data_json?.includes("\"kind\":\"step\""))
  db.close()
})

test("persisted log activity refreshes run and stage updated_at timestamps", () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "test", name: "Test" })
  const item = repos.createItem({ workspaceId: ws.id, title: "T", description: "D" })
  const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "T" })
  const { bus } = makeBusIO()

  try {
    attachDbSync(bus, repos, { runId: run.id, itemId: item.id })
    bus.emit({ type: "run_started", runId: run.id, itemId: item.id, title: "T" })
    bus.emit({ type: "stage_started", runId: run.id, stageRunId: "stage-1", stageKey: "execution" })

    const runBefore = repos.getRun(run.id)
    const stageBefore = repos.listStageRunsForRun(run.id).find(stage => stage.id === "stage-1")
    assert.ok(runBefore)
    assert.ok(stageBefore)

    bus.emit({
      type: "presentation",
      runId: run.id,
      stageRunId: "stage-1",
      kind: "dim",
      text: "claude: turn started",
    })

    const runAfter = repos.getRun(run.id)
    const stageAfter = repos.listStageRunsForRun(run.id).find(stage => stage.id === "stage-1")
    assert.ok(runAfter)
    assert.ok(stageAfter)
    assert.ok((runAfter?.updated_at ?? 0) >= (runBefore?.updated_at ?? 0))
    assert.ok((stageAfter?.updated_at ?? 0) >= (stageBefore?.updated_at ?? 0))
  } finally {
    db.close()
  }
})

test("attachDbSync is idempotent on re-emitted stage_started events", () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "test", name: "Test" })
  const item = repos.createItem({ workspaceId: ws.id, title: "T", description: "D" })
  const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "T" })
  const seen: string[] = []
  const { bus } = makeBusIO()
  bus.subscribe(ev => seen.push(ev.type))
  attachDbSync(bus, repos, { runId: run.id, itemId: item.id })

  bus.emit({ type: "stage_started", runId: run.id, stageRunId: "dup", stageKey: "brainstorm" })
  bus.emit({ type: "stage_started", runId: run.id, stageRunId: "dup", stageKey: "brainstorm" })

  const stages = repos.listStageRunsForRun(run.id)
  assert.equal(stages.length, 1, "stage_runs row must not be duplicated")
  assert.equal(seen.filter(t => t === "stage_started").length, 2, "every emit reaches subscribers even when persistence dedups")
  db.close()
})

test("stage_completed updates the exact emitted stageRunId even when stage keys repeat across projects", () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "test", name: "Test" })
  const item = repos.createItem({ workspaceId: ws.id, title: "T", description: "D" })
  const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "T" })
  const { bus } = makeBusIO()
  attachDbSync(bus, repos, { runId: run.id, itemId: item.id })

  repos.createProject({ id: "project-1", itemId: item.id, code: "P01", name: "Project 1" })
  repos.createProject({ id: "project-2", itemId: item.id, code: "P02", name: "Project 2" })
  bus.emit({ type: "stage_started", runId: run.id, stageRunId: "req-1", stageKey: "requirements", projectId: "project-1" })
  bus.emit({ type: "stage_started", runId: run.id, stageRunId: "req-2", stageKey: "requirements", projectId: "project-2" })
  bus.emit({ type: "stage_completed", runId: run.id, stageRunId: "req-1", stageKey: "requirements", status: "completed" })

  const stage1 = db.prepare("SELECT status FROM stage_runs WHERE id = ?").get("req-1") as { status: string }
  const stage2 = db.prepare("SELECT status FROM stage_runs WHERE id = ?").get("req-2") as { status: string }
  assert.equal(stage1.status, "completed")
  assert.equal(stage2.status, "running")
  db.close()
})

test("prepareRun keeps an existing item's workspace instead of forcing default", () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const defaultWs = repos.upsertWorkspace({ key: "default", name: "Default Workspace" })
  const otherWs = repos.upsertWorkspace({ key: "other", name: "Other Workspace" })
  const item = repos.createItem({ workspaceId: otherWs.id, title: "T", description: "D" })
  const session = createApiIOSession(repos)
  const prepared = prepareRun(
    { id: item.id, title: item.title, description: item.description },
    repos,
    session.io,
    { itemId: item.id }
  )

  const run = repos.getRun(prepared.runId)
  assert.ok(run)
  assert.equal(run?.workspace_id, otherWs.id)
  assert.notEqual(run?.workspace_id, defaultWs.id)
  session.dispose()
  db.close()
})

test("persistWorkflowRunState keeps run.json and workspace.json aligned with run completion", async () => {
  const ctx = { workspaceId: "ws-runstate", workspaceRoot: mkdtempSync(join(tmpdir(), "be2-dbsync-")), runId: "run-runstate" }

  await persistWorkflowRunState(ctx, "handoff", "completed")

  const runFile = JSON.parse(readFileSync(layout.runFile(ctx), "utf8")) as {
    currentStage: string
    status: string
  }
  const workspaceFile = JSON.parse(readFileSync(layout.workspaceFile(ctx), "utf8")) as {
    currentStage: string
    status: string
  }

  assert.equal(runFile.currentStage, "handoff")
  assert.equal(runFile.status, "completed")
  assert.equal(workspaceFile.currentStage, "handoff")
  assert.equal(workspaceFile.status, "approved")
})

test("attachDbSync sets items.current_stage on stage_started and clears it on run_finished (sole live run)", () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "test", name: "Test" })
  const item = repos.createItem({ workspaceId: ws.id, title: "T", description: "D" })
  const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "T" })
  const { bus } = makeBusIO()
  try {
    attachDbSync(bus, repos, { runId: run.id, itemId: item.id })
    bus.emit({ type: "run_started", runId: run.id, itemId: item.id, title: "T" })
    bus.emit({ type: "stage_started", runId: run.id, stageRunId: "s1", stageKey: "execution" })
    assert.equal(repos.getItem(item.id)?.current_stage, "execution",
      "stage_started must mirror stageKey onto items.current_stage")
    bus.emit({ type: "run_finished", runId: run.id, itemId: item.id, title: "T", status: "completed" })
    assert.equal(repos.getItem(item.id)?.current_stage, null,
      "run_finished on the sole live run must clear items.current_stage")
  } finally {
    db.close()
  }
})

test("attachDbSync clears items.current_stage on run_failed (sole live run)", () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "test", name: "Test" })
  const item = repos.createItem({ workspaceId: ws.id, title: "T", description: "D" })
  const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "T" })
  const { bus } = makeBusIO()
  try {
    attachDbSync(bus, repos, { runId: run.id, itemId: item.id })
    bus.emit({ type: "run_started", runId: run.id, itemId: item.id, title: "T" })
    bus.emit({ type: "stage_started", runId: run.id, stageRunId: "s1", stageKey: "architecture" })
    assert.equal(repos.getItem(item.id)?.current_stage, "architecture")
    bus.emit({
      type: "run_failed",
      runId: run.id,
      itemId: item.id,
      title: "T",
      scope: { type: "run", runId: run.id },
      cause: "system_error",
      summary: "boom",
    })
    assert.equal(repos.getItem(item.id)?.current_stage, null,
      "run_failed on the sole live run must clear items.current_stage even when column/phase stay put")
    // Per Option A: failed runs do NOT mutate column/phase.
    assert.equal(repos.getItem(item.id)?.current_column, "implementation",
      "run_failed must not roll back column projection from the prior stage_started")
  } finally {
    db.close()
  }
})

test("attachDbSync clears items.current_stage on run_blocked (sole live run)", () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "test", name: "Test" })
  const item = repos.createItem({ workspaceId: ws.id, title: "T", description: "D" })
  const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "T" })
  const { bus } = makeBusIO()
  try {
    attachDbSync(bus, repos, { runId: run.id, itemId: item.id })
    bus.emit({ type: "run_started", runId: run.id, itemId: item.id, title: "T" })
    bus.emit({ type: "stage_started", runId: run.id, stageRunId: "s1", stageKey: "planning" })
    assert.equal(repos.getItem(item.id)?.current_stage, "planning")
    bus.emit({
      type: "run_blocked",
      runId: run.id,
      itemId: item.id,
      title: "T",
      scope: { type: "run", runId: run.id },
      cause: "user_intervention",
      summary: "needs human",
    })
    assert.equal(repos.getItem(item.id)?.current_stage, null,
      "run_blocked on the sole live run must clear items.current_stage so the stepper does not lie")
  } finally {
    db.close()
  }
})

test("attachDbSync does NOT clear items.current_stage when a sibling run is still live", () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "test", name: "Test" })
  const item = repos.createItem({ workspaceId: ws.id, title: "T", description: "D" })
  // Phase 1: only the main run exists. It is authoritative and writes
  // items.current_stage = "execution" via stage_started.
  const main = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "T" })
  const { bus: mainBus } = makeBusIO()
  attachDbSync(mainBus, repos, { runId: main.id, itemId: item.id })
  mainBus.emit({ type: "stage_started", runId: main.id, stageRunId: "m1", stageKey: "execution" })
  assert.equal(repos.getItem(item.id)?.current_stage, "execution",
    "main run must set current_stage while it is the sole live run")

  // Phase 2: a side run starts (e.g. rerun_design_prep) and then fails.
  // Its run_failed handler must NOT clear items.current_stage because
  // main is still alive and owns the projection.
  const side = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "T" })
  const { bus: sideBus } = makeBusIO()
  try {
    attachDbSync(sideBus, repos, { runId: side.id, itemId: item.id })
    sideBus.emit({
      type: "run_failed",
      runId: side.id,
      itemId: item.id,
      title: "T",
      scope: { type: "run", runId: side.id },
      cause: "system_error",
      summary: "side died",
    })
    assert.equal(repos.getItem(item.id)?.current_stage, "execution",
      "side-run failure must not clobber items.current_stage when a sibling run is still live")
  } finally {
    db.close()
  }
})

// ---------------------------------------------------------------------------
// onItemColumnChanged callback — SSE broadcast tests
// ---------------------------------------------------------------------------

test("attachDbSync calls onItemColumnChanged on authoritative stage_started", () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "test", name: "Test" })
  const item = repos.createItem({ workspaceId: ws.id, title: "T", description: "D" })
  const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "T" })
  const { bus } = makeBusIO()
  const calls: Array<{ itemId: string; from: string; to: string; phaseStatus: string }> = []

  try {
    attachDbSync(bus, repos, { runId: run.id, itemId: item.id }, {
      onItemColumnChanged: (payload) => calls.push(payload),
    })
    bus.emit({ type: "stage_started", runId: run.id, stageRunId: "s1", stageKey: "architecture" })

    assert.equal(calls.length, 1, "should have received one column-changed callback")
    assert.equal(calls[0]?.itemId, item.id)
    assert.equal(calls[0]?.to, "implementation")
    assert.equal(calls[0]?.phaseStatus, "running")
  } finally {
    db.close()
  }
})

test("attachDbSync calls onItemColumnChanged on authoritative stage_completed", () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "test", name: "Test" })
  const item = repos.createItem({ workspaceId: ws.id, title: "T", description: "D" })
  const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "T" })
  const { bus } = makeBusIO()
  const calls: Array<{ itemId: string; from: string; to: string; phaseStatus: string }> = []

  try {
    attachDbSync(bus, repos, { runId: run.id, itemId: item.id }, {
      onItemColumnChanged: (payload) => calls.push(payload),
    })
    repos.createStageRun({ id: "s1", runId: run.id, stageKey: "requirements" })
    bus.emit({ type: "stage_completed", runId: run.id, stageRunId: "s1", stageKey: "requirements", status: "completed" })

    assert.equal(calls.length, 1, "should have received one column-changed callback on stage_completed")
    assert.equal(calls[0]?.itemId, item.id)
    assert.equal(calls[0]?.to, "requirements")
    assert.equal(calls[0]?.phaseStatus, "completed")
  } finally {
    db.close()
  }
})

test("attachDbSync calls onItemColumnChanged on authoritative run_finished (completed)", () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "test", name: "Test" })
  const item = repos.createItem({ workspaceId: ws.id, title: "T", description: "D" })
  const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "T" })
  const { bus } = makeBusIO()
  const calls: Array<{ itemId: string; from: string; to: string; phaseStatus: string }> = []

  try {
    attachDbSync(bus, repos, { runId: run.id, itemId: item.id }, {
      onItemColumnChanged: (payload) => calls.push(payload),
    })
    bus.emit({ type: "run_finished", runId: run.id, itemId: item.id, title: "T", status: "completed" })

    assert.equal(calls.length, 1, "should have received one column-changed callback on run_finished")
    assert.equal(calls[0]?.itemId, item.id)
    // run_finished projects through `mapStageToColumn("documentation", status)`,
    // which since the merge-gate work maps to `implementation`. The terminal
    // `done` flip now happens via `merge-gate / completed`, not via run_finished.
    assert.equal(calls[0]?.to, "implementation")
    assert.equal(calls[0]?.phaseStatus, "completed")
  } finally {
    db.close()
  }
})

test("attachDbSync does NOT call onItemColumnChanged for failed run_finished (non-authoritative)", () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "test", name: "Test" })
  const item = repos.createItem({ workspaceId: ws.id, title: "T", description: "D" })
  const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "T" })
  const { bus } = makeBusIO()
  const calls: Array<unknown> = []

  try {
    attachDbSync(bus, repos, { runId: run.id, itemId: item.id }, {
      onItemColumnChanged: (payload) => calls.push(payload),
    })
    bus.emit({ type: "run_finished", runId: run.id, itemId: item.id, title: "T", status: "failed", error: "boom" })

    assert.equal(calls.length, 0, "failed run_finished must not trigger column-changed callback")
  } finally {
    db.close()
  }
})

test("attachDbSync does NOT call onItemColumnChanged when a sibling run is live (non-authoritative)", () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "test", name: "Test" })
  const item = repos.createItem({ workspaceId: ws.id, title: "T", description: "D" })
  // main run is live
  const main = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "Main" })
  repos.updateRun(main.id, { status: "running" })
  // side run starts — main is still live so side is non-authoritative
  const side = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "Side" })
  const { bus } = makeBusIO()
  const calls: Array<unknown> = []

  try {
    attachDbSync(bus, repos, { runId: side.id, itemId: item.id }, {
      onItemColumnChanged: (payload) => calls.push(payload),
    })
    bus.emit({ type: "stage_started", runId: side.id, stageRunId: "s1", stageKey: "brainstorm" })

    assert.equal(calls.length, 0, "non-authoritative run must not fire column-changed callback")
  } finally {
    db.close()
  }
})
