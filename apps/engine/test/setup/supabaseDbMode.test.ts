import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { getRegisteredWorkspace } from "../../src/core/workspaces.js"
import { initDatabase, type Db } from "../../src/db/connection.js"
import { Repos } from "../../src/db/repositories.js"
import { getAppConfigView } from "../../src/setup/appConfigView.js"
import { connectSupabaseProject } from "../../src/setup/supabaseSetup.js"

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "be2-supabase-db-mode-"))
  const dbPath = join(dir, "db.sqlite")
  const db = initDatabase(dbPath)
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir, lastOpenedAt: 1 })
  return { dir, dbPath, db, repos, workspace, storePath: join(dir, "secrets.json") }
}

function reopenRepos(db: Db, dbPath: string): { db: Db; repos: Repos } {
  db.close()
  const reopened = initDatabase(dbPath)
  return { db: reopened, repos: new Repos(reopened) }
}

function readSupabaseMode(repos: Repos): { settingsMode: "branching" | "direct" | undefined; workspaceMode: "branching" | "direct" | undefined } {
  const view = getAppConfigView({ configPath: join(tmpdir(), "missing-config.json") }, { repos })
  const workspace = getRegisteredWorkspace(repos, "demo")
  return {
    settingsMode: view.supabase.dbMode,
    workspaceMode: workspace?.supabaseDbMode,
  }
}

test("REQ-1 AC-1.1: initial connect persists branching mode across reload", async () => {
  const ctx = fixture()
  try {
    const result = await connectSupabaseProject({
      repos: ctx.repos,
      workspaceId: ctx.workspace.id,
      token: "sbp_token",
      projectRef: "proj_branching",
      secretStore: { storePath: ctx.storePath },
      client: {
        listProjects: async () => [{ id: "1", ref: "proj_branching", region: "eu", branchingEnabled: true }],
      },
    })

    assert.deepEqual(result, { ok: true, projectRef: "proj_branching", region: "eu", dbMode: "branching" })

    const reopened = reopenRepos(ctx.db, ctx.dbPath)
    ctx.db = reopened.db
    ctx.repos = reopened.repos

    const mode = readSupabaseMode(ctx.repos)
    assert.equal(mode.workspaceMode, "branching")
    assert.equal(mode.settingsMode, "branching")
  } finally {
    ctx.db.close()
    rmSync(ctx.dir, { recursive: true, force: true })
  }
})

test("REQ-1 AC-1.2: initial connect persists direct mode across reload", async () => {
  const ctx = fixture()
  try {
    const result = await connectSupabaseProject({
      repos: ctx.repos,
      workspaceId: ctx.workspace.id,
      token: "sbp_token",
      projectRef: "proj_direct",
      secretStore: { storePath: ctx.storePath },
      client: {
        listProjects: async () => [{ id: "1", ref: "proj_direct", region: "us", branchingEnabled: false }],
      },
    })

    assert.deepEqual(result, { ok: true, projectRef: "proj_direct", region: "us", dbMode: "direct" })

    const reopened = reopenRepos(ctx.db, ctx.dbPath)
    ctx.db = reopened.db
    ctx.repos = reopened.repos

    const mode = readSupabaseMode(ctx.repos)
    assert.equal(mode.workspaceMode, "direct")
    assert.equal(mode.settingsMode, "direct")
  } finally {
    ctx.db.close()
    rmSync(ctx.dir, { recursive: true, force: true })
  }
})

test("REQ-1 AC-1.3: stored direct mode stays authoritative until reconnect", async () => {
  const ctx = fixture()
  try {
    await connectSupabaseProject({
      repos: ctx.repos,
      workspaceId: ctx.workspace.id,
      token: "sbp_token",
      projectRef: "proj_direct",
      secretStore: { storePath: ctx.storePath },
      client: {
        listProjects: async () => [{ id: "1", ref: "proj_direct", region: "us", branchingEnabled: false }],
      },
    })

    const mode = readSupabaseMode(ctx.repos)
    assert.equal(mode.workspaceMode, "direct")
    assert.equal(mode.settingsMode, "direct")
  } finally {
    ctx.db.close()
    rmSync(ctx.dir, { recursive: true, force: true })
  }
})

