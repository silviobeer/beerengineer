import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, rmSync } from "node:fs"
import { basename, resolve } from "node:path"
import type { WorkflowContext } from "./workspaceLayout.js"
import { layout } from "./workspaceLayout.js"
import {
  branchNameItem,
  branchNameProject,
  branchNameStory,
  branchNameWave,
} from "./branchNames.js"
import { isEngineOwnedBranchName } from "./baseBranch.js"
import { resolveMergeConflictsViaLlm, type MergeResolverHarness } from "./mergeResolver.js"

export type GitMergeOptions = {
  mergeResolver?: MergeResolverHarness
  // Optional: directory to drop merge-resolver telemetry into.
  resolverLogDir?: string
  expectedSharedFiles?: string[]
}

export type GitMode = { enabled: true; workspaceRoot: string; baseBranch: string; itemWorktreeRoot: string }

type GitResult = { ok: boolean; stdout: string; stderr: string }
type WorktreeEntry = { path: string; branch: string | null }
export type ManagedWorktreeGcResult = {
  removed: string[]
  kept: Array<{ path: string; reason: string }>
}

function runGit(workspaceRoot: string, args: string[]): GitResult {
  const result = spawnSync("git", args, { cwd: workspaceRoot, encoding: "utf8" })
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  }
}

/**
 * Result of inspecting a workspace for run-readiness, expressed as
 * structured data. Single source of truth for both the throwing path
 * ({@link detectGitMode}) and non-throwing CLI preflight, so the two
 * always agree on whether the workspace is runnable.
 */
export type WorkspaceInspection =
  | { kind: "ok"; currentBranch: string }
  | { kind: "not-a-repo" }
  | { kind: "git-status-failed"; stderr: string }
  | { kind: "dirty"; currentBranch: string; trackedCount: number; untrackedCount: number }

/**
 * Probe the workspace at `workspaceRoot` and report whether it can host a
 * fresh run. No throws, no formatting — pure data the caller composes.
 */
export function inspectWorkspaceState(workspaceRoot: string): WorkspaceInspection {
  const inside = runGit(workspaceRoot, ["rev-parse", "--is-inside-work-tree"])
  if (!inside.ok || inside.stdout !== "true") {
    return { kind: "not-a-repo" }
  }
  const status = runGit(workspaceRoot, [
    "status",
    "--porcelain",
    "--branch",
    "--",
    ".",
    ":(exclude).beerengineer",
  ])
  if (!status.ok) {
    return { kind: "git-status-failed", stderr: status.stderr }
  }
  const lines = status.stdout.split(/\r?\n/).filter(Boolean)
  const branchLine = lines.find(line => line.startsWith("## ")) ?? "## unknown"
  const currentBranch = branchLine
    .replace(/^##\s+/, "")
    .split("...")[0]!
    .split(/\s+\[/)[0]!
    .trim()
  const changed = lines.filter(line => !line.startsWith("## "))
  if (changed.length === 0) {
    return { kind: "ok", currentBranch }
  }
  const untrackedCount = changed.filter(line => line.startsWith("?? ")).length
  return {
    kind: "dirty",
    currentBranch,
    trackedCount: changed.length - untrackedCount,
    untrackedCount,
  }
}

/**
 * Resolve the workspace into an enabled {@link GitMode} or
 * throw with a precise reason. Real-git is mandatory: simulation has been
 * removed.
 */
export function detectGitMode(context: WorkflowContext): GitMode {
  const workspaceRoot = context.workspaceRoot
  if (!workspaceRoot) {
    throw new Error("git: workspaceRoot is required (simulation mode has been removed)")
  }

  const baseBranch = context.baseBranch?.trim()
  if (!baseBranch) {
    throw new Error("git: base branch could not be resolved (set context.baseBranch)")
  }

  if (!context.itemSlug?.trim()) {
    throw new Error("git: itemSlug is required (item worktree is mandatory)")
  }

  const inspection = inspectWorkspaceState(workspaceRoot)
  switch (inspection.kind) {
    case "not-a-repo":
      throw new Error(`git: workspace ${workspaceRoot} is not a git repository`)
    case "git-status-failed":
      throw new Error(`git: git status failed: ${inspection.stderr}`)
    case "dirty":
      throw new Error(
        `git: workspace ${workspaceRoot} has uncommitted changes (dirty repo); commit or stash before starting`,
      )
    case "ok":
      return {
        enabled: true,
        workspaceRoot,
        baseBranch,
        itemWorktreeRoot: layout.itemWorktreeDir(context),
      }
  }
}

function branchWorkspaceRoot(mode: GitMode): string {
  return mode.itemWorktreeRoot
}

// Guards the invariant that all branch/checkout work happens in the item
// worktree, never in the primary checkout. If the engine ever lands HEAD of
// `mode.workspaceRoot` on something other than `baseBranch`, we want to fail
// fast — silently mutating main is the worst possible failure mode.
export function assertWorkspaceRootOnBaseBranch(
  mode: GitMode,
  when: string,
): void {
  if (resolve(mode.workspaceRoot) === resolve(mode.itemWorktreeRoot)) {
    throw new Error(
      `branch_gate: workspaceRoot and itemWorktreeRoot must differ (${mode.workspaceRoot}) — ${when}`,
    )
  }
  const actual = currentBranch(mode.workspaceRoot)
  if (actual !== mode.baseBranch) {
    throw new Error(
      `branch_gate: primary workspaceRoot was hijacked off ${mode.baseBranch} (now on ${actual || "<detached>"}) — ${when}`,
    )
  }
}

function branchExists(workspaceRoot: string, branch: string): boolean {
  return runGit(workspaceRoot, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).ok
}

function currentBranch(workspaceRoot: string): string {
  return runGit(workspaceRoot, ["branch", "--show-current"]).stdout
}

function listWorktrees(workspaceRoot: string): WorktreeEntry[] {
  const result = runGit(workspaceRoot, ["worktree", "list", "--porcelain"])
  if (!result.ok) return []
  const entries: WorktreeEntry[] = []
  let current: Partial<WorktreeEntry> = {}
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line.trim()) {
      if (current.path) entries.push({ path: current.path, branch: current.branch ?? null })
      current = {}
      continue
    }
    if (line.startsWith("worktree ")) current.path = resolve(line.slice("worktree ".length).trim())
    if (line.startsWith("branch ")) current.branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "")
  }
  if (current.path) entries.push({ path: current.path, branch: current.branch ?? null })
  return entries
}

