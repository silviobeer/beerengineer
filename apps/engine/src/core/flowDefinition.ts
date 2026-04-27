/**
 * Pure data description of the engine's pipeline.
 *
 * `projectStageRegistry.ts` holds the *executable* nodes (with `run` and
 * `resumeFromDisk` callbacks). This file is the **introspectable graph**:
 * stage ids, what they consume, what they produce, and the optional/required
 * upstream dependencies. Tooling — UI visualizers, dry-run validators,
 * resume-point planners — should read this descriptor instead of reflecting
 * over function bodies.
 *
 * Keep this file in sync with {@link PROJECT_STAGE_REGISTRY}; the test suite
 * cross-checks the two so a missing entry fails CI rather than silently
 * desynchronizes the docs.
 */

import type { ProjectStageId } from "./projectStageRegistry.js"

export type FlowKind = "item" | "project"

export type FlowEdge = {
  /** Stage that must complete before {@link to} starts. */
  from: string
  /** Stage that depends on {@link from}. */
  to: string
}

export type FlowNode = {
  id: string
  kind: FlowKind
  /** Free-form label for UI use. */
  label: string
  /**
   * Names of {@link ProjectContext} fields this stage produces (or fills via
   * resumeFromDisk). Empty for void stages like `qa`.
   */
  produces: string[]
  /**
   * Stages this one depends on. Resume-from-disk uses the same edges to know
   * which artifacts must be present.
   */
  dependsOn: string[]
  /** When true, a void stage that produces no context artifact. */
  voidStage?: boolean
}

/**
 * Item-level flow: design-prep stages that run once per item, before any
 * project pipeline starts. Mirrors the if-cascade in `runWorkflow`.
 */
export const ITEM_FLOW: ReadonlyArray<FlowNode> = [
  {
    id: "brainstorm",
    kind: "item",
    label: "Brainstorm",
    produces: ["projects", "concept"],
    dependsOn: [],
  },
  {
    id: "visual-companion",
    kind: "item",
    label: "Visual companion (wireframes)",
    produces: ["wireframes"],
    dependsOn: ["brainstorm"],
  },
  {
    id: "frontend-design",
    kind: "item",
    label: "Frontend design",
    produces: ["design"],
    dependsOn: ["brainstorm", "visual-companion"],
  },
] as const

/**
 * Project-level flow: per-project pipeline executed by `runProject` for
 * every project the brainstorm produced. The order of this array is also
 * the execution order used by {@link PROJECT_STAGE_REGISTRY}.
 */
export const PROJECT_FLOW: ReadonlyArray<FlowNode & { id: ProjectStageId }> = [
  {
    id: "requirements",
    kind: "project",
    label: "Requirements",
    produces: ["prd"],
    dependsOn: [],
  },
  {
    id: "architecture",
    kind: "project",
    label: "Architecture",
    produces: ["architecture"],
    dependsOn: ["requirements"],
  },
  {
    id: "planning",
    kind: "project",
    label: "Planning",
    produces: ["plan"],
    dependsOn: ["architecture"],
  },
  {
    id: "execution",
    kind: "project",
    label: "Execution",
    produces: ["executionSummaries"],
    dependsOn: ["planning"],
  },
  {
    id: "project-review",
    kind: "project",
    label: "Project review",
    produces: ["projectReview"],
    dependsOn: ["execution"],
  },
  {
    id: "qa",
    kind: "project",
    label: "QA",
    produces: [],
    dependsOn: ["project-review"],
    voidStage: true,
  },
  {
    id: "documentation",
    kind: "project",
    label: "Documentation",
    produces: ["documentation"],
    dependsOn: ["project-review"],
  },
  {
    id: "handoff",
    kind: "project",
    label: "Handoff (project-merge into item)",
    produces: [],
    dependsOn: ["documentation"],
    voidStage: true,
  },
] as const

/** Every node across every flow. Useful for catalog/visualization. */
export const ALL_FLOWS: ReadonlyArray<FlowNode> = [...ITEM_FLOW, ...PROJECT_FLOW]

/** Adjacency edges for the project flow, derived from `dependsOn`. */
export function projectFlowEdges(): FlowEdge[] {
  return PROJECT_FLOW.flatMap(node =>
    node.dependsOn.map(from => ({ from, to: node.id })),
  )
}

/** Adjacency edges for the item flow, derived from `dependsOn`. */
export function itemFlowEdges(): FlowEdge[] {
  return ITEM_FLOW.flatMap(node =>
    node.dependsOn.map(from => ({ from, to: node.id })),
  )
}
