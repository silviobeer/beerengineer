/**
 * Adapter that wraps the realGit.ts module behind a method-based interface.
 *
 * Why this exists: `realGit.ts` exposes a flat catalog of free functions
 * that callers had to gate with `if (mode.enabled) ensureXxx(mode, ctx)`.
 * That coupling — plus a reliance on a module-level singleton — made the
 * orchestrator hard to test and impossible to swap out.
 *
 * `GitAdapter` is constructed once (via {@link createGitAdapter}), captures
 * the resolved {@link RealGitMode} internally, and exposes intent-level
 * methods. Methods are no-ops in simulated mode unless their semantics
 * require an explicit divergence (caller checks `git.enabled` only when
 * the *behaviour* differs, not when the *call should be skipped*).
 *
 * Now covers the full surface used by both the orchestrator and the
 * execution stage (waves, stories, worktrees, GC).
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
  type RealGitMergeOptions,
  type RealGitMode,
} from "./realGit.js"

export interface GitAdapter {
  /** Underlying mode descriptor — exposed so callers can inspect `enabled`/`reason`/`baseBranch` for branch-divergent UX. */
  readonly mode: RealGitMode
  /** Convenience flag: `mode.enabled`. */
  readonly enabled: boolean

  // ---------- item / project branches ----------
  /** Create the per-item branch + worktree if real git is on. No-op otherwise. */
  ensureItemBranch(): void
  /** Create the per-project branch (off the item branch) if real git is on. No-op otherwise. */
  ensureProjectBranch(projectId: string): void
  /** Merge the per-project branch back into the item branch. No-op otherwise. */
  mergeProjectIntoItem(projectId: string, opts?: RealGitMergeOptions): void

  // ---------- wave / story branches ----------
  /** Create the per-wave branch under the project branch. Returns the branch name, or `null` when disabled. */
  ensureWaveBranch(projectId: string, waveNumber: number): string | null
  /** Create the per-story branch under the wave. Returns the branch name, or `null` when disabled. */
  ensureStoryBranch(projectId: string, waveNumber: number, storyId: string): string | null
  /** Create or attach a story worktree. Returns the worktree root, or `null` when disabled. */
  ensureStoryWorktree(
    projectId: string,
    waveNumber: number,
    storyId: string,
    worktreeRoot: string,
  ): string | null
  /** Merge the story branch into its wave branch. No-op when disabled. */
  mergeStoryIntoWave(
    projectId: string,
    waveNumber: number,
    storyId: string,
    opts?: RealGitMergeOptions,
  ): void
  /** Merge the wave branch into its project branch. No-op when disabled. */
  mergeWaveIntoProject(
    projectId: string,
    waveNumber: number,
    opts?: RealGitMergeOptions,
  ): void
  /** Move the story branch to a namespaced abandoned ref. Returns `null` when disabled or nothing to abandon. */
  abandonStoryBranch(
    projectId: string,
    waveNumber: number,
    storyId: string,
  ): { abandonedRef: string } | null
  /** Remove a story worktree. No-op when disabled. */
  removeStoryWorktree(worktreeRoot: string): void

  // ---------- run lifecycle ----------
  /** At end-of-run, return the workspace to the item branch. No-op when disabled; returns `null` then. */
  exitRunToItemBranch(): string | null
  /** Defensive check: workspace root must be parked on the base branch. No-op when disabled. */
  assertWorkspaceRootOnBaseBranch(label: string): void

  // ---------- maintenance ----------
  /** Garbage-collect leftover story worktrees in the managed root. Returns `null` when disabled. */
  gcManagedStoryWorktrees(managedRoot: string): ManagedWorktreeGcResult | null
}

/**
 * Build a {@link GitAdapter} for the given context. The underlying
 * `RealGitMode` is detected once at construction time; subsequent calls
 * use the captured mode without re-probing the filesystem. Tests can
 * substitute `createGitAdapterFromMode` when they want to inject a
 * pre-baked mode.
 */
export function createGitAdapter(context: WorkflowContext): GitAdapter {
  return createGitAdapterFromMode(context, detectRealGitMode(context))
}

export function createGitAdapterFromMode(
  context: WorkflowContext,
  mode: RealGitMode,
): GitAdapter {
  return {
    mode,
    get enabled() {
      return mode.enabled
    },

    ensureItemBranch() {
      if (!mode.enabled) return
      ensureItemBranchReal(mode, context)
    },
    ensureProjectBranch(projectId: string) {
      if (!mode.enabled) return
      ensureProjectBranchReal(mode, context, projectId)
    },
    mergeProjectIntoItem(projectId: string, opts: RealGitMergeOptions = {}) {
      if (!mode.enabled) return
      mergeProjectIntoItemReal(mode, context, projectId, opts)
    },

    ensureWaveBranch(projectId, waveNumber) {
      if (!mode.enabled) return null
      return ensureWaveBranchReal(mode, context, projectId, waveNumber)
    },
    ensureStoryBranch(projectId, waveNumber, storyId) {
      if (!mode.enabled) return null
      return ensureStoryBranchReal(mode, context, projectId, waveNumber, storyId)
    },
    ensureStoryWorktree(projectId, waveNumber, storyId, worktreeRoot) {
      if (!mode.enabled) return null
      return ensureStoryWorktreeReal(mode, context, projectId, waveNumber, storyId, worktreeRoot)
    },
    mergeStoryIntoWave(projectId, waveNumber, storyId, opts = {}) {
      if (!mode.enabled) return
      mergeStoryIntoWaveReal(mode, context, projectId, waveNumber, storyId, opts)
    },
    mergeWaveIntoProject(projectId, waveNumber, opts = {}) {
      if (!mode.enabled) return
      mergeWaveIntoProjectReal(mode, context, projectId, waveNumber, opts)
    },
    abandonStoryBranch(projectId, waveNumber, storyId) {
      if (!mode.enabled) return null
      return abandonStoryBranchReal(mode, context, projectId, waveNumber, storyId)
    },
    removeStoryWorktree(worktreeRoot) {
      if (!mode.enabled) return
      removeStoryWorktreeReal(mode, worktreeRoot)
    },

    exitRunToItemBranch() {
      if (!mode.enabled) return null
      return exitRunToItemBranchReal(mode, context)
    },
    assertWorkspaceRootOnBaseBranch(label: string) {
      if (!mode.enabled) return
      assertWorkspaceRootOnBaseBranchReal(mode, label)
    },

    gcManagedStoryWorktrees(managedRoot) {
      if (!mode.enabled) return null
      return gcManagedStoryWorktreesReal(mode, managedRoot)
    },
  }
}
