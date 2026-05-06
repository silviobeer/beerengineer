import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { claimWorkerLease } from "../src/core/workerLease.js"
import { persistWorkflowEvent } from "../src/core/dbSync.js"

function fixture() {
  const db = initDatabase(join(mkdtempSync(join(tmpdir(), "be2-worker-resume-")), "test.sqlite"))
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "test", name: "Test" })
  const item = repos.createItem({ workspaceId: ws.id, title: "Resume worker", description: "" })
  return { db, repos, ws, item }
}

test("lost-worker resume reuses the same run row, claims a fresh lease, and re-enters running projection", () => {
  const { db, repos, ws, item } = fixture()
  try {
    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: item.title, owner: "api" })
    repos.updateRun(run.id, {
      status: "failed",
      current_stage: "requirements",
      recovery_status: "failed",
      recovery_scope: "run",
      recovery_scope_ref: null,
      recovery_summary: "API restart lost API worker ownership — no live worker; resume or abandon.",
    })
    repos.setItemColumn(item.id, "requirements", "failed")
    repos.setItemCurrentStage(item.id, null)
    const remediation = repos.createExternalRemediation({
      runId: run.id,
      scope: "run",
      summary: "Resume recovered lost worker.",
      source: "api",
    })

    claimWorkerLease(repos, {
      runId: run.id,
      workerInstanceId: "api-new",
      workerOwnerKind: "api",
      now: 1_700_000_100_000,
    })
    persistWorkflowEvent(repos, {
      type: "run_resumed",
      runId: run.id,
      remediationId: remediation.id,
      scope: { type: "run", runId: run.id },
    })
    repos.updateRun(run.id, { status: "running", current_stage: "requirements" })
    persistWorkflowEvent(repos, {
      type: "stage_started",
      runId: run.id,
      itemId: item.id,
      title: item.title,
      stageKey: "requirements",
      stageRunId: "stage-resume",
    })

    const runs = repos.listRunsForItem(item.id)
    assert.equal(runs.length, 1)
    assert.equal(runs[0]?.id, run.id)
    assert.equal(runs[0]?.worker_instance_id, "api-new")
    assert.equal(runs[0]?.worker_heartbeat_at, 1_700_000_100_000)
    assert.equal(runs[0]?.recovery_status, null)
    assert.equal(repos.latestExternalRemediation(run.id)?.id, remediation.id)
    const projected = repos.getItem(item.id)
    assert.equal(projected?.current_column, "requirements")
    assert.equal(projected?.phase_status, "running")
    assert.equal(projected?.current_stage, "requirements")
  } finally {
    db.close()
  }
})
