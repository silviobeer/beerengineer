import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

import type { WorkflowContext } from "../src/core/workspaceLayout.js"
import {
  detectRealGitMode,
  ensureItemBranchReal,
  ensureProjectBranchReal,
  ensureStoryBranchReal,
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

    ensureItemBranchReal(mode, ctx)
    ensureProjectBranchReal(mode, ctx, "proj-a")
    ensureWaveBranchReal(mode, ctx, "proj-a", 1)
    ensureStoryBranchReal(mode, ctx, "proj-a", 1, "story-x")

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
