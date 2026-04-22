/**
 * CLI ↔ UI interop tests.
 *
 * These are the load-bearing tests for the shared-transport model: every
 * scenario a user hits in practice — start a run in the CLI, answer its
 * prompts from the UI, watch progress stream back to the browser — is
 * exercised end-to-end against the real bus + DB primitives (no HTTP layer;
 * the HTTP handlers are thin shells over these same primitives).
 *
 * The invariants these tests lock:
 *   1. A CLI-owned run's `ask()` resolves when the API writes a
 *      `prompt_answered` stage_log row (cross-process push).
 *   2. The CLI's own writes do NOT loop back through its bridge.
 *   3. `chat_message` + `presentation` events survive refresh/reconnect
 *      because they are persisted in `stage_logs`.
 *   4. The SSE stream tails `stage_logs` as a single source; every client
 *      sees the same sequence regardless of whether the emitting process
 *      was the API or the CLI.
 *   5. Prompt persistence is idempotent across re-emits.
 *   6. Event ordering matches emission order on a single bus.
 *   7. No session-in-this-process: POST /runs/:id/input still routes the
 *      answer via the DB (shared transport), and the CLI picks it up.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { initDatabase, type Db } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { createBus } from "../src/core/bus.js"
import { createCliIO } from "../src/core/ioCli.js"
import { createApiIOSession } from "../src/core/ioApi.js"
import { attachDbSync } from "../src/core/runOrchestrator.js"
import { attachCrossProcessBridge } from "../src/core/crossProcessBridge.js"
import { withPromptPersistence } from "../src/core/promptPersistence.js"
import { runWithWorkflowIO } from "../src/core/io.js"
import { runWithActiveRun } from "../src/core/runContext.js"
import type { WorkflowEvent } from "../src/core/io.js"
import type { RunRow } from "../src/db/repositories.js"

// ---------------------------------------------------------------------------
// Shared fixtures: a throwaway DB + a seeded workspace/item/run.
// ---------------------------------------------------------------------------
type Fixture = {
  db: Db
  repos: Repos
  run: RunRow
  itemId: string
  workspaceId: string
  cleanup: () => void
}

function mkFixture(owner: "cli" | "api" = "cli"): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "be2-interop-"))
  const db = initDatabase(join(dir, "interop.sqlite"))
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "interop", name: "Interop" })
  const item = repos.createItem({ workspaceId: ws.id, title: "Interop item", description: "test" })
  const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "Interop run", owner })
  return {
    db,
    repos,
    run,
    itemId: item.id,
    workspaceId: ws.id,
    cleanup: () => {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

/** Simulates the API server's POST /runs/:id/input handler when no
 *  in-process session exists (i.e. the run is owned by another process,
 *  like the CLI). This is the code path under test — copied from the
 *  server's `handleRunInput` no-session branch — isolated so a test can
 *  call it without spinning up HTTP. */
function simulateApiAnswer(repos: Repos, runId: string, promptId: string, answer: string): void {
  const answered = repos.answerPendingPrompt(promptId, answer)
  if (!answered) throw new Error("prompt not pending")
  repos.appendLog({
    runId,
    eventType: "prompt_answered",
    message: answer,
    data: { promptId, source: "api" },
  })
}

function settle(ms = 40): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

