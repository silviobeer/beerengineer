import { itemSlug } from "../core/itemIdentity.js"
import { previewUrlForWorktree } from "../core/portAllocator.js"
import { layout } from "../core/workspaceLayout.js"
import { projectBoardMergeState } from "./boardMergeStateProjector.js"
import { projectBoardPlacement } from "./boardPlacementProjector.js"
import { projectBoardPrompts } from "./boardPromptProjector.js"
import { projectBoardRecovery } from "./boardRecoveryProjector.js"
import { projectBoardSupabase } from "./boardSupabaseProjector.js"
import type { BoardCardDTO, BoardProjectionCoordinator, BoardProjectionProjectors } from "./boardProjectionTypes.js"

function itemWorktreePath(rootPath: string | null, workspaceFsId: string | null, itemTitle: string, itemId: string): string | null {
  if (!rootPath || !workspaceFsId) return null
  const slug = itemSlug({ id: itemId, title: itemTitle })
  return layout.itemWorktreeDir({
    workspaceId: workspaceFsId,
    workspaceRoot: rootPath,
    itemSlug: slug,
  })
}

export function createBoardProjectionCoordinator(projectors: BoardProjectionProjectors): BoardProjectionCoordinator {
  return {
    projectCard(input) {
      const worktreePath = itemWorktreePath(
        input.workspace.root_path ?? null,
        input.latestRun?.workspace_fs_id ?? null,
        input.item.title,
        input.item.id,
      )
      const card = {
        itemCode: input.item.code,
        itemId: input.item.id,
        title: input.item.title,
        summary: input.item.description,
        workspaceId: input.workspace.id,
        workspaceRoot: input.workspace.root_path ?? null,
        latestRunId: input.latestRun?.id,
        previewUrl: worktreePath ? previewUrlForWorktree(worktreePath) : undefined,
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
