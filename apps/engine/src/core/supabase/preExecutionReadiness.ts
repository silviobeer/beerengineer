import { getSecretMetadata, type SecretStoreOptions } from "../../setup/secretStore.js"
import { SUPABASE_MANAGEMENT_TOKEN_SECRET_REF } from "../../setup/secretMetadata.js"
import type { RunRow, WorkspaceRow } from "../../db/repositories.js"
import { SupabaseBranchPollTimeoutError, isSupabaseBranchReady, pollSupabaseBranch, type BranchPollerClock } from "./branchPoller.js"
import { SupabaseManagementError } from "./managementClient.js"
import type {
  ImplementationPlanArtifact,
  WaveDefinition,
} from "../../types.js"
import type {
  SupabaseBranch,
  SupabaseDbMode,
  SupabaseDbRelevanceTrigger,
  SupabasePreExecutionReadiness,
  SupabaseReadinessSetupAction,
  SupabaseReadinessWorkspace,
  SupabaseProject,
} from "./types.js"
import { buildSupabaseReadinessRecoveryPayload } from "./recoveryPayload.js"

export const SUPABASE_READINESS_BRANCH_POLL_BUDGET_MS = 60_000

export type SupabaseReadinessManagementClient = {
  getProject(projectRef: string): Promise<SupabaseProject>
  getBranch(projectRef: string, branchRef: string): Promise<SupabaseBranch>
  listBranches?(projectRef: string): Promise<SupabaseBranch[]>
}