// ---------------------------------------------------------------------------
// 1. CLI-owned run: external answer from API resolves CLI's ask().
// ---------------------------------------------------------------------------
test("interop: CLI ask() resolves when API writes prompt_answered to stage_logs", async () => {
  const fx = mkFixture("cli")
  try {
    const io = createCliIO(fx.repos, {
      externalPromptResolver: true,
      renderer: () => () => {},
    })
    const writtenLogIds = new Set<string>()
    const detachDbSync = attachDbSync(
      io.bus,
      fx.repos,
      { runId: fx.run.id, itemId: fx.itemId },
      { writtenLogIds },
    )
    const detachBridge = attachCrossProcessBridge(
      io.bus,
      fx.repos,
      fx.run.id,
      { writtenLogIds, intervalMs: 20 },
    )

    await runWithWorkflowIO(io, async () =>
      runWithActiveRun({ runId: fx.run.id, itemId: fx.itemId }, async () => {
        const promptPromise = io.ask("What's the goal?")

        // Wait for prompt_requested to be persisted into pending_prompts by
        // withPromptPersistence.
        let pending = fx.repos.getOpenPrompt(fx.run.id)
        for (let i = 0; i < 50 && !pending; i++) {
          await settle(10)
          pending = fx.repos.getOpenPrompt(fx.run.id)
        }
        assert.ok(pending, "pending prompt must be persisted before UI can answer")

        // Simulate the API server handling a POST /runs/:id/input from the
        // UI — this is the exact code path used for CLI-owned runs.
        simulateApiAnswer(fx.repos, fx.run.id, pending.id, "ship it")

        const answer = await promptPromise
        assert.equal(answer, "ship it")
      }),
    )

    detachBridge()
    detachDbSync()
    io.close?.()
  } finally {
    fx.cleanup()
  }
})

// ---------------------------------------------------------------------------
// 2. No feedback loop: CLI's own writes are filtered out of its bridge.
// ---------------------------------------------------------------------------
test("interop: CLI's own prompt_answered writes do NOT loop back through the bridge", async () => {
  const fx = mkFixture("cli")
  try {
    const io = createCliIO(fx.repos, {
      externalPromptResolver: true,
      renderer: () => () => {},
    })
    const writtenLogIds = new Set<string>()
    attachDbSync(io.bus, fx.repos, { runId: fx.run.id, itemId: fx.itemId }, { writtenLogIds })
    const detachBridge = attachCrossProcessBridge(
      io.bus,
      fx.repos,
      fx.run.id,
      { writtenLogIds, intervalMs: 20 },
    )

    const reEmitCount = { n: 0 }
    io.bus.subscribe(e => { if (e.type === "prompt_answered") reEmitCount.n++ })

    await runWithWorkflowIO(io, async () =>
      runWithActiveRun({ runId: fx.run.id, itemId: fx.itemId }, async () => {
        const p = io.ask("q?")
        let pending = fx.repos.getOpenPrompt(fx.run.id)
        for (let i = 0; i < 50 && !pending; i++) {
          await settle(10)
          pending = fx.repos.getOpenPrompt(fx.run.id)
        }
        // Answer locally via the bus — attachDbSync will write this as a
        // prompt_answered row with id in writtenLogIds. The bridge MUST skip
        // that row.
        io.bus.emit({ type: "prompt_answered", runId: fx.run.id, promptId: pending!.id, answer: "local" })
        await p
        // Give the bridge a few poll cycles to (wrongly) re-emit if it's
        // broken — the assertion below catches the loop.
        await settle(80)
      }),
    )

    // Exactly one prompt_answered reached the subscriber: the local emit.
    // If the bridge had re-emitted, we'd see >= 2.
    assert.equal(reEmitCount.n, 1, "bridge must not re-emit locally-written prompt_answered rows")

    detachBridge()
    io.close?.()
  } finally {
    fx.cleanup()
  }
})

