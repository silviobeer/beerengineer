import type { ItemRow, Repos } from "../db/repositories.js"
import type { EventBus } from "./bus.js"
import { mapStageToColumn } from "./boardColumns.js"
import type { WorkflowEvent } from "./io.js"

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

type RecoveryEventScope = Extract<WorkflowEvent, { type: "run_blocked" | "run_failed" }>["scope"]
type EventOf<T extends WorkflowEvent["type"]> = Extract<WorkflowEvent, { type: T }>
type TrackLogRow = (row: { id: string } | undefined) => void
type StageLogInsert = Parameters<Repos["appendLog"]>[0]
type WorkflowEventHandler = (event: WorkflowEvent) => void
type WorkflowEventHandlers = Partial<Record<WorkflowEvent["type"], WorkflowEventHandler>>

function appendTrackedLog(repos: Repos, track: TrackLogRow, entry: StageLogInsert): void {
  track(repos.appendLog(entry))
}

function persistLogOnlyEvent<T extends WorkflowEvent["type"]>(
  repos: Repos,
  track: TrackLogRow,
  event: EventOf<T>,
  toLogEntry: (event: EventOf<T>) => StageLogInsert,
): void {
  appendTrackedLog(repos, track, toLogEntry(event))
}

function createEventHandler<T extends WorkflowEvent["type"]>(
  persist: (event: EventOf<T>) => void,
): (event: WorkflowEvent) => void {
  return event => persist(event as EventOf<T>)
}

function createLogOnlyHandler<T extends WorkflowEvent["type"]>(
  repos: Repos,
  track: TrackLogRow,
  toLogEntry: (event: EventOf<T>) => StageLogInsert,
): (event: WorkflowEvent) => void {
  return createEventHandler<T>(event => persistLogOnlyEvent(repos, track, event, toLogEntry))
}

