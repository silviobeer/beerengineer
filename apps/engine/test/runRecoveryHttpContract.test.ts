import assert from "node:assert/strict"
import { spawn, type ChildProcess } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { buildSupabaseProvisioningRecoveryPayload } from "../src/core/supabase/recoveryPayload.js"
import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"

const TEST_API_TOKEN = "test-token"
const TEST_API_WORKER_INSTANCE_ID = "test-api-worker"
const FRESH_PATH_RECOVERY = "fresh_path_recovery"
const RETAINED_PATH_RECOVERY = "retained_path_recovery"
const CLEAR_ACTION_CASES = [
  {
    action: "clear_recovery_payload",
    targetKey: "recovery_payload_json",
    siblingAttemptKey: "supabaseBranchRef",
  },
  {
    action: "clear_supabase_branch_ref",
    targetKey: "supabase_branch_ref",
    siblingAttemptKey: "supabaseBranchLifecycleState",
  },
  {
    action: "clear_supabase_branch_lifecycle_state",
    targetKey: "supabase_branch_lifecycle_state",
    siblingAttemptKey: "recoveryPayloadJson",
  },
] as const

type ClearActionCase = (typeof CLEAR_ACTION_CASES)[number]
type ClearAction = ClearActionCase["action"]
type SupportedRecoveryState = {
  recovery_payload_json: string | null
  supabase_branch_ref: string | null
  supabase_branch_lifecycle_state: string | null
}

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
  const serverPath = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "src", "api", "server.ts")
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

function seedSkipFixtures(dbPath: string): {
  eligibleRunId: string
  noCurrentRunId: string
  inactiveRunId: string
  activeLeaseRunId: string
  terminalRunId: string
  skippedRunId: string
} {
  const db = initDatabase(dbPath)
  const repos = new Repos(db)
  const staleStartedAt = Date.now() - 300_000
  try {
    const eligible = createRunFixture(repos, {
      title: "Eligible skip run",
      recoverySummary: "Eligible for skip-current-stage.",
    })
    repos.updateRun(eligible.run.id, {
      status: "running",
      current_stage: "execution",
      recovery_status: null,
      recovery_scope: null,
      recovery_scope_ref: null,
      recovery_summary: null,
      recovery_payload_json: null,
    })
    repos.claimRunWorkerLease(eligible.run.id, {
      workerInstanceId: TEST_API_WORKER_INSTANCE_ID,
      workerOwnerKind: "api",
      startedAt: staleStartedAt,
      heartbeatAt: staleStartedAt,
    })
    repos.createStageRun({ runId: eligible.run.id, stageKey: "execution" })

    const noCurrent = createRunFixture(repos, {
      title: "No current stage",
      recoverySummary: "No current stage available.",
    })
    repos.updateRun(noCurrent.run.id, {
      status: "running",
      current_stage: null,
      recovery_status: null,
      recovery_scope: null,
      recovery_scope_ref: null,
      recovery_summary: null,
      recovery_payload_json: null,
    })
    repos.claimRunWorkerLease(noCurrent.run.id, {
      workerInstanceId: TEST_API_WORKER_INSTANCE_ID,
      workerOwnerKind: "api",
      startedAt: staleStartedAt,
      heartbeatAt: staleStartedAt,
    })

    const inactive = createRunFixture(repos, {
      title: "Inactive current stage",
      recoverySummary: "Current stage is no longer active.",
    })
    repos.updateRun(inactive.run.id, {
      status: "blocked",
      current_stage: "planning",
      recovery_status: "blocked",
      recovery_scope: "stage",
      recovery_scope_ref: "planning",
      recovery_summary: "Manual review is required before continuing.",
      recovery_payload_json: null,
    })
    repos.createStageRun({ runId: inactive.run.id, stageKey: "planning" })

    const activeLease = createRunFixture(repos, {
      title: "Live worker lease",
      recoverySummary: "Worker is still active.",
    })
    repos.updateRun(activeLease.run.id, {
      status: "running",
      current_stage: "execution",
      recovery_status: null,
      recovery_scope: null,
      recovery_scope_ref: null,
      recovery_summary: null,
      recovery_payload_json: null,
    })
    repos.createStageRun({ runId: activeLease.run.id, stageKey: "execution" })
    repos.claimRunWorkerLease(activeLease.run.id, {
      workerInstanceId: "cli-worker-active",
      workerOwnerKind: "cli",
      startedAt: Date.now(),
    })

    const terminal = createRunFixture(repos, {
      title: "Terminal stage",
      recoverySummary: "Current stage already completed.",
    })
    repos.updateRun(terminal.run.id, {
      status: "running",
      current_stage: "requirements",
      recovery_status: null,
      recovery_scope: null,
      recovery_scope_ref: null,
      recovery_summary: null,
      recovery_payload_json: null,
    })
    repos.claimRunWorkerLease(terminal.run.id, {
      workerInstanceId: TEST_API_WORKER_INSTANCE_ID,
      workerOwnerKind: "api",
      startedAt: staleStartedAt,
      heartbeatAt: staleStartedAt,
    })
    const terminalStage = repos.createStageRun({ runId: terminal.run.id, stageKey: "requirements" })
    repos.completeStageRun(terminalStage.id, "completed")

    const skipped = createRunFixture(repos, {
      title: "Already skipped",
      recoverySummary: "Current stage already skipped.",
    })
    repos.updateRun(skipped.run.id, {
      status: "blocked",
      current_stage: "architecture",
      recovery_status: "blocked",
      recovery_scope: "stage",
      recovery_scope_ref: "architecture",
      recovery_summary: "Current stage 'architecture' was skipped. Manual review is required before continuing.",
      recovery_payload_json: null,
    })
    const skippedStage = repos.createStageRun({ runId: skipped.run.id, stageKey: "architecture" })
    repos.completeStageRun(skippedStage.id, "skipped")

    return {
      eligibleRunId: eligible.run.id,
      noCurrentRunId: noCurrent.run.id,
      inactiveRunId: inactive.run.id,
      activeLeaseRunId: activeLease.run.id,
      terminalRunId: terminal.run.id,
      skippedRunId: skipped.run.id,
    }
  } finally {
    db.close()
  }
}

