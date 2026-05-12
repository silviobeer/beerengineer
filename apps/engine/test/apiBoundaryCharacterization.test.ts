import assert from "node:assert/strict"
import { spawn, type ChildProcess } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { createServer as createNetServer } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"

const TEST_API_TOKEN = "test-token"

type ServerHandle = {
  proc: ChildProcess
  base: string
}

const TEST_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)))
const SERVER_PATH = resolve(TEST_DIR, "..", "src", "api", "server.ts")
const SERVER_START_RETRIES = 5

type BoardResponse = {
  workspaceKey: string | null
  columns: Array<{
    key: string
    title: string
    cards: Array<Record<string, unknown>>
  }>
  costRisk: {
    retainedBranchCount: number
    planLimitRatio: number
  }
}

async function reservePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createNetServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("failed to reserve port")))
        return
      }
      server.close(err => err ? reject(err) : resolve(address.port))
    })
  })
}

async function startServer(env: NodeJS.ProcessEnv, options?: { apiToken?: string | null }): Promise<ServerHandle> {
  const host = "127.0.0.1"
  let lastError: Error | null = null

  for (let attempt = 0; attempt < SERVER_START_RETRIES; attempt++) {
    const port = await reservePort()
    const childEnv = {
      ...process.env,
      ...env,
      PORT: String(port),
      HOST: host,
      BEERENGINEER_SEED: "0",
    }
    const apiToken = options?.apiToken === undefined ? TEST_API_TOKEN : options.apiToken
    if (apiToken) childEnv.BEERENGINEER_API_TOKEN = apiToken
    else delete childEnv.BEERENGINEER_API_TOKEN
    if (!("BEERENGINEER_PUBLIC_BASE_URL" in env)) delete childEnv.BEERENGINEER_PUBLIC_BASE_URL
    if (!("BEERENGINEER_PREVIEW_HOST" in env)) delete childEnv.BEERENGINEER_PREVIEW_HOST

    const proc = spawn(process.execPath, ["--import", "tsx", SERVER_PATH], {
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stderr = ""
    proc.stderr?.on("data", chunk => {
      stderr += chunk.toString()
    })
    proc.stdout?.on("data", () => {})

    const startup = await new Promise<"running" | "retry" | "failed">(resolve => {
      let settled = false
      const finish = (result: "running" | "retry" | "failed") => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(result)
      }
      const timer = setTimeout(() => finish("running"), 250)
      proc.once("exit", () => {
        finish(/EADDRINUSE/.test(stderr) ? "retry" : "failed")
      })
    })

    if (startup === "running") {
      return { proc, base: `http://${host}:${port}` }
    }
    if (startup === "retry") {
      lastError = new Error(`server port ${port} was claimed before bind`)
      continue
    }

    lastError = new Error(stderr.trim() || `server exited during startup on port ${port}`)
    break
  }

  throw lastError ?? new Error("failed to start test server")
}

async function waitForHealth(base: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${base}/health`)
      if (res.ok) return
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`server at ${base} did not become healthy in time`)
}

function stopServer(proc: ChildProcess): Promise<void> {
  return new Promise(resolve => {
    if (proc.exitCode !== null) return resolve()
    proc.once("exit", () => resolve())
    proc.kill("SIGTERM")
    setTimeout(() => proc.kill("SIGKILL"), 1500).unref?.()
  })
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return { "x-beerengineer-token": TEST_API_TOKEN, ...(extra ?? {}) }
}

function makeServerEnv(dir: string, dbPath: string, extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    BEERENGINEER_UI_DB_PATH: dbPath,
    BEERENGINEER_CONFIG_PATH: join(dir, "config.json"),
    BEERENGINEER_DATA_DIR: join(dir, "data"),
    ...(extra ?? {}),
  }
}

function sanitizeCard(card: Record<string, unknown>) {
  return {
    keys: Object.keys(card).sort(),
    itemCode: card.itemCode,
    itemId: card.itemId,
    title: card.title,
    summary: card.summary,
    column: card.column,
    phaseStatus: card.phaseStatus,
    currentStage: card.currentStage,
    hasOpenPrompt: card.hasOpenPrompt,
    hasReviewGateWaiting: card.hasReviewGateWaiting,
    hasBlockedRun: card.hasBlockedRun,
    supabaseBlocker: card.supabaseBlocker ?? null,
    recovery_user_message: card.recovery_user_message,
    latestRunId: card.latestRunId ?? null,
    workspaceId: card.workspaceId,
    workspaceRoot: card.workspaceRoot,
    supabaseProjectRef: card.supabaseProjectRef,
    dbRelevance: card.dbRelevance,
    supabaseBranch: card.supabaseBranch ?? null,
    meta: card.meta,
  }
}

function columnCards(board: BoardResponse): Record<string, Array<Record<string, unknown>>> {
  return Object.fromEntries(board.columns.map(column => [column.key, column.cards]))
}

async function readFirstSseFrame(url: string): Promise<{ res: Response; frame: string }> {
  const controller = new AbortController()
  const res = await fetch(url, { signal: controller.signal })
  assert.ok(res.body)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let frame = ""
  try {
    while (!frame.includes("\n\n")) {
      const { value, done } = await reader.read()
      if (done) break
      frame += decoder.decode(value, { stream: true })
    }
  } finally {
    controller.abort()
    await reader.cancel().catch(() => {})
  }
  return { res, frame }
}

test("REQ-10-1 characterizes a representative API success path on GET /health", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-api-boundary-health-"))
  const dbPath = join(dir, "server.sqlite")
  initDatabase(dbPath).close()
  const { proc, base } = await startServer(makeServerEnv(dir, dbPath))
  try {
    await waitForHealth(base)
    const res = await fetch(`${base}/health`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get("content-type") ?? "", /^application\/json/)
    const body = await res.json() as {
      ok: boolean
      service: string
      uptimeMs: number
      db: string
    }
    assert.deepEqual(Object.keys(body).sort(), ["db", "ok", "service", "uptimeMs"])
    assert.equal(body.ok, true)
    assert.equal(body.service, "beerengineer-engine")
    assert.equal(body.db, "ok")
    assert.equal(typeof body.uptimeMs, "number")
    assert.ok(Number.isFinite(body.uptimeMs))
    assert.ok(body.uptimeMs >= 0)
  } finally {
    await stopServer(proc)
    rmSync(dir, { recursive: true, force: true })
  }
})

test("REQ-10-1 characterizes the current item action 404 failure path", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-api-boundary-404-"))
  const dbPath = join(dir, "server.sqlite")
  initDatabase(dbPath).close()
  const { proc, base } = await startServer(makeServerEnv(dir, dbPath))
  try {
    await waitForHealth(base)
    const res = await fetch(`${base}/items/no-such/actions/start_brainstorm`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({}),
    })
    assert.equal(res.status, 404)
    assert.match(res.headers.get("content-type") ?? "", /^application\/json/)
    const body = await res.json() as { error: string; code?: string }
    assert.deepEqual(body, { error: "item_not_found", code: "not_found" })
  } finally {
    await stopServer(proc)
    rmSync(dir, { recursive: true, force: true })
  }
})

test("REQ-1 tokenless localhost mutations are admitted whether legacy token headers are absent or present", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-api-boundary-auth-"))
  const dbPath = join(dir, "server.sqlite")
  const configPath = join(dir, "config.json")
  const allowedRoot = join(dir, "projects")
  const { mkdirSync, writeFileSync } = await import("node:fs")
  initDatabase(dbPath).close()
  mkdirSync(allowedRoot, { recursive: true })
  writeFileSync(configPath, JSON.stringify({
    schemaVersion: 1,
    dataDir: join(dir, "data"),
    allowedRoots: [allowedRoot],
    enginePort: 4100,
    llm: {
      provider: "anthropic",
      model: "claude-opus-4-7",
      apiKeyRef: "ANTHROPIC_API_KEY",
      defaultHarnessProfile: { mode: "claude-first" },
    },
    vcs: { github: { enabled: false } },
    browser: { enabled: false },
  }))
  const { proc, base } = await startServer({
    BEERENGINEER_UI_DB_PATH: dbPath,
    BEERENGINEER_CONFIG_PATH: configPath,
    BEERENGINEER_DATA_DIR: join(dir, "data"),
  }, { apiToken: null })
  try {
    await waitForHealth(base)

    const headers = [
      undefined,
      { "x-beerengineer-token": "wrong-token" },
      { "x-beerengineer-token": TEST_API_TOKEN },
    ]

    for (const headerSet of headers) {
      const res = await fetch(`${base}/workspaces`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(headerSet ?? {}),
        },
        body: JSON.stringify({
          path: join(allowedRoot, "bad"),
          harnessProfile: { mode: "does-not-exist" },
        }),
      })
      assert.equal(res.status, 400)
      const body = await res.json() as { error: string }
      assert.equal(body.error, "invalid_harness_profile")
    }
  } finally {
    await stopServer(proc)
    rmSync(dir, { recursive: true, force: true })
  }
})

test("REQ-10-1 characterizes the current SSE handshake and hello frame", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-api-boundary-sse-"))
  const dbPath = join(dir, "server.sqlite")
  const db = initDatabase(dbPath)
  const repos = new Repos(db)
  repos.upsertWorkspace({ key: "alpha", name: "Alpha" })
  db.close()

  const { proc, base } = await startServer(makeServerEnv(dir, dbPath))
  try {
    await waitForHealth(base)
    const { res, frame } = await readFirstSseFrame(`${base}/events?workspace=alpha&level=1`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get("content-type") ?? "", /^text\/event-stream/)
    assert.equal(res.headers.get("cache-control"), "no-cache")
    assert.match(res.headers.get("connection") ?? "", /keep-alive/i)
    assert.match(frame, /^event: hello\n/)
    const dataMatch = frame.match(/^data: (.+)$/m)
    assert.ok(dataMatch)
    const hello = JSON.parse(dataMatch[1] ?? "null") as { at: number; workspace: string | null }
    assert.equal(typeof hello.at, "number")
    assert.equal(hello.workspace, "alpha")
  } finally {
    await stopServer(proc)
    rmSync(dir, { recursive: true, force: true })
  }
})

test("REQ-10-1 characterizes the empty GET /board response", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-api-boundary-board-empty-"))
  const dbPath = join(dir, "server.sqlite")
  const db = initDatabase(dbPath)
  const repos = new Repos(db)
  repos.upsertWorkspace({ key: "empty", name: "Empty" })
  db.close()

  const { proc, base } = await startServer(makeServerEnv(dir, dbPath))
  try {
    await waitForHealth(base)
    const res = await fetch(`${base}/board?workspace=empty`)
    assert.equal(res.status, 200)
    const board = await res.json() as BoardResponse
    assert.equal(board.workspaceKey, "empty")
    assert.deepEqual(
      board.columns.map(column => ({ key: column.key, title: column.title, cards: column.cards.length })),
      [
        { key: "idea", title: "Idea", cards: 0 },
        { key: "brainstorm", title: "Brainstorm", cards: 0 },
        { key: "frontend", title: "Frontend", cards: 0 },
        { key: "requirements", title: "Requirements", cards: 0 },
        { key: "implementation", title: "Implementation", cards: 0 },
        { key: "merge", title: "Merge", cards: 0 },
        { key: "done", title: "Done", cards: 0 },
      ],
    )
    assert.deepEqual(board.costRisk, { retainedBranchCount: 0, planLimitRatio: 0 })
  } finally {
    await stopServer(proc)
    rmSync(dir, { recursive: true, force: true })
  }
})

test("REQ-10-1 characterizes GET /board placement, prompt, recovery, Supabase, and merge overlap state", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-api-boundary-board-stateful-"))
  const dbPath = join(dir, "server.sqlite")
  const db = initDatabase(dbPath)
  const repos = new Repos(db)

  const workspace = repos.upsertWorkspace({ key: "alpha", name: "Alpha" })
  repos.connectWorkspaceSupabase(workspace.id, { projectRef: "sb-alpha", region: "eu-central-1" })
  repos.setWorkspaceSupabaseBranchQuota(workspace.id, { usage: 1, limit: 2 })

  const idea = repos.createItem({ workspaceId: workspace.id, title: "Idea seed", description: "unstarted" })

  const promptItem = repos.createItem({ workspaceId: workspace.id, title: "Prompted brainstorm", description: "needs operator input" })
  repos.setItemColumn(promptItem.id, "brainstorm", "running")
  repos.setItemCurrentStage(promptItem.id, "brainstorm")
  const promptRun = repos.createRun({ workspaceId: workspace.id, itemId: promptItem.id, title: promptItem.title })
  repos.updateRun(promptRun.id, { status: "blocked", current_stage: "brainstorm" })
  repos.createPendingPrompt({
    runId: promptRun.id,
    prompt: "Promote this item?",
    actions: [{ label: "Promote", value: "promote" }],
  })

  const recoveryItem = repos.createItem({ workspaceId: workspace.id, title: "Recovery frontend", description: "lost worker" })
  repos.setItemColumn(recoveryItem.id, "frontend", "failed")
  repos.setItemCurrentStage(recoveryItem.id, "frontend-design")
  const recoveryRun = repos.createRun({ workspaceId: workspace.id, itemId: recoveryItem.id, title: recoveryItem.title })
  repos.updateRun(recoveryRun.id, {
    status: "failed",
    current_stage: "frontend-design",
    recovery_status: "failed",
    recovery_scope: "run",
    recovery_summary: "API restart lost API worker ownership — no live worker; resume or abandon.",
  })

  const requirementsItem = repos.createItem({ workspaceId: workspace.id, title: "Requirements plan", description: "ready for PRD" })
  repos.setItemColumn(requirementsItem.id, "requirements", "completed")
  repos.createProject({ itemId: requirementsItem.id, code: "P1", name: "API contract" })
  repos.createProject({ itemId: requirementsItem.id, code: "P2", name: "Board fixture" })

  const implementationItem = repos.createItem({ workspaceId: workspace.id, title: "Implementation db", description: "branch provisioned" })
  repos.setItemColumn(implementationItem.id, "implementation", "running")
  repos.setItemCurrentStage(implementationItem.id, "execution")
  const implementationRun = repos.createRun({ workspaceId: workspace.id, itemId: implementationItem.id, title: implementationItem.title })
  repos.updateRun(implementationRun.id, { status: "completed", current_stage: "execution" })
  repos.setRunSupabaseBranch(implementationRun.id, { ref: "branch_impl", name: "feature/impl", lifecycleState: "active" })

  const mergeItem = repos.createItem({ workspaceId: workspace.id, title: "Merge gate overlap", description: "prompt + blocker + branch" })
  repos.setItemColumn(mergeItem.id, "merge", "review_required")
  repos.setItemCurrentStage(mergeItem.id, "merge-gate")
  const mergeRun = repos.createRun({ workspaceId: workspace.id, itemId: mergeItem.id, title: mergeItem.title })
  repos.setRunSupabaseBranch(mergeRun.id, { ref: "branch_merge", name: "feature/merge", lifecycleState: "retained-for-diagnosis" })
  repos.updateRun(mergeRun.id, {
    status: "blocked",
    current_stage: "merge-gate",
    recovery_status: "blocked",
    recovery_scope: "run",
    recovery_summary: "Supabase readiness blocked planned DB-relevant work.",
    recovery_payload_json: JSON.stringify({
      type: "supabase_readiness",
      status: "blocked",
      missingSetupActions: ["Rotate management token"],
      retry: { available: true, runId: mergeRun.id },
      workspace: { id: workspace.id, key: workspace.key },
      message: "Supabase readiness blocked planned DB-relevant work.",
    }),
  })
  repos.createPendingPrompt({
    runId: mergeRun.id,
    prompt: "Merge this item?",
    actions: [{ label: "Promote", value: "promote" }],
  })

  const doneItem = repos.createItem({ workspaceId: workspace.id, title: "Done item", description: "merged" })
  repos.setItemColumn(doneItem.id, "done", "completed")

  db.close()

  const { proc, base } = await startServer(makeServerEnv(dir, dbPath))
  try {
    await waitForHealth(base)
    const res = await fetch(`${base}/board?workspace=alpha`)
    assert.equal(res.status, 200)
    const board = await res.json() as BoardResponse
    assert.equal(board.workspaceKey, "alpha")
    assert.deepEqual(board.costRisk, { retainedBranchCount: 1, planLimitRatio: 0.5 })
    assert.deepEqual(board.columns.map(column => column.key), [
      "idea",
      "brainstorm",
      "frontend",
      "requirements",
      "implementation",
      "merge",
      "done",
    ])

    const cards = columnCards(board)
    assert.deepEqual(cards.idea.map(sanitizeCard), [
      {
        keys: ["chatEntry", "chatEntryFreshness", "column", "currentStage", "dbRelevance", "hasBlockedRun", "hasOpenPrompt", "hasReviewGateWaiting", "itemCode", "itemId", "messagesEntry", "messagesEntryFreshness", "meta", "phaseStatus", "recovery_user_message", "summary", "supabaseProjectRef", "title", "visibleActions", "visibleActionsFreshness", "workspaceId", "workspaceRoot"],
        itemCode: idea.code,
        itemId: idea.id,
        title: "Idea seed",
        summary: "unstarted",
        column: "idea",
        phaseStatus: "draft",
        currentStage: null,
        hasOpenPrompt: false,
        hasReviewGateWaiting: false,
        hasBlockedRun: false,
        supabaseBlocker: null,
        recovery_user_message: null,
        latestRunId: null,
        workspaceId: workspace.id,
        workspaceRoot: null,
        supabaseProjectRef: "sb-alpha",
        dbRelevance: { value: false, source: "detector", reason: "No Supabase branch provisioned" },
        supabaseBranch: null,
        meta: [
          { label: "phase", value: "draft" },
          { label: "projects", value: "0" },
        ],
      },
    ])
    assert.deepEqual(cards.brainstorm.map(sanitizeCard), [
      {
        keys: ["chatEntry", "chatEntryFreshness", "column", "currentStage", "dbRelevance", "hasBlockedRun", "hasOpenPrompt", "hasReviewGateWaiting", "itemCode", "itemId", "latestRunId", "messagesEntry", "messagesEntryFreshness", "meta", "phaseStatus", "recovery_user_message", "summary", "supabaseProjectRef", "title", "visibleActions", "visibleActionsFreshness", "workspaceId", "workspaceRoot"],
        itemCode: promptItem.code,
        itemId: promptItem.id,
        title: "Prompted brainstorm",
        summary: "needs operator input",
        column: "brainstorm",
        phaseStatus: "running",
        currentStage: "brainstorm",
        hasOpenPrompt: true,
        hasReviewGateWaiting: true,
        hasBlockedRun: false,
        supabaseBlocker: null,
        recovery_user_message: null,
        latestRunId: promptRun.id,
        workspaceId: workspace.id,
        workspaceRoot: null,
        supabaseProjectRef: "sb-alpha",
        dbRelevance: { value: false, source: "detector", reason: "No Supabase branch provisioned" },
        supabaseBranch: null,
        meta: [
          { label: "phase", value: "running" },
          { label: "projects", value: "0" },
        ],
      },
    ])
    assert.deepEqual(cards.frontend.map(sanitizeCard), [
      {
        keys: ["chatEntry", "chatEntryFreshness", "column", "currentStage", "dbRelevance", "hasBlockedRun", "hasOpenPrompt", "hasReviewGateWaiting", "itemCode", "itemId", "latestRunId", "messagesEntry", "messagesEntryFreshness", "meta", "phaseStatus", "recovery_user_message", "summary", "supabaseProjectRef", "title", "visibleActions", "visibleActionsFreshness", "workspaceId", "workspaceRoot"],
        itemCode: recoveryItem.code,
        itemId: recoveryItem.id,
        title: "Recovery frontend",
        summary: "lost worker",
        column: "frontend",
        phaseStatus: "failed",
        currentStage: "frontend-design",
        hasOpenPrompt: false,
        hasReviewGateWaiting: false,
        hasBlockedRun: false,
        supabaseBlocker: null,
        recovery_user_message: "Worker lost. Resume this run to continue.",
        latestRunId: recoveryRun.id,
        workspaceId: workspace.id,
        workspaceRoot: null,
        supabaseProjectRef: "sb-alpha",
        dbRelevance: { value: false, source: "detector", reason: "No Supabase branch provisioned" },
        supabaseBranch: null,
        meta: [
          { label: "phase", value: "failed" },
          { label: "projects", value: "0" },
        ],
      },
    ])
    assert.deepEqual(cards.requirements.map(sanitizeCard), [
      {
        keys: ["chatEntry", "chatEntryFreshness", "column", "currentStage", "dbRelevance", "hasBlockedRun", "hasOpenPrompt", "hasReviewGateWaiting", "itemCode", "itemId", "messagesEntry", "messagesEntryFreshness", "meta", "phaseStatus", "recovery_user_message", "summary", "supabaseProjectRef", "title", "visibleActions", "visibleActionsFreshness", "workspaceId", "workspaceRoot"],
        itemCode: requirementsItem.code,
        itemId: requirementsItem.id,
        title: "Requirements plan",
        summary: "ready for PRD",
        column: "requirements",
        phaseStatus: "completed",
        currentStage: null,
        hasOpenPrompt: false,
        hasReviewGateWaiting: false,
        hasBlockedRun: false,
        supabaseBlocker: null,
        recovery_user_message: null,
        latestRunId: null,
        workspaceId: workspace.id,
        workspaceRoot: null,
        supabaseProjectRef: "sb-alpha",
        dbRelevance: { value: false, source: "detector", reason: "No Supabase branch provisioned" },
        supabaseBranch: null,
        meta: [
          { label: "phase", value: "completed" },
          { label: "projects", value: "2" },
        ],
      },
    ])
    assert.deepEqual(cards.implementation.map(sanitizeCard), [
      {
        keys: ["chatEntry", "chatEntryFreshness", "column", "currentStage", "dbRelevance", "hasBlockedRun", "hasOpenPrompt", "hasReviewGateWaiting", "itemCode", "itemId", "latestRunId", "messagesEntry", "messagesEntryFreshness", "meta", "phaseStatus", "recovery_user_message", "summary", "supabaseBranch", "supabaseProjectRef", "title", "visibleActions", "visibleActionsFreshness", "workspaceId", "workspaceRoot"],
        itemCode: implementationItem.code,
        itemId: implementationItem.id,
        title: "Implementation db",
        summary: "branch provisioned",
        column: "implementation",
        phaseStatus: "running",
        currentStage: "execution",
        hasOpenPrompt: false,
        hasReviewGateWaiting: false,
        hasBlockedRun: false,
        supabaseBlocker: null,
        recovery_user_message: null,
        latestRunId: implementationRun.id,
        workspaceId: workspace.id,
        workspaceRoot: null,
        supabaseProjectRef: "sb-alpha",
        dbRelevance: { value: true, source: "detector", reason: "Supabase branch provisioned" },
        supabaseBranch: { ref: "branch_impl", name: "feature/impl", lifecycleState: "active" },
        meta: [
          { label: "phase", value: "running" },
          { label: "projects", value: "0" },
        ],
      },
    ])
    assert.deepEqual(cards.merge.map(sanitizeCard), [
      {
        keys: ["chatEntry", "chatEntryFreshness", "column", "currentStage", "dbRelevance", "hasBlockedRun", "hasOpenPrompt", "hasReviewGateWaiting", "itemCode", "itemId", "latestRunId", "messagesEntry", "messagesEntryFreshness", "meta", "phaseStatus", "recovery_user_message", "summary", "supabaseBlocker", "supabaseBranch", "supabaseProjectRef", "title", "visibleActions", "visibleActionsFreshness", "workspaceId", "workspaceRoot"],
        itemCode: mergeItem.code,
        itemId: mergeItem.id,
        title: "Merge gate overlap",
        summary: "prompt + blocker + branch",
        column: "merge",
        phaseStatus: "review_required",
        currentStage: "merge-gate",
        hasOpenPrompt: true,
        hasReviewGateWaiting: true,
        hasBlockedRun: true,
        supabaseBlocker: {
          status: "blocked",
          label: "Supabase blocked",
          runId: mergeRun.id,
          workspace: { id: workspace.id, key: "alpha" },
          missingSetupActions: ["Rotate management token"],
          message: "Supabase readiness blocked planned DB-relevant work.",
          retry: { available: true, ready: false },
        },
        recovery_user_message: null,
        latestRunId: mergeRun.id,
        workspaceId: workspace.id,
        workspaceRoot: null,
        supabaseProjectRef: "sb-alpha",
        dbRelevance: { value: true, source: "detector", reason: "Supabase branch provisioned" },
        supabaseBranch: { ref: "branch_merge", name: "feature/merge", lifecycleState: "retained-for-diagnosis" },
        meta: [
          { label: "phase", value: "review_required" },
          { label: "projects", value: "0" },
        ],
      },
    ])
    assert.deepEqual(cards.done.map(sanitizeCard), [
      {
        keys: ["chatEntry", "chatEntryFreshness", "column", "currentStage", "dbRelevance", "hasBlockedRun", "hasOpenPrompt", "hasReviewGateWaiting", "itemCode", "itemId", "messagesEntry", "messagesEntryFreshness", "meta", "phaseStatus", "recovery_user_message", "summary", "supabaseProjectRef", "title", "visibleActions", "visibleActionsFreshness", "workspaceId", "workspaceRoot"],
        itemCode: doneItem.code,
        itemId: doneItem.id,
        title: "Done item",
        summary: "merged",
        column: "done",
        phaseStatus: "completed",
        currentStage: null,
        hasOpenPrompt: false,
        hasReviewGateWaiting: false,
        hasBlockedRun: false,
        supabaseBlocker: null,
        recovery_user_message: null,
        latestRunId: null,
        workspaceId: workspace.id,
        workspaceRoot: null,
        supabaseProjectRef: "sb-alpha",
        dbRelevance: { value: false, source: "detector", reason: "No Supabase branch provisioned" },
        supabaseBranch: null,
        meta: [
          { label: "phase", value: "completed" },
          { label: "projects", value: "0" },
        ],
      },
    ])
  } finally {
    await stopServer(proc)
    rmSync(dir, { recursive: true, force: true })
  }
})

test("REQ-10-1 characterizes the touched route matrix and current OpenAPI board shape", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-api-boundary-openapi-"))
  const dbPath = join(dir, "server.sqlite")
  initDatabase(dbPath).close()
  const { proc, base } = await startServer(makeServerEnv(dir, dbPath))
  try {
    await waitForHealth(base)
    const res = await fetch(`${base}/openapi.json`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get("content-type") ?? "", /^application\/json/)
    const openapi = await res.json() as {
      paths: Record<string, Record<string, unknown>>
      components: {
        schemas: Record<string, { required?: string[]; properties?: Record<string, unknown> }>
      }
    }

    assert.deepEqual(Object.keys(openapi.paths["/health"] ?? {}).sort(), ["get"])
    assert.deepEqual(Object.keys(openapi.paths["/ready"] ?? {}).sort(), ["get"])
    assert.deepEqual(Object.keys(openapi.paths["/events"] ?? {}).sort(), ["get"])
    assert.deepEqual(Object.keys(openapi.paths["/board"] ?? {}).sort(), ["get"])
    assert.deepEqual(Object.keys(openapi.paths["/setup/init"] ?? {}).sort(), ["post"])
    assert.deepEqual(Object.keys(openapi.paths["/items/{id}/actions/{action}"] ?? {}).sort(), ["parameters", "post"])

    const setupInit = openapi.paths["/setup/init"]?.post as { security?: unknown }
    const itemAction = openapi.paths["/items/{id}/actions/{action}"]?.post as { security?: unknown }
    const events = openapi.paths["/events"]?.get as { responses?: Record<string, { content?: Record<string, unknown> }> }
    const board = openapi.paths["/board"]?.get as { responses?: Record<string, { content?: Record<string, { schema?: unknown }> }> }
    const boardCard = openapi.components.schemas.BoardCard
    const boardColumn = openapi.components.schemas.BoardColumn

    assert.equal(setupInit.security, undefined)
    assert.equal(itemAction.security, undefined)
    assert.ok(events.responses?.["200"]?.content?.["text/event-stream"])
    assert.deepEqual(board.responses?.["200"]?.content?.["application/json"]?.schema, { $ref: "#/components/schemas/Board" })
    assert.deepEqual(boardColumn.properties?.key, {
      type: "string",
      enum: ["idea", "brainstorm", "frontend", "requirements", "implementation", "merge", "done"],
    })
    assert.deepEqual(boardCard.required, ["itemCode", "itemId", "title", "summary", "column", "phaseStatus", "meta"])
    assert.deepEqual(Object.keys(boardCard.properties ?? {}).sort(), [
      "chatEntry",
      "chatEntryFreshness",
      "column",
      "currentStage",
      "dbRelevance",
      "hasBlockedRun",
      "hasOpenPrompt",
      "hasReviewGateWaiting",
      "itemCode",
      "itemId",
      "latestRunId",
      "messagesEntry",
      "messagesEntryFreshness",
      "meta",
      "phaseStatus",
      "previewUrl",
      "recovery_user_message",
      "summary",
      "supabaseBlocker",
      "supabaseBranch",
      "supabaseProjectRef",
      "title",
      "visibleActions",
      "visibleActionsFreshness",
      "workspaceId",
      "workspaceRoot",
    ])
  } finally {
    await stopServer(proc)
    rmSync(dir, { recursive: true, force: true })
  }
})
