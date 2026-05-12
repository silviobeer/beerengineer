import assert from "node:assert/strict"
import { readFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import {
  mutateRunRecoveryActionInProcess,
  type RunRecoveryActionRequest,
} from "../src/core/runService.js"
import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { projectStageLogRow } from "../src/core/messagingProjection.js"

type OpenApiDocument = {
  components?: {
    schemas?: Record<string, unknown>
  }
}

function withRepos<T>(fn: (repos: Repos) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "be2-recovery-action-contract-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  try {
    return fn(repos)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

function createRunFixture(repos: Repos) {
  const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: "/tmp/demo" })
  const item = repos.createItem({ workspaceId: workspace.id, title: "Recovery Item", description: "desc" })
  const run = repos.createRun({ workspaceId: workspace.id, itemId: item.id, title: item.title, owner: "api", status: "running" })
  return { workspace, item, run }
}

function mutate(repos: Repos, runId: string, request: RunRecoveryActionRequest) {
  return mutateRunRecoveryActionInProcess(repos, { runId, ...request })
}

function loadOpenApi(): OpenApiDocument {
  return JSON.parse(readFileSync(new URL("../src/api/openapi.json", import.meta.url), "utf8")) as OpenApiDocument
}

test("SETUP-1 recovery service applies implemented clear actions through the authoritative seam", () => {
  withRepos(repos => {
    const { run } = createRunFixture(repos)
    repos.setRunRecoveryPayloadJson(run.id, "{\"status\":\"blocked\"}")
    repos.setRunRecoverySupabaseBranchRef(run.id, "br_demo")
    repos.setRunRecoverySupabaseLifecycleState(run.id, "retained")

    const result = mutate(repos, run.id, { action: "clear_recovery_payload" })

    assert.deepEqual(result, {
      ok: true,
      runId: run.id,
      action: "clear_recovery_payload",
      outcome: "accepted",
      latestState: {
        recoveryPayloadJson: null,
        supabaseBranchRef: "br_demo",
        supabaseBranchLifecycleState: "retained",
      },
    })

    const recoveryLog = repos.listLogsForRun(run.id).find(log => log.event_type === "run_recovery_action")
    assert.ok(recoveryLog, "expected accepted recovery action log")
    const projected = projectStageLogRow(recoveryLog!)
    assert.equal(projected?.type, "run_recovery_action")
    assert.equal(projected?.payload.action, "clear_recovery_payload")
    assert.equal(projected?.payload.outcome, "accepted")
  })
})

test("SETUP-1 clear actions return a canonical HTTP-200 noop when the targeted field is already clear", () => {
  withRepos(repos => {
    const { run } = createRunFixture(repos)

    const result = mutate(repos, run.id, { action: "clear_supabase_branch_ref" })

    assert.deepEqual(result, {
      ok: true,
      runId: run.id,
      action: "clear_supabase_branch_ref",
      outcome: "noop",
      reason: "already_clear",
      latestState: {
        recoveryPayloadJson: null,
        supabaseBranchRef: null,
        supabaseBranchLifecycleState: null,
      },
    })

    const recoveryLog = repos.listLogsForRun(run.id).find(log => log.event_type === "run_recovery_action")
    assert.ok(recoveryLog, "expected noop recovery action log")
    const projected = projectStageLogRow(recoveryLog!)
    assert.equal(projected?.payload.outcome, "noop")
    assert.equal(projected?.payload.reason, "already_clear")
  })
})

