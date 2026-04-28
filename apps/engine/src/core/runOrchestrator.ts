import type { Item } from "../types.js"
import type { Repos } from "../db/repositories.js"
import { runWorkflow, type WorkflowResumeInput } from "../workflow.js"
import { createBus, type EventBus } from "./bus.js"
import { workflowWorkspaceId } from "./itemIdentity.js"
import { runWithWorkflowIO, type WorkflowIO } from "./io.js"
import { attachRunSubscribers, resolveWorkflowLlmOptions } from "./runSubscribers.js"
import { runWithActiveRun } from "./runContext.js"
import { persistWorkflowRunState } from "./stageRuntime.js"

export { attachDbSync, type AttachDbSyncOptions } from "./dbSync.js"
/* c8 ignore next -- pure re-export */
export { mapStageToColumn } from "./boardColumns.js"
export { busToWorkflowIO } from "./bus.js"
export type { WorkflowEvent } from "./io.js"

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
    itemId?: string
    resume?: WorkflowResumeInput
    /** Forwarded to `attachRunSubscribers`; see `AttachDbSyncOptions.onItemColumnChanged`. */
    onItemColumnChanged?: (payload: { itemId: string; from: string; to: string; phaseStatus: string }) => void
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
  const runRow = repos.createRun({
    workspaceId,
    itemId: itemRow.id,
    title: item.title,
    owner: opts.owner ?? "api",
    workspaceFsId,
  })

  const bus = io.bus ?? createBus()

  const start = async (): Promise<void> => {
    const workspaceRow = repos.getWorkspace(workspaceId)
    const llm = await resolveWorkflowLlmOptions(workspaceRow)
    if (workspaceRow?.root_path && !llm) {
      bus.emit({
        type: "log",
        runId: runRow.id,
        message: `workspace config missing or invalid for ${workspaceRow.root_path}; falling back to fake LLM adapters`,
      })
    }

    const detach = attachRunSubscribers(
      bus,
      repos,
      { runId: runRow.id, itemId: itemRow.id },
      { onItemColumnChanged: opts.onItemColumnChanged },
    )

    try {
      await runWithWorkflowIO(io, async () =>
        runWithActiveRun({ runId: runRow.id, itemId: itemRow.id, title: item.title }, async () => {
          bus.emit({ type: "run_started", runId: runRow.id, itemId: itemRow.id, title: item.title })
          try {
            await runWorkflow(
              { ...item, id: itemRow.id },
              {
                resume: opts.resume,
                llm,
                workspaceRoot: workspaceRow?.root_path ?? undefined,
              },
            )
            const finalRun = repos.getRun(runRow.id)
            if (finalRun?.recovery_status === "blocked") return
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
            if (finalRun?.recovery_status !== "blocked") {
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
            }
            throw err
          }
        })
      )
    } finally {
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
    itemId?: string
    resume?: WorkflowResumeInput
  } = {}
): Promise<string> {
  const { runId, start } = prepareRun(item, repos, io, opts)
  await start()
  return runId
}
