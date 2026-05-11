import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { claimWorkerLease } from "../src/core/workerLease.js"
import { recoverLostWorkerRuns } from "../src/core/orphanRecovery.js"
import { projectStageLogRow } from "../src/core/messagingProjection.js"

function fixture() {
  const db = initDatabase(join(mkdtempSync(join(tmpdir(), "be2-worker-recovery-")), "test.sqlite"))
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "test", name: "Test" })
  const item = repos.createItem({ workspaceId: ws.id, title: "Recovered item", description: "" })
  return { db, repos, ws, item }
}

function latestProjectedMessage(repos: Repos, runId: string) {
  const row = repos.listLogsForRun(runId).at(-1)
  assert.ok(row, "expected a startup recovery log entry")
  return projectStageLogRow(row)
}

function seedManualStaleRun(
  repos: Repos,
  input: {
    workspaceId: string
    itemId: string
    title: string
    owner?: "api" | "cli"
    currentStage?: string
    recoverySummary?: string
    lease?: { workerInstanceId: string; workerOwnerKind: "api" | "cli"; now: number }
  },
) {
  const run = repos.createRun({
    workspaceId: input.workspaceId,
    itemId: input.itemId,
    title: input.title,
    owner: input.owner ?? "cli",
  })
  repos.updateRun(run.id, {
    status: "failed",
    current_stage: input.currentStage ?? "execution",
    recovery_status: "failed",
    recovery_scope: "run",
    recovery_scope_ref: null,
    recovery_summary: input.recoverySummary ?? "CLI worker heartbeat is stale — no live worker; resume or abandon.",
  })
  if (input.lease) {
    claimWorkerLease(repos, {
      runId: run.id,
      workerInstanceId: input.lease.workerInstanceId,
      workerOwnerKind: input.lease.workerOwnerKind,
      now: input.lease.now,
    })
  }
  return run
}

test("startup recovery fails previous-instance API runs without waiting for stale heartbeat", async () => {
  const { db, repos, ws, item } = fixture()
  try {
    repos.setItemColumn(item.id, "requirements", "running")
    repos.setItemCurrentStage(item.id, "requirements")
    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: item.title, owner: "api" })
    repos.updateRun(run.id, { current_stage: "requirements" })
    claimWorkerLease(repos, {
      runId: run.id,
      workerInstanceId: "old-api",
      workerOwnerKind: "api",
      now: 1_700_000_000_000,
    })

    const result = await recoverLostWorkerRuns(repos, {
      apiWorkerInstanceId: "new-api",
      now: 1_700_000_010_000,
    })

    assert.equal(result.recovered, 1)
    assert.deepEqual(result.recoveredRunIds, [run.id])
    const recovered = repos.getRun(run.id)
    assert.equal(recovered?.status, "failed")
    assert.equal(recovered?.recovery_status, "failed")
    assert.equal(recovered?.recovery_scope, "run")
    assert.equal(recovered?.recovery_scope_ref, null)
    assert.match(recovered?.recovery_summary ?? "", /lost API worker/i)
    const projected = repos.getItem(item.id)
    assert.equal(projected?.current_column, "requirements")
    assert.equal(projected?.phase_status, "failed")
    assert.equal(projected?.current_stage, null)
  } finally {
    db.close()
  }
})

test("startup recovery fails stale CLI runs and leaves fresh CLI runs active", async () => {
  const { db, repos, ws, item } = fixture()
  try {
    const stale = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "stale", owner: "cli" })
    claimWorkerLease(repos, {
      runId: stale.id,
      workerInstanceId: "cli-stale",
      workerOwnerKind: "cli",
      now: 1_700_000_000_000,
    })
    const fresh = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "fresh", owner: "cli" })
    claimWorkerLease(repos, {
      runId: fresh.id,
      workerInstanceId: "cli-fresh",
      workerOwnerKind: "cli",
      now: 1_700_000_110_000,
    })

    const result = await recoverLostWorkerRuns(repos, {
      apiWorkerInstanceId: "api-current",
      now: 1_700_000_130_001,
    })

    assert.equal(result.recovered, 1)
    assert.deepEqual(result.recoveredRunIds, [stale.id])
    assert.equal(repos.getRun(stale.id)?.status, "failed")
    assert.equal(repos.getRun(stale.id)?.recovery_status, "failed")
    assert.equal(repos.getRun(fresh.id)?.status, "running")
    assert.equal(repos.getRun(fresh.id)?.recovery_status, null)
  } finally {
    db.close()
  }
})