function seedClearFixtures(dbPath: string): {
  populatedRunIds: Record<ClearAction, string>
  alreadyClearRunIds: Record<ClearAction, string>
} {
  const db = initDatabase(dbPath)
  const repos = new Repos(db)

  try {
    const populatedRunIds = {} as Record<ClearAction, string>
    const alreadyClearRunIds = {} as Record<ClearAction, string>

    for (const testCase of CLEAR_ACTION_CASES) {
      const populated = createRunFixture(repos, {
        title: `${testCase.action} populated`,
        recoverySummary: `${testCase.action} populated fixture`,
      })
      repos.setRunRecoveryPayloadJson(populated.run.id, JSON.stringify({ fixture: testCase.action, value: "payload" }))
      repos.setRunRecoverySupabaseBranchRef(populated.run.id, `br_${testCase.action}`)
      repos.setRunRecoverySupabaseLifecycleState(populated.run.id, `lifecycle_${testCase.action}`)
      populatedRunIds[testCase.action] = populated.run.id

      const alreadyClear = createRunFixture(repos, {
        title: `${testCase.action} already clear`,
        recoverySummary: `${testCase.action} already clear fixture`,
      })
      repos.setRunRecoveryPayloadJson(alreadyClear.run.id, JSON.stringify({ fixture: testCase.action, value: "payload" }))
      repos.setRunRecoverySupabaseBranchRef(alreadyClear.run.id, `br_${testCase.action}_noop`)
      repos.setRunRecoverySupabaseLifecycleState(alreadyClear.run.id, `lifecycle_${testCase.action}_noop`)
      switch (testCase.targetKey) {
        case "recovery_payload_json":
          repos.setRunRecoveryPayloadJson(alreadyClear.run.id, null)
          break
        case "supabase_branch_ref":
          repos.setRunRecoverySupabaseBranchRef(alreadyClear.run.id, null)
          break
        case "supabase_branch_lifecycle_state":
          repos.setRunRecoverySupabaseLifecycleState(alreadyClear.run.id, null)
          break
      }
      alreadyClearRunIds[testCase.action] = alreadyClear.run.id
    }

    return { populatedRunIds, alreadyClearRunIds }
  } finally {
    db.close()
  }
}