function updateAuthoritativeItemColumn(
  repos: Repos,
  itemId: string,
  column: ItemRow["current_column"],
  phaseStatus: ItemRow["phase_status"],
  canWrite: boolean,
  onItemColumnChanged?: AttachDbSyncOptions["onItemColumnChanged"],
): void {
  if (!canWrite) return
  const from = repos.getItem(itemId)?.current_column ?? "idea"
  repos.setItemColumn(itemId, column, phaseStatus)
  onItemColumnChanged?.({ itemId, from, to: column, phaseStatus })
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

  // This run owns item state only when it has no live sibling. Failed runs
  // never win authority, even if they are the last live run.
  const isAuthoritative = (thisRunStatus?: string): boolean => {
    if (thisRunStatus === "failed") return false
    const allRuns = repos.listRunsForItem(ctx.itemId)
    return !allRuns.some(
      r => r.id !== ctx.runId && (r.status === "running" || r.status === "blocked")
    )
  }

  // `current_stage` clears whenever the sole live run stops owning a stage,
  // including failure.
  const wasSoleLiveRun = (): boolean => {
    const allRuns = repos.listRunsForItem(ctx.itemId)
    return !allRuns.some(
      r => r.id !== ctx.runId && (r.status === "running" || r.status === "blocked")
    )
  }

  const logOnly = <T extends WorkflowEvent["type"]>(
    toLogEntry: (event: EventOf<T>) => StageLogInsert,
  ): WorkflowEventHandler => createLogOnlyHandler(repos, track, toLogEntry)

  const eventHandlers: WorkflowEventHandlers = {
    run_started: createEventHandler<"run_started">(event => persistRunStartedEvent(repos, track, event)),
    stage_started: createEventHandler<"stage_started">(event =>
      persistStageStartedEvent(
        repos,
        track,
        event,
        {
          persistedStageIds,
          persistedProjectIds,
          stageRunIds,
          itemId: ctx.itemId,
          isAuthoritative,
          onItemColumnChanged: opts.onItemColumnChanged,
        },
      )),
    stage_completed: createEventHandler<"stage_completed">(event =>
      persistStageCompletedEvent(
        repos,
        track,
        event,
        stageRunIds,
        {
          itemId: ctx.itemId,
          isAuthoritative,
          onItemColumnChanged: opts.onItemColumnChanged,
        },
      )),
    prompt_requested: logOnly<"prompt_requested">(event => ({
      runId: event.runId,
      stageRunId: event.stageRunId ?? null,
      eventType: "prompt_requested",
      message: event.prompt,
      data: { promptId: event.promptId, prompt: event.prompt, actions: event.actions },
    })),
    prompt_answered: createEventHandler<"prompt_answered">(event => {
      if (event.source === "bridge") return
      persistLogOnlyEvent(repos, track, event, current => ({
        runId: current.runId,
        eventType: "prompt_answered",
        message: current.answer,
        data: { promptId: current.promptId, answer: current.answer },
      }))
    }),
    loop_iteration: logOnly<"loop_iteration">(event => ({
      runId: event.runId,
      stageRunId: event.stageRunId ?? null,
      eventType: "loop_iteration",
      message: `${event.phase} ${event.n}`,
      data: { n: event.n, phase: event.phase, stageKey: event.stageKey ?? null },
    })),
    review_feedback: logOnly<"review_feedback">(event => ({
      runId: event.runId,
      stageRunId: event.stageRunId ?? null,
      eventType: "review_feedback",
      message: event.feedback,
      data: { cycle: event.cycle, feedback: event.feedback, stageKey: event.stageKey ?? null },
    })),
    tool_called: logOnly<"tool_called">(event => ({
      runId: event.runId,
      stageRunId: event.stageRunId ?? null,
      eventType: "tool_called",
      message: event.name,
      data: { name: event.name, argsPreview: event.argsPreview, provider: event.provider },
    })),
    tool_result: logOnly<"tool_result">(event => ({
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
    })),
    llm_thinking: logOnly<"llm_thinking">(event => ({
      runId: event.runId,
      stageRunId: event.stageRunId ?? null,
      eventType: "llm_thinking",
      message: event.text,
      data: { provider: event.provider, model: event.model },
    })),
    llm_tokens: logOnly<"llm_tokens">(event => ({
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
    })),
    artifact_written: createEventHandler<"artifact_written">(event =>
      persistArtifactWrittenEvent(repos, track, event)),
    log: logOnly<"log">(event => ({
      runId: event.runId,
      eventType: "log",
      message: event.message,
      data: { level: event.level ?? "info" },
    })),
    run_finished: createEventHandler<"run_finished">(event =>
      persistRunFinishedEvent(
        repos,
        track,
        event,
        ctx.itemId,
        isAuthoritative,
        wasSoleLiveRun,
        opts.onItemColumnChanged,
      )),
    item_column_changed: createEventHandler<"item_column_changed">(event =>
      persistItemColumnChangedEvent(repos, event)),
    project_created: createEventHandler<"project_created">(event =>
      persistProjectCreatedEvent(
        repos,
        track,
        event,
        persistedProjectIds,
      )),
    wireframes_ready: logOnly<"wireframes_ready">(event => ({
      runId: event.runId,
      eventType: "wireframes_ready",
      message: `${event.screenCount} screens ready`,
      data: { itemId: event.itemId, screenCount: event.screenCount, urls: event.urls },
    })),
    design_ready: logOnly<"design_ready">(event => ({
      runId: event.runId,
      eventType: "design_ready",
      message: "design preview ready",
      data: { itemId: event.itemId, url: event.url },
    })),
    run_blocked: createEventHandler<"run_blocked">(event =>
      persistRunRecoveryEvent(
        repos,
        track,
        event,
        ctx.itemId,
        wasSoleLiveRun,
      )),
    run_failed: createEventHandler<"run_failed">(event =>
      persistRunRecoveryEvent(
        repos,
        track,
        event,
        ctx.itemId,
        wasSoleLiveRun,
      )),
    external_remediation_recorded: logOnly<"external_remediation_recorded">(event => ({
      runId: event.runId,
      eventType: "external_remediation_recorded",
      message: event.summary,
      data: { remediationId: event.remediationId, scope: event.scope, branch: event.branch },
    })),
    run_resumed: createEventHandler<"run_resumed">(event => persistRunResumedEvent(repos, track, event)),
    merge_gate_open: logOnly<"merge_gate_open">(event => ({
      runId: event.runId,
      eventType: "merge_gate_open",
      message: `merge gate opened for ${event.itemBranch}`,
      data: {
        itemId: event.itemId,
        itemBranch: event.itemBranch,
        baseBranch: event.baseBranch,
        gatePromptId: event.gatePromptId,
      },
    })),
    merge_gate_cancelled: logOnly<"merge_gate_cancelled">(event => ({
      runId: event.runId,
      eventType: "merge_gate_cancelled",
      message: `merge gate cancelled for ${event.itemBranch}`,
      data: { itemId: event.itemId, itemBranch: event.itemBranch, baseBranch: event.baseBranch },
    })),
    merge_completed: logOnly<"merge_completed">(event => ({
      runId: event.runId,
      eventType: "merge_completed",
      message: `merged ${event.itemBranch} into ${event.baseBranch}`,
      data: {
        itemId: event.itemId,
        itemBranch: event.itemBranch,
        baseBranch: event.baseBranch,
        mergeSha: event.mergeSha,
      },
    })),
    worktree_port_assigned: logOnly<"worktree_port_assigned">(event => ({
      runId: event.runId ?? ctx.runId,
      eventType: "worktree_port_assigned",
      message: `${event.branch} -> ${event.port}`,
      data: { branch: event.branch, worktreePath: event.worktreePath, port: event.port },
    })),
    chat_message: logOnly<"chat_message">(event => ({
      runId: event.runId,
      stageRunId: event.stageRunId ?? null,
      eventType: "chat_message",
      message: event.text,
      data: { role: event.role, source: event.source, requiresResponse: event.requiresResponse ?? false },
    })),
    presentation: createEventHandler<"presentation">(event => {
      if (!event.runId) return
      persistLogOnlyEvent(repos, track, event, currentEvent => ({
        runId: currentEvent.runId as string,
        stageRunId: currentEvent.stageRunId ?? null,
        eventType: "presentation",
        message: currentEvent.text,
        data: { kind: currentEvent.kind, meta: currentEvent.meta },
      }))
    }),
    wave_serialized: logOnly<"wave_serialized">(event => ({
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
    })),
  }

  const persist = (event: WorkflowEvent): void => {
    eventHandlers[event.type]?.(event)
  }

  return bus.subscribe(event => {
    try {
      persist(event)
    } catch (err) {
      console.error("[db-sync]", (err as Error).message)
    }
  })
}