test("startup recovery does not let a stale side run clobber a newer live run item projection", async () => {
  const { db, repos, ws, item } = fixture()
  try {
    const side = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "side", owner: "cli" })
    repos.updateRun(side.id, { current_stage: "visual-companion" })
    claimWorkerLease(repos, {
      runId: side.id,
      workerInstanceId: "cli-side",
      workerOwnerKind: "cli",
      now: 1_700_000_000_000,
    })
    const main = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "main", owner: "api" })
    repos.updateRun(main.id, { current_stage: "requirements" })
    claimWorkerLease(repos, {
      runId: main.id,
      workerInstanceId: "api-current",
      workerOwnerKind: "api",
      now: 1_700_000_120_000,
    })
    repos.setItemColumn(item.id, "requirements", "running")
    repos.setItemCurrentStage(item.id, "requirements")

    const result = await recoverLostWorkerRuns(repos, {
      apiWorkerInstanceId: "api-current",
      now: 1_700_000_130_001,
    })

    assert.deepEqual(result.recoveredRunIds, [side.id])
    const projected = repos.getItem(item.id)
    assert.equal(projected?.current_column, "requirements")
    assert.equal(projected?.phase_status, "running")
    assert.equal(projected?.current_stage, "requirements")
    assert.equal(repos.getRun(main.id)?.status, "running")
  } finally {
    db.close()
  }
})

test("startup recovery auto-resumes an eligible stale run and records the outcome", async () => {
  const { db, repos, ws, item } = fixture()
  try {
    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: item.title, owner: "cli" })
    repos.updateRun(run.id, { current_stage: "execution" })
    claimWorkerLease(repos, {
      runId: run.id,
      workerInstanceId: "cli-stale",
      workerOwnerKind: "cli",
      now: 1_700_000_000_000,
    })

    let resumedRunId: string | null = null
    const result = await recoverLostWorkerRuns(repos, {
      apiWorkerInstanceId: "api-current",
      now: 1_700_000_130_001,
      autoResume: {
        enabled: true,
        resumeRun: async staleRun => {
          resumedRunId = staleRun.id
          repos.clearRunRecovery(staleRun.id)
          repos.updateRun(staleRun.id, { status: "running", current_stage: "execution" })
        },
      },
    })

    assert.equal(resumedRunId, run.id)
    assert.equal(result.recovered, 1)
    assert.equal(result.outcomes[0]?.outcome, "auto_resumed")
    assert.equal(result.outcomes[0]?.reason, null)
    assert.equal(repos.getRun(run.id)?.status, "running")
    assert.equal(repos.getRun(run.id)?.recovery_status, null)
    const message = latestProjectedMessage(repos, run.id)
    assert.equal(message?.type, "startup_recovery")
    assert.equal(message?.payload.outcome, "auto_resumed")
    assert.equal(message?.payload.reason, null)
  } finally {
    db.close()
  }
})

test("startup recovery skips stale manual-recovery runs whose worker lease is not orphaned", async () => {
  const { db, repos, ws, item } = fixture()
  try {
    const run = seedManualStaleRun(repos, {
      workspaceId: ws.id,
      itemId: item.id,
      title: "manual",
      lease: {
        workerInstanceId: "cli-fresh",
        workerOwnerKind: "cli",
        now: 1_700_000_120_000,
      },
    })

    let resumeCalls = 0
    const result = await recoverLostWorkerRuns(repos, {
      apiWorkerInstanceId: "api-current",
      now: 1_700_000_130_001,
      autoResume: {
        enabled: true,
        resumeRun: async () => {
          resumeCalls += 1
        },
      },
    })

    assert.equal(result.recovered, 0)
    assert.equal(resumeCalls, 0)
    assert.deepEqual(result.outcomes, [
      {
        runId: run.id,
        outcome: "skipped",
        reason: "worker_lease_not_orphaned",
      },
    ])
    assert.equal(repos.getRun(run.id)?.status, "failed")
    assert.equal(repos.getRun(run.id)?.recovery_status, "failed")
    const message = latestProjectedMessage(repos, run.id)
    assert.equal(message?.type, "startup_recovery")
    assert.equal(message?.payload.outcome, "skipped")
    assert.equal(message?.payload.reason, "worker_lease_not_orphaned")
  } finally {
    db.close()
  }
})