function findWorktreeByPath(workspaceRoot: string, worktreeRoot: string): WorktreeEntry | undefined {
  const expected = resolve(worktreeRoot)
  return listWorktrees(workspaceRoot).find(entry => entry.path === expected)
}

function isCanonicalManagedWorktreePath(path: string): boolean {
  const parent = basename(resolve(path, ".."))
  return parent.includes("__")
}

function collectManagedWorktreePaths(root: string): string[] {
  if (!existsSync(root)) return []
  const out: string[] = []
  const stack = [resolve(root)]
  while (stack.length > 0) {
    const current = stack.pop()!
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    const hasGitMarker = entries.some(entry => entry.name === ".git")
    if (hasGitMarker) {
      out.push(current)
      continue
    }
    for (const entry of entries) {
      if (entry.isDirectory()) stack.push(resolve(current, entry.name))
    }
  }
  return out.sort((left, right) => left.localeCompare(right))
}

function assertActiveBranch(mode: GitMode, expected: string, reason: string): void {
  const actual = currentBranch(branchWorkspaceRoot(mode))
  if (actual !== expected) {
    throw new Error(`branch_gate: expected ${expected} after ${reason}, but HEAD is ${actual || "<detached>"}`)
  }
}

function ensureBranchFrom(mode: GitMode, branch: string, from: string): void {
  const root = branchWorkspaceRoot(mode)
  if (branchExists(root, branch)) {
    if (currentBranch(root) === branch) return
    const co = runGit(root, ["checkout", branch])
    if (!co.ok) throw new Error(`git: checkout ${branch} failed: ${co.stderr}`)
    assertActiveBranch(mode, branch, `checking out existing branch ${branch}`)
    return
  }
  if (!branchExists(root, from)) {
    throw new Error(`git: cannot branch ${branch} from missing base ${from}`)
  }
  const create = runGit(root, ["checkout", "-b", branch, from])
  if (!create.ok) throw new Error(`git: create ${branch} from ${from} failed: ${create.stderr}`)
  assertActiveBranch(mode, branch, `creating branch ${branch} from ${from}`)
}

function ensureBranchExistsFrom(mode: GitMode, branch: string, from: string): void {
  const root = branchWorkspaceRoot(mode)
  if (branchExists(root, branch)) return
  if (!branchExists(root, from)) {
    throw new Error(`git: cannot branch ${branch} from missing base ${from}`)
  }
  const create = runGit(root, ["branch", branch, from])
  if (!create.ok) throw new Error(`git: create ${branch} from ${from} failed: ${create.stderr}`)
}

