import { getSecretMetadata, type SecretStoreOptions } from "../../setup/secretStore.js"
import { SUPABASE_MANAGEMENT_TOKEN_SECRET_REF } from "../../setup/secretMetadata.js"
import type { RunRow, WorkspaceRow } from "../../db/repositories.js"
import { SupabaseBranchPollTimeoutError, pollSupabaseBranch, type BranchPollerClock } from "./branchPoller.js"
import { SupabaseManagementError } from "./managementClient.js"
import type {
  SupabaseBranch,
  SupabasePreExecutionReadiness,
  SupabaseReadinessSetupAction,
  SupabaseReadinessWorkspace,
  SupabaseProject,
} from "./types.js"

export const SUPABASE_READINESS_BRANCH_POLL_BUDGET_MS = 60_000

export type SupabaseReadinessManagementClient = {
  getProject(projectRef: string): Promise<SupabaseProject>
  getBranch(projectRef: string, branchRef: string): Promise<SupabaseBranch>
}

export type SupabaseReadinessRepos = {
  getRun(id: string): RunRow | undefined
  getWorkspace(id: string): WorkspaceRow | undefined
}

export type SupabaseReadinessRequestRefs = {
  workspaceRoot?: string
  projectRef?: string
  branchRef?: string
  branchName?: string
}

export type SupabasePreExecutionReadinessInput = {
  mode?: "execution" | "setup"
  repos?: SupabaseReadinessRepos
  runId?: string
  workspace?: SupabaseReadinessWorkspace
  requestRefs?: SupabaseReadinessRequestRefs
  secretStore?: SecretStoreOptions
  managementClient?: SupabaseReadinessManagementClient
  branchPollBudgetMs?: number
  clock?: BranchPollerClock
  env?: Record<string, string | undefined>
}

function normalize(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function getSupabaseReadinessBranchPollBudgetMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env.SUPABASE_READINESS_BRANCH_POLL_BUDGET_MS
  if (!raw) return SUPABASE_READINESS_BRANCH_POLL_BUDGET_MS
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : SUPABASE_READINESS_BRANCH_POLL_BUDGET_MS
}

function dedupe(actions: SupabaseReadinessSetupAction[]): SupabaseReadinessSetupAction[] {
  return [...new Set(actions)]
}

function workspaceFromRow(row: WorkspaceRow | undefined): SupabaseReadinessWorkspace {
  if (!row) return {}
  return {
    id: row.id,
    key: row.key,
    rootPath: normalize(row.root_path),
    projectRef: normalize(row.supabase_project_ref),
    persistentTestBranchRef: normalize(row.supabase_persistent_test_branch_ref),
    persistentTestBranchName: normalize(row.supabase_persistent_test_branch_name),
  }
}

function resolveWorkspace(input: SupabasePreExecutionReadinessInput): { workspace: SupabaseReadinessWorkspace; run?: RunRow } {
  if (input.repos && input.runId) {
    const run = input.repos.getRun(input.runId)
    return { run, workspace: workspaceFromRow(run ? input.repos.getWorkspace(run.workspace_id) : undefined) }
  }
  return { workspace: input.workspace ?? {} }
}

function localMissingActions(workspace: SupabaseReadinessWorkspace, secretStore?: SecretStoreOptions): SupabaseReadinessSetupAction[] {
  const token = getSecretMetadata(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF, secretStore)
  const actions: SupabaseReadinessSetupAction[] = []
  if (!(token.present && token.active)) actions.push("Store management token")
  if (!normalize(workspace.projectRef)) actions.push("Connect Supabase project")
  if (!normalize(workspace.persistentTestBranchRef)) actions.push("Create persistent test branch")
  return actions
}

function actionForProviderError(err: unknown, branch = false): SupabaseReadinessSetupAction | null {
  const status = err instanceof SupabaseManagementError ? err.status : typeof (err as { status?: unknown })?.status === "number" ? (err as { status: number }).status : undefined
  if (status === 401) return "Rotate management token"
  if (status === 403) return "Re-authorize project access"
  if (branch && status === 404) return "Create persistent test branch"
  return null
}

function messageForError(err: unknown): string {
  if (err instanceof Error) return err.message
  return "Supabase readiness check failed"
}

function blocked(input: {
  workspace: SupabaseReadinessWorkspace
  runId?: string
  actions?: SupabaseReadinessSetupAction[]
  message?: string
  branch?: SupabasePreExecutionReadiness["branch"]
}): SupabasePreExecutionReadiness {
  return {
    status: "blocked",
    missingSetupActions: dedupe(input.actions ?? []),
    retry: { available: true, runId: input.runId },
    workspace: input.workspace,
    branch: input.branch,
    message: input.message,
  }
}

export async function createSupabasePreExecutionReadiness(input: SupabasePreExecutionReadinessInput): Promise<SupabasePreExecutionReadiness> {
  const { run, workspace } = resolveWorkspace(input)
  const runId = run?.id ?? input.runId
  const missing = localMissingActions(workspace, input.secretStore)
  if (missing.length > 0) {
    return blocked({ workspace, runId, actions: missing })
  }

  const projectRef = normalize(workspace.projectRef)
  const branchRef = normalize(workspace.persistentTestBranchRef)
  if (!projectRef || !branchRef) {
    return blocked({ workspace, runId, actions: localMissingActions(workspace, input.secretStore) })
  }
  if (!input.managementClient) {
    return blocked({ workspace, runId, message: "Supabase Management API client unavailable", branch: { ref: branchRef, status: "provider_error" } })
  }

  try {
    const project = await input.managementClient.getProject(projectRef)
    if (normalize(project.ref) && normalize(project.ref) !== projectRef) {
      return blocked({ workspace, runId, actions: ["Re-authorize project access"], message: "Supabase project access returned a different project" })
    }
    if (project.branchingEnabled === false) {
      return blocked({ workspace, runId, message: "Supabase branching is not enabled for this project", branch: { ref: branchRef, status: "degraded" } })
    }
  } catch (err) {
    return blocked({ workspace, runId, actions: actionForProviderError(err) ? [actionForProviderError(err)!] : [], message: messageForError(err) })
  }

  try {
    const branch = await pollSupabaseBranch({
      clock: input.clock,
      timeoutMs: input.branchPollBudgetMs ?? getSupabaseReadinessBranchPollBudgetMs(input.env),
      poll: () => input.managementClient!.getBranch(projectRef, branchRef),
      isReady: candidate => candidate.status === "ACTIVE_HEALTHY",
    })
    return {
      status: "ready",
      missingSetupActions: [],
      retry: { available: false, runId },
      workspace,
      branch: { ref: branch.ref, status: "active_healthy", providerStatus: branch.status },
    }
  } catch (err) {
    if (err instanceof SupabaseBranchPollTimeoutError) {
      return {
        status: input.mode === "setup" ? "checking" : "blocked",
        missingSetupActions: [],
        retry: { available: true, runId },
        workspace,
        branch: { ref: branchRef, status: "timeout" },
        message: err.message,
      }
    }
    const action = actionForProviderError(err, true)
    return blocked({
      workspace,
      runId,
      actions: action ? [action] : [],
      message: messageForError(err),
      branch: {
        ref: branchRef,
        status: action === "Create persistent test branch"
          ? "missing"
          : action === "Rotate management token" || action === "Re-authorize project access"
            ? "unauthorized"
            : "provider_error",
      },
    })
  }
}
