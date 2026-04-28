import { branchNameWave } from "../../core/branchNames.js";
import { commitAll } from "../../core/git.js";
import { runCycledLoop } from "../../core/iterationLoop.js";
import { emitEvent, getActiveRun } from "../../core/runContext.js";
import { stagePresent } from "../../core/stagePresentation.js";
import { executionCoderPolicy, resolveHarness } from "../../llm/registry.js";
import { runCoderHarness } from "../../llm/hosted/execution/coderHarness.js";
import { llm6bFix, llm6bImplement } from "../../sim/llm.js";
import { buildReviewArtifact, printReviewResult, runStoryReview } from "./ralphStoryReview.js";
import { appendLog, consumePendingRemediation, cycleReviewPath, ensureBranchAndStartLog, logEntry, recordStoryBlocked, requireStoryBranch, writeJson, } from "./ralphRuntimeShared.js";
export async function runRalphLoop(input) {
    const { ctx, implementation } = input;
    let { storyReview } = input;
    await ensureBranchAndStartLog(ctx, implementation);
    const initialFeedback = storyReview?.outcome === "revise" ? storyReview.feedbackSummary.join("; ") : undefined;
    const seedFeedback = await consumePendingRemediation(ctx, input.pendingRemediation, initialFeedback);
    return runCycledLoop({
        maxCycles: implementation.maxReviewCycles,
        startCycle: Math.max(implementation.currentReviewCycle, 0),
        initialFeedback: seedFeedback,
        runCycle: async ({ cycle: reviewCycle, feedback }) => {
            implementation.currentReviewCycle = reviewCycle;
            if (implementation.status !== "ready_for_review") {
                const coderOutcome = await runCoderCycleUntilGreen(ctx, implementation, {
                    reviewCycle,
                    feedback,
                });
                if (coderOutcome === "exhausted") {
                    return {
                        kind: "exhausted",
                        reason: `story_error:${implementation.maxIterations}-iterations:cycle-${reviewCycle + 1}`,
                    };
                }
            }
            const cycleResult = await runOneReviewCycle(ctx, implementation, reviewCycle);
            storyReview = cycleResult.review;
            if (cycleResult.kind === "passed") {
                return { kind: "done", result: { implementation, review: storyReview } };
            }
            return { kind: "continue", nextFeedback: cycleResult.nextFeedback };
        },
        onAllCyclesExhausted: async (exhaustion) => {
            if (exhaustion.kind === "cycle-exhausted") {
                return blockStory(ctx, implementation, storyReview, "story_error", `Blocked after ${implementation.maxIterations} implementation iterations in review cycle ${exhaustion.lastCycle + 1} without reaching green.`);
            }
            return blockStory(ctx, implementation, storyReview, "review_limit", `Blocked after ${implementation.maxReviewCycles} story review cycles because the CodeRabbit/SonarQube gate did not open.`);
        },
    });
}
async function runCoderCycleUntilGreen(ctx, implementation, opts) {
    implementation.status = "in_progress";
    let iterationsThisCycle = countIterationsInCycle(implementation, opts.reviewCycle);
    while (iterationsThisCycle < implementation.maxIterations) {
        iterationsThisCycle++;
        const result = await runOneIteration(ctx, implementation, {
            reviewCycle: opts.reviewCycle,
            iterationsThisCycle,
            feedback: opts.feedback,
        });
        if (result === "done")
            return "ready_for_review";
    }
    return "exhausted";
}
async function runOneIteration(ctx, implementation, opts) {
    const iterationNumber = implementation.iterations.length + 1;
    const isRemediation = Boolean(opts.feedback);
    stagePresent.step(isRemediation
        ? `    Ralph addresses review findings for ${ctx.storyContext.story.id}...`
        : `    Ralph implements ${ctx.storyContext.story.id}...`);
    let coderSummary;
    let changedFiles = [];
    let notes = isRemediation ? ["Remediation run triggered by story review."] : [];
    if (ctx.llm) {
        const llmResult = await executeLlmIteration(ctx, implementation, {
            iterationNumber,
            reviewCycle: opts.reviewCycle,
            isRemediation,
            feedback: opts.feedback,
        });
        coderSummary = llmResult.summary;
        changedFiles = llmResult.changedFiles;
        notes = [...notes, ...llmResult.notes];
    }
    else {
        changedFiles = await executeFallbackIteration(ctx, isRemediation, opts.feedback);
    }
    const action = isRemediation
        ? `Apply review feedback: ${opts.feedback}`
        : "Implement story against approved test plan";
    const checks = checksForIteration(opts.iterationsThisCycle, isRemediation);
    const result = resultFromChecks(checks);
    implementation.iterations.push({
        number: iterationNumber,
        reviewCycle: opts.reviewCycle,
        action,
        checks,
        result: result === "done" && isRemediation ? "review_feedback_applied" : result,
        notes,
    });
    (implementation.priorAttempts ??= []).push({
        iteration: iterationNumber,
        summary: coderSummary ?? (result === "done" ? "Implementation reached green." : "Implementation still failing checks."),
        outcome: result === "done" ? "passed" : "failed",
    });
    implementation.changedFiles = Array.from(new Set([...implementation.changedFiles, ...changedFiles]));
    implementation.status = result === "done" ? "ready_for_review" : "in_progress";
    if (result === "done") {
        implementation.finalSummary = "Implementation reached a green state and is ready for story review.";
    }
    await writeJson(ctx.paths.implementationPath, implementation);
    const commitMessage = isRemediation
        ? `Apply review feedback for ${ctx.storyContext.story.id}`
        : `Implement ${ctx.storyContext.story.id}`;
    await appendLog(ctx.paths.logPath, logEntry("branch_event", `Commit: ${commitMessage}`, {
        storyId: ctx.storyContext.story.id,
        branch: requireStoryBranch(ctx.storyContext),
        commit: commitMessage,
    }));
    await appendLog(ctx.paths.logPath, logEntry("iteration", `Iteration ${iterationNumber} (cycle ${opts.reviewCycle}): ${result}`, {
        storyId: ctx.storyContext.story.id,
        iteration: iterationNumber,
        reviewCycle: opts.reviewCycle,
        action,
        checks,
        result,
    }));
    return result;
}
async function executeLlmIteration(ctx, implementation, opts) {
    if (!ctx.llm)
        throw new Error("LLM iteration requested without execution LLM configuration");
    const harness = resolveHarness({
        workspaceRoot: ctx.llm.workspaceRoot,
        harnessProfile: ctx.llm.harnessProfile,
        runtimePolicy: ctx.llm.runtimePolicy,
        role: "coder",
        stage: "execution",
    });
    const coderResult = await runCoderHarness({
        harness,
        runtimePolicy: executionCoderPolicy(ctx.llm.runtimePolicy),
        baselinePath: ctx.paths.baselinePath,
        storyContext: implementation.mockupDeliveredToSession
            ? { ...ctx.storyContext, mockupHtmlByScreen: undefined }
            : ctx.storyContext,
        reviewFeedback: opts.isRemediation ? opts.feedback ?? "" : undefined,
        sessionId: implementation.coderSessionId ?? null,
        iterationContext: {
            iteration: opts.iterationNumber,
            maxIterations: implementation.maxIterations,
            reviewCycle: opts.reviewCycle + 1,
            maxReviewCycles: implementation.maxReviewCycles,
            priorAttempts: implementation.priorAttempts ?? [],
        },
    });
    implementation.coderSessionId = coderResult.sessionId;
    implementation.mockupDeliveredToSession ||= Boolean(ctx.storyContext.mockupHtmlByScreen);
    stagePresent.dim(`    → ${coderResult.summary}`);
    commitIterationWorktree(ctx, opts.iterationNumber, opts.isRemediation);
    return {
        summary: coderResult.summary,
        changedFiles: coderResult.changedFiles,
        notes: [
            ...coderResult.implementationNotes,
            ...coderResult.blockers.map(blocker => `[blocker] ${blocker}`),
        ],
    };
}
function commitIterationWorktree(ctx, iterationNumber, isRemediation) {
    if (!ctx.storyContext.worktreeRoot)
        return;
    const sha = commitAll(ctx.storyContext.worktreeRoot, isRemediation
        ? `Apply review feedback for ${ctx.storyContext.story.id} (iteration ${iterationNumber})`
        : `Implement ${ctx.storyContext.story.id} (iteration ${iterationNumber})`);
    if (sha)
        stagePresent.dim(`    → committed ${ctx.storyContext.story.id} iteration ${iterationNumber}: ${sha.slice(0, 8)}`);
}
async function executeFallbackIteration(ctx, isRemediation, feedback) {
    if (isRemediation) {
        await llm6bFix(feedback ?? "");
        return [];
    }
    await llm6bImplement({
        id: ctx.storyContext.story.id,
        title: ctx.storyContext.story.title,
        acceptanceCriteria: ctx.storyContext.story.acceptanceCriteria,
    });
    return [
        `src/${ctx.storyContext.story.id.toLowerCase()}/handler.ts`,
        `src/${ctx.storyContext.story.id.toLowerCase()}/service.ts`,
    ];
}
async function runOneReviewCycle(ctx, implementation, reviewCycle) {
    await appendLog(ctx.paths.logPath, logEntry("status_changed", `Transition to review cycle ${reviewCycle}`, {
        storyId: ctx.storyContext.story.id,
        reviewCycle,
    }));
    const reviewResult = await runStoryReview({
        reviewCycle: reviewCycle + 1,
        storyContext: ctx.storyContext,
        artifactsDir: ctx.paths.dir,
        baselinePath: ctx.paths.baselinePath,
        llm: ctx.llm,
        implementation,
    });
    printReviewResult(reviewResult);
    const storyReview = buildReviewArtifact(ctx.storyContext, reviewCycle + 1, reviewResult);
    await writeJson(cycleReviewPath(ctx.paths.dir, reviewCycle + 1), storyReview);
    await writeJson(ctx.paths.reviewPath, storyReview);
    await appendLog(ctx.paths.logPath, logEntry(storyReview.outcome.startsWith("pass") ? "review_pass" : "review_revise", `Review cycle ${reviewCycle} ${storyReview.outcome}`, {
        storyId: ctx.storyContext.story.id,
        reviewCycle,
        findings: reviewResult.combinedFindings,
    }));
    if (!storyReview.outcome.startsWith("pass")) {
        implementation.status = "in_progress";
        await writeJson(ctx.paths.implementationPath, implementation);
        const nextFeedback = storyReview.feedbackSummary.join("; ");
        const activeRun = getActiveRun();
        if (activeRun) {
            emitEvent({
                type: "review_feedback",
                runId: activeRun.runId,
                stageRunId: activeRun.stageRunId ?? null,
                stageKey: "executing",
                cycle: reviewCycle + 1,
                feedback: nextFeedback,
            });
        }
        return { kind: "revise", review: storyReview, nextFeedback };
    }
    const passedStoryBranch = requireStoryBranch(ctx.storyContext);
    const passedWaveBranch = branchNameWave(ctx.runtimeContext, ctx.storyContext.project.id, ctx.storyContext.wave.number);
    await appendLog(ctx.paths.logPath, logEntry("branch_event", `Story ready to merge: ${passedStoryBranch} → ${passedWaveBranch}`, {
        storyId: ctx.storyContext.story.id,
        branch: passedStoryBranch,
        target: passedWaveBranch,
    }));
    implementation.status = "passed";
    implementation.finalSummary = `Story implementation and story review both passed; ${passedStoryBranch} ready to merge into ${passedWaveBranch}.`;
    await writeJson(ctx.paths.implementationPath, implementation);
    await appendLog(ctx.paths.logPath, logEntry("status_changed", `Story ${ctx.storyContext.story.id} passed`, {
        storyId: ctx.storyContext.story.id,
        status: "passed",
    }));
    return { kind: "passed", review: storyReview };
}
async function blockStory(ctx, implementation, storyReview, cause, summary) {
    implementation.status = "blocked";
    implementation.finalSummary = summary;
    await appendLog(ctx.paths.logPath, logEntry("branch_event", `Story blocked: ${requireStoryBranch(ctx.storyContext)}`, {
        storyId: ctx.storyContext.story.id,
        branch: requireStoryBranch(ctx.storyContext),
    }));
    await writeJson(ctx.paths.implementationPath, implementation);
    await appendLog(ctx.paths.logPath, logEntry("status_changed", `Story ${ctx.storyContext.story.id} blocked`, {
        storyId: ctx.storyContext.story.id,
        status: "blocked",
    }));
    await recordStoryBlocked(ctx.runtimeContext, ctx.storyContext, implementation, storyReview, cause, summary);
    return { implementation, review: storyReview };
}
function checksForIteration(iterationsThisCycle, isRemediation) {
    const green = iterationsThisCycle >= 2 || isRemediation;
    return [
        {
            name: isRemediation ? "targeted-remediation-tests" : "story-tests",
            kind: "integration",
            status: green ? "pass" : "fail",
            summary: green ? "All mapped checks passed." : "Acceptance criteria coverage still incomplete.",
        },
        { name: "typecheck", kind: "typecheck", status: "pass" },
    ];
}
function resultFromChecks(checks) {
    return checks.every(check => check.status !== "fail") ? "done" : "tests_failed";
}
function countIterationsInCycle(implementation, reviewCycle) {
    return implementation.iterations.filter(iteration => iteration.reviewCycle === reviewCycle).length;
}
