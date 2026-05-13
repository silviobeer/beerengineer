import { test } from "node:test"
import assert from "node:assert/strict"
import { Readable } from "node:stream"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { handleClearAndFreshRecovery, handleGetRecovery, handleResumeRun, handleRetryRetainedRecovery, handleSkipCurrentStageRecovery } from "../../../src/api/routes/runs.js"
import { writeRecoveryRecord } from "../../../src/core/recovery.js"
import { buildSupabaseProvisioningRecoveryPayload } from "../../../src/core/supabase/recoveryPayload.js"
import { layout } from "../../../src/core/workspaceLayout.js"
import { claimWorkerLease } from "../../../src/core/workerLease.js"
import { initDatabase } from "../../../src/db/connection.js"
import { Repos } from "../../../src/db/repositories.js"

function jsonReq(body: unknown) {
  return Readable.from([JSON.stringify(body)]) as never
}

function captureRes() {
  const state: { status?: number; body?: string } = {}
  return {
    res: {
      writeHead(status: number) { state.status = status; return this },
      end(body: string) { state.body = body },
    } as never,
    state,
  }
}

function parseBody(state: ReturnType<typeof captureRes>["state"]): Record<string, unknown> {
  return state.body ? JSON.parse(state.body) as Record<string, unknown> : {}
}

