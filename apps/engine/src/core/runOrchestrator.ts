import { runWorkflow } from "../workflow.js"
import type { Item } from "../types.js"
import { runWithWorkflowIO, type WorkflowEvent, type WorkflowIO } from "./io.js"
import { runWithActiveRun } from "./runContext.js"
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
 * Wrap a WorkflowIO so every emitted event is also persisted to the DB.
 * Returns a *new* IO that delegates to the inner one — no mutation of `inner`,
 * no monkey-patching of `emit`. This makes layering composable: callers can
 * stack `withDbSync(withMetrics(inner))` and the order is explicit.
 *
 * The returned IO also enriches events with `streamId` + `at` derived from
 * the persisted log row, so SSE clients can dedup replay vs live events.
 */
export function withDbSync(
  inner: WorkflowIO,
  repos: Repos,
  ctx: { runId: string; itemId: string }
): WorkflowIO {
  const stageRunIds = new Map<string, string>() // stageKey -> stage_runs.id
  const persistedStageIds = new Set<string>()    // dedup re-emits of stage_started

  /** Return a shallow clone of `event` stamped with persistence metadata. */
  function withPersistedMeta(event: WorkflowEvent, row: { id: string; created_at: number }): WorkflowEvent {
    return { ...event, streamId: row.id, at: row.created_at } as WorkflowEvent
  }

  /** Apply DB writes for `event`. Returns a possibly-enriched event to forward. */
  function persist(event: WorkflowEvent): WorkflowEvent {
    switch (event.type) {
      case "run_started": {
        repos.updateRun(event.runId, { status: "running" })
        return event
      }
      case "stage_started": {
        // Idempotent: a re-emit of the same stageRunId must not throw on the
        // unique index. We treat the first persisted row as authoritative.
        if (persistedStageIds.has(event.stageRunId)) {
          return event
        }
        const stageRun = repos.createStageRun({
          id: event.stageRunId,
          runId: event.runId,
          stageKey: event.stageKey,
          projectId: event.projectId ?? null
        })
        persistedStageIds.add(stageRun.id)
        stageRunIds.set(event.stageKey, stageRun.id)
        repos.updateRun(event.runId, { current_stage: event.stageKey })
        const { column, phaseStatus } = mapStageToColumn(event.stageKey, "running")
        repos.setItemColumn(ctx.itemId, column, phaseStatus)
        return withPersistedMeta(event, repos.appendLog({
          runId: event.runId,
          stageRunId: stageRun.id,
          eventType: "stage_started",
          message: `stage ${event.stageKey} started`
        }))
      }
      case "stage_completed": {
        const stageRunId = stageRunIds.get(event.stageKey)
        if (stageRunId) {
          repos.completeStageRun(stageRunId, event.status, event.error ?? null)
        }
        const { column, phaseStatus } = mapStageToColumn(event.stageKey, event.status)
        repos.setItemColumn(ctx.itemId, column, phaseStatus)
        return withPersistedMeta(event, repos.appendLog({
          runId: event.runId,
          stageRunId: stageRunId ?? null,
          eventType: "stage_completed",
          message: `stage ${event.stageKey} ${event.status}`,
          data: event.error ? { error: event.error } : undefined
        }))
      }
      case "prompt_requested": {
        return withPersistedMeta(event, repos.appendLog({
          runId: event.runId,
          eventType: "prompt_requested",
          message: event.prompt,
          data: { promptId: event.promptId }
        }))
      }
      case "prompt_answered": {
        return withPersistedMeta(event, repos.appendLog({
          runId: event.runId,
          eventType: "prompt_answered",
          message: event.answer,
          data: { promptId: event.promptId }
        }))
      }
      case "artifact_written": {
        repos.recordArtifact({
          runId: event.runId,
          stageRunId: event.stageRunId ?? null,
          label: event.label,
          kind: event.kind,
          path: event.path
        })
        return withPersistedMeta(event, repos.appendLog({
          runId: event.runId,
          stageRunId: event.stageRunId ?? null,
          eventType: "artifact_written",
          message: event.label,
          data: { path: event.path, kind: event.kind }
        }))
      }
      case "log": {
        return withPersistedMeta(event, repos.appendLog({
          runId: event.runId,
          eventType: "log",
          message: event.message
        }))
      }
      case "run_finished": {
        repos.updateRun(event.runId, { status: event.status })
        const { column, phaseStatus } = mapStageToColumn("documentation", event.status)
        repos.setItemColumn(ctx.itemId, column, phaseStatus)
        return withPersistedMeta(event, repos.appendLog({
          runId: event.runId,
          eventType: "run_finished",
          message: `run ${event.status}`,
          data: event.error ? { error: event.error } : undefined
        }))
      }
      case "item_column_changed": {
        repos.setItemColumn(
          event.itemId,
          event.column as "idea" | "brainstorm" | "requirements" | "implementation" | "done",
          event.phaseStatus as "draft" | "running" | "review_required" | "completed" | "failed"
        )
        return event
      }
      case "project_created": {
        repos.createProject({
          id: event.projectId,
          itemId: event.itemId,
          code: event.code,
          name: event.name,
          summary: event.summary,
          status: "draft",
          position: event.position
        })
        return withPersistedMeta(event, repos.appendLog({
          runId: event.runId,
          eventType: "project_created",
          message: event.name,
          data: { projectId: event.projectId, code: event.code, position: event.position }
        }))
      }
    }
  }

  return {
    ask: inner.ask.bind(inner),
    close: inner.close ? inner.close.bind(inner) : undefined,
    emit(event: WorkflowEvent): void {
      let toForward = event
      try {
        toForward = persist(event)
      } catch (err) {
        // DB sync must never break the workflow. Forward the un-enriched
        // event so SSE clients still see it, and log for diagnosis.
        console.error("[db-sync]", (err as Error).message)
      }
      inner.emit(toForward)
    }
  }
}