test("REQ-2 skip_current_stage records the current stage as skipped and blocks the run for manual review", () => {
  withRepos(repos => {
    const { run } = createRunFixture(repos)
    repos.updateRun(run.id, { status: "running", current_stage: "execution" })
    const stage = repos.createStageRun({ runId: run.id, stageKey: "execution" })

    const result = mutate(repos, run.id, { action: "skip_current_stage" })

    assert.deepEqual(result, {
      ok: true,
      runId: run.id,
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

    const stageAfter = repos.listStageRunsForRun(run.id).find(candidate => candidate.id === stage.id)
    assert.equal(stageAfter?.status, "skipped")
    const runAfter = repos.getRun(run.id)
    assert.equal(runAfter?.status, "blocked")
    assert.equal(runAfter?.current_stage, "execution")
    assert.equal(runAfter?.recovery_status, "blocked")
    assert.equal(runAfter?.recovery_scope, "stage")
    assert.equal(runAfter?.recovery_scope_ref, "execution")
  })
})

test("REQ-2 skip_current_stage rejects ineligible requests with specific reasons and no state change", () => {
  withRepos(repos => {
    const noCurrent = createRunFixture(repos).run

    const inactive = createRunFixture(repos).run
    repos.updateRun(inactive.id, { status: "blocked", current_stage: "planning" })
    repos.createStageRun({ runId: inactive.id, stageKey: "planning" })

    const terminal = createRunFixture(repos).run
    repos.updateRun(terminal.id, { status: "running", current_stage: "requirements" })
    const terminalStage = repos.createStageRun({ runId: terminal.id, stageKey: "requirements" })
    repos.completeStageRun(terminalStage.id, "completed")

    const activeLease = createRunFixture(repos).run
    repos.updateRun(activeLease.id, { status: "running", current_stage: "execution" })
    repos.createStageRun({ runId: activeLease.id, stageKey: "execution" })
    repos.claimRunWorkerLease(activeLease.id, {
      workerInstanceId: "cli-worker-active",
      workerOwnerKind: "cli",
      startedAt: Date.now(),
    })

    const skipped = createRunFixture(repos).run
    repos.updateRun(skipped.id, { status: "blocked", current_stage: "execution", recovery_status: "blocked", recovery_scope: "stage", recovery_scope_ref: "execution", recovery_summary: "Already skipped." })
    const skippedStage = repos.createStageRun({ runId: skipped.id, stageKey: "execution" })
    repos.completeStageRun(skippedStage.id, "skipped")

    const noCurrentBefore = JSON.stringify({ run: repos.getRun(noCurrent.id), logs: repos.listLogsForRun(noCurrent.id) })
    const inactiveBefore = JSON.stringify({ run: repos.getRun(inactive.id), logs: repos.listLogsForRun(inactive.id) })
    const terminalBefore = JSON.stringify({ run: repos.getRun(terminal.id), logs: repos.listLogsForRun(terminal.id) })
    const activeLeaseBefore = JSON.stringify({ run: repos.getRun(activeLease.id), logs: repos.listLogsForRun(activeLease.id) })
    const skippedBefore = JSON.stringify({ run: repos.getRun(skipped.id), logs: repos.listLogsForRun(skipped.id) })

    assert.deepEqual(mutate(repos, noCurrent.id, { action: "skip_current_stage" }), {
      ok: false,
      status: 409,
      error: "recovery_action_ineligible",
      code: "invalid_transition",
      action: "skip_current_stage",
      reason: "no_current_stage",
      message: "Skip current stage is unavailable because the run has no current stage.",
    })
    assert.deepEqual(mutate(repos, inactive.id, { action: "skip_current_stage" }), {
      ok: false,
      status: 409,
      error: "recovery_action_ineligible",
      code: "invalid_transition",
      action: "skip_current_stage",
      reason: "current_stage_not_active",
      message: "Skip current stage is unavailable because the current stage is not active.",
    })
    assert.deepEqual(mutate(repos, terminal.id, { action: "skip_current_stage" }), {
      ok: false,
      status: 409,
      error: "recovery_action_ineligible",
      code: "invalid_transition",
      action: "skip_current_stage",
      reason: "current_stage_terminal",
      message: "Skip current stage is unavailable because the current stage is already terminal.",
    })
    assert.deepEqual(mutate(repos, activeLease.id, { action: "skip_current_stage" }), {
      ok: false,
      status: 409,
      error: "recovery_action_ineligible",
      code: "invalid_transition",
      action: "skip_current_stage",
      reason: "current_stage_worker_active",
      message: "Skip current stage is unavailable because a worker still holds the active stage lease.",
    })
    assert.deepEqual(mutate(repos, skipped.id, { action: "skip_current_stage" }), {
      ok: false,
      status: 409,
      error: "recovery_action_ineligible",
      code: "invalid_transition",
      action: "skip_current_stage",
      reason: "current_stage_already_skipped",
      message: "Skip current stage is unavailable because the current stage is already recorded as skipped.",
    })

    assert.equal(JSON.stringify({ run: repos.getRun(noCurrent.id), logs: repos.listLogsForRun(noCurrent.id) }), noCurrentBefore)
    assert.equal(JSON.stringify({ run: repos.getRun(inactive.id), logs: repos.listLogsForRun(inactive.id) }), inactiveBefore)
    assert.equal(JSON.stringify({ run: repos.getRun(terminal.id), logs: repos.listLogsForRun(terminal.id) }), terminalBefore)
    assert.equal(JSON.stringify({ run: repos.getRun(activeLease.id), logs: repos.listLogsForRun(activeLease.id) }), activeLeaseBefore)
    assert.equal(JSON.stringify({ run: repos.getRun(skipped.id), logs: repos.listLogsForRun(skipped.id) }), skippedBefore)
  })
})

test("SETUP-1 runs route delegates recovery mutations to the authoritative service seam instead of mutating repos directly", () => {
  const runs = readFileSync(new URL("../src/api/routes/runs.ts", import.meta.url), "utf8")
  const start = runs.indexOf("export async function handleMutateRecovery")
  const end = runs.indexOf("/**\n * Resume a blocked run.", start)
  const handler = runs.slice(start, end)

  assert.match(handler, /mutateRunRecoveryActionInProcess/)
  assert.doesNotMatch(handler, /setRunRecoveryPayloadJson|setRunRecoverySupabaseBranchRef|setRunRecoverySupabaseLifecycleState/)
})

test("SETUP-1 OpenAPI and prose reserve the single recovery-action family and its accepted/noop/rejection vocabulary", () => {
  const document = loadOpenApi()
  const schemas = document.components?.schemas ?? {}
  const request = schemas.RecoveryActionRequest as {
    oneOf?: Array<{
      additionalProperties?: boolean
      properties?: {
        action?: {
          enum?: string[]
        }
      }
    }>
  }
  const result = schemas.RecoveryActionResult as {
    oneOf?: Array<{
      properties?: Record<string, { enum?: string[] }>
      required?: string[]
    }>
  }
  const rejection = schemas.RecoveryActionRejection as {
    properties?: Record<string, { enum?: string[] }>
  }
  const docs = readFileSync(new URL("../../../docs/api-contract.md", import.meta.url), "utf8")

  const requestVariants = request.oneOf ?? []
  const clearRequest = requestVariants.find(option => option.properties?.action?.enum?.includes("clear_recovery_payload"))
  const generalRequest = requestVariants.find(option => option.properties?.action?.enum?.includes("resume"))

  assert.deepEqual(clearRequest?.properties?.action?.enum, [
    "clear_recovery_payload",
    "clear_supabase_branch_ref",
    "clear_supabase_branch_lifecycle_state",
  ])
  assert.equal(clearRequest?.additionalProperties, false)
  assert.deepEqual(generalRequest?.properties?.action?.enum, [
    "resume",
    "replan",
    "retry_supabase_readiness",
    "skip_current_stage",
    "recover_fresh_branch",
    "retry_retained",
    "clear_and_fresh",
  ])

  const outcomes = result.oneOf?.flatMap(option => option.properties?.outcome?.enum ?? []) ?? []
  assert.ok(outcomes.includes("accepted"))
  assert.ok(outcomes.includes("noop"))
  const rejectionErrors = rejection.properties?.error?.enum ?? []
  assert.ok(rejectionErrors.includes("recovery_action_invalid_request"))
  const rejectionReasons = rejection.properties?.reason?.enum ?? []
  assert.ok(rejectionReasons.includes("action_required"))
  assert.ok(rejectionReasons.includes("unsupported_action"))
  assert.ok(rejectionReasons.includes("unexpected_fields"))
  assert.ok(rejectionReasons.includes("action_not_implemented"))
  assert.ok(rejectionReasons.includes("incompatible_recovery_state"))
  assert.ok(rejectionReasons.includes("no_current_stage"))
  assert.ok(rejectionReasons.includes("current_stage_not_active"))
  assert.ok(rejectionReasons.includes("current_stage_terminal"))
  assert.ok(rejectionReasons.includes("current_stage_worker_active"))
  assert.ok(rejectionReasons.includes("current_stage_already_skipped"))

  assert.match(docs, /Canonical recovery mutation surface for named recovery, skip, and narrow clear actions\./)
  assert.match(docs, /The implemented skip action is `skip_current_stage`; it records the active current stage as skipped and leaves the run blocked for manual review without auto-advancing\./)
  assert.match(docs, /skip_current_stage` is offered only when the run has an active non-terminal current stage that is not already recorded as skipped and no live worker still holds the stage lease; ineligible requests reject with specific reasons such as `no_current_stage`, `current_stage_not_active`, `current_stage_worker_active`, `current_stage_terminal`, and `current_stage_already_skipped`\./)
  assert.match(docs, /The implemented named path-changing actions are `recover_fresh_branch`, `retry_retained`, and `clear_and_fresh`\./)
  assert.match(docs, /the contract-defined post-action values are `fresh_path_recovery` and `retained_path_recovery`\./)
  assert.match(docs, /Implemented clear actions return `outcome: "accepted"` when they changed latest state and `outcome: "noop"` with `reason: "already_clear"` when the targeted field was already clear\./)
  assert.match(docs, /Implemented clear actions accept only `\{ action \}`; extra mutation fields or attempts to clear additional fields in the same request are rejected with `400 bad_request`, `reason: "unexpected_fields"`, and no state change\./)
  assert.match(docs, /Incompatible named requests are rejected with `409` and the machine-readable reason `incompatible_recovery_state`, leaving the run unchanged\./)
})
