import { recoveryUserMessageForRun } from "../core/recoveryUserMessage.js"
import type { BoardProjector } from "./boardProjectionTypes.js"

export const projectBoardRecovery: BoardProjector = ({ latestRun }) => ({
  hasBlockedRun: latestRun?.recovery_status === "blocked",
  recovery_user_message: latestRun ? recoveryUserMessageForRun(latestRun) : null,
})
