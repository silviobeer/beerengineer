import type { WorkspaceRuntimePolicy } from "../types/workspace.js"

/**
 * Provider-dispatch policy. Narrower than `WorkspaceRuntimePolicy`: one mode,
 * picked per role (stage authoring / reviewer / coder execution) out of the
 * workspace config.
 */
export type RuntimePolicy =
  | { mode: "safe-readonly" }
  | { mode: "safe-workspace-write" }
  | { mode: "unsafe-autonomous-write" }

export function stageAuthoringPolicy(policy: WorkspaceRuntimePolicy): RuntimePolicy {
  return { mode: policy.stageAuthoring }
}

export function reviewerPolicy(policy: WorkspaceRuntimePolicy): RuntimePolicy {
  return { mode: policy.reviewer }
}

export function executionCoderPolicy(policy: WorkspaceRuntimePolicy): RuntimePolicy {
  return { mode: policy.coderExecution }
}