export type SupabaseReadinessRepos = {
  getRun(id: string): RunRow | undefined
  getWorkspace(id: string): WorkspaceRow | undefined
  updateRun(id: string, patch: Partial<Pick<RunRow, "status" | "current_stage" | "recovery_status" | "recovery_scope" | "recovery_scope_ref" | "recovery_summary" | "recovery_payload_json">>): void
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

export type SupabaseExecutionReadinessResult = SupabasePreExecutionReadiness & {
  dbRelevanceTrigger?: SupabaseDbRelevanceTrigger
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

function requiresPersistentBranch(dbMode: SupabaseDbMode | undefined): boolean {
  return dbMode !== "direct"
}

function workspaceFromRow(row: WorkspaceRow | undefined): SupabaseReadinessWorkspace {
  if (!row) return {}
  return {
    id: row.id,
    key: row.key,
    rootPath: normalize(row.root_path),
    projectRef: normalize(row.supabase_project_ref),
    dbMode: row.supabase_db_mode ?? undefined,
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
  if (requiresPersistentBranch(workspace.dbMode) && !normalize(workspace.persistentTestBranchRef)) {
    actions.push("Create persistent test branch")
  }
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

async function findReadyBranchFromList(input: {
  client: SupabaseReadinessManagementClient
  projectRef: string
  branchRef: string
  branchName?: string
}): Promise<SupabaseBranch | null> {
  if (!input.client.listBranches) return null
  const branches = await input.client.listBranches(input.projectRef)
  return branches.find(branch =>
    (normalize(branch.ref) === input.branchRef || normalize(branch.id) === input.branchRef || normalize(branch.name) === normalize(input.branchName))
    && isSupabaseBranchReady(branch)
  ) ?? null
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
  if (!projectRef || (requiresPersistentBranch(workspace.dbMode) && !branchRef)) {
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
    if (!workspace.dbMode && project.branchingEnabled === false) {
      return blocked({ workspace, runId, message: "Supabase branching is not enabled for this project", branch: { ref: branchRef, status: "degraded" } })
    }
    if (workspace.dbMode === "direct") {
      return {
        status: "ready",
        missingSetupActions: [],
        retry: { available: false, runId },
        workspace,
      }
    }
  } catch (err) {
    return blocked({ workspace, runId, actions: actionForProviderError(err) ? [actionForProviderError(err)!] : [], message: messageForError(err) })
  }

  const persistentBranchRef = branchRef as string
  try {
    const branch = await pollSupabaseBranch({
      clock: input.clock,
      timeoutMs: input.branchPollBudgetMs ?? getSupabaseReadinessBranchPollBudgetMs(input.env),
      poll: async () => {
        try {
          return await input.managementClient!.getBranch(projectRef, persistentBranchRef)
        } catch (err) {
          const listed = err instanceof SupabaseManagementError && err.status === 404
            ? await findReadyBranchFromList({
              client: input.managementClient!,
              projectRef,
              branchRef: persistentBranchRef,
              branchName: workspace.persistentTestBranchName,
            })
            : null
          if (listed) return listed
          throw err
        }
      },
      isReady: isSupabaseBranchReady,
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
        branch: { ref: persistentBranchRef, status: "timeout" },
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
        ref: persistentBranchRef,
        status: action === "Create persistent test branch"
          ? "missing"
          : action === "Rotate management token" || action === "Re-authorize project access"
            ? "unauthorized"
            : "provider_error",
      },
    })
  }
}

function malformedPlan(message: string): SupabaseExecutionReadinessResult {
  return {
    status: "blocked",
    missingSetupActions: [],
    retry: { available: false },
    workspace: {},
    message,
  }
}

export function findSupabaseDbRelevanceTrigger(
  plan: Pick<ImplementationPlanArtifact, "plan">,
): { kind: "none" } | { kind: "trigger"; trigger: SupabaseDbRelevanceTrigger } | { kind: "malformed"; message: string } {
  for (const wave of plan.plan.waves) {
    const trigger = triggerForWave(wave)
    if (trigger.kind !== "none") return trigger
  }
  return { kind: "none" }
}

function triggerForWave(wave: WaveDefinition): ReturnType<typeof findSupabaseDbRelevanceTrigger> {
  if (wave.kind === "setup" && wave.stories.length === 0 && typeof wave.dbRelevantWave !== "boolean") return { kind: "none" }
  for (const story of wave.stories) {
    if (typeof story.dbRelevant !== "boolean") {
      return { kind: "malformed", message: `Wave ${wave.id} story ${story.id} is missing required boolean dbRelevant metadata.` }
    }
    if (story.dbRelevant === true) {
      return { kind: "trigger", trigger: { waveId: wave.id, waveNumber: wave.number, storyId: story.id } }
    }
  }
  if (typeof wave.dbRelevantWave !== "boolean") {
    return { kind: "malformed", message: `Wave ${wave.id} is missing required boolean dbRelevantWave metadata.` }
  }
  if (wave.dbRelevantWave === true) {
    return { kind: "trigger", trigger: { waveId: wave.id, waveNumber: wave.number } }
  }
  return { kind: "none" }
}

export async function evaluateSupabaseReadinessForExecutionPlan(input: {
  plan: ImplementationPlanArtifact
  evaluateReadiness: (trigger: SupabaseDbRelevanceTrigger) => Promise<SupabasePreExecutionReadiness>
}): Promise<SupabaseExecutionReadinessResult> {
  const relevance = findSupabaseDbRelevanceTrigger(input.plan)
  if (relevance.kind === "none") {
    return { status: "ready", missingSetupActions: [], retry: { available: false }, workspace: {} }
  }
  if (relevance.kind === "malformed") return malformedPlan(relevance.message)
  const readiness = await input.evaluateReadiness(relevance.trigger)
  return { ...readiness, dbRelevanceTrigger: relevance.trigger }
}

export function supabaseReadinessRecoverySummary(readiness: SupabaseExecutionReadinessResult): string {
  const actions = readiness.missingSetupActions.length > 0
    ? readiness.missingSetupActions.join(", ")
    : "No setup action available"
  const trigger = readiness.dbRelevanceTrigger
    ? `wave ${readiness.dbRelevanceTrigger.waveNumber}${readiness.dbRelevanceTrigger.storyId ? ` story ${readiness.dbRelevanceTrigger.storyId}` : ""}`
    : "planned DB-relevant work"
  return `Supabase readiness blocked ${trigger}. Missing setup actions: ${actions}.`
}

export function recordSupabaseReadinessBlockedRun(input: {
  repos: SupabaseReadinessRepos
  runId: string
  readiness: SupabaseExecutionReadinessResult
}): RunRow {
  const run = input.repos.getRun(input.runId)
  if (!run) throw new Error(`run_not_found:${input.runId}`)
  const summary = supabaseReadinessRecoverySummary(input.readiness)
  input.repos.updateRun(input.runId, {
    status: "blocked",
    recovery_status: "blocked",
    recovery_scope: "run",
    recovery_scope_ref: null,
    recovery_summary: summary,
    recovery_payload_json: buildSupabaseReadinessRecoveryPayload(input.readiness),
  })
  return input.repos.getRun(input.runId) ?? run
}

export function formatSupabaseReadinessBlockedCliOutput(input: {
  itemRef: string
  action: string
  runId: string
  readiness: SupabaseExecutionReadinessResult
}): string {
  const lines = [
    "",
    "  Workflow start blocked by Supabase readiness.",
    `  Workspace: ${input.readiness.workspace.key ?? input.readiness.workspace.id ?? "unknown"}`,
    "  Reason: planned DB-relevant waves require Supabase readiness before execution workers start.",
  ]
  if (input.readiness.dbRelevanceTrigger) {
    const trigger = input.readiness.dbRelevanceTrigger
    lines.push(`  Trigger: wave ${trigger.waveNumber}${trigger.storyId ? `, story ${trigger.storyId}` : ""}`)
  }
  if (input.readiness.missingSetupActions.length > 0) {
    lines.push("  Missing setup actions:")
    for (const action of input.readiness.missingSetupActions) lines.push(`    - ${action}`)
  }
  lines.push("  Next command: beerengineer setup")
  if (input.readiness.retry.available) {
    lines.push(`  Retry: beerengineer item action --item ${input.itemRef} --action ${input.action}`)
  }
  return lines.join("\n")
}
