import { runWorkflow } from "../workflow.js"
import type { Item } from "../types.js"
import { getWorkflowIO, hasWorkflowIO, type WorkflowEvent, type WorkflowIO } from "./io.js"
import { setActiveRun } from "./runContext.js"
import type { Repos } from "../db/repositories.js"

/**
 * Map a stage key to the UI's board column + phase status. The UI column set is
 * fixed in live-board.ts: idea | brainstorm | requirements | implementation | done.
 * The engine has more stages; we project them down to the column the card
 * should live in for each stage.
 */
export function mapStageToColumn(
  stageKey: string | undefined,
  outcome: "running" | "completed" | "failed"
): { column: "idea" | "brainstorm" | "requirements" | "implementation" | "done"; phaseStatus: "draft" | "running" | "review_required" | "completed" | "failed" } {
  const phaseStatus = outcome === "running" ? "running" : outcome === "failed" ? "failed" : "completed"
  if (!stageKey) return { column: "idea", phaseStatus: "draft" }
  switch (stageKey) {
    case "brainstorm":
      return { column: "brainstorm", phaseStatus }
    case "requirements":
      return { column: "requirements", phaseStatus }
    case "architecture":
    case "planning":
    case "execution":
    case "project-review":
    case "qa":
      return { column: "implementation", phaseStatus }
    case "documentation":
    case "handoff":
      return { column: outcome === "completed" ? "done" : "implementation", phaseStatus }
    default:
      return { column: "implementation", phaseStatus }
  }
}

/**
 * Attach a DB-sync subscriber to a WorkflowIO. Returns an unsubscribe fn.
 */
export function attachDbSync(
  io: WorkflowIO,
  repos: Repos,
  ctx: { runId: string; itemId: string }
): () => void {
  const stageRunIds = new Map<string, string>() // stageKey -> stage_runs.id
  const originalEmit = io.emit.bind(io)

  io.emit = (event: WorkflowEvent) => {
    try {
      handle(event)
    } catch (err) {
      // DB sync should never break the workflow; log and continue.
      console.error("[db-sync]", (err as Error).message)
    }
    originalEmit(event)
  }

  function handle(event: WorkflowEvent): void {
    switch (event.type) {
      case "run_started": {
        repos.updateRun(event.runId, { status: "running" })
        return
      }
      case "stage_started": {
        const stageRun = repos.createStageRun({
          runId: event.runId,
          stageKey: event.stageKey,
          projectId: event.projectId ?? null
        })
        stageRunIds.set(event.stageKey, stageRun.id)
        repos.updateRun(event.runId, { current_stage: event.stageKey })
        const { column, phaseStatus } = mapStageToColumn(event.stageKey, "running")
        repos.setItemColumn(ctx.itemId, column, phaseStatus)
        repos.appendLog({
          runId: event.runId,
          stageRunId: stageRun.id,
          eventType: "stage_started",
          message: `stage ${event.stageKey} started`
        })
        return
      }
      case "stage_completed": {
        const stageRunId = stageRunIds.get(event.stageKey)
        if (stageRunId) {
          repos.completeStageRun(stageRunId, event.status, event.error ?? null)
        }
        const { column, phaseStatus } = mapStageToColumn(event.stageKey, event.status)
        repos.setItemColumn(ctx.itemId, column, phaseStatus)
        repos.appendLog({
          runId: event.runId,
          stageRunId: stageRunId ?? null,
          eventType: "stage_completed",
          message: `stage ${event.stageKey} ${event.status}`,
          data: event.error ? { error: event.error } : undefined
        })
        return
      }
      case "prompt_requested": {
        repos.appendLog({
          runId: event.runId,
          eventType: "prompt_requested",
          message: event.prompt,
          data: { promptId: event.promptId }
        })
        return
      }
      case "prompt_answered": {
        repos.appendLog({
          runId: event.runId,
          eventType: "prompt_answered",
          message: event.answer,
          data: { promptId: event.promptId }
        })
        return
      }
      case "artifact_written": {
        repos.recordArtifact({
          runId: event.runId,
          stageRunId: event.stageRunId ?? null,
          label: event.label,
          kind: event.kind,
          path: event.path
        })
        repos.appendLog({
          runId: event.runId,
          stageRunId: event.stageRunId ?? null,
          eventType: "artifact_written",
          message: event.label,
          data: { path: event.path, kind: event.kind }
        })
        return
      }
      case "log": {
        repos.appendLog({ runId: event.runId, eventType: "log", message: event.message })
        return
      }
      case "run_finished": {
        repos.updateRun(event.runId, { status: event.status })
        const { column, phaseStatus } = mapStageToColumn("documentation", event.status)
        repos.setItemColumn(ctx.itemId, column, phaseStatus)
        repos.appendLog({
          runId: event.runId,
          eventType: "run_finished",
          message: `run ${event.status}`,
          data: event.error ? { error: event.error } : undefined
        })
        return
      }
      case "item_column_changed": {
        repos.setItemColumn(
          event.itemId,
          event.column as "idea" | "brainstorm" | "requirements" | "implementation" | "done",
          event.phaseStatus as "draft" | "running" | "review_required" | "completed" | "failed"
        )
        return
      }
    }
  }

  return () => {
    io.emit = originalEmit
  }
}

/**
 * Create the workspace/item/run records synchronously and wire up DB sync on
 * the active IO. Returns both the DB ids and a start() callback that kicks
 * off the workflow. Split like this so HTTP callers can return runId before
 * the workflow finishes.
 */
export function prepareRun(
  item: Item,
  repos: Repos,
  opts: { workspaceKey?: string; workspaceName?: string } = {}
) {
  if (!hasWorkflowIO()) {
    throw new Error("prepareRun requires an active WorkflowIO")
  }
  const io = getWorkflowIO()

  const workspace = repos.upsertWorkspace({
    key: opts.workspaceKey ?? "default",
    name: opts.workspaceName ?? "Default Workspace",
    description: "BeerEngineer2 engine workspace"
  })
  const itemRow = repos.createItem({
    workspaceId: workspace.id,
    title: item.title,
    description: item.description
  })
  const runRow = repos.createRun({
    workspaceId: workspace.id,
    itemId: itemRow.id,
    title: item.title
  })

  const detach = attachDbSync(io, repos, { runId: runRow.id, itemId: itemRow.id })

  const start = async (): Promise<void> => {
    setActiveRun({ runId: runRow.id, itemId: itemRow.id })
    io.emit({ type: "run_started", runId: runRow.id, itemId: itemRow.id, title: item.title })
    try {
      await runWorkflow({ ...item, id: itemRow.id })
      io.emit({ type: "run_finished", runId: runRow.id, status: "completed" })
    } catch (err) {
      const message = (err as Error).message
      io.emit({ type: "run_finished", runId: runRow.id, status: "failed", error: message })
      throw err
    } finally {
      setActiveRun(null)
      detach()
    }
  }

  return { runId: runRow.id, itemId: itemRow.id, workspaceId: workspace.id, start }
}

/** Convenience for CLI: prepare + start + await. */
export async function runWorkflowWithSync(
  item: Item,
  repos: Repos,
  opts: { workspaceKey?: string; workspaceName?: string } = {}
): Promise<string> {
  const { runId, start } = prepareRun(item, repos, opts)
  await start()
  return runId
}
