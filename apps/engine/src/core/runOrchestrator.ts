import { runWorkflow } from "../workflow.js"
import type { Item } from "../types.js"
import { runWithWorkflowIO, type WorkflowEvent, type WorkflowIO } from "./io.js"
import { runWithActiveRun } from "./runContext.js"
import { createBus, busToWorkflowIO, type EventBus } from "./bus.js"
import { attachCrossProcessBridge } from "./crossProcessBridge.js"
import { persistWorkflowRunState } from "./stageRuntime.js"
import type { Repos } from "../db/repositories.js"
import { readWorkspaceConfig } from "./workspaces.js"
import type { WorkflowLlmOptions, WorkflowResumeInput } from "../workflow.js"
import { attachTelegramNotifications } from "../notifications/index.js"
import { defaultAppConfig, readConfigFile, resolveConfigPath, resolveMergedConfig, resolveOverrides } from "../setup/config.js"

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

export type AttachDbSyncOptions = {
  /**
   * When provided, every `stage_logs.id` this subscriber writes is recorded
   * into this set. The cross-process bridge uses the set to filter out
   * locally-written rows when it tails the shared log stream, so we only
   * re-emit foreign events onto the local bus.
   */
  writtenLogIds?: Set<string>
}

/**
 * Subscribe a DB-sync middleware to the bus. Every emitted `WorkflowEvent`
 * is persisted to the appropriate table (runs, stage_runs, stage_logs,
 * artifact_files, items.current_column, projects). Returns the unsubscribe
 * function.
 *
 * The subscriber does **not** transform the event stream — persistence is a
 * pure side effect. Downstream subscribers (SSE bridge, renderers) see the
 * original emitted event. SSE clients dedup replay vs. live via `stage_logs.id`,
 * which is the only streamId that matters now that SSE reads from the log
 * directly.
 */
