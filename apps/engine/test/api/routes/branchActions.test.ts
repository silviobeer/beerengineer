import { test } from "node:test"
import assert from "node:assert/strict"
import { Readable } from "node:stream"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initDatabase } from "../../../src/db/connection.js"
import { Repos } from "../../../src/db/repositories.js"
import { handleRetryValidation } from "../../../src/api/routes/branchActions.js"

function jsonReq(body: unknown) {
  return Readable.from([JSON.stringify(body)]) as never
}

function captureRes() {
  const state: { status?: number; body?: string } = {}
  return {
    res: {
      writeHead(status: number) { state.status = status; return this },
      end(body: string) { state.body = body },
    } as never,
    state,
  }
}

test("PROJ-4 PRD-9 US-4: retry validation invokes validateBranch only and records operator event", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-branch-actions-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  try {
    const ws = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
    const item = repos.createItem({ workspaceId: ws.id, title: "Item", description: "Desc" })
    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "Run" })
    let validateCalls = 0
    const { res, state } = captureRes()
    await handleRetryValidation({
      repos,
      req: jsonReq({ runId: run.id, workspaceId: ws.id, projectRef: "proj", workspaceLocalOperatorId: "operator-1" }),
      res,
      branchRef: "br_1",
      adapter: { validateBranch: async context => { validateCalls += 1; return { ok: true, context } } },
    })
    assert.equal(state.status, 200)
    assert.equal(validateCalls, 1)
    const action = repos.listLogsForRun(run.id).find(log => log.event_type === "supabase_operator_action")
    assert.equal(action?.message, "retry_validation br_1")
    assert.match(action?.data_json ?? "", /operator-1/)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