async function getRecovery(base: string, runId: string): Promise<unknown> {
  const response = await fetch(`${base}/runs/${runId}/recovery`)
  return await response.json()
}

async function getRun(base: string, runId: string): Promise<unknown> {
  const response = await fetch(`${base}/runs/${runId}`)
  return await response.json()
}

async function getSupportedRecoveryState(base: string, runId: string): Promise<SupportedRecoveryState> {
  const run = await getRun(base, runId) as SupportedRecoveryState
  return {
    recovery_payload_json: run.recovery_payload_json,
    supabase_branch_ref: run.supabase_branch_ref,
    supabase_branch_lifecycle_state: run.supabase_branch_lifecycle_state,
  }
}

async function getRunTree(base: string, runId: string): Promise<unknown> {
  const response = await fetch(`${base}/runs/${runId}/tree`)
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

test("REQ-2 TC-REQ-2-01: recovery read surface offers skip_current_stage only for an active unskipped current stage", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-run-skip-http-"))
  const dbPath = join(dir, "db.sqlite")
  const fixture = seedSkipFixtures(dbPath)
  const { proc, base } = startServer({
    BEERENGINEER_UI_DB_PATH: dbPath,
    BEERENGINEER_API_INSTANCE_ID: TEST_API_WORKER_INSTANCE_ID,
  })

  try {
    await waitForHealth(base)

    const eligible = await getRecovery(base, fixture.eligibleRunId) as { recovery: { availableActions: string[] } }
    const noCurrent = await getRecovery(base, fixture.noCurrentRunId) as { recovery: null }
    const inactive = await getRecovery(base, fixture.inactiveRunId) as { recovery: { availableActions: string[] } }
    const activeLease = await getRecovery(base, fixture.activeLeaseRunId) as { recovery: { availableActions: string[] } }
    const terminal = await getRecovery(base, fixture.terminalRunId) as { recovery: { availableActions: string[] } }
    const skipped = await getRecovery(base, fixture.skippedRunId) as { recovery: { availableActions: string[] } }

    assert.deepEqual(eligible.recovery.availableActions, ["skip_current_stage"])
    assert.equal(noCurrent.recovery, null)
    assert.deepEqual(inactive.recovery.availableActions, [])
    assert.deepEqual(activeLease.recovery.availableActions, [])
    assert.deepEqual(terminal.recovery.availableActions, [])
    assert.deepEqual(skipped.recovery.availableActions, [])
  } finally {
    await stopServer(proc)
    rmSync(dir, { recursive: true, force: true })
  }
})

