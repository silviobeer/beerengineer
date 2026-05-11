import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initDatabase } from "../../../src/db/connection.js"
import { Repos } from "../../../src/db/repositories.js"
import { createOrAttachPersistentTestBranch } from "../../../src/core/supabase/persistentTestBranch.js"
import { SupabaseManagementError } from "../../../src/core/supabase/managementClient.js"

test("PROJ-4 PRD-2 US-3: creates and persists the persistent test branch", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-persistent-create-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "Demo App", name: "Demo", rootPath: dir })
  repos.connectWorkspaceSupabase(workspace.id, { projectRef: "proj_1", region: "eu" })
  const created: unknown[] = []
  try {
    const result = await createOrAttachPersistentTestBranch({
      repos,
      workspaceId: workspace.id,
      client: {
        listBranches: async () => [],
        createBranch: async (_projectRef, input) => {
          created.push(input)
          return { id: "br_1", ref: "br_1", name: input.name, status: "ACTIVE_HEALTHY" }
        },
      },
    })
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.action, "created")
    assert.equal(created.length, 1)
    const stored = repos.getWorkspace(workspace.id)
    assert.equal(stored?.supabase_persistent_test_branch_ref, "br_1")
    assert.equal(stored?.supabase_persistent_test_branch_status, "ACTIVE_HEALTHY")
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("PROJ-6 PRD-2 US-4: setup polls checking branch until ACTIVE_HEALTHY before storing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-persistent-checking-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
  repos.connectWorkspaceSupabase(workspace.id, { projectRef: "proj_1", region: "eu" })
  const statuses: string[] = []
  let now = 0
  try {
    const result = await createOrAttachPersistentTestBranch({
      repos,
      workspaceId: workspace.id,
      client: {
        listBranches: async () => [],
        createBranch: async (_projectRef, input) => ({ id: "br_1", ref: "br_1", name: input.name, status: "CREATING" }),
        getBranch: async () => ({ id: "br_1", ref: "br_1", name: "branch", status: "ACTIVE_HEALTHY" }),
      },
      poll: {
        timeoutMs: 100,
        initialDelayMs: 1,
        clock: {
          now: () => now,
          sleep: async ms => { now += ms },
        },
        onChecking: branch => statuses.push(branch.status ?? "unknown"),
      },
    })

    assert.equal(result.ok, true)
    assert.deepEqual(statuses, ["CREATING"])
    assert.equal(repos.getWorkspace(workspace.id)?.supabase_persistent_test_branch_ref, "br_1")
    assert.equal(repos.getWorkspace(workspace.id)?.supabase_persistent_test_branch_status, "ACTIVE_HEALTHY")
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("PROJ-6 PRD-2 US-4: setup asks for recheck when branch polling times out", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-persistent-timeout-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
  repos.connectWorkspaceSupabase(workspace.id, { projectRef: "proj_1", region: "eu" })
  let now = 0
  try {
    const result = await createOrAttachPersistentTestBranch({
      repos,
      workspaceId: workspace.id,
      client: {
        listBranches: async () => [],
        createBranch: async (_projectRef, input) => ({ id: "br_pending", ref: "br_pending", name: input.name, status: "CREATING" }),
        getBranch: async () => ({ id: "br_pending", ref: "br_pending", name: "branch", status: "CREATING" }),
      },
      poll: {
        timeoutMs: 3,
        initialDelayMs: 2,
        clock: {
          now: () => now,
          sleep: async ms => { now += ms },
        },
      },
    })

    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.error, "branch_not_ready")
      assert.equal(result.recheckRecommended, true)
      assert.match(result.message, /re-run setup to recheck/)
    }
    assert.equal(repos.getWorkspace(workspace.id)?.supabase_persistent_test_branch_ref, null)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("PROJ-6 PRD-2 US-4: persistent branch setup never creates Supabase projects", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-persistent-no-project-create-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
  repos.connectWorkspaceSupabase(workspace.id, { projectRef: "proj_1", region: "eu" })
  try {
    const client = {
      listBranches: async () => [{ id: "br_1", ref: "br_1", name: "beerengineer-demo-persistent-test", status: "ACTIVE_HEALTHY" }],
      createBranch: async () => {
        throw new Error("createBranch should not be called for attach")
      },
      createProject: async () => {
        throw new Error("project creation must not be part of setup")
      },
    }

    const result = await createOrAttachPersistentTestBranch({
      repos,
      workspaceId: workspace.id,
      client,
    })

    assert.equal(result.ok, true)
    assert.equal(typeof client.createProject, "function")
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("REQ-2 AC-2.1: persistent branch setup classifies 402 responses as branching unavailable", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-persistent-402-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
  repos.connectWorkspaceSupabase(workspace.id, { projectRef: "proj_1", region: "eu", dbMode: "branching" })
  try {
    const result = await createOrAttachPersistentTestBranch({
      repos,
      workspaceId: workspace.id,
      client: {
        listBranches: async () => [],
        createBranch: async () => {
          throw new SupabaseManagementError("provider", "Payment Required", 402)
        },
      },
    })

    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.error, "branching_unavailable")
      assert.match(result.message, /branching is unavailable/i)
      assert.doesNotMatch(result.message, /Rotate management token|Re-authorize project access/i)
    }
    assert.equal(repos.getWorkspace(workspace.id)?.supabase_persistent_test_branch_ref, null)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
