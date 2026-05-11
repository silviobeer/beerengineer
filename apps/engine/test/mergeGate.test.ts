import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

import { mergeGate } from "../src/stages/mergeGate/index.js"
import { runWithWorkflowIO } from "../src/core/io.js"
import { emitEvent, runWithActiveRun } from "../src/core/runContext.js"
import { busToWorkflowIO, createBus } from "../src/core/bus.js"
import { attachDbSync } from "../src/core/dbSync.js"
import { createGitAdapterFromMode, type GitAdapter } from "../src/core/gitAdapter.js"
import { detectGitMode } from "../src/core/git.js"
import { writeRecoveryRecord } from "../src/core/recovery.js"
import type { SupabaseWorkflowHook } from "../src/core/supabase/workflowHook.js"
import { layout, type WorkflowContext } from "../src/core/workspaceLayout.js"
import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"

const context: WorkflowContext = {
  workspaceId: "item-1",
  workspaceRoot: "/tmp/workspace",
  runId: "run-1",
  itemSlug: "demo-item",
  baseBranch: "master",
}

function makeGit(): GitAdapter {
  return {
    enabled: true,
    mode: {
      enabled: true,
      kind: "workspace-root",
      workspaceRoot: "/tmp/workspace",
      baseBranch: "master",
      itemWorktreeRoot: "/tmp/workspace/.beerengineer/worktrees",
    },
    ensureItemBranch() {},
    ensureProjectBranch() {},
    mergeProjectIntoItem() {},
    mergeItemIntoBase() {
      return { mergeSha: "deadbeef" }
    },
    ensureWaveBranch() {
      return "wave"
    },
    ensureStoryBranch() {
      return "story"
    },
    ensureStoryWorktree() {
      return "/tmp/story"
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
      return "item/demo-item"
    },
    assertWorkspaceRootOnBaseBranch() {},
    gcManagedStoryWorktrees() {
      return { removed: [], kept: [], errors: [] }
    },
  }
}

