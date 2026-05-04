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

type Captured = ReturnType<typeof captureRes>["state"]

function parseBody(state: Captured): Record<string, unknown> {
  return state.body ? JSON.parse(state.body) as Record<string, unknown> : {}
}

function setupFixture(rootSuffix: string) {
  const dir = mkdtempSync(join(tmpdir(), `be2-branch-actions-${rootSuffix}-`))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const cleanup = () => { db.close(); rmSync(dir, { recursive: true, force: true }) }
  return { dir, db, repos, cleanup }
}

test("PROJ-4 PRD-9 US-4: retry validation invokes validateBranch only and records operator event", async () => {
  const { dir, db, repos, cleanup } = setupFixture("us4")
  try {
    const ws = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
    repos.connectWorkspaceSupabase(ws.id, { projectRef: "proj-real", region: "us-east-1" })
    const item = repos.createItem({ workspaceId: ws.id, title: "Item", description: "Desc" })
    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "Run" })
    repos.setRunSupabaseBranch(run.id, { ref: "br_1", name: "Branch", lifecycleState: "in_progress" })
    let validateCalls = 0
    let receivedContext: Record<string, unknown> | undefined
    const { res, state } = captureRes()
    await handleRetryValidation({
      repos,
      req: jsonReq({ runId: run.id, workspaceId: ws.id, projectRef: "proj-real", workspaceLocalOperatorId: "operator-1" }),
      res,
      branchRef: "br_1",
      adapter: { validateBranch: async context => { validateCalls += 1; receivedContext = context as never; return { ok: true, context } } },
    })
    assert.equal(state.status, 200)
    assert.equal(validateCalls, 1)
    assert.equal((receivedContext as { projectRef: string }).projectRef, "proj-real")
    assert.equal((receivedContext as { branchRef: string }).branchRef, "br_1")
    assert.equal((receivedContext as { workspaceRoot: string }).workspaceRoot, dir)
    const action = repos.listLogsForRun(run.id).find(log => log.event_type === "supabase_operator_action")
    assert.ok(action, "operator action recorded")
    const data = JSON.parse(action!.data_json ?? "{}") as Record<string, unknown>
    assert.equal(data.outcome, "accepted")
  } finally {
    cleanup()
  }
})

test("PROJ-4 PRD-9 BUG-007: body projectRef mismatched against workspace -> 403 supabase_target_mismatch", async () => {
  const { dir, db, repos, cleanup } = setupFixture("mismatch-proj")
  try {
    const ws = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
    repos.connectWorkspaceSupabase(ws.id, { projectRef: "proj-real", region: "us-east-1" })
    const item = repos.createItem({ workspaceId: ws.id, title: "Item", description: "Desc" })
    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "Run" })
    repos.setRunSupabaseBranch(run.id, { ref: "br_1", name: "Branch", lifecycleState: "in_progress" })
    let validateCalls = 0
    const { res, state } = captureRes()
    await handleRetryValidation({
      repos,
      req: jsonReq({ runId: run.id, workspaceId: ws.id, projectRef: "evil-proj" }),
      res,
      branchRef: "br_1",
      adapter: { validateBranch: async () => { validateCalls += 1; return { ok: true } } },
    })
    assert.equal(state.status, 403)
    assert.equal(validateCalls, 0)
    const body = parseBody(state)
    assert.equal(body.error, "supabase_target_mismatch")
    const action = repos.listLogsForRun(run.id).find(log => log.event_type === "supabase_operator_action")
    const data = JSON.parse(action!.data_json ?? "{}") as Record<string, unknown>
    assert.equal(data.outcome, "rejected")
    assert.equal(data.reason, "project_ref_mismatch")
  } finally {
    cleanup()
  }
})

