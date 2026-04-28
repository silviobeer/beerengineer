import type { ItemRow, Repos, RunRow, WorkspaceRow } from "../db/repositories.js"
import type { WorkflowContext } from "./workspaceLayout.js"

function trimRootPath(workspace: Pick<WorkspaceRow, "root_path"> | undefined): string | null {
  const rootPath = workspace?.root_path?.trim()
  return rootPath || null
}

export function resolveWorkspaceRootForWorkspaceId(repos: Repos, workspaceId: string): string | null {
  return trimRootPath(repos.getWorkspace(workspaceId))
}

export function resolveWorkflowContextForRun(
  repos: Repos,
  run: Pick<RunRow, "id" | "workspace_id" | "workspace_fs_id">,
  opts: { runIdOverride?: string } = {},
): WorkflowContext | null {
  if (!run.workspace_fs_id) return null
  const workspaceRoot = resolveWorkspaceRootForWorkspaceId(repos, run.workspace_id)
  if (!workspaceRoot) return null
  return {
    workspaceId: run.workspace_fs_id,
    runId: opts.runIdOverride ?? run.id,
    workspaceRoot,
  }
}

export function requireWorkflowContextForRun(
  repos: Repos,
  run: Pick<RunRow, "id" | "workspace_id" | "workspace_fs_id">,
  opts: { runIdOverride?: string } = {},
): WorkflowContext {
  const ctx = resolveWorkflowContextForRun(repos, run, opts)
  if (!ctx) throw new Error(`artefacts_unreachable:${run.id}`)
  return ctx
}

export function resolveWorkflowContextForItemRun(
  repos: Repos,
  item: Pick<ItemRow, "workspace_id">,
  run: Pick<RunRow, "id" | "workspace_fs_id">,
): WorkflowContext | null {
  if (!run.workspace_fs_id) return null
  const workspaceRoot = resolveWorkspaceRootForWorkspaceId(repos, item.workspace_id)
  if (!workspaceRoot) return null
  return {
    workspaceId: run.workspace_fs_id,
    runId: run.id,
    workspaceRoot,
  }
}
