import { cpSync, existsSync } from "node:fs";
import { busToWorkflowIO, createBus } from "./bus.js";
import { appendItemDecision } from "./itemDecisions.js";
import { withPromptPersistence } from "./promptPersistence.js";
import { prepareRun } from "./runOrchestrator.js";
import { loadResumeReadiness, performResume } from "./resume.js";
import { getRegisteredWorkspace } from "./workspaces.js";
import { layout } from "./workspaceLayout.js";
import { resolveWorkflowContextForItemRun, resolveWorkflowContextForRun } from "./workflowContextResolver.js";
function buildApiIo(repos) {
    const bus = createBus();
    const detachPersistence = withPromptPersistence(bus, repos);
    const io = busToWorkflowIO(bus);
    const originalClose = io.close;
    return {
        ...io,
        close() {
            detachPersistence();
            originalClose?.();
        },
    };
}
function fireInBackground(io, label, task) {
    task()
        .catch(err => {
        const e = err;
        process.stderr.write(`[runService:${label}] ${e.message}\n${e.stack ?? ""}\n`);
    })
        .finally(() => {
        io.close?.();
    });
}
function hasStageArtifacts(repos, item, runId, stageId) {
    const run = repos.getRun(runId);
    const ctx = run ? resolveWorkflowContextForItemRun(repos, item, run) : null;
    return ctx ? existsSync(layout.stageDir(ctx, stageId)) : false;
}
function latestRunWithStageArtifacts(repos, item, stageId) {
    return repos
        .listRuns()
        .filter(run => run.item_id === item.id)
        .sort((a, b) => b.created_at - a.created_at)
        .find(run => hasStageArtifacts(repos, item, run.id, stageId));
}
function seedStageFromPreviousRun(repos, item, sourceRun, targetRun, stageId) {
    const sourceCtx = resolveWorkflowContextForItemRun(repos, item, sourceRun);
    const targetCtx = resolveWorkflowContextForItemRun(repos, item, targetRun);
    if (!sourceCtx || !targetCtx)
        return false;
    const sourceStageDir = layout.stageDir(sourceCtx, stageId);
    if (!existsSync(sourceStageDir))
        return false;
    cpSync(sourceStageDir, layout.stageDir(targetCtx, stageId), {
        recursive: true,
    });
    return true;
}
function resolveWorkspaceMeta(repos, workspaceKey) {
    if (!workspaceKey)
        return {};
    const workspace = getRegisteredWorkspace(repos, workspaceKey);
    if (!workspace)
        return { error: "unknown_workspace" };
    return { workspaceKey: workspace.key, workspaceName: workspace.name };
}
/**
 * `POST /runs` — start a fresh run from a UI-supplied idea. No CLI intake
 * prompts; title + description arrive on the request body.
 */
