function trimRootPath(workspace) {
    const rootPath = workspace?.root_path?.trim();
    return rootPath || null;
}
export function resolveWorkspaceRootForWorkspaceId(repos, workspaceId) {
    return trimRootPath(repos.getWorkspace(workspaceId));
}
export function resolveWorkflowContextForRun(repos, run, opts = {}) {
    if (!run.workspace_fs_id)
        return null;
    const workspaceRoot = resolveWorkspaceRootForWorkspaceId(repos, run.workspace_id);
    if (!workspaceRoot)
        return null;
    return {
        workspaceId: run.workspace_fs_id,
        runId: opts.runIdOverride ?? run.id,
        workspaceRoot,
    };
}
export function requireWorkflowContextForRun(repos, run, opts = {}) {
    const ctx = resolveWorkflowContextForRun(repos, run, opts);
    if (!ctx)
        throw new Error(`artefacts_unreachable:${run.id}`);
    return ctx;
}
export function resolveWorkflowContextForItemRun(repos, item, run) {
    if (!run.workspace_fs_id)
        return null;
    const workspaceRoot = resolveWorkspaceRootForWorkspaceId(repos, item.workspace_id);
    if (!workspaceRoot)
        return null;
    return {
        workspaceId: run.workspace_fs_id,
        runId: run.id,
        workspaceRoot,
    };
}
