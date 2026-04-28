import { itemSlug } from "./itemIdentity.js";
import { previewHost } from "./previewHost.js";
import { previewUrlForWorktree } from "./portAllocator.js";
import { layout } from "./workspaceLayout.js";
export function resolveItemPreviewContext(repos, itemId) {
    const item = repos.getItem(itemId);
    if (!item)
        return { ok: false, error: "item_not_found", code: "not_found" };
    const latestRun = repos.listRunsForItem(itemId)[0];
    const workspace = repos.getWorkspace(item.workspace_id);
    if (!latestRun?.workspace_fs_id || !workspace?.root_path) {
        return { ok: false, error: "item_worktree_not_found", code: "not_found" };
    }
    const slug = itemSlug(item);
    const worktreePath = layout.itemWorktreeDir({
        workspaceId: latestRun.workspace_fs_id,
        workspaceRoot: workspace.root_path,
        itemSlug: slug,
        runId: latestRun.workspace_fs_id,
    });
    const previewUrl = previewUrlForWorktree(worktreePath);
    if (!previewUrl) {
        return { ok: false, error: "item_worktree_not_found", code: "not_found" };
    }
    const match = /:(\d+)$/.exec(previewUrl);
    const previewPort = match ? Number(match[1]) : Number.NaN;
    if (!Number.isFinite(previewPort)) {
        return { ok: false, error: "item_worktree_not_found", code: "not_found" };
    }
    return {
        ok: true,
        branch: `item/${slug}`,
        worktreePath,
        previewHost: previewHost(),
        previewPort,
        previewUrl,
    };
}
