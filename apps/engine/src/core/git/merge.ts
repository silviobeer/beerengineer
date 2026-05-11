import type { WorkflowContext } from "../workspaceLayout.js"
import {
  branchNameItem,
  branchNameProject,
  branchNameStory,
  branchNameWave,
} from "../branchNames.js"
import { resolveMergeConflictsViaLlmAsync } from "../mergeResolver.js"
import { stagePresent } from "../stagePresentation.js"
import { type GitMergeOptions, type GitMode, branchExists, itemRoot, runGit } from "./shared.js"
import { assertActiveBranch } from "./inspect.js"
import { listWorktrees } from "./worktrees.js"

export type RebaseStoryResult = { ok: true } | { ok: false; reason: string }

type MergeBranchOptions = GitMergeOptions & {
  // Override the working root. Defaults to `mode.itemWorktreeRoot`.
  // `mergeItemIntoBase` overrides it to `mode.workspaceRoot` because the
  // item-to-base merge is the final step that lands changes on the user's
  // primary checkout.
  root?: string
}

export class GitMergeConflictError extends Error {
  readonly conflictedPaths: string[]
  readonly gitMessage: string

  constructor(conflictedPaths: string[], gitMessage: string) {
    super(`git merge conflict: ${conflictedPaths.join(", ") || "<unknown>"}`)
    this.name = "GitMergeConflictError"
    this.conflictedPaths = conflictedPaths
    this.gitMessage = gitMessage
  }
}

function tipSha(root: string, ref: string): string {
  return runGit(root, ["rev-parse", ref]).stdout
}

function listConflictedPaths(root: string): string[] {
  const result = runGit(root, ["diff", "--name-only", "--diff-filter=U"])
  if (!result.ok || !result.stdout) return []
  return result.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
}

