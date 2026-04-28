// Real-git is the only mode (simulation has been removed). This facade
// re-exports the public API; implementations live under `./git/`.

export type {
  GitMergeOptions,
  GitMode,
  ManagedWorktreeGcResult,
} from "./git/shared.js"
export type { WorkspaceInspection } from "./git/inspect.js"
export type { RebaseStoryResult } from "./git/merge.js"

export {
  assertWorkspaceRootOnBaseBranch,
  detectGitMode,
  inspectWorkspaceState,
} from "./git/inspect.js"

export {
  abandonStoryBranch,
  ensureProjectBranch,
  ensureStoryBranch,
  ensureWaveBranch,
  exitRunToItemBranch,
} from "./git/branches.js"

export {
  ensureItemBranch,
  ensureStoryWorktree,
  gcManagedStoryWorktrees,
  removeStoryWorktree,
} from "./git/worktrees.js"

export {
  mergeItemIntoBase,
  mergeProjectIntoItem,
  mergeStoryIntoWave,
  mergeWaveIntoProject,
  rebaseStoryOntoWave,
} from "./git/merge.js"

export { commitAll } from "./git/commit.js"

// Re-export so callers that only reach for real-git helpers still get a single entry point.
export { isEngineOwnedBranchName } from "./baseBranch.js"
