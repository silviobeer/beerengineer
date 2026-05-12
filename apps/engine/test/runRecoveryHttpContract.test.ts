import assert from "node:assert/strict"
import { spawn, type ChildProcess } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { test } from "node:test"

import { buildSupabaseProvisioningRecoveryPayload } from "../src/core/supabase/recoveryPayload.js"
import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"

const TEST_API_TOKEN = "test-token"
const FRESH_PATH_RECOVERY = "fresh_path_recovery"
const RETAINED_PATH_RECOVERY = "retained_path_recovery"

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return { "x-beerengineer-token": TEST_API_TOKEN, ...(extra ?? {}) }
}

async function waitForHealth(base: string, timeoutMs = 10000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${base}/health`)
      if (res.ok) return
    } catch {
      // server not ready yet
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 100))
  }
  throw new Error(`server at ${base} did not become healthy in time`)
}

function startServer(env: NodeJS.ProcessEnv): { proc: ChildProcess; base: string } {
  const port = 4700 + Math.floor(Math.random() * 200)
  const host = "127.0.0.1"
  const serverPath = resolve(new URL(".", import.meta.url).pathname, "..", "src", "api", "server.ts")
  const proc = spawn(process.execPath, ["--import", "tsx", serverPath], {
    env: {
      ...process.env,
      ...env,
      HOST: host,
      PORT: String(port),
      BEERENGINEER_SEED: "0",
      BEERENGINEER_API_TOKEN: TEST_API_TOKEN,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  proc.stdout?.on("data", () => {})
  proc.stderr?.on("data", () => {})
  return { proc, base: `http://${host}:${port}` }
}

function stopServer(proc: ChildProcess): Promise<void> {
  return new Promise(resolvePromise => {
    if (proc.exitCode !== null) return resolvePromise()
    proc.once("exit", () => resolvePromise())
    proc.kill("SIGTERM")
    setTimeout(() => proc.kill("SIGKILL"), 1500).unref?.()
  })
}

function createRunFixture(repos: Repos, input: { title: string; recoverySummary: string }) {
  const workspace = repos.upsertWorkspace({ key: "alpha", name: "Alpha", rootPath: "/tmp/alpha" })
  const item = repos.createItem({ workspaceId: workspace.id, title: input.title, description: input.title })
  const run = repos.createRun({ workspaceId: workspace.id, itemId: item.id, title: item.title, owner: "api", status: "blocked" })
  repos.updateRun(run.id, {
    status: "blocked",
    recovery_status: "blocked",
    recovery_scope: "run",
    recovery_scope_ref: null,
    recovery_summary: input.recoverySummary,
  })
  return { workspace, item, run }
}

function seedRecoveryFixtures(dbPath: string): { freshRunId: string; retainedRunId: string; incompatibleRunId: string } {
  const db = initDatabase(dbPath)
  const repos = new Repos(db)
  try {
    const fresh = createRunFixture(repos, {
      title: "Fresh path run",
      recoverySummary: "Supabase provisioning needs a fresh branch recovery path.",
    })
    repos.setRunRecoveryPayloadJson(fresh.run.id, buildSupabaseProvisioningRecoveryPayload({
      runId: fresh.run.id,
      workspaceId: fresh.workspace.id,
      workspaceKey: fresh.workspace.key,
      projectRef: "proj_alpha",
      waveId: "W1",
      waveNumber: 1,
      failedStep: "validate",
      failureCause: "Validation failed before any retained branch was selected.",
      userMessage: "Operator recovery is required.",
    }))
    repos.setRunRecoverySupabaseLifecycleState(fresh.run.id, "provisioning")

    const retained = createRunFixture(repos, {
      title: "Retained path run",
      recoverySummary: "Supabase provisioning retained the branch for diagnosis.",
    })
    repos.setRunSupabaseBranch(retained.run.id, {
      ref: "br_retained",
      name: "alpha-retained",
      lifecycleState: "retained-for-diagnosis",
    })
    repos.setRunRecoveryPayloadJson(retained.run.id, buildSupabaseProvisioningRecoveryPayload({
      runId: retained.run.id,
      workspaceId: retained.workspace.id,
      workspaceKey: retained.workspace.key,
      projectRef: "proj_alpha",
      waveId: "W1",
      waveNumber: 1,
      branchRef: "br_retained",
      failedStep: "validate",
      failureCause: "Validation failed after branch retention.",
      userMessage: "Operator recovery is required.",
    }))

    const incompatible = createRunFixture(repos, {
      title: "Incompatible run",
      recoverySummary: "Reviewer blocked this run for manual review.",
    })
    repos.setRunRecoveryPayloadJson(incompatible.run.id, "{\"status\":\"blocked\",\"type\":\"manual_review\"}")

    return {
      freshRunId: fresh.run.id,
      retainedRunId: retained.run.id,
      incompatibleRunId: incompatible.run.id,
    }
  } finally {
    db.close()
  }
}