test("PROJ-4 PRD-9 BUG-007: URL branchRef mismatched against run.supabase_branch_ref -> 403", async () => {
  const { dir, db, repos, cleanup } = setupFixture("mismatch-branch")
  try {
    const ws = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
    repos.connectWorkspaceSupabase(ws.id, { projectRef: "proj-real", region: "us-east-1" })
    const item = repos.createItem({ workspaceId: ws.id, title: "Item", description: "Desc" })
    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "Run" })
    repos.setRunSupabaseBranch(run.id, { ref: "br_real", name: "Branch", lifecycleState: "in_progress" })
    let validateCalls = 0
    const { res, state } = captureRes()
    await handleRetryValidation({
      repos,
      req: jsonReq({ runId: run.id, workspaceId: ws.id }),
      res,
      branchRef: "br_attacker",
      adapter: { validateBranch: async () => { validateCalls += 1; return { ok: true } } },
    })
    assert.equal(state.status, 403)
    assert.equal(validateCalls, 0)
    assert.equal(parseBody(state).error, "supabase_target_mismatch")
    const action = repos.listLogsForRun(run.id).find(log => log.event_type === "supabase_operator_action")
    const data = JSON.parse(action!.data_json ?? "{}") as Record<string, unknown>
    assert.equal(data.outcome, "rejected")
    assert.equal(data.reason, "branch_ref_mismatch")
  } finally {
    cleanup()
  }
})

test("PROJ-4 PRD-9 BUG-007: cross-workspace runId hijack -> 403 run_workspace_mismatch", async () => {
  const { dir, db, repos, cleanup } = setupFixture("xws")
  try {
    const wsA = repos.upsertWorkspace({ key: "ws-a", name: "A", rootPath: join(dir, "a") })
    repos.connectWorkspaceSupabase(wsA.id, { projectRef: "proj-a", region: "us-east-1" })
    const wsB = repos.upsertWorkspace({ key: "ws-b", name: "B", rootPath: join(dir, "b") })
    repos.connectWorkspaceSupabase(wsB.id, { projectRef: "proj-b", region: "us-east-1" })
    const itemB = repos.createItem({ workspaceId: wsB.id, title: "ItemB", description: "Desc" })
    const runB = repos.createRun({ workspaceId: wsB.id, itemId: itemB.id, title: "RunB" })
    repos.setRunSupabaseBranch(runB.id, { ref: "br_b", name: "B", lifecycleState: "in_progress" })
    let validateCalls = 0
    const { res, state } = captureRes()
    await handleRetryValidation({
      repos,
      req: jsonReq({ runId: runB.id, workspaceId: wsA.id }),
      res,
      branchRef: "br_b",
      adapter: { validateBranch: async () => { validateCalls += 1; return { ok: true } } },
    })
    assert.equal(state.status, 403)
    assert.equal(validateCalls, 0)
    assert.equal(parseBody(state).error, "supabase_target_mismatch")
    const action = repos.listLogsForRun(runB.id).find(log => log.event_type === "supabase_operator_action")
    const data = JSON.parse(action!.data_json ?? "{}") as Record<string, unknown>
    assert.equal(data.outcome, "rejected")
    assert.equal(data.reason, "run_workspace_mismatch")
  } finally {
    cleanup()
  }
})

test("PROJ-4 PRD-9 BUG-007: workspace lacks supabase_project_ref -> 403 workspace_supabase_not_configured", async () => {
  const { dir, db, repos, cleanup } = setupFixture("no-proj")
  try {
    const ws = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
    const item = repos.createItem({ workspaceId: ws.id, title: "Item", description: "Desc" })
    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "Run" })
    let validateCalls = 0
    const { res, state } = captureRes()
    await handleRetryValidation({
      repos,
      req: jsonReq({ runId: run.id, workspaceId: ws.id }),
      res,
      branchRef: "br_1",
      adapter: { validateBranch: async () => { validateCalls += 1; return { ok: true } } },
    })
    assert.equal(state.status, 403)
    assert.equal(validateCalls, 0)
    assert.equal(parseBody(state).error, "supabase_target_mismatch")
    const action = repos.listLogsForRun(run.id).find(log => log.event_type === "supabase_operator_action")
    const data = JSON.parse(action!.data_json ?? "{}") as Record<string, unknown>
    assert.equal(data.outcome, "rejected")
    assert.equal(data.reason, "workspace_supabase_not_configured")
  } finally {
    cleanup()
  }
})