test("REQ-2 TC-REQ-2-02/03/06: accepted skip_current_stage records the skip, blocks the run, and does not auto-advance", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-run-skip-http-"))
  const dbPath = join(dir, "db.sqlite")
  const fixture = seedSkipFixtures(dbPath)
  const { proc, base } = startServer({
    BEERENGINEER_UI_DB_PATH: dbPath,
    BEERENGINEER_API_INSTANCE_ID: TEST_API_WORKER_INSTANCE_ID,
  })

  try {
    await waitForHealth(base)

    const accepted = await postRecovery(base, fixture.eligibleRunId, { action: "skip_current_stage" })
    assert.equal(accepted.status, 200)
    assert.deepEqual(accepted.json, {
      ok: true,
      runId: fixture.eligibleRunId,
      action: "skip_current_stage",
      outcome: "accepted",
      latestState: {
        recoveryPayloadJson: null,
        supabaseBranchRef: null,
        supabaseBranchLifecycleState: null,
      },
      currentStage: "execution",
      stageStatus: "skipped",
      runStatus: "blocked",
      recoveryStatus: "blocked",
    })

    const recoveryRead = await getRecovery(base, fixture.eligibleRunId) as {
      recovery: { status: string; scope: string; scopeRef: string; summary: string; availableActions: string[] }
    }
    assert.equal(recoveryRead.recovery.status, "blocked")
    assert.equal(recoveryRead.recovery.scope, "stage")
    assert.equal(recoveryRead.recovery.scopeRef, "execution")
    assert.match(recoveryRead.recovery.summary, /manual review/i)
    assert.deepEqual(recoveryRead.recovery.availableActions, [])

    const runRead = await getRun(base, fixture.eligibleRunId) as { status: string; current_stage: string | null; recovery_status: string | null }
    assert.equal(runRead.status, "blocked")
    assert.equal(runRead.current_stage, "execution")
    assert.equal(runRead.recovery_status, "blocked")

    const treeRead = await getRunTree(base, fixture.eligibleRunId) as {
      run: { current_stage: string | null }
      stageRuns: Array<{ stage_key: string; status: string }>
    }
    assert.equal(treeRead.run.current_stage, "execution")
    assert.deepEqual(treeRead.stageRuns.map(stageRun => [stageRun.stage_key, stageRun.status]), [["execution", "skipped"]])

    const second = await postRecovery(base, fixture.eligibleRunId, { action: "skip_current_stage" })
    assert.equal(second.status, 409)
    assert.deepEqual(second.json, {
      ok: false,
      error: "recovery_action_ineligible",
      code: "invalid_transition",
      action: "skip_current_stage",
      reason: "current_stage_already_skipped",
      message: "Skip current stage is unavailable because the current stage is already recorded as skipped.",
    })
    assert.deepEqual((await getRunTree(base, fixture.eligibleRunId) as { stageRuns: Array<{ stage_key: string; status: string }> }).stageRuns.map(stageRun => [stageRun.stage_key, stageRun.status]), [["execution", "skipped"]])
  } finally {
    await stopServer(proc)
    rmSync(dir, { recursive: true, force: true })
  }
})

test("REQ-2 TC-REQ-2-04: ineligible skip_current_stage requests reject with specific reasons and no state changes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-run-skip-http-"))
  const dbPath = join(dir, "db.sqlite")
  const fixture = seedSkipFixtures(dbPath)
  const { proc, base } = startServer({
    BEERENGINEER_UI_DB_PATH: dbPath,
    BEERENGINEER_API_INSTANCE_ID: TEST_API_WORKER_INSTANCE_ID,
  })

  try {
    await waitForHealth(base)

    const noCurrentBefore = JSON.stringify({
      recovery: await getRecovery(base, fixture.noCurrentRunId),
      tree: await getRunTree(base, fixture.noCurrentRunId),
    })
    const inactiveBefore = JSON.stringify({
      recovery: await getRecovery(base, fixture.inactiveRunId),
      tree: await getRunTree(base, fixture.inactiveRunId),
    })
    const activeLeaseBefore = JSON.stringify({
      recovery: await getRecovery(base, fixture.activeLeaseRunId),
      tree: await getRunTree(base, fixture.activeLeaseRunId),
    })
    const terminalBefore = JSON.stringify({
      recovery: await getRecovery(base, fixture.terminalRunId),
      tree: await getRunTree(base, fixture.terminalRunId),
    })
    const skippedBefore = JSON.stringify({
      recovery: await getRecovery(base, fixture.skippedRunId),
      tree: await getRunTree(base, fixture.skippedRunId),
    })

    const noCurrent = await postRecovery(base, fixture.noCurrentRunId, { action: "skip_current_stage" })
    assert.equal(noCurrent.status, 409)
    assert.deepEqual(noCurrent.json, {
      ok: false,
      error: "recovery_action_ineligible",
      code: "invalid_transition",
      action: "skip_current_stage",
      reason: "no_current_stage",
      message: "Skip current stage is unavailable because the run has no current stage.",
    })

    const inactive = await postRecovery(base, fixture.inactiveRunId, { action: "skip_current_stage" })
    assert.equal(inactive.status, 409)
    assert.deepEqual(inactive.json, {
      ok: false,
      error: "recovery_action_ineligible",
      code: "invalid_transition",
      action: "skip_current_stage",
      reason: "current_stage_not_active",
      message: "Skip current stage is unavailable because the current stage is not active.",
    })

    const activeLease = await postRecovery(base, fixture.activeLeaseRunId, { action: "skip_current_stage" })
    assert.equal(activeLease.status, 409)
    assert.deepEqual(activeLease.json, {
      ok: false,
      error: "recovery_action_ineligible",
      code: "invalid_transition",
      action: "skip_current_stage",
      reason: "current_stage_worker_active",
      message: "Skip current stage is unavailable because a worker still holds the active stage lease.",
    })

    const terminal = await postRecovery(base, fixture.terminalRunId, { action: "skip_current_stage" })
    assert.equal(terminal.status, 409)
    assert.deepEqual(terminal.json, {
      ok: false,
      error: "recovery_action_ineligible",
      code: "invalid_transition",
      action: "skip_current_stage",
      reason: "current_stage_terminal",
      message: "Skip current stage is unavailable because the current stage is already terminal.",
    })

    const skipped = await postRecovery(base, fixture.skippedRunId, { action: "skip_current_stage" })
    assert.equal(skipped.status, 409)
    assert.deepEqual(skipped.json, {
      ok: false,
      error: "recovery_action_ineligible",
      code: "invalid_transition",
      action: "skip_current_stage",
      reason: "current_stage_already_skipped",
      message: "Skip current stage is unavailable because the current stage is already recorded as skipped.",
    })

    assert.equal(JSON.stringify({
      recovery: await getRecovery(base, fixture.noCurrentRunId),
      tree: await getRunTree(base, fixture.noCurrentRunId),
    }), noCurrentBefore)
    assert.equal(JSON.stringify({
      recovery: await getRecovery(base, fixture.inactiveRunId),
      tree: await getRunTree(base, fixture.inactiveRunId),
    }), inactiveBefore)
    assert.equal(JSON.stringify({
      recovery: await getRecovery(base, fixture.activeLeaseRunId),
      tree: await getRunTree(base, fixture.activeLeaseRunId),
    }), activeLeaseBefore)
    assert.equal(JSON.stringify({
      recovery: await getRecovery(base, fixture.terminalRunId),
      tree: await getRunTree(base, fixture.terminalRunId),
    }), terminalBefore)
    assert.equal(JSON.stringify({
      recovery: await getRecovery(base, fixture.skippedRunId),
      tree: await getRunTree(base, fixture.skippedRunId),
    }), skippedBefore)
  } finally {
    await stopServer(proc)
    rmSync(dir, { recursive: true, force: true })
  }
})

