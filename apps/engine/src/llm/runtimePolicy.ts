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

// Engineering stages need to inspect the existing codebase (api contracts,
// existing files, package layout) to produce work that aligns with reality.
// They get safe-readonly so claude can use Read/Grep tools but cannot mutate
// anything. Design-prep stages stay on no-tools — not because they don't
// benefit from code awareness (they do, especially on brownfield items), but
// to keep first-token latency low: they emit one JSON envelope per turn and
// the codebase snapshot in their payload gives them the brownfield context
// they need without round-tripping through tool calls.
const TOOL_USING_STAGES = new Set([
  "requirements",
  "architecture",
  "planning",
  "project-review",
  "qa",
  "documentation",
])

export function stageAuthoringPolicy(_policy: WorkspaceRuntimePolicy, stageId?: string): RuntimePolicy {
  if (stageId && TOOL_USING_STAGES.has(stageId)) return { mode: "safe-readonly" }
  return { mode: "no-tools" }
}

// Reviewers always read-only inspect the artifact in the payload. Tool-using
// engineering stages get a reviewer that can also read the codebase so it can
// catch contract drift the artifact author missed; design-prep reviewers stay
// no-tools.
export function reviewerPolicy(_policy: WorkspaceRuntimePolicy, stageId?: string): RuntimePolicy {
  if (stageId && TOOL_USING_STAGES.has(stageId)) return { mode: "safe-readonly" }
  return { mode: "no-tools" }
}

export function executionCoderPolicy(policy: WorkspaceRuntimePolicy): RuntimePolicy {
  return { mode: policy.coderExecution }
}
