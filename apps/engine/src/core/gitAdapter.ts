/**
 * Adapter that wraps the git.ts module behind a method-based interface.
 *
 * Why this exists: `git.ts` exposes a flat catalog of free functions
 * that callers had to thread the resolved mode through. The adapter
 * captures the mode once and exposes intent-level methods so call sites
 * stop touching the underlying free functions.
 *
 * Real-git is the only mode (simulation has been removed). The `enabled`
 * flag is preserved on the interface for backwards-compatibility with a
 * handful of callers that still inspect it; it is always `true`.
 */

import type { WorkflowContext } from "./workspaceLayout.js"
import {
  abandonStoryBranch,
  assertWorkspaceRootOnBaseBranch as assertWorkspaceRootOnBaseBranchReal,
  detectGitMode,
  ensureItemBranch,
  ensureProjectBranch,
  ensureStoryBranch,
  ensureStoryWorktree,
  ensureWaveBranch,
  exitRunToItemBranch,
  gcManagedStoryWorktrees,
  mergeItemIntoBase,
  mergeProjectIntoItem,
  mergeStoryIntoWave,
  mergeWaveIntoProject,
  rebaseStoryOntoWave,
  removeStoryWorktree,
  type ManagedWorktreeGcResult,
  type GitMode,
  type GitMergeOptions,
  type RebaseStoryResult,
} from "./git.js"

export type { RebaseStoryResult } from "./git.js"

export interface GitAdapter {
  /** Underlying mode descriptor — enabled real-git only. */
  readonly mode: GitMode
  /** Always `true`; preserved for legacy call sites. */
  readonly enabled: true

  // ---------- item / project branches ----------
  /** Create the per-item branch + worktree. */
  ensureItemBranch(): void
  /** Create the per-project branch (off the item branch). */
  ensureProjectBranch(projectId: string): void
  /** Merge the per-project branch back into the item branch. */
  mergeProjectIntoItem(projectId: string, opts?: GitMergeOptions): void
  /** Merge the per-item branch back into the base branch. */
  mergeItemIntoBase(): { mergeSha: string }

  // ---------- wave / story branches ----------
  ensureWaveBranch(projectId: string, waveNumber: number): string
  ensureStoryBranch(projectId: string, waveNumber: number, storyId: string): string
  ensureStoryWorktree(
    projectId: string,
    waveNumber: number,
    storyId: string,
    worktreeRoot: string,
  ): string
  mergeStoryIntoWave(
    projectId: string,
    waveNumber: number,
    storyId: string,
    opts?: GitMergeOptions,
  ): void
  mergeWaveIntoProject(
    projectId: string,
    waveNumber: number,
    opts?: GitMergeOptions,
  ): void
  /**
   * Rebase a story branch onto its wave HEAD inside the story worktree.
   * Used by the parallel-stories runtime to keep in-flight stories aligned
   * with newly merged siblings. Returns `{ ok: false, reason }` on conflict
   * — caller decides whether to abandon the story.
   */
  rebaseStoryOntoWave(
    projectId: string,
    waveNumber: number,
    storyId: string,
  ): RebaseStoryResult
  abandonStoryBranch(
    projectId: string,
    waveNumber: number,
    storyId: string,
  ): { abandonedRef: string } | null
  removeStoryWorktree(worktreeRoot: string): void

  // ---------- run lifecycle ----------
  exitRunToItemBranch(): string
  assertWorkspaceRootOnBaseBranch(label: string): void

  // ---------- maintenance ----------
  gcManagedStoryWorktrees(managedRoot: string): ManagedWorktreeGcResult
}

/**
 * Build a {@link GitAdapter} for the given context. Throws if the
 * workspace cannot be resolved into an enabled git mode.
 *
 * **Lifecycle**: an adapter instance is constructed once per
 * `runWorkflow` invocation and threaded through every stage. The
 * resolved {@link GitMode} (workspaceRoot, baseBranch, itemWorktreeRoot)
 * is captured at construction; the adapter does NOT re-probe the
 * filesystem on each method call. If anything outside the engine
 * mutates the underlying repository's state mid-run (e.g. an operator
 * checks out a different branch in the primary worktree), the captured
 * mode goes stale. {@link GitAdapter#assertWorkspaceRootOnBaseBranch}
 * exists to detect and fail fast on the most dangerous variant of that.
 *
 * Tests should construct via {@link createGitAdapterFromMode} so they
 * can supply a synthetic mode without a real filesystem probe.
 */
export function createGitAdapter(context: WorkflowContext): GitAdapter {
  return createGitAdapterFromMode(context, detectGitMode(context))
}

export function createGitAdapterFromMode(
  context: WorkflowContext,
  mode: GitMode,
): GitAdapter {
  return {
    mode,
    enabled: true,

    ensureItemBranch() {
      ensureItemBranch(mode, context)
    },
    ensureProjectBranch(projectId: string) {
      ensureProjectBranch(mode, context, projectId)
    },
    mergeProjectIntoItem(projectId: string, opts: GitMergeOptions = {}) {
      mergeProjectIntoItem(mode, context, projectId, opts)
    },
    mergeItemIntoBase() {
      return mergeItemIntoBase(mode, context)
    },

    ensureWaveBranch(projectId, waveNumber) {
      return ensureWaveBranch(mode, context, projectId, waveNumber)
    },
    ensureStoryBranch(projectId, waveNumber, storyId) {
      return ensureStoryBranch(mode, context, projectId, waveNumber, storyId)
    },
    ensureStoryWorktree(projectId, waveNumber, storyId, worktreeRoot) {
      return ensureStoryWorktree(mode, context, projectId, waveNumber, storyId, worktreeRoot)
    },
    mergeStoryIntoWave(projectId, waveNumber, storyId, opts = {}) {
      mergeStoryIntoWave(mode, context, projectId, waveNumber, storyId, opts)
    },
    mergeWaveIntoProject(projectId, waveNumber, opts = {}) {
      mergeWaveIntoProject(mode, context, projectId, waveNumber, opts)
    },
    rebaseStoryOntoWave(projectId, waveNumber, storyId) {
      return rebaseStoryOntoWave(mode, context, projectId, waveNumber, storyId)
    },
    abandonStoryBranch(projectId, waveNumber, storyId) {
      return abandonStoryBranch(mode, context, projectId, waveNumber, storyId)
    },
    removeStoryWorktree(worktreeRoot) {
      removeStoryWorktree(mode, worktreeRoot)
    },

    exitRunToItemBranch() {
      return exitRunToItemBranch(mode, context)
    },
    assertWorkspaceRootOnBaseBranch(label: string) {
      assertWorkspaceRootOnBaseBranchReal(mode, label)
    },

    gcManagedStoryWorktrees(managedRoot) {
      return gcManagedStoryWorktrees(mode, managedRoot)
    },
  }
}
