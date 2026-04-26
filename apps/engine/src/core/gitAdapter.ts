/**
 * Adapter that wraps the realGit.ts module behind a method-based interface.
 *
 * Why this exists: `realGit.ts` exposes a flat catalog of free functions
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
  abandonStoryBranchReal,
  assertWorkspaceRootOnBaseBranch as assertWorkspaceRootOnBaseBranchReal,
  detectRealGitMode,
  ensureItemBranchReal,
  ensureProjectBranchReal,
  ensureStoryBranchReal,
  ensureStoryWorktreeReal,
  ensureWaveBranchReal,
  exitRunToItemBranchReal,
  gcManagedStoryWorktreesReal,
  mergeProjectIntoItemReal,
  mergeStoryIntoWaveReal,
  mergeWaveIntoProjectReal,
  removeStoryWorktreeReal,
  type ManagedWorktreeGcResult,
  type RealGitEnabled,
  type RealGitMergeOptions,
} from "./realGit.js"

export interface GitAdapter {
  /** Underlying mode descriptor — enabled real-git only. */
  readonly mode: RealGitEnabled
  /** Always `true`; preserved for legacy call sites. */
  readonly enabled: true

  // ---------- item / project branches ----------
  /** Create the per-item branch + worktree. */
  ensureItemBranch(): void
  /** Create the per-project branch (off the item branch). */
  ensureProjectBranch(projectId: string): void
  /** Merge the per-project branch back into the item branch. */
  mergeProjectIntoItem(projectId: string, opts?: RealGitMergeOptions): void

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
    opts?: RealGitMergeOptions,
  ): void
  mergeWaveIntoProject(
    projectId: string,
    waveNumber: number,
    opts?: RealGitMergeOptions,
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
 * workspace cannot be resolved into an enabled real-git mode.
 */
export function createGitAdapter(context: WorkflowContext): GitAdapter {
  return createGitAdapterFromMode(context, detectRealGitMode(context))
}

export function createGitAdapterFromMode(
  context: WorkflowContext,
  mode: RealGitEnabled,
): GitAdapter {
  return {
    mode,
    enabled: true,

    ensureItemBranch() {
      ensureItemBranchReal(mode, context)
    },
    ensureProjectBranch(projectId: string) {
      ensureProjectBranchReal(mode, context, projectId)
    },
    mergeProjectIntoItem(projectId: string, opts: RealGitMergeOptions = {}) {
      mergeProjectIntoItemReal(mode, context, projectId, opts)
    },

    ensureWaveBranch(projectId, waveNumber) {
      return ensureWaveBranchReal(mode, context, projectId, waveNumber)
    },
    ensureStoryBranch(projectId, waveNumber, storyId) {
      return ensureStoryBranchReal(mode, context, projectId, waveNumber, storyId)
    },
    ensureStoryWorktree(projectId, waveNumber, storyId, worktreeRoot) {
      return ensureStoryWorktreeReal(mode, context, projectId, waveNumber, storyId, worktreeRoot)
    },
    mergeStoryIntoWave(projectId, waveNumber, storyId, opts = {}) {
      mergeStoryIntoWaveReal(mode, context, projectId, waveNumber, storyId, opts)
    },
    mergeWaveIntoProject(projectId, waveNumber, opts = {}) {
      mergeWaveIntoProjectReal(mode, context, projectId, waveNumber, opts)
    },
    abandonStoryBranch(projectId, waveNumber, storyId) {
      return abandonStoryBranchReal(mode, context, projectId, waveNumber, storyId)
    },
    removeStoryWorktree(worktreeRoot) {
      removeStoryWorktreeReal(mode, worktreeRoot)
    },

    exitRunToItemBranch() {
      return exitRunToItemBranchReal(mode, context)
    },
    assertWorkspaceRootOnBaseBranch(label: string) {
      assertWorkspaceRootOnBaseBranchReal(mode, label)
    },

    gcManagedStoryWorktrees(managedRoot) {
      return gcManagedStoryWorktreesReal(mode, managedRoot)
    },
  }
}
