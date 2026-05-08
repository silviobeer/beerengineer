import { test } from "node:test"
import assert from "node:assert/strict"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { createBus } from "../src/core/bus.js"
import {
  prepareForegroundIdeaRun,
  prepareForegroundItemRun,
  prepareForegroundPreparedImportRun,
  prepareForegroundResumeRun,
} from "../src/core/runService.js"
import { writeRecoveryRecord } from "../src/core/recovery.js"
import { prepareRun, busToWorkflowIO, type SupabaseAdapterFactory } from "../src/core/runOrchestrator.js"
import type { GitAdapter } from "../src/core/gitAdapter.js"
import { layout } from "../src/core/workspaceLayout.js"
import { defaultAppConfig } from "../src/setup/config.js"
import { mergeGate } from "../src/stages/mergeGate/index.js"
import { removeTempDir } from "./helpers/fs.js"

const TEST_API_TOKEN = "test-token"

function enginePaths() {
  const testDir = dirname(fileURLToPath(import.meta.url))
  const engineRoot = resolve(testDir, "..")
  return {
    engineRoot,
    binPath: resolve(engineRoot, "bin/beerengineer.js"),
    serverPath: resolve(engineRoot, "src/api/server.ts"),
  }
}

function tempRepos(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  const db = initDatabase(join(dir, "test.sqlite"))
  const repos = new Repos(db)
  return { dir, db, repos }
}

function makeIo() {
  const bus = createBus()
  return { ...busToWorkflowIO(bus), bus }
}

function fakeScheduler() {
  return {
    setInterval(): number {
      return 0
    },
    clearInterval(): void {},
  }
}

function appConfigFor(root: string) {
  return {
    ...defaultAppConfig(),
    allowedRoots: [root],
  }
}

function seedGitRepo(repoRoot: string): void {
  mkdirSync(repoRoot, { recursive: true })
  spawnSync("git", ["init", "--initial-branch=main"], { cwd: repoRoot, encoding: "utf8" })
  spawnSync("git", ["config", "user.email", "test@example.invalid"], { cwd: repoRoot, encoding: "utf8" })
  spawnSync("git", ["config", "user.name", "test"], { cwd: repoRoot, encoding: "utf8" })
  writeFileSync(join(repoRoot, "README.md"), "seed\n")
  spawnSync("git", ["add", "-A"], { cwd: repoRoot, encoding: "utf8" })
  spawnSync("git", ["commit", "-m", "seed"], { cwd: repoRoot, encoding: "utf8" })
  spawnSync("git", ["remote", "add", "origin", "https://github.com/acme/demo.git"], { cwd: repoRoot, encoding: "utf8" })
  spawnSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"], { cwd: repoRoot, encoding: "utf8" })
}

function nonSupabaseFactory(counter: { count: number }): SupabaseAdapterFactory {
  return () => {
    counter.count += 1
    throw new Error("non-Supabase path must not build a Supabase adapter")
  }
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return { "x-beerengineer-token": TEST_API_TOKEN, ...(extra ?? {}) }
}

