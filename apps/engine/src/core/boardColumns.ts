/**
 * Project the engine's stage taxonomy onto the UI board's fixed column set.
 * Columns must stay in sync with orderedBoardColumns in apps/ui/lib/live-board.ts:
 *   idea | brainstorm | requirements | implementation | done
 * Phase-status values consumed by the UI:
 *   draft | running | review_required | completed | failed
 */

export type BoardColumn = "idea" | "brainstorm" | "requirements" | "implementation" | "done"
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
