import type { Repos } from "../../db/repositories.js"
import type { SupabaseBranch } from "./types.js"

export type PersistentBranchClient = {
  listBranches(projectRef: string): Promise<SupabaseBranch[]>
  createBranch(projectRef: string, input: { name: string; parentRef?: string }): Promise<SupabaseBranch>
}

export type PersistentTestBranchResult =
  | { ok: true; action: "created" | "attached" | "already-connected"; branch: SupabaseBranch; name: string }
  | { ok: false; error: "workspace_not_found" | "supabase_not_connected" | "branch_not_ready"; message: string }

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "workspace"
}

export function persistentTestBranchName(workspaceKey: string): string {
  return `beerengineer-${slug(workspaceKey)}-persistent-test`
}

function branchReady(branch: SupabaseBranch): boolean {
  return branch.status === undefined || branch.status === "ACTIVE_HEALTHY" || branch.status === "ready"
}

export async function createOrAttachPersistentTestBranch(input: {
  repos: Repos
  workspaceId: string
  client: PersistentBranchClient
  parentRef?: string
}): Promise<PersistentTestBranchResult> {
  const workspace = input.repos.getWorkspace(input.workspaceId)
  if (!workspace) return { ok: false, error: "workspace_not_found", message: "Workspace not found" }
  if (!workspace.supabase_project_ref) return { ok: false, error: "supabase_not_connected", message: "Supabase project is not connected" }
  const name = persistentTestBranchName(workspace.key)
  if (workspace.supabase_persistent_test_branch_ref) {
    return {
      ok: true,
      action: "already-connected",
      name: workspace.supabase_persistent_test_branch_name ?? name,
      branch: {
        id: workspace.supabase_persistent_test_branch_ref,
        ref: workspace.supabase_persistent_test_branch_ref,
        name: workspace.supabase_persistent_test_branch_name ?? name,
        status: workspace.supabase_persistent_test_branch_status ?? "ACTIVE_HEALTHY",
      },
    }
  }

  const existing = (await input.client.listBranches(workspace.supabase_project_ref)).find(branch => branch.name === name)
  const branch = existing ?? await input.client.createBranch(workspace.supabase_project_ref, { name, parentRef: input.parentRef })
  if (!branchReady(branch)) {
    return { ok: false, error: "branch_not_ready", message: `Persistent test branch ${name} is not ready` }
  }
  input.repos.setWorkspaceSupabasePersistentBranch(input.workspaceId, {
    ref: branch.ref,
    name,
    status: branch.status ?? "ACTIVE_HEALTHY",
  })
  return { ok: true, action: existing ? "attached" : "created", branch, name }
}