test("startup recovery auto-resumes stale runs with open prompts and preserves the unresolved prompt", async () => {
  const { db, repos, ws, item } = fixture()
  try {
    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: item.title, owner: "cli" })
    repos.updateRun(run.id, { current_stage: "execution" })
    claimWorkerLease(repos, {
      runId: run.id,
      workerInstanceId: "cli-stale",
      workerOwnerKind: "cli",
      now: 1_700_000_000_000,
    })
    const prompt = repos.createPendingPrompt({ id: "p-open", runId: run.id, prompt: "Need approval?" })

    let resumedRunId: string | null = null
    const result = await recoverLostWorkerRuns(repos, {
      apiWorkerInstanceId: "api-current",
      now: 1_700_000_130_001,
      autoResume: {
        enabled: true,
        resumeRun: async staleRun => {
          resumedRunId = staleRun.id
          repos.clearRunRecovery(staleRun.id)
          repos.updateRun(staleRun.id, { status: "running", current_stage: "execution" })
        },
      },
    })

    assert.equal(resumedRunId, run.id)
    assert.equal(result.outcomes[0]?.outcome, "auto_resumed")
    assert.equal(result.outcomes[0]?.reason, null)
    assert.equal(repos.getRun(run.id)?.status, "running")
    assert.equal(repos.getRun(run.id)?.recovery_status, null)
    assert.equal(repos.getOpenPrompt(run.id)?.id, prompt.id, "startup recovery must preserve the open prompt")
    const message = latestProjectedMessage(repos, run.id)
    assert.equal(message?.type, "startup_recovery")
    assert.equal(message?.payload.outcome, "auto_resumed")
    assert.equal(message?.payload.reason, null)
  } finally {
    db.close()
  }
})

test("startup recovery preserves a single unresolved prompt across repeated auto-resume cycles", async () => {
  const { db, repos, ws, item } = fixture()
  try {
    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: item.title, owner: "cli" })
    repos.updateRun(run.id, { current_stage: "execution" })
    claimWorkerLease(repos, {
      runId: run.id,
      workerInstanceId: "cli-stale",
      workerOwnerKind: "cli",
      now: 1_700_000_000_000,
    })
    const prompt = repos.createPendingPrompt({ id: "p-repeat", runId: run.id, prompt: "Need approval?" })

    for (const now of [1_700_000_130_001, 1_700_000_260_002]) {
      const result = await recoverLostWorkerRuns(repos, {
        apiWorkerInstanceId: "api-current",
        now,
        autoResume: {
          enabled: true,
          resumeRun: async staleRun => {
            repos.clearRunRecovery(staleRun.id)
            repos.updateRun(staleRun.id, { status: "running", current_stage: "execution" })
          },
        },
      })
      assert.equal(result.outcomes[0]?.outcome, "auto_resumed")
      assert.equal(repos.getRun(run.id)?.status, "running")
      assert.equal(repos.getOpenPrompt(run.id)?.id, prompt.id)
      claimWorkerLease(repos, {
        runId: run.id,
        workerInstanceId: "cli-stale",
        workerOwnerKind: "cli",
        now: now - 130_001,
      })
    }

    const pendingCount = db
      .prepare("SELECT COUNT(*) as count FROM pending_prompts WHERE run_id = ? AND answered_at IS NULL")
      .get(run.id) as { count: number }
    assert.equal(pendingCount.count, 1)
  } finally {
    db.close()
  }
})

test("startup recovery leaves otherwise eligible stale runs manual when auto-resume is disabled", async () => {
  const { db, repos, ws, item } = fixture()
  try {
    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: item.title, owner: "cli" })
    repos.updateRun(run.id, { current_stage: "requirements" })
    claimWorkerLease(repos, {
      runId: run.id,
      workerInstanceId: "cli-stale",
      workerOwnerKind: "cli",
      now: 1_700_000_000_000,
    })

    const result = await recoverLostWorkerRuns(repos, {
      apiWorkerInstanceId: "api-current",
      now: 1_700_000_130_001,
      autoResume: {
        enabled: false,
        resumeRun: async () => {
          throw new Error("should not be called")
        },
      },
    })

    assert.equal(result.outcomes[0]?.outcome, "skipped")
    assert.equal(result.outcomes[0]?.reason, "auto_resume_disabled")
    assert.equal(repos.getRun(run.id)?.status, "failed")
    assert.equal(repos.getRun(run.id)?.recovery_status, "failed")
    const message = latestProjectedMessage(repos, run.id)
    assert.equal(message?.type, "startup_recovery")
    assert.equal(message?.payload.outcome, "skipped")
    assert.equal(message?.payload.reason, "auto_resume_disabled")
  } finally {
    db.close()
  }
})

