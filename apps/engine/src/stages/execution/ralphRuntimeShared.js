import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { branchNameStory } from "../../core/branchNames.js";
import { emitEvent, getActiveRun } from "../../core/runContext.js";
import { writeRecoveryRecord } from "../../core/recovery.js";
import { resolveRalphLoopConfig } from "../../core/loopConfig.js";
import { layout } from "../../core/workspaceLayout.js";
export function requireStoryBranch(storyContext) {
    if (storyContext.storyBranch)
        return storyContext.storyBranch;
    return branchNameStory({ itemSlug: storyContext.item.slug }, storyContext.project.id, storyContext.wave.number, storyContext.story.id);
}
export async function readJsonIfExists(path) {
    try {
        return JSON.parse(await readFile(path, "utf8"));
    }
    catch {
        return undefined;
    }
}
export async function writeJson(path, value) {
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
export async function appendLog(path, entry) {
    await writeFile(path, `${JSON.stringify(entry)}\n`, { flag: "a" });
}
export function logEntry(type, message, data) {
    return { at: new Date().toISOString(), type, message, ...(data ? { data } : {}) };
}
export function ralphPaths(runtimeContext, storyContext) {
    const dir = layout.executionRalphDir(runtimeContext, storyContext.wave.number, storyContext.story.id);
    return {
        dir,
        implementationPath: join(dir, "implementation.json"),
        reviewPath: join(dir, "story-review.json"),
        logPath: join(dir, "log.jsonl"),
        remediationPath: join(dir, "pending-remediation.json"),
        baselinePath: join(dir, "coder-baseline.json"),
    };
}
export function cycleReviewPath(dir, cycle) {
    return join(dir, `story-review-cycle-${cycle}.json`);
}
export function newImplementation(storyContext) {
    const cfg = resolveRalphLoopConfig();
    return {
        story: { id: storyContext.story.id, title: storyContext.story.title },
        mode: "ralph-wiggum",
        status: "in_progress",
        implementationGoal: storyContext.testPlan.testPlan.summary,
        maxIterations: cfg.maxIterationsPerCycle,
        maxReviewCycles: cfg.maxReviewCycles,
        currentReviewCycle: 0,
        iterations: [],
        coderSessionId: null,
        mockupDeliveredToSession: false,
        priorAttempts: [],
        changedFiles: [],
        finalSummary: "",
    };
}
export async function ensureBranchAndStartLog(ctx, implementation) {
    if (implementation.iterations.length > 0)
        return;
    const branchName = requireStoryBranch(ctx.storyContext);
    await appendLog(ctx.paths.logPath, logEntry("branch_event", `Branch ready: ${branchName}`, {
        storyId: ctx.storyContext.story.id,
        branch: branchName,
    }));
    await appendLog(ctx.paths.logPath, logEntry("status_changed", `Story ${ctx.storyContext.story.id} started`, {
        storyId: ctx.storyContext.story.id,
    }));
}
export async function consumePendingRemediation(ctx, remediation, existingFeedback) {
    if (!remediation)
        return existingFeedback;
    const remediationLine = [
        `[external-remediation] ${remediation.summary}`,
        remediation.branch ? `branch=${remediation.branch}` : undefined,
        remediation.commitSha ? `commit=${remediation.commitSha}` : undefined,
        remediation.reviewNotes ? `notes=${remediation.reviewNotes}` : undefined,
    ]
        .filter(Boolean)
        .join(" | ");
    const merged = existingFeedback ? `${remediationLine}; ${existingFeedback}` : remediationLine;
    await appendLog(ctx.paths.logPath, logEntry("stage_message", "External remediation applied to next iteration", {
        storyId: ctx.storyContext.story.id,
        remediationId: remediation.id,
    }));
    try {
        await unlink(ctx.paths.remediationPath);
    }
    catch {
        // Already consumed or removed.
    }
    return merged;
}
export async function recordStoryBlocked(ctx, storyContext, implementation, review, cause, summary) {
    const dir = layout.executionRalphDir(ctx, storyContext.wave.number, storyContext.story.id);
    const findings = review?.reviewers.flatMap(reviewer => reviewer.findings.map(finding => flattenFinding(reviewer.source, finding))) ?? [];
    await writeRecoveryRecord(ctx, {
        status: "blocked",
        cause,
        scope: {
            type: "story",
            runId: ctx.runId,
            waveNumber: storyContext.wave.number,
            storyId: storyContext.story.id,
        },
        summary,
        branch: branchNameStory(ctx, storyContext.project.id, storyContext.wave.number, storyContext.story.id),
        evidencePaths: [
            join(dir, "implementation.json"),
            join(dir, "story-review.json"),
            join(dir, "log.jsonl"),
        ],
        findings,
    });
    const activeRun = getActiveRun();
    if (!activeRun)
        return;
    emitEvent({
        type: "run_blocked",
        runId: activeRun.runId,
        itemId: activeRun.itemId,
        title: activeRun.title ?? activeRun.itemId,
        scope: {
            type: "story",
            runId: ctx.runId,
            waveNumber: storyContext.wave.number,
            storyId: storyContext.story.id,
        },
        cause,
        summary,
        branch: branchNameStory(ctx, storyContext.project.id, storyContext.wave.number, storyContext.story.id),
    });
}
export async function readPersistedStoryState(paths) {
    const [implementation, review, pendingRemediation] = await Promise.all([
        readJsonIfExists(paths.implementationPath),
        readJsonIfExists(paths.reviewPath),
        readJsonIfExists(paths.remediationPath),
    ]);
    return { implementation, review, pendingRemediation };
}
function flattenFinding(source, finding) {
    return {
        source,
        severity: finding.severity,
        message: finding.message,
    };
}