test("REQ-1 AC-1.4: legacy connected workspace without dbMode stays readable and reconnects cleanly", async () => {
  const ctx = fixture()
  try {
    ctx.repos.connectWorkspaceSupabase(ctx.workspace.id, { projectRef: "legacy_project", region: "eu" })

    const before = readSupabaseMode(ctx.repos)
    assert.equal(before.workspaceMode, undefined)
    assert.equal(before.settingsMode, undefined)

    const reconnect = await connectSupabaseProject({
      repos: ctx.repos,
      workspaceId: ctx.workspace.id,
      token: "sbp_token",
      projectRef: "legacy_project",
      secretStore: { storePath: ctx.storePath },
      client: {
        listProjects: async () => [{ id: "1", ref: "legacy_project", region: "eu", branchingEnabled: true }],
      },
    })

    assert.deepEqual(reconnect, { ok: true, projectRef: "legacy_project", region: "eu", dbMode: "branching" })
    assert.equal(ctx.repos.getWorkspace(ctx.workspace.id)?.id, ctx.workspace.id)
    assert.equal(ctx.repos.getWorkspace(ctx.workspace.id)?.root_path, ctx.workspace.root_path)
  } finally {
    ctx.db.close()
    rmSync(ctx.dir, { recursive: true, force: true })
  }
})

test("REQ-1 AC-1.5: reconnect upgrades direct mode to branching mode", async () => {
  const ctx = fixture()
  try {
    await connectSupabaseProject({
      repos: ctx.repos,
      workspaceId: ctx.workspace.id,
      token: "sbp_token",
      projectRef: "proj_demo",
      secretStore: { storePath: ctx.storePath },
      client: {
        listProjects: async () => [{ id: "1", ref: "proj_demo", region: "eu", branchingEnabled: false }],
      },
    })

    const reconnect = await connectSupabaseProject({
      repos: ctx.repos,
      workspaceId: ctx.workspace.id,
      token: "sbp_token",
      projectRef: "proj_demo",
      secretStore: { storePath: ctx.storePath },
      client: {
        listProjects: async () => [{ id: "1", ref: "proj_demo", region: "eu", branchingEnabled: true }],
      },
    })

    assert.deepEqual(reconnect, { ok: true, projectRef: "proj_demo", region: "eu", dbMode: "branching" })

    const reopened = reopenRepos(ctx.db, ctx.dbPath)
    ctx.db = reopened.db
    ctx.repos = reopened.repos

    const mode = readSupabaseMode(ctx.repos)
    assert.equal(mode.workspaceMode, "branching")
    assert.equal(mode.settingsMode, "branching")
  } finally {
    ctx.db.close()
    rmSync(ctx.dir, { recursive: true, force: true })
  }
})

test("REQ-1 AC-1.3: failed reconnect preserves the previously stored mode", async () => {
  const ctx = fixture()
  try {
    await connectSupabaseProject({
      repos: ctx.repos,
      workspaceId: ctx.workspace.id,
      token: "sbp_token",
      projectRef: "proj_demo",
      secretStore: { storePath: ctx.storePath },
      client: {
        listProjects: async () => [{ id: "1", ref: "proj_demo", region: "eu", branchingEnabled: false }],
      },
    })

    const reconnect = await connectSupabaseProject({
      repos: ctx.repos,
      workspaceId: ctx.workspace.id,
      token: "sbp_bad",
      projectRef: "proj_demo",
      secretStore: { storePath: ctx.storePath },
      client: {
        listProjects: async () => { throw new Error("Invalid token") },
      },
    })

    assert.equal(reconnect.ok, false)

    const reopened = reopenRepos(ctx.db, ctx.dbPath)
    ctx.db = reopened.db
    ctx.repos = reopened.repos

    const mode = readSupabaseMode(ctx.repos)
    assert.equal(mode.workspaceMode, "direct")
    assert.equal(mode.settingsMode, "direct")
  } finally {
    ctx.db.close()
    rmSync(ctx.dir, { recursive: true, force: true })
  }
})
