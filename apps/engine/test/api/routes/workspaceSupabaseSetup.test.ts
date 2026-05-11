import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { Readable } from "node:stream"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { listImplementedApiRouteSurface } from "../../../src/api/routeRegistration.js"
import { initDatabase } from "../../../src/db/connection.js"
import { Repos } from "../../../src/db/repositories.js"
import { handleWorkspaceSupabaseBranch } from "../../../src/api/routes/workspaces.js"

test("PROJ-6 PRD-3 US-2: workspace Supabase setup routes use route-key endpoints", () => {
  const routes = readFileSync("src/api/routes/workspaces.ts", "utf8")
  const surface = listImplementedApiRouteSurface()
  assert.ok(surface.includes("GET /workspaces/{key}/supabase/readiness"))
  assert.ok(surface.includes("POST /workspaces/{key}/supabase/connect"))
  assert.ok(surface.includes("POST /workspaces/{key}/supabase/rotate"))
  assert.ok(surface.includes("POST /workspaces/{key}/supabase/branch"))
  assert.match(routes, /getWorkspaceByKey\(key\)/)
  assert.match(routes, /workspaceId: workspace.id/)
  assert.ok(routes.includes('const mode = body.mode === "attach" ? "attach" : "create"'))
})

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

test("PROJ-14 REQ-4 AC-4.4: direct-mode branch setup route rejects branch-only actions as unavailable", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-workspace-supabase-direct-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "alpha", name: "Alpha", rootPath: dir })
  repos.connectWorkspaceSupabase(workspace.id, { projectRef: "proj_direct", region: "eu", dbMode: "direct" })
  try {
    const before = repos.getWorkspace(workspace.id)
    const { res, state } = captureRes()
    await handleWorkspaceSupabaseBranch(repos, jsonReq({ mode: "create" }), res, "alpha")
    assert.equal(state.status, 409)
    const body = JSON.parse(state.body ?? "{}") as Record<string, unknown>
    assert.equal(body.error, "branching_unavailable")
    const after = repos.getWorkspace(workspace.id)
    assert.equal(after?.supabase_persistent_test_branch_ref, before?.supabase_persistent_test_branch_ref)
    assert.equal(after?.supabase_persistent_test_branch_name, before?.supabase_persistent_test_branch_name)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