test("startup recovery leaves stale runs manual across workspaces when auto-resume is disabled", async () => {
  const { db, repos, ws, item } = fixture()
  try {
    const wsTwo = repos.upsertWorkspace({ key: "test-2", name: "Test 2" })
    const itemTwo = repos.createItem({ workspaceId: wsTwo.id, title: "Recovered item two", description: "" })

    const firstRun = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: item.title, owner: "cli" })
    repos.updateRun(firstRun.id, { current_stage: "requirements" })
    claimWorkerLease(repos, {
      runId: firstRun.id,
      workerInstanceId: "cli-stale-one",
      workerOwnerKind: "cli",
      now: 1_700_000_000_000,
    })

    const secondRun = repos.createRun({ workspaceId: wsTwo.id, itemId: itemTwo.id, title: itemTwo.title, owner: "cli" })
    repos.updateRun(secondRun.id, { current_stage: "execution" })
    claimWorkerLease(repos, {
      runId: secondRun.id,
      workerInstanceId: "cli-stale-two",
      workerOwnerKind: "cli",
      now: 1_700_000_000_000,
    })

    let resumeCalls = 0
    const result = await recoverLostWorkerRuns(repos, {
      apiWorkerInstanceId: "api-current",
      now: 1_700_000_130_001,
      autoResume: {
        enabled: false,
        resumeRun: async () => {
          resumeCalls += 1
        },
      },
    })

    assert.equal(resumeCalls, 0)
    assert.equal(result.recovered, 2)
    assert.deepEqual(new Set(result.recoveredRunIds), new Set([firstRun.id, secondRun.id]))
    assert.deepEqual(
      new Map(result.outcomes.map(outcome => [outcome.runId, outcome.reason])),
      new Map([
        [firstRun.id, "auto_resume_disabled"],
        [secondRun.id, "auto_resume_disabled"],
      ]),
    )
    for (const runId of [firstRun.id, secondRun.id]) {
      assert.equal(repos.getRun(runId)?.status, "failed")
      assert.equal(repos.getRun(runId)?.recovery_status, "failed")
      const message = latestProjectedMessage(repos, runId)
      assert.equal(message?.type, "startup_recovery")
      assert.equal(message?.payload.outcome, "skipped")
      assert.equal(message?.payload.reason, "auto_resume_disabled")
    }
  } finally {
    db.close()
  }
})

test("startup recovery falls back to manual recovery when auto-resume handoff fails", async () => {
  const { db, repos, ws, item } = fixture()
  try {
    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: item.title, owner: "cli" })
    repos.updateRun(run.id, { current_stage: "execution" })
    claimWorkerLease(repos, {
      runId: run.id,
      workerInstanceId: "cli-stale",
      workerOwnerKind: "cli",
      now: 1_700_000_000_000,
    })

    let resumeCalls = 0
    const result = await recoverLostWorkerRuns(repos, {
      apiWorkerInstanceId: "api-current",
      now: 1_700_000_130_001,
      autoResume: {
        enabled: true,
        resumeRun: async () => {
          resumeCalls += 1
          throw new Error("resume exploded")
        },
      },
    })

    assert.equal(resumeCalls, 1)
    assert.equal(result.outcomes[0]?.outcome, "failed")
    assert.equal(result.outcomes[0]?.reason, "auto_resume_failed")
    assert.equal(repos.getRun(run.id)?.status, "failed")
    assert.equal(repos.getRun(run.id)?.recovery_status, "failed")
    const message = latestProjectedMessage(repos, run.id)
    assert.equal(message?.type, "startup_recovery")
    assert.equal(message?.payload.outcome, "failed")
    assert.equal(message?.payload.reason, "auto_resume_failed")
    assert.match(String(message?.payload.error ?? ""), /resume exploded/)
  } finally {
    db.close()
  }
})