function mergeNoFf(
  mode: GitMode,
  target: string,
  source: string,
  message: string,
  opts: GitMergeOptions = {},
): void {
  const root = branchWorkspaceRoot(mode)
  const co = runGit(root, ["checkout", target])
  if (!co.ok) throw new Error(`git: checkout ${target} for merge failed: ${co.stderr}`)
  assertActiveBranch(mode, target, `checking out merge target ${target}`)
  const head = runGit(root, ["rev-parse", "HEAD"]).stdout
  const sourceHead = runGit(root, ["rev-parse", source]).stdout
  if (head && head === sourceHead) return
  const ancestor = runGit(root, ["merge-base", "--is-ancestor", source, target])
  if (ancestor.ok) return
  const merge = runGit(root, ["merge", "--no-ff", "-m", message, source])
  if (!merge.ok) {
    const stderr = merge.stderr || merge.stdout
    const looksLikeConflict = /CONFLICT|Automatic merge failed/i.test(stderr)
    if (looksLikeConflict && opts.mergeResolver) {
      const resolution = resolveMergeConflictsViaLlm({
        workspaceRoot: root,
        mergeMessage: message,
        harness: opts.mergeResolver,
        logDir: opts.resolverLogDir,
        expectedSharedFiles: opts.expectedSharedFiles,
      })
      if (resolution.ok) {
        // Resolver already staged with `git add -A`; just complete the merge.
        const commit = runGit(root, ["commit", "--no-edit"])
        if (commit.ok) return
      }
    }
    runGit(root, ["merge", "--abort"])
    throw new Error(`git: merge ${source} → ${target} failed: ${stderr}`)
  }
}

// Worktree management always operates against the primary checkout
// (mode.workspaceRoot): worktree add/remove is git's view of the repo as a
// whole, and the `from` branch is a ref reachable from any worktree. We
// deliberately bypass branchWorkspaceRoot so worktree lifecycle never depends
// on which worktree currently has HEAD.
function ensureManagedWorktree(mode: GitMode, branch: string, targetPath: string, from: string): string {
  const primary = mode.workspaceRoot
  if (!branchExists(primary, branch)) {
    if (!branchExists(primary, from)) {
      throw new Error(`git: cannot branch ${branch} from missing base ${from}`)
    }
    const create = runGit(primary, ["branch", branch, from])
    if (!create.ok) throw new Error(`git: create ${branch} from ${from} failed: ${create.stderr}`)
  }
  const existing = findWorktreeByPath(primary, targetPath)
  if (existing?.branch === branch) {
    if (currentBranch(targetPath) !== branch) {
      const co = runGit(targetPath, ["checkout", branch])
      if (!co.ok) throw new Error(`git: checkout ${branch} in worktree ${targetPath} failed: ${co.stderr}`)
    }
    return targetPath
  }
  if (existing) {
    const remove = runGit(primary, ["worktree", "remove", "--force", targetPath])
    if (!remove.ok) throw new Error(`git: remove stale worktree ${targetPath} failed: ${remove.stderr}`)
  } else if (existsSync(targetPath)) {
    rmSync(targetPath, { recursive: true, force: true })
  }
  // git refuses to put a branch in two worktrees, so an orphan worktree
  // from a prior failed run holding `branch` will block the add. Prune
  // first; then drop any live worktrees that still hold this branch.
  runGit(primary, ["worktree", "prune"])
  for (const entry of listWorktrees(primary)) {
    if (entry.branch === branch && resolve(entry.path) !== resolve(targetPath)) {
      const remove = runGit(primary, ["worktree", "remove", "--force", entry.path])
      if (!remove.ok) {
        throw new Error(
          `git: cannot reclaim ${branch} from stale worktree ${entry.path}: ${remove.stderr || remove.stdout}`,
        )
      }
    }
  }
  const add = runGit(primary, ["worktree", "add", "--force", targetPath, branch])
  if (!add.ok) throw new Error(`git: create worktree ${targetPath} for ${branch} failed: ${add.stderr || add.stdout}`)
  const actual = currentBranch(targetPath)
  if (actual !== branch) {
    throw new Error(`branch_gate: expected worktree ${targetPath} on ${branch}, but HEAD is ${actual || "<detached>"}`)
  }
  return targetPath
}