function startServer(env: NodeJS.ProcessEnv): { proc: ChildProcess; base: string } {
  const port = 4700 + Math.floor(Math.random() * 200)
  const host = "127.0.0.1"
  const { serverPath } = enginePaths()
  const proc = spawn(process.execPath, ["--import", "tsx", serverPath], {
    env: {
      ...process.env,
      ...env,
      PORT: String(port),
      HOST: host,
      BEERENGINEER_API_TOKEN: TEST_API_TOKEN,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  proc.stdout?.on("data", () => {})
  proc.stderr?.on("data", () => {})
  return { proc, base: `http://${host}:${port}` }
}

async function stopServer(proc: ChildProcess): Promise<void> {
  await new Promise<void>(resolveStop => {
    if (proc.exitCode !== null) return resolveStop()
    proc.once("exit", () => resolveStop())
    proc.kill("SIGTERM")
    setTimeout(() => proc.kill("SIGKILL"), 1500).unref?.()
  })
}

async function waitForHealth(base: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${base}/health`)
      if (res.ok) return
    } catch {}
    await new Promise(resolveWait => setTimeout(resolveWait, 100))
  }
  throw new Error(`server at ${base} did not become healthy in time`)
}

test("PROJ-8-PRD-3-US-1 precondition: configured item-action path still forwards a Supabase adapter factory when workspace Supabase data exists", () => {
  const { dir, db, repos } = tempRepos("be2-capability-positive-")
  const repoRoot = join(dir, "repo")
  seedGitRepo(repoRoot)
  try {
    const workspace = repos.upsertWorkspace({ key: "alpha", name: "Alpha", rootPath: repoRoot })
    repos.connectWorkspaceSupabase(workspace.id, { projectRef: "proj_alpha", region: "eu-central-1" })
    repos.setWorkspaceSupabasePersistentBranch(workspace.id, {
      ref: "branch_alpha",
      name: "branch-alpha",
      status: "ACTIVE_HEALTHY",
    })
    const item = repos.createItem({ workspaceId: workspace.id, title: "Configured item", description: "smoke" })
    const io = makeIo()
    const scheduler = fakeScheduler()
    const providedFactory: SupabaseAdapterFactory = () => null
    let capturedFactory: SupabaseAdapterFactory | null | undefined

    const prepared = prepareForegroundItemRun(repos, io, {
      itemId: item.id,
      action: "start_brainstorm",
      owner: "cli",
      appConfig: appConfigFor(dir),
      workerLeaseScheduler: scheduler,
      supabaseAdapterFactory: providedFactory,
      prepareRunImpl: (workflowItem, workflowRepos, workflowIo, opts) => {
        capturedFactory = opts.supabaseAdapterFactory
        return prepareRun(workflowItem, workflowRepos, workflowIo, opts)
      },
    })

    assert.equal(prepared.ok, true)
    assert.equal(capturedFactory, providedFactory)
  } finally {
    db.close()
    removeTempDir(dir)
  }
})

test("PROJ-8-PRD-3-US-1 fresh starts resolve an explicit null capability bag for non-Supabase workspaces", () => {
  const { dir, db, repos } = tempRepos("be2-capability-fresh-")
  try {
    const workspace = repos.upsertWorkspace({ key: "local", name: "Local" })
    const io = makeIo()
    const scheduler = fakeScheduler()
    const factoryCounter = { count: 0 }
    const suppliedFactory = nonSupabaseFactory(factoryCounter)
    let capturedFactory: SupabaseAdapterFactory | null | undefined
    let resolverCalls = 0

    const prepared = prepareForegroundIdeaRun(repos, io, {
      title: "Fresh local workflow",
      description: "no supabase",
      workspaceKey: workspace.key,
      workerLeaseScheduler: scheduler,
      supabaseAdapterFactory: suppliedFactory,
      capabilityResolver: input => {
        resolverCalls += 1
        assert.equal(input.workspace?.id, workspace.id)
        return { supabaseAdapterFactory: null }
      },
      prepareRunImpl: (workflowItem, workflowRepos, workflowIo, opts) => {
        capturedFactory = opts.supabaseAdapterFactory
        return prepareRun(workflowItem, workflowRepos, workflowIo, opts)
      },
    })

    assert.equal(prepared.ok, true)
    assert.equal(resolverCalls, 1)
    assert.equal(capturedFactory, null)
    assert.equal(factoryCounter.count, 0)
  } finally {
    db.close()
    removeTempDir(dir)
  }
})

test("PROJ-8-PRD-3-US-1 item-action starts resolve an explicit null capability bag for non-Supabase workspaces", () => {
  const { dir, db, repos } = tempRepos("be2-capability-item-")
  const repoRoot = join(dir, "repo")
  seedGitRepo(repoRoot)
  try {
    const workspace = repos.upsertWorkspace({ key: "local", name: "Local", rootPath: repoRoot })
    const item = repos.createItem({ workspaceId: workspace.id, title: "Local item", description: "no supabase" })
    const io = makeIo()
    const scheduler = fakeScheduler()
    const factoryCounter = { count: 0 }
    const suppliedFactory = nonSupabaseFactory(factoryCounter)
    let capturedFactory: SupabaseAdapterFactory | null | undefined
    let resolverCalls = 0

    const prepared = prepareForegroundItemRun(repos, io, {
      itemId: item.id,
      action: "start_brainstorm",
      owner: "cli",
      appConfig: appConfigFor(dir),
      workerLeaseScheduler: scheduler,
      supabaseAdapterFactory: suppliedFactory,
      capabilityResolver: input => {
        resolverCalls += 1
        assert.equal(input.workspace?.id, workspace.id)
        return { supabaseAdapterFactory: null }
      },
      prepareRunImpl: (workflowItem, workflowRepos, workflowIo, opts) => {
        capturedFactory = opts.supabaseAdapterFactory
        return prepareRun(workflowItem, workflowRepos, workflowIo, opts)
      },
    })

    assert.equal(prepared.ok, true)
    assert.equal(resolverCalls, 1)
    assert.equal(capturedFactory, null)
    assert.equal(factoryCounter.count, 0)
  } finally {
    db.close()
    removeTempDir(dir)
  }
})

test("PROJ-8-PRD-3-US-3: public item-action path still blocks destructive production migration after capability resolution", async () => {
  const { dir, db, repos } = tempRepos("be2-capability-merge-")
  const repoRoot = join(dir, "repo")
  seedGitRepo(repoRoot)
  mkdirSync(join(repoRoot, "supabase", "migrations"), { recursive: true })
  writeFileSync(join(repoRoot, "supabase", "migrations", "20260508010101_drop_users.sql"), "drop table users;")

  try {
    const workspace = repos.upsertWorkspace({ key: "alpha", name: "Alpha", rootPath: repoRoot })
    repos.connectWorkspaceSupabase(workspace.id, { projectRef: "proj_alpha", region: "eu-central-1" })
    repos.setWorkspaceSupabasePersistentBranch(workspace.id, {
      ref: "branch_alpha",
      name: "branch-alpha",
      status: "ACTIVE_HEALTHY",
    })
    const workspaceAfterConnect = repos.getWorkspace(workspace.id)
    assert.ok(workspaceAfterConnect)
    const settings = repos.updateWorkspaceSupabaseSettings(workspace.id, {
      cleanupPolicy: workspaceAfterConnect.supabase_cleanup_policy,
      cleanupTtlHours: workspaceAfterConnect.supabase_cleanup_ttl_hours,
      productionMigrationProtection: "on",
      expectedVersion: workspaceAfterConnect.supabase_settings_version,
    })
    assert.equal(settings.ok, true)

    const item = repos.createItem({ workspaceId: workspace.id, title: "Protected item", description: "merge safety" })
    const scheduler = fakeScheduler()
    const io = {
      ask: async () => "promote",
      emit: () => {},
      close: () => {},
    }

    let publicRunId = ""
    let merged = false
    let migrationAttempts = 0
    let factoryBuilds = 0
    let blocked: { summary: string; cause?: string } | null = null

    const prepared = prepareForegroundItemRun(repos, io, {
      itemId: item.id,
      action: "start_brainstorm",
      owner: "cli",
      appConfig: appConfigFor(dir),
      workerLeaseScheduler: scheduler,
      supabaseAdapterFactory: () => {
        factoryBuilds += 1
        return {
          adapter: {
            provisionBranch: async () => ({ ok: true }),
            pollBranchStatus: async () => ({ ok: true }),
            validateBranch: async () => ({ ok: true }),
            destroyBranch: async () => ({ ok: true }),
            migrateProduction: async () => {
              migrationAttempts += 1
              return { ok: true }
            },
            reconcile: async () => ({ ok: true }),
          },
        }
      },
      prepareRunImpl: (workflowItem, workflowRepos, workflowIo, opts) =>
        prepareRun(workflowItem, workflowRepos, workflowIo, {
          ...opts,
          workflowRunner: async (_item, options) => {
            const git: GitAdapter = {
              enabled: true,
              mode: {
                enabled: true,
                kind: "workspace-root",
                workspaceRoot: repoRoot,
                baseBranch: "main",
                itemWorktreeRoot: join(repoRoot, ".beerengineer", "worktrees"),
              },
              ensureItemBranch() {},
              ensureProjectBranch() {},
              mergeProjectIntoItem() {},
              mergeItemIntoBase() {
                merged = true
                return { mergeSha: "deadbeef" }
              },
              ensureWaveBranch() {
                return "wave"
              },
              ensureStoryBranch() {
                return "story"
              },
              ensureStoryWorktree() {
                return join(repoRoot, ".beerengineer", "story")
              },
              mergeStoryIntoWave() {},
              mergeWaveIntoProject() {},
              rebaseStoryOntoWave() {
                return { ok: true }
              },
              abandonStoryBranch() {
                return null
              },
              removeStoryWorktree() {},
              exitRunToItemBranch() {
                return "item/protected-item"
              },
              assertWorkspaceRootOnBaseBranch() {},
              gcManagedStoryWorktrees() {
                return { removed: [], kept: [], errors: [] }
              },
            }

            await mergeGate(
              {
                workspaceId: workspace.id,
                workspaceRoot: options.workspaceRoot ?? repoRoot,
                runId: publicRunId,
                itemSlug: "protected-item",
                baseBranch: "main",
              },
              git,
              async (_ctx, summary, blockOpts) => {
                blocked = { summary, cause: blockOpts?.cause }
                throw new Error(summary)
              },
              options.supabaseHook,
            )
          },
        }),
    })

    assert.equal(prepared.ok, true)
    if (!prepared.ok) return
    publicRunId = prepared.runId
    repos.setRunSupabaseBranch(prepared.runId, {
      ref: "branch_run_alpha",
      name: "branch-run-alpha",
      lifecycleState: "validated",
    })

    await assert.rejects(
      prepared.start(),
      /destructive migration operations require per-merge confirmation/i,
    )

    assert.equal(factoryBuilds, 1)
    assert.equal(blocked?.cause, "merge_gate_failed")
    assert.match(blocked?.summary ?? "", /destructive migration operations require per-merge confirmation/i)
    assert.equal(merged, false)
    assert.equal(migrationAttempts, 0)
    assert.equal(repos.getRun(prepared.runId)?.supabase_branch_lifecycle_state, "validated")
  } finally {
    db.close()
    removeTempDir(dir)
  }
})

test("PROJ-8-PRD-3-US-1 prepared imports resolve an explicit null capability bag for non-Supabase workspaces", async () => {
  const { dir, db, repos } = tempRepos("be2-capability-import-")
  const repoRoot = join(dir, "repo")
  const sourceDir = join(dir, "prepared")
  seedGitRepo(repoRoot)
  mkdirSync(sourceDir, { recursive: true })
  writeFileSync(
    join(sourceDir, "concept.json"),
    JSON.stringify({ summary: "Prepared", problem: "Import", users: ["operator"], constraints: [] }),
  )
  writeFileSync(
    join(sourceDir, "projects.json"),
    JSON.stringify([{ id: "P01", name: "Core", description: "Core", concept: { summary: "Core", problem: "", users: [], constraints: [] } }]),
  )
  writeFileSync(
    join(sourceDir, "P01.prd.json"),
    JSON.stringify({ prd: { stories: [{ id: "US-1", title: "Import", acceptanceCriteria: [] }] } }),
  )

  try {
    const workspace = repos.upsertWorkspace({ key: "local", name: "Local", rootPath: repoRoot })
    const io = makeIo()
    const scheduler = fakeScheduler()
    const factoryCounter = { count: 0 }
    const suppliedFactory = nonSupabaseFactory(factoryCounter)
    let capturedFactory: SupabaseAdapterFactory | null | undefined
    let resolverCalls = 0

    const prepared = await prepareForegroundPreparedImportRun(repos, io, {
      sourceDir,
      workspaceKey: workspace.key,
      owner: "cli",
      appConfig: appConfigFor(dir),
      workerLeaseScheduler: scheduler,
      supabaseAdapterFactory: suppliedFactory,
      capabilityResolver: input => {
        resolverCalls += 1
        assert.equal(input.workspace?.id, workspace.id)
        return { supabaseAdapterFactory: null }
      },
      prepareRunImpl: (workflowItem, workflowRepos, workflowIo, opts) => {
        capturedFactory = opts.supabaseAdapterFactory
        return prepareRun(workflowItem, workflowRepos, workflowIo, opts)
      },
    })

    assert.equal(prepared.ok, true)
    assert.equal(resolverCalls, 1)
    assert.equal(capturedFactory, null)
    assert.equal(factoryCounter.count, 0)
  } finally {
    db.close()
    removeTempDir(dir)
  }
})

test("PROJ-8-PRD-3-US-1 resume paths resolve an explicit null capability bag for non-Supabase workspaces", async () => {
  const { dir, db, repos } = tempRepos("be2-capability-resume-")
  const workspaceRoot = join(dir, "workspace")
  mkdirSync(workspaceRoot, { recursive: true })
  try {
    const workspace = repos.upsertWorkspace({ key: "local", name: "Local", rootPath: workspaceRoot })
    const item = repos.createItem({ workspaceId: workspace.id, title: "Blocked item", description: "resume" })
    const run = repos.createRun({
      workspaceId: workspace.id,
      itemId: item.id,
      title: item.title,
      owner: "cli",
      workspaceFsId: `resume-${item.id.toLowerCase()}`,
    })
    const ctx = { workspaceId: run.workspace_fs_id!, workspaceRoot, runId: run.id }
    mkdirSync(dirname(layout.runFile(ctx)), { recursive: true })
    writeFileSync(layout.runFile(ctx), `${JSON.stringify({ id: run.id }, null, 2)}\n`)
    await writeRecoveryRecord(ctx, {
      status: "blocked",
      cause: "system_error",
      scope: { type: "run", runId: run.id },
      summary: "Needs remediation.",
      evidencePaths: [],
    })
    repos.setRunRecovery(run.id, {
      status: "blocked",
      scope: "run",
      scopeRef: null,
      summary: "Needs remediation.",
    })

    const io = makeIo()
    const factoryCounter = { count: 0 }
    const suppliedFactory = nonSupabaseFactory(factoryCounter)
    let resolverCalls = 0
    let capturedFactory: SupabaseAdapterFactory | null | undefined

    const prepared = await prepareForegroundResumeRun(repos, io, {
      runId: run.id,
      summary: "Fixed the local issue.",
      workerOwnerKind: "cli",
      supabaseAdapterFactory: suppliedFactory,
      capabilityResolver: input => {
        resolverCalls += 1
        assert.equal(input.workspace?.id, workspace.id)
        return { supabaseAdapterFactory: null }
      },
      resumeRunImpl: async input => {
        capturedFactory = input.supabaseAdapterFactory
      },
    })

    assert.equal(prepared.ok, true)
    if (!prepared.ok) return
    await prepared.start()
    assert.equal(resolverCalls, 1)
    assert.equal(capturedFactory, null)
    assert.equal(factoryCounter.count, 0)
  } finally {
    db.close()
    removeTempDir(dir)
  }
})

test("PROJ-8-PRD-3-US-1 API POST /runs stays a clean non-Supabase success path", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-capability-api-"))
  const dbPath = join(dir, "api.sqlite")
  initDatabase(dbPath).close()
  const { proc, base } = startServer({ BEERENGINEER_UI_DB_PATH: dbPath })
  try {
    await waitForHealth(base)
    const res = await fetch(`${base}/runs`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ title: "API local workflow", description: "no supabase" }),
    })
    assert.equal(res.status, 202)
    const body = await res.json() as { runId: string; itemId: string; status: string; error?: string; message?: string }
    assert.match(body.runId, /\S/)
    assert.match(body.itemId, /\S/)
    assert.equal(body.error, undefined)
    assert.equal(body.message, undefined)
    assert.equal(JSON.stringify(body).toLowerCase().includes("supabase"), false)
  } finally {
    await stopServer(proc)
    removeTempDir(dir)
  }
})

test("PROJ-8-PRD-3-US-1 CLI start_brainstorm stays a clean non-Supabase success path", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-capability-cli-"))
  const { engineRoot, binPath } = enginePaths()
  const repoRoot = join(dir, "repo")
  seedGitRepo(repoRoot)

  try {
    const dbPath = join(dir, "workflow.sqlite")
    const db = initDatabase(dbPath)
    const repos = new Repos(db)
    const workspace = repos.upsertWorkspace({ key: "default", name: "Default Workspace", rootPath: repoRoot })
    repos.createItem({ workspaceId: workspace.id, code: "ITEM-0001", title: "CLI Workflow", description: "smoke" })
    db.close()

    const result = spawnSync(
      process.execPath,
      [binPath, "item", "action", "--item", "ITEM-0001", "--action", "start_brainstorm"],
      {
        cwd: engineRoot,
        encoding: "utf8",
        env: { ...process.env, BEERENGINEER_UI_DB_PATH: dbPath, BEERENGINEER_ALLOWED_ROOTS: dir },
        input:
          "Title from terminal\nDescription from terminal\naccept\n"
          + "local-only smoke test\n"
          + "none\ndashboard first\nWCAG AA required\napprove\n"
          + "none\nprofessional\nno brand constraints\napprove\n"
          + "ok\nok\nok\naccept\npromote\n",
        timeout: 15000,
      },
    )

    assert.equal(result.status, 0, `${result.stdout ?? ""}\n${result.stderr ?? ""}`)
    assert.match(result.stdout ?? "", /start_brainstorm applied/)
    assert.match(result.stdout ?? "", /run-id:/)
    assert.equal((result.stdout ?? "").toLowerCase().includes("supabase"), false)
    assert.equal((result.stderr ?? "").toLowerCase().includes("supabase"), false)
  } finally {
    removeTempDir(dir)
  }
})
