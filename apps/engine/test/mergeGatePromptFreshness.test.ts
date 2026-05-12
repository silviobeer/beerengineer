import { test } from "node:test"
import assert from "node:assert/strict"
import { spawn, type ChildProcess } from "node:child_process"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { createServer as createNetServer } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { getBoard } from "../src/api/board.js"
import { recordAnswer } from "../src/core/conversation.js"
import { writeRecoveryRecord } from "../src/core/recovery.js"
import { loadResumeReadiness } from "../src/core/resume.js"
import { layout } from "../src/core/workspaceLayout.js"
import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"

const TEST_API_TOKEN = "test-token"
const SERVER_PATH = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "src", "api", "server.ts")

type ServerHandle = {
  proc: ChildProcess
  base: string
}

async function reservePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createNetServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("failed to reserve port")))
        return
      }
      server.close(err => err ? reject(err) : resolvePort(address.port))
    })
  })
}

async function startServer(dbPath: string): Promise<ServerHandle> {
  const host = "127.0.0.1"
  const port = await reservePort()
  const proc = spawn(process.execPath, ["--import", "tsx", SERVER_PATH], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: host,
      BEERENGINEER_SEED: "0",
      BEERENGINEER_API_TOKEN: TEST_API_TOKEN,
      BEERENGINEER_UI_DB_PATH: dbPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  proc.stderr?.on("data", () => {})
  proc.stdout?.on("data", () => {})
  return { proc, base: `http://${host}:${port}` }
}

async function waitForHealth(base: string, timeoutMs = 5_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${base}/health`)
      if (res.ok) return
    } catch {}
    await new Promise(resolveTimer => setTimeout(resolveTimer, 100))
  }
  throw new Error(`server at ${base} did not become healthy in time`)
}

async function stopServer(proc: ChildProcess): Promise<void> {
  await new Promise<void>(resolveStop => {
    const killTimer = setTimeout(() => proc.kill("SIGKILL"), 1_500)
    killTimer.unref?.()
    if (proc.exitCode !== null) {
      clearTimeout(killTimer)
      resolveStop()
      return
    }
    proc.once("exit", () => {
      clearTimeout(killTimer)
      resolveStop()
    })
    proc.kill("SIGTERM")
  })
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return { "x-beerengineer-token": TEST_API_TOKEN, ...(extra ?? {}) }
}

function createTempDb(): { dir: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "be2-merge-gate-prompt-freshness-"))
  return { dir, dbPath: join(dir, "engine.sqlite") }
}

test("stale merge-gate prompts disappear from run and board surfaces and reject replayed answers", async () => {
  const { dir, dbPath } = createTempDb()
  const db = initDatabase(dbPath)
  const repos = new Repos(db)
  try {
    const workspaceRoot = join(dir, "repo")
    mkdirSync(workspaceRoot, { recursive: true })
    const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: workspaceRoot })
    const item = repos.createItem({ workspaceId: workspace.id, code: "ITEM-1000", title: "Fresh prompt view", description: "stale merge gate" })
    const run = repos.createRun({ workspaceId: workspace.id, itemId: item.id, title: item.title, owner: "api" })
    const mergeStage = repos.createStageRun({ runId: run.id, stageKey: "merge-gate" })
    const prompt = repos.createPendingPrompt({
      id: "prompt-stale-merge",
      runId: run.id,
      stageRunId: mergeStage.id,
      prompt: "Promote ITEM-1000 into master?",
      actions: [
        { label: "Promote", value: "promote" },
        { label: "Cancel", value: "cancel" },
      ],
    })
    repos.appendLog({
      runId: run.id,
      stageRunId: mergeStage.id,
      eventType: "prompt_requested",
      message: prompt.prompt,
      data: { promptId: prompt.id, actions: [{ label: "Promote", value: "promote" }, { label: "Cancel", value: "cancel" }] },
    })
    repos.updateRun(run.id, { status: "completed", current_stage: null })

    assert.equal(repos.getOpenPrompt(run.id), undefined)
    const card = getBoard(db, workspace.key).columns.flatMap(column => column.cards).find(candidate => candidate.itemId === item.id)
    assert.equal(card?.hasOpenPrompt, false)

    db.close()
    const { proc, base } = await startServer(dbPath)
    try {
      await waitForHealth(base)

      const runRes = await fetch(`${base}/runs/${run.id}`)
      assert.equal(runRes.status, 200)
      const runBody = await runRes.json() as { status: string; openPrompt: null | { promptId: string } }
      assert.equal(runBody.status, "completed")
      assert.equal(runBody.openPrompt, null)

      const answerRes = await fetch(`${base}/runs/${run.id}/answer`, {
        method: "POST",
        headers: authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ promptId: prompt.id, answer: "promote" }),
      })
      assert.equal(answerRes.status, 409)
      const answerBody = await answerRes.json() as { code: string; error: string }
      assert.equal(answerBody.code, "prompt_not_open")
      assert.equal(answerBody.error, "prompt_not_open")

      const runAgainRes = await fetch(`${base}/runs/${run.id}`)
      assert.equal(runAgainRes.status, 200)
      const runAgainBody = await runAgainRes.json() as { openPrompt: null | { promptId: string } }
      assert.equal(runAgainBody.openPrompt, null)
    } finally {
      await stopServer(proc)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("stale merge-gate prompts no longer block resume readiness when another blocker is current", async () => {
  const { dir, dbPath } = createTempDb()
  const db = initDatabase(dbPath)
  const repos = new Repos(db)
  try {
    const workspaceRoot = join(dir, "repo")
    mkdirSync(workspaceRoot, { recursive: true })
    const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: workspaceRoot })
    const item = repos.createItem({ workspaceId: workspace.id, code: "ITEM-1001", title: "Resume stale merge prompt", description: "resume" })
    const run = repos.createRun({
      workspaceId: workspace.id,
      itemId: item.id,
      title: item.title,
      owner: "api",
      workspaceFsId: "resume-stale-merge",
    })
    const ctx = { workspaceId: "resume-stale-merge", workspaceRoot, runId: run.id }
    mkdirSync(layout.runDir(ctx), { recursive: true })
    await writeFile(layout.runFile(ctx), `${JSON.stringify({ id: run.id }, null, 2)}\n`)
    await writeRecoveryRecord(ctx, {
      status: "blocked",
      cause: "stage_error",
      scope: { type: "stage", runId: run.id, stageId: "requirements" },
      summary: "Need operator input for requirements.",
      evidencePaths: [],
    })
    repos.setRunRecovery(run.id, {
      status: "blocked",
      scope: "stage",
      scopeRef: "requirements",
      summary: "Need operator input for requirements.",
    })
    repos.updateRun(run.id, { status: "blocked", current_stage: "requirements" })

    const mergeStage = repos.createStageRun({ runId: run.id, stageKey: "merge-gate" })
    const prompt = repos.createPendingPrompt({
      id: "prompt-obsolete-merge",
      runId: run.id,
      stageRunId: mergeStage.id,
      prompt: "Promote ITEM-1001 into master?",
      actions: [
        { label: "Promote", value: "promote" },
        { label: "Cancel", value: "cancel" },
      ],
    })
    repos.appendLog({
      runId: run.id,
      stageRunId: mergeStage.id,
      eventType: "prompt_requested",
      message: prompt.prompt,
      data: { promptId: prompt.id },
    })

    assert.equal(repos.getOpenPrompt(run.id), undefined)
    const readiness = await loadResumeReadiness(repos, run.id)
    assert.equal(readiness.kind, "ready")
    if (readiness.kind === "ready") {
      assert.equal(readiness.run.id, run.id)
      assert.equal(readiness.record.scope.type, "stage")
      assert.equal(readiness.record.scope.stageId, "requirements")
    }

    const card = getBoard(db, workspace.key).columns.flatMap(column => column.cards).find(candidate => candidate.itemId === item.id)
    assert.equal(card?.hasOpenPrompt, false)
    assert.equal(repos.listOpenPrompts({ workspaceId: workspace.id }).length, 0)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("only the current actionable merge-gate prompt remains answerable when older merge prompts exist", () => {
  const { dir, dbPath } = createTempDb()
  const db = initDatabase(dbPath)
  const repos = new Repos(db)
  try {
    const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: join(dir, "repo") })
    const item = repos.createItem({ workspaceId: workspace.id, code: "ITEM-1002", title: "Current merge prompt only", description: "merge" })
    const run = repos.createRun({ workspaceId: workspace.id, itemId: item.id, title: item.title, owner: "api" })
    repos.setRunRecovery(run.id, {
      status: "blocked",
      scope: "stage",
      scopeRef: "merge-gate",
      summary: "Waiting for merge promotion.",
    })
    repos.updateRun(run.id, { status: "blocked", current_stage: "merge-gate" })

    const olderStage = repos.createStageRun({ runId: run.id, stageKey: "merge-gate" })
    const olderPrompt = repos.createPendingPrompt({
      id: "prompt-merge-old",
      runId: run.id,
      stageRunId: olderStage.id,
      prompt: "Promote the earlier branch?",
      actions: [
        { label: "Promote", value: "promote" },
        { label: "Cancel", value: "cancel" },
      ],
    })
    repos.appendLog({
      runId: run.id,
      stageRunId: olderStage.id,
      eventType: "prompt_requested",
      message: olderPrompt.prompt,
      data: { promptId: olderPrompt.id },
    })

    const currentStage = repos.createStageRun({ runId: run.id, stageKey: "merge-gate" })
    const currentPrompt = repos.createPendingPrompt({
      id: "prompt-merge-current",
      runId: run.id,
      stageRunId: currentStage.id,
      prompt: "Promote ITEM-1002 into master?",
      actions: [
        { label: "Promote", value: "promote" },
        { label: "Cancel", value: "cancel" },
      ],
    })
    repos.appendLog({
      runId: run.id,
      stageRunId: currentStage.id,
      eventType: "prompt_requested",
      message: currentPrompt.prompt,
      data: { promptId: currentPrompt.id },
    })
    db.prepare("UPDATE pending_prompts SET created_at = ? WHERE id = ?").run(1, olderPrompt.id)
    db.prepare("UPDATE pending_prompts SET created_at = ? WHERE id = ?").run(2, currentPrompt.id)

    assert.equal(repos.getOpenPrompt(run.id)?.id, currentPrompt.id)
    const openPrompts = repos.listOpenPrompts({ workspaceId: workspace.id })
    assert.equal(openPrompts.length, 1)
    assert.equal(openPrompts[0]?.id, currentPrompt.id)

    const staleReplay = recordAnswer(repos, {
      runId: run.id,
      promptId: olderPrompt.id,
      answer: "promote",
      source: "api",
    })
    assert.equal(staleReplay.ok, false)
    assert.equal(repos.getPendingPrompt(olderPrompt.id)?.answer, null)
    assert.equal(repos.getOpenPrompt(run.id)?.id, currentPrompt.id)

    const currentAnswer = recordAnswer(repos, {
      runId: run.id,
      promptId: currentPrompt.id,
      answer: "cancel",
      source: "api",
    })
    assert.equal(currentAnswer.ok, true)
    assert.equal(repos.getPendingPrompt(currentPrompt.id)?.answer, "cancel")
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
