import { test } from "node:test"
import assert from "node:assert/strict"
import { PassThrough } from "node:stream"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createBus } from "../src/core/bus.js"
import { attachHumanCliRenderer } from "../src/core/renderers/humanCli.js"
import { attachNdjsonRenderer } from "../src/core/renderers/ndjson.js"
import { withPromptPersistence } from "../src/core/promptPersistence.js"
import { attachCrossProcessBridge } from "../src/core/crossProcessBridge.js"
import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import type { WorkflowEvent } from "../src/core/io.js"

function tmpDb() {
  const dir = mkdtempSync(join(tmpdir(), "be2-bus-"))
  return initDatabase(join(dir, "bus.sqlite"))
}

test("bus: subscribers see every emitted event", () => {
  const bus = createBus()
  const seen: WorkflowEvent[] = []
  const unsub = bus.subscribe(e => { seen.push(e) })
  bus.emit({ type: "log", runId: "r1", message: "hello" })
  bus.emit({ type: "log", runId: "r1", message: "world" })
  assert.equal(seen.length, 2)
  assert.equal(seen[0].type, "log")
  unsub()
  bus.emit({ type: "log", runId: "r1", message: "ignored" })
  assert.equal(seen.length, 2)
  bus.close()
})

test("bus: prompt_answered emission resolves a pending request", async () => {
  const bus = createBus()
  const promise = bus.request("Q?", { promptId: "p-1", runId: "r1" })
  bus.emit({ type: "prompt_answered", runId: "r1", promptId: "p-1", answer: "A!" })
  const answer = await promise
  assert.equal(answer, "A!")
  bus.close()
})

test("humanCli renderer formats presentation + chat_message events", () => {
  const bus = createBus()
  const out = new PassThrough()
  const chunks: string[] = []
  out.on("data", c => chunks.push(String(c)))
  attachHumanCliRenderer(bus, { stream: out })
  bus.emit({ type: "presentation", kind: "header", text: "brainstorm" })
  bus.emit({ type: "chat_message", runId: "r1", role: "LLM-1", source: "stage-agent", text: "hi" })
  bus.emit({ type: "presentation", kind: "ok", text: "done" })
  const joined = chunks.join("")
  assert.match(joined, /BRAINSTORM/)
  assert.match(joined, /\[LLM-1\]/)
  assert.match(joined, /done/)
  bus.close()
})

test("ndjson renderer emits one JSON line per event and parses prompt_answered from stdin", async () => {
  const bus = createBus()
  const out = new PassThrough()
  const input = new PassThrough()
  const chunks: string[] = []
  out.on("data", c => chunks.push(String(c)))
  attachNdjsonRenderer(bus, { out, in: input })

  const promise = bus.request("Q?", { promptId: "p-1", runId: "r1" })
  // simulate harness writing an answer line
  input.write(`${JSON.stringify({ type: "prompt_answered", promptId: "p-1", answer: "hi" })}\n`)
  const answer = await promise
  assert.equal(answer, "hi")

  // every line should parse as JSON with a `type`
  const lines = chunks.join("").split("\n").filter(Boolean)
  assert.ok(lines.length > 0)
  for (const line of lines) {
    const obj = JSON.parse(line)
    assert.ok(typeof obj.type === "string")
  }
  bus.close()
})

test("withPromptPersistence: creates and answers rows via bus events", () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "t", name: "T" })
  const item = repos.createItem({ workspaceId: ws.id, title: "T", description: "D" })
  const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "T" })
  const bus = createBus()
  withPromptPersistence(bus, repos)

  bus.emit({ type: "prompt_requested", runId: run.id, promptId: "p-42", prompt: "q?" })
  const row = repos.getPendingPrompt("p-42")
  assert.ok(row)
  assert.equal(row.answered_at, null)

  bus.emit({ type: "prompt_answered", runId: run.id, promptId: "p-42", answer: "a!" })
  const after = repos.getPendingPrompt("p-42")
  assert.equal(after?.answer, "a!")
  assert.ok(after?.answered_at !== null)
  bus.close()
  db.close()
})