// ---------------------------------------------------------------------------
// 3. chat_message and presentation survive reconnect (via stage_logs).
// ---------------------------------------------------------------------------
test("interop: chat_message and presentation are replay-able from stage_logs", async () => {
  const fx = mkFixture("cli")
  try {
    const io = createCliIO(fx.repos, {
      externalPromptResolver: true,
      renderer: () => () => {},
    })
    attachDbSync(io.bus, fx.repos, { runId: fx.run.id, itemId: fx.itemId })
    fx.repos.createStageRun({ id: "stage-brainstorm", runId: fx.run.id, stageKey: "brainstorm" })

    await runWithWorkflowIO(io, async () =>
      runWithActiveRun({ runId: fx.run.id, itemId: fx.itemId, stageRunId: "stage-brainstorm" }, async () => {
        io.bus.emit({
          type: "chat_message",
          runId: fx.run.id,
          stageRunId: "stage-brainstorm",
          role: "LLM-1 (Brainstorm)",
          source: "stage-agent",
          text: "What problem should the product solve?",
          requiresResponse: true,
        })
        io.bus.emit({
          type: "presentation",
          runId: fx.run.id,
          stageRunId: "stage-brainstorm",
          kind: "header",
          text: "brainstorm",
        })
      }),
    )

    // Simulate a late-joining UI opening SSE: it reads stage_logs from 0.
    const replay = fx.repos.listLogsForRun(fx.run.id)
    const chat = replay.find(l => l.event_type === "chat_message")
    const presentation = replay.find(l => l.event_type === "presentation")
    assert.ok(chat, "chat_message must be persisted")
    assert.ok(presentation, "presentation must be persisted")
    assert.ok(chat!.data_json?.includes("\"role\":\"LLM-1 (Brainstorm)\""))
    assert.ok(presentation!.data_json?.includes("\"kind\":\"header\""))

    io.close?.()
  } finally {
    fx.cleanup()
  }
})

// ---------------------------------------------------------------------------
// 4. Event ordering: the order in which subscribers see events matches
//    the emission order, and stage_logs preserves it too.
// ---------------------------------------------------------------------------
test("interop: event ordering is preserved on the bus AND in stage_logs", async () => {
  const fx = mkFixture("cli")
  try {
    const bus = createBus()
    attachDbSync(bus, fx.repos, { runId: fx.run.id, itemId: fx.itemId })

    const seenOrder: string[] = []
    bus.subscribe(e => {
      if (e.type === "chat_message") seenOrder.push(`chat:${e.text}`)
      if (e.type === "log") seenOrder.push(`log:${e.message}`)
    })

    // Emissions with small delays to guarantee monotonic created_at so the
    // DB order check is robust against the `now()` millisecond granularity.
    bus.emit({ type: "log", runId: fx.run.id, message: "one" })
    await settle(3)
    bus.emit({ type: "chat_message", runId: fx.run.id, role: "A", source: "stage-agent", text: "two" })
    await settle(3)
    bus.emit({ type: "log", runId: fx.run.id, message: "three" })

    // Bus subscribers see events synchronously in emission order.
    assert.deepEqual(seenOrder, ["log:one", "chat:two", "log:three"])

    // stage_logs preserves the same order via (created_at, rowid).
    const logs = fx.repos
      .listLogsForRun(fx.run.id)
      .filter(l => l.event_type === "chat_message" || l.event_type === "log")
    assert.deepEqual(
      logs.map(l => `${l.event_type === "chat_message" ? "chat" : "log"}:${l.message}`),
      ["log:one", "chat:two", "log:three"],
    )

    bus.close()
  } finally {
    fx.cleanup()
  }
})