test("startup recovery handles mixed stale runs independently during one startup cycle", async () => {
  const { db, repos, ws, item } = fixture()
  try {
    const nonOrphanedRun = seedManualStaleRun(repos, {
      workspaceId: ws.id,
      itemId: item.id,
      title: "non-orphaned",
      lease: {
        workerInstanceId: "cli-fresh",
        workerOwnerKind: "cli",
        now: 1_700_000_120_000,
      },
    })

    const waitingRun = seedManualStaleRun(repos, {
      workspaceId: ws.id,
      itemId: item.id,
      title: "waiting",
      lease: {
        workerInstanceId: "cli-waiting",
        workerOwnerKind: "cli",
        now: 1_700_000_000_000,
      },
    })
    repos.createPendingPrompt({ runId: waitingRun.id, prompt: "Need approval?" })

    const failingRun = seedManualStaleRun(repos, {
      workspaceId: ws.id,
      itemId: item.id,
      title: "failing",
      lease: {
        workerInstanceId: "cli-failing",
        workerOwnerKind: "cli",
        now: 1_700_000_000_000,
      },
    })

    const resumableRun = seedManualStaleRun(repos, {
      workspaceId: ws.id,
      itemId: item.id,
      title: "resumable",
      lease: {
        workerInstanceId: "cli-resumable",
        workerOwnerKind: "cli",
        now: 1_700_000_000_000,
      },
    })

    const resumeAttempts: string[] = []
    const result = await recoverLostWorkerRuns(repos, {
      apiWorkerInstanceId: "api-current",
      now: 1_700_000_130_001,
      autoResume: {
        enabled: true,
        resumeRun: async staleRun => {
          resumeAttempts.push(staleRun.id)
          if (staleRun.id === failingRun.id) {
            throw new Error("resume exploded")
          }
          if (staleRun.id === waitingRun.id || staleRun.id === resumableRun.id) {
            repos.clearRunRecovery(staleRun.id)
            repos.updateRun(staleRun.id, { status: "running", current_stage: "execution" })
            return
          }
          throw new Error(`unexpected resume run ${staleRun.id}`)
        },
      },
    })

    assert.equal(result.recovered, 0)
    assert.deepEqual(new Set(resumeAttempts), new Set([waitingRun.id, failingRun.id, resumableRun.id]))
    assert.equal(resumeAttempts.length, 3)
    assert.equal(repos.getRun(nonOrphanedRun.id)?.status, "failed")
    assert.ok(repos.getOpenPrompt(waitingRun.id), "waiting-for-operator runs must keep their prompt open")
    assert.equal(repos.getRun(waitingRun.id)?.status, "running")
    assert.equal(repos.getRun(failingRun.id)?.status, "failed")
    assert.equal(repos.getRun(resumableRun.id)?.status, "running")
    assert.equal(repos.getRun(resumableRun.id)?.recovery_status, null)
    const outcomes = new Map(result.outcomes.map(outcome => [outcome.runId, outcome]))
    assert.deepEqual(outcomes.get(nonOrphanedRun.id), {
      runId: nonOrphanedRun.id,
      outcome: "skipped",
      reason: "worker_lease_not_orphaned",
    })
    assert.deepEqual(outcomes.get(waitingRun.id), {
      runId: waitingRun.id,
      outcome: "auto_resumed",
      reason: null,
    })
    assert.deepEqual(outcomes.get(failingRun.id), {
      runId: failingRun.id,
      outcome: "failed",
      reason: "auto_resume_failed",
    })
    assert.deepEqual(outcomes.get(resumableRun.id), {
      runId: resumableRun.id,
      outcome: "auto_resumed",
      reason: null,
    })
  } finally {
    db.close()
  }
})

test("startup recovery emits no recovery outcomes when no stale runs are present", async () => {
  const { db, repos, ws, item } = fixture()
  try {
    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: item.title, owner: "cli" })
    repos.updateRun(run.id, { current_stage: "execution" })
    claimWorkerLease(repos, {
      runId: run.id,
      workerInstanceId: "cli-fresh",
      workerOwnerKind: "cli",
      now: 1_700_000_120_000,
    })

    const result = await recoverLostWorkerRuns(repos, {
      apiWorkerInstanceId: "api-current",
      now: 1_700_000_130_001,
      autoResume: {
        enabled: true,
        resumeRun: async () => {
          throw new Error("should not be called")
        },
      },
    })

    assert.equal(result.recovered, 0)
    assert.deepEqual(result.recoveredRunIds, [])
    assert.deepEqual(result.outcomes, [])
    assert.equal(repos.getRun(run.id)?.status, "running")
    assert.equal(repos.listLogsForRun(run.id).filter(log => log.event_type === "startup_recovery").length, 0)
  } finally {
    db.close()
  }
})
