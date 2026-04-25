import type { WorkspaceRuntimePolicy } from "../types/workspace.js"

/**
 * Provider-dispatch policy. Narrower than `WorkspaceRuntimePolicy`: one mode,
 * picked per role (stage authoring / reviewer / coder execution) out of the
 * workspace config.
 */
export type RuntimePolicy =
  | { mode: "no-tools" }
  | { mode: "safe-readonly" }
  | { mode: "safe-workspace-write" }
  | { mode: "unsafe-autonomous-write" }

// Stage agents and reviewers emit one JSON envelope and never use tools.
// Forcing no-tools on the provider invocation drops --add-dir,
// --permission-mode, and codex's --sandbox flag, which removes the plan-mode
// preamble and shrinks first-token latency. The workspace's stageAuthoring /
// reviewer policy fields are kept in the schema for future use.
export function stageAuthoringPolicy(_policy: WorkspaceRuntimePolicy): RuntimePolicy {
  return { mode: "no-tools" }
}

export function reviewerPolicy(_policy: WorkspaceRuntimePolicy): RuntimePolicy {
  return { mode: "no-tools" }
}

export function executionCoderPolicy(policy: WorkspaceRuntimePolicy): RuntimePolicy {
  return { mode: policy.coderExecution }
}