export function ensureItemBranch(mode: GitMode, context: WorkflowContext): string {
  const name = branchNameItem(context)
  ensureManagedWorktree(mode, name, mode.itemWorktreeRoot, mode.baseBranch)
  return name
}

export function ensureProjectBranch(mode: GitMode, context: WorkflowContext, projectId: string): string {
  const name = branchNameProject(context, projectId)
  ensureBranchFrom(mode, name, branchNameItem(context))
  return name
}

export function ensureWaveBranch(
  mode: GitMode,
  context: WorkflowContext,
  projectId: string,
  waveNumber: number,
): string {
  const name = branchNameWave(context, projectId, waveNumber)
  ensureBranchFrom(mode, name, branchNameProject(context, projectId))
  return name
}

export function ensureStoryBranch(
  mode: GitMode,
  context: WorkflowContext,
  projectId: string,
  waveNumber: number,
  storyId: string,
): string {
  const name = branchNameStory(context, projectId, waveNumber, storyId)
  ensureBranchFrom(mode, name, branchNameWave(context, projectId, waveNumber))
  return name
}

export function ensureStoryWorktree(
  mode: GitMode,
  context: WorkflowContext,
  projectId: string,
  waveNumber: number,
  storyId: string,
  worktreeRoot: string,
): string {
  const branch = branchNameStory(context, projectId, waveNumber, storyId)
  const canonicalPath = resolve(worktreeRoot)
  const legacyPath = resolve(layout.executionStoryLegacyWorktreeDir(context, waveNumber, storyId))
  if (legacyPath !== canonicalPath) {
    const legacy = findWorktreeByPath(mode.workspaceRoot, legacyPath)
    if (legacy?.branch === branch) removeStoryWorktree(mode, legacyPath)
  }
  return ensureManagedWorktree(mode, branch, canonicalPath, branchNameWave(context, projectId, waveNumber))
}

export function mergeStoryIntoWave(
  mode: GitMode,
  context: WorkflowContext,
  projectId: string,
  waveNumber: number,
  storyId: string,
  opts: GitMergeOptions = {},
): void {
  const wave = branchNameWave(context, projectId, waveNumber)
  const story = branchNameStory(context, projectId, waveNumber, storyId)
  mergeNoFf(mode, wave, story, `Merge story ${storyId} into wave ${waveNumber}`, opts)
}

export type RebaseStoryResult =
  | { ok: true }
  | { ok: false; reason: string }

/**
 * Rebase the story branch onto the current wave HEAD inside the story's
 * worktree. Used by the parallel-stories runtime (Fix 2) so a story
 * sees its sibling's merged scaffold before its next ralph iteration.
 *
 * On conflict, the rebase is aborted and `ok: false` is returned with a
 * `rebase_conflict_on:<paths>` reason — never auto-resolved by the LLM,
 * because the parallel path is already a riskier mode and the merge
 * resolver is the right tool for *integration*, not for in-flight
 * rebases that may still be mid-implementation.
 *
 * The story worktree is required: `git rebase` needs a working tree on
 * the story branch. Returns `{ ok: false, reason: "worktree_missing" }`
 * if the story doesn't have a managed worktree (which means the parallel
 * runtime path was misconfigured).
 */
export function rebaseStoryOntoWave(
  mode: GitMode,
  context: WorkflowContext,
  projectId: string,
  waveNumber: number,
  storyId: string,
): RebaseStoryResult {
  const storyBranch = branchNameStory(context, projectId, waveNumber, storyId)
  const waveBranch = branchNameWave(context, projectId, waveNumber)
  const primary = mode.workspaceRoot
  if (!branchExists(primary, storyBranch)) {
    return { ok: false, reason: "story_branch_missing" }
  }
  if (!branchExists(primary, waveBranch)) {
    return { ok: false, reason: "wave_branch_missing" }
  }
  // Locate the worktree currently holding the story branch. Rebase has to
  // run inside that worktree because git refuses to touch a branch checked
  // out elsewhere.
  const worktree = listWorktrees(primary).find(entry => entry.branch === storyBranch)
  if (!worktree) {
    return { ok: false, reason: "worktree_missing" }
  }
  // Fast-path: nothing to rebase if the story is already up-to-date with
  // wave HEAD (story has wave-tip as ancestor or vice versa with no story
  // commits). `git rebase` would no-op, but skipping the spawn keeps logs
  // quiet on the common "wave didn't move" case.
  const ancestor = runGit(worktree.path, ["merge-base", "--is-ancestor", waveBranch, storyBranch])
  if (ancestor.ok) return { ok: true }
  const rebase = runGit(worktree.path, ["rebase", waveBranch])
  if (rebase.ok) return { ok: true }
  // Capture conflicting paths before aborting; once we abort, the index
  // resets and `diff --name-only --diff-filter=U` returns nothing.
  const conflictPaths = runGit(worktree.path, ["diff", "--name-only", "--diff-filter=U"])
  const paths = conflictPaths.ok && conflictPaths.stdout
    ? conflictPaths.stdout.split(/\r?\n/).filter(Boolean).join(",")
    : "<unknown>"
  runGit(worktree.path, ["rebase", "--abort"])
  return { ok: false, reason: `rebase_conflict_on:${paths}` }
}