test("PROJ-4 PRD-9 BUG-007: run lacks supabase_branch_ref -> 403 run_branch_not_provisioned", async () => {
  const { dir, db, repos, cleanup } = setupFixture("no-branch")
  try {
    const ws = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
    repos.connectWorkspaceSupabase(ws.id, { projectRef: "proj-real", region: "us-east-1" })
    const item = repos.createItem({ workspaceId: ws.id, title: "Item", description: "Desc" })
    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "Run" })
    let validateCalls = 0
    const { res, state } = captureRes()
    await handleRetryValidation({
      repos,
      req: jsonReq({ runId: run.id, workspaceId: ws.id }),
      res,
      branchRef: "br_1",
      adapter: { validateBranch: async () => { validateCalls += 1; return { ok: true } } },
    })
    assert.equal(state.status, 403)
    assert.equal(validateCalls, 0)
    assert.equal(parseBody(state).error, "supabase_target_mismatch")
    const action = repos.listLogsForRun(run.id).find(log => log.event_type === "supabase_operator_action")
    const data = JSON.parse(action!.data_json ?? "{}") as Record<string, unknown>
    assert.equal(data.outcome, "rejected")
    assert.equal(data.reason, "run_branch_not_provisioned")
  } finally {
    cleanup()
  }
})

test("PROJ-4 PRD-9 BUG-007: run not found -> 403 run_not_found", async () => {
  const { dir, db, repos, cleanup } = setupFixture("no-run")
  try {
    const ws = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
    repos.connectWorkspaceSupabase(ws.id, { projectRef: "proj-real", region: "us-east-1" })
    let validateCalls = 0
    const { res, state } = captureRes()
    await handleRetryValidation({
      repos,
      req: jsonReq({ runId: "ghost-run", workspaceId: ws.id }),
      res,
      branchRef: "br_1",
      adapter: { validateBranch: async () => { validateCalls += 1; return { ok: true } } },
    })
    assert.equal(state.status, 403)
    assert.equal(validateCalls, 0)
    assert.equal(parseBody(state).error, "supabase_target_mismatch")
  } finally {
    cleanup()
  }
})

test("PROJ-4 PRD-9 BUG-007: happy path uses server-derived projectRef and workspaceRoot, ignores body fields", async () => {
  const { dir, db, repos, cleanup } = setupFixture("happy")
  try {
    const ws = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
    repos.connectWorkspaceSupabase(ws.id, { projectRef: "server-proj", region: "us-east-1" })
    const item = repos.createItem({ workspaceId: ws.id, title: "Item", description: "Desc" })
    const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "Run" })
    repos.setRunSupabaseBranch(run.id, { ref: "br_real", name: "Branch", lifecycleState: "in_progress" })
    let receivedContext: Record<string, unknown> | undefined
    const { res, state } = captureRes()
    await handleRetryValidation({
      repos,
      // body sneaks workspaceRoot — but server should ignore it (workspaceRoot of "/etc" is dangerous)
      req: jsonReq({ runId: run.id, workspaceId: ws.id, workspaceRoot: "/etc/attacker" }),
      res,
      branchRef: "br_real",
      adapter: { validateBranch: async context => { receivedContext = context as never; return { ok: true, context } } },
    })
    assert.equal(state.status, 200)
    assert.equal((receivedContext as { projectRef: string }).projectRef, "server-proj")
    assert.equal((receivedContext as { workspaceRoot: string }).workspaceRoot, dir)
    assert.notEqual((receivedContext as { workspaceRoot: string }).workspaceRoot, "/etc/attacker")
    const action = repos.listLogsForRun(run.id).find(log => log.event_type === "supabase_operator_action")
    const data = JSON.parse(action!.data_json ?? "{}") as Record<string, unknown>
    assert.equal(data.outcome, "accepted")
  } finally {
    cleanup()
  }
})
