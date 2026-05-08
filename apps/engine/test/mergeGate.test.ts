import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { mergeGate } from "../src/stages/mergeGate/index.js"
import { runWithWorkflowIO } from "../src/core/io.js"
import { runWithActiveRun } from "../src/core/runContext.js"
import type { GitAdapter } from "../src/core/gitAdapter.js"
import type { SupabaseWorkflowHook } from "../src/core/supabase/workflowHook.js"
import type { WorkflowContext } from "../src/core/workspaceLayout.js"
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