export function mergeWaveIntoProject(
  mode: GitMode,
  context: WorkflowContext,
  projectId: string,
  waveNumber: number,
  opts: GitMergeOptions = {},
): void {
  const project = branchNameProject(context, projectId)
  const wave = branchNameWave(context, projectId, waveNumber)
  mergeNoFf(mode, project, wave, `Merge wave ${waveNumber} into project ${projectId}`, opts)
}

export function mergeProjectIntoItem(
  mode: GitMode,
  context: WorkflowContext,
  projectId: string,
  opts: GitMergeOptions = {},
): void {
  const item = branchNameItem(context)
  const project = branchNameProject(context, projectId)
  mergeNoFf(mode, item, project, `Merge project ${projectId} into item`, opts)
}

export function mergeItemIntoBase(
  mode: GitMode,
  context: WorkflowContext,
): { mergeSha: string } {
  const item = branchNameItem(context)
  const root = mode.workspaceRoot
  if (!branchExists(root, item)) {
    throw new Error(`git: item branch ${item} does not exist`)
  }
  const ancestor = runGit(root, ["merge-base", "--is-ancestor", item, mode.baseBranch])
  if (ancestor.ok) {
    const mergeSha = runGit(root, ["rev-parse", mode.baseBranch]).stdout
    return { mergeSha }
  }
  const checkout = runGit(root, ["checkout", mode.baseBranch])
  if (!checkout.ok) throw new Error(`git: checkout ${mode.baseBranch} failed: ${checkout.stderr || checkout.stdout}`)
  const merge = runGit(root, ["merge", "--no-ff", "-m", `Merge item ${context.itemSlug ?? "item"} into ${mode.baseBranch}`, item])
  if (!merge.ok) {
    const stderr = merge.stderr || merge.stdout
    runGit(root, ["merge", "--abort"])
    throw new Error(`git: merge ${item} → ${mode.baseBranch} failed: ${stderr}`)
  }
  const mergeSha = runGit(root, ["rev-parse", "HEAD"]).stdout
  if (!mergeSha) throw new Error("git: could not resolve merge commit sha")
  return { mergeSha }
}

export function exitRunToItemBranch(mode: GitMode, context: WorkflowContext): string {
  const item = branchNameItem(context)
  const root = branchWorkspaceRoot(mode)
  if (!branchExists(root, item)) {
    throw new Error(`branch_gate: cannot exit run because item branch ${item} does not exist`)
  }
  const co = runGit(root, ["checkout", item])
  if (!co.ok) throw new Error(`git: checkout ${item} on run exit failed: ${co.stderr}`)
  assertActiveBranch(mode, item, `exiting run to item branch ${item}`)
  return item
}

export function abandonStoryBranch(
  mode: GitMode,
  context: WorkflowContext,
  projectId: string,
  waveNumber: number,
  storyId: string,
): { abandonedRef: string } | null {
  const root = branchWorkspaceRoot(mode)
  const branch = branchNameStory(context, projectId, waveNumber, storyId)
  if (!branchExists(root, branch)) return null
  // Move to a namespaced ref so the branch disappears from `git branch` but
  // remains recoverable. Timestamp prevents collisions on repeat abandons.
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-")
  const abandonedRef = `refs/beerengineer/abandoned/${branch}/${stamp}`
  const sha = runGit(root, ["rev-parse", `refs/heads/${branch}`])
  if (!sha.ok || !sha.stdout) return null
  // If we're currently on the branch, park the item worktree on the item
  // branch (the natural resting state for item-scoped execution) and only
  // fall back to base when the item branch has not yet been created — for
  // example when abandonment happens before `ensureItemBranch`.
  if (currentBranch(root) === branch) {
    const parkBranch = branchNameItem(context)
    if (branchExists(root, parkBranch)) {
      runGit(root, ["checkout", parkBranch])
    } else if (branchExists(root, mode.baseBranch)) {
      runGit(root, ["checkout", mode.baseBranch])
    }
  }
  const update = runGit(root, ["update-ref", abandonedRef, sha.stdout])
  if (!update.ok) return null
  const del = runGit(root, ["branch", "-D", branch])
  if (!del.ok) {
    // Roll back the namespaced ref if the branch delete failed, so we don't
    // leave duplicates pointing at the same commit.
    runGit(root, ["update-ref", "-d", abandonedRef])
    return null
  }
  return { abandonedRef }
}

