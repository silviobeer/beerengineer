import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createBus, busToWorkflowIO } from "../src/core/bus.js"
import { writeRecoveryRecord } from "../src/core/recovery.js"
import { performResume } from "../src/core/resume.js"
import { createSupabaseAdapter } from "../src/core/supabase/adapter.js"
import { waveBranchName } from "../src/core/supabase/branchNaming.js"
import {
  attachSupabaseBranchToRunRecovery,
  discardSupabaseBranchFromRunRecovery,
} from "../src/core/supabase/runRecoveryActions.js"
import {
  recordSupabaseProvisioningBlockedRun,
  type SupabaseProvisioningFailure,
} from "../src/core/supabase/provisioningRecovery.js"
import {
  buildSupabaseProvisioningRecoveryPayload,
  parseSupabaseProvisioningRecoveryPayload,
} from "../src/core/supabase/recoveryPayload.js"
import type { SupabaseBranch } from "../src/core/supabase/types.js"
import type { SupabaseWorkflowHook } from "../src/core/supabase/workflowHook.js"
import { layout, type WorkflowContext } from "../src/core/workspaceLayout.js"
import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { provisionWaveIfDbRelevant } from "../src/stages/execution/supabaseWaveGate.js"
import type { WaveDefinition } from "../src/types.js"

function wave(): WaveDefinition {
  return {
    id: "wave-1",
    number: 1,
    goal: "Recover blocked Supabase provisioning",
    kind: "feature",
    stories: [{ id: "REQ-2", title: "Idempotent retry", dbRelevant: true }],
    dbRelevantStoryCount: 1,
    dbRelevantWave: true,
    internallyParallelizable: false,
    dependencies: [],
    exitCriteria: [],
  }
}

function workflowContext(root: string, workspaceFsId: string, runId: string): WorkflowContext {
  return {
    workspaceId: workspaceFsId,
    workspaceRoot: root,
    runId,
  }
}

function fakeProvider(input: {
  branches: SupabaseBranch[]
  validateError?: string
}) {
  const calls = {
    createBranch: 0,
    getBranch: [] as string[],
    listBranches: 0,
    runQuery: 0,
  }

  return {
    branches: input.branches,
    calls,
    client: {
      listBranches: async () => {
        calls.listBranches += 1
        return input.branches.map(branch => ({ ...branch }))
      },
      createBranch: async (_projectRef: string, request: { name: string; parentRef?: string }) => {
        calls.createBranch += 1
        const created = {
          id: `created-${calls.createBranch}`,
          ref: `created-${calls.createBranch}`,
          name: request.name,
          status: "ACTIVE_HEALTHY",
          parentRef: request.parentRef,
        } satisfies SupabaseBranch
        input.branches.push(created)
        return created
      },
      getBranch: async (_projectRef: string, branchRef: string) => {
        calls.getBranch.push(branchRef)
        const branch = input.branches.find(candidate => candidate.ref === branchRef)
        if (!branch) {
          const err = new Error(`Supabase branch ${branchRef} not found`) as Error & { status?: number }
          err.status = 404
          throw err
        }
        return { ...branch }
      },
      runQuery: async () => {
        calls.runQuery += 1
        if (input.validateError) throw new Error(input.validateError)
        return { rows: [] }
      },
    },
  }
}

