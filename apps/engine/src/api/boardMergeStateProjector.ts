import type { BoardProjector } from "./boardProjectionTypes.js"

export const projectBoardMergeState: BoardProjector = ({ item, latestRun }) => {
  if (item.current_column !== "merge") {
    return {}
  }

  return {
    column: "merge",
    phaseStatus: item.phase_status,
    currentStage: item.current_stage ?? null,
    latestRunId: latestRun?.id,
  }
}