async function getRecovery(base: string, runId: string): Promise<unknown> {
  const response = await fetch(`${base}/runs/${runId}/recovery`)
  return await response.json()
}

async function postRecovery(base: string, runId: string, body: Record<string, unknown>): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`${base}/runs/${runId}/recovery`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(body),
  })
  return { status: response.status, json: await response.json() }
}

test("REQ-1 TC-REQ-1-01/05: recovery surface advertises only compatible actions and rejects incompatible pairings without changing state", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-run-recovery-http-"))
  const dbPath = join(dir, "db.sqlite")
  const { freshRunId, retainedRunId, incompatibleRunId } = seedRecoveryFixtures(dbPath)
  const { proc, base } = startServer({ BEERENGINEER_UI_DB_PATH: dbPath })

  try {
    await waitForHealth(base)

    const fresh = await getRecovery(base, freshRunId) as { recovery: { availableActions: string[] } }
    const retained = await getRecovery(base, retainedRunId) as { recovery: { availableActions: string[] } }
    const incompatible = await getRecovery(base, incompatibleRunId) as { recovery: { availableActions: string[] } }

    assert.deepEqual(fresh.recovery.availableActions, ["recover_fresh_branch"])
    assert.deepEqual(retained.recovery.availableActions, ["retry_retained", "clear_and_fresh"])
    assert.deepEqual(incompatible.recovery.availableActions, [])

    const retainedBefore = JSON.stringify(await getRecovery(base, retainedRunId))
    const rejectedFreshOnRetained = await postRecovery(base, retainedRunId, { action: "recover_fresh_branch" })
    assert.equal(rejectedFreshOnRetained.status, 409)
    assert.deepEqual(rejectedFreshOnRetained.json, {
      ok: false,
      error: "recovery_action_ineligible",
      code: "invalid_transition",
      action: "recover_fresh_branch",
      reason: "incompatible_recovery_state",
      message: "Recovery action is not available for this run.",
    })
    assert.equal(JSON.stringify(await getRecovery(base, retainedRunId)), retainedBefore)

    const freshBefore = JSON.stringify(await getRecovery(base, freshRunId))
    const rejectedRetainedOnFresh = await postRecovery(base, freshRunId, { action: "retry_retained" })
    assert.equal(rejectedRetainedOnFresh.status, 409)
    assert.deepEqual(rejectedRetainedOnFresh.json, {
      ok: false,
      error: "recovery_action_ineligible",
      code: "invalid_transition",
      action: "retry_retained",
      reason: "incompatible_recovery_state",
      message: "Recovery action is not available for this run.",
    })
    assert.equal(JSON.stringify(await getRecovery(base, freshRunId)), freshBefore)
  } finally {
    await stopServer(proc)
    rmSync(dir, { recursive: true, force: true })
  }
})

