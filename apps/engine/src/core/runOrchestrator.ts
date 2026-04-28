import { runWorkflow } from "../workflow.js"
import type { Item } from "../types.js"
import { runWithWorkflowIO, type WorkflowEvent, type WorkflowIO } from "./io.js"
import { runWithActiveRun } from "./runContext.js"
import { createBus, busToWorkflowIO, type EventBus } from "./bus.js"
import { workflowWorkspaceId } from "./itemIdentity.js"
import { persistWorkflowRunState } from "./stageRuntime.js"
import type { ItemRow, Repos } from "../db/repositories.js"
import type { WorkflowResumeInput } from "../workflow.js"
import { attachRunSubscribers, resolveWorkflowLlmOptions } from "./runSubscribers.js"
import { mapStageToColumn } from "./boardColumns.js"
export { mapStageToColumn } from "./boardColumns.js"

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

  /**
   * Returns true when this run is the authoritative source of truth for the
   * item's displayed column/phase state.
   *
   * Rule (Option A from spec): a run may write item state only when no OTHER
   * run for the same item is currently live (status = "running" or "blocked").
   * If any sibling run is live, all writes from this run are suppressed —
   * regardless of whether this run is completing, failing, or progressing.
   *
   * This means:
   *  - A side-run (e.g. rerun_design_prep) started while a main run is live
   *    never overwrites the main run's item state, even on success or failure.
   *  - The main run keeps driving item state as long as it is the only live run.
   *  - Failed runs do not write item state via run_finished — the item retains
   *    whatever column/phase the last successful stage write set. This matches
   *    the spec's "failed runs never mutate items.current_column / phase_status".
   *
   * The `thisRunStatus` parameter lets the run_finished handler pass the
   * *incoming* event status before it mutates the DB row, so a run transitioning
   * to "failed" correctly suppresses its own run_finished item write without
   * racing against a concurrent DB read.
   */
  const isAuthoritative = (thisRunStatus?: string): boolean => {
    // A run finishing as "failed" must never write item state (Option A).
    if (thisRunStatus === "failed") return false
    const allRuns = repos.listRunsForItem(ctx.itemId)
    // Suppress writes when any OTHER run for this item is live.
    return !allRuns.some(
      r => r.id !== ctx.runId && (r.status === "running" || r.status === "blocked")
    )
  }

  /**
   * True when this run had no live sibling at the moment of a terminal/blocking
   * event. Mirrors `isAuthoritative` but **does not** apply the "failed never
   * authoritative" rule — `current_stage` clears on every terminal state of
   * the sole live run, including failure.
   *
   * `items.current_stage` semantically tracks the stage actively being driven.
   * When the run that owned the stage dies (completed, failed, or blocked) and
   * no sibling is alive to take over, the answer to "what stage is live?" is
   * "none". The mini-stepper should not keep highlighting a dead stage.
   */
  const wasSoleLiveRun = (): boolean => {
    const allRuns = repos.listRunsForItem(ctx.itemId)
    return !allRuns.some(
      r => r.id !== ctx.runId && (r.status === "running" || r.status === "blocked")
    )
  }

  const persist = (event: WorkflowEvent): void => {
    switch (event.type) {
      case "run_started": {
        repos.updateRun(event.runId, { status: "running" })
        track(repos.appendLog({
          runId: event.runId,
          eventType: "run_started",
          message: event.title,
          data: {
            itemId: event.itemId,
            title: event.title,
          },
        }))
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
        if (isAuthoritative()) {
          repos.setItemColumn(ctx.itemId, column, phaseStatus)
          repos.setItemCurrentStage(ctx.itemId, event.stageKey)
        }
        track(repos.appendLog({
          runId: event.runId,
          stageRunId: stageRun.id,
          eventType: "stage_started",
          message: `stage ${event.stageKey} started`,
          data: {
            stageRunId: stageRun.id,
            stageKey: event.stageKey,
            projectId: persistedProjectId,
          },
        }))
        return
      }
      case "stage_completed": {
        const stageRunId = event.stageRunId ?? stageRunIds.get(event.stageKey)
        if (stageRunId) {
          repos.completeStageRun(stageRunId, event.status, event.error ?? null)
        }
        const { column, phaseStatus } = mapStageToColumn(event.stageKey, event.status)
        if (isAuthoritative()) repos.setItemColumn(ctx.itemId, column, phaseStatus)
        track(repos.appendLog({
          runId: event.runId,
          stageRunId: stageRunId ?? null,
          eventType: "stage_completed",
          message: `stage ${event.stageKey} ${event.status}`,
          data: {
            stageRunId: stageRunId ?? null,
            stageKey: event.stageKey,
            status: event.status,
            error: event.error,
          },
        }))
        return
      }
      case "prompt_requested": {
        track(repos.appendLog({
          runId: event.runId,
          stageRunId: event.stageRunId ?? null,
          eventType: "prompt_requested",
          message: event.prompt,
          data: { promptId: event.promptId, prompt: event.prompt, actions: event.actions }
        }))
        return
      }
      case "prompt_answered": {
        track(repos.appendLog({
          runId: event.runId,
          eventType: "prompt_answered",
          message: event.answer,
          data: { promptId: event.promptId, answer: event.answer }
        }))
        return
      }
      case "loop_iteration": {
        track(repos.appendLog({
          runId: event.runId,
          stageRunId: event.stageRunId ?? null,
          eventType: "loop_iteration",
          message: `${event.phase} ${event.n}`,
          data: { n: event.n, phase: event.phase, stageKey: event.stageKey ?? null },
        }))
        return
      }
      case "tool_called": {
        track(repos.appendLog({
          runId: event.runId,
          stageRunId: event.stageRunId ?? null,
          eventType: "tool_called",
          message: event.name,
          data: {
            name: event.name,
            argsPreview: event.argsPreview,
            provider: event.provider,
          },
        }))
        return
      }
      case "tool_result": {
        track(repos.appendLog({
          runId: event.runId,
          stageRunId: event.stageRunId ?? null,
          eventType: "tool_result",
          message: event.name,
          data: {
            name: event.name,
            argsPreview: event.argsPreview,
            resultPreview: event.resultPreview,
            provider: event.provider,
            isError: event.isError ?? false,
          },
        }))
        return
      }
      case "llm_thinking": {
        track(repos.appendLog({
          runId: event.runId,
          stageRunId: event.stageRunId ?? null,
          eventType: "llm_thinking",
          message: event.text,
          data: { provider: event.provider, model: event.model },
        }))
        return
      }
      case "llm_tokens": {
        track(repos.appendLog({
          runId: event.runId,
          stageRunId: event.stageRunId ?? null,
          eventType: "llm_tokens",
          message: `${event.provider ?? "llm"} in=${event.in} out=${event.out}`,
          data: {
            in: event.in,
            out: event.out,
            cached: event.cached ?? 0,
            provider: event.provider,
            model: event.model,
          },
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
          data: { label: event.label, path: event.path, kind: event.kind }
        }))
        return
      }
      case "log": {
        track(repos.appendLog({
          runId: event.runId,
          eventType: "log",
          message: event.message,
          data: { level: event.level ?? "info" },
        }))
        return
      }
      case "run_finished": {
        // Snapshot authority *before* updating the run status, so the guard
        // sees the run's current (pre-mutation) status and not the new one.
        // Passing event.status tells isAuthoritative what this run is becoming,
        // so a run that is completing as "failed" correctly suppresses item writes.
        const authoritative = isAuthoritative(event.status)
        // current_stage clears on terminal events of the sole live run regardless
        // of whether column/phase writes are authoritative — a dead run owns no
        // stage even if it died by failing.
        const soleLive = wasSoleLiveRun()
        repos.updateRun(event.runId, { status: event.status })
        const item = repos.getItem(ctx.itemId)
        const { column, phaseStatus } = mapStageToColumn(item?.current_stage ?? "documentation", event.status)
        if (authoritative) {
          repos.setItemColumn(ctx.itemId, column, phaseStatus)
        }
        if (soleLive) {
          repos.setItemCurrentStage(ctx.itemId, null)
        }
        track(repos.appendLog({
          runId: event.runId,
          eventType: "run_finished",
          message: `run ${event.status}`,
          data: {
            itemId: event.itemId,
            title: event.title,
            status: event.status,
            error: event.error,
          },
        }))
        return
      }
      case "item_column_changed": {
        repos.setItemColumn(
          event.itemId,
          event.column as ItemRow["current_column"],
          event.phaseStatus as ItemRow["phase_status"]
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
          data: {
            itemId: event.itemId,
            projectId: event.projectId,
            code: event.code,
            name: event.name,
            summary: event.summary,
            position: event.position,
          },
        }))
        return
      }
      case "wireframes_ready": {
        track(repos.appendLog({
          runId: event.runId,
          eventType: "wireframes_ready",
          message: `${event.screenCount} screens ready`,
          data: { itemId: event.itemId, screenCount: event.screenCount, urls: event.urls },
        }))
        return
      }
      case "design_ready": {
        track(repos.appendLog({
          runId: event.runId,
          eventType: "design_ready",
          message: "design preview ready",
          data: { itemId: event.itemId, url: event.url },
        }))
        return
      }
      case "run_blocked":
      case "run_failed": {
        // Snapshot live-sibling state *before* mutating this run's status, so
        // a run going to "blocked" doesn't see itself as a live sibling. The
        // sibling check excludes ctx.runId anyway, but reading first is the
        // intent-preserving order.
        const soleLive = wasSoleLiveRun()
        repos.updateRun(event.runId, { status: event.type === "run_blocked" ? "blocked" : "failed" })
        if (soleLive) {
          // Dead/paused sole run owns no live stage. Column/phase stays put
          // (failed runs intentionally don't mutate them per Option A); only
          // current_stage clears so the mini-stepper doesn't lie.
          repos.setItemCurrentStage(ctx.itemId, null)
        }
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
          data: {
            itemId: "itemId" in event ? event.itemId : undefined,
            title: "title" in event ? event.title : undefined,
            cause: event.cause,
            scope,
            branch: "branch" in event ? event.branch : undefined,
          },
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
      case "merge_gate_open": {
        track(repos.appendLog({
          runId: event.runId,
          eventType: "merge_gate_open",
          message: `merge gate opened for ${event.itemBranch}`,
          data: {
            itemId: event.itemId,
            itemBranch: event.itemBranch,
            baseBranch: event.baseBranch,
            gatePromptId: event.gatePromptId,
          },
        }))
        return
      }
      case "merge_gate_cancelled": {
        track(repos.appendLog({
          runId: event.runId,
          eventType: "merge_gate_cancelled",
          message: `merge gate cancelled for ${event.itemBranch}`,
          data: {
            itemId: event.itemId,
            itemBranch: event.itemBranch,
            baseBranch: event.baseBranch,
          },
        }))
        return
      }
      case "merge_completed": {
        track(repos.appendLog({
          runId: event.runId,
          eventType: "merge_completed",
          message: `merged ${event.itemBranch} into ${event.baseBranch}`,
          data: {
            itemId: event.itemId,
            itemBranch: event.itemBranch,
            baseBranch: event.baseBranch,
            mergeSha: event.mergeSha,
          },
        }))
        return
      }
      case "worktree_port_assigned": {
        track(repos.appendLog({
          runId: event.runId ?? ctx.runId,
          eventType: "worktree_port_assigned",
          message: `${event.branch} -> ${event.port}`,
          data: {
            branch: event.branch,
            worktreePath: event.worktreePath,
            port: event.port,
          },
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
      case "wave_serialized": {
        track(repos.appendLog({
          runId: event.runId,
          eventType: "wave_serialized",
          message: `wave ${event.waveNumber} serialized`,
          data: {
            waveId: event.waveId,
            waveNumber: event.waveNumber,
            stories: event.stories,
            overlappingFiles: event.overlappingFiles,
            cause: event.cause,
          },
        }))
        return
      }
      default: {
        const exhaustive: never = event
        return exhaustive
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
 * IO factory (`createCliIO` / `runService.buildApiIo`) since it's a transport
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
  // The engine derives the on-disk workspace dir from the item title +
  // item_id. Persist it so resume doesn't have to re-derive from a mutable
  // title or scan every workspace directory.
  const workspaceFsId = workflowWorkspaceId(itemRow)
  const runRow = repos.createRun({
    workspaceId,
    itemId: itemRow.id,
    title: item.title,
    owner: opts.owner ?? "api",
    workspaceFsId,
  })

  // Every caller now passes a bus-backed io (createCliIO / runService.buildApiIo
  // both expose `.bus`). If for some reason a bare io slipped in, synthesize
  // a local bus so subscribers still attach somewhere — but this should be
  // considered a bug upstream.
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
    const detach = attachRunSubscribers(bus, repos, { runId: runRow.id, itemId: itemRow.id })
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
            bus.emit({ type: "run_finished", runId: runRow.id, itemId: itemRow.id, title: item.title, status: "completed" })
          } catch (err) {
            const message = (err as Error).message
            const finalRun = repos.getRun(runRow.id)
            if (finalRun?.recovery_status !== "blocked") {
              await persistWorkflowRunState(
                { workspaceId, runId: runRow.id, workspaceRoot: workspaceRow?.root_path ?? undefined },
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
      "(createCliIO / runService.buildApiIo) or call attachDbSync(bus, repos, ctx) directly."
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
