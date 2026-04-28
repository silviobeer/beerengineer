import { runWorkflow } from "../workflow.js"
import type { Item } from "../types.js"
import { runWithWorkflowIO, type WorkflowEvent, type WorkflowIO } from "./io.js"
import { runWithActiveRun } from "./runContext.js"
import { createBus, type EventBus } from "./bus.js"
import { workflowWorkspaceId } from "./itemIdentity.js"
import { persistWorkflowRunState } from "./stageRuntime.js"
import type { ItemRow, Repos } from "../db/repositories.js"
import type { WorkflowResumeInput } from "../workflow.js"
import { attachRunSubscribers, resolveWorkflowLlmOptions } from "./runSubscribers.js"
import { mapStageToColumn } from "./boardColumns.js"
/* c8 ignore next -- pure re-export */
export { mapStageToColumn } from "./boardColumns.js"

export type AttachDbSyncOptions = {
  /**
   * When provided, every `stage_logs.id` this subscriber writes is recorded
   * into this set. The cross-process bridge uses the set to filter out
   * locally-written rows when it tails the shared log stream, so we only
   * re-emit foreign events onto the local bus.
   */
  writtenLogIds?: Set<string>
  /**
   * Called after every authoritative `setItemColumn` write so that the API
   * server's board-stream can push an `item_column_changed` SSE frame to
   * connected UI clients. Mirrors the operator-driven path in `itemActions.ts`.
   *
   * Only invoked when `isAuthoritative()` is true — i.e. this run is the sole
   * live run for the item. The payload matches the shape the UI's SSEContext
   * already parses: `{ itemId, from, to, phaseStatus }`.
   */
  onItemColumnChanged?: (payload: { itemId: string; from: string; to: string; phaseStatus: string }) => void
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

  const eventHandlers: Partial<Record<WorkflowEvent["type"], (event: WorkflowEvent) => void>> = {
    run_started: event => persistRunStartedEvent(repos, track, event as Extract<WorkflowEvent, { type: "run_started" }>),
    stage_started: event => persistStageStartedEvent(repos, track, event as Extract<WorkflowEvent, { type: "stage_started" }>, {
      persistedStageIds,
      persistedProjectIds,
      stageRunIds,
      itemId: ctx.itemId,
      isAuthoritative,
      onItemColumnChanged: opts.onItemColumnChanged,
    }),
    stage_completed: event => persistStageCompletedEvent(
      repos,
      track,
      event as Extract<WorkflowEvent, { type: "stage_completed" }>,
      stageRunIds,
      { itemId: ctx.itemId, isAuthoritative, onItemColumnChanged: opts.onItemColumnChanged },
    ),
    prompt_requested: event => persistPromptRequestedEvent(repos, track, event as Extract<WorkflowEvent, { type: "prompt_requested" }>),
    prompt_answered: event => persistPromptAnsweredEvent(repos, track, event as Extract<WorkflowEvent, { type: "prompt_answered" }>),
    loop_iteration: event => persistLoopIterationEvent(repos, track, event as Extract<WorkflowEvent, { type: "loop_iteration" }>),
    review_feedback: event => persistReviewFeedbackEvent(repos, track, event as Extract<WorkflowEvent, { type: "review_feedback" }>),
    tool_called: event => persistToolCalledEvent(repos, track, event as Extract<WorkflowEvent, { type: "tool_called" }>),
    tool_result: event => persistToolResultEvent(repos, track, event as Extract<WorkflowEvent, { type: "tool_result" }>),
    llm_thinking: event => persistLlmThinkingEvent(repos, track, event as Extract<WorkflowEvent, { type: "llm_thinking" }>),
    llm_tokens: event => persistLlmTokensEvent(repos, track, event as Extract<WorkflowEvent, { type: "llm_tokens" }>),
    artifact_written: event => persistArtifactWrittenEvent(repos, track, event as Extract<WorkflowEvent, { type: "artifact_written" }>),
    log: event => persistLogEvent(repos, track, event as Extract<WorkflowEvent, { type: "log" }>),
    run_finished: event => persistRunFinishedEvent(
      repos,
      track,
      event as Extract<WorkflowEvent, { type: "run_finished" }>,
      ctx.itemId,
      isAuthoritative,
      wasSoleLiveRun,
      opts.onItemColumnChanged,
    ),
    item_column_changed: event => persistItemColumnChangedEvent(repos, event as Extract<WorkflowEvent, { type: "item_column_changed" }>),
    project_created: event => persistProjectCreatedEvent(repos, track, event as Extract<WorkflowEvent, { type: "project_created" }>, persistedProjectIds),
    wireframes_ready: event => persistWireframesReadyEvent(repos, track, event as Extract<WorkflowEvent, { type: "wireframes_ready" }>),
    design_ready: event => persistDesignReadyEvent(repos, track, event as Extract<WorkflowEvent, { type: "design_ready" }>),
    run_blocked: event => persistRunRecoveryEvent(repos, track, event as Extract<WorkflowEvent, { type: "run_blocked" }>, ctx.itemId, wasSoleLiveRun),
    run_failed: event => persistRunRecoveryEvent(repos, track, event as Extract<WorkflowEvent, { type: "run_failed" }>, ctx.itemId, wasSoleLiveRun),
    external_remediation_recorded: event => persistExternalRemediationRecordedEvent(
      repos,
      track,
      event as Extract<WorkflowEvent, { type: "external_remediation_recorded" }>,
    ),
    run_resumed: event => persistRunResumedEvent(repos, track, event as Extract<WorkflowEvent, { type: "run_resumed" }>),
    merge_gate_open: event => persistMergeGateOpenEvent(repos, track, event as Extract<WorkflowEvent, { type: "merge_gate_open" }>),
    merge_gate_cancelled: event => persistMergeGateCancelledEvent(repos, track, event as Extract<WorkflowEvent, { type: "merge_gate_cancelled" }>),
    merge_completed: event => persistMergeCompletedEvent(repos, track, event as Extract<WorkflowEvent, { type: "merge_completed" }>),
    worktree_port_assigned: event => persistWorktreePortAssignedEvent(
      repos,
      track,
      event as Extract<WorkflowEvent, { type: "worktree_port_assigned" }>,
      ctx.runId,
    ),
    chat_message: event => persistChatMessageEvent(repos, track, event as Extract<WorkflowEvent, { type: "chat_message" }>),
    presentation: event => persistPresentationEvent(repos, track, event as Extract<WorkflowEvent, { type: "presentation" }>),
    wave_serialized: event => persistWaveSerializedEvent(repos, track, event as Extract<WorkflowEvent, { type: "wave_serialized" }>),
  }

  const persist = (event: WorkflowEvent): void => {
    eventHandlers[event.type]?.(event)
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

function persistRunStartedEvent(
  repos: Repos,
  track: (row: { id: string } | undefined) => void,
  event: Extract<WorkflowEvent, { type: "run_started" }>,
): void {
  repos.updateRun(event.runId, { status: "running" })
  track(repos.appendLog({
    runId: event.runId,
    eventType: "run_started",
    message: event.title,
    data: { itemId: event.itemId, title: event.title },
  }))
}

function persistStageStartedEvent(
  repos: Repos,
  track: (row: { id: string } | undefined) => void,
  event: Extract<WorkflowEvent, { type: "stage_started" }>,
  state: {
    persistedStageIds: Set<string>
    persistedProjectIds: Map<string, string>
    stageRunIds: Map<string, string>
    itemId: string
    isAuthoritative: () => boolean
    onItemColumnChanged?: AttachDbSyncOptions["onItemColumnChanged"]
  },
): void {
  if (state.persistedStageIds.has(event.stageRunId)) return
  const persistedProjectId = event.projectId
    ? state.persistedProjectIds.get(event.projectId) ?? event.projectId
    : null
  const stageRun = repos.createStageRun({
    id: event.stageRunId,
    runId: event.runId,
    stageKey: event.stageKey,
    projectId: persistedProjectId,
  })
  state.persistedStageIds.add(stageRun.id)
  state.stageRunIds.set(event.stageKey, stageRun.id)
  repos.updateRun(event.runId, { current_stage: event.stageKey })
  const { column, phaseStatus } = mapStageToColumn(event.stageKey, "running")
  if (state.isAuthoritative()) {
    const from = repos.getItem(state.itemId)?.current_column ?? "idea"
    repos.setItemColumn(state.itemId, column, phaseStatus)
    repos.setItemCurrentStage(state.itemId, event.stageKey)
    state.onItemColumnChanged?.({ itemId: state.itemId, from, to: column, phaseStatus })
  }
  track(repos.appendLog({
    runId: event.runId,
    stageRunId: stageRun.id,
    eventType: "stage_started",
    message: `stage ${event.stageKey} started`,
    data: { stageRunId: stageRun.id, stageKey: event.stageKey, projectId: persistedProjectId },
  }))
}

function persistStageCompletedEvent(
  repos: Repos,
  track: (row: { id: string } | undefined) => void,
  event: Extract<WorkflowEvent, { type: "stage_completed" }>,
  stageRunIds: Map<string, string>,
  state: {
    itemId: string
    isAuthoritative: () => boolean
    onItemColumnChanged?: AttachDbSyncOptions["onItemColumnChanged"]
  },
): void {
  const stageRunId = event.stageRunId ?? stageRunIds.get(event.stageKey)
  if (stageRunId) {
    repos.completeStageRun(stageRunId, event.status, event.error ?? null)
  }
  const { column, phaseStatus } = mapStageToColumn(event.stageKey, event.status)
  if (state.isAuthoritative()) {
    const from = repos.getItem(state.itemId)?.current_column ?? "idea"
    repos.setItemColumn(state.itemId, column, phaseStatus)
    state.onItemColumnChanged?.({ itemId: state.itemId, from, to: column, phaseStatus })
  }
  track(repos.appendLog({
    runId: event.runId,
    stageRunId: stageRunId ?? null,
    eventType: "stage_completed",
    message: `stage ${event.stageKey} ${event.status}`,
    data: { stageRunId: stageRunId ?? null, stageKey: event.stageKey, status: event.status, error: event.error },
  }))
}

function persistPromptRequestedEvent(
  repos: Repos,
  track: (row: { id: string } | undefined) => void,
  event: Extract<WorkflowEvent, { type: "prompt_requested" }>,
): void {
  track(repos.appendLog({
    runId: event.runId,
    stageRunId: event.stageRunId ?? null,
    eventType: "prompt_requested",
    message: event.prompt,
    data: { promptId: event.promptId, prompt: event.prompt, actions: event.actions }
  }))
}

function persistPromptAnsweredEvent(
  repos: Repos,
  track: (row: { id: string } | undefined) => void,
  event: Extract<WorkflowEvent, { type: "prompt_answered" }>,
): void {
  track(repos.appendLog({
    runId: event.runId,
    eventType: "prompt_answered",
    message: event.answer,
    data: { promptId: event.promptId, answer: event.answer }
  }))
}

function persistLoopIterationEvent(
  repos: Repos,
  track: (row: { id: string } | undefined) => void,
  event: Extract<WorkflowEvent, { type: "loop_iteration" }>,
): void {
  track(repos.appendLog({
    runId: event.runId,
    stageRunId: event.stageRunId ?? null,
    eventType: "loop_iteration",
    message: `${event.phase} ${event.n}`,
    data: { n: event.n, phase: event.phase, stageKey: event.stageKey ?? null },
  }))
}

function persistReviewFeedbackEvent(
  repos: Repos,
  track: (row: { id: string } | undefined) => void,
  event: Extract<WorkflowEvent, { type: "review_feedback" }>,
): void {
  track(repos.appendLog({
    runId: event.runId,
    stageRunId: event.stageRunId ?? null,
    eventType: "review_feedback",
    message: event.feedback,
    data: { cycle: event.cycle, feedback: event.feedback, stageKey: event.stageKey ?? null },
  }))
}

function persistToolCalledEvent(
  repos: Repos,
  track: (row: { id: string } | undefined) => void,
  event: Extract<WorkflowEvent, { type: "tool_called" }>,
): void {
  track(repos.appendLog({
    runId: event.runId,
    stageRunId: event.stageRunId ?? null,
    eventType: "tool_called",
    message: event.name,
    data: { name: event.name, argsPreview: event.argsPreview, provider: event.provider },
  }))
}

function persistToolResultEvent(
  repos: Repos,
  track: (row: { id: string } | undefined) => void,
  event: Extract<WorkflowEvent, { type: "tool_result" }>,
): void {
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
}

function persistLlmThinkingEvent(
  repos: Repos,
  track: (row: { id: string } | undefined) => void,
  event: Extract<WorkflowEvent, { type: "llm_thinking" }>,
): void {
  track(repos.appendLog({
    runId: event.runId,
    stageRunId: event.stageRunId ?? null,
    eventType: "llm_thinking",
    message: event.text,
    data: { provider: event.provider, model: event.model },
  }))
}

function persistLlmTokensEvent(
  repos: Repos,
  track: (row: { id: string } | undefined) => void,
  event: Extract<WorkflowEvent, { type: "llm_tokens" }>,
): void {
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
}

function persistArtifactWrittenEvent(
  repos: Repos,
  track: (row: { id: string } | undefined) => void,
  event: Extract<WorkflowEvent, { type: "artifact_written" }>,
): void {
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
}

function persistLogEvent(
  repos: Repos,
  track: (row: { id: string } | undefined) => void,
  event: Extract<WorkflowEvent, { type: "log" }>,
): void {
  track(repos.appendLog({
    runId: event.runId,
    eventType: "log",
    message: event.message,
    data: { level: event.level ?? "info" },
  }))
}

function persistRunFinishedEvent(
  repos: Repos,
  track: (row: { id: string } | undefined) => void,
  event: Extract<WorkflowEvent, { type: "run_finished" }>,
  itemId: string,
  isAuthoritative: (thisRunStatus?: string) => boolean,
  wasSoleLiveRun: () => boolean,
  onItemColumnChanged?: AttachDbSyncOptions["onItemColumnChanged"],
): void {
  const authoritative = isAuthoritative(event.status)
  const soleLive = wasSoleLiveRun()
  repos.updateRun(event.runId, { status: event.status })
  const item = repos.getItem(itemId)
  const { column, phaseStatus } = mapStageToColumn(item?.current_stage ?? "documentation", event.status)
  if (authoritative) {
    const from = repos.getItem(itemId)?.current_column ?? "idea"
    repos.setItemColumn(itemId, column, phaseStatus)
    onItemColumnChanged?.({ itemId, from, to: column, phaseStatus })
  }
  if (soleLive) repos.setItemCurrentStage(itemId, null)
  track(repos.appendLog({
    runId: event.runId,
    eventType: "run_finished",
    message: `run ${event.status}`,
    data: { itemId: event.itemId, title: event.title, status: event.status, error: event.error },
  }))
}

function persistItemColumnChangedEvent(
  repos: Repos,
  event: Extract<WorkflowEvent, { type: "item_column_changed" }>,
): void {
  repos.setItemColumn(
    event.itemId,
    event.column as ItemRow["current_column"],
    event.phaseStatus as ItemRow["phase_status"]
  )
}

function persistProjectCreatedEvent(
  repos: Repos,
  track: (row: { id: string } | undefined) => void,
  event: Extract<WorkflowEvent, { type: "project_created" }>,
  persistedProjectIds: Map<string, string>,
): void {
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
}

function persistWireframesReadyEvent(
  repos: Repos,
  track: (row: { id: string } | undefined) => void,
  event: Extract<WorkflowEvent, { type: "wireframes_ready" }>,
): void {
  track(repos.appendLog({
    runId: event.runId,
    eventType: "wireframes_ready",
    message: `${event.screenCount} screens ready`,
    data: { itemId: event.itemId, screenCount: event.screenCount, urls: event.urls },
  }))
}

function persistDesignReadyEvent(
  repos: Repos,
  track: (row: { id: string } | undefined) => void,
  event: Extract<WorkflowEvent, { type: "design_ready" }>,
): void {
  track(repos.appendLog({
    runId: event.runId,
    eventType: "design_ready",
    message: "design preview ready",
    data: { itemId: event.itemId, url: event.url },
  }))
}

function persistRunRecoveryEvent(
  repos: Repos,
  track: (row: { id: string } | undefined) => void,
  event: Extract<WorkflowEvent, { type: "run_blocked" | "run_failed" }>,
  itemId: string,
  wasSoleLiveRun: () => boolean,
): void {
  const soleLive = wasSoleLiveRun()
  repos.updateRun(event.runId, { status: event.type === "run_blocked" ? "blocked" : "failed" })
  if (soleLive) repos.setItemCurrentStage(itemId, null)
  const scope = event.scope
  const scopeRefVal = scope.type === "stage" ? scope.stageId : scope.type === "story" ? `${scope.waveNumber}/${scope.storyId}` : null
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
}

function persistExternalRemediationRecordedEvent(
  repos: Repos,
  track: (row: { id: string } | undefined) => void,
  event: Extract<WorkflowEvent, { type: "external_remediation_recorded" }>,
): void {
  track(repos.appendLog({
    runId: event.runId,
    eventType: "external_remediation_recorded",
    message: event.summary,
    data: { remediationId: event.remediationId, scope: event.scope, branch: event.branch }
  }))
}

function persistRunResumedEvent(
  repos: Repos,
  track: (row: { id: string } | undefined) => void,
  event: Extract<WorkflowEvent, { type: "run_resumed" }>,
): void {
  repos.clearRunRecovery(event.runId)
  track(repos.appendLog({
    runId: event.runId,
    eventType: "run_resumed",
    message: `run resumed from ${event.scope.type} scope`,
    data: { remediationId: event.remediationId, scope: event.scope }
  }))
}

function persistMergeGateOpenEvent(
  repos: Repos,
  track: (row: { id: string } | undefined) => void,
  event: Extract<WorkflowEvent, { type: "merge_gate_open" }>,
): void {
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
}

function persistMergeGateCancelledEvent(
  repos: Repos,
  track: (row: { id: string } | undefined) => void,
  event: Extract<WorkflowEvent, { type: "merge_gate_cancelled" }>,
): void {
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
}

function persistMergeCompletedEvent(
  repos: Repos,
  track: (row: { id: string } | undefined) => void,
  event: Extract<WorkflowEvent, { type: "merge_completed" }>,
): void {
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
}

function persistWorktreePortAssignedEvent(
  repos: Repos,
  track: (row: { id: string } | undefined) => void,
  event: Extract<WorkflowEvent, { type: "worktree_port_assigned" }>,
  runId: string,
): void {
  track(repos.appendLog({
    runId: event.runId ?? runId,
    eventType: "worktree_port_assigned",
    message: `${event.branch} -> ${event.port}`,
    data: { branch: event.branch, worktreePath: event.worktreePath, port: event.port },
  }))
}

function persistChatMessageEvent(
  repos: Repos,
  track: (row: { id: string } | undefined) => void,
  event: Extract<WorkflowEvent, { type: "chat_message" }>,
): void {
  track(repos.appendLog({
    runId: event.runId,
    stageRunId: event.stageRunId ?? null,
    eventType: "chat_message",
    message: event.text,
    data: { role: event.role, source: event.source, requiresResponse: event.requiresResponse ?? false },
  }))
}

function persistPresentationEvent(
  repos: Repos,
  track: (row: { id: string } | undefined) => void,
  event: Extract<WorkflowEvent, { type: "presentation" }>,
): void {
  if (!event.runId) return
  track(repos.appendLog({
    runId: event.runId,
    stageRunId: event.stageRunId ?? null,
    eventType: "presentation",
    message: event.text,
    data: { kind: event.kind, meta: event.meta },
  }))
}

function persistWaveSerializedEvent(
  repos: Repos,
  track: (row: { id: string } | undefined) => void,
  event: Extract<WorkflowEvent, { type: "wave_serialized" }>,
): void {
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
    /** Forwarded to `attachRunSubscribers` → `attachDbSync`. See `AttachDbSyncOptions.onItemColumnChanged`. */
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
    const detach = attachRunSubscribers(bus, repos, { runId: runRow.id, itemId: itemRow.id }, { onItemColumnChanged: opts.onItemColumnChanged })
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
export { busToWorkflowIO } from "./bus.js"

/**
 * Explicit type re-export for legacy imports.
 */
export type { WorkflowEvent } from "./io.js"
