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
    const message = projectStageLogRow(repos.listLogsForRun(run.id).at(-1)!)
    assert.equal(message?.type, "startup_recovery")
    assert.equal(message?.payload.outcome, "auto_resumed")
    assert.equal(message?.payload.reason, null)
  } finally {
    db.close()
  }
})

test("startup recovery keeps stale runs with open prompts on manual recovery and records why", async () => {
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
    repos.createPendingPrompt({ runId: run.id, prompt: "Need approval?" })

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

    assert.equal(resumeCalls, 0)
    assert.equal(result.outcomes[0]?.outcome, "skipped")
    assert.equal(result.outcomes[0]?.reason, "open_prompt")
    assert.equal(repos.getRun(run.id)?.status, "failed")
    assert.equal(repos.getRun(run.id)?.recovery_status, "failed")
    const message = projectStageLogRow(repos.listLogsForRun(run.id).at(-1)!)
    assert.equal(message?.type, "startup_recovery")
    assert.equal(message?.payload.outcome, "skipped")
    assert.equal(message?.payload.reason, "open_prompt")
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
    const message = projectStageLogRow(repos.listLogsForRun(run.id).at(-1)!)
    assert.equal(message?.type, "startup_recovery")
    assert.equal(message?.payload.outcome, "skipped")
    assert.equal(message?.payload.reason, "auto_resume_disabled")
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

    const result = await recoverLostWorkerRuns(repos, {
      apiWorkerInstanceId: "api-current",
      now: 1_700_000_130_001,
      autoResume: {
        enabled: true,
        resumeRun: async () => {
          throw new Error("resume exploded")
        },
      },
    })

    assert.equal(result.outcomes[0]?.outcome, "failed")
    assert.equal(result.outcomes[0]?.reason, "auto_resume_failed")
    assert.equal(repos.getRun(run.id)?.status, "failed")
    assert.equal(repos.getRun(run.id)?.recovery_status, "failed")
    const message = projectStageLogRow(repos.listLogsForRun(run.id).at(-1)!)
    assert.equal(message?.type, "startup_recovery")
    assert.equal(message?.payload.outcome, "failed")
    assert.equal(message?.payload.reason, "auto_resume_failed")
    assert.match(String(message?.payload.error ?? ""), /resume exploded/)
  } finally {
    db.close()
  }
})
