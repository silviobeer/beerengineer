import { test } from "node:test"
import assert from "node:assert/strict"
import { Readable } from "node:stream"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { handleGetRecovery, handleResumeRun } from "../../../src/api/routes/runs.js"
import { writeRecoveryRecord } from "../../../src/core/recovery.js"
import { buildSupabaseProvisioningRecoveryPayload } from "../../../src/core/supabase/recoveryPayload.js"
import { layout } from "../../../src/core/workspaceLayout.js"
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