export function startRunFromIdea(repos, input) {
    const meta = resolveWorkspaceMeta(repos, input.workspaceKey);
    if ("error" in meta)
        return { ok: false, status: 404, error: "unknown_workspace" };
    const io = buildApiIo(repos);
    const prepared = prepareRun({ id: "new", title: input.title, description: input.description }, repos, io, { owner: "api", ...meta, onItemColumnChanged: input.onItemColumnChanged });
    fireInBackground(io, "startRunFromIdea", prepared.start);
    return { ok: true, runId: prepared.runId, itemId: prepared.itemId };
}
function prepareStartRunAction(repos, item, action) {
    if (action === "start_implementation" || action === "rerun_design_prep") {
        const sourceRun = latestRunWithStageArtifacts(repos, item, "brainstorm");
        if (!sourceRun)
            return { seedStages: [], error: { ok: false, status: 409, error: "no_brainstorm_artifacts" } };
        return {
            sourceRun,
            resume: {
                scope: { type: "run", runId: "pending" },
                currentStage: action === "rerun_design_prep" ? "visual-companion" : "projects",
            },
            seedStages: ["brainstorm", "visual-companion", "frontend-design"],
        };
    }
    if (action === "start_visual_companion") {
        const sourceRun = latestRunWithStageArtifacts(repos, item, "brainstorm");
        if (!sourceRun)
            return { seedStages: [], error: { ok: false, status: 409, error: "no_brainstorm_artifacts" } };
        return {
            sourceRun,
            resume: {
                scope: { type: "run", runId: "pending" },
                currentStage: "visual-companion",
                manualStage: "visual-companion",
            },
            seedStages: ["brainstorm"],
        };
    }
    if (action === "start_frontend_design") {
        const sourceRun = latestRunWithStageArtifacts(repos, item, "visual-companion");
        if (!sourceRun)
            return { seedStages: [], error: { ok: false, status: 409, error: "no_visual_companion_artifacts" } };
        return {
            sourceRun,
            resume: {
                scope: { type: "run", runId: "pending" },
                currentStage: "frontend-design",
                manualStage: "frontend-design",
            },
            seedStages: ["brainstorm", "visual-companion"],
        };
    }
    return { seedStages: [] };
}
export function startRunForItem(repos, input) {
    const item = repos.getItem(input.itemId);
    if (!item)
        return { ok: false, status: 404, error: "item_not_found" };
    const preparedAction = prepareStartRunAction(repos, item, input.action);
    if (preparedAction.error)
        return preparedAction.error;
    const io = buildApiIo(repos);
    const prepared = prepareRun({ id: item.id, title: item.title, description: item.description }, repos, io, { owner: "api", itemId: item.id, resume: preparedAction.resume, onItemColumnChanged: input.onItemColumnChanged });
    if (preparedAction.sourceRun && preparedAction.seedStages.length > 0) {
        // Brainstorm is the only stage required by every downstream branch,
        // so absent seed there is fatal. The other stages are best-effort —
        // a manual `start_visual_companion` legitimately has no prior visual
        // artifacts to seed.
        const brainstormRequired = preparedAction.seedStages.includes("brainstorm");
        for (const stageId of preparedAction.seedStages) {
            const targetRun = repos.getRun(prepared.runId);
            const seeded = targetRun
                ? seedStageFromPreviousRun(repos, item, preparedAction.sourceRun, targetRun, stageId)
                : false;
            if (!seeded && stageId === "brainstorm" && brainstormRequired) {
                return { ok: false, status: 409, error: "seed_failed" };
            }
        }
    }
    fireInBackground(io, `startRunForItem:${input.action}`, prepared.start);
    return { ok: true, runId: prepared.runId, itemId: item.id };
}
/**
 * `POST /runs/:id/resume` — record a remediation and re-enter the workflow
 * in-process. Previously this route only persisted the remediation row and
 * returned `needsSpawn: true` to the UI.
 */
export async function resumeRunInProcess(repos, input) {
    const summary = input.summary.trim();
    if (!summary)
        return { ok: false, status: 422, error: "remediation_required" };
    const readiness = await loadResumeReadiness(repos, input.runId);
    if (readiness.kind === "not_found")
        return { ok: false, status: 404, error: "run_not_found" };
    if (readiness.kind === "no_recovery")
        return { ok: false, status: 409, error: "not_resumable" };
    if (readiness.kind === "not_resumable") {
        return { ok: false, status: 409, error: readiness.reason };
    }
    const scope = readiness.record.scope;
    let scopeRef = null;
    if (scope.type === "stage")
        scopeRef = scope.stageId;
    else if (scope.type === "story")
        scopeRef = `${scope.waveNumber}/${scope.storyId}`;
    const remediation = repos.createExternalRemediation({
        runId: input.runId,
        scope: scope.type,
        scopeRef,
        summary,
        branch: input.branch,
        commitSha: input.commit,
        reviewNotes: input.reviewNotes,
        source: "api",
    });
    // A resume summary is an operator scope decision in plain text — persist
    // it at the workspace level so future runs of the same item respect it,
    // exactly like clarification answers do via recordAnswer.
    const run = repos.getRun(input.runId);
    const ctx = run ? resolveWorkflowContextForRun(repos, run) : null;
    if (ctx) {
        let decisionStage = null;
        if (scope.type === "stage")
            decisionStage = scope.stageId;
        else if (scope.type === "story")
            decisionStage = `execution/${scope.waveNumber}/${scope.storyId}`;
        appendItemDecision(ctx, {
            id: `remediation-${remediation.id}`,
            stage: decisionStage,
            question: `[resume_run] Operator unblocked the run with explicit scope guidance.`,
            answer: input.reviewNotes ? `${summary}\n\nReview notes:\n${input.reviewNotes}` : summary,
            runId: input.runId,
            answeredAt: new Date().toISOString(),
        });
    }
    const io = buildApiIo(repos);
    fireInBackground(io, "resumeRunInProcess", () => performResume({ repos, io, runId: input.runId, remediation, onItemColumnChanged: input.onItemColumnChanged }));
    return { ok: true, runId: input.runId, remediationId: remediation.id };
}