function hasPendingMerge(root: string): boolean {
  return runGit(root, ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"]).ok
}

function tryFinishGitResolvedMerge(root: string): boolean {
  if (!hasPendingMerge(root)) return false
  return runGit(root, ["commit", "--no-edit"]).ok
}

function tryResolveAndCommit(
  root: string,
  message: string,
  opts: MergeBranchOptions,
  stderr: string,
): boolean {
  if (!opts.mergeResolver) return false
  if (!/CONFLICT|Automatic merge failed/i.test(stderr)) return false
  stagePresent.warn("merge-resolver skipped on synchronous merge path; use the async GitAdapter merge methods")
  return false
}

async function tryResolveAndCommitAsync(
  root: string,
  message: string,
  opts: MergeBranchOptions,
  stderr: string,
): Promise<boolean> {
  if (!opts.mergeResolver) return false
  if (!/CONFLICT|Automatic merge failed/i.test(stderr)) return false
  const resolution = await resolveMergeConflictsViaLlmAsync({
    workspaceRoot: root,
    mergeMessage: message,
    harness: opts.mergeResolver,
    logDir: opts.resolverLogDir,
    expectedSharedFiles: opts.expectedSharedFiles,
  })
  if (!resolution.ok) return false
  // Resolver already staged with `git add -A`; just complete the merge.
  return runGit(root, ["commit", "--no-edit"]).ok
}

/**
 * Generic --no-ff merge of `source` into `target`. Single workhorse for all
 * four levels (story→wave, wave→project, project→item, item→base).
 *
 * Returns the merge commit SHA. Throws on unresolved conflict.
 */
function mergeBranchInto(
  mode: GitMode,
  target: string,
  source: string,
  message: string,
  opts: MergeBranchOptions = {},
): { mergeSha: string } {
  const root = opts.root ?? itemRoot(mode)
  const co = runGit(root, ["checkout", target])
  if (!co.ok) throw new Error(`git: checkout ${target} for merge failed: ${co.stderr || co.stdout}`)
  if (root === itemRoot(mode)) assertActiveBranch(mode, target, `checking out merge target ${target}`)
  const head = tipSha(root, "HEAD")
  const sourceHead = tipSha(root, source)
  if (head && head === sourceHead) return { mergeSha: head }
  const ancestor = runGit(root, ["merge-base", "--is-ancestor", source, target])
  if (ancestor.ok) return { mergeSha: tipSha(root, target) }
  const merge = runGit(root, ["merge", "--no-ff", "-m", message, source])
  if (merge.ok) return { mergeSha: tipSha(root, "HEAD") }
  const stderr = merge.stderr || merge.stdout
  if (tryResolveAndCommit(root, message, opts, stderr)) return { mergeSha: tipSha(root, "HEAD") }
  const conflictedPaths = listConflictedPaths(root)
  if (conflictedPaths.length === 0 && tryFinishGitResolvedMerge(root)) return { mergeSha: tipSha(root, "HEAD") }
  runGit(root, ["merge", "--abort"])
  if (conflictedPaths.length > 0) {
    throw new GitMergeConflictError(conflictedPaths, stderr)
  }
  throw new Error(`git: merge ${source} → ${target} failed: ${stderr}`)
}

async function mergeBranchIntoAsync(
  mode: GitMode,
  target: string,
  source: string,
  message: string,
  opts: MergeBranchOptions = {},
): Promise<{ mergeSha: string }> {
  const root = opts.root ?? itemRoot(mode)
  const co = runGit(root, ["checkout", target])
  if (!co.ok) throw new Error(`git: checkout ${target} for merge failed: ${co.stderr || co.stdout}`)
  if (root === itemRoot(mode)) assertActiveBranch(mode, target, `checking out merge target ${target}`)
  const head = tipSha(root, "HEAD")
  const sourceHead = tipSha(root, source)
  if (head && head === sourceHead) return { mergeSha: head }
  const ancestor = runGit(root, ["merge-base", "--is-ancestor", source, target])
  if (ancestor.ok) return { mergeSha: tipSha(root, target) }
  const merge = runGit(root, ["merge", "--no-ff", "-m", message, source])
  if (merge.ok) return { mergeSha: tipSha(root, "HEAD") }
  const stderr = merge.stderr || merge.stdout
  if (await tryResolveAndCommitAsync(root, message, opts, stderr)) return { mergeSha: tipSha(root, "HEAD") }
  const conflictedPaths = listConflictedPaths(root)
  if (conflictedPaths.length === 0 && tryFinishGitResolvedMerge(root)) return { mergeSha: tipSha(root, "HEAD") }
  runGit(root, ["merge", "--abort"])
  if (conflictedPaths.length > 0) {
    throw new GitMergeConflictError(conflictedPaths, stderr)
  }
  throw new Error(`git: merge ${source} → ${target} failed: ${stderr}`)
}

export function mergeStoryIntoWave(
  mode: GitMode,
  context: WorkflowContext,
  projectId: string,
  waveNumber: number,
  storyId: string,
  opts: GitMergeOptions = {},
): void {
  mergeBranchInto(
    mode,
    branchNameWave(context, projectId, waveNumber),
    branchNameStory(context, projectId, waveNumber, storyId),
    `Merge story ${storyId} into wave ${waveNumber}`,
    opts,
  )
}

export async function mergeStoryIntoWaveAsync(
  mode: GitMode,
  context: WorkflowContext,
  projectId: string,
  waveNumber: number,
  storyId: string,
  opts: GitMergeOptions = {},
): Promise<void> {
  await mergeBranchIntoAsync(
    mode,
    branchNameWave(context, projectId, waveNumber),
    branchNameStory(context, projectId, waveNumber, storyId),
    `Merge story ${storyId} into wave ${waveNumber}`,
    opts,
  )
}

export function mergeWaveIntoProject(
  mode: GitMode,
  context: WorkflowContext,
  projectId: string,
  waveNumber: number,
  opts: GitMergeOptions = {},
): void {
  mergeBranchInto(
    mode,
    branchNameProject(context, projectId),
    branchNameWave(context, projectId, waveNumber),
    `Merge wave ${waveNumber} into project ${projectId}`,
    opts,
  )
}

export async function mergeWaveIntoProjectAsync(
  mode: GitMode,
  context: WorkflowContext,
  projectId: string,
  waveNumber: number,
  opts: GitMergeOptions = {},
): Promise<void> {
  await mergeBranchIntoAsync(
    mode,
    branchNameProject(context, projectId),
    branchNameWave(context, projectId, waveNumber),
    `Merge wave ${waveNumber} into project ${projectId}`,
    opts,
  )
}

export function mergeProjectIntoItem(
  mode: GitMode,
  context: WorkflowContext,
  projectId: string,
  opts: GitMergeOptions = {},
): void {
  mergeBranchInto(
    mode,
    branchNameItem(context),
    branchNameProject(context, projectId),
    `Merge project ${projectId} into item`,
    opts,
  )
}

export function mergeItemIntoBase(mode: GitMode, context: WorkflowContext): { mergeSha: string } {
  const item = branchNameItem(context)
  if (!branchExists(mode.workspaceRoot, item)) {
    throw new Error(`git: item branch ${item} does not exist`)
  }
  return mergeBranchInto(
    mode,
    mode.baseBranch,
    item,
    `Merge item ${context.itemSlug ?? "item"} into ${mode.baseBranch}`,
    { root: mode.workspaceRoot },
  )
}

/**
 * Rebase the story branch onto the current wave HEAD inside the story's
 * worktree. On conflict, abort and return `ok: false` — never auto-resolve,
 * because the parallel path is riskier and the merge resolver is the right
 * tool for *integration*, not for in-flight rebases that may still be
 * mid-implementation.
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
  if (!branchExists(primary, storyBranch)) return { ok: false, reason: "story_branch_missing" }
  if (!branchExists(primary, waveBranch)) return { ok: false, reason: "wave_branch_missing" }
  // Rebase has to run inside the worktree currently holding the story branch
  // — git refuses to touch a branch checked out elsewhere.
  const worktree = listWorktrees(primary).find(entry => entry.branch === storyBranch)
  if (!worktree) return { ok: false, reason: "worktree_missing" }
  // Fast-path: skip when story already has wave-tip as ancestor; keeps logs
  // quiet on the common "wave didn't move" case.
  if (runGit(worktree.path, ["merge-base", "--is-ancestor", waveBranch, storyBranch]).ok) {
    return { ok: true }
  }
  const rebase = runGit(worktree.path, ["rebase", waveBranch])
  if (rebase.ok) return { ok: true }
  // Capture conflicting paths before aborting; `--diff-filter=U` returns
  // nothing once the index resets.
  const conflictPaths = runGit(worktree.path, ["diff", "--name-only", "--diff-filter=U"])
  const paths =
    conflictPaths.ok && conflictPaths.stdout
      ? conflictPaths.stdout.split(/\r?\n/).filter(Boolean).join(",")
      : "<unknown>"
  runGit(worktree.path, ["rebase", "--abort"])
  return { ok: false, reason: `rebase_conflict_on:${paths}` }
}
