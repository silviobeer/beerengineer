import { test } from "node:test"
import assert from "node:assert/strict"
import { Readable } from "node:stream"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initDatabase } from "../../../src/db/connection.js"
import { Repos } from "../../../src/db/repositories.js"
import { handleSupabaseDestroyBranch, resolveDestroyBranchTarget } from "../../../src/api/routes/setup.js"

test("PROJ-4 PRD-8 US-2: engine exposes typed-confirm destroy route", () => {
  const server = readFileSync(new URL("../../../src/api/server.ts", import.meta.url), "utf8")
  const routes = readFileSync(new URL("../../../src/api/routes/setup.ts", import.meta.url), "utf8")
  assert.match(server, /POST \/setup\/supabase\/destroy/)
  assert.match(routes, /confirmedName/)
  assert.match(routes, /confirmation_mismatch/)
})

test("PROJ-4 QA-002: destroy target is resolved from stored run branch metadata", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-destroy-target-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  try {
    const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
    repos.connectWorkspaceSupabase(workspace.id, { projectRef: "proj_1", region: "eu-central-1" })
    repos.setWorkspaceSupabasePersistentBranch(workspace.id, { ref: "persistent", name: "beerengineer-demo-test", status: "ACTIVE_HEALTHY" })
    const item = repos.createItem({ workspaceId: workspace.id, title: "Item", description: "Desc" })
    const run = repos.createRun({ workspaceId: workspace.id, itemId: item.id, title: "Run" })
    repos.setRunSupabaseBranch(run.id, { ref: "br_run", name: "beerengineer-demo-wave-1", lifecycleState: "retained-for-diagnosis" })

    assert.equal(resolveDestroyBranchTarget(repos, {
      workspaceId: workspace.id,
      runId: run.id,
      branchRef: "persistent",
      branchName: "persistent",
      confirmedName: "persistent",
    }).ok, false)

    const resolved = resolveDestroyBranchTarget(repos, {
      workspaceId: workspace.id,
      runId: run.id,
      branchRef: "br_run",
      branchName: "attacker-controlled",
      confirmedName: "beerengineer-demo-wave-1",
    })
    assert.equal(resolved.ok, true)
    assert.equal(resolved.ok ? resolved.branchName : "", "beerengineer-demo-wave-1")
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// BUG-PROJ4-QA-006: arbitrary file deletion via attacker-controlled handoffPath
// ---------------------------------------------------------------------------
//
// The destroy route previously read `body.handoffPath` and forwarded it to
// `unlink()`. An authenticated attacker could pass `handoffPath: "/etc/passwd"`
// and trigger an arbitrary file deletion after the branch destroy succeeded.
//
// Fix:
//   1. Server derives the handoff directory from workspace root + runId via the
//      canonical `<root>/.beerengineer/handoff/supabase/<runId>/` tree.
//   2. The server asserts the resolved path is contained inside the canonical
//      handoff root.
//   3. `body.handoffPath` is ignored.
//   4. `runId` is validated against `^[A-Za-z0-9._-]+$` before composing any
//      path so future callers can't smuggle `..` segments.

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

function setupAuthorizedDestroyTarget(dir: string, runId?: string) {
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const ws = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
  repos.connectWorkspaceSupabase(ws.id, { projectRef: "proj_1", region: "eu-central-1" })
  const item = repos.createItem({ workspaceId: ws.id, title: "Item", description: "Desc" })
  const run = repos.createRun({ workspaceId: ws.id, itemId: item.id, title: "Run", id: runId })
  repos.setRunSupabaseBranch(run.id, { ref: "br_run", name: "wave-1", lifecycleState: "retained-for-diagnosis" })
  return { db, repos, ws, run }
}

test("BUG-PROJ4-QA-006: attacker-controlled handoffPath /etc/passwd is ignored; only canonical handoff dir is touched", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-destroy-traversal-"))
  const { db, repos, ws, run } = setupAuthorizedDestroyTarget(dir)
  try {
    // Plant a real handoff file at the canonical server-derived location.
    const canonicalDir = join(dir, ".beerengineer", "handoff", "supabase", run.id)
    mkdirSync(canonicalDir, { recursive: true })
    const canonicalFile = join(canonicalDir, "wave-1.env")
    writeFileSync(canonicalFile, "SUPABASE_URL=x")

    // Sentinel outside the workspace — must NOT be touched no matter what.
    const sentinelDir = mkdtempSync(join(tmpdir(), "be2-destroy-sentinel-"))
    const sentinel = join(sentinelDir, "sensitive.env")
    writeFileSync(sentinel, "do-not-delete")

    const destroyCalls: unknown[] = []
    const adapter = {
      destroyBranch: async (context: unknown) => { destroyCalls.push(context); return { ok: true } },
    }

    const { res, state } = captureRes()
    await handleSupabaseDestroyBranch({
      repos,
      adapter,
      req: jsonReq({
        workspaceId: ws.id,
        runId: run.id,
        branchRef: "br_run",
        confirmedName: "wave-1",
        handoffPath: sentinel, // attacker-controlled — must be ignored
      }),
      res,
    })

    // Sentinel file outside the workspace must still exist.
    assert.equal(existsSync(sentinel), true, "attacker-controlled handoffPath must not be unlinked")

    // Canonical handoff dir (server-derived) must be removed on success.
    assert.equal(existsSync(canonicalFile), false, "server-derived handoff file must be removed")
    assert.equal(state.status, 200)
    assert.equal(destroyCalls.length, 1, "destroy must still proceed against the legitimate branch")

    rmSync(sentinelDir, { recursive: true, force: true })
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("BUG-PROJ4-QA-006: relative-traversal handoffPath does not escape the workspace handoff root", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-destroy-traversal-rel-"))
  const { db, repos, ws, run } = setupAuthorizedDestroyTarget(dir)
  try {
    const canonicalDir = join(dir, ".beerengineer", "handoff", "supabase", run.id)
    mkdirSync(canonicalDir, { recursive: true })
    const canonicalFile = join(canonicalDir, "wave-1.env")
    writeFileSync(canonicalFile, "SUPABASE_URL=x")

    // Create a sentinel that a relative traversal might target.
    const sentinelDir = mkdtempSync(join(tmpdir(), "be2-destroy-escape-"))
    const sentinel = join(sentinelDir, "escape")
    writeFileSync(sentinel, "do-not-delete")

    let destroyCalls = 0
    const adapter = { destroyBranch: async () => { destroyCalls += 1; return { ok: true } } }

    const { res, state } = captureRes()
    await handleSupabaseDestroyBranch({
      repos,
      adapter,
      req: jsonReq({
        workspaceId: ws.id,
        runId: run.id,
        branchRef: "br_run",
        confirmedName: "wave-1",
        handoffPath: "../../../tmp/escape", // ignored — server derives path
      }),
      res,
    })

    assert.equal(existsSync(sentinel), true, "relative-traversal handoffPath must not escape and unlink anything")
    assert.equal(existsSync(canonicalFile), false, "canonical handoff file must still be cleaned")
    assert.equal(state.status, 200)
    assert.equal(destroyCalls, 1)

    rmSync(sentinelDir, { recursive: true, force: true })
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("BUG-PROJ4-QA-006: request without handoffPath still destroys + cleans canonical handoff dir", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-destroy-no-handoff-"))
  const { db, repos, ws, run } = setupAuthorizedDestroyTarget(dir)
  try {
    const canonicalDir = join(dir, ".beerengineer", "handoff", "supabase", run.id)
    mkdirSync(canonicalDir, { recursive: true })
    const canonicalFile = join(canonicalDir, "wave-1.env")
    writeFileSync(canonicalFile, "SUPABASE_URL=x")

    let destroyCalls = 0
    const adapter = { destroyBranch: async () => { destroyCalls += 1; return { ok: true } } }

    const { res, state } = captureRes()
    await handleSupabaseDestroyBranch({
      repos,
      adapter,
      req: jsonReq({
        workspaceId: ws.id,
        runId: run.id,
        branchRef: "br_run",
        confirmedName: "wave-1",
        // no handoffPath in body
      }),
      res,
    })

    assert.equal(state.status, 200)
    assert.equal(destroyCalls, 1)
    assert.equal(existsSync(canonicalFile), false, "canonical handoff file must be removed")
    assert.equal(existsSync(canonicalDir), false, "canonical handoff dir must be removed")
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("BUG-PROJ4-QA-006: runId containing path-traversal segments is rejected before any FS call", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-destroy-bad-runid-"))
  // Use a malicious runId. createRun accepts a custom id, so a future caller
  // could theoretically mint one with `../`. The security gate is the destroy
  // handler's SAFE_ID_RE check — no FS access must occur for such an id.
  const { db, repos, ws, run } = setupAuthorizedDestroyTarget(dir, "../../../escape")
  try {
    assert.equal(run.id, "../../../escape")

    let destroyCalls = 0
    const adapter = { destroyBranch: async () => { destroyCalls += 1; return { ok: true } } }

    const { res, state } = captureRes()
    await handleSupabaseDestroyBranch({
      repos,
      adapter,
      req: jsonReq({
        workspaceId: ws.id,
        runId: run.id,
        branchRef: "br_run",
        confirmedName: "wave-1",
      }),
      res,
    })

    assert.notEqual(state.status, 200, "request with traversal runId must not succeed")
    assert.equal(destroyCalls, 0, "no adapter or FS call must occur for an invalid runId")
    assert.match(state.body ?? "", /destroy_target_invalid|invalid_run_id|destroy_context_required/)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
