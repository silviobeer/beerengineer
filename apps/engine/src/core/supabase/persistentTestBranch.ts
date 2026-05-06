import type { Repos } from "../../db/repositories.js"
import type { SupabaseBranch } from "./types.js"
import { pollSupabaseBranch, SupabaseBranchPollTimeoutError, type BranchPollerClock } from "./branchPoller.js"

export type PersistentBranchClient = {
  listBranches(projectRef: string): Promise<SupabaseBranch[]>
  createBranch(projectRef: string, input: { name: string; parentRef?: string }): Promise<SupabaseBranch>
  getBranch?(projectRef: string, branchRef: string): Promise<SupabaseBranch>
}

export type PersistentTestBranchResult =
  | { ok: true; action: "created" | "attached" | "already-connected"; branch: SupabaseBranch; name: string }
  | {
      ok: false
      error: "workspace_not_found" | "supabase_not_connected" | "branch_not_ready"
      message: string
      recheckRecommended?: boolean
    }

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "workspace"
}

export function persistentTestBranchName(workspaceKey: string): string {
  return `beerengineer-${slug(workspaceKey)}-persistent-test`
}

function branchReady(branch: SupabaseBranch): boolean {
  return branch.status === "ACTIVE_HEALTHY"
}

function isAlreadyExistsError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  const status = typeof err === "object" && err ? (err as { status?: unknown }).status : undefined
  return status === 409 || /already exists|already_exists|conflict/i.test(message)
}

export async function createOrAttachPersistentTestBranch(input: {
  repos: Repos
  workspaceId: string
  client: PersistentBranchClient
  parentRef?: string
  poll?: {
    timeoutMs?: number
    initialDelayMs?: number
    maxDelayMs?: number
    clock?: BranchPollerClock
    onChecking?: (branch: SupabaseBranch) => void
  }
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
  let branch = existing
  let action: "created" | "attached" = existing ? "attached" : "created"
  if (!branch) {
    try {
      branch = await input.client.createBranch(workspace.supabase_project_ref, { name, parentRef: input.parentRef })
    } catch (err) {
      if (!isAlreadyExistsError(err)) throw err
      branch = (await input.client.listBranches(workspace.supabase_project_ref)).find(candidate => candidate.name === name)
      if (!branch) throw err
      action = "attached"
    }
  }
  if (!branchReady(branch)) {
    if (input.poll && input.client.getBranch) {
      input.poll.onChecking?.(branch)
      try {
        branch = await pollSupabaseBranch({
          poll: () => input.client.getBranch!(workspace.supabase_project_ref!, branch!.ref),
          timeoutMs: input.poll.timeoutMs,
          initialDelayMs: input.poll.initialDelayMs,
          maxDelayMs: input.poll.maxDelayMs,
          clock: input.poll.clock,
        })
      } catch (err) {
        if (err instanceof SupabaseBranchPollTimeoutError) {
          return {
            ok: false,
            error: "branch_not_ready",
            message: `Persistent test branch ${name} is still checking; re-run setup to recheck.`,
            recheckRecommended: true,
          }
        }
        throw err
      }
    } else {
      return { ok: false, error: "branch_not_ready", message: `Persistent test branch ${name} is not ready`, recheckRecommended: true }
    }
  }
  input.repos.setWorkspaceSupabasePersistentBranch(input.workspaceId, {
    ref: branch.ref,
    name,
    status: branch.status ?? "ACTIVE_HEALTHY",
  })
  return { ok: true, action, branch, name }
}
