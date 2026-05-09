import { projectBoardMergeState } from "./boardMergeStateProjector.js"
import { projectBoardPlacement } from "./boardPlacementProjector.js"
import { projectBoardPrompts } from "./boardPromptProjector.js"
import { projectBoardRecovery } from "./boardRecoveryProjector.js"
import { projectBoardSupabase } from "./boardSupabaseProjector.js"
import type { BoardCardDTO, BoardProjectionCoordinator, BoardProjectionProjectors } from "./boardProjectionTypes.js"

export function createBoardProjectionCoordinator(projectors: BoardProjectionProjectors): BoardProjectionCoordinator {
  return {
    projectCard(input) {
      const card = {
        itemCode: input.item.code,
        itemId: input.item.id,
        title: input.item.title,
        summary: input.item.description,
        workspaceId: input.workspace.id,
        workspaceRoot: input.workspace.root_path ?? null,
        meta: [
          { label: "phase", value: input.item.phase_status },
          { label: "projects", value: String(input.projectCount) },
        ],
        ...projectors.placementProjector(input),
        ...projectors.promptProjector(input),
        ...projectors.recoveryProjector(input),
        ...projectors.supabaseProjector(input),
        ...projectors.mergeStateProjector(input),
      } as BoardCardDTO
      return card
    },
  }
}

export function createDefaultBoardProjectionCoordinator(): BoardProjectionCoordinator {
  return createBoardProjectionCoordinator({
    placementProjector: projectBoardPlacement,
    promptProjector: projectBoardPrompts,
    recoveryProjector: projectBoardRecovery,
    supabaseProjector: projectBoardSupabase,
    mergeStateProjector: projectBoardMergeState,
  })
}
