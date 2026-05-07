import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { createBus } from "../src/core/bus.js"
import { busToWorkflowIO } from "../src/core/runOrchestrator.js"
import { prepareRun } from "../src/core/runOrchestrator.js"

function tmpRepos() {
  const db = initDatabase(join(mkdtempSync(join(tmpdir(), "be2-worker-cli-")), "test.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "test", name: "Test" })
  const item = repos.createItem({ workspaceId: workspace.id, title: "CLI lease", description: "" })
  return { db, repos, item }
}

function fakeScheduler() {
  const intervals: Array<{ callback: () => void; ms: number }> = []
  return {
    intervals,
    scheduler: {
      setInterval(callback: () => void, ms: number): number {
        intervals.push({ callback, ms })
        return intervals.length - 1
      },
      clearInterval(): void {},
    },
  }
}

test("CLI prepareRun claims ownership before start callback executes workflow side effects", () => {
  const { db, repos, item } = tmpRepos()
  const scheduled = fakeScheduler()
  let now = 1_700_000_000_000
  try {
    const bus = createBus()
    const prepared = prepareRun(
      { id: item.id, title: item.title, description: item.description },
      repos,
      { ...busToWorkflowIO(bus), bus },
      {
        owner: "cli",
        itemId: item.id,
        workerInstanceId: "cli-instance-test",
        workerLeaseClock: () => now,
        workerLeaseScheduler: scheduled.scheduler,
      },
    )

    const run = repos.getRun(prepared.runId)
    assert.equal(run?.worker_owner_kind, "cli")
    assert.equal(run?.worker_instance_id, "cli-instance-test")
    assert.equal(run?.worker_started_at, 1_700_000_000_000)
    assert.equal(run?.worker_heartbeat_at, 1_700_000_000_000)

    now += 30_000
    scheduled.intervals[0]!.callback()
    assert.equal(repos.getRun(prepared.runId)?.worker_heartbeat_at, now)
  } finally {
    db.close()
  }
})