test("REQ-1 TC-REQ-1-02/03/04: accepted named actions persist fresh-path and retained-path recovery state through follow-up reads", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-run-recovery-http-"))
  const dbPath = join(dir, "db.sqlite")
  const { freshRunId, retainedRunId } = seedRecoveryFixtures(dbPath)
  const clearDbPath = join(dir, "db-clear.sqlite")
  const { retainedRunId: clearRetainedRunId } = seedRecoveryFixtures(clearDbPath)
  const freshServer = startServer({ BEERENGINEER_UI_DB_PATH: dbPath })
  const clearServer = startServer({ BEERENGINEER_UI_DB_PATH: clearDbPath })

  try {
    await waitForHealth(freshServer.base)
    await waitForHealth(clearServer.base)

    const freshResult = await postRecovery(freshServer.base, freshRunId, { action: "recover_fresh_branch" })
    assert.equal(freshResult.status, 200)
    const freshAccepted = freshResult.json as {
      ok: boolean
      runId: string
      action: string
      outcome: string
      latestState: { recoveryPayloadJson: string | null; supabaseBranchRef: string | null; supabaseBranchLifecycleState: string | null }
      recoveryStatus: string
      supabaseBranchLifecycleState: string
    }
    assert.equal(freshAccepted.ok, true)
    assert.equal(freshAccepted.runId, freshRunId)
    assert.equal(freshAccepted.action, "recover_fresh_branch")
    assert.equal(freshAccepted.outcome, "accepted")
    assert.equal(freshAccepted.latestState.supabaseBranchRef, null)
    assert.equal(freshAccepted.latestState.supabaseBranchLifecycleState, "provisioning")
    assert.match(freshAccepted.latestState.recoveryPayloadJson ?? "", /"operatorAction":"discard"/)
    assert.equal(freshAccepted.recoveryStatus, FRESH_PATH_RECOVERY)
    assert.equal(freshAccepted.supabaseBranchLifecycleState, FRESH_PATH_RECOVERY)

    const freshRead = await getRecovery(freshServer.base, freshRunId) as {
      recovery: { recoveryStatus: string; supabaseBranchLifecycleState: string }
    }
    assert.equal(freshRead.recovery.recoveryStatus, FRESH_PATH_RECOVERY)
    assert.equal(freshRead.recovery.supabaseBranchLifecycleState, FRESH_PATH_RECOVERY)
    assert.notEqual(freshRead.recovery.recoveryStatus, RETAINED_PATH_RECOVERY)
    assert.notEqual(freshRead.recovery.supabaseBranchLifecycleState, RETAINED_PATH_RECOVERY)

    const retainedResult = await postRecovery(freshServer.base, retainedRunId, { action: "retry_retained" })
    assert.equal(retainedResult.status, 200)
    const retainedRead = await getRecovery(freshServer.base, retainedRunId) as {
      recovery: { recoveryStatus: string; supabaseBranchLifecycleState: string }
    }
    assert.equal(retainedRead.recovery.recoveryStatus, RETAINED_PATH_RECOVERY)
    assert.equal(retainedRead.recovery.supabaseBranchLifecycleState, RETAINED_PATH_RECOVERY)

    const clearResult = await postRecovery(clearServer.base, clearRetainedRunId, { action: "clear_and_fresh" })
    assert.equal(clearResult.status, 200)
    const clearRead = await getRecovery(clearServer.base, clearRetainedRunId) as {
      recovery: { recoveryStatus: string; supabaseBranchLifecycleState: string }
    }
    assert.equal(clearRead.recovery.recoveryStatus, FRESH_PATH_RECOVERY)
    assert.equal(clearRead.recovery.supabaseBranchLifecycleState, FRESH_PATH_RECOVERY)
    assert.notEqual(clearRead.recovery.recoveryStatus, RETAINED_PATH_RECOVERY)
    assert.notEqual(clearRead.recovery.supabaseBranchLifecycleState, RETAINED_PATH_RECOVERY)
  } finally {
    await stopServer(freshServer.proc)
    await stopServer(clearServer.proc)
    rmSync(dir, { recursive: true, force: true })
  }
})