function persistRunStartedEvent(
  repos: Repos,
  track: TrackLogRow,
  event: EventOf<"run_started">,
): void {
  repos.updateRun(event.runId, { status: "running" })
  appendTrackedLog(repos, track, {
    runId: event.runId,
    eventType: "run_started",
    message: event.title,
    data: { itemId: event.itemId, title: event.title },
  })
}

function persistStageStartedEvent(
  repos: Repos,
  track: TrackLogRow,
  event: EventOf<"stage_started">,
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
  const authoritative = state.isAuthoritative()
  updateAuthoritativeItemColumn(
    repos,
    state.itemId,
    column,
    phaseStatus,
    authoritative,
    state.onItemColumnChanged,
  )
  if (authoritative) repos.setItemCurrentStage(state.itemId, event.stageKey)
  appendTrackedLog(repos, track, {
    runId: event.runId,
    stageRunId: stageRun.id,
    eventType: "stage_started",
    message: `stage ${event.stageKey} started`,
    data: { stageRunId: stageRun.id, stageKey: event.stageKey, projectId: persistedProjectId },
  })
}

function persistStageCompletedEvent(
  repos: Repos,
  track: TrackLogRow,
  event: EventOf<"stage_completed">,
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
  updateAuthoritativeItemColumn(
    repos,
    state.itemId,
    column,
    phaseStatus,
    state.isAuthoritative(),
    state.onItemColumnChanged,
  )
  appendTrackedLog(repos, track, {
    runId: event.runId,
    stageRunId: stageRunId ?? null,
    eventType: "stage_completed",
    message: `stage ${event.stageKey} ${event.status}`,
    data: { stageRunId: stageRunId ?? null, stageKey: event.stageKey, status: event.status, error: event.error },
  })
}

