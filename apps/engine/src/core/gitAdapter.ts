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
 * Phase 3 wires this through `runWorkflow`. Execution stage and the
 * top-level CLI keep using the underlying free functions for now —
 * migrating those is a follow-up that will broaden the interface.
 */

import type { WorkflowContext } from "./workspaceLayout.js"
import {
  assertWorkspaceRootOnBaseBranch as assertWorkspaceRootOnBaseBranchReal,
  detectRealGitMode,
  ensureItemBranchReal,
  ensureProjectBranchReal,
  exitRunToItemBranchReal,
  mergeProjectIntoItemReal,
  type RealGitMode,
} from "./realGit.js"

export interface GitAdapter {
  /** Underlying mode descriptor — exposed so callers can inspect `enabled`/`reason`/`baseBranch` for branch-divergent UX. */
  readonly mode: RealGitMode
  /** Convenience flag: `mode.enabled`. */
  readonly enabled: boolean
  /** Create the per-item branch + worktree if real git is on. No-op otherwise. */
  ensureItemBranch(): void
  /** Create the per-project branch (off the item branch) if real git is on. No-op otherwise. */
  ensureProjectBranch(projectId: string): void
  /** Merge the per-project branch back into the item branch. No-op otherwise. */
  mergeProjectIntoItem(projectId: string): void
  /** At end-of-run, return the workspace to the item branch. No-op when disabled; returns `null` then. */
  exitRunToItemBranch(): string | null
  /** Defensive check: workspace root must be parked on the base branch. No-op when disabled. */
  assertWorkspaceRootOnBaseBranch(label: string): void
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
    mergeProjectIntoItem(projectId: string) {
      if (!mode.enabled) return
      mergeProjectIntoItemReal(mode, context, projectId)
    },
    exitRunToItemBranch() {
      if (!mode.enabled) return null
      return exitRunToItemBranchReal(mode, context)
    },
    assertWorkspaceRootOnBaseBranch(label: string) {
      if (!mode.enabled) return
      assertWorkspaceRootOnBaseBranchReal(mode, label)
    },
  }
}