/**
 * Stage every change in `worktreePath` and commit with `message`.
 * Returns the new commit SHA on success, or `null` when the tree is already
 * clean (no-op path — idempotent, safe to call unconditionally).
 *
 * Intended for callers that modify files in a managed worktree (e.g. the
 * setup-task short-circuit in the execution stage) but do not go through the
 * ralph coder harness which has its own commit step.
 */
export function commitAll(worktreePath: string, message: string): string | null {
  const inside = runGit(worktreePath, ["rev-parse", "--is-inside-work-tree"])
  if (!inside.ok || inside.stdout !== "true") return null
  // Short-circuit when the tree is clean — avoids a spurious "nothing to commit" error.
  const status = runGit(worktreePath, ["status", "--porcelain"])
  if (!status.ok || !status.stdout) return null
  const add = runGit(worktreePath, ["add", "-A"])
  if (!add.ok) return null
  const commit = runGit(worktreePath, ["commit", "-m", message])
  if (!commit.ok) return null
  const sha = runGit(worktreePath, ["rev-parse", "HEAD"])
  return sha.ok ? sha.stdout : null
}

// Re-export so callers that only reach for real-git helpers still get a single entry point.
export { isEngineOwnedBranchName }

export function removeStoryWorktree(mode: GitMode, worktreeRoot: string): void {
  const targetPath = resolve(worktreeRoot)
  const existing = findWorktreeByPath(mode.workspaceRoot, targetPath)
  if (!existing) {
    if (existsSync(targetPath)) rmSync(targetPath, { recursive: true, force: true })
    return
  }
  const remove = runGit(mode.workspaceRoot, ["worktree", "remove", "--force", targetPath])
  if (!remove.ok) throw new Error(`git: remove worktree ${targetPath} failed: ${remove.stderr || remove.stdout}`)
}

export function gcManagedStoryWorktrees(mode: GitMode, managedRoot: string): ManagedWorktreeGcResult {
  const managedPaths = collectManagedWorktreePaths(managedRoot)
  const live = new Map(listWorktrees(mode.workspaceRoot).map(entry => [entry.path, entry]))
  const result: ManagedWorktreeGcResult = { removed: [], kept: [] }
  const duplicatePathsToRemove = new Set<string>()
  const liveManagedByBranch = new Map<string, string[]>()

  for (const path of managedPaths) {
    const entry = live.get(path)
    if (!entry?.branch) continue
    const paths = liveManagedByBranch.get(entry.branch) ?? []
    paths.push(path)
    liveManagedByBranch.set(entry.branch, paths)
  }

  for (const paths of liveManagedByBranch.values()) {
    if (paths.length < 2) continue
    const sorted = [...paths].sort((left, right) => {
      const canonicalDelta = Number(isCanonicalManagedWorktreePath(right)) - Number(isCanonicalManagedWorktreePath(left))
      if (canonicalDelta !== 0) return canonicalDelta
      return left.localeCompare(right)
    })
    for (const stale of sorted.slice(1)) duplicatePathsToRemove.add(stale)
  }

  for (const path of managedPaths) {
    if (duplicatePathsToRemove.has(path)) {
      removeStoryWorktree(mode, path)
      result.removed.push(path)
      continue
    }
    const entry = live.get(path)
    if (!entry) {
      rmSync(path, { recursive: true, force: true })
      result.removed.push(path)
      continue
    }
    if (!entry.branch) {
      removeStoryWorktree(mode, path)
      result.removed.push(path)
      continue
    }
    if (branchExists(mode.workspaceRoot, entry.branch)) {
      result.kept.push({ path, reason: `branch ${entry.branch} still exists` })
      continue
    }
    removeStoryWorktree(mode, path)
    result.removed.push(path)
  }

  return result
}