test("REQ-3 TC-REQ3-01/02: each clear action exists as its own HTTP action and mutates only the targeted stuck field", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-run-clear-http-"))
  const dbPath = join(dir, "db.sqlite")
  const fixture = seedClearFixtures(dbPath)
  const { proc, base } = startServer({ BEERENGINEER_UI_DB_PATH: dbPath })

  try {
    await waitForHealth(base)

    for (const testCase of CLEAR_ACTION_CASES) {
      const runId = fixture.populatedRunIds[testCase.action]
      const before = await getSupportedRecoveryState(base, runId)

      const accepted = await postRecovery(base, runId, { action: testCase.action })
      assert.equal(accepted.status, 200)
      assert.deepEqual(accepted.json, {
        ok: true,
        runId,
        action: testCase.action,
        outcome: "accepted",
        latestState: {
          recoveryPayloadJson: testCase.targetKey === "recovery_payload_json" ? null : before.recovery_payload_json,
          supabaseBranchRef: testCase.targetKey === "supabase_branch_ref" ? null : before.supabase_branch_ref,
          supabaseBranchLifecycleState: testCase.targetKey === "supabase_branch_lifecycle_state" ? null : before.supabase_branch_lifecycle_state,
        },
      })

      const after = await getSupportedRecoveryState(base, runId)
      assert.equal(after[testCase.targetKey], null)

      for (const key of Object.keys(before) as Array<keyof SupportedRecoveryState>) {
        if (key === testCase.targetKey) continue
        assert.equal(after[key], before[key], `${testCase.action} should not rewrite ${key}`)
      }
    }
  } finally {
    await stopServer(proc)
    rmSync(dir, { recursive: true, force: true })
  }
})

