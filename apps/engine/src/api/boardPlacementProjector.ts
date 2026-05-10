import type { BoardProjector } from "./boardProjectionTypes.js"

export const projectBoardPlacement: BoardProjector = ({ item }) => ({
  column: item.current_column,
  phaseStatus: item.phase_status,
  currentStage: item.current_stage ?? null,
})
