import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { initDatabase } from "../src/db/connection.js"
import { Repos, type WorkerOwnerKind } from "../src/db/repositories.js"
import {
  claimWorkerLease,
  startWorkerLeaseHeartbeat,
  WORKER_HEARTBEAT_INTERVAL_MS,
} from "../src/core/workerLease.js"

function tmpRepos() {
  const db = initDatabase(join(mkdtempSync(join(tmpdir(), "be2-worker-heartbeat-")), "test.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "test", name: "Test" })
  const item = repos.createItem({ workspaceId: workspace.id, title: "Lease target", description: "" })
  const run = repos.createRun({ workspaceId: workspace.id, itemId: item.id, title: "Lease target" })
  return { db, repos, run }
}

function fakeScheduler() {
  const intervals: Array<{ callback: () => void; ms: number; cleared: boolean }> = []
  return {
    intervals,
    scheduler: {
      setInterval(callback: () => void, ms: number): number {
        intervals.push({ callback, ms, cleared: false })
        return intervals.length - 1
      },
      clearInterval(id: number): void {
        intervals[id]!.cleared = true
      },
    },
  }
}

for (const workerOwnerKind of ["cli", "api"] satisfies WorkerOwnerKind[]) {
  test(`${workerOwnerKind} heartbeat refreshes every configured cadence`, () => {
    const { db, repos, run } = tmpRepos()
    const scheduled = fakeScheduler()
    let now = 1_700_000_000_000
    try {
      claimWorkerLease(repos, {
        runId: run.id,
        workerInstanceId: `${workerOwnerKind}-instance`,
        workerOwnerKind,
        now,
      })
      const lease = startWorkerLeaseHeartbeat(repos, {
        runId: run.id,
        workerInstanceId: `${workerOwnerKind}-instance`,
        workerOwnerKind,
        now: () => now,
        scheduler: scheduled.scheduler,
      })

      assert.equal(scheduled.intervals[0]?.ms, WORKER_HEARTBEAT_INTERVAL_MS)
      now += WORKER_HEARTBEAT_INTERVAL_MS
      scheduled.intervals[0]!.callback()

      assert.equal(repos.getRun(run.id)?.worker_heartbeat_at, now)
      lease.stop()
      assert.equal(scheduled.intervals[0]?.cleared, true)
    } finally {
      db.close()
    }
  })
}

test("one or two heartbeat write failures keep the worker active, third failure marks recoverable", () => {
  const { db, repos, run } = tmpRepos()
  const scheduled = fakeScheduler()
  try {
    claimWorkerLease(repos, {
      runId: run.id,
      workerInstanceId: "cli-instance",
      workerOwnerKind: "cli",
      now: 1_700_000_000_000,
    })
    let failures = 0
    repos.refreshRunWorkerHeartbeat = () => {
      failures += 1
      throw new Error("sqlite busy")
    }

    startWorkerLeaseHeartbeat(repos, {
      runId: run.id,
      workerInstanceId: "cli-instance",
      workerOwnerKind: "cli",
      now: () => 1_700_000_030_000 + failures,
      scheduler: scheduled.scheduler,
    })

    scheduled.intervals[0]!.callback()
    assert.equal(repos.getRun(run.id)?.status, "running")
    assert.equal(repos.getRun(run.id)?.recovery_status, null)

    scheduled.intervals[0]!.callback()
    assert.equal(repos.getRun(run.id)?.status, "running")
    assert.equal(repos.getRun(run.id)?.recovery_status, null)

    scheduled.intervals[0]!.callback()
    assert.equal(repos.getRun(run.id)?.status, "failed")
    assert.equal(repos.getRun(run.id)?.recovery_status, "failed")
    assert.equal(repos.getRun(run.id)?.recovery_scope, "run")
  } finally {
    db.close()
  }
})

test("lost ownership marks the run failed and stops the heartbeat loop", () => {
  const { db, repos, run } = tmpRepos()
  const scheduled = fakeScheduler()
  try {
    claimWorkerLease(repos, {
      runId: run.id,
      workerInstanceId: "api-instance-1",
      workerOwnerKind: "api",
      now: 1_700_000_000_000,
    })
    claimWorkerLease(repos, {
      runId: run.id,
      workerInstanceId: "api-instance-2",
      workerOwnerKind: "api",
      now: 1_700_000_010_000,
    })

    startWorkerLeaseHeartbeat(repos, {
      runId: run.id,
      workerInstanceId: "api-instance-1",
      workerOwnerKind: "api",
      now: () => 1_700_000_030_000,
      scheduler: scheduled.scheduler,
    })

    scheduled.intervals[0]!.callback()
    const failed = repos.getRun(run.id)
    assert.equal(failed?.status, "failed")
    assert.equal(failed?.recovery_status, "failed")
    assert.match(failed?.recovery_summary ?? "", /lost worker ownership/i)
    assert.equal(scheduled.intervals[0]?.cleared, true)
  } finally {
    db.close()
  }
})
