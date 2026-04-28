/**
 * Project the engine's stage taxonomy onto the fixed board column set.
 *   idea | brainstorm | frontend | requirements | implementation | merge | done
 * Phase-status values:
 *   draft | running | review_required | completed | failed
 */

export type BoardColumn = "idea" | "brainstorm" | "frontend" | "requirements" | "implementation" | "merge" | "done"
export type BoardPhaseStatus = "draft" | "running" | "review_required" | "completed" | "failed"

export function mapStageToColumn(
  stageKey: string | undefined,
  outcome: "running" | "completed" | "failed",
): { column: BoardColumn; phaseStatus: BoardPhaseStatus } {
  let phaseStatus: BoardPhaseStatus = "completed"
  if (outcome === "running") phaseStatus = "running"
  else if (outcome === "failed") phaseStatus = "failed"
  if (!stageKey) return { column: "idea", phaseStatus: "draft" }
  switch (stageKey) {
    case "brainstorm":
      return { column: "brainstorm", phaseStatus }
    case "visual-companion":
    case "frontend-design":
      return { column: "frontend", phaseStatus }
    case "requirements":
      return { column: "requirements", phaseStatus }
    case "architecture":
    case "planning":
    case "execution":
    case "project-review":
    case "qa":
    case "documentation":
    case "handoff":
      return { column: "implementation", phaseStatus }
    case "merge-gate":
      if (outcome === "running") return { column: "merge", phaseStatus: "review_required" }
      if (outcome === "completed") return { column: "done", phaseStatus: "completed" }
      if (outcome === "failed") return { column: "merge", phaseStatus: "review_required" }
      return { column: "merge", phaseStatus }
    default:
      return { column: "implementation", phaseStatus }
  }
}