test("withPromptPersistence stores prompt actions", () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "t", name: "T" })
  const item = repos.createItem({ workspaceId: ws.id, title: "T", description: "D" })
  const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "T" })
  const bus = createBus()
  withPromptPersistence(bus, repos)

  bus.emit({
    type: "prompt_requested",
    runId: run.id,
    promptId: "p-actions",
    prompt: "Promote this item?",
    actions: [
      { label: "Promote", value: "promote" },
      { label: "Cancel", value: "cancel" },
    ],
  })

  const row = repos.getPendingPrompt("p-actions")
  assert.ok(row?.actions_json)
  assert.match(row.actions_json ?? "", /promote/)
  assert.match(row.actions_json ?? "", /cancel/)
  bus.close()
  db.close()
})

test("withPromptPersistence stores stageRunId for stage-scoped prompts", () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "t", name: "T" })
  const item = repos.createItem({ workspaceId: ws.id, title: "T", description: "D" })
  const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "T" })
  repos.createStageRun({ id: "stage-1", runId: run.id, stageKey: "requirements" })
  const bus = createBus()
  withPromptPersistence(bus, repos)

  bus.emit({ type: "prompt_requested", runId: run.id, stageRunId: "stage-1", promptId: "p-43", prompt: "q?" })

  const row = repos.getPendingPrompt("p-43")
  assert.equal(row?.stage_run_id, "stage-1")
  bus.close()
  db.close()
})

test("withPromptPersistence ignores prompt requests for unknown runs", () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const bus = createBus()
  withPromptPersistence(bus, repos)

  assert.doesNotThrow(() => {
    bus.emit({ type: "prompt_requested", runId: "no-run", promptId: "p-44", prompt: "q?" })
  })
  assert.equal(repos.getPendingPrompt("p-44"), undefined)
  bus.close()
  db.close()
})

test("crossProcessBridge re-emits foreign prompt_answered rows onto the local bus", async () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "t", name: "T" })
  const item = repos.createItem({ workspaceId: ws.id, title: "T", description: "D" })
  const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "T" })
  const bus = createBus()
  const writtenLogIds = new Set<string>()
  const detach = attachCrossProcessBridge(bus, repos, run.id, { writtenLogIds, intervalMs: 20 })

  const seen: WorkflowEvent[] = []
  bus.subscribe(e => seen.push(e))

  // Simulate another process writing a `prompt_answered` row into stage_logs.
  await new Promise(r => setTimeout(r, 10))
  repos.appendLog({
    runId: run.id,
    eventType: "prompt_answered",
    message: "remote-answer",
    data: { promptId: "p-cross", source: "api" },
  })

  // Wait long enough for the bridge to poll and re-emit.
  await new Promise(r => setTimeout(r, 80))
  detach()

  const match = seen.find(
    e => e.type === "prompt_answered" && (e as { promptId?: string }).promptId === "p-cross",
  )
  assert.ok(match, "expected the bridge to re-emit prompt_answered for the foreign log row")
  assert.equal((match as { answer?: string }).answer, "remote-answer")
  bus.close()
  db.close()
})

test("crossProcessBridge skips log rows that were written locally", async () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "t", name: "T" })
  const item = repos.createItem({ workspaceId: ws.id, title: "T", description: "D" })
  const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "T" })
  const bus = createBus()
  const writtenLogIds = new Set<string>()
  const detach = attachCrossProcessBridge(bus, repos, run.id, { writtenLogIds, intervalMs: 20 })

  const reEmitted: WorkflowEvent[] = []
  bus.subscribe(e => {
    if (e.type === "prompt_answered") reEmitted.push(e)
  })

  // Simulate the local process writing the log and registering the row id
  // as "ours" — the bridge must not re-emit it.
  await new Promise(r => setTimeout(r, 10))
  const ownRow = repos.appendLog({
    runId: run.id,
    eventType: "prompt_answered",
    message: "local-answer",
    data: { promptId: "p-local" },
  })
  writtenLogIds.add(ownRow.id)

  await new Promise(r => setTimeout(r, 80))
  detach()

  const match = reEmitted.find(
    e => (e as { promptId?: string }).promptId === "p-local",
  )
  assert.equal(match, undefined, "locally-written rows must not be re-emitted (would infinite-loop)")
  bus.close()
  db.close()
})
