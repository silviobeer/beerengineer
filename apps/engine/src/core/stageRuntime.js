import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { emitEvent, getActiveRun } from "./runContext.js";
import { writeRecoveryRecord } from "./recovery.js";
import { isWorktreePortPoolExhaustedError } from "./portAllocator.js";
import { layout } from "./workspaceLayout.js";
import { NON_INTERACTIVE_NO_ANSWER_SENTINEL } from "./constants.js";
function nowIso() {
    return new Date().toISOString();
}
function workflowContextForRun(run) {
    return { workspaceId: run.workspaceId, workspaceRoot: run.workspaceRoot, runId: run.runId };
}
async function writeJsonFile(path, data) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(data, null, 2));
}
function workflowRunSnapshot(ctx, stageId, status) {
    return {
        id: ctx.runId,
        workspaceId: ctx.workspaceId,
        currentStage: stageId,
        status,
        updatedAt: nowIso(),
    };
}
function emitChatMessage(run, role, source, text, requiresResponse = false) {
    emitEvent({
        type: "chat_message",
        runId: run.runId,
        stageRunId: getActiveRun()?.stageRunId ?? null,
        role,
        source,
        text,
        requiresResponse,
    });
}
function emitLoopIteration(run, phase, n) {
    const activeRun = getActiveRun();
    if (!activeRun)
        return;
    emitEvent({
        type: "loop_iteration",
        runId: activeRun.runId,
        stageRunId: activeRun.stageRunId ?? null,
        n,
        phase,
        stageKey: run.stage,
    });
}
export async function writeArtifactFiles(baseDir, artifacts) {
    await mkdir(baseDir, { recursive: true });
    const files = [];
    for (const artifact of artifacts) {
        const path = join(baseDir, artifact.fileName);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, artifact.content);
        files.push({ kind: artifact.kind, label: artifact.label, path });
    }
    return files;
}
async function writeWorkspaceRecord(ctx, stageId, status) {
    await writeJsonFile(layout.workspaceFile(ctx), {
        id: ctx.workspaceId,
        status,
        currentStage: stageId,
        currentRunId: ctx.runId,
        updatedAt: nowIso(),
    });
}
export async function persistWorkflowRunState(ctx, stageId, status) {
    await writeJsonFile(layout.runFile(ctx), workflowRunSnapshot(ctx, stageId, status));
    await writeWorkspaceRecord(ctx, stageId, status === "completed" ? "approved" : status);
}
async function persistRun(run) {
    const ctx = workflowContextForRun(run);
    await writeJsonFile(layout.stageRunFile(ctx, run.stage), run);
    await writeFile(layout.stageLogFile(ctx, run.stage), `${run.logs.map(entry => JSON.stringify(entry)).join("\n")}${run.logs.length > 0 ? "\n" : ""}`);
    await persistWorkflowRunState(ctx, run.stage, run.status);
}
function pushLog(run, entry) {
    run.logs.push({ at: nowIso(), ...entry });
    run.updatedAt = nowIso();
}
function setStatus(run, status) {
    run.status = status;
    pushLog(run, { type: "status_changed", message: `Status -> ${status}` });
}
export function createStageRun(definition) {
    const ctx = {
        workspaceId: definition.workspaceId,
        workspaceRoot: definition.workspaceRoot,
        runId: definition.runId,
    };
    const startedAt = nowIso();
    return {
        id: startedAt.replaceAll(/[:.]/g, "-"),
        workspaceId: ctx.workspaceId,
        workspaceRoot: ctx.workspaceRoot,
        runId: ctx.runId,
        workspaceDir: layout.workspaceDir(ctx),
        runDir: layout.runDir(ctx),
        stage: definition.stageId,
        stageDir: layout.stageDir(ctx, definition.stageId),
        stageArtifactsDir: layout.stageArtifactsDir(ctx, definition.stageId),
        status: "not_started",
        userTurnCount: 0,
        stageAgentTurnCount: 0,
        reviewIteration: 0,
        stageAgentSessionId: null,
        reviewerSessionId: null,
        state: definition.createInitialState(),
        logs: [],
        files: [],
        createdAt: startedAt,
        updatedAt: startedAt,
    };
}
function reviewHistory(run) {
    return run.logs.flatMap(entry => {
        const cycle = typeof entry.data?.cycle === "number" ? entry.data.cycle : undefined;
        const outcome = entry.data?.reviewOutcome;
        if (!cycle || (outcome !== "revise" && outcome !== "block"))
            return [];
        return [{ cycle, outcome, text: entry.message }];
    });
}
function buildStageContext(run, phase) {
    const priorFeedback = reviewHistory(run);
    return {
        turnCount: run.stageAgentTurnCount + 1,
        phase,
        ...(phase === "review-feedback" ? { priorFeedback } : {}),
    };
}
function buildReviewContext(run, maxReviews) {
    const cycle = run.reviewIteration;
    return {
        cycle,
        maxReviews,
        isFinalCycle: cycle >= maxReviews,
        priorFeedback: reviewHistory(run),
    };
}
function syncSessions(definition, run) {
    run.stageAgentSessionId = definition.stageAgent.getSessionId?.() ?? run.stageAgentSessionId ?? null;
    run.reviewerSessionId = definition.reviewer.getSessionId?.() ?? run.reviewerSessionId ?? null;
}
async function advanceStageAgent(definition, run, phase, input) {
    const response = await definition.stageAgent.step(input);
    emitLoopIteration(run, phase, run.stageAgentTurnCount + 1);
    run.stageAgentTurnCount++;
    syncSessions(definition, run);
    await persistRun(run);
    return response;
}
async function recordStageBlocked(run, cause, summary, extra) {
    const ctx = workflowContextForRun(run);
    const record = await writeRecoveryRecord(ctx, {
        status: cause === "system_error" ? "failed" : "blocked",
        cause,
        scope: { type: "stage", runId: run.runId, stageId: run.stage },
        summary,
        detail: extra?.detail,
        evidencePaths: [layout.stageRunFile(ctx, run.stage), layout.stageLogFile(ctx, run.stage)],
        findings: extra?.findings,
    });
    const activeRun = getActiveRun();
    if (record.status === "failed") {
        emitEvent({
            type: "run_failed",
            runId: run.runId,
            scope: { type: "stage", runId: run.runId, stageId: run.stage },
            cause,
            summary,
        });
        return;
    }
    emitEvent({
        type: "run_blocked",
        runId: run.runId,
        itemId: activeRun?.itemId ?? "unknown-item",
        title: activeRun?.title ?? activeRun?.itemId ?? "unknown-item",
        scope: { type: "stage", runId: run.runId, stageId: run.stage },
        cause,
        summary,
    });
}
export async function runStage(definition) {
    const run = createStageRun(definition);
    await persistRun(run);
    setStatus(run, "chat_in_progress");
    try {
        return await runStageBody(definition, run);
    }
    catch (err) {
        // Unhandled exceptions (adapter errors, etc.) become `failed` recovery
        // records. Reviewer-driven blocks already wrote their own record before
        // throwing — we detect that by checking run.status.
        if (run.status !== "blocked" && run.status !== "failed") {
            setStatus(run, "failed");
            await persistRun(run);
            const cause = isWorktreePortPoolExhaustedError(err)
                ? "worktree_port_pool_exhausted"
                : "system_error";
            await recordStageBlocked(run, cause, err.message);
        }
        throw err;
    }
}
async function runStageBody(definition, run) {
    definition.stageAgent.setSessionId?.(run.stageAgentSessionId ?? null);
    definition.reviewer.setSessionId?.(run.reviewerSessionId ?? null);
    let response = await advanceStageAgent(definition, run, "begin", {
        kind: "begin",
        state: run.state,
        stageContext: buildStageContext(run, "begin"),
    });
    while (true) {
        if (response.kind === "message") {
            response = await continueStageAfterUserMessage(definition, run, response.message);
            continue;
        }
        run.artifact = response.artifact;
        setStatus(run, "artifact_ready");
        pushLog(run, { type: "artifact_created", message: "Artifact created." });
        await persistRunArtifacts(definition, run, response.artifact);
        setStatus(run, "in_review");
        run.reviewIteration++;
        await persistRun(run);
        const review = await definition.reviewer.review({
            artifact: response.artifact,
            state: run.state,
            reviewContext: buildReviewContext(run, definition.maxReviews),
        });
        emitLoopIteration(run, "review", run.reviewIteration);
        syncSessions(definition, run);
        await persistRun(run);
        const nextStep = await handleReviewOutcome(definition, run, response.artifact, review);
        if (nextStep.kind === "approved") {
            return { result: nextStep.result, run };
        }
        response = nextStep.response;
    }
}
async function persistRunArtifacts(definition, run, artifact) {
    const artifactContents = await definition.persistArtifacts(run, artifact);
    run.files = await writeArtifactFiles(run.stageArtifactsDir, artifactContents);
    emitArtifactWrittenEvents(run);
}
function emitArtifactWrittenEvents(run) {
    for (const file of run.files) {
        pushLog(run, { type: "file_written", message: `${file.label}: ${file.path}` });
        const activeRun = getActiveRun();
        if (!activeRun)
            continue;
        emitEvent({
            type: "artifact_written",
            runId: activeRun.runId,
            stageRunId: activeRun.stageRunId ?? null,
            label: file.label,
            kind: file.kind,
            path: file.path,
        });
    }
}
async function handleReviewOutcome(definition, run, artifact, review) {
    if (review.kind === "pass") {
        pushLog(run, { type: "review_pass", message: "Review passed." });
        setStatus(run, "approved");
        await persistRun(run);
        return { kind: "approved", result: await definition.onApproved(artifact, run) };
    }
    if (review.kind === "block") {
        await blockReviewRun(run, review.reason);
    }
    if (review.kind !== "revise") {
        throw new Error(`Unsupported review outcome: ${String(review.kind)}`);
    }
    return {
        kind: "revise",
        response: await requestRevision(definition, run, review.feedback),
    };
}
async function blockReviewRun(run, reason) {
    pushLog(run, { type: "status_changed", message: reason, data: { cycle: run.reviewIteration, reviewOutcome: "block" } });
    setStatus(run, "blocked");
    await persistRun(run);
    await recordStageBlocked(run, "review_block", reason);
    throw new Error(reason);
}
async function requestRevision(definition, run, feedback) {
    pushLog(run, { type: "review_revise", message: feedback, data: { cycle: run.reviewIteration, reviewOutcome: "revise" } });
    if (run.reviewIteration >= definition.maxReviews) {
        setStatus(run, "blocked");
        await persistRun(run);
        const summary = `Blocked: no pass after ${definition.maxReviews} reviews`;
        await recordStageBlocked(run, "review_limit", summary, { detail: feedback });
        throw new Error(summary);
    }
    setStatus(run, "revision_requested");
    await persistRun(run);
    emitChatMessage(run, definition.reviewerLabel, "reviewer", feedback);
    emitReviewFeedbackEvent(run, feedback);
    return advanceStageAgent(definition, run, "review-feedback", {
        kind: "review-feedback",
        state: run.state,
        reviewFeedback: feedback,
        stageContext: buildStageContext(run, "review-feedback"),
    });
}
async function continueStageAfterUserMessage(definition, run, message) {
    setStatus(run, "waiting_for_user");
    pushLog(run, { type: "stage_message", message });
    await persistRun(run);
    emitChatMessage(run, definition.stageAgentLabel, "stage-agent", message, true);
    // Pass the agent's message as the prompt text so `pending_prompts` and
    // every transcript projection show real content instead of a "you >"
    // placeholder. Terminal renderers already displayed the chat_message
    // event above, so the CLI can safely suppress duplicate echo when it
    // sees the same text come back through `prompt_requested`.
    const userMessage = await definition.askUser(message);
    if (userMessage === NON_INTERACTIVE_NO_ANSWER_SENTINEL) {
        throw new Error(`Stage "${run.stage}" emitted a prompt but this is a non-interactive run with no stdin answers queued. ` +
            "Pipe answers via stdin (one per line), use the API (POST /runs/:id/answer) after the run " +
            "emits a pending_prompt event, or provide all required inputs up-front (e.g. --references).");
    }
    pushLog(run, { type: "user_message", message: userMessage });
    run.userTurnCount++;
    setStatus(run, "chat_in_progress");
    return advanceStageAgent(definition, run, "user-message", {
        kind: "user-message",
        state: run.state,
        userMessage,
        stageContext: buildStageContext(run, "user-message"),
    });
}
function emitReviewFeedbackEvent(run, feedback) {
    const activeRunForReview = getActiveRun();
    if (!activeRunForReview)
        return;
    emitEvent({
        type: "review_feedback",
        runId: activeRunForReview.runId,
        stageRunId: activeRunForReview.stageRunId ?? null,
        stageKey: run.stage,
        cycle: run.reviewIteration,
        feedback,
    });
}