function expectedWaveBranchName(input: {
  workspaceKey: string
  runId: string
  itemId: string
  projectId: string
  waveId: string
}): string {
  return waveBranchName({
    workspace: input.workspaceKey,
    runId: input.runId,
    itemId: input.itemId,
    projectId: input.projectId,
    waveId: input.waveId,
  })
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "be2-supabase-provisioning-resume-"))
  mkdirSync(dir, { recursive: true })
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "alpha", name: "Alpha", rootPath: dir })
  repos.connectWorkspaceSupabase(workspace.id, { projectRef: "proj_alpha", region: "eu-central-1" })
  const item = repos.createItem({ workspaceId: workspace.id, title: "DB item", description: "needs db" })
  const run = repos.createRun({
    workspaceId: workspace.id,
    itemId: item.id,
    title: item.title,
    owner: "api",
    workspaceFsId: "supabase-recovery-run",
  })
  const projectId = "proj-1"
  const currentWave = wave()
  const ctx = workflowContext(dir, "supabase-recovery-run", run.id)
  const expectedName = expectedWaveBranchName({
    workspaceKey: workspace.key,
    runId: run.id,
    itemId: item.id,
    projectId,
    waveId: currentWave.id,
  })

  mkdirSync(layout.runDir(ctx), { recursive: true })
  writeFileSync(layout.runFile(ctx), `${JSON.stringify({ id: run.id }, null, 2)}\n`)

  return {
    dir,
    db,
    repos,
    workspace,
    item,
    run,
    ctx,
    currentWave,
    projectId,
    expectedName,
    close() {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

async function seedBlockedProvisioningRun(
  ctx: ReturnType<typeof fixture>,
  input: {
    branchRef?: string
    runBranchRef?: string
    runBranchName?: string
    payloadProjectRef?: string
    payloadWaveId?: string
  } = {},
): Promise<void> {
  const summary = "Supabase provisioning failed during branch validation: original failure"
  if (input.runBranchRef) {
    ctx.repos.setRunSupabaseBranch(ctx.run.id, {
      ref: input.runBranchRef,
      name: input.runBranchName ?? ctx.expectedName,
      lifecycleState: "retained-for-diagnosis",
    })
  }
  ctx.repos.updateRun(ctx.run.id, {
    status: "blocked",
    current_stage: null,
    recovery_status: "blocked",
    recovery_scope: "run",
    recovery_scope_ref: null,
    recovery_summary: summary,
    recovery_payload_json: buildSupabaseProvisioningRecoveryPayload({
      runId: ctx.run.id,
      workspaceId: ctx.workspace.id,
      workspaceKey: ctx.workspace.key,
      projectRef: input.payloadProjectRef ?? "proj_alpha",
      waveId: input.payloadWaveId ?? ctx.currentWave.id,
      waveNumber: ctx.currentWave.number,
      branchRef: input.branchRef,
      failedStep: "validate",
      failureCause: "Original provisioning failure",
      userMessage: "Supabase provisioning failed. Operator recovery action is required.",
    }),
  })
  await writeRecoveryRecord(ctx.ctx, {
    status: "blocked",
    cause: "stage_error",
    scope: { type: "run", runId: ctx.run.id },
    summary,
    detail: "seeded blocked provisioning run",
    evidencePaths: [layout.runDir(ctx.ctx)],
  })
}

async function resumeOnce(
  ctx: ReturnType<typeof fixture>,
  provider: ReturnType<typeof fakeProvider>,
  input: {
    forcedFailure?: SupabaseProvisioningFailure
  } = {},
): Promise<void> {
  const bus = createBus()
  const io = busToWorkflowIO(bus)
  const remediation = ctx.repos.createExternalRemediation({
    runId: ctx.run.id,
    scope: "run",
    summary: "Operator retried the blocked Supabase run.",
    branch: "item/db-item",
    source: "api",
  })
  const adapter = createSupabaseAdapter({ repos: ctx.repos, client: provider.client })
  const hook: SupabaseWorkflowHook = {
    repos: ctx.repos,
    adapter,
    workspaceId: ctx.workspace.id,
    projectRef: "proj_alpha",
    dbMode: "branching",
    parentBranchRef: "branch_parent",
    protectionSwitch: "off",
    cleanupPolicy: "manual",
  }

  try {
    await performResume({
      repos: ctx.repos,
      io,
      runId: ctx.run.id,
      remediation,
      supabaseHook: hook,
      workflowRunner: async () => {
        const result = await provisionWaveIfDbRelevant({
          wave: ctx.currentWave,
          adapter,
          repos: ctx.repos,
          context: {
            workspaceId: ctx.workspace.id,
            workspaceKey: ctx.workspace.key,
            workspaceRoot: ctx.dir,
            runId: ctx.run.id,
            itemId: ctx.item.id,
            projectId: ctx.projectId,
            projectRef: "proj_alpha",
            parentBranchRef: "branch_parent",
            dbMode: "branching",
          },
        })
        if (result.ok) {
          if (!input.forcedFailure) return
          await recordSupabaseProvisioningBlockedRun({
            repos: ctx.repos,
            ctx: ctx.ctx,
            runId: ctx.run.id,
            wave: ctx.currentWave,
            projectRef: "proj_alpha",
            failure: {
              ...input.forcedFailure,
              branchRef: input.forcedFailure.branchRef ?? result.branchRef,
            },
            itemId: ctx.item.id,
            title: ctx.item.title,
          })
          throw new Error("Supabase recovery remains blocked")
        }
        await recordSupabaseProvisioningBlockedRun({
          repos: ctx.repos,
          ctx: ctx.ctx,
          runId: ctx.run.id,
          wave: ctx.currentWave,
          projectRef: "proj_alpha",
          failure: result as SupabaseProvisioningFailure,
          itemId: ctx.item.id,
          title: ctx.item.title,
        })
        throw new Error("Supabase recovery remains blocked")
      },
    })
  } finally {
    bus.close()
  }
}

test("REQ-2 AC-2.1/AC-2.4: resume reuses the persisted same-run branch and clears blocked state after success", async () => {
  const ctx = fixture()
  try {
    const provider = fakeProvider({
      branches: [{ id: "br_saved", ref: "br_saved", name: ctx.expectedName, status: "ACTIVE_HEALTHY" }],
    })
    await seedBlockedProvisioningRun(ctx, { branchRef: "br_saved", runBranchRef: "br_saved" })

    await resumeOnce(ctx, provider)

    const resumed = ctx.repos.getRun(ctx.run.id)
    assert.equal(provider.calls.createBranch, 0)
    assert.equal(provider.branches.length, 1)
    assert.deepEqual(provider.calls.getBranch, ["br_saved", "br_saved"])
    assert.equal(resumed?.supabase_branch_ref, "br_saved")
    assert.equal(resumed?.status, "completed")
    assert.equal(resumed?.recovery_status, null)
  } finally {
    ctx.close()
  }
})

test("REQ-1 AC-1.2/AC-1.3: resume reattaches a missing branch ref from one verified current-wave branch and clears blocked state", async () => {
  const ctx = fixture()
  try {
    const provider = fakeProvider({
      branches: [{ id: "br_saved", ref: "br_saved", name: ctx.expectedName, status: "ACTIVE_HEALTHY" }],
    })
    await seedBlockedProvisioningRun(ctx)

    await resumeOnce(ctx, provider)

    const resumed = ctx.repos.getRun(ctx.run.id)
    assert.equal(provider.calls.createBranch, 0)
    assert.equal(provider.branches.length, 1)
    assert.equal(provider.calls.listBranches, 1)
    assert.deepEqual(provider.calls.getBranch, ["br_saved"])
    assert.equal(resumed?.supabase_branch_ref, "br_saved")
    assert.equal(resumed?.status, "completed")
    assert.equal(resumed?.recovery_status, null)
  } finally {
    ctx.close()
  }
})

test("REQ-1 AC-1.1/AC-1.3: resume replaces a stale prior-wave attachment with the verified current-wave branch", async () => {
  const ctx = fixture()
  try {
    const provider = fakeProvider({
      branches: [
        { id: "br_old", ref: "br_old", name: "beerengineer-alpha-old-run-old-item-proj-1-wave-0", status: "ACTIVE_HEALTHY" },
        { id: "br_saved", ref: "br_saved", name: ctx.expectedName, status: "ACTIVE_HEALTHY" },
      ],
    })
    await seedBlockedProvisioningRun(ctx, {
      branchRef: "br_old",
      runBranchRef: "br_old",
      runBranchName: "beerengineer-alpha-old-run-old-item-proj-1-wave-0",
    })

    await resumeOnce(ctx, provider)

    const resumed = ctx.repos.getRun(ctx.run.id)
    assert.equal(provider.calls.createBranch, 0)
    assert.equal(provider.calls.listBranches, 1)
    assert.deepEqual(provider.calls.getBranch, ["br_old", "br_saved"])
    assert.equal(resumed?.supabase_branch_ref, "br_saved")
    assert.equal(resumed?.supabase_branch_name, ctx.expectedName)
    assert.equal(resumed?.status, "completed")
    assert.equal(resumed?.recovery_status, null)
  } finally {
    ctx.close()
  }
})

test("REQ-1 AC-1.2/AC-1.4: ambiguous missing-ref recovery stays blocked instead of guessing", async () => {
  const ctx = fixture()
  try {
    const provider = fakeProvider({
      branches: [
        { id: "br_saved_1", ref: "br_saved_1", name: ctx.expectedName, status: "ACTIVE_HEALTHY" },
        { id: "br_saved_2", ref: "br_saved_2", name: ctx.expectedName, status: "ACTIVE_HEALTHY" },
      ],
    })
    await seedBlockedProvisioningRun(ctx)

    await resumeOnce(ctx, provider)

    const blocked = ctx.repos.getRun(ctx.run.id)
    const payload = parseSupabaseProvisioningRecoveryPayload(blocked?.recovery_payload_json)
    assert.equal(provider.calls.createBranch, 0)
    assert.equal(provider.calls.listBranches, 1)
    assert.deepEqual(provider.calls.getBranch, [])
    assert.equal(blocked?.status, "blocked")
    assert.equal(blocked?.recovery_status, "blocked")
    assert.match(payload?.failureCause ?? "", /ambiguous/i)
    assert.equal(payload?.guidance?.reason, "multiple_name_matches")
    assert.deepEqual(payload?.guidance?.attachBranchRefs, ["br_saved_1", "br_saved_2"])
  } finally {
    ctx.close()
  }
})

test("REQ-3 AC-3.1/AC-3.2/AC-3.3: resume blocks ref-conflict ambiguity with structured CLI guidance", async () => {
  const ctx = fixture()
  try {
    const provider = fakeProvider({
      branches: [{ id: "br_named", ref: "br_named", name: ctx.expectedName, status: "ACTIVE_HEALTHY" }],
    })
    await seedBlockedProvisioningRun(ctx, { branchRef: "br_saved", runBranchRef: "br_saved", runBranchName: ctx.expectedName })
    provider.branches.unshift({ id: "br_saved", ref: "br_saved", name: ctx.expectedName, status: "ACTIVE_HEALTHY" })
    provider.client.listBranches = async () => [{ id: "br_named", ref: "br_named", name: ctx.expectedName, status: "ACTIVE_HEALTHY" }]

    await resumeOnce(ctx, provider)

    const blocked = ctx.repos.getRun(ctx.run.id)
    const payload = parseSupabaseProvisioningRecoveryPayload(blocked?.recovery_payload_json)
    assert.equal(blocked?.status, "blocked")
    assert.equal(payload?.guidance?.reason, "ref_conflict")
    assert.deepEqual(payload?.guidance?.attachBranchRefs, ["br_saved", "br_named"])
  } finally {
    ctx.close()
  }
})

test("REQ-3 AC-3.1/AC-3.2/AC-3.3: resume blocks a wrong-wave recovery payload with structured CLI guidance", async () => {
  const ctx = fixture()
  try {
    const provider = fakeProvider({
      branches: [{ id: "br_saved", ref: "br_saved", name: ctx.expectedName, status: "ACTIVE_HEALTHY" }],
    })
    await seedBlockedProvisioningRun(ctx, {
      branchRef: "br_saved",
      runBranchRef: "br_saved",
      payloadWaveId: "wave-other",
    })

    await resumeOnce(ctx, provider)

    const blocked = ctx.repos.getRun(ctx.run.id)
    const payload = parseSupabaseProvisioningRecoveryPayload(blocked?.recovery_payload_json)
    assert.equal(blocked?.status, "blocked")
    assert.equal(provider.calls.listBranches, 0)
    assert.deepEqual(provider.calls.getBranch, [])
    assert.equal(payload?.guidance?.reason, "wave_mismatch")
    assert.deepEqual(payload?.guidance?.attachBranchRefs, ["br_saved"])
  } finally {
    ctx.close()
  }
})

test("REQ-2 AC-2.2/AC-2.4: repeated recovery attempts reuse the same branch and do not create duplicates", async () => {
  const ctx = fixture()
  try {
    const provider = fakeProvider({
      branches: [{ id: "br_saved", ref: "br_saved", name: ctx.expectedName, status: "ACTIVE_HEALTHY" }],
    })
    await seedBlockedProvisioningRun(ctx, { branchRef: "br_saved", runBranchRef: "br_saved" })

    const forcedFailure = {
      failedStep: "validate" as const,
      failureCause: "Migration smoke test failed again",
      branchRef: "br_saved",
    }
    await resumeOnce(ctx, provider, { forcedFailure })
    await resumeOnce(ctx, provider, { forcedFailure })

    const blocked = ctx.repos.getRun(ctx.run.id)
    const payload = parseSupabaseProvisioningRecoveryPayload(blocked?.recovery_payload_json)
    assert.equal(provider.calls.createBranch, 0)
    assert.equal(provider.branches.length, 1)
    assert.equal(blocked?.supabase_branch_ref, "br_saved")
    assert.equal(blocked?.status, "blocked")
    assert.equal(blocked?.recovery_status, "blocked")
    assert.equal(payload?.failedStep, "validate")
    assert.equal(payload?.failureCause, "Migration smoke test failed again")
  } finally {
    ctx.close()
  }
})

test("REQ-2 AC-2.3: resume refuses to reuse a persisted branch that does not match this run target", async () => {
  const ctx = fixture()
  try {
    const provider = fakeProvider({
      branches: [{ id: "br_saved", ref: "br_saved", name: "beerengineer-alpha-other-run-other-item-proj-1-wave-1", status: "ACTIVE_HEALTHY" }],
    })
    await seedBlockedProvisioningRun(ctx, { branchRef: "br_saved", runBranchRef: "br_saved" })

    await resumeOnce(ctx, provider)

    const blocked = ctx.repos.getRun(ctx.run.id)
    const payload = parseSupabaseProvisioningRecoveryPayload(blocked?.recovery_payload_json)
    assert.equal(provider.calls.createBranch, 0)
    assert.equal(blocked?.status, "blocked")
    assert.equal(blocked?.recovery_status, "blocked")
    assert.match(payload?.failureCause ?? "", /does not belong to this blocked run/i)
  } finally {
    ctx.close()
  }
})

test("REQ-2 AC-2.4: later provisioning failure after branch reuse leaves the run blocked", async () => {
  const ctx = fixture()
  try {
    const provider = fakeProvider({
      branches: [{ id: "br_saved", ref: "br_saved", name: ctx.expectedName, status: "ACTIVE_HEALTHY" }],
    })
    await seedBlockedProvisioningRun(ctx, { branchRef: "br_saved", runBranchRef: "br_saved" })

    await resumeOnce(ctx, provider, {
      forcedFailure: {
        failedStep: "validate",
        failureCause: "Validation still fails after branch reuse",
        branchRef: "br_saved",
      },
    })

    const blocked = ctx.repos.getRun(ctx.run.id)
    const payload = parseSupabaseProvisioningRecoveryPayload(blocked?.recovery_payload_json)
    assert.equal(provider.calls.createBranch, 0)
    assert.equal(blocked?.status, "blocked")
    assert.equal(blocked?.recovery_status, "blocked")
    assert.equal(payload?.failedStep, "validate")
    assert.equal(payload?.failureCause, "Validation still fails after branch reuse")
  } finally {
    ctx.close()
  }
})

test("REQ-3 AC-3.4: attach repair followed by resume continues with the selected valid branch", async () => {
  const ctx = fixture()
  try {
    const provider = fakeProvider({
      branches: [
        { id: "br_selected", ref: "br_selected", name: ctx.expectedName, status: "ACTIVE_HEALTHY" },
        { id: "br_conflict", ref: "br_conflict", name: ctx.expectedName, status: "ACTIVE_HEALTHY" },
      ],
    })
    await seedBlockedProvisioningRun(ctx)
    provider.client.listBranches = async () => [{ id: "br_conflict", ref: "br_conflict", name: ctx.expectedName, status: "ACTIVE_HEALTHY" }]

    const attach = attachSupabaseBranchToRunRecovery(ctx.repos, {
      runId: ctx.run.id,
      branchRef: "br_selected",
    })
    assert.equal(attach.ok, true)

    await resumeOnce(ctx, provider)

    const resumed = ctx.repos.getRun(ctx.run.id)
    assert.equal(resumed?.status, "completed")
    assert.equal(resumed?.recovery_status, null)
    assert.equal(resumed?.supabase_branch_ref, "br_selected")
  } finally {
    ctx.close()
  }
})

test("REQ-3 AC-3.4: discard repair followed by resume continues safely without falling back to the old recovery branch ref", async () => {
  const ctx = fixture()
  try {
    const provider = fakeProvider({ branches: [] })
    await seedBlockedProvisioningRun(ctx, { branchRef: "br_old", runBranchRef: "br_old", runBranchName: "beerengineer-alpha-old-run-old-item-proj-1-wave-0" })

    const discard = discardSupabaseBranchFromRunRecovery(ctx.repos, { runId: ctx.run.id })
    assert.equal(discard.ok, true)

    await resumeOnce(ctx, provider)

    const resumed = ctx.repos.getRun(ctx.run.id)
    assert.equal(resumed?.status, "completed")
    assert.equal(resumed?.recovery_status, null)
    assert.equal(resumed?.supabase_branch_ref, "created-1")
  } finally {
    ctx.close()
  }
})

test("REQ-3 AC-3.4: resume revalidates an operator-attached branch and re-blocks when it turns unhealthy before resume", async () => {
  const ctx = fixture()
  try {
    const provider = fakeProvider({
      branches: [{ id: "br_selected", ref: "br_selected", name: ctx.expectedName, status: "ACTIVE_HEALTHY" }],
    })
    await seedBlockedProvisioningRun(ctx)

    const attach = attachSupabaseBranchToRunRecovery(ctx.repos, {
      runId: ctx.run.id,
      branchRef: "br_selected",
    })
    assert.equal(attach.ok, true)
    provider.branches[0]!.status = "CREATING"

    await resumeOnce(ctx, provider)

    const blocked = ctx.repos.getRun(ctx.run.id)
    const payload = parseSupabaseProvisioningRecoveryPayload(blocked?.recovery_payload_json)
    assert.equal(blocked?.status, "blocked")
    assert.equal(blocked?.recovery_status, "blocked")
    assert.equal(payload?.guidance?.reason, "branch_not_active_healthy")
    assert.deepEqual(payload?.guidance?.attachBranchRefs, ["br_selected"])
  } finally {
    ctx.close()
  }
})

test("REQ-2 AC-2.1: resume without a persisted branch identity fails explicitly instead of guessing", async () => {
  const ctx = fixture()
  try {
    const provider = fakeProvider({
      branches: [{ id: "br_guess", ref: "br_guess", name: "beerengineer-alpha-other-run-other-item-proj-1-wave-1", status: "ACTIVE_HEALTHY" }],
    })
    await seedBlockedProvisioningRun(ctx)

    await resumeOnce(ctx, provider)

    const blocked = ctx.repos.getRun(ctx.run.id)
    const payload = parseSupabaseProvisioningRecoveryPayload(blocked?.recovery_payload_json)
    assert.equal(provider.calls.createBranch, 0)
    assert.equal(provider.calls.listBranches, 1)
    assert.equal(provider.calls.getBranch.length, 0)
    assert.equal(blocked?.status, "blocked")
    assert.equal(blocked?.recovery_status, "blocked")
    assert.match(payload?.failureCause ?? "", /no persisted branch identity/i)
  } finally {
    ctx.close()
  }
})

test("REQ-2 AC-2.1: resume fails explicitly when the persisted branch ref no longer exists", async () => {
  const ctx = fixture()
  try {
    const provider = fakeProvider({ branches: [] })
    await seedBlockedProvisioningRun(ctx, { branchRef: "br_missing", runBranchRef: "br_missing" })

    await resumeOnce(ctx, provider)

    const blocked = ctx.repos.getRun(ctx.run.id)
    const payload = parseSupabaseProvisioningRecoveryPayload(blocked?.recovery_payload_json)
    assert.equal(provider.calls.createBranch, 0)
    assert.equal(blocked?.status, "blocked")
    assert.equal(blocked?.recovery_status, "blocked")
    assert.match(payload?.failureCause ?? "", /missing recoverable branch/i)
  } finally {
    ctx.close()
  }
})