function persistArtifactWrittenEvent(
  repos: Repos,
  track: TrackLogRow,
  event: EventOf<"artifact_written">,
): void {
  repos.recordArtifact({
    runId: event.runId,
    stageRunId: event.stageRunId ?? null,
    label: event.label,
    kind: event.kind,
    path: event.path
  })
  persistLogOnlyEvent(repos, track, event, currentEvent => ({
    runId: currentEvent.runId,
    stageRunId: currentEvent.stageRunId ?? null,
    eventType: "artifact_written",
    message: currentEvent.label,
    data: { label: currentEvent.label, path: currentEvent.path, kind: currentEvent.kind },
  }))
}

function persistRunFinishedEvent(
  repos: Repos,
  track: TrackLogRow,
  event: EventOf<"run_finished">,
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
  updateAuthoritativeItemColumn(
    repos,
    itemId,
    column,
    phaseStatus,
    authoritative,
    onItemColumnChanged,
  )
  if (soleLive) repos.setItemCurrentStage(itemId, null)
  appendTrackedLog(repos, track, {
    runId: event.runId,
    eventType: "run_finished",
    message: `run ${event.status}`,
    data: { itemId: event.itemId, title: event.title, status: event.status, error: event.error },
  })
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
  track: TrackLogRow,
  event: EventOf<"project_created">,
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
  persistLogOnlyEvent(repos, track, event, currentEvent => ({
    runId: currentEvent.runId,
    eventType: "project_created",
    message: currentEvent.name,
    data: {
      itemId: currentEvent.itemId,
      projectId: currentEvent.projectId,
      code: currentEvent.code,
      name: currentEvent.name,
      summary: currentEvent.summary,
      position: currentEvent.position,
    },
  }))
}

function persistRunRecoveryEvent(
  repos: Repos,
  track: TrackLogRow,
  event: EventOf<"run_blocked" | "run_failed">,
  itemId: string,
  wasSoleLiveRun: () => boolean,
): void {
  const soleLive = wasSoleLiveRun()
  repos.updateRun(event.runId, { status: event.type === "run_blocked" ? "blocked" : "failed" })
  if (soleLive) repos.setItemCurrentStage(itemId, null)
  const scope = event.scope
  const scopeRefVal = recoveryScopeRef(event.scope)
  repos.setRunRecovery(event.runId, {
    status: event.type === "run_blocked" ? "blocked" : "failed",
    scope: scope.type,
    scopeRef: scopeRefVal,
    summary: event.summary
  })
  persistLogOnlyEvent(repos, track, event, currentEvent => ({
    runId: currentEvent.runId,
    eventType: currentEvent.type,
    message: currentEvent.summary,
    data: {
      itemId: "itemId" in currentEvent ? currentEvent.itemId : undefined,
      title: "title" in currentEvent ? currentEvent.title : undefined,
      cause: currentEvent.cause,
      scope: currentEvent.scope,
      branch: "branch" in currentEvent ? currentEvent.branch : undefined,
    },
  }))
}

function recoveryScopeRef(scope: RecoveryEventScope): string | null {
  if (scope.type === "stage") return scope.stageId
  if (scope.type === "story") return `${scope.waveNumber}/${scope.storyId}`
  return null
}

function persistRunResumedEvent(
  repos: Repos,
  track: TrackLogRow,
  event: EventOf<"run_resumed">,
): void {
  repos.clearRunRecovery(event.runId)
  persistLogOnlyEvent(repos, track, event, currentEvent => ({
    runId: currentEvent.runId,
    eventType: "run_resumed",
    message: `run resumed from ${currentEvent.scope.type} scope`,
    data: { remediationId: currentEvent.remediationId, scope: currentEvent.scope },
  }))
}