test("REQ-1 TC-REQ-1-06: repeated clear-and-fresh returns explicit noop and leaves recovery state byte-identical", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-run-recovery-http-"))
  const dbPath = join(dir, "db.sqlite")
  const { retainedRunId } = seedRecoveryFixtures(dbPath)
  const { proc, base } = startServer({ BEERENGINEER_UI_DB_PATH: dbPath })

  try {
    await waitForHealth(base)

    const first = await postRecovery(base, retainedRunId, { action: "clear_and_fresh" })
    assert.equal(first.status, 200)
    const afterFirst = JSON.stringify(await getRecovery(base, retainedRunId))

    const second = await postRecovery(base, retainedRunId, { action: "clear_and_fresh" })
    assert.equal(second.status, 200)
    const secondNoop = second.json as {
      ok: boolean
      runId: string
      action: string
      outcome: string
      reason: string
      latestState: { recoveryPayloadJson: string | null; supabaseBranchRef: string | null; supabaseBranchLifecycleState: string | null }
      recoveryStatus: string
      supabaseBranchLifecycleState: string
    }
    assert.equal(secondNoop.ok, true)
    assert.equal(secondNoop.runId, retainedRunId)
    assert.equal(secondNoop.action, "clear_and_fresh")
    assert.equal(secondNoop.outcome, "noop")
    assert.equal(secondNoop.reason, "already_on_fresh_path")
    assert.equal(secondNoop.latestState.supabaseBranchRef, null)
    assert.equal(secondNoop.latestState.supabaseBranchLifecycleState, "retained-for-diagnosis")
    assert.match(secondNoop.latestState.recoveryPayloadJson ?? "", /"operatorAction":"discard"/)
    assert.equal(secondNoop.recoveryStatus, FRESH_PATH_RECOVERY)
    assert.equal(secondNoop.supabaseBranchLifecycleState, FRESH_PATH_RECOVERY)
    assert.equal(JSON.stringify(await getRecovery(base, retainedRunId)), afterFirst)
  } finally {
    await stopServer(proc)
    rmSync(dir, { recursive: true, force: true })
  }
})

test("REQ-1 edge cases: unknown, malformed, and missing run requests reject without changing state", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-run-recovery-http-"))
  const dbPath = join(dir, "db.sqlite")
  const { freshRunId } = seedRecoveryFixtures(dbPath)
  const { proc, base } = startServer({ BEERENGINEER_UI_DB_PATH: dbPath })

  try {
    await waitForHealth(base)

    const before = JSON.stringify(await getRecovery(base, freshRunId))

    const unknown = await postRecovery(base, freshRunId, { action: "not_real" })
    assert.equal(unknown.status, 400)
    assert.deepEqual(unknown.json, {
      ok: false,
      error: "unsupported_recovery_action",
      code: "bad_request",
      action: "not_real",
      reason: "unsupported_action",
      message: "Unsupported recovery action.",
    })

    const missing = await postRecovery(base, freshRunId, {})
    assert.equal(missing.status, 400)
    assert.deepEqual(missing.json, {
      ok: false,
      error: "recovery_action_required",
      code: "bad_request",
      reason: "action_required",
      message: "Recovery action is required.",
    })

    const notFound = await postRecovery(base, "run_missing", { action: "recover_fresh_branch" })
    assert.equal(notFound.status, 404)
    assert.deepEqual(notFound.json, {
      ok: false,
      error: "run_not_found",
      code: "not_found",
      reason: "run_not_found",
      message: "Run not found: run_missing",
    })

    assert.equal(JSON.stringify(await getRecovery(base, freshRunId)), before)
  } finally {
    await stopServer(proc)
    rmSync(dir, { recursive: true, force: true })
  }
})
