import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

import type { WorkflowContext } from "../src/core/workspaceLayout.js"
import {
  detectRealGitMode,
  ensureItemBranchReal,
  ensureProjectBranchReal,
  exitRunToItemBranchReal,
  gcManagedStoryWorktreesReal,
  ensureStoryBranchReal,
  ensureStoryWorktreeReal,
  ensureWaveBranchReal,
  mergeProjectIntoItemReal,
  mergeStoryIntoWaveReal,
  mergeWaveIntoProjectReal,
} from "../src/core/realGit.js"

function sh(cwd: string, args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" })
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`)
  return (r.stdout ?? "").trim()
}

function seedRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "be2-realgit-"))
  spawnSync("git", ["init", "--initial-branch=main"], { cwd: root })
  spawnSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root })
  spawnSync("git", ["config", "user.name", "test"], { cwd: root })
  writeFileSync(join(root, "README.md"), "seed\n")
  spawnSync("git", ["add", "-A"], { cwd: root })
  spawnSync("git", ["commit", "-m", "seed"], { cwd: root })
  return root
}

test("realGit creates item/project/wave/story branches and merges them back", () => {
  const root = seedRepo()
  try {
    const ctx: WorkflowContext = {
      workspaceId: "test-workspace",
      runId: "run-1",
      itemSlug: "demo-item",
      baseBranch: "main",
      workspaceRoot: root,
    }

    const mode = detectRealGitMode(ctx)
    assert.equal(mode.enabled, true)
    if (!mode.enabled) return

    assert.equal(ensureItemBranchReal(mode, ctx), "item/demo-item")
    assert.equal(sh(root, ["branch", "--show-current"]), "item/demo-item")
    assert.equal(ensureProjectBranchReal(mode, ctx, "proj-a"), "proj/demo-item__proj-a")
    assert.equal(sh(root, ["branch", "--show-current"]), "proj/demo-item__proj-a")
    assert.equal(ensureWaveBranchReal(mode, ctx, "proj-a", 1), "wave/demo-item__proj-a__w1")
    assert.equal(sh(root, ["branch", "--show-current"]), "wave/demo-item__proj-a__w1")
    assert.equal(ensureStoryBranchReal(mode, ctx, "proj-a", 1, "story-x"), "story/demo-item__proj-a__w1__story-x")
    assert.equal(sh(root, ["branch", "--show-current"]), "story/demo-item__proj-a__w1__story-x")

    // Make a commit on the story branch
    writeFileSync(join(root, "feature.txt"), "hello\n")
    sh(root, ["add", "-A"])
    sh(root, ["commit", "-m", "story commit"])

    mergeStoryIntoWaveReal(mode, ctx, "proj-a", 1, "story-x")
    mergeWaveIntoProjectReal(mode, ctx, "proj-a", 1)
    mergeProjectIntoItemReal(mode, ctx, "proj-a")

    const branches = sh(root, ["for-each-ref", "--format=%(refname:short)", "refs/heads/"]).split(/\r?\n/).sort()
    assert.deepEqual(branches, [
      "item/demo-item",
      "main",
      "proj/demo-item__proj-a",
      "story/demo-item__proj-a__w1__story-x",
      "wave/demo-item__proj-a__w1",
    ])

    // Base branch must be untouched by automatic merges
    const mainHead = sh(root, ["rev-parse", "main"])
    const seedHead = sh(root, ["rev-parse", "main@{0}"])
    assert.equal(mainHead, seedHead)

    // Item branch should contain the story commit
    sh(root, ["checkout", "item/demo-item"])
    const log = sh(root, ["log", "--oneline"]).split(/\r?\n/)
    assert.ok(log.some(line => line.includes("story commit")), `expected story commit on item branch, got ${JSON.stringify(log)}`)

    sh(root, ["checkout", "story/demo-item__proj-a__w1__story-x"])
    assert.equal(exitRunToItemBranchReal(mode, ctx), "item/demo-item")
    assert.equal(sh(root, ["branch", "--show-current"]), "item/demo-item")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("detectRealGitMode falls back when repo is dirty", () => {
  const root = seedRepo()
  try {
    writeFileSync(join(root, "dirty.txt"), "uncommitted\n")
    const ctx: WorkflowContext = {
      workspaceId: "w",
      runId: "r",
      itemSlug: "s",
      baseBranch: "main",
      workspaceRoot: root,
    }
    const mode = detectRealGitMode(ctx)
    assert.equal(mode.enabled, false)
    if (!mode.enabled) assert.match(mode.reason, /dirty/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("detectRealGitMode falls back when workspaceRoot is unset", () => {
  const ctx: WorkflowContext = { workspaceId: "w", runId: "r", itemSlug: "s", baseBranch: "main" }
  const mode = detectRealGitMode(ctx)
  assert.equal(mode.enabled, false)
  if (!mode.enabled) assert.match(mode.reason, /workspaceRoot/)
})

test("detectRealGitMode falls back when workspace is not a git repo", () => {
  const root = mkdtempSync(join(tmpdir(), "be2-realgit-nongit-"))
  try {
    const ctx: WorkflowContext = {
      workspaceId: "w",
      runId: "r",
      itemSlug: "s",
      baseBranch: "main",
      workspaceRoot: root,
    }
    const mode = detectRealGitMode(ctx)
    assert.equal(mode.enabled, false)
    if (!mode.enabled) assert.match(mode.reason, /not a git repo/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("realGit creates a dedicated worktree for a story branch", () => {
  const root = seedRepo()
  const worktreeRoot = mkdtempSync(join(tmpdir(), "be2-story-worktree-"))
  rmSync(worktreeRoot, { recursive: true, force: true })
  try {
    const ctx: WorkflowContext = {
      workspaceId: "test-workspace",
      runId: "run-2",
      itemSlug: "demo-item",
      baseBranch: "main",
      workspaceRoot: root,
    }

    const mode = detectRealGitMode(ctx)
    assert.equal(mode.enabled, true)
    if (!mode.enabled) return

    ensureItemBranchReal(mode, ctx)
    ensureProjectBranchReal(mode, ctx, "proj-a")
    ensureWaveBranchReal(mode, ctx, "proj-a", 1)

    const path = ensureStoryWorktreeReal(mode, ctx, "proj-a", 1, "story-x", worktreeRoot)
    assert.equal(path, worktreeRoot)
    assert.equal(sh(worktreeRoot, ["branch", "--show-current"]), "story/demo-item__proj-a__w1__story-x")
    assert.equal(
      sh(root, ["branch", "--show-current"]),
      "wave/demo-item__proj-a__w1",
      "main checkout should stay on the wave branch when a story worktree is created",
    )

    const worktrees = sh(root, ["worktree", "list", "--porcelain"])
    assert.match(worktrees, new RegExp(worktreeRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    assert.match(worktrees, /refs\/heads\/story\/demo-item__proj-a__w1__story-x/)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(worktreeRoot, { recursive: true, force: true })
  }
})

test("realGit gc removes orphaned managed worktree directories that are no longer registered", () => {
  const root = seedRepo()
  const managedRoot = mkdtempSync(join(tmpdir(), "be2-story-worktree-gc-"))
  const worktreeRoot = join(managedRoot, "workspace", "runs", "run-3", "waves", "wave-1", "stories", "story-x")
  try {
    const ctx: WorkflowContext = {
      workspaceId: "test-workspace",
      runId: "run-3",
      itemSlug: "demo-item",
      baseBranch: "main",
      workspaceRoot: root,
    }

    const mode = detectRealGitMode(ctx)
    assert.equal(mode.enabled, true)
    if (!mode.enabled) return

    mkdirSync(worktreeRoot, { recursive: true })
    writeFileSync(join(worktreeRoot, ".git"), "gitdir: /orphaned/worktree\n")

    const result = gcManagedStoryWorktreesReal(mode, managedRoot)
    assert.deepEqual(result.removed, [worktreeRoot])
    assert.equal(result.kept.length, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(managedRoot, { recursive: true, force: true })
  }
})
