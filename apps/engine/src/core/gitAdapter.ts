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
  mergeProjectIntoItem,
  mergeStoryIntoWave,
  mergeWaveIntoProject,
  removeStoryWorktree,
  type ManagedWorktreeGcResult,
  type GitMode,
  type GitMergeOptions,
} from "./git.js"

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