export function attachDbSync(
  bus: EventBus,
  repos: Repos,
  ctx: { runId: string; itemId: string },
  opts: AttachDbSyncOptions = {}
): () => void {
  const stageRunIds = new Map<string, string>()
  const persistedStageIds = new Set<string>()
  const persistedProjectIds = new Map<string, string>()

  const track = (row: { id: string } | undefined): void => {
    if (!row) return
    opts.writtenLogIds?.add(row.id)
  }

  const persist = (event: WorkflowEvent): void => {
    switch (event.type) {
      case "run_started": {
        repos.updateRun(event.runId, { status: "running" })
        return
      }
      case "stage_started": {
        if (persistedStageIds.has(event.stageRunId)) return
        const persistedProjectId = event.projectId
          ? persistedProjectIds.get(event.projectId) ?? event.projectId
          : null
        const stageRun = repos.createStageRun({
          id: event.stageRunId,
          runId: event.runId,
          stageKey: event.stageKey,
          projectId: persistedProjectId
        })
        persistedStageIds.add(stageRun.id)
        stageRunIds.set(event.stageKey, stageRun.id)
        repos.updateRun(event.runId, { current_stage: event.stageKey })
        const { column, phaseStatus } = mapStageToColumn(event.stageKey, "running")
        repos.setItemColumn(ctx.itemId, column, phaseStatus)
        track(repos.appendLog({
          runId: event.runId,
          stageRunId: stageRun.id,
          eventType: "stage_started",
          message: `stage ${event.stageKey} started`
        }))
        return
      }
      case "stage_completed": {
        const stageRunId = event.stageRunId ?? stageRunIds.get(event.stageKey)
        if (stageRunId) {
          repos.completeStageRun(stageRunId, event.status, event.error ?? null)
        }
        const { column, phaseStatus } = mapStageToColumn(event.stageKey, event.status)
        repos.setItemColumn(ctx.itemId, column, phaseStatus)
        track(repos.appendLog({
          runId: event.runId,
          stageRunId: stageRunId ?? null,
          eventType: "stage_completed",
          message: `stage ${event.stageKey} ${event.status}`,
          data: event.error ? { error: event.error } : undefined
        }))
        return
      }
      case "prompt_requested": {
        track(repos.appendLog({
          runId: event.runId,
          stageRunId: event.stageRunId ?? null,
          eventType: "prompt_requested",
          message: event.prompt,
          data: { promptId: event.promptId }
        }))
        return
      }
      case "prompt_answered": {
        track(repos.appendLog({
          runId: event.runId,
          eventType: "prompt_answered",
          message: event.answer,
          data: { promptId: event.promptId }
        }))
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
        track(repos.appendLog({
          runId: event.runId,
          stageRunId: event.stageRunId ?? null,
          eventType: "artifact_written",
          message: event.label,
          data: { path: event.path, kind: event.kind }
        }))
        return
      }
      case "log": {
        track(repos.appendLog({
          runId: event.runId,
          eventType: "log",
          message: event.message
        }))
        return
      }
      case "run_finished": {
        repos.updateRun(event.runId, { status: event.status })
        const { column, phaseStatus } = mapStageToColumn("documentation", event.status)
        repos.setItemColumn(ctx.itemId, column, phaseStatus)
        track(repos.appendLog({
          runId: event.runId,
          eventType: "run_finished",
          message: `run ${event.status}`,
          data: event.error ? { error: event.error } : undefined
        }))
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
      case "project_created": {
        const project = repos.createProject({
          id: event.projectId,
          itemId: event.itemId,
          code: event.code,
          name: event.name,
          summary: event.summary,
          status: "draft",
          position: event.position
        })
        persistedProjectIds.set(event.projectId, project.id)
        track(repos.appendLog({
          runId: event.runId,
          eventType: "project_created",
          message: event.name,
          data: { projectId: event.projectId, code: event.code, position: event.position }
        }))
        return
      }
      case "run_blocked":
      case "run_failed": {
        repos.updateRun(event.runId, { status: event.type === "run_blocked" ? "blocked" : "failed" })
        const scope = event.scope
        const scopeRefVal =
          scope.type === "stage"
            ? scope.stageId
            : scope.type === "story"
            ? `${scope.waveNumber}/${scope.storyId}`
            : null
        repos.setRunRecovery(event.runId, {
          status: event.type === "run_blocked" ? "blocked" : "failed",
          scope: scope.type,
          scopeRef: scopeRefVal,
          summary: event.summary
        })
        track(repos.appendLog({
          runId: event.runId,
          eventType: event.type,
          message: event.summary,
          data: { cause: event.cause, scope, branch: "branch" in event ? event.branch : undefined }
        }))
        return
      }
      case "external_remediation_recorded": {
        track(repos.appendLog({
          runId: event.runId,
          eventType: "external_remediation_recorded",
          message: event.summary,
          data: { remediationId: event.remediationId, scope: event.scope, branch: event.branch }
        }))
        return
      }
      case "run_resumed": {
        repos.clearRunRecovery(event.runId)
        track(repos.appendLog({
          runId: event.runId,
          eventType: "run_resumed",
          message: `run resumed from ${event.scope.type} scope`,
          data: { remediationId: event.remediationId, scope: event.scope }
        }))
        return
      }
      case "chat_message": {
        track(repos.appendLog({
          runId: event.runId,
          stageRunId: event.stageRunId ?? null,
          eventType: "chat_message",
          message: event.text,
          data: {
            role: event.role,
            source: event.source,
            requiresResponse: event.requiresResponse ?? false,
          },
        }))
        return
      }
      case "presentation": {
        // `stagePresent.*` callers only emit presentation events when an
        // active run context is set, so runId is expected. If something
        // slips through without one (e.g. a test stub), drop silently —
        // the local bus has already delivered it to subscribers.
        if (!event.runId) return
        track(repos.appendLog({
          runId: event.runId,
          stageRunId: event.stageRunId ?? null,
          eventType: "presentation",
          message: event.text,
          data: {
            kind: event.kind,
            meta: event.meta,
          },
        }))
        return
      }
    }
  }

  return bus.subscribe(event => {
    try {
      persist(event)
    } catch (err) {
      // DB sync must never break the workflow. Log and carry on — the local
      // bus has already delivered to other subscribers.
      console.error("[db-sync]", (err as Error).message)
    }
  })
}

/**
 * Create the workspace/item/run records synchronously and wire up the full
 * shared-transport stack on the active bus. Returns both the DB ids and a
 * `start()` callback that kicks off the workflow. Split like this so HTTP
 * callers can return runId before the workflow finishes.
 *
 * The bus has three subscribers attached inside `start()`:
 *   1. `attachDbSync` — the projection onto `runs/stage_runs/stage_logs/…`.
 *   2. `attachCrossProcessBridge` — tails `stage_logs` for answers/events
 *       written by *another* process (typically the API server writing an
 *       answer submitted by the UI) and re-emits them locally so the CLI's
 *       in-process bus wakes up.
 *   3. Whatever renderer the caller wired up (humanCli, NDJSON, SSE bridge).
 *
 * Prompt persistence (`withPromptPersistence`) is attached earlier by the
 * IO factory (`createCliIO` / `createApiIOSession`) since it's a transport
 * obligation, not a per-run concern.
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
          description: "BeerEngineer2 engine workspace"
        }).id,
        title: item.title,
        description: item.description
      })
  const workspaceId = itemRow.workspace_id
  const runRow = repos.createRun({
    workspaceId,
    itemId: itemRow.id,
    title: item.title,
    owner: opts.owner ?? "api"
  })

  // Every caller now passes a bus-backed io (createCliIO / createApiIOSession
  // both expose `.bus`). If for some reason a bare io slipped in, synthesize
  // a local bus so subscribers still attach somewhere — but this should be
  // considered a bug upstream.
  const bus = io.bus ?? createBus()
  const writtenLogIds = new Set<string>()
  const notificationConfig =
    resolveMergedConfig(readConfigFile(resolveConfigPath(resolveOverrides())), resolveOverrides()) ?? defaultAppConfig()

  const start = async (): Promise<void> => {
    const workspaceRow = repos.getWorkspace(workspaceId)
    let llm: WorkflowLlmOptions | undefined
    if (workspaceRow?.root_path) {
      // When the workspace config is missing or invalid, fall through to the
      // fake-adapter path instead of throwing — legacy rows that predate the
      // v2 schema need to keep working until they're backfilled.
      const workspaceConfig = await readWorkspaceConfig(workspaceRow.root_path)
      if (workspaceConfig) {
        const stageConfig = {
          workspaceRoot: workspaceRow.root_path,
          harnessProfile: workspaceConfig.harnessProfile,
          runtimePolicy: workspaceConfig.runtimePolicy,
        }
        llm = {
          stage: stageConfig,
          execution: {
            stage: stageConfig,
            executionCoder: stageConfig,
          },
        }
      } else {
        bus.emit({
          type: "log",
          runId: runRow.id,
          message: `workspace config missing or invalid for ${workspaceRow.root_path}; falling back to fake LLM adapters`,
        })
      }
    }
    const detachDbSync = attachDbSync(bus, repos, { runId: runRow.id, itemId: itemRow.id }, { writtenLogIds })
    const detachTelegram = attachTelegramNotifications(bus, repos, notificationConfig)
    const detachBridge = attachCrossProcessBridge(bus, repos, runRow.id, { writtenLogIds })
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
              { workspaceId, runId: runRow.id },
              finalRun?.current_stage ?? "handoff",
              "completed",
            )
            bus.emit({ type: "run_finished", runId: runRow.id, itemId: itemRow.id, title: item.title, status: "completed" })
          } catch (err) {
            const message = (err as Error).message
            const finalRun = repos.getRun(runRow.id)
            if (finalRun?.recovery_status !== "blocked") {
              await persistWorkflowRunState(
                { workspaceId, runId: runRow.id },
                finalRun?.current_stage ?? "execution",
                "failed",
              )
              bus.emit({ type: "run_finished", runId: runRow.id, itemId: itemRow.id, title: item.title, status: "failed", error: message })
            }
            throw err
          }
        })
      )
    } finally {
      detachBridge()
      detachTelegram?.()
      detachDbSync()
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

/**
 * Compatibility shim used by `/resume` and a couple of legacy tests. Attaches
 * a dbSync subscriber to the io's bus and returns the same io. The signature
 * mimics the old wrapper so call-sites don't have to change simultaneously.
 *
 * @deprecated Prefer `attachDbSync(bus, …)` directly; this exists only to
 * bridge the transition.
 */
export function withDbSync(
  inner: WorkflowIO & { bus?: EventBus },
  repos: Repos,
  ctx: { runId: string; itemId: string }
): WorkflowIO {
  const bus = inner.bus
  if (!bus) {
    throw new Error(
      "withDbSync: inner io has no attached bus. Pass a bus-backed io " +
      "(createCliIO / createApiIOSession) or call attachDbSync(bus, repos, ctx) directly."
    )
  }
  attachDbSync(bus, repos, ctx)
  return inner
}

/**
 * Re-export `busToWorkflowIO` so tests that need a throwaway bus-backed io
 * can build one without reaching into `bus.ts`.
 */
export { busToWorkflowIO }

/**
 * Explicit type re-export for legacy imports.
 */
export type { WorkflowEvent }