function makeContext(overrides?: Partial<WorkflowContext>): WorkflowContext {
  return {
    workspaceId: "item-1",
    workspaceRoot: "/tmp/workspace",
    runId: "run-1",
    itemSlug: "demo-item",
    baseBranch: "master",
    ...overrides,
  }
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`)
  }
  return (result.stdout ?? "").trim()
}

function seedRepo(root: string): void {
  git(root, ["init", "--initial-branch=master"])
  git(root, ["config", "user.email", "test@example.invalid"])
  git(root, ["config", "user.name", "test"])
  writeFileSync(join(root, "README.md"), "seed\n")
  git(root, ["add", "-A"])
  git(root, ["commit", "-m", "seed"])
}

function createRealMergeGateGit(context: WorkflowContext): GitAdapter {
  return createGitAdapterFromMode(context, detectGitMode(context))
}

function seedConflictedFiles(root: string): void {
  writeFileSync(join(root, "conflict.txt"), "shared base line\n")
  mkdirSync(join(root, "nested"), { recursive: true })
  writeFileSync(join(root, "nested", "space name.txt"), "shared nested line\n")
  git(root, ["add", "-A"])
  git(root, ["commit", "-m", "add conflict fixtures"])
}

function writeConflictVariant(root: string, label: string): void {
  writeFileSync(join(root, "conflict.txt"), `${label} root line\n`)
  writeFileSync(join(root, "nested", "space name.txt"), `${label} nested line\n`)
}

test("mergeGate blocks instead of merging on unexpected free-text answers", async () => {
  const git = makeGit()
  let merged = false
  git.mergeItemIntoBase = () => {
    merged = true
    return { mergeSha: "deadbeef" }
  }

  let blocked: { summary: string; cause?: string } | null = null

  await assert.rejects(
    runWithWorkflowIO(
      {
        ask: async () => "hold",
        emit: () => {},
      },
      () =>
        runWithActiveRun({ runId: "run-1", itemId: "ITEM-1", stageRunId: "stage-1" }, () =>
          mergeGate(context, git, async (_ctx, summary, opts) => {
            blocked = { summary, cause: opts?.cause }
            throw new Error("blocked")
          }),
        ),
    ),
    /blocked/,
  )

  assert.equal(merged, false)
  assert.equal(blocked?.cause, "merge_gate_failed")
  assert.match(blocked?.summary ?? "", /unsupported answer/i)
})

test("mergeGate accepts common approval wording as promotion", async () => {
  const git = makeGit()
  let merged = false
  git.mergeItemIntoBase = () => {
    merged = true
    return { mergeSha: "deadbeef" }
  }

  await runWithWorkflowIO(
    {
      ask: async () => "approve",
      emit: () => {},
    },
    () =>
      runWithActiveRun({ runId: "run-1", itemId: "ITEM-1", stageRunId: "stage-1" }, () =>
        mergeGate(context, git, async () => {
          throw new Error("blocked")
        }),
      ),
  )

  assert.equal(merged, true)
})

test("REQ-1: real merge conflicts create structured recovery artifacts and block the run", async () => {
  const root = mkdtempSync(join(tmpdir(), "be2-merge-conflict-"))
  const dbDir = mkdtempSync(join(tmpdir(), "be2-merge-conflict-db-"))
  const db = initDatabase(join(dbDir, "db.sqlite"))
  const repos = new Repos(db)
  const context = makeContext({
    workspaceId: "merge-conflict-ws",
    workspaceRoot: root,
    runId: "run-structured",
    itemSlug: "demo-item",
  })

  try {
    seedRepo(root)
    seedConflictedFiles(root)

    const workspace = repos.upsertWorkspace({ key: "merge-conflict", name: "Merge Conflict", rootPath: root })
    const item = repos.createItem({ workspaceId: workspace.id, code: "ITEM-0099", title: "Merge Conflict Item", description: "Desc" })
    const run = repos.createRun({ id: context.runId, workspaceId: workspace.id, itemId: item.id, title: item.title })

    const gitAdapter = createRealMergeGateGit(context)
    gitAdapter.ensureItemBranch()

    writeConflictVariant(gitAdapter.mode.itemWorktreeRoot, "item branch")
    git(gitAdapter.mode.itemWorktreeRoot, ["add", "-A"])
    git(gitAdapter.mode.itemWorktreeRoot, ["commit", "-m", "item conflict change"])

    writeConflictVariant(root, "base branch")
    git(root, ["add", "-A"])
    git(root, ["commit", "-m", "base conflict change"])

    const bus = createBus()
    const unsubscribeDbSync = attachDbSync(bus, repos, { runId: run.id, itemId: item.id })
    const unsubscribePrompt = bus.subscribe(event => {
      if (event.type === "prompt_requested") bus.answer(event.promptId, "promote")
    })

    const start = Date.now()
    await assert.rejects(
      runWithWorkflowIO(busToWorkflowIO(bus), () =>
        runWithActiveRun({ runId: run.id, itemId: item.id, title: item.title }, () =>
          mergeGate(context, gitAdapter, async (ctx, summary, opts) => {
            const scope = opts?.scope ?? { type: "run", runId: run.id }
            await writeRecoveryRecord(ctx, {
              status: "blocked",
              cause: opts?.cause ?? "system_error",
              scope,
              summary,
              detail: opts?.detail,
              evidencePaths: opts?.evidencePaths ?? [layout.runDir(ctx)],
              branch: opts?.branch,
            })
            emitEvent({
              type: "run_blocked",
              runId: run.id,
              itemId: item.id,
              title: item.title,
              scope,
              cause: opts?.cause ?? "system_error",
              summary,
              branch: opts?.branch,
            })
            throw new Error("blocked")
          }),
        ),
      ),
      /blocked/,
    )
    const end = Date.now()
    unsubscribePrompt()
    unsubscribeDbSync()
    bus.close()

    const updated = repos.getRun(run.id)
    assert.equal(updated?.status, "blocked")
    assert.equal(updated?.recovery_status, "blocked")
    assert.equal(updated?.recovery_scope, "stage")
    assert.equal(updated?.recovery_scope_ref, "merge-gate")
    assert.match(updated?.recovery_summary ?? "", /merge conflict blocked promotion/i)
    assert.match(updated?.recovery_summary ?? "", /merge-conflict-recovery\.md/)
    assert.match(updated?.recovery_summary ?? "", /confirm_merge_resolved/)
    assert.doesNotMatch(updated?.recovery_summary ?? "", /^git: merge /i)

    const artifactsDir = layout.stageArtifactsDir(context, "merge-gate")
    const humanPath = join(artifactsDir, "merge-conflict-recovery.md")
    const machinePath = join(artifactsDir, "merge-conflict-recovery.json")
    const human = readFileSync(humanPath, "utf8")
    const machine = JSON.parse(readFileSync(machinePath, "utf8")) as {
      itemId: string
      runId: string
      recordedAt: string
      conflictedPaths: string[]
    }

    assert.match(human, new RegExp(`Item ID: ${item.id}`))
    assert.match(human, /Run ID: run-structured/)
    assert.match(human, /conflict\.txt/)
    assert.match(human, /nested\/space name\.txt/)
    assert.match(human, /Resolve the conflicted files/i)
    assert.match(human, /confirm_merge_resolved/)

    assert.equal(machine.itemId, item.id)
    assert.equal(machine.runId, "run-structured")
    assert.deepEqual(machine.conflictedPaths.sort(), ["conflict.txt", "nested/space name.txt"])
    const recordedAt = Date.parse(machine.recordedAt)
    assert.equal(Number.isNaN(recordedAt), false)
    assert.ok(recordedAt >= start && recordedAt <= end, `expected recordedAt within test window, got ${machine.recordedAt}`)
  } finally {
    db.close()
    rmSync(dbDir, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})

test("REQ-1: non-conflict merge failures stay on the generic error path", async () => {
  const root = mkdtempSync(join(tmpdir(), "be2-merge-non-conflict-"))
  const context = makeContext({
    workspaceId: "merge-non-conflict-ws",
    workspaceRoot: root,
    runId: "run-non-conflict",
    itemSlug: "demo-item",
  })

  try {
    seedRepo(root)
    writeFileSync(join(root, "guarded.txt"), "base content\n")
    git(root, ["add", "-A"])
    git(root, ["commit", "-m", "add guarded file"])

    const gitAdapter = createRealMergeGateGit(context)
    gitAdapter.ensureItemBranch()

    writeFileSync(join(gitAdapter.mode.itemWorktreeRoot, "guarded.txt"), "item branch committed change\n")
    git(gitAdapter.mode.itemWorktreeRoot, ["add", "-A"])
    git(gitAdapter.mode.itemWorktreeRoot, ["commit", "-m", "item guarded change"])

    writeFileSync(join(root, "guarded.txt"), "local uncommitted change on base\n")

    let blocked: { summary: string; cause?: string } | null = null
    await assert.rejects(
      runWithWorkflowIO(
        {
          ask: async () => "promote",
          emit: () => {},
        },
        () =>
          runWithActiveRun({ runId: "run-non-conflict", itemId: "ITEM-404", stageRunId: "stage-1" }, () =>
            mergeGate(context, gitAdapter, async (_ctx, summary, opts) => {
              blocked = { summary, cause: opts?.cause }
              throw new Error("blocked")
            }),
          ),
      ),
      /blocked/,
    )

    assert.equal(blocked?.cause, "merge_gate_failed")
    assert.match(blocked?.summary ?? "", /Merge into master failed/i)
    assert.match(blocked?.summary ?? "", /local changes/i)
    assert.doesNotMatch(blocked?.summary ?? "", /confirm_merge_resolved/)
    assert.doesNotMatch(blocked?.summary ?? "", /merge-conflict-recovery\.md/)
    assert.equal(git(root, ["status", "--short"]).includes("UU"), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("REQ-3 AC-3.4: direct-mode merge gate skips automatic production migration", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-merge-gate-direct-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)

  try {
    const workspace = repos.upsertWorkspace({ key: "direct", name: "Direct", rootPath: dir })
    repos.connectWorkspaceSupabase(workspace.id, { projectRef: "proj_direct", region: "eu-central-1", dbMode: "direct" })
    const item = repos.createItem({ workspaceId: workspace.id, title: "Item", description: "Desc" })
    const run = repos.createRun({ workspaceId: workspace.id, itemId: item.id, title: "Run" })

    const git = makeGit()
    let merged = false
    git.mergeItemIntoBase = () => {
      merged = true
      return { mergeSha: "deadbeef" }
    }

    let migrationAttempts = 0
    const supabaseHook: SupabaseWorkflowHook = {
      repos,
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
      workspaceId: workspace.id,
      projectRef: "proj_direct",
      dbMode: "direct",
      protectionSwitch: "off",
      cleanupPolicy: "manual",
    }

    await runWithWorkflowIO(
      {
        ask: async () => "promote",
        emit: () => {},
      },
      () =>
        runWithActiveRun({ runId: run.id, itemId: item.id, stageRunId: "stage-1" }, () =>
          mergeGate(
            makeContext({ workspaceId: workspace.id, workspaceRoot: dir, runId: run.id, itemSlug: "direct-item" }),
            git,
            async () => {
              throw new Error("blocked")
            },
            supabaseHook,
          ),
        ),
    )

    assert.equal(merged, true)
    assert.equal(migrationAttempts, 0)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("PROJ-8-PRD-3-US-3: healthy Supabase wiring still blocks destructive production migrations before merge or provider mutation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-merge-gate-safety-"))
  const db = initDatabase(join(dir, "db.sqlite"))
  const repos = new Repos(db)
  mkdirSync(join(dir, "supabase", "migrations"), { recursive: true })
  writeFileSync(join(dir, "supabase", "migrations", "20260508010101_drop_users.sql"), "drop table users;")

  try {
    const workspace = repos.upsertWorkspace({ key: "demo", name: "Demo", rootPath: dir })
    repos.connectWorkspaceSupabase(workspace.id, { projectRef: "proj_demo", region: "eu-central-1" })
    const item = repos.createItem({ workspaceId: workspace.id, title: "Item", description: "Desc" })
    const run = repos.createRun({ workspaceId: workspace.id, itemId: item.id, title: "Run" })
    repos.setRunSupabaseBranch(run.id, { ref: "branch_demo", name: "branch-demo", lifecycleState: "validated" })

    const git = makeGit()
    let merged = false
    git.mergeItemIntoBase = () => {
      merged = true
      return { mergeSha: "deadbeef" }
    }

    let migrationAttempts = 0
    const supabaseHook: SupabaseWorkflowHook = {
      repos,
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
      workspaceId: workspace.id,
      projectRef: "proj_demo",
      dbMode: "branching",
      parentBranchRef: "branch_demo",
      protectionSwitch: "on",
      cleanupPolicy: "manual",
    }

    let blocked: { summary: string; cause?: string } | null = null
    await assert.rejects(
      runWithWorkflowIO(
        {
          ask: async () => "promote",
          emit: () => {},
        },
        () =>
          runWithActiveRun({ runId: run.id, itemId: item.id, stageRunId: "stage-1" }, () =>
            mergeGate(
              makeContext({ workspaceId: workspace.id, workspaceRoot: dir, runId: run.id, itemSlug: "demo-item" }),
              git,
              async (_ctx, summary, opts) => {
                blocked = { summary, cause: opts?.cause }
                throw new Error("blocked")
              },
              supabaseHook,
            ),
          ),
      ),
      /blocked/,
    )

    assert.equal(blocked?.cause, "merge_gate_failed")
    assert.match(blocked?.summary ?? "", /destructive migration operations require per-merge confirmation/i)
    assert.equal(merged, false)
    assert.equal(migrationAttempts, 0)
    assert.equal(repos.getRun(run.id)?.supabase_branch_lifecycle_state, "validated")
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
