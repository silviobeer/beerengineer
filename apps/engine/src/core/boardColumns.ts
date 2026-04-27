/**
 * Project the engine's stage taxonomy onto the fixed board column set.
 *   idea | brainstorm | frontend | requirements | implementation | done
 * Phase-status values:
 *   draft | running | review_required | completed | failed
 */

export type BoardColumn = "idea" | "brainstorm" | "frontend" | "requirements" | "implementation" | "done"
export type BoardPhaseStatus = "draft" | "running" | "review_required" | "completed" | "failed"

export function mapStageToColumn(
  stageKey: string | undefined,
  outcome: "running" | "completed" | "failed",
): { column: BoardColumn; phaseStatus: BoardPhaseStatus } {
  const phaseStatus: BoardPhaseStatus =
    outcome === "running" ? "running" : outcome === "failed" ? "failed" : "completed"
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
      return { column: "implementation", phaseStatus }
    case "documentation":
    case "handoff":
      return { column: outcome === "completed" ? "done" : "implementation", phaseStatus }
    default:
      return { column: "implementation", phaseStatus }
  }
}
