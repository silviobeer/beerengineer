import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { initDatabase } from "../../src/db/connection.js"
import { Repos } from "../../src/db/repositories.js"
import { connectSupabaseProject } from "../../src/setup/supabaseSetup.js"
import { SUPABASE_MANAGEMENT_TOKEN_SECRET_REF } from "../../src/setup/secretMetadata.js"
import { readActiveSecretValue } from "../../src/setup/secretStore.js"

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "be2-supabase-setup-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
  return { dir, db, repos, workspace, storePath: join(dir, "secrets.json") }
}

test("PROJ-4 PRD-2 US-1: setup connect validates before persisting token and metadata", async () => {
  const ctx = fixture()
  try {
    const result = await connectSupabaseProject({
      repos: ctx.repos,
      workspaceId: ctx.workspace.id,
      token: "sbp_token",
      projectRef: "proj_1",
      secretStore: { storePath: ctx.storePath },
      client: { listProjects: async () => [{ id: "1", ref: "proj_1", region: "eu" }] },
    })
    assert.deepEqual(result, { ok: true, projectRef: "proj_1", region: "eu" })
    assert.equal(readActiveSecretValue(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, { storePath: ctx.storePath }), "sbp_token")
    assert.equal(ctx.repos.getWorkspace(ctx.workspace.id)?.supabase_project_ref, "proj_1")
  } finally {
    ctx.db.close()
    rmSync(ctx.dir, { recursive: true, force: true })
  }
})

test("PROJ-4 PRD-2 US-1: validation failure persists neither token nor project metadata", async () => {
  const ctx = fixture()
  try {
    const result = await connectSupabaseProject({
      repos: ctx.repos,
      workspaceId: ctx.workspace.id,
      token: "sbp_bad",
      projectRef: "proj_1",
      secretStore: { storePath: ctx.storePath },
      client: { listProjects: async () => { throw new Error("Invalid token") } },
    })
    assert.equal(result.ok, false)
    assert.equal(readActiveSecretValue(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, { storePath: ctx.storePath }), null)
    assert.equal(ctx.repos.getWorkspace(ctx.workspace.id)?.supabase_project_ref, null)
    if (!result.ok) assert.equal(result.message, "Invalid token")
  } finally {
    ctx.db.close()
    rmSync(ctx.dir, { recursive: true, force: true })
  }
})

