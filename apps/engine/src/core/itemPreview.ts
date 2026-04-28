import type { Repos } from "../db/repositories.js"
import { previewHost } from "./previewHost.js"
import { previewUrlForWorktree } from "./portAllocator.js"
import { layout } from "./workspaceLayout.js"

function slugifyTitle(title: string, fallback: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  return slug || fallback.toLowerCase()
}

export type ItemPreviewContext =
  | {
      ok: true
      branch: string
      worktreePath: string
      previewHost: string
      previewPort: number
      previewUrl: string
    }
  | { ok: false; error: "item_not_found" | "item_worktree_not_found"; code: "not_found" }

export function resolveItemPreviewContext(repos: Repos, itemId: string): ItemPreviewContext {
  const item = repos.getItem(itemId)
  if (!item) return { ok: false, error: "item_not_found", code: "not_found" }
  const latestRun = repos.listRunsForItem(itemId)[0]
  const workspace = repos.getWorkspace(item.workspace_id)
  if (!latestRun?.workspace_fs_id || !workspace?.root_path) {
    return { ok: false, error: "item_worktree_not_found", code: "not_found" }
  }
  const itemSlug = slugifyTitle(item.title, item.id)
  const worktreePath = layout.itemWorktreeDir({
    workspaceId: latestRun.workspace_fs_id,
    workspaceRoot: workspace.root_path,
    itemSlug,
    runId: latestRun.workspace_fs_id,
  })
  const previewUrl = previewUrlForWorktree(worktreePath)
  if (!previewUrl) {
    return { ok: false, error: "item_worktree_not_found", code: "not_found" }
  }
  const match = previewUrl.match(/:(\d+)$/)
  const previewPort = match ? Number(match[1]) : NaN
  if (!Number.isFinite(previewPort)) {
    return { ok: false, error: "item_worktree_not_found", code: "not_found" }
  }
  return {
    ok: true,
    branch: `item/${itemSlug}`,
    worktreePath,
    previewHost: previewHost(),
    previewPort,
    previewUrl,
  }
}
