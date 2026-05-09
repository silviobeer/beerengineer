import { itemSlug } from "../core/itemIdentity.js"
import { previewUrlForWorktree } from "../core/portAllocator.js"
import { layout } from "../core/workspaceLayout.js"
import type { BoardProjector } from "./boardProjectionTypes.js"

function itemWorktreePath(rootPath: string | null, workspaceFsId: string | null, itemTitle: string, itemId: string): string | null {
  if (!rootPath || !workspaceFsId) return null
  const slug = itemSlug({ id: itemId, title: itemTitle })
  return layout.itemWorktreeDir({
    workspaceId: workspaceFsId,
    workspaceRoot: rootPath,
    itemSlug: slug,
    runId: workspaceFsId,
  })
}

export const projectBoardMergeState: BoardProjector = ({ workspace, item, latestRun }) => {
  const worktreePath = itemWorktreePath(workspace.root_path ?? null, latestRun?.workspace_fs_id ?? null, item.title, item.id)
  return {
    latestRunId: latestRun?.id,
    previewUrl: worktreePath ? previewUrlForWorktree(worktreePath) : undefined,
  }
}
