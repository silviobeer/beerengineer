import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createSupabasePreExecutionReadiness, getSupabaseReadinessBranchPollBudgetMs } from "../../../src/core/supabase/preExecutionReadiness.js"
import { SupabaseManagementError } from "../../../src/core/supabase/managementClient.js"
import { initDatabase } from "../../../src/db/connection.js"
import { Repos } from "../../../src/db/repositories.js"
import { SUPABASE_MANAGEMENT_TOKEN_SECRET_REF } from "../../../src/setup/secretMetadata.js"
import { storeSecret } from "../../../src/setup/secretStore.js"

function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), "be2-supabase-readiness-"))
  return { dir, storePath: join(dir, "secrets.json") }
}

function repoFixture() {
  const dir = mkdtempSync(join(tmpdir(), "be2-supabase-readiness-db-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "alpha", name: "Alpha", rootPath: join(dir, "alpha") })
  const item = repos.createItem({ workspaceId: workspace.id, title: "DB work", description: "needs supabase" })
  const run = repos.createRun({ workspaceId: workspace.id, itemId: item.id, title: "Run" })
  return { dir, db, repos, workspace, item, run, storePath: join(dir, "secrets.json") }
}

test("PROJ-6 PRD-1 US-2: readiness reports every local missing action and keeps retry separate", async () => {
  const paths = tempStore()
  try {
    let calls = 0
    const readiness = await createSupabasePreExecutionReadiness({
      workspace: { id: "ws", key: "demo", rootPath: "/repo" },
      runId: "run-1",
      secretStore: { storePath: paths.storePath },
      managementClient: {
        getProject: async () => {
          calls += 1
          throw new Error("must short-circuit")
        },
        getBranch: async () => {
          calls += 1
          throw new Error("must short-circuit")
        },
      },
    })

    assert.equal(readiness.status, "blocked")
    assert.deepEqual(readiness.missingSetupActions, [
      "Store management token",
      "Connect Supabase project",
      "Create persistent test branch",
    ])
    assert.ok(readiness.retry.available)
    assert.equal(readiness.missingSetupActions.includes("Retry run"), false)
    assert.equal(calls, 0)
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("PROJ-6 PRD-1 US-2: readiness maps token and permission failures to repair actions", async () => {
  const paths = tempStore()
  try {
    storeSecret(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, "sbp-secret", { storePath: paths.storePath })
    const workspace = { id: "ws", key: "demo", rootPath: "/repo", projectRef: "proj_alpha", persistentTestBranchRef: "br_alpha" }

    const unauthorized = await createSupabasePreExecutionReadiness({
      workspace,
      secretStore: { storePath: paths.storePath },
      managementClient: {
        getProject: async () => { throw new SupabaseManagementError("provider", "Unauthorized", 401) },
        getBranch: async () => ({ id: "br", ref: "br_alpha", status: "ACTIVE_HEALTHY" }),
      },
    })
    assert.deepEqual(unauthorized.missingSetupActions, ["Rotate management token"])

    const forbidden = await createSupabasePreExecutionReadiness({
      workspace,
      secretStore: { storePath: paths.storePath },
      managementClient: {
        getProject: async () => { throw new SupabaseManagementError("provider", "Forbidden", 403) },
        getBranch: async () => ({ id: "br", ref: "br_alpha", status: "ACTIVE_HEALTHY" }),
      },
    })
    assert.deepEqual(forbidden.missingSetupActions, ["Re-authorize project access"])
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("PROJ-6 PRD-1 US-3: readiness validates project access and active healthy persistent branch", async () => {
  const paths = tempStore()
  try {
    storeSecret(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, "sbp-secret", { storePath: paths.storePath })
    const calls: Array<{ projectRef: string; branchRef?: string }> = []
    const readiness = await createSupabasePreExecutionReadiness({
      workspace: { id: "ws", key: "alpha", rootPath: "/repo", projectRef: "proj_alpha", persistentTestBranchRef: "br_alpha" },
      secretStore: { storePath: paths.storePath },
      branchPollBudgetMs: 1_000,
      clock: { now: () => 0, sleep: async () => undefined },
      managementClient: {
        getProject: async (projectRef) => {
          calls.push({ projectRef })
          return { id: "p1", ref: projectRef, branchingEnabled: true }
        },
        getBranch: async (projectRef, branchRef) => {
          calls.push({ projectRef, branchRef })
          return { id: "br", ref: branchRef, status: "ACTIVE_HEALTHY" }
        },
      },
    })

    assert.equal(readiness.status, "ready")
    assert.deepEqual(calls, [{ projectRef: "proj_alpha" }, { projectRef: "proj_alpha", branchRef: "br_alpha" }])
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("readiness falls back to branch list when provider getBranch cannot read preview branch", async () => {
  const paths = tempStore()
  try {
    storeSecret(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, "sbp-secret", { storePath: paths.storePath })
    const readiness = await createSupabasePreExecutionReadiness({
      workspace: {
        id: "ws",
        key: "alpha",
        rootPath: "/repo",
        projectRef: "proj_alpha",
        persistentTestBranchRef: "branch_id",
        persistentTestBranchName: "persistent-alpha",
      },
      secretStore: { storePath: paths.storePath },
      branchPollBudgetMs: 1_000,
      clock: { now: () => 0, sleep: async () => undefined },
      managementClient: {
        getProject: async (projectRef) => ({ id: "p1", ref: projectRef, branchingEnabled: true }),
        getBranch: async () => {
          throw new SupabaseManagementError("provider", "Preview branch not found.", 404)
        },
        listBranches: async () => [{
          id: "branch_id",
          ref: "branch_id",
          name: "persistent-alpha",
          status: "FUNCTIONS_DEPLOYED",
        }],
      },
    })

    assert.equal(readiness.status, "ready")
    assert.equal(readiness.branch?.providerStatus, "FUNCTIONS_DEPLOYED")
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("PROJ-6 PRD-1 US-3: readiness budget defaults to 60s, can be overridden, and blocks execution on timeout", async () => {
  const paths = tempStore()
  try {
    storeSecret(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, "sbp-secret", { storePath: paths.storePath })
    assert.equal(getSupabaseReadinessBranchPollBudgetMs({}), 60_000)
    assert.equal(getSupabaseReadinessBranchPollBudgetMs({ SUPABASE_READINESS_BRANCH_POLL_BUDGET_MS: "42" }), 42)

    let now = 0
    const execution = await createSupabasePreExecutionReadiness({
      mode: "execution",
      workspace: { id: "ws", key: "alpha", rootPath: "/repo", projectRef: "proj_alpha", persistentTestBranchRef: "br_alpha" },
      secretStore: { storePath: paths.storePath },
      branchPollBudgetMs: 20,
      clock: { now: () => now, sleep: async (ms) => { now += ms } },
      managementClient: {
        getProject: async (projectRef) => ({ id: "p1", ref: projectRef, branchingEnabled: true }),
        getBranch: async (_projectRef, branchRef) => ({ id: "br", ref: branchRef, status: "CREATING" }),
      },
    })
    assert.equal(execution.status, "blocked")
    assert.equal(execution.branch?.status, "timeout")

    now = 0
    const setup = await createSupabasePreExecutionReadiness({
      mode: "setup",
      workspace: { id: "ws", key: "alpha", rootPath: "/repo", projectRef: "proj_alpha", persistentTestBranchRef: "br_alpha" },
      secretStore: { storePath: paths.storePath },
      branchPollBudgetMs: 20,
      clock: { now: () => now, sleep: async (ms) => { now += ms } },
      managementClient: {
        getProject: async (projectRef) => ({ id: "p1", ref: projectRef, branchingEnabled: true }),
        getBranch: async (_projectRef, branchRef) => ({ id: "br", ref: branchRef, status: "CREATING" }),
      },
    })
    assert.equal(setup.status, "checking")
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("PROJ-6 PRD-1 US-5: readiness resolves workspace refs from run state and ignores body overrides", async () => {
  const ctx = repoFixture()
  try {
    storeSecret(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, "sbp-secret", { storePath: ctx.storePath })
    ctx.repos.connectWorkspaceSupabase(ctx.workspace.id, { projectRef: "proj_alpha", region: "eu" })
    ctx.repos.setWorkspaceSupabasePersistentBranch(ctx.workspace.id, { ref: "br_alpha", name: "persistent-alpha", status: "ACTIVE_HEALTHY" })
    const calls: Array<{ projectRef: string; branchRef?: string }> = []

    const readiness = await createSupabasePreExecutionReadiness({
      repos: ctx.repos,
      runId: ctx.run.id,
      secretStore: { storePath: ctx.storePath },
      requestRefs: {
        workspaceRoot: "/malicious/root",
        projectRef: "proj_beta",
        branchRef: "br_beta",
        branchName: "persistent-beta",
      },
      managementClient: {
        getProject: async (projectRef) => {
          calls.push({ projectRef })
          if (projectRef !== "proj_alpha") throw new SupabaseManagementError("provider", "Forbidden", 403)
          return { id: "p1", ref: projectRef, branchingEnabled: true }
        },
        getBranch: async (projectRef, branchRef) => {
          calls.push({ projectRef, branchRef })
          return { id: "br", ref: branchRef, status: "ACTIVE_HEALTHY" }
        },
      },
    })

    assert.equal(readiness.status, "ready")
    assert.deepEqual(calls, [{ projectRef: "proj_alpha" }, { projectRef: "proj_alpha", branchRef: "br_alpha" }])
    assert.equal(readiness.workspace.rootPath, join(ctx.dir, "alpha"))
  } finally {
    ctx.db.close()
    rmSync(ctx.dir, { recursive: true, force: true })
  }
})

test("PROJ-6 PRD-1 US-5: beta token access does not unblock an alpha run", async () => {
  const ctx = repoFixture()
  try {
    storeSecret(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, "sbp-secret", { storePath: ctx.storePath })
    ctx.repos.connectWorkspaceSupabase(ctx.workspace.id, { projectRef: "proj_alpha", region: "eu" })
    ctx.repos.setWorkspaceSupabasePersistentBranch(ctx.workspace.id, { ref: "br_alpha", name: "persistent-alpha", status: "ACTIVE_HEALTHY" })

    const readiness = await createSupabasePreExecutionReadiness({
      repos: ctx.repos,
      runId: ctx.run.id,
      secretStore: { storePath: ctx.storePath },
      managementClient: {
        getProject: async (projectRef) => {
          if (projectRef === "proj_beta") return { id: "p2", ref: "proj_beta", branchingEnabled: true }
          throw new SupabaseManagementError("provider", "Forbidden", 403)
        },
        getBranch: async (_projectRef, branchRef) => ({ id: "br", ref: branchRef, status: "ACTIVE_HEALTHY" }),
      },
    })

    assert.equal(readiness.status, "blocked")
    assert.deepEqual(readiness.missingSetupActions, ["Re-authorize project access"])
  } finally {
    ctx.db.close()
    rmSync(ctx.dir, { recursive: true, force: true })
  }
})

test("REQ-1 AC-1.3: readiness surfaces the stored db mode without reclassifying it", async () => {
  const paths = tempStore()
  try {
    storeSecret(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, "sbp-secret", { storePath: paths.storePath })
    const readiness = await createSupabasePreExecutionReadiness({
      workspace: {
        id: "ws",
        key: "alpha",
        rootPath: "/repo",
        projectRef: "proj_alpha",
        dbMode: "direct",
        persistentTestBranchRef: "br_alpha",
      },
      secretStore: { storePath: paths.storePath },
      managementClient: {
        getProject: async (projectRef) => ({ id: "p1", ref: projectRef, branchingEnabled: true }),
        getBranch: async (_projectRef, branchRef) => ({ id: "br", ref: branchRef, status: "ACTIVE_HEALTHY" }),
      },
    })

    assert.equal(readiness.status, "ready")
    assert.equal(readiness.workspace.dbMode, "direct")
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("REQ-2 AC-2.2: direct-mode readiness does not require a persistent test branch", async () => {
  const paths = tempStore()
  try {
    storeSecret(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, "sbp-secret", { storePath: paths.storePath })
    let branchCalls = 0
    const readiness = await createSupabasePreExecutionReadiness({
      workspace: {
        id: "ws",
        key: "alpha",
        rootPath: "/repo",
        projectRef: "proj_alpha",
        dbMode: "direct",
      },
      secretStore: { storePath: paths.storePath },
      managementClient: {
        getProject: async (projectRef) => ({ id: "p1", ref: projectRef, branchingEnabled: false }),
        getBranch: async () => {
          branchCalls += 1
          return { id: "br", ref: "br_alpha", status: "ACTIVE_HEALTHY" }
        },
      },
    })

    assert.equal(readiness.status, "ready")
    assert.deepEqual(readiness.missingSetupActions, [])
    assert.equal(readiness.branch, undefined)
    assert.equal(branchCalls, 0)
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})

test("REQ-2 AC-2.4: branching and legacy readiness still require a persistent test branch", async () => {
  const paths = tempStore()
  try {
    storeSecret(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, "sbp-secret", { storePath: paths.storePath })
    let projectCalls = 0

    const branching = await createSupabasePreExecutionReadiness({
      workspace: {
        id: "ws",
        key: "alpha",
        rootPath: "/repo",
        projectRef: "proj_alpha",
        dbMode: "branching",
      },
      secretStore: { storePath: paths.storePath },
      managementClient: {
        getProject: async () => {
          projectCalls += 1
          return { id: "p1", ref: "proj_alpha", branchingEnabled: true }
        },
        getBranch: async () => ({ id: "br", ref: "br_alpha", status: "ACTIVE_HEALTHY" }),
      },
    })

    const legacy = await createSupabasePreExecutionReadiness({
      workspace: {
        id: "ws",
        key: "alpha",
        rootPath: "/repo",
        projectRef: "proj_alpha",
      },
      secretStore: { storePath: paths.storePath },
      managementClient: {
        getProject: async () => {
          projectCalls += 1
          return { id: "p1", ref: "proj_alpha", branchingEnabled: true }
        },
        getBranch: async () => ({ id: "br", ref: "br_alpha", status: "ACTIVE_HEALTHY" }),
      },
    })

    assert.equal(branching.status, "blocked")
    assert.deepEqual(branching.missingSetupActions, ["Create persistent test branch"])
    assert.equal(legacy.status, "blocked")
    assert.deepEqual(legacy.missingSetupActions, ["Create persistent test branch"])
    assert.equal(projectCalls, 0)
  } finally {
    rmSync(paths.dir, { recursive: true, force: true })
  }
})
