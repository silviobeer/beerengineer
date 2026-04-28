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
import { abandonStoryBranch, assertWorkspaceRootOnBaseBranch as assertWorkspaceRootOnBaseBranchReal, detectGitMode, ensureItemBranch, ensureProjectBranch, ensureStoryBranch, ensureStoryWorktree, ensureWaveBranch, exitRunToItemBranch, gcManagedStoryWorktrees, mergeItemIntoBase, mergeProjectIntoItem, mergeStoryIntoWave, mergeWaveIntoProject, rebaseStoryOntoWave, removeStoryWorktree, } from "./git.js";
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
export function createGitAdapter(context) {
    return createGitAdapterFromMode(context, detectGitMode(context));
}
export function createGitAdapterFromMode(context, mode) {
    return {
        mode,
        enabled: true,
        ensureItemBranch() {
            ensureItemBranch(mode, context);
        },
        ensureProjectBranch(projectId) {
            ensureProjectBranch(mode, context, projectId);
        },
        mergeProjectIntoItem(projectId, opts = {}) {
            mergeProjectIntoItem(mode, context, projectId, opts);
        },
        mergeItemIntoBase() {
            return mergeItemIntoBase(mode, context);
        },
        ensureWaveBranch(projectId, waveNumber) {
            return ensureWaveBranch(mode, context, projectId, waveNumber);
        },
        ensureStoryBranch(projectId, waveNumber, storyId) {
            return ensureStoryBranch(mode, context, projectId, waveNumber, storyId);
        },
        ensureStoryWorktree(projectId, waveNumber, storyId, worktreeRoot) {
            return ensureStoryWorktree(mode, context, projectId, waveNumber, storyId, worktreeRoot);
        },
        mergeStoryIntoWave(projectId, waveNumber, storyId, opts = {}) {
            mergeStoryIntoWave(mode, context, projectId, waveNumber, storyId, opts);
        },
        mergeWaveIntoProject(projectId, waveNumber, opts = {}) {
            mergeWaveIntoProject(mode, context, projectId, waveNumber, opts);
        },
        rebaseStoryOntoWave(projectId, waveNumber, storyId) {
            return rebaseStoryOntoWave(mode, context, projectId, waveNumber, storyId);
        },
        abandonStoryBranch(projectId, waveNumber, storyId) {
            return abandonStoryBranch(mode, context, projectId, waveNumber, storyId);
        },
        removeStoryWorktree(worktreeRoot) {
            removeStoryWorktree(mode, worktreeRoot);
        },
        exitRunToItemBranch() {
            return exitRunToItemBranch(mode, context);
        },
        assertWorkspaceRootOnBaseBranch(label) {
            assertWorkspaceRootOnBaseBranchReal(mode, label);
        },
        gcManagedStoryWorktrees(managedRoot) {
            return gcManagedStoryWorktrees(mode, managedRoot);
        },
    };
}
