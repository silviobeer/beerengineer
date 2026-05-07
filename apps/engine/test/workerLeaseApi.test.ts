import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { startRunFromIdea } from "../src/core/runService.js"

function tmpRepos() {
  const dir = mkdtempSync(join(tmpdir(), "be2-worker-api-"))
  const db = initDatabase(join(dir, "test.sqlite"))
  const repos = new Repos(db)
  repos.upsertWorkspace({ key: "api", name: "API", rootPath: dir })
  return { db, repos }
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

test("API start returns success only after durable worker ownership exists", () => {
  const { db, repos } = tmpRepos()
  const scheduled = fakeScheduler()
  let now = 1_700_000_000_000
  try {
    const result = startRunFromIdea(repos, {
      title: "API worker lease",
      description: "start claim",
      workspaceKey: "api",
      apiWorkerInstanceId: "api-instance-test",
      workerLeaseClock: () => now,
      workerLeaseScheduler: scheduled.scheduler,
      backgroundRunner: () => {},
    })

    assert.equal(result.ok, true)
    if (!result.ok) return
    const run = repos.getRun(result.runId)
    assert.equal(run?.worker_owner_kind, "api")
    assert.equal(run?.worker_instance_id, "api-instance-test")
    assert.equal(run?.worker_started_at, 1_700_000_000_000)
    assert.equal(run?.worker_heartbeat_at, 1_700_000_000_000)

    now += 30_000
    scheduled.intervals[0]!.callback()
    assert.equal(repos.getRun(result.runId)?.worker_heartbeat_at, now)
  } finally {
    db.close()
  }
})
