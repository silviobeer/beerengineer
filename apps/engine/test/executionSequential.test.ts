import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

import {
  detectGitMode,
  ensureItemBranch,
  ensureProjectBranch,
  ensureStoryBranch,
  ensureStoryWorktree,
  ensureWaveBranch,
  mergeStoryIntoWave,
  rebaseStoryOntoWave,
} from "../src/core/git.js"
import { parallelStoriesFlagEnabled } from "../src/stages/execution/index.js"
import { layout, type WorkflowContext } from "../src/core/workspaceLayout.js"

function sh(cwd: string, args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" })
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`)
  return (r.stdout ?? "").trim()
}

function seedRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "be2-seq-"))
  spawnSync("git", ["init", "--initial-branch=main"], { cwd: root })
  spawnSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root })
  spawnSync("git", ["config", "user.name", "test"], { cwd: root })
  writeFileSync(join(root, "README.md"), "seed\n")
  spawnSync("git", ["add", "-A"], { cwd: root })
  spawnSync("git", ["commit", "-m", "seed"], { cwd: root })
  return root
}

test("parallelStoriesFlagEnabled honours BEERENGINEER_EXECUTION_PARALLEL_STORIES (truthy values)", () => {
  const original = process.env.BEERENGINEER_EXECUTION_PARALLEL_STORIES
  try {
    delete process.env.BEERENGINEER_EXECUTION_PARALLEL_STORIES
    assert.equal(parallelStoriesFlagEnabled(), false, "missing → sequential")
    process.env.BEERENGINEER_EXECUTION_PARALLEL_STORIES = ""
    assert.equal(parallelStoriesFlagEnabled(), false, "empty → sequential")
    for (const truthy of ["1", "true", "yes", "TRUE", "Yes"]) {
      process.env.BEERENGINEER_EXECUTION_PARALLEL_STORIES = truthy
      assert.equal(parallelStoriesFlagEnabled(), true, `${truthy} → parallel`)
    }
    for (const falsy of ["0", "false", "no", "off", "garbage"]) {
      process.env.BEERENGINEER_EXECUTION_PARALLEL_STORIES = falsy
      assert.equal(parallelStoriesFlagEnabled(), false, `${falsy} → sequential`)
    }
  } finally {
    if (original === undefined) delete process.env.BEERENGINEER_EXECUTION_PARALLEL_STORIES
    else process.env.BEERENGINEER_EXECUTION_PARALLEL_STORIES = original
  }
})

test("sequential stories see prior story's package.json scaffold (no merge conflict)", () => {
  // The HelloWorld bug: two stories in the same wave both wrote a complete
  // package.json off the same wave HEAD, then the merge resolver could not
  // reconcile two divergent scaffolds. Sequential execution branches story-2
  // off the *post-story-1* wave HEAD, so story-2 sees story-1's scaffold and
  // adds to it via an additive edit instead of producing a competing one.
  const root = seedRepo()
  try {
    const ctx: WorkflowContext = {
      workspaceId: "test-workspace",
      runId: "run-seq",
      itemSlug: "demo-item",
      baseBranch: "main",
      workspaceRoot: root,
    }
    const mode = detectGitMode(ctx)
    if (!mode.enabled) {
      assert.fail("expected enabled git mode")
      return
    }

    ensureItemBranch(mode, ctx)
    ensureProjectBranch(mode, ctx, "proj-a")
    ensureWaveBranch(mode, ctx, "proj-a", 1)

    // Story 1 — branches off the empty wave, writes a scaffold package.json.
    const wt1 = ensureStoryWorktree(
      mode,
      ctx,
      "proj-a",
      1,
      "story-1",
      layout.executionStoryWorktreeDir(ctx, 1, "story-1"),
    )
    writeFileSync(
      join(wt1, "package.json"),
      JSON.stringify({ name: "demo", scripts: { test: "node --test" } }, null, 2),
    )
    sh(wt1, ["add", "-A"])
    sh(wt1, ["commit", "-m", "story-1: add package.json with test script"])
    mergeStoryIntoWave(mode, ctx, "proj-a", 1, "story-1")

    // Story 2 — sequential mode: branches off the wave's *current* HEAD,
    // which now includes story-1's package.json. The story-2 branch
    // therefore inherits the file and edits it additively (e.g. adding
    // a new script) instead of producing a competing scaffold.
    const wt2 = ensureStoryWorktree(
      mode,
      ctx,
      "proj-a",
      1,
      "story-2",
      layout.executionStoryWorktreeDir(ctx, 1, "story-2"),
    )
    const inheritedPath = join(wt2, "package.json")
    const inherited = JSON.parse(sh(wt2, ["show", "HEAD:package.json"]))
    assert.equal(inherited.name, "demo", "story-2 should see story-1's package.json from the wave HEAD")
    inherited.scripts.lint = "echo lint"
    writeFileSync(inheritedPath, JSON.stringify(inherited, null, 2))
    sh(wt2, ["add", "-A"])
    sh(wt2, ["commit", "-m", "story-2: extend package.json with lint script"])

    // Both merges succeed without manual conflict resolution.
    mergeStoryIntoWave(mode, ctx, "proj-a", 1, "story-2")

    // Wave branch ends with both edits coexisting in one package.json.
    const finalPkg = JSON.parse(sh(mode.itemWorktreeRoot, ["show", "wave/demo-item__proj-a__w1:package.json"]))
    assert.equal(finalPkg.scripts.test, "node --test", "story-1's test script must survive")
    assert.equal(finalPkg.scripts.lint, "echo lint", "story-2's lint script must survive")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("rebaseStoryOntoWave fast-forwards when story is already up-to-date", () => {
  const root = seedRepo()
  try {
    const ctx: WorkflowContext = {
      workspaceId: "test-workspace",
      runId: "run-rebase",
      itemSlug: "demo-item",
      baseBranch: "main",
      workspaceRoot: root,
    }
    const mode = detectGitMode(ctx)
    if (!mode.enabled) {
      assert.fail("expected enabled git mode")
      return
    }
    ensureItemBranch(mode, ctx)
    ensureProjectBranch(mode, ctx, "proj-a")
    ensureWaveBranch(mode, ctx, "proj-a", 1)
    const wt1 = ensureStoryWorktree(
      mode,
      ctx,
      "proj-a",
      1,
      "story-1",
      layout.executionStoryWorktreeDir(ctx, 1, "story-1"),
    )
    void wt1
    // Story-1 has no commits and matches the wave. Rebase is a no-op.
    const result = rebaseStoryOntoWave(mode, ctx, "proj-a", 1, "story-1")
    assert.deepEqual(result, { ok: true })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("rebaseStoryOntoWave reports rebase_conflict_on:<paths> when stories overlap a file", () => {
  // Story-1 merges first and adds package.json. Story-2 was branched off
  // the older wave HEAD and writes a *different* package.json. Rebasing
  // story-2 onto the new wave HEAD must abort cleanly with a structured
  // reason — never auto-resolve.
  const root = seedRepo()
  try {
    const ctx: WorkflowContext = {
      workspaceId: "test-workspace",
      runId: "run-conflict",
      itemSlug: "demo-item",
      baseBranch: "main",
      workspaceRoot: root,
    }
    const mode = detectGitMode(ctx)
    if (!mode.enabled) {
      assert.fail("expected enabled git mode")
      return
    }
    ensureItemBranch(mode, ctx)
    ensureProjectBranch(mode, ctx, "proj-a")
    ensureWaveBranch(mode, ctx, "proj-a", 1)
    // Story-2 branches off the wave first (parallel-mode start).
    const wt2 = ensureStoryWorktree(
      mode,
      ctx,
      "proj-a",
      1,
      "story-2",
      layout.executionStoryWorktreeDir(ctx, 1, "story-2"),
    )
    writeFileSync(join(wt2, "package.json"), JSON.stringify({ name: "from-story-2" }, null, 2))
    sh(wt2, ["add", "-A"])
    sh(wt2, ["commit", "-m", "story-2: scaffold package.json"])

    // Story-1 also branches off the wave (same older HEAD), writes a
    // different package.json, and is the first to merge.
    const wt1 = ensureStoryWorktree(
      mode,
      ctx,
      "proj-a",
      1,
      "story-1",
      layout.executionStoryWorktreeDir(ctx, 1, "story-1"),
    )
    writeFileSync(join(wt1, "package.json"), JSON.stringify({ name: "from-story-1" }, null, 2))
    sh(wt1, ["add", "-A"])
    sh(wt1, ["commit", "-m", "story-1: scaffold package.json"])
    mergeStoryIntoWave(mode, ctx, "proj-a", 1, "story-1")

    // Now rebase story-2 onto the new wave HEAD: must conflict on package.json.
    const rebase = rebaseStoryOntoWave(mode, ctx, "proj-a", 1, "story-2")
    assert.equal(rebase.ok, false)
    if (rebase.ok === false) {
      assert.match(rebase.reason, /^rebase_conflict_on:.*package\.json/)
    }
    // Worktree state is clean after the abort — the rebase did not leave
    // a half-applied state behind.
    const status = sh(wt2, ["status", "--porcelain"])
    assert.equal(status, "", "worktree must be clean after rebase --abort")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("rebaseStoryOntoWave succeeds when story and wave touch disjoint files", () => {
  const root = seedRepo()
  try {
    const ctx: WorkflowContext = {
      workspaceId: "test-workspace",
      runId: "run-disjoint",
      itemSlug: "demo-item",
      baseBranch: "main",
      workspaceRoot: root,
    }
    const mode = detectGitMode(ctx)
    if (!mode.enabled) {
      assert.fail("expected enabled git mode")
      return
    }
    ensureItemBranch(mode, ctx)
    ensureProjectBranch(mode, ctx, "proj-a")
    ensureWaveBranch(mode, ctx, "proj-a", 1)
    const wt2 = ensureStoryWorktree(
      mode,
      ctx,
      "proj-a",
      1,
      "story-2",
      layout.executionStoryWorktreeDir(ctx, 1, "story-2"),
    )
    writeFileSync(join(wt2, "feature-b.txt"), "story-2 owns this file\n")
    sh(wt2, ["add", "-A"])
    sh(wt2, ["commit", "-m", "story-2: add feature-b.txt"])

    const wt1 = ensureStoryWorktree(
      mode,
      ctx,
      "proj-a",
      1,
      "story-1",
      layout.executionStoryWorktreeDir(ctx, 1, "story-1"),
    )
    writeFileSync(join(wt1, "feature-a.txt"), "story-1 owns this file\n")
    sh(wt1, ["add", "-A"])
    sh(wt1, ["commit", "-m", "story-1: add feature-a.txt"])
    mergeStoryIntoWave(mode, ctx, "proj-a", 1, "story-1")

    const rebase = rebaseStoryOntoWave(mode, ctx, "proj-a", 1, "story-2")
    assert.deepEqual(rebase, { ok: true })
    // Story-2's worktree must now contain feature-a.txt as well.
    const status = sh(wt2, ["log", "--oneline"]).split(/\r?\n/)
    assert.ok(status.some(line => line.includes("story-1: add feature-a.txt")), `expected story-1 commit on rebased story-2 branch, got ${JSON.stringify(status)}`)
    assert.ok(status.some(line => line.includes("story-2: add feature-b.txt")), `expected story-2 commit on rebased story-2 branch, got ${JSON.stringify(status)}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
