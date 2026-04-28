/**
 * Tests for the setup-task commit fix.
 *
 * The bug: runSetupStory runs verifySetupContract, marks the story `passed`,
 * but never commits the worktree — so mergeStoryIntoWave carries nothing
 * forward and downstream feature waves start from a no-scaffold base.
 *
 * The fix: commitAll() in git.ts + a call in runSetupStory after
 * verifySetupContract returns [] (contract satisfied).
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

import {
  commitAll,
  detectGitMode,
  ensureItemBranch,
  ensureProjectBranch,
  ensureStoryWorktree,
  ensureWaveBranch,
  mergeStoryIntoWave,
} from "../src/core/git.js"
import { runSetupStory } from "../src/stages/execution/index.js"
import { layout, type WorkflowContext } from "../src/core/workspaceLayout.js"
import type { WithArchitecture, WaveDefinition, UserStory } from "../src/types.js"

function sh(cwd: string, args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" })
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`)
  return (r.stdout ?? "").trim()
}

function seedRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "be2-setup-commit-"))
  spawnSync("git", ["init", "--initial-branch=main"], { cwd: root })
  spawnSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root })
  spawnSync("git", ["config", "user.name", "test"], { cwd: root })
  writeFileSync(join(root, "README.md"), "seed\n")
  spawnSync("git", ["add", "-A"], { cwd: root })
  spawnSync("git", ["commit", "-m", "seed"], { cwd: root })
  return root
}

// ---------------------------------------------------------------------------
// Unit: commitAll
// ---------------------------------------------------------------------------

test("commitAll returns null when the worktree is clean (no-op)", () => {
  const root = seedRepo()
  try {
    const ctx: WorkflowContext = {
      workspaceId: "ws-commitall",
      runId: "run-clean",
      itemSlug: "item-clean",
      baseBranch: "main",
      workspaceRoot: root,
    }
    const mode = detectGitMode(ctx)
    ensureItemBranch(mode, ctx)
    ensureProjectBranch(mode, ctx, "proj-x")
    ensureWaveBranch(mode, ctx, "proj-x", 1)
    const wt = ensureStoryWorktree(
      mode, ctx, "proj-x", 1, "story-1",
      layout.executionStoryWorktreeDir(ctx, 1, "story-1"),
    )
    // Nothing written — tree is clean.
    const result = commitAll(wt, "Should be no-op")
    assert.equal(result, null, "clean tree should return null")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("commitAll stages and commits when the worktree has changes", () => {
  const root = seedRepo()
  try {
    const ctx: WorkflowContext = {
      workspaceId: "ws-commitall",
      runId: "run-dirty",
      itemSlug: "item-dirty",
      baseBranch: "main",
      workspaceRoot: root,
    }
    const mode = detectGitMode(ctx)
    ensureItemBranch(mode, ctx)
    ensureProjectBranch(mode, ctx, "proj-x")
    ensureWaveBranch(mode, ctx, "proj-x", 1)
    const wt = ensureStoryWorktree(
      mode, ctx, "proj-x", 1, "story-1",
      layout.executionStoryWorktreeDir(ctx, 1, "story-1"),
    )
    const before = sh(wt, ["rev-parse", "HEAD"])
    writeFileSync(join(wt, "scaffold.txt"), "hello\n")

    const sha = commitAll(wt, "Setup task T1: scaffold project")
    assert.ok(sha, "expected a commit sha")
    const after = sh(wt, ["rev-parse", "HEAD"])
    assert.notEqual(before, after, "HEAD should advance after commit")
    const msg = sh(wt, ["log", "--format=%s", "-1"])
    assert.equal(msg, "Setup task T1: scaffold project")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("commitAll is idempotent — second call on clean tree returns null", () => {
  const root = seedRepo()
  try {
    const ctx: WorkflowContext = {
      workspaceId: "ws-commitall",
      runId: "run-idempotent",
      itemSlug: "item-idempotent",
      baseBranch: "main",
      workspaceRoot: root,
    }
    const mode = detectGitMode(ctx)
    ensureItemBranch(mode, ctx)
    ensureProjectBranch(mode, ctx, "proj-x")
    ensureWaveBranch(mode, ctx, "proj-x", 1)
    const wt = ensureStoryWorktree(
      mode, ctx, "proj-x", 1, "story-1",
      layout.executionStoryWorktreeDir(ctx, 1, "story-1"),
    )
    writeFileSync(join(wt, "scaffold.txt"), "hello\n")
    const sha1 = commitAll(wt, "Setup task T1: first commit")
    assert.ok(sha1, "first commit should succeed")
    // Second call on a now-clean tree — must not throw, must return null.
    const sha2 = commitAll(wt, "Setup task T1: should be no-op")
    assert.equal(sha2, null, "second call on clean tree must return null")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Integration: runSetupStory commits and mergeStoryIntoWave carries it forward
// ---------------------------------------------------------------------------

function buildMinimalCtx(root: string): WithArchitecture {
  return {
    workspaceId: "ws-setup-commit",
    runId: "run-setup-commit",
    itemSlug: "setup-item",
    baseBranch: "main",
    workspaceRoot: root,
    project: {
      id: "proj-setup",
      name: "Setup Project",
      description: "test",
      concept: { summary: "test", problem: "test", users: [], constraints: [] },
    },
    prd: { stories: [] },
    architecture: {
      project: { id: "proj-setup", name: "Setup Project", description: "test" },
      concept: { summary: "test", problem: "test", users: [], constraints: [] },
      prdSummary: { storyCount: 0, storyIds: [] },
      architecture: {
        summary: "test",
        systemShape: "test",
        components: [],
        dataModelNotes: [],
        apiNotes: [],
        deploymentNotes: [],
        constraints: [],
        risks: [],
        openQuestions: [],
      },
    },
  } as unknown as WithArchitecture
}

function buildSetupWave(): WaveDefinition {
  return {
    id: "wave-setup",
    number: 1,
    goal: "Bootstrap scaffold",
    kind: "setup",
    stories: [],
    tasks: [
      {
        id: "T1",
        title: "scaffold project",
        sharedFiles: [],
        contract: {
          // Empty contract — verifySetupContract returns [] immediately.
          expectedFiles: [],
          requiredScripts: [],
          postChecks: [],
        },
      },
    ],
    internallyParallelizable: false,
    dependencies: [],
    exitCriteria: [],
  }
}

test("runSetupStory commits the worktree when contract is satisfied — story branch advances", async () => {
  const root = seedRepo()
  try {
    const ctx = buildMinimalCtx(root)
    const wave = buildSetupWave()
    const story: UserStory = { id: "T1", title: "scaffold project", acceptanceCriteria: [] }

    const wfCtx: WorkflowContext = {
      workspaceId: ctx.workspaceId,
      runId: ctx.runId,
      itemSlug: ctx.itemSlug,
      baseBranch: ctx.baseBranch,
      workspaceRoot: root,
    }
    const mode = detectGitMode(wfCtx)
    ensureItemBranch(mode, wfCtx)
    ensureProjectBranch(mode, wfCtx, "proj-setup")
    ensureWaveBranch(mode, wfCtx, "proj-setup", 1)
    const worktreeRoot = ensureStoryWorktree(
      mode, wfCtx, "proj-setup", 1, "T1",
      layout.executionStoryWorktreeDir(wfCtx, 1, "T1"),
    )

    const tipBefore = sh(worktreeRoot, ["rev-parse", "HEAD"])

    // Simulate work done by the coder: write a file to the worktree.
    writeFileSync(join(worktreeRoot, "scaffold.txt"), "generated scaffold\n")

    // Run setup story with no LLM — contract is empty so it passes immediately.
    const result = await runSetupStory(
      ctx,
      wave,
      story,
      {} as never, // screenOwners — not needed for empty contract
      { worktreeRoot },
      undefined, // no LLM
    )

    assert.equal(result.implementation.status, "passed", "story should pass")

    const tipAfter = sh(worktreeRoot, ["rev-parse", "HEAD"])
    assert.notEqual(tipBefore, tipAfter, "story branch tip must advance after runSetupStory")

    const commitMsg = sh(worktreeRoot, ["log", "--format=%s", "-1"])
    assert.ok(
      commitMsg.includes("T1"),
      `commit message must reference the task id (got: ${commitMsg})`,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("mergeStoryIntoWave carries setup commit onto the wave branch", async () => {
  const root = seedRepo()
  try {
    const ctx = buildMinimalCtx(root)
    const wave = buildSetupWave()
    const story: UserStory = { id: "T1", title: "scaffold project", acceptanceCriteria: [] }

    const wfCtx: WorkflowContext = {
      workspaceId: ctx.workspaceId,
      runId: ctx.runId,
      itemSlug: ctx.itemSlug,
      baseBranch: ctx.baseBranch,
      workspaceRoot: root,
    }
    const mode = detectGitMode(wfCtx)
    ensureItemBranch(mode, wfCtx)
    ensureProjectBranch(mode, wfCtx, "proj-setup")
    ensureWaveBranch(mode, wfCtx, "proj-setup", 1)
    const worktreeRoot = ensureStoryWorktree(
      mode, wfCtx, "proj-setup", 1, "T1",
      layout.executionStoryWorktreeDir(wfCtx, 1, "T1"),
    )

    // Record wave branch tip before any story work.
    const itemWt = mode.itemWorktreeRoot
    const waveTipBefore = sh(itemWt, ["rev-parse", "wave/setup-item__proj-setup__w1"])

    writeFileSync(join(worktreeRoot, "scaffold.txt"), "generated scaffold\n")

    await runSetupStory(ctx, wave, story, {} as never, { worktreeRoot }, undefined)

    // Now merge story into wave — the commit should travel forward.
    mergeStoryIntoWave(mode, wfCtx, "proj-setup", 1, "T1")

    const waveTipAfter = sh(itemWt, ["rev-parse", "wave/setup-item__proj-setup__w1"])
    assert.notEqual(
      waveTipBefore,
      waveTipAfter,
      "wave branch must advance after mergeStoryIntoWave — setup commit must be carried forward",
    )

    // The scaffold file must be reachable from the wave branch tip.
    const exists = sh(itemWt, ["show", "wave/setup-item__proj-setup__w1:scaffold.txt"])
    assert.equal(exists.trim(), "generated scaffold", "scaffold.txt must be visible on wave branch")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("runSetupStory is a no-op commit when worktreeRoot is not provided", async () => {
  // When worktreeRoot is absent the commit step must be silently skipped —
  // no exception, status still passes for a satisfied contract.
  const root = seedRepo()
  try {
    const ctx = buildMinimalCtx(root)
    const wave = buildSetupWave()
    const story: UserStory = { id: "T1", title: "scaffold project", acceptanceCriteria: [] }

    const result = await runSetupStory(
      ctx,
      wave,
      story,
      {} as never,
      {}, // no worktreeRoot
      undefined,
    )

    assert.equal(result.implementation.status, "passed")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
