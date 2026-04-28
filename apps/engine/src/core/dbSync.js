import { mapStageToColumn } from "./boardColumns.js";
function appendTrackedLog(repos, track, entry) {
    track(repos.appendLog(entry));
}
function persistLogOnlyEvent(repos, track, event, toLogEntry) {
    appendTrackedLog(repos, track, toLogEntry(event));
}
function createEventHandler(persist) {
    return event => persist(event);
}
function createLogOnlyHandler(repos, track, toLogEntry) {
    return createEventHandler(event => persistLogOnlyEvent(repos, track, event, toLogEntry));
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
export function attachDbSync(bus, repos, ctx, opts = {}) {
    const stageRunIds = new Map();
    const persistedStageIds = new Set();
    const persistedProjectIds = new Map();
    const track = (row) => {
        if (!row)
            return;
        opts.writtenLogIds?.add(row.id);
    };
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
    const isAuthoritative = (thisRunStatus) => {
        if (thisRunStatus === "failed")
            return false;
        const allRuns = repos.listRunsForItem(ctx.itemId);
        return !allRuns.some(r => r.id !== ctx.runId && (r.status === "running" || r.status === "blocked"));
    };
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
    const wasSoleLiveRun = () => {
        const allRuns = repos.listRunsForItem(ctx.itemId);
        return !allRuns.some(r => r.id !== ctx.runId && (r.status === "running" || r.status === "blocked"));
    };
    const eventHandlers = {
        run_started: createEventHandler(event => persistRunStartedEvent(repos, track, event)),
        stage_started: createEventHandler(event => persistStageStartedEvent(repos, track, event, {
            persistedStageIds,
            persistedProjectIds,
            stageRunIds,
            itemId: ctx.itemId,
            isAuthoritative,
            onItemColumnChanged: opts.onItemColumnChanged,
        })),
        stage_completed: createEventHandler(event => persistStageCompletedEvent(repos, track, event, stageRunIds, {
            itemId: ctx.itemId,
            isAuthoritative,
            onItemColumnChanged: opts.onItemColumnChanged,
        })),
        prompt_requested: createLogOnlyHandler(repos, track, event => ({
            runId: event.runId,
            stageRunId: event.stageRunId ?? null,
            eventType: "prompt_requested",
            message: event.prompt,
            data: { promptId: event.promptId, prompt: event.prompt, actions: event.actions },
        })),
        prompt_answered: createEventHandler(event => {
            if (event.source === "bridge")
                return;
            persistLogOnlyEvent(repos, track, event, current => ({
                runId: current.runId,
                eventType: "prompt_answered",
                message: current.answer,
                data: { promptId: current.promptId, answer: current.answer },
            }));
        }),
        loop_iteration: createLogOnlyHandler(repos, track, event => ({
            runId: event.runId,
            stageRunId: event.stageRunId ?? null,
            eventType: "loop_iteration",
            message: `${event.phase} ${event.n}`,
            data: { n: event.n, phase: event.phase, stageKey: event.stageKey ?? null },
        })),
        review_feedback: createLogOnlyHandler(repos, track, event => ({
            runId: event.runId,
            stageRunId: event.stageRunId ?? null,
            eventType: "review_feedback",
            message: event.feedback,
            data: { cycle: event.cycle, feedback: event.feedback, stageKey: event.stageKey ?? null },
        })),
        tool_called: createLogOnlyHandler(repos, track, event => ({
            runId: event.runId,
            stageRunId: event.stageRunId ?? null,
            eventType: "tool_called",
            message: event.name,
            data: { name: event.name, argsPreview: event.argsPreview, provider: event.provider },
        })),
        tool_result: createLogOnlyHandler(repos, track, event => ({
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
        llm_thinking: createLogOnlyHandler(repos, track, event => ({
            runId: event.runId,
            stageRunId: event.stageRunId ?? null,
            eventType: "llm_thinking",
            message: event.text,
            data: { provider: event.provider, model: event.model },
        })),
        llm_tokens: createLogOnlyHandler(repos, track, event => ({
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
        artifact_written: createEventHandler(event => persistArtifactWrittenEvent(repos, track, event)),
        log: createLogOnlyHandler(repos, track, event => ({
            runId: event.runId,
            eventType: "log",
            message: event.message,
            data: { level: event.level ?? "info" },
        })),
        run_finished: createEventHandler(event => persistRunFinishedEvent(repos, track, event, ctx.itemId, isAuthoritative, wasSoleLiveRun, opts.onItemColumnChanged)),
        item_column_changed: createEventHandler(event => persistItemColumnChangedEvent(repos, event)),
        project_created: createEventHandler(event => persistProjectCreatedEvent(repos, track, event, persistedProjectIds)),
        wireframes_ready: createLogOnlyHandler(repos, track, event => ({
            runId: event.runId,
            eventType: "wireframes_ready",
            message: `${event.screenCount} screens ready`,
            data: { itemId: event.itemId, screenCount: event.screenCount, urls: event.urls },
        })),
        design_ready: createLogOnlyHandler(repos, track, event => ({
            runId: event.runId,
            eventType: "design_ready",
            message: "design preview ready",
            data: { itemId: event.itemId, url: event.url },
        })),
        run_blocked: createEventHandler(event => persistRunRecoveryEvent(repos, track, event, ctx.itemId, wasSoleLiveRun)),
        run_failed: createEventHandler(event => persistRunRecoveryEvent(repos, track, event, ctx.itemId, wasSoleLiveRun)),
        external_remediation_recorded: createLogOnlyHandler(repos, track, event => ({
            runId: event.runId,
            eventType: "external_remediation_recorded",
            message: event.summary,
            data: { remediationId: event.remediationId, scope: event.scope, branch: event.branch },
        })),
        run_resumed: createEventHandler(event => persistRunResumedEvent(repos, track, event)),
        merge_gate_open: createLogOnlyHandler(repos, track, event => ({
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
        merge_gate_cancelled: createLogOnlyHandler(repos, track, event => ({
            runId: event.runId,
            eventType: "merge_gate_cancelled",
            message: `merge gate cancelled for ${event.itemBranch}`,
            data: { itemId: event.itemId, itemBranch: event.itemBranch, baseBranch: event.baseBranch },
        })),
        merge_completed: createLogOnlyHandler(repos, track, event => ({
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
        worktree_port_assigned: createLogOnlyHandler(repos, track, event => ({
            runId: event.runId ?? ctx.runId,
            eventType: "worktree_port_assigned",
            message: `${event.branch} -> ${event.port}`,
            data: { branch: event.branch, worktreePath: event.worktreePath, port: event.port },
        })),
        chat_message: createLogOnlyHandler(repos, track, event => ({
            runId: event.runId,
            stageRunId: event.stageRunId ?? null,
            eventType: "chat_message",
            message: event.text,
            data: { role: event.role, source: event.source, requiresResponse: event.requiresResponse ?? false },
        })),
        presentation: createEventHandler(event => {
            if (!event.runId)
                return;
            persistLogOnlyEvent(repos, track, event, currentEvent => ({
                runId: currentEvent.runId,
                stageRunId: currentEvent.stageRunId ?? null,
                eventType: "presentation",
                message: currentEvent.text,
                data: { kind: currentEvent.kind, meta: currentEvent.meta },
            }));
        }),
        wave_serialized: createLogOnlyHandler(repos, track, event => ({
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
    };
    const persist = (event) => {
        eventHandlers[event.type]?.(event);
    };
    return bus.subscribe(event => {
        try {
            persist(event);
        }
        catch (err) {
            console.error("[db-sync]", err.message);
        }
    });
}
function persistRunStartedEvent(repos, track, event) {
    repos.updateRun(event.runId, { status: "running" });
    appendTrackedLog(repos, track, {
        runId: event.runId,
        eventType: "run_started",
        message: event.title,
        data: { itemId: event.itemId, title: event.title },
    });
}
function persistStageStartedEvent(repos, track, event, state) {
    if (state.persistedStageIds.has(event.stageRunId))
        return;
    const persistedProjectId = event.projectId
        ? state.persistedProjectIds.get(event.projectId) ?? event.projectId
        : null;
    const stageRun = repos.createStageRun({
        id: event.stageRunId,
        runId: event.runId,
        stageKey: event.stageKey,
        projectId: persistedProjectId,
    });
    state.persistedStageIds.add(stageRun.id);
    state.stageRunIds.set(event.stageKey, stageRun.id);
    repos.updateRun(event.runId, { current_stage: event.stageKey });
    const { column, phaseStatus } = mapStageToColumn(event.stageKey, "running");
    if (state.isAuthoritative()) {
        const from = repos.getItem(state.itemId)?.current_column ?? "idea";
        repos.setItemColumn(state.itemId, column, phaseStatus);
        repos.setItemCurrentStage(state.itemId, event.stageKey);
        state.onItemColumnChanged?.({ itemId: state.itemId, from, to: column, phaseStatus });
    }
    appendTrackedLog(repos, track, {
        runId: event.runId,
        stageRunId: stageRun.id,
        eventType: "stage_started",
        message: `stage ${event.stageKey} started`,
        data: { stageRunId: stageRun.id, stageKey: event.stageKey, projectId: persistedProjectId },
    });
}
function persistStageCompletedEvent(repos, track, event, stageRunIds, state) {
    const stageRunId = event.stageRunId ?? stageRunIds.get(event.stageKey);
    if (stageRunId) {
        repos.completeStageRun(stageRunId, event.status, event.error ?? null);
    }
    const { column, phaseStatus } = mapStageToColumn(event.stageKey, event.status);
    if (state.isAuthoritative()) {
        const from = repos.getItem(state.itemId)?.current_column ?? "idea";
        repos.setItemColumn(state.itemId, column, phaseStatus);
        state.onItemColumnChanged?.({ itemId: state.itemId, from, to: column, phaseStatus });
    }
    appendTrackedLog(repos, track, {
        runId: event.runId,
        stageRunId: stageRunId ?? null,
        eventType: "stage_completed",
        message: `stage ${event.stageKey} ${event.status}`,
        data: { stageRunId: stageRunId ?? null, stageKey: event.stageKey, status: event.status, error: event.error },
    });
}
function persistArtifactWrittenEvent(repos, track, event) {
    repos.recordArtifact({
        runId: event.runId,
        stageRunId: event.stageRunId ?? null,
        label: event.label,
        kind: event.kind,
        path: event.path
    });
    persistLogOnlyEvent(repos, track, event, currentEvent => ({
        runId: currentEvent.runId,
        stageRunId: currentEvent.stageRunId ?? null,
        eventType: "artifact_written",
        message: currentEvent.label,
        data: { label: currentEvent.label, path: currentEvent.path, kind: currentEvent.kind },
    }));
}
function persistRunFinishedEvent(repos, track, event, itemId, isAuthoritative, wasSoleLiveRun, onItemColumnChanged) {
    const authoritative = isAuthoritative(event.status);
    const soleLive = wasSoleLiveRun();
    repos.updateRun(event.runId, { status: event.status });
    const item = repos.getItem(itemId);
    const { column, phaseStatus } = mapStageToColumn(item?.current_stage ?? "documentation", event.status);
    if (authoritative) {
        const from = repos.getItem(itemId)?.current_column ?? "idea";
        repos.setItemColumn(itemId, column, phaseStatus);
        onItemColumnChanged?.({ itemId, from, to: column, phaseStatus });
    }
    if (soleLive)
        repos.setItemCurrentStage(itemId, null);
    appendTrackedLog(repos, track, {
        runId: event.runId,
        eventType: "run_finished",
        message: `run ${event.status}`,
        data: { itemId: event.itemId, title: event.title, status: event.status, error: event.error },
    });
}
function persistItemColumnChangedEvent(repos, event) {
    repos.setItemColumn(event.itemId, event.column, event.phaseStatus);
}
function persistProjectCreatedEvent(repos, track, event, persistedProjectIds) {
    const project = repos.createProject({
        id: event.projectId,
        itemId: event.itemId,
        code: event.code,
        name: event.name,
        summary: event.summary,
        status: "draft",
        position: event.position
    });
    persistedProjectIds.set(event.projectId, project.id);
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
    }));
}
function persistRunRecoveryEvent(repos, track, event, itemId, wasSoleLiveRun) {
    const soleLive = wasSoleLiveRun();
    repos.updateRun(event.runId, { status: event.type === "run_blocked" ? "blocked" : "failed" });
    if (soleLive)
        repos.setItemCurrentStage(itemId, null);
    const scope = event.scope;
    const scopeRefVal = recoveryScopeRef(event.scope);
    repos.setRunRecovery(event.runId, {
        status: event.type === "run_blocked" ? "blocked" : "failed",
        scope: scope.type,
        scopeRef: scopeRefVal,
        summary: event.summary
    });
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
    }));
}
function recoveryScopeRef(scope) {
    if (scope.type === "stage")
        return scope.stageId;
    if (scope.type === "story")
        return `${scope.waveNumber}/${scope.storyId}`;
    return null;
}
function persistRunResumedEvent(repos, track, event) {
    repos.clearRunRecovery(event.runId);
    persistLogOnlyEvent(repos, track, event, currentEvent => ({
        runId: currentEvent.runId,
        eventType: "run_resumed",
        message: `run resumed from ${currentEvent.scope.type} scope`,
        data: { remediationId: currentEvent.remediationId, scope: currentEvent.scope },
    }));
}
