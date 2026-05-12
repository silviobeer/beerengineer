import type { Item } from "../types.js"
import type { Repos, WorkspaceRow } from "../db/repositories.js"
import { runWorkflow, type WorkflowResumeInput } from "../workflow.js"
import { createBus, type EventBus } from "./bus.js"
import { workflowWorkspaceId } from "./itemIdentity.js"
import { runWithWorkflowIO, type WorkflowIO } from "./io.js"
import { attachRunSubscribers, resolveWorkflowLlmOptions } from "./runSubscribers.js"
import { runWithActiveRun } from "./runContext.js"
import { persistWorkflowRunState } from "./stageRuntime.js"
import type { SupabaseWorkflowHook } from "./supabase/workflowHook.js"
import type { SupabaseAdapter } from "./supabase/types.js"
import type { SupabaseHandoffClient } from "./supabase/handoffWriter.js"
import type { SupabaseReadinessManagementClient } from "./supabase/preExecutionReadiness.js"
import { markRunFailedRecoverable } from "./orphanRecovery.js"
import {
  claimWorkerLease,
  defaultWorkerInstanceId,
  startWorkerLeaseHeartbeat,
  type WorkerLeaseHeartbeat,
  type WorkerLeaseScheduler,
} from "./workerLease.js"
import type { WorkerOwnerKind } from "../db/repositories.js"
import {
  assertWorkflowNotCancelled,
  createWorkflowCancellation,
  isWorkflowCancelledError,
  runWithWorkflowCancellation,
  withWorkflowCancellation,
} from "./workflowCancellation.js"

export { attachDbSync, type AttachDbSyncOptions } from "./dbSync.js"
/* c8 ignore next -- pure re-export */
export { mapStageToColumn } from "./boardColumns.js"
export { busToWorkflowIO } from "./bus.js"
export type { WorkflowEvent } from "./io.js"

export type SupabaseAdapterFactory = (deps: { workspaceId: string; projectRef: string }) => {
  adapter: SupabaseAdapter
  managementClient?: SupabaseReadinessManagementClient
  handoffClient?: SupabaseHandoffClient
} | null

function asBoundSupabaseHandoffClient(
  client: SupabaseHandoffClient | undefined,
): SupabaseHandoffClient | undefined {
  if (!client) return undefined
  return {
    getProjectKeys: client.getProjectKeys.bind(client),
    getBranchConnectionString: client.getBranchConnectionString.bind(client),
  }
}

function isSupabaseHandoffClient(value: unknown): value is SupabaseHandoffClient {
  if (!value || typeof value !== "object") return false
  return typeof (value as SupabaseHandoffClient).getProjectKeys === "function"
    && typeof (value as SupabaseHandoffClient).getBranchConnectionString === "function"
}

function copiedUnboundHandoffMethods(input: {
  handoffClient?: SupabaseHandoffClient
  managementClient?: SupabaseReadinessManagementClient
}): boolean {
  const { handoffClient, managementClient } = input
  if (!handoffClient || !isSupabaseHandoffClient(managementClient) || handoffClient === managementClient) return false
  return handoffClient.getProjectKeys === managementClient.getProjectKeys
    && handoffClient.getBranchConnectionString === managementClient.getBranchConnectionString
}

export function buildSupabaseWorkflowHook(
  repos: Repos,
  workspaceId: string,
  workspaceRow: WorkspaceRow | undefined,
  supabaseAdapterFactory?: SupabaseAdapterFactory | null,
): SupabaseWorkflowHook | undefined {
  if (!supabaseAdapterFactory || !workspaceRow?.supabase_project_ref) {
    return undefined
  }
  const dbMode = workspaceRow.supabase_db_mode ?? "branching"
  if (dbMode !== "direct" && !workspaceRow.supabase_persistent_test_branch_ref) {
    return undefined
  }

  const built = supabaseAdapterFactory({
    workspaceId,
    projectRef: workspaceRow.supabase_project_ref,
  })
  if (!built) return undefined

  const managementHandoffClient = isSupabaseHandoffClient(built.managementClient)
    ? built.managementClient
    : undefined
  const handoffClient = copiedUnboundHandoffMethods({
    handoffClient: built.handoffClient,
    managementClient: built.managementClient,
  })
    ? asBoundSupabaseHandoffClient(managementHandoffClient)
    : asBoundSupabaseHandoffClient(built.handoffClient)
      ?? asBoundSupabaseHandoffClient(managementHandoffClient)

  return {
    repos,
    adapter: built.adapter,
    managementClient: built.managementClient,
    workspaceId,
    projectRef: workspaceRow.supabase_project_ref,
    dbMode,
    parentBranchRef: workspaceRow.supabase_persistent_test_branch_ref ?? undefined,
    protectionSwitch: workspaceRow.supabase_protection_switch ?? "off",
    cleanupPolicy: workspaceRow.supabase_cleanup_policy ?? "on-success-immediate",
    cleanupTtlHours: workspaceRow.supabase_cleanup_ttl_hours ?? null,
    handoffClient,
  }
}

