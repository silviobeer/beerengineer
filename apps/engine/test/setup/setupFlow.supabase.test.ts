import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { initDatabase } from "../../src/db/connection.js"
import { Repos } from "../../src/db/repositories.js"
import { runSetupFlow, type SetupFlowDeps } from "../../src/setup/setupFlow.js"
import { connectSupabaseProject } from "../../src/setup/supabaseSetup.js"
import { SUPABASE_MANAGEMENT_TOKEN_SECRET_REF } from "../../src/setup/secretMetadata.js"
import { readActiveSecretValue, storeSecret } from "../../src/setup/secretStore.js"
import { SupabaseManagementError } from "../../src/core/supabase/managementClient.js"

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "be2-supabase-setup-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
  return { dir, db, repos, workspace, storePath: join(dir, "secrets.json") }
}

async function withCapturedConsole(fn: () => Promise<number>): Promise<{ exitCode: number; output: string }> {
  const lines: string[] = []
  const originalLog = console.log
  const originalError = console.error
  console.log = (...args: unknown[]) => lines.push(args.join(" "))
  console.error = (...args: unknown[]) => lines.push(args.join(" "))
  try {
    const exitCode = await fn()
    return { exitCode, output: lines.join("\n") }
  } finally {
    console.log = originalLog
    console.error = originalError
  }
}

function writeConfig(configPath: string, dataDir: string): void {
  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, JSON.stringify({
    schemaVersion: 1,
    dataDir,
    allowedRoots: [dataDir],
    enginePort: 4100,
    llm: {
      provider: "anthropic",
      model: "claude-sonnet-4",
      apiKeyRef: "ANTHROPIC_API_KEY",
      defaultHarnessProfile: { mode: "claude-first" },
    },
  }, null, 2))
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
      client: { listProjects: async () => [{ id: "1", ref: "proj_1", region: "eu", branchingEnabled: true }] },
    })
    assert.deepEqual(result, { ok: true, projectRef: "proj_1", region: "eu", dbMode: "branching" })
    assert.equal(readActiveSecretValue(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, { storePath: ctx.storePath }), "sbp_token")
    assert.equal(ctx.repos.getWorkspace(ctx.workspace.id)?.supabase_project_ref, "proj_1")
    assert.equal(ctx.repos.getWorkspace(ctx.workspace.id)?.supabase_db_mode, "branching")
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

test("PROJ-6 PRD-2 US-3: validation failure preserves previous token and workspace project", async () => {
  const ctx = fixture()
  try {
    storeSecret(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, "old-token", { storePath: ctx.storePath })
    ctx.repos.connectWorkspaceSupabase(ctx.workspace.id, { projectRef: "old_project", region: "eu" })

    const result = await connectSupabaseProject({
      repos: ctx.repos,
      workspaceId: ctx.workspace.id,
      token: "new-token",
      projectRef: "new_project",
      secretStore: { storePath: ctx.storePath },
      client: { listProjects: async () => { throw new Error("Invalid token sbp_[redacted]") } },
    })

    assert.equal(result.ok, false)
    assert.equal(readActiveSecretValue(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, { storePath: ctx.storePath }), "old-token")
    assert.equal(ctx.repos.getWorkspace(ctx.workspace.id)?.supabase_project_ref, "old_project")
    if (!result.ok) {
      assert.equal(result.message, "Invalid token sbp_[redacted]")
      assert.equal(result.recoveryAction, "Rotate management token")
    }
  } finally {
    ctx.db.close()
    rmSync(ctx.dir, { recursive: true, force: true })
  }
})

test("PROJ-6 PRD-2 US-3: connect stores project ref on the selected workspace only", async () => {
  const ctx = fixture()
  const other = ctx.repos.upsertWorkspace({ key: "other", name: "Other", rootPath: join(ctx.dir, "other") })
  try {
    const result = await connectSupabaseProject({
      repos: ctx.repos,
      workspaceId: other.id,
      token: "sbp_token",
      projectRef: "proj_other",
      secretStore: { storePath: ctx.storePath },
      client: { listProjects: async () => [{ id: "2", ref: "proj_other", region: "us", branchingEnabled: true }] },
    })

    assert.equal(result.ok, true)
    assert.equal(ctx.repos.getWorkspace(other.id)?.supabase_project_ref, "proj_other")
    assert.equal(ctx.repos.getWorkspace(ctx.workspace.id)?.supabase_project_ref, null)
  } finally {
    ctx.db.close()
    rmSync(ctx.dir, { recursive: true, force: true })
  }
})