// ---------------------------------------------------------------------------
// 5. Full round-trip: CLI emits stage events while UI "streams" via the
//    stage_logs tail. Proves the API-server's SSE handler model works for
//    CLI-owned runs without an in-memory session.
// ---------------------------------------------------------------------------
test("interop: UI tail of stage_logs sees a CLI-owned run's full event sequence", async () => {
  const fx = mkFixture("cli")
  try {
    const io = createCliIO(fx.repos, {
      externalPromptResolver: true,
      renderer: () => () => {},
    })
    attachDbSync(io.bus, fx.repos, { runId: fx.run.id, itemId: fx.itemId })

    // "UI" side: a poller that mimics what handleEvents does.
    const uiSeen: Array<{ type: string; message: string }> = []
    let cursor = 0
    let poller: ReturnType<typeof setInterval> | null = null
    const startPoller = () => {
      poller = setInterval(() => {
        for (const row of fx.repos.listLogsForRun(fx.run.id, cursor)) {
          cursor = Math.max(cursor, row.created_at + 1)
          uiSeen.push({ type: row.event_type, message: row.message })
        }
      }, 20)
    }

    startPoller()

    await runWithWorkflowIO(io, async () =>
      runWithActiveRun({ runId: fx.run.id, itemId: fx.itemId }, async () => {
        io.bus.emit({ type: "run_started", runId: fx.run.id, itemId: fx.itemId, title: "Interop run" })
        io.bus.emit({ type: "stage_started", runId: fx.run.id, stageRunId: "s1", stageKey: "brainstorm" })
        io.bus.emit({
          type: "chat_message",
          runId: fx.run.id,
          stageRunId: "s1",
          role: "LLM-1",
          source: "stage-agent",
          text: "Q1",
        })
        io.bus.emit({ type: "stage_completed", runId: fx.run.id, stageRunId: "s1", stageKey: "brainstorm", status: "completed" })
        io.bus.emit({ type: "run_finished", runId: fx.run.id, status: "completed" })
      }),
    )

    // Give the UI poller time to catch up.
    await settle(80)
    if (poller) clearInterval(poller)

    const types = uiSeen.map(e => e.type)
    assert.ok(types.includes("stage_started"), `expected stage_started, saw: ${types.join(",")}`)
    assert.ok(types.includes("chat_message"))
    assert.ok(types.includes("stage_completed"))
    assert.ok(types.includes("run_finished"))

    // Sequence: stage_started precedes stage_completed precedes run_finished.
    const idxStart = types.indexOf("stage_started")
    const idxDone = types.indexOf("stage_completed")
    const idxRun = types.indexOf("run_finished")
    assert.ok(idxStart < idxDone && idxDone < idxRun, "sequence must preserve causal order")

    io.close?.()
  } finally {
    fx.cleanup()
  }
})

// ---------------------------------------------------------------------------
// 6. API session path: UI answers an API-owned prompt via session.answerPrompt.
// ---------------------------------------------------------------------------
test("interop: API-owned run resolves via session.answerPrompt (in-memory)", async () => {
  const fx = mkFixture("api")
  try {
    const session = createApiIOSession(fx.repos)
    attachDbSync(session.bus, fx.repos, { runId: fx.run.id, itemId: fx.itemId })

    await runWithWorkflowIO(session.io, async () =>
      runWithActiveRun({ runId: fx.run.id, itemId: fx.itemId }, async () => {
        const promptPromise = session.io.ask("API q?")
        let pending = fx.repos.getOpenPrompt(fx.run.id)
        for (let i = 0; i < 50 && !pending; i++) {
          await settle(5)
          pending = fx.repos.getOpenPrompt(fx.run.id)
        }
        assert.ok(pending)
        assert.equal(session.answerPrompt(pending.id, "ok"), true)
        const answer = await promptPromise
        assert.equal(answer, "ok")
      }),
    )

    // The answer flowed as a prompt_answered event on the bus and got
    // persisted by attachDbSync.
    const logs = fx.repos.listLogsForRun(fx.run.id)
    assert.ok(logs.some(l => l.event_type === "prompt_requested"))
    assert.ok(logs.some(l => l.event_type === "prompt_answered"))
    session.dispose()
  } finally {
    fx.cleanup()
  }
})

// ---------------------------------------------------------------------------
// 7. Idempotence: re-submitting a prompt_requested does not duplicate rows.
// ---------------------------------------------------------------------------
test("interop: re-emitting prompt_requested is idempotent on pending_prompts", () => {
  const fx = mkFixture("cli")
  try {
    const bus = createBus()
    // Attach persistence manually — we're testing withPromptPersistence directly.
    withPromptPersistence(bus, fx.repos)

    bus.emit({ type: "prompt_requested", runId: fx.run.id, promptId: "p-dup", prompt: "q?" })
    bus.emit({ type: "prompt_requested", runId: fx.run.id, promptId: "p-dup", prompt: "q?" })
    bus.emit({ type: "prompt_requested", runId: fx.run.id, promptId: "p-dup", prompt: "q?" })

    const rows = fx.db
      .prepare("SELECT COUNT(*) as c FROM pending_prompts WHERE id = ?")
      .get("p-dup") as { c: number }
    assert.equal(rows.c, 1, "pending_prompts must not duplicate on re-emit")
    bus.close()
  } finally {
    fx.cleanup()
  }
})