/**
 * @deprecated Use `withDbSync()` which returns a wrapped IO instead of
 * mutating its argument. Kept for callers that still rely on the old
 * mutate-and-detach contract.
 */
export function attachDbSync(
  io: WorkflowIO,
  repos: Repos,
  ctx: { runId: string; itemId: string }
): () => void {
  const originalEmit = io.emit.bind(io)
  // The inner the wrapper sees must call the *original* emit, otherwise
  // io.emit (which we re-point to the wrapper below) would recurse forever.
  const inner: WorkflowIO = {
    ask: io.ask.bind(io),
    close: io.close ? io.close.bind(io) : undefined,
    emit: originalEmit
  }
  const wrapped = withDbSync(inner, repos, ctx)
  io.emit = wrapped.emit.bind(wrapped)
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
  io: WorkflowIO,
  opts: { workspaceKey?: string; workspaceName?: string } = {}
) {
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

  const dbSyncedIo = withDbSync(io, repos, { runId: runRow.id, itemId: itemRow.id })

  const start = async (): Promise<void> => {
    await runWithWorkflowIO(dbSyncedIo, async () =>
      runWithActiveRun({ runId: runRow.id, itemId: itemRow.id }, async () => {
        dbSyncedIo.emit({ type: "run_started", runId: runRow.id, itemId: itemRow.id, title: item.title })
        try {
          await runWorkflow({ ...item, id: itemRow.id })
          dbSyncedIo.emit({ type: "run_finished", runId: runRow.id, status: "completed" })
        } catch (err) {
          const message = (err as Error).message
          dbSyncedIo.emit({ type: "run_finished", runId: runRow.id, status: "failed", error: message })
          throw err
        }
      })
    )
  }

  return { runId: runRow.id, itemId: itemRow.id, workspaceId: workspace.id, start, io: dbSyncedIo }
}

/** Convenience for CLI: prepare + start + await. */
export async function runWorkflowWithSync(
  item: Item,
  repos: Repos,
  io: WorkflowIO,
  opts: { workspaceKey?: string; workspaceName?: string } = {}
): Promise<string> {
  const { runId, start } = prepareRun(item, repos, io, opts)
  await start()
  return runId
}
