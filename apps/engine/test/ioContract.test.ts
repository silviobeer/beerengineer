import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { WorkflowIO } from "../src/core/io.js"
import { createApiIOSession } from "../src/core/ioApi.js"
import { createCliIO } from "../src/core/ioCli.js"
import { attachCrossProcessBridge } from "../src/core/crossProcessBridge.js"
import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"

/**
 * Contract test: `ioApi` and `ioCli` must both satisfy the WorkflowIO shape
 * the orchestrator depends on. A drift between adapters causes one surface to
 * silently fail at runtime — the contract check locks the obligations.
 */

const REQUIRED_METHODS = ["ask", "emit"] as const

function tmpDb() {
  const dir = mkdtempSync(join(tmpdir(), "be2-iocontract-"))
  return initDatabase(join(dir, "test.sqlite"))
}

function assertSatisfiesWorkflowIO(io: WorkflowIO, label: string): void {
  for (const method of REQUIRED_METHODS) {
    assert.equal(typeof io[method], "function", `${label} missing ${method}`)
  }
  // `close` is optional but, if present, must be a function.
  if (io.close !== undefined) {
    assert.equal(typeof io.close, "function", `${label} close must be a function`)
  }
}

test("ioApi satisfies WorkflowIO contract", () => {
  const db = tmpDb()
  const repos = new Repos(db)
  try {
    const session = createApiIOSession(repos)
    assertSatisfiesWorkflowIO(session.io, "ioApi")
    session.dispose()
  } finally {
    db.close()
  }
})

test("ioCli satisfies WorkflowIO contract", () => {
  const io = createCliIO()
  try {
    assertSatisfiesWorkflowIO(io, "ioCli")
  } finally {
    io.close?.()
  }
})

test("ioCli with repos argument still satisfies contract and does not persist bootstrap prompts", async () => {
  const db = tmpDb()
  const repos = new Repos(db)
  try {
    const io = createCliIO(repos, {
      externalPromptResolver: true,
      renderer: () => () => {},
    })
    assertSatisfiesWorkflowIO(io, "ioCli(repos)")
    let promptId = ""
    const unsubscribe = io.bus.subscribe(event => {
      if (event.type === "prompt_requested") {
        promptId = event.promptId
        io.bus.answer(event.promptId, "bootstrap-answer")
      }
    })
    const answer = await io.ask("bootstrap?")
    unsubscribe()

    assert.equal(answer, "bootstrap-answer")
    const rows = db.prepare("SELECT COUNT(*) as count FROM pending_prompts").get() as { count: number }
    assert.equal(rows.count, 0)
    assert.notEqual(promptId, "")
    io.close?.()
  } finally {
    db.close()
  }
})

test("crossProcessBridge resolves a CLI prompt from a foreign stage_log row", async () => {
  const db = tmpDb()
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "t", name: "T" })
  const item = repos.createItem({ workspaceId: ws.id, title: "T", description: "D" })
  const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "T", owner: "cli" })

  try {
    const io = createCliIO(repos, {
      externalPromptResolver: true,
      renderer: () => () => {},
    })
    // Simulate `prepareRun` wiring: the cross-process bridge is what re-emits
    // `prompt_answered` rows written by another process (e.g. the API server
    // when the UI POSTs an answer to `/runs/:id/answer`).
    const writtenLogIds = new Set<string>()
    const detachBridge = attachCrossProcessBridge(io.bus, repos, run.id, {
      writtenLogIds,
      intervalMs: 25,
    })

    let promptId = ""
    const unsubscribe = io.bus.subscribe(event => {
      if (event.type === "prompt_requested") {
        promptId = event.promptId
      }
    })
    const answerPromise = io.bus.request("question?", { runId: run.id })
    while (!promptId) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    // Simulate the API's shared-transport write: mark the pending prompt
    // answered AND emit the `prompt_answered` stage_log. The bridge tails
    // stage_logs, skips rows in `writtenLogIds`, and re-emits foreign rows
    // onto the local bus — which resolves the pending `bus.request()`.
    repos.answerPendingPrompt(promptId, "remote-answer")
    repos.appendLog({
      runId: run.id,
      eventType: "prompt_answered",
      message: "remote-answer",
      data: { promptId, source: "api" },
    })

    const answer = await answerPromise
    unsubscribe()
    detachBridge()
    io.close?.()

    assert.equal(answer, "remote-answer")
  } finally {
    db.close()
  }
})