// ---------------------------------------------------------------------------
// 8. Bridge only starts emitting from attach-time forward (no historical replay).
// ---------------------------------------------------------------------------
test("interop: crossProcessBridge does NOT re-emit historical rows from before attach", async () => {
  const fx = mkFixture("cli")
  try {
    // Seed a historical prompt_answered BEFORE the bridge attaches. If the
    // bridge replayed history, the local bus would see this event.
    fx.repos.appendLog({
      runId: fx.run.id,
      eventType: "prompt_answered",
      message: "historical",
      data: { promptId: "p-historical" },
    })

    await settle(5)

    const bus = createBus()
    const writtenLogIds = new Set<string>()
    const detach = attachCrossProcessBridge(bus, fx.repos, fx.run.id, {
      writtenLogIds,
      intervalMs: 15,
    })

    const seen: WorkflowEvent[] = []
    bus.subscribe(e => seen.push(e))

    await settle(80)
    detach()

    const replayed = seen.find(
      e => e.type === "prompt_answered" && (e as { promptId?: string }).promptId === "p-historical",
    )
    assert.equal(replayed, undefined, "bridge must not surface rows that predate its attach time")
    bus.close()
  } finally {
    fx.cleanup()
  }
})

// ---------------------------------------------------------------------------
// 9. Bridge delivers multiple foreign answers in order.
// ---------------------------------------------------------------------------
test("interop: multiple foreign prompt_answered rows are delivered in order", async () => {
  const fx = mkFixture("cli")
  try {
    const bus = createBus()
    const writtenLogIds = new Set<string>()
    const detach = attachCrossProcessBridge(bus, fx.repos, fx.run.id, {
      writtenLogIds,
      intervalMs: 10,
    })

    const answers: string[] = []
    bus.subscribe(e => {
      if (e.type === "prompt_answered") answers.push(e.answer)
    })

    await settle(5)

    for (let i = 0; i < 5; i++) {
      fx.repos.appendLog({
        runId: fx.run.id,
        eventType: "prompt_answered",
        message: `answer-${i}`,
        data: { promptId: `p-${i}` },
      })
      // Small delay to guarantee monotonically increasing created_at+id.
      await settle(2)
    }

    await settle(80)
    detach()
    bus.close()

    assert.deepEqual(answers, ["answer-0", "answer-1", "answer-2", "answer-3", "answer-4"])
  } finally {
    fx.cleanup()
  }
})

// ---------------------------------------------------------------------------
// 10. Smoke: a CLI run can ask *several* prompts that are all answered by
//     the API, end-to-end, without any poller in the CLI process (only the
//     shared-transport bridge).
// ---------------------------------------------------------------------------
test("interop: CLI resolves a sequence of 3 prompts answered by an external writer", async () => {
  const fx = mkFixture("cli")
  try {
    const io = createCliIO(fx.repos, {
      externalPromptResolver: true,
      renderer: () => () => {},
    })
    const writtenLogIds = new Set<string>()
    attachDbSync(io.bus, fx.repos, { runId: fx.run.id, itemId: fx.itemId }, { writtenLogIds })
    const detachBridge = attachCrossProcessBridge(
      io.bus,
      fx.repos,
      fx.run.id,
      { writtenLogIds, intervalMs: 15 },
    )

    await runWithWorkflowIO(io, async () =>
      runWithActiveRun({ runId: fx.run.id, itemId: fx.itemId }, async () => {
        for (let i = 0; i < 3; i++) {
          const p = io.ask(`Q${i}`)

          let pending = fx.repos.getOpenPrompt(fx.run.id)
          for (let j = 0; j < 50 && !pending; j++) {
            await settle(5)
            pending = fx.repos.getOpenPrompt(fx.run.id)
          }
          assert.ok(pending, `prompt ${i} must be persisted`)

          simulateApiAnswer(fx.repos, fx.run.id, pending.id, `A${i}`)
          const answer = await p
          assert.equal(answer, `A${i}`, `answer ${i} must match`)
        }
      }),
    )

    detachBridge()
    io.close?.()
  } finally {
    fx.cleanup()
  }
})
