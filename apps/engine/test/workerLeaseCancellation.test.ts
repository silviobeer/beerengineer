import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createBus } from "../src/core/bus.js"
import { getActiveRun } from "../src/core/runContext.js"
import { busToWorkflowIO, prepareRun } from "../src/core/runOrchestrator.js"
import { getWorkflowIO } from "../src/core/io.js"
import { claimWorkerLease } from "../src/core/workerLease.js"
import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"

function tmpRepos() {
  const db = initDatabase(join(mkdtempSync(join(tmpdir(), "be2-worker-cancel-")), "test.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "test", name: "Test" })
  const item = repos.createItem({ workspaceId: workspace.id, title: "Lease cancellation", description: "" })
  return { db, repos, item }
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

test("lost ownership cancels the production workflow body before further side effects", async () => {
  const { db, repos, item } = tmpRepos()
  const scheduled = fakeScheduler()
  const sideEffects: string[] = []
  try {
    const bus = createBus()
    let prepared!: ReturnType<typeof prepareRun>
    prepared = prepareRun(
      { id: item.id, title: item.title, description: item.description },
      repos,
      { ...busToWorkflowIO(bus), bus },
      {
        owner: "api",
        itemId: item.id,
        workerInstanceId: "api-instance-1",
        workerLeaseClock: () => 1_700_000_000_000,
        workerLeaseScheduler: scheduled.scheduler,
        workflowRunner: async () => {
          sideEffects.push("before-lost-ownership")
          claimWorkerLease(repos, {
            runId: prepared.runId,
            workerInstanceId: "api-instance-2",
            workerOwnerKind: "api",
            now: 1_700_000_010_000,
          })
          scheduled.intervals[0]!.callback()
          const active = getActiveRun()
          assert.ok(active)
          getWorkflowIO().emit({ type: "log", runId: active.runId, message: "should not persist" })
          sideEffects.push("after-lost-ownership")
        },
      },
    )

    await assert.rejects(prepared.start(), /workflow_cancelled:lost_ownership/)
    assert.deepEqual(sideEffects, ["before-lost-ownership"])
    assert.equal(scheduled.intervals[0]?.cleared, true)
    const recovered = repos.getRun(prepared.runId)
    assert.equal(recovered?.status, "failed")
    assert.equal(recovered?.recovery_status, "failed")
    assert.match(recovered?.recovery_summary ?? "", /lost worker ownership/i)
    await new Promise<void>(resolve => setImmediate(resolve))
  } finally {
    db.close()
  }
})
