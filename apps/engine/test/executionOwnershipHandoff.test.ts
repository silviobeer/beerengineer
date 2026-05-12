import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import type { Db } from "../src/db/connection.js"
import {
  claimExecutionOwnershipHandoffs,
  parseExecutionOwnershipHandoffRecoveryPayload,
  queueExecutionOwnershipHandoffResume,
} from "../src/core/executionOwnershipHandoff.js"
import { claimWorkerLease } from "../src/core/workerLease.js"

function tempRepos(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  const db = initDatabase(join(dir, "test.sqlite"))
  const repos = new Repos(db)
  const workspaceRoot = join(dir, "workspace")
  mkdirSync(workspaceRoot, { recursive: true })
  const workspace = repos.upsertWorkspace({ key: "default", name: "Default", rootPath: workspaceRoot })
  return {
    dir,
    db,
    repos,
    workspace,
    close() {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

function seedRun(
  repos: Repos,
  workspaceId: string,
  input: {
    title: string
    owner?: "cli" | "api"
    status?: string
    currentStage?: string
    recoveryStatus?: "blocked" | "failed"
    recoveryScope?: "run" | "stage" | "story"
    recoveryScopeRef?: string | null
    claimLeaseAs?: "cli" | "api"
  },
) {
  const item = repos.createItem({ workspaceId, title: input.title, description: input.title })
  const run = repos.createRun({
    workspaceId,
    itemId: item.id,
    title: item.title,
    owner: input.owner ?? "cli",
    workspaceFsId: `${input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`,
  })
  repos.updateRun(run.id, {
    status: input.status ?? "blocked",
    current_stage: input.currentStage ?? "planning",
    recovery_status: input.recoveryStatus ?? "blocked",
    recovery_scope: input.recoveryScope ?? "stage",
    recovery_scope_ref: input.recoveryScopeRef ?? "execution",
    recovery_summary: "Planning completed. API worker ownership is required before execution can start.",
  })
  if (input.claimLeaseAs) {
    claimWorkerLease(repos, {
      runId: run.id,
      workerInstanceId: `${input.claimLeaseAs}-seed`,
      workerOwnerKind: input.claimLeaseAs,
      now: 1_700_000_000_000,
    })
  }
  return { item, runId: run.id }
}

test("execution handoff claimant accepts both eligible blocked stage variants without creating a replacement run", async () => {
  const { repos, workspace, close } = tempRepos("be2-execution-handoff-eligible-")
  try {
    const planning = seedRun(repos, workspace.id, {
      title: "planning-candidate",
      currentStage: "planning",
      claimLeaseAs: "cli",
    })
    const execution = seedRun(repos, workspace.id, {
      title: "execution-candidate",
      currentStage: "execution",
      claimLeaseAs: "cli",
    })

    const queuedRunIds = [planning.runId, execution.runId]
    const remediationIds = new Map<string, string>()
    for (const runId of queuedRunIds) {
      const remediation = repos.createExternalRemediation({
        runId,
        scope: "stage",
        scopeRef: "execution",
        summary: "Resume the blocked execution handoff.",
        source: "api",
      })
      remediationIds.set(runId, remediation.id)
      queueExecutionOwnershipHandoffResume(repos, runId, remediation.id)
    }

    const runsBefore = repos.listRuns().length
    const resumeCalls: Array<{ runId: string; remediationId: string }> = []
    const claimed = await claimExecutionOwnershipHandoffs(repos, {
      apiWorkerInstanceId: "api-worker-test",
      resumeRun: async (_repos, input) => {
        resumeCalls.push({ runId: input.runId, remediationId: input.remediationId })
        return { ok: true }
      },
    })

    assert.deepEqual(claimed.claimedRunIds, queuedRunIds)
    assert.deepEqual(
      resumeCalls.map(call => ({ ...call, remediationId: remediationIds.get(call.runId) })),
      queuedRunIds.map(runId => ({ runId, remediationId: remediationIds.get(runId) })),
    )
    assert.equal(repos.listRuns().length, runsBefore)

    for (const runId of queuedRunIds) {
      const run = repos.getRun(runId)
      const payload = parseExecutionOwnershipHandoffRecoveryPayload(run?.recovery_payload_json)
      assert.equal(run?.owner, "api")
      assert.equal(run?.worker_owner_kind, "api")
      assert.equal(run?.worker_instance_id, "api-worker-test")
      assert.equal(payload?.pendingResumeRemediationId, null)
      assert.equal(payload?.lastAttemptedResumeRemediationId, remediationIds.get(runId) ?? null)
    }
  } finally {
    close()
  }
})

test("execution handoff claimant rejects ineligible blocked variants without claiming or consuming the pending remediation", async () => {
  const cases = [
    {
      name: "non-blocked status",
      mutate: (_db: Db, repos: Repos, runId: string) => {
        repos.updateRun(runId, { status: "running" })
      },
    },
    {
      name: "non-blocked recovery status",
      mutate: (_db: Db, repos: Repos, runId: string) => {
        repos.updateRun(runId, { recovery_status: "failed" })
      },
    },
    {
      name: "non-execution recovery scope",
      mutate: (_db: Db, repos: Repos, runId: string) => {
        repos.updateRun(runId, { recovery_scope: "run", recovery_scope_ref: null })
      },
    },
    {
      name: "stage outside planning or execution",
      mutate: (_db: Db, repos: Repos, runId: string) => {
        repos.updateRun(runId, { current_stage: "qa" })
      },
    },
    {
      name: "api-owned worker lease",
      mutate: (_db: Db, repos: Repos, runId: string) => {
        claimWorkerLease(repos, {
          runId,
          workerInstanceId: "api-seed",
          workerOwnerKind: "api",
          now: 1_700_000_000_001,
        })
      },
    },
    {
      name: "missing displayed cli ownership",
      mutate: (db: Db, _repos: Repos, runId: string) => {
        db.prepare(
          `UPDATE runs
           SET worker_instance_id = NULL,
               worker_owner_kind = NULL,
               worker_started_at = NULL,
               worker_heartbeat_at = NULL
           WHERE id = ?`,
        ).run(runId)
      },
    },
  ] as const

  for (const testCase of cases) {
    const { db, repos, workspace, close } = tempRepos(`be2-execution-handoff-${testCase.name}-`)
    try {
      const seeded = seedRun(repos, workspace.id, {
        title: testCase.name,
        claimLeaseAs: "cli",
      })
      const remediation = repos.createExternalRemediation({
        runId: seeded.runId,
        scope: "stage",
        scopeRef: "execution",
        summary: "Resume the blocked execution handoff.",
        source: "api",
      })
      queueExecutionOwnershipHandoffResume(repos, seeded.runId, remediation.id)
      testCase.mutate(db, repos, seeded.runId)

      const before = repos.getRun(seeded.runId)
      const runsBefore = repos.listRuns().length
      let resumeCalls = 0

      const claimed = await claimExecutionOwnershipHandoffs(repos, {
        apiWorkerInstanceId: "api-worker-test",
        resumeRun: async () => {
          resumeCalls += 1
          return { ok: true }
        },
      })

      const after = repos.getRun(seeded.runId)
      const payload = parseExecutionOwnershipHandoffRecoveryPayload(after?.recovery_payload_json)
      assert.deepEqual(claimed.claimedRunIds, [], testCase.name)
      assert.equal(resumeCalls, 0, testCase.name)
      assert.equal(repos.listRuns().length, runsBefore, testCase.name)
      assert.equal(after?.owner, before?.owner, testCase.name)
      assert.equal(after?.worker_owner_kind, before?.worker_owner_kind, testCase.name)
      assert.equal(after?.worker_instance_id, before?.worker_instance_id, testCase.name)
      assert.equal(payload?.pendingResumeRemediationId, remediation.id, testCase.name)
      assert.equal(payload?.lastAttemptedResumeRemediationId, null, testCase.name)
    } finally {
      close()
    }
  }
})

test("execution handoff claimant restores the blocked CLI handoff when resume dispatch is rejected", async () => {
  const { repos, workspace, close } = tempRepos("be2-execution-handoff-rejected-resume-")
  try {
    const seeded = seedRun(repos, workspace.id, {
      title: "resume-rejected",
      currentStage: "planning",
      claimLeaseAs: "cli",
    })
    const remediation = repos.createExternalRemediation({
      runId: seeded.runId,
      scope: "stage",
      scopeRef: "execution",
      summary: "Resume the blocked execution handoff.",
      source: "api",
    })
    queueExecutionOwnershipHandoffResume(repos, seeded.runId, remediation.id)

    const before = repos.getRun(seeded.runId)
    const claimed = await claimExecutionOwnershipHandoffs(repos, {
      apiWorkerInstanceId: "api-worker-test",
      resumeRun: async () => ({ ok: false }),
    })

    const after = repos.getRun(seeded.runId)
    const payload = parseExecutionOwnershipHandoffRecoveryPayload(after?.recovery_payload_json)

    assert.deepEqual(claimed.claimedRunIds, [])
    assert.equal(after?.owner, before?.owner)
    assert.equal(after?.worker_owner_kind, before?.worker_owner_kind)
    assert.equal(after?.worker_instance_id, before?.worker_instance_id)
    assert.equal(after?.worker_started_at, before?.worker_started_at)
    assert.equal(after?.worker_heartbeat_at, before?.worker_heartbeat_at)
    assert.equal(payload?.pendingResumeRemediationId, remediation.id)
    assert.equal(payload?.lastAttemptedResumeRemediationId, null)
  } finally {
    close()
  }
})

test("execution handoff claimant restores the blocked CLI handoff when resume dispatch throws", async () => {
  const { repos, workspace, close } = tempRepos("be2-execution-handoff-thrown-resume-")
  try {
    const seeded = seedRun(repos, workspace.id, {
      title: "resume-thrown",
      currentStage: "execution",
      claimLeaseAs: "cli",
    })
    const remediation = repos.createExternalRemediation({
      runId: seeded.runId,
      scope: "stage",
      scopeRef: "execution",
      summary: "Resume the blocked execution handoff.",
      source: "api",
    })
    queueExecutionOwnershipHandoffResume(repos, seeded.runId, remediation.id)

    const before = repos.getRun(seeded.runId)

    await assert.rejects(
      claimExecutionOwnershipHandoffs(repos, {
        apiWorkerInstanceId: "api-worker-test",
        resumeRun: async () => {
          throw new Error("resume dispatch failed")
        },
      }),
      /resume dispatch failed/,
    )

    const after = repos.getRun(seeded.runId)
    const payload = parseExecutionOwnershipHandoffRecoveryPayload(after?.recovery_payload_json)

    assert.equal(after?.owner, before?.owner)
    assert.equal(after?.worker_owner_kind, before?.worker_owner_kind)
    assert.equal(after?.worker_instance_id, before?.worker_instance_id)
    assert.equal(after?.worker_started_at, before?.worker_started_at)
    assert.equal(after?.worker_heartbeat_at, before?.worker_heartbeat_at)
    assert.equal(payload?.pendingResumeRemediationId, remediation.id)
    assert.equal(payload?.lastAttemptedResumeRemediationId, null)
  } finally {
    close()
  }
})
