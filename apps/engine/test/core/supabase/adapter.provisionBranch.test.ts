import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initDatabase } from "../../../src/db/connection.js"
import { Repos } from "../../../src/db/repositories.js"
import { createSupabaseAdapter } from "../../../src/core/supabase/adapter.js"
import { buildSupabaseProvisioningRecoveryPayload } from "../../../src/core/supabase/recoveryPayload.js"

test("PROJ-4 PRD-5 US-1: adapter provisions wave branch from persistent parent and persists run metadata", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-wave-provision-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
  const item = repos.createItem({ workspaceId: workspace.id, title: "Item", description: "Desc" })
  const run = repos.createRun({ workspaceId: workspace.id, itemId: item.id, title: "Run" })
  const calls: unknown[] = []
  try {
    const adapter = createSupabaseAdapter({
      repos,
      client: {
        listBranches: async () => [],
        createBranch: async (_project, input) => {
          calls.push(input)
          return { id: "br_wave", ref: "br_wave", name: input.name, status: "CREATING" }
        },
        runQuery: async () => undefined,
      },
    })
    const result = await adapter.provisionBranch({
      workspaceId: workspace.id,
      workspaceKey: workspace.key,
      runId: run.id,
      itemId: item.id,
      projectId: "project-1",
      waveId: "wave-1",
      projectRef: "proj_1",
      parentBranchRef: "br_persistent",
    })
    assert.equal(result.ok, true)
    assert.deepEqual(calls, [{ name: `beerengineer-demo-${run.id.toLowerCase()}-${item.id.toLowerCase()}-project-1-wave-1`, parentRef: "br_persistent" }])
    assert.equal(repos.getRun(run.id)?.supabase_branch_ref, "br_wave")
    assert.equal(repos.getRun(run.id)?.supabase_branch_lifecycle_state, "provisioning")
    assert.equal((await adapter.provisionBranch({ workspaceId: workspace.id, waveId: "wave-1", projectRef: "proj_1", parentBranchRef: "main", runId: run.id, itemId: item.id, projectId: "p" })).ok, false)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("REQ-1 AC-1.1/AC-1.2: adapter reuses the single verified current-wave branch instead of creating a duplicate", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-wave-provision-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
  const item = repos.createItem({ workspaceId: workspace.id, title: "Item", description: "Desc" })
  const run = repos.createRun({ workspaceId: workspace.id, itemId: item.id, title: "Run" })
  const calls: unknown[] = []
  try {
    const adapter = createSupabaseAdapter({
      repos,
      client: {
        listBranches: async () => [{ id: "br_wave", ref: "br_wave", name: `beerengineer-demo-${run.id.toLowerCase()}-${item.id.toLowerCase()}-project-1-wave-1`, status: "ACTIVE_HEALTHY" }],
        createBranch: async (_project, input) => {
          calls.push(input)
          return { id: "created", ref: "created", name: input.name, status: "CREATING" }
        },
        runQuery: async () => undefined,
      },
    })
    const result = await adapter.provisionBranch({
      workspaceId: workspace.id,
      workspaceKey: workspace.key,
      runId: run.id,
      itemId: item.id,
      projectId: "project-1",
      waveId: "wave-1",
      projectRef: "proj_1",
      parentBranchRef: "br_persistent",
    })
    assert.equal(result.ok, true)
    assert.equal(result.context?.action, "reused")
    assert.deepEqual(calls, [])
    assert.equal(repos.getRun(run.id)?.supabase_branch_ref, "br_wave")
    assert.equal(repos.getRun(run.id)?.supabase_branch_lifecycle_state, "ready")
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("REQ-1 AC-1.1: adapter discards a stale prior-wave attachment and reuses the verified current-wave branch", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-wave-provision-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
  const item = repos.createItem({ workspaceId: workspace.id, title: "Item", description: "Desc" })
  const run = repos.createRun({ workspaceId: workspace.id, itemId: item.id, title: "Run" })
  repos.setRunSupabaseBranch(run.id, { ref: "br_old", name: "beerengineer-demo-old-run-old-item-project-1-wave-0", lifecycleState: "ready" })
  const calls: unknown[] = []
  try {
    const adapter = createSupabaseAdapter({
      repos,
      client: {
        listBranches: async () => [
          { id: "br_old", ref: "br_old", name: "beerengineer-demo-old-run-old-item-project-1-wave-0", status: "ACTIVE_HEALTHY" },
          { id: "br_wave", ref: "br_wave", name: `beerengineer-demo-${run.id.toLowerCase()}-${item.id.toLowerCase()}-project-1-wave-1`, status: "ACTIVE_HEALTHY" },
        ],
        createBranch: async (_project, input) => {
          calls.push(input)
          return { id: "created", ref: "created", name: input.name, status: "CREATING" }
        },
        runQuery: async () => undefined,
      },
    })
    const result = await adapter.provisionBranch({
      workspaceId: workspace.id,
      workspaceKey: workspace.key,
      runId: run.id,
      itemId: item.id,
      projectId: "project-1",
      waveId: "wave-1",
      projectRef: "proj_1",
      parentBranchRef: "br_persistent",
    })
    assert.equal(result.ok, true)
    assert.equal(result.context?.action, "reused")
    assert.deepEqual(calls, [])
    assert.equal(repos.getRun(run.id)?.supabase_branch_ref, "br_wave")
    assert.equal(repos.getRun(run.id)?.supabase_branch_name, `beerengineer-demo-${run.id.toLowerCase()}-${item.id.toLowerCase()}-project-1-wave-1`)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("REQ-1 AC-1.4: adapter does not automatically reuse an unhealthy same-name branch", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-wave-provision-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
  const item = repos.createItem({ workspaceId: workspace.id, title: "Item", description: "Desc" })
  const run = repos.createRun({ workspaceId: workspace.id, itemId: item.id, title: "Run" })
  const calls: unknown[] = []
  try {
    const adapter = createSupabaseAdapter({
      repos,
      client: {
        listBranches: async () => [{ id: "br_wave", ref: "br_wave", name: `beerengineer-demo-${run.id.toLowerCase()}-${item.id.toLowerCase()}-project-1-wave-1`, status: "CREATING" }],
        createBranch: async (_project, input) => {
          calls.push(input)
          return { id: "created", ref: "created", name: input.name, status: "CREATING" }
        },
        runQuery: async () => undefined,
      },
    })
    const result = await adapter.provisionBranch({
      workspaceId: workspace.id,
      workspaceKey: workspace.key,
      runId: run.id,
      itemId: item.id,
      projectId: "project-1",
      waveId: "wave-1",
      projectRef: "proj_1",
      parentBranchRef: "br_persistent",
    })
    assert.equal(result.ok, false)
    assert.match(String(result.context?.message ?? ""), /ACTIVE_HEALTHY/i)
    assert.deepEqual(calls, [])
    assert.equal(repos.getRun(run.id)?.supabase_branch_ref, null)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("REQ-1 AC-1.4: adapter does not automatically reuse a same-name branch when recovery identity validation fails", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-wave-provision-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
  const item = repos.createItem({ workspaceId: workspace.id, title: "Item", description: "Desc" })
  const run = repos.createRun({ workspaceId: workspace.id, itemId: item.id, title: "Run" })
  repos.updateRun(run.id, {
    recovery_status: "blocked",
    recovery_scope: "run",
    recovery_scope_ref: null,
    recovery_summary: "blocked",
    recovery_payload_json: buildSupabaseProvisioningRecoveryPayload({
      runId: run.id,
      workspaceId: workspace.id,
      workspaceKey: workspace.key,
      projectRef: "proj_other",
      waveId: "wave-1",
      waveNumber: 1,
      failedStep: "validate",
      failureCause: "seeded mismatch",
      userMessage: "blocked",
    }),
  })
  const calls: unknown[] = []
  try {
    const adapter = createSupabaseAdapter({
      repos,
      client: {
        listBranches: async () => [{ id: "br_wave", ref: "br_wave", name: `beerengineer-demo-${run.id.toLowerCase()}-${item.id.toLowerCase()}-project-1-wave-1`, status: "ACTIVE_HEALTHY" }],
        createBranch: async (_project, input) => {
          calls.push(input)
          return { id: "created", ref: "created", name: input.name, status: "CREATING" }
        },
        runQuery: async () => undefined,
      },
    })
    const result = await adapter.provisionBranch({
      workspaceId: workspace.id,
      workspaceKey: workspace.key,
      runId: run.id,
      itemId: item.id,
      projectId: "project-1",
      waveId: "wave-1",
      projectRef: "proj_1",
      parentBranchRef: "br_persistent",
    })
    assert.equal(result.ok, false)
    assert.match(String(result.context?.message ?? ""), /different Supabase project/i)
    assert.deepEqual(calls, [])
    assert.equal(repos.getRun(run.id)?.supabase_branch_ref, null)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("REQ-1 AC-1.4: adapter follows the non-reuse path when only a wrong-name healthy branch exists", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-wave-provision-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
  const item = repos.createItem({ workspaceId: workspace.id, title: "Item", description: "Desc" })
  const run = repos.createRun({ workspaceId: workspace.id, itemId: item.id, title: "Run" })
  const calls: unknown[] = []
  try {
    const adapter = createSupabaseAdapter({
      repos,
      client: {
        listBranches: async () => [{ id: "br_other", ref: "br_other", name: "beerengineer-demo-other-run-item-project-1-wave-1", status: "ACTIVE_HEALTHY" }],
        createBranch: async (_project, input) => {
          calls.push(input)
          return { id: "created", ref: "created", name: input.name, status: "CREATING" }
        },
        runQuery: async () => undefined,
      },
    })
    const result = await adapter.provisionBranch({
      workspaceId: workspace.id,
      workspaceKey: workspace.key,
      runId: run.id,
      itemId: item.id,
      projectId: "project-1",
      waveId: "wave-1",
      projectRef: "proj_1",
      parentBranchRef: "br_persistent",
    })
    assert.equal(result.ok, true)
    assert.equal(result.context?.action, undefined)
    assert.deepEqual(calls, [{ name: `beerengineer-demo-${run.id.toLowerCase()}-${item.id.toLowerCase()}-project-1-wave-1`, parentRef: "br_persistent" }])
    assert.equal(repos.getRun(run.id)?.supabase_branch_ref, "created")
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("REQ-1 AC-1.2/AC-1.4: adapter blocks ambiguous missing-ref recovery instead of guessing or creating a duplicate", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-wave-provision-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
  const item = repos.createItem({ workspaceId: workspace.id, title: "Item", description: "Desc" })
  const run = repos.createRun({ workspaceId: workspace.id, itemId: item.id, title: "Run" })
  const calls: unknown[] = []
  try {
    const expectedName = `beerengineer-demo-${run.id.toLowerCase()}-${item.id.toLowerCase()}-project-1-wave-1`
    const adapter = createSupabaseAdapter({
      repos,
      client: {
        listBranches: async () => [
          { id: "br_wave_1", ref: "br_wave_1", name: expectedName, status: "ACTIVE_HEALTHY" },
          { id: "br_wave_2", ref: "br_wave_2", name: expectedName, status: "ACTIVE_HEALTHY" },
        ],
        createBranch: async (_project, input) => {
          calls.push(input)
          return { id: "created", ref: "created", name: input.name, status: "CREATING" }
        },
        runQuery: async () => undefined,
      },
    })
    const result = await adapter.provisionBranch({
      workspaceId: workspace.id,
      workspaceKey: workspace.key,
      runId: run.id,
      itemId: item.id,
      projectId: "project-1",
      waveId: "wave-1",
      projectRef: "proj_1",
      parentBranchRef: "br_persistent",
    })
    assert.equal(result.ok, false)
    assert.match(String(result.context?.message ?? ""), /ambiguous/i)
    assert.deepEqual(calls, [])
    assert.equal(repos.getRun(run.id)?.supabase_branch_ref, null)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
