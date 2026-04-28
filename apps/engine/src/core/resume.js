import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runWorkflow } from "../workflow.js";
import { readRecoveryRecord } from "./recovery.js";
import { runWithWorkflowIO } from "./io.js";
import { runWithActiveRun } from "./runContext.js";
import { layout } from "./workspaceLayout.js";
import { persistWorkflowRunState } from "./stageRuntime.js";
import { resolveWorkflowContextForRun } from "./workflowContextResolver.js";
import { attachRunSubscribers, resolveWorkflowLlmOptions } from "./runSubscribers.js";
const inflightResumes = new Set();
export function isResumeInFlight(runId) {
    return inflightResumes.has(runId);
}
async function runFileMatchesRun(ctx, runId) {
    try {
        const raw = await readFile(layout.runFile(ctx), "utf8");
        const parsed = JSON.parse(raw);
        return parsed.id === runId;
    }
    catch {
        return false;
    }
}
async function inferWorkspaceDir(repos, run) {
    const ctx = resolveWorkflowContextForRun(repos, run);
    if (!ctx)
        return null;
    return (await runFileMatchesRun(ctx, run.id)) ? ctx : null;
}
export async function loadResumeReadiness(repos, runId) {
    const run = repos.getRun(runId);
    if (!run)
        return { kind: "not_found" };
    if (inflightResumes.has(runId)) {
        return { kind: "not_resumable", run, reason: "resume_in_progress" };
    }
    if (!run.recovery_status)
        return { kind: "no_recovery", run };
    const ctx = await inferWorkspaceDir(repos, run);
    if (!ctx)
        return { kind: "no_recovery", run };
    const scopeType = run.recovery_scope;
    const scopeRefVal = run.recovery_scope_ref;
    let record;
    if (scopeType === "stage" && scopeRefVal) {
        record = await readRecoveryRecord(ctx, { type: "stage", runId: run.id, stageId: scopeRefVal });
    }
    else if (scopeType === "story" && scopeRefVal) {
        const [waveStr, storyId] = scopeRefVal.split("/");
        record = await readRecoveryRecord(ctx, {
            type: "story",
            runId: run.id,
            waveNumber: Number(waveStr),
            storyId,
        });
    }
    else if (scopeType === "run") {
        record = await readRecoveryRecord(ctx, { type: "run", runId: run.id });
    }
    // Synthesized minimal record for legacy blocked runs (no recovery.json on disk).
    record ??= {
        status: run.recovery_status,
        cause: "system_error",
        scope: { type: "run", runId: run.id },
        summary: run.recovery_summary ?? "Legacy blocked run — resume may restart from the beginning.",
        evidencePaths: [],
        createdAt: new Date(run.updated_at).toISOString(),
        updatedAt: new Date(run.updated_at).toISOString(),
    };
    return { kind: "ready", run, record, ctx };
}
/**
 * Before re-entering the ralph loop, reset the story's blocked state back to
 * "in_progress" so the loop actually runs instead of short-circuiting. Also
 * stash the latest remediation so the next iteration's prompt can see it.
 */
async function prepareStoryScopeForResume(ctx, record, remediation) {
    const dir = layout.executionRalphDir(ctx, record.scope.waveNumber, record.scope.storyId);
    const implPath = join(dir, "implementation.json");
    try {
        const raw = await readFile(implPath, "utf8");
        const impl = JSON.parse(raw);
        if (impl.status === "blocked") {
            impl.status = "in_progress";
            impl.finalSummary = `${impl.finalSummary}\nResumed after external remediation: ${remediation.summary}`;
            await writeFile(implPath, `${JSON.stringify(impl, null, 2)}\n`);
        }
    }
    catch {
        // Missing/corrupt implementation.json means checkpoint is invalid.
        throw new Error("invalid_checkpoint");
    }
    await writeFile(join(dir, "pending-remediation.json"), `${JSON.stringify({
        id: remediation.id,
        summary: remediation.summary,
        branch: remediation.branch,
        commitSha: remediation.commit_sha,
        reviewNotes: remediation.review_notes,
        createdAt: new Date(remediation.created_at).toISOString(),
    }, null, 2)}\n`);
}
/**
 * Kick off resume. Emits external_remediation_recorded + run_resumed, then
 * re-invokes runWorkflow under the original IO. The caller is responsible for
 * validating readiness first (via loadResumeReadiness).
 */
export async function performResume(input) {
    const readiness = await loadResumeReadiness(input.repos, input.runId);
    if (readiness.kind !== "ready") {
        throw new Error(`not_resumable:${readiness.kind}`);
    }
    const { run, record, ctx } = readiness;
    const workspaceRow = input.repos.getWorkspace(run.workspace_id);
    const llm = await resolveWorkflowLlmOptions(workspaceRow);
    inflightResumes.add(input.runId);
    try {
        if (!input.io.bus) {
            throw new Error("performResume: io must be bus-backed (runService.buildApiIo / createCliIO)");
        }
        const bus = input.io.bus;
        const detach = attachRunSubscribers(bus, input.repos, { runId: run.id, itemId: run.item_id }, { onItemColumnChanged: input.onItemColumnChanged });
        let eventScope = { type: "run", runId: run.id };
        if (record.scope.type === "story") {
            eventScope = {
                type: "story",
                runId: run.id,
                waveNumber: record.scope.waveNumber,
                storyId: record.scope.storyId,
            };
        }
        else if (record.scope.type === "stage") {
            eventScope = { type: "stage", runId: run.id, stageId: record.scope.stageId };
        }
        if (record.scope.type === "story") {
            await prepareStoryScopeForResume(ctx, record, input.remediation);
        }
        try {
            bus.emit({
                type: "external_remediation_recorded",
                runId: run.id,
                remediationId: input.remediation.id,
                scope: eventScope,
                summary: input.remediation.summary,
                branch: input.remediation.branch ?? undefined,
            });
            bus.emit({
                type: "run_resumed",
                runId: run.id,
                remediationId: input.remediation.id,
                scope: eventScope,
            });
            await runWithWorkflowIO(input.io, async () => runWithActiveRun({ runId: run.id, itemId: run.item_id, title: run.title }, async () => {
                input.repos.updateRun(run.id, { status: "running" });
                try {
                    await runWorkflow({ id: run.item_id, title: run.title, description: "" }, {
                        resume: { scope: record.scope, currentStage: run.current_stage },
                        llm,
                        workspaceRoot: workspaceRow?.root_path ?? undefined,
                    });
                    const finalRun = input.repos.getRun(run.id);
                    await persistWorkflowRunState(ctx, finalRun?.current_stage ?? "handoff", "completed");
                    bus.emit({ type: "run_finished", runId: run.id, itemId: run.item_id, title: run.title, status: "completed" });
                }
                catch (err) {
                    const finalRun = input.repos.getRun(run.id);
                    await persistWorkflowRunState(ctx, finalRun?.current_stage ?? run.current_stage ?? "execution", "failed");
                    bus.emit({
                        type: "run_finished",
                        runId: run.id,
                        itemId: run.item_id,
                        title: run.title,
                        status: "failed",
                        error: err.message,
                    });
                    throw err;
                }
            }));
        }
        finally {
            detach();
        }
    }
    finally {
        inflightResumes.delete(input.runId);
    }
}