function setupFixture() {
  const root = mkdtempSync(join(tmpdir(), "be2-run-recovery-decision-"))
  const db = initDatabase(join(root, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "alpha", name: "Alpha", rootPath: root })
  const item = repos.createItem({ workspaceId: workspace.id, title: "Blocked run", description: "desc" })
  const run = repos.createRun({
    workspaceId: workspace.id,
    itemId: item.id,
    title: item.title,
    owner: "api",
    workspaceFsId: "run-recovery-decision",
  })
  const ctx = { workspaceId: "run-recovery-decision", workspaceRoot: root, runId: run.id }

  mkdirSync(layout.runDir(ctx), { recursive: true })
  writeFileSync(layout.runFile(ctx), `${JSON.stringify({ id: run.id }, null, 2)}\n`)

  return {
    root,
    db,
    repos,
    workspace,
    item,
    run,
    ctx,
    cleanup() {
      db.close()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

async function seedRetainedDiagnosisRun(fx: ReturnType<typeof setupFixture>): Promise<void> {
  fx.repos.setRunSupabaseBranch(fx.run.id, {
    ref: "br_retained",
    name: "wave-1",
    lifecycleState: "retained-for-diagnosis",
  })
  fx.repos.updateRun(fx.run.id, {
    status: "blocked",
    current_stage: "execution",
    recovery_status: "blocked",
    recovery_scope: "run",
    recovery_scope_ref: null,
    recovery_summary: "Supabase provisioning failed during validation.",
    recovery_payload_json: buildSupabaseProvisioningRecoveryPayload({
      runId: fx.run.id,
      workspaceId: fx.workspace.id,
      workspaceKey: fx.workspace.key,
      projectRef: "proj_alpha",
      waveId: "W1",
      waveNumber: 1,
      branchRef: "br_retained",
      failedStep: "validate",
      failureCause: "Migration smoke test failed",
      userMessage: "Supabase provisioning failed. Operator recovery action is required.",
    }),
  })
  await writeRecoveryRecord(fx.ctx, {
    status: "blocked",
    cause: "stage_error",
    scope: { type: "run", runId: fx.run.id },
    summary: "Supabase provisioning failed during validation.",
    detail: "seeded retained diagnosis recovery",
    evidencePaths: [layout.runDir(fx.ctx)],
  })
}

function seedCurrentStage(
  fx: ReturnType<typeof setupFixture>,
  input: {
    stageKey?: string
    runStatus?: string
    stageStatus?: "running" | "completed" | "failed" | "skipped"
  } = {},
) {
  const stageKey = input.stageKey ?? "execution"
  const runStatus = input.runStatus ?? "blocked"
  const stageRun = fx.repos.createStageRun({
    runId: fx.run.id,
    stageKey,
  })
  if (input.stageStatus && input.stageStatus !== "running") {
    fx.repos.completeStageRun(stageRun.id, input.stageStatus)
  }
  fx.repos.updateRun(fx.run.id, {
    status: runStatus,
    current_stage: stageKey,
  })
  return stageRun
}

test("REQ-1 AC-1.1/AC-1.2/AC-1.4: retained diagnosis resume returns an explicit operator-decision conflict without side effects", async () => {
  const fx = setupFixture()
  try {
    await seedRetainedDiagnosisRun(fx)

    const before = fx.repos.getRun(fx.run.id)
    const { res, state } = captureRes()
    await handleResumeRun(fx.repos, jsonReq({ summary: "Try resume" }), res, fx.run.id)

    assert.equal(state.status, 409)
    assert.deepEqual(parseBody(state), {
      error: "operator_decision_required",
      code: "operator_decision_required",
      message: "Run requires an explicit operator decision before recovery can continue.",
      decision: {
        kind: "operator_decision_required",
        reason: "retained_diagnosis_branch",
        nextActions: ["retry-retained", "clear-and-fresh"],
        branchRef: "br_retained",
      },
    })

    const after = fx.repos.getRun(fx.run.id)
    assert.equal(fx.repos.listExternalRemediations(fx.run.id).length, 0)
    assert.equal(after?.status, before?.status)
    assert.equal(after?.recovery_status, before?.recovery_status)
    assert.equal(after?.recovery_summary, before?.recovery_summary)
    assert.equal(after?.recovery_payload_json, before?.recovery_payload_json)
    assert.equal(after?.supabase_branch_lifecycle_state, "retained-for-diagnosis")
    assert.equal(after?.supabase_branch_ref, "br_retained")
  } finally {
    fx.cleanup()
  }
})

test("REQ-1 AC-1.3/AC-1.4: recovery read-model mirrors the retained diagnosis decision after resume is rejected", async () => {
  const fx = setupFixture()
  try {
    await seedRetainedDiagnosisRun(fx)

    const { res: resumeRes } = captureRes()
    await handleResumeRun(fx.repos, jsonReq({ summary: "Try resume" }), resumeRes, fx.run.id)

    const { res, state } = captureRes()
    handleGetRecovery(fx.repos, res, fx.run.id)

    assert.equal(state.status, 200)
    assert.deepEqual(parseBody(state), {
      recovery: {
        status: "blocked",
        scope: "run",
        scopeRef: null,
        summary: "Supabase provisioning failed during validation.",
        recovery_user_message: "Supabase provisioning failed. Operator recovery action is required.",
        decision: {
          kind: "operator_decision_required",
          reason: "retained_diagnosis_branch",
          nextActions: ["retry-retained", "clear-and-fresh"],
          branchRef: "br_retained",
        },
        resumable: false,
        remediations: [],
      },
    })
  } finally {
    fx.cleanup()
  }
})

test("REQ-1 AC-1.1/AC-1.3: retained diagnosis still returns the operator decision when the provisioning payload is malformed", async () => {
  const fx = setupFixture()
  try {
    fx.repos.setRunSupabaseBranch(fx.run.id, {
      ref: "br_retained",
      name: "wave-1",
      lifecycleState: "retained-for-diagnosis",
    })
    fx.repos.updateRun(fx.run.id, {
      status: "blocked",
      current_stage: "execution",
      recovery_status: "blocked",
      recovery_scope: "run",
      recovery_scope_ref: null,
      recovery_summary: "Supabase provisioning failed during validation.",
      recovery_payload_json: "{not json",
    })
    await writeRecoveryRecord(fx.ctx, {
      status: "blocked",
      cause: "stage_error",
      scope: { type: "run", runId: fx.run.id },
      summary: "Supabase provisioning failed during validation.",
      detail: "seeded retained diagnosis recovery with malformed payload",
      evidencePaths: [layout.runDir(fx.ctx)],
    })

    const { res, state } = captureRes()
    await handleResumeRun(fx.repos, jsonReq({ summary: "Try resume" }), res, fx.run.id)

    assert.equal(state.status, 409)
    assert.deepEqual(parseBody(state), {
      error: "operator_decision_required",
      code: "operator_decision_required",
      message: "Run requires an explicit operator decision before recovery can continue.",
      decision: {
        kind: "operator_decision_required",
        reason: "retained_diagnosis_branch",
        nextActions: ["retry-retained", "clear-and-fresh"],
        branchRef: "br_retained",
      },
    })
  } finally {
    fx.cleanup()
  }
})

test("REQ-1 AC-1.1: retained diagnosis conflict is specialized and does not replace existing generic resume blockers", async () => {
  const retained = setupFixture()
  const generic = setupFixture()
  try {
    await seedRetainedDiagnosisRun(retained)

    generic.repos.updateRun(generic.run.id, {
      status: "blocked",
      recovery_status: "blocked",
      recovery_scope: "run",
      recovery_scope_ref: null,
      recovery_summary: "Generic blocked recovery",
    })
    generic.repos.createPendingPrompt({
      runId: generic.run.id,
      prompt: "Answer this first",
    })

    const { res: retainedRes, state: retainedState } = captureRes()
    await handleResumeRun(retained.repos, jsonReq({ summary: "Try resume" }), retainedRes, retained.run.id)
    const { res: genericRes, state: genericState } = captureRes()
    await handleResumeRun(generic.repos, jsonReq({ summary: "Try resume" }), genericRes, generic.run.id)

    assert.equal(retainedState.status, 409)
    assert.equal(genericState.status, 409)
    assert.equal(parseBody(retainedState).error, "operator_decision_required")
    assert.equal(parseBody(genericState).error, "open_prompt")
    assert.equal("decision" in parseBody(genericState), false)
  } finally {
    retained.cleanup()
    generic.cleanup()
  }
})

test("REQ-2 AC-2.1: non-retained recovery detail does not advertise retry-retained", async () => {
  const fx = setupFixture()
  try {
    fx.repos.updateRun(fx.run.id, {
      status: "blocked",
      current_stage: "execution",
      recovery_status: "blocked",
      recovery_scope: "run",
      recovery_scope_ref: null,
      recovery_summary: "Generic blocked recovery",
    })
    await writeRecoveryRecord(fx.ctx, {
      status: "blocked",
      cause: "stage_error",
      scope: { type: "run", runId: fx.run.id },
      summary: "Generic blocked recovery",
      detail: "seeded generic recovery",
      evidencePaths: [layout.runDir(fx.ctx)],
    })

    const { res, state } = captureRes()
    handleGetRecovery(fx.repos, res, fx.run.id)

    assert.equal(state.status, 200)
    assert.deepEqual(parseBody(state), {
      recovery: {
        status: "blocked",
        scope: "run",
        scopeRef: null,
        summary: "Generic blocked recovery",
        recovery_user_message: null,
        decision: null,
        resumable: true,
        remediations: [],
      },
    })
  } finally {
    fx.cleanup()
  }
})

test("REQ-2 AC-2.4: stale retry-retained requests return a conflict with the authoritative current state and start no recovery work", async () => {
  const fx = setupFixture()
  try {
    await seedRetainedDiagnosisRun(fx)
    fx.repos.updateRun(fx.run.id, {
      status: "failed",
      recovery_status: "failed",
      recovery_summary: "Run has already moved on.",
      recovery_payload_json: null,
    })
    fx.repos.clearRunSupabaseBranch(fx.run.id)

    const { res, state } = captureRes()
    await handleRetryRetainedRecovery(fx.repos, jsonReq({}), res, fx.run.id)

    assert.equal(state.status, 409)
    assert.deepEqual(parseBody(state), {
      error: "retry_retained_conflict",
      code: "retry_retained_conflict",
      message: "retry-retained is only available while the run is retained for diagnosis.",
      currentState: {
        status: "failed",
        recoveryStatus: "failed",
        supabaseBranchLifecycleState: null,
      },
    })
    assert.equal(fx.repos.listExternalRemediations(fx.run.id).length, 0)
    assert.equal(fx.repos.listLogsForRun(fx.run.id).some(log => log.event_type === "run_resumed"), false)
  } finally {
    fx.cleanup()
  }
})

test("REQ-3 AC-3.6: stale clear-and-fresh requests return a conflict with the authoritative current state and start no cleanup or recovery work", async () => {
  const fx = setupFixture()
  try {
    await seedRetainedDiagnosisRun(fx)
    fx.repos.updateRun(fx.run.id, {
      status: "failed",
      recovery_status: "failed",
      recovery_summary: "Run has already moved on.",
      recovery_payload_json: null,
    })
    fx.repos.clearRunSupabaseBranch(fx.run.id)

    const { res, state } = captureRes()
    await handleClearAndFreshRecovery(fx.repos, jsonReq({}), res, fx.run.id)

    assert.equal(state.status, 409)
    assert.deepEqual(parseBody(state), {
      error: "clear_and_fresh_conflict",
      code: "clear_and_fresh_conflict",
      message: "clear-and-fresh is only available while the run is retained for diagnosis.",
      currentState: {
        status: "failed",
        recoveryStatus: "failed",
        supabaseBranchLifecycleState: null,
      },
    })
    assert.equal(fx.repos.listExternalRemediations(fx.run.id).length, 0)
    assert.equal(fx.repos.listLogsForRun(fx.run.id).some(log => log.event_type === "run_resumed"), false)
    assert.equal(
      fx.repos.listLogsForRun(fx.run.id).some(log => log.event_type === "supabase_branch_lifecycle"),
      false,
    )
  } finally {
    fx.cleanup()
  }
})

test("REQ-2 AC-1/AC-2: skip-current-stage accepts an eligible current stage, marks it skipped, and keeps the run paused", async () => {
  const freshLeaseTime = Date.now() - 5 * 60_000
  for (const leaseMode of ["no_lease", "stale_lease"] as const) {
    const fx = setupFixture()
    try {
      const stageRun = seedCurrentStage(fx)
      fx.repos.setItemCurrentStage(fx.item.id, "execution")
      if (leaseMode === "stale_lease") {
        claimWorkerLease(fx.repos, {
          runId: fx.run.id,
          workerInstanceId: "cli-stale",
          workerOwnerKind: "cli",
          now: freshLeaseTime,
        })
      }

      const { res, state } = captureRes()
      await handleSkipCurrentStageRecovery(fx.repos, jsonReq({}), res, fx.run.id)

      assert.equal(state.status, 200)
      assert.deepEqual(parseBody(state), {
        ok: true,
        runId: fx.run.id,
        status: "blocked",
        recoveryStatus: "blocked",
      })

      const run = fx.repos.getRun(fx.run.id)
      assert.equal(run?.status, "blocked")
      assert.equal(run?.current_stage, "execution")
      assert.equal(run?.recovery_status, "blocked")
      assert.equal(run?.recovery_scope, "stage")
      assert.equal(run?.recovery_scope_ref, "execution")
      assert.match(run?.recovery_summary ?? "", /skipped current stage/i)
      assert.equal(fx.repos.getItem(fx.item.id)?.current_stage, null)

      const stageRuns = fx.repos.listStageRunsForRun(fx.run.id)
      assert.equal(stageRuns.length, 1)
      assert.equal(stageRuns[0]?.id, stageRun.id)
      assert.equal(stageRuns[0]?.status, "skipped")
      assert.ok(stageRuns[0]?.completed_at)
    } finally {
      fx.cleanup()
    }
  }
})

test("REQ-2 AC-3: skip-current-stage rejects runs with no current stage and leaves state unchanged", async () => {
  const fx = setupFixture()
  try {
    const before = fx.repos.getRun(fx.run.id)
    const beforeStageRuns = fx.repos.listStageRunsForRun(fx.run.id)

    const { res, state } = captureRes()
    await handleSkipCurrentStageRecovery(fx.repos, jsonReq({}), res, fx.run.id)

    assert.equal(state.status, 409)
    assert.equal(parseBody(state).error, "skip_current_stage_not_allowed")
    assert.deepEqual(fx.repos.getRun(fx.run.id), before)
    assert.deepEqual(fx.repos.listStageRunsForRun(fx.run.id), beforeStageRuns)
  } finally {
    fx.cleanup()
  }
})

test("REQ-2 AC-3: skip-current-stage rejects terminal, already-skipped, and live-worker current stages without mutating the run", async () => {
  for (const input of [
    { label: "completed", stageStatus: "completed" as const },
    { label: "failed", stageStatus: "failed" as const },
    { label: "skipped", stageStatus: "skipped" as const },
    { label: "live-worker", stageStatus: "running" as const, liveLease: true },
  ]) {
    const fx = setupFixture()
    try {
      seedCurrentStage(fx, { stageStatus: input.stageStatus })
      if (input.liveLease) {
        claimWorkerLease(fx.repos, {
          runId: fx.run.id,
          workerInstanceId: "cli-live",
          workerOwnerKind: "cli",
          now: Date.now(),
        })
      }
      const before = fx.repos.getRun(fx.run.id)
      const beforeStageRuns = fx.repos.listStageRunsForRun(fx.run.id)

      const { res, state } = captureRes()
      await handleSkipCurrentStageRecovery(fx.repos, jsonReq({}), res, fx.run.id)

      assert.equal(state.status, 409, input.label)
      assert.equal(parseBody(state).error, "skip_current_stage_not_allowed", input.label)
      assert.deepEqual(fx.repos.getRun(fx.run.id), before, input.label)
      assert.deepEqual(fx.repos.listStageRunsForRun(fx.run.id), beforeStageRuns, input.label)
    } finally {
      fx.cleanup()
    }
  }
})

test("REQ-2 edge: a second skip-current-stage request is rejected as already skipped and preserves the paused state", async () => {
  const fx = setupFixture()
  try {
    seedCurrentStage(fx)

    const first = captureRes()
    await handleSkipCurrentStageRecovery(fx.repos, jsonReq({}), first.res, fx.run.id)
    assert.equal(first.state.status, 200)

    const afterFirstRun = fx.repos.getRun(fx.run.id)
    const afterFirstStageRuns = fx.repos.listStageRunsForRun(fx.run.id)

    const second = captureRes()
    await handleSkipCurrentStageRecovery(fx.repos, jsonReq({}), second.res, fx.run.id)

    assert.equal(second.state.status, 409)
    assert.equal(parseBody(second.state).error, "skip_current_stage_not_allowed")
    assert.deepEqual(fx.repos.getRun(fx.run.id), afterFirstRun)
    assert.deepEqual(fx.repos.listStageRunsForRun(fx.run.id), afterFirstStageRuns)
  } finally {
    fx.cleanup()
  }
})