test("REQ-3 TC-REQ3-03/04: clear actions are idempotent both after a successful clear and when the targeted field already starts empty", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-run-clear-http-"))
  const dbPath = join(dir, "db.sqlite")
  const fixture = seedClearFixtures(dbPath)
  const { proc, base } = startServer({ BEERENGINEER_UI_DB_PATH: dbPath })

  try {
    await waitForHealth(base)

    for (const testCase of CLEAR_ACTION_CASES) {
      const populatedRunId = fixture.populatedRunIds[testCase.action]
      const first = await postRecovery(base, populatedRunId, { action: testCase.action })
      assert.equal(first.status, 200)
      const afterFirst = await getSupportedRecoveryState(base, populatedRunId)

      const second = await postRecovery(base, populatedRunId, { action: testCase.action })
      assert.equal(second.status, 200)
      assert.deepEqual(second.json, {
        ok: true,
        runId: populatedRunId,
        action: testCase.action,
        outcome: "noop",
        reason: "already_clear",
        latestState: {
          recoveryPayloadJson: afterFirst.recovery_payload_json,
          supabaseBranchRef: afterFirst.supabase_branch_ref,
          supabaseBranchLifecycleState: afterFirst.supabase_branch_lifecycle_state,
        },
      })
      assert.deepEqual(await getSupportedRecoveryState(base, populatedRunId), afterFirst)

      const alreadyClearRunId = fixture.alreadyClearRunIds[testCase.action]
      const beforeNoop = await getSupportedRecoveryState(base, alreadyClearRunId)
      const firstNoop = await postRecovery(base, alreadyClearRunId, { action: testCase.action })
      assert.equal(firstNoop.status, 200)
      assert.deepEqual(firstNoop.json, {
        ok: true,
        runId: alreadyClearRunId,
        action: testCase.action,
        outcome: "noop",
        reason: "already_clear",
        latestState: {
          recoveryPayloadJson: beforeNoop.recovery_payload_json,
          supabaseBranchRef: beforeNoop.supabase_branch_ref,
          supabaseBranchLifecycleState: beforeNoop.supabase_branch_lifecycle_state,
        },
      })
      assert.deepEqual(await getSupportedRecoveryState(base, alreadyClearRunId), beforeNoop)
    }
  } finally {
    await stopServer(proc)
    rmSync(dir, { recursive: true, force: true })
  }
})

test("REQ-3 TC-REQ3-05/06: clear actions reject extra mutation fields and multi-field clear attempts without changing state", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-run-clear-http-"))
  const dbPath = join(dir, "db.sqlite")
  const fixture = seedClearFixtures(dbPath)
  const { proc, base } = startServer({ BEERENGINEER_UI_DB_PATH: dbPath })

  try {
    await waitForHealth(base)

    for (const testCase of CLEAR_ACTION_CASES) {
      const runId = fixture.populatedRunIds[testCase.action]

      const beforeExtraField = await getSupportedRecoveryState(base, runId)
      const extraField = await postRecovery(base, runId, {
        action: testCase.action,
        summary: "unexpected",
      })
      assert.equal(extraField.status, 400)
      assert.deepEqual(extraField.json, {
        ok: false,
        error: "recovery_action_invalid_request",
        code: "bad_request",
        action: testCase.action,
        reason: "unexpected_fields",
        message: "This recovery action accepts only the action field.",
        fields: ["summary"],
      })
      assert.deepEqual(await getSupportedRecoveryState(base, runId), beforeExtraField)

      const beforeSiblingAttempt = await getSupportedRecoveryState(base, runId)
      const siblingAttempt = await postRecovery(base, runId, {
        action: testCase.action,
        [testCase.siblingAttemptKey]: null,
      })
      assert.equal(siblingAttempt.status, 400)
      assert.deepEqual(siblingAttempt.json, {
        ok: false,
        error: "recovery_action_invalid_request",
        code: "bad_request",
        action: testCase.action,
        reason: "unexpected_fields",
        message: "This recovery action accepts only the action field.",
        fields: [testCase.siblingAttemptKey],
      })
      assert.deepEqual(await getSupportedRecoveryState(base, runId), beforeSiblingAttempt)
    }
  } finally {
    await stopServer(proc)
    rmSync(dir, { recursive: true, force: true })
  }
})