test("PROJ-6 PRD-2 US-3: connect maps provider auth failures to setup actions", async () => {
  const ctx = fixture()
  try {
    const unauthorized = await connectSupabaseProject({
      repos: ctx.repos,
      workspaceId: ctx.workspace.id,
      token: "bad",
      projectRef: "proj_1",
      secretStore: { storePath: ctx.storePath },
      client: { listProjects: async () => { throw new SupabaseManagementError("provider", "Invalid token", 401) } },
    })
    assert.equal(unauthorized.ok, false)
    if (!unauthorized.ok) assert.equal(unauthorized.recoveryAction, "Rotate management token")

    const forbidden = await connectSupabaseProject({
      repos: ctx.repos,
      workspaceId: ctx.workspace.id,
      token: "no-access",
      projectRef: "proj_1",
      secretStore: { storePath: ctx.storePath },
      client: { listProjects: async () => { throw new SupabaseManagementError("provider", "Project access denied", 403) } },
    })
    assert.equal(forbidden.ok, false)
    if (!forbidden.ok) assert.equal(forbidden.recoveryAction, "Re-authorize project access")
  } finally {
    ctx.db.close()
    rmSync(ctx.dir, { recursive: true, force: true })
  }
})

test("PROJ-6 PRD-2 US-4/5: interactive CLI setup connects, checks branch, and prints retry guidance", async () => {
  const ctx = fixture()
  const configPath = join(ctx.dir, "config", "config.json")
  writeConfig(configPath, ctx.dir)
  const answers = ["proj_1", "sbp_token", ""]
  const previousSecretStorePath = process.env.BEERENGINEER_SECRET_STORE_PATH
  let createCalls = 0
  try {
    process.env.BEERENGINEER_SECRET_STORE_PATH = ctx.storePath
    const deps: SetupFlowDeps = {
      repos: ctx.repos,
      isInteractive: () => true,
      launchSetup: async () => ({
        engine: { status: "running", url: "http://127.0.0.1:4100" },
        ui: { status: "running", url: "http://127.0.0.1:3000" },
        setupUrl: "http://127.0.0.1:3000/setup",
        browser: { status: "printed" },
      }),
      createQuestioner: () => ({
        question: async () => answers.shift() ?? "",
        close: () => {},
      }),
      createSupabaseClient: () => ({
        listProjects: async () => [{ id: "1", ref: "proj_1", region: "eu", branchingEnabled: true }],
        listBranches: async () => [],
        createBranch: async (_projectRef, input) => {
          createCalls += 1
          return { id: "br_1", ref: "br_1", name: input.name, status: "ACTIVE_HEALTHY" }
        },
        getBranch: async () => ({ id: "br_1", ref: "br_1", name: "branch", status: "ACTIVE_HEALTHY" }),
      }),
    }

    const result = await withCapturedConsole(() => runSetupFlow({
      group: "supabase",
      workspaceKey: "demo",
      overrides: { configPath, dataDir: ctx.dir },
      blockedRunContext: { itemRef: "ITEM-0001", action: "resume_run", runId: "run-1" },
      deps,
    }))

    assert.equal(result.exitCode, 0, result.output)
    assert.match(result.output, /Create or select the Supabase Cloud project manually/)
    assert.match(result.output, /Connected Supabase project proj_1/)
    assert.match(result.output, /checking persistent test branch/)
    assert.match(result.output, /Persistent test branch .* is ready/)
    assert.match(result.output, /Retry blocked run: beerengineer item action --item ITEM-0001 --action resume_run/)
    assert.match(result.output, /Existing run-id will be reused: run-1/)
    assert.equal(createCalls, 1)
    assert.equal(ctx.repos.getWorkspace(ctx.workspace.id)?.supabase_project_ref, "proj_1")
    assert.equal(ctx.repos.getWorkspace(ctx.workspace.id)?.supabase_persistent_test_branch_status, "ACTIVE_HEALTHY")
  } finally {
    if (previousSecretStorePath === undefined) delete process.env.BEERENGINEER_SECRET_STORE_PATH
    else process.env.BEERENGINEER_SECRET_STORE_PATH = previousSecretStorePath
    ctx.db.close()
    rmSync(ctx.dir, { recursive: true, force: true })
  }
})