/**
 * Create the workspace/item/run records synchronously and wire up the full
 * shared-transport stack on the active bus. Returns both the DB ids and a
 * `start()` callback that kicks off the workflow. Split like this so HTTP
 * callers can return runId before the workflow finishes.
 */
export function prepareRun(
  item: Item,
  repos: Repos,
  io: WorkflowIO & { bus?: EventBus },
  opts: {
    workspaceKey?: string
    workspaceName?: string
    owner?: "cli" | "api"
    workerInstanceId?: string
    workerLeaseClock?: () => number
    workerLeaseScheduler?: WorkerLeaseScheduler
    workflowRunner?: typeof runWorkflow
    itemId?: string
    deferWorkerLease?: boolean
    resume?: WorkflowResumeInput
    /** Forwarded to `attachRunSubscribers`; see `AttachDbSyncOptions.onItemColumnChanged`. */
    onItemColumnChanged?: (payload: { itemId: string; from: string; to: string; phaseStatus: string }) => void
    /**
     * BUG-PROJ4-QA-005: optional factory that builds a Supabase adapter for
     * the workspace. When provided AND the workspace has a projectRef AND a
     * persistent test branch, the workflow is wired through the Supabase gate
     * helpers (provision, validate, merge gates, cleanup).
     *
     * The factory receives the workspace id + projectRef so the caller can
     * construct it lazily (the token may change between run start and the
     * actual adapter invocation, but that's acceptable — the factory is called
     * once per run at `start()` time).
     */
    supabaseAdapterFactory?: SupabaseAdapterFactory | null
  } = {}
) {
  const itemRow = opts.itemId
    ? repos.getItem(opts.itemId) ?? (() => {
        throw new Error(`item ${opts.itemId} not found`)
      })()
    : repos.createItem({
        workspaceId: repos.upsertWorkspace({
          key: opts.workspaceKey ?? "default",
          name: opts.workspaceName ?? "Default Workspace",
          description: "beerengineer_ engine workspace"
        }).id,
        title: item.title,
        description: item.description
      })
  const workspaceId = itemRow.workspace_id
  const workspaceFsId = workflowWorkspaceId(itemRow)
  const workerOwnerKind: WorkerOwnerKind = opts.owner ?? "api"
  const workerInstanceId = opts.workerInstanceId ?? defaultWorkerInstanceId(workerOwnerKind)
  const cancellation = createWorkflowCancellation()
  const runRow = repos.createRun({
    workspaceId,
    itemId: itemRow.id,
    title: item.title,
    owner: workerOwnerKind,
    workspaceFsId,
    status: opts.deferWorkerLease ? "queued" : "running",
  })
  let heartbeat: WorkerLeaseHeartbeat | null = null
  let workerLeaseStarted = false

  const ensureWorkerLease = (): void => {
    if (workerLeaseStarted) return
    try {
      claimWorkerLease(repos, {
        runId: runRow.id,
        workerInstanceId,
        workerOwnerKind,
        now: opts.workerLeaseClock?.(),
      })
    } catch (error) {
      markRunFailedRecoverable(
        repos,
        runRow.id,
        `Worker start failed before ownership was durable: ${(error as Error).message}`,
      )
      throw error
    }
    try {
      heartbeat = startWorkerLeaseHeartbeat(repos, {
        runId: runRow.id,
        workerInstanceId,
        workerOwnerKind,
        now: opts.workerLeaseClock,
        scheduler: opts.workerLeaseScheduler,
        onFatal: (reason, error) => cancellation.cancel(reason, error),
      })
    } catch (error) {
      markRunFailedRecoverable(
        repos,
        runRow.id,
        `Worker start failed before heartbeat was durable: ${(error as Error).message}`,
      )
      throw error
    }
    workerLeaseStarted = true
  }

  if (!opts.deferWorkerLease) ensureWorkerLease()

  const bus = io.bus ?? createBus()
  const workflowIo = withWorkflowCancellation(io, cancellation)
  const workflowRunner = opts.workflowRunner ?? runWorkflow

  const start = async (): Promise<void> => {
    assertWorkflowNotCancelled()
    ensureWorkerLease()
    const workspaceRow = repos.getWorkspace(workspaceId)
    const llm = await resolveWorkflowLlmOptions(workspaceRow)
    if (workspaceRow?.root_path && !llm) {
      bus.emit({
        type: "log",
        runId: runRow.id,
        message: `workspace config missing or invalid for ${workspaceRow.root_path}; falling back to fake LLM adapters`,
      })
    }

    // BUG-PROJ4-QA-005: build the Supabase workflow hook when the workspace
    // has a project ref and a persistent test branch.
    const supabaseHook = buildSupabaseWorkflowHook(repos, workspaceId, workspaceRow, opts.supabaseAdapterFactory)

    const detach = attachRunSubscribers(
      bus,
      repos,
      { runId: runRow.id, itemId: itemRow.id },
      { onItemColumnChanged: opts.onItemColumnChanged },
    )

    try {
      await runWithWorkflowIO(workflowIo, async () =>
        runWithWorkflowCancellation(cancellation, () =>
          runWithActiveRun({ runId: runRow.id, itemId: itemRow.id, title: item.title }, async () => {
          assertWorkflowNotCancelled()
          bus.emit({ type: "run_started", runId: runRow.id, itemId: itemRow.id, title: item.title })
          try {
            await workflowRunner(
              { ...item, id: itemRow.id },
              {
                resume: opts.resume,
                llm,
                workspaceRoot: workspaceRow?.root_path ?? undefined,
                supabaseHook,
                supabaseReadiness: workspaceRow?.supabase_project_ref ? {
                  repos,
                  runId: runRow.id,
                  managementClient: supabaseHook?.managementClient,
                } : undefined,
                executionOwnership: {
                  repos,
                  runId: runRow.id,
                },
              },
            )
            assertWorkflowNotCancelled()
            const finalRun = repos.getRun(runRow.id)
            if (finalRun?.recovery_status) return
            await persistWorkflowRunState(
              { workspaceId, runId: runRow.id, workspaceRoot: workspaceRow?.root_path ?? undefined },
              finalRun?.current_stage ?? "handoff",
              "completed",
            )
            bus.emit({
              type: "run_finished",
              runId: runRow.id,
              itemId: itemRow.id,
              title: item.title,
              status: "completed",
            })
          } catch (err) {
            const message = (err as Error).message
            const finalRun = repos.getRun(runRow.id)
            if (finalRun?.recovery_status) {
              if (isWorkflowCancelledError(err)) throw err
              return
            }
            await persistWorkflowRunState(
              { workspaceId, runId: runRow.id, workspaceRoot: workspaceRow?.root_path ?? undefined },
              finalRun?.current_stage ?? "execution",
              "failed",
            )
            bus.emit({
              type: "run_finished",
              runId: runRow.id,
              itemId: itemRow.id,
              title: item.title,
              status: "failed",
              error: message,
            })
            throw err
          }
        }))
      )
    } finally {
      heartbeat?.stop()
      heartbeat = null
      detach()
    }
  }

  return { runId: runRow.id, itemId: itemRow.id, workspaceId, start, io, bus }
}

/** Convenience for CLI: prepare + start + await. */
export async function runWorkflowWithSync(
  item: Item,
  repos: Repos,
  io: WorkflowIO & { bus?: EventBus },
  opts: {
    workspaceKey?: string
    workspaceName?: string
    owner?: "cli" | "api"
    workerInstanceId?: string
    workerLeaseClock?: () => number
    workerLeaseScheduler?: WorkerLeaseScheduler
    workflowRunner?: typeof runWorkflow
    itemId?: string
    resume?: WorkflowResumeInput
  } = {}
): Promise<string> {
  const { runId, start } = prepareRun(item, repos, io, opts)
  await start()
  return runId
}
