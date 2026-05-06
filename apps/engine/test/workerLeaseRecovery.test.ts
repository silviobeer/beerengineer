import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { claimWorkerLease } from "../src/core/workerLease.js"
import { recoverLostWorkerRuns } from "../src/core/orphanRecovery.js"

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
