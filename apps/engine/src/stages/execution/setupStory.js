import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { commitAll } from "../../core/git.js";
import { layout } from "../../core/workspaceLayout.js";
import { stagePresent } from "../../core/stagePresentation.js";
import { executionCoderPolicy, resolveHarness } from "../../llm/registry.js";
import { runCoderHarness } from "../../llm/hosted/execution/coderHarness.js";
import { verifySetupContract } from "./setupContractVerifier.js";
import { buildStoryExecutionContext, executionStageLlmForStory } from "./storyContext.js";
async function readJsonIfExists(path) {
    try {
        return JSON.parse(await readFile(path, "utf8"));
    }
    catch {
        return undefined;
    }
}
function setupTaskReferences(ctx, storyId, explicitReferences) {
    const references = [...(explicitReferences ?? [])];
    const designTokensPath = join(layout.stageArtifactsDir(ctx, "frontend-design"), "design-tokens.css");
    const alreadyAttached = references.some(ref => ref.name === "design-tokens.css");
    if (existsSync(designTokensPath) && !alreadyAttached) {
        references.push({
            kind: "file",
            name: "design-tokens.css",
            path: designTokensPath,
            instruction: "Copy this file to apps/ui/app/design-tokens.css and import it from the UI layout. Subsequent feature stories must consume this file unmodified.",
        });
    }
    const _storyId = storyId;
    if (_storyId === "")
        return references.length > 0 ? references : undefined;
    return references.length > 0 ? references : undefined;
}
function setupTaskForWave(wave, storyId) {
    return wave.tasks?.find(task => task.id === storyId);
}
function setupTestPlan(ctx, story, contract) {
    return {
        project: { id: ctx.project.id, name: ctx.project.name },
        story: { id: story.id, title: story.title },
        acceptanceCriteria: [],
        testPlan: {
            summary: `Satisfy setup contract for ${story.id}.`,
            testCases: [],
            fixtures: contract.expectedFiles,
            edgeCases: contract.postChecks,
            assumptions: contract.requiredScripts,
        },
    };
}
export async function runSetupStory(ctx, wave, story, screenOwners, opts, llm) {
    const persistedImplementation = await readJsonIfExists(join(layout.executionRalphDir(ctx, wave.number, story.id), "implementation.json"));
    if (persistedImplementation?.status === "passed") {
        return { storyId: story.id, implementation: persistedImplementation };
    }
    const task = setupTaskForWave(wave, story.id);
    if (!task)
        throw new Error(`Setup wave ${wave.id} is missing task metadata for ${story.id}`);
    const testPlan = setupTestPlan(ctx, story, task.contract);
    const storyContext = buildStoryExecutionContext(ctx, wave, ctx.architecture, testPlan, {
        worktreeRoot: opts.worktreeRoot,
        screenOwners,
        kind: "setup",
        setupContract: task.contract,
        references: setupTaskReferences(ctx, story.id, task.references),
    });
    const workspaceRoot = storyContext.worktreeRoot ?? process.cwd();
    const executionLlm = executionStageLlmForStory(llm?.executionCoder, opts.worktreeRoot);
    const implementation = {
        story: { id: story.id, title: story.title },
        mode: "ralph-wiggum",
        status: "in_progress",
        implementationGoal: storyContext.testPlan.testPlan.summary,
        maxIterations: 3,
        maxReviewCycles: 3,
        currentReviewCycle: 0,
        iterations: [],
        coderSessionId: null,
        priorAttempts: [],
        changedFiles: [],
        finalSummary: "",
    };
    const dir = layout.executionRalphDir(ctx, wave.number, story.id);
    const implementationPath = join(dir, "implementation.json");
    const baselinePath = join(dir, "coder-baseline.json");
    await mkdir(dir, { recursive: true });
    for (let attempt = 1; attempt <= implementation.maxReviewCycles; attempt++) {
        const attemptResult = await runSetupAttempt({
            attempt,
            baselinePath,
            executionLlm,
            implementation,
            storyContext,
            workspaceRoot,
            taskContract: task.contract,
        });
        recordSetupAttempt(implementation, attempt, attemptResult);
        if (attemptResult.failures.length === 0) {
            implementation.status = "passed";
            implementation.finalSummary = "Setup contract satisfied.";
            if (opts.worktreeRoot) {
                const sha = commitAll(opts.worktreeRoot, `Setup task ${task.id}: ${task.title}`);
                if (sha) {
                    stagePresent.dim(`  Committed setup worktree ${task.id}: ${sha.slice(0, 8)}`);
                }
            }
            break;
        }
        implementation.finalSummary = attemptResult.failures.join("; ");
    }
    if (implementation.status !== "passed") {
        implementation.status = "blocked";
        implementation.finalSummary ||= "Setup contract did not converge within the review cap.";
    }
    await writeFile(implementationPath, `${JSON.stringify(implementation, null, 2)}\n`);
    stagePresent.dim(`  Status: ${implementation.status}`);
    return { storyId: story.id, implementation };
}
async function runSetupAttempt(input) {
    const llmResult = input.executionLlm
        ? await runSetupAttemptWithLlm({ ...input, executionLlm: input.executionLlm })
        : { changedFiles: [], notes: [], summary: `Setup attempt ${input.attempt} completed.` };
    return {
        ...llmResult,
        failures: verifySetupContract(input.workspaceRoot, input.taskContract),
    };
}
async function runSetupAttemptWithLlm(input) {
    const coderResult = await runCoderHarness({
        harness: resolveHarness({
            workspaceRoot: input.executionLlm.workspaceRoot,
            harnessProfile: input.executionLlm.harnessProfile,
            runtimePolicy: input.executionLlm.runtimePolicy,
            role: "coder",
            stage: "execution",
        }),
        runtimePolicy: executionCoderPolicy(input.executionLlm.runtimePolicy),
        baselinePath: input.baselinePath,
        storyContext: input.storyContext,
        sessionId: input.implementation.coderSessionId ?? null,
        iterationContext: {
            iteration: input.attempt,
            maxIterations: input.implementation.maxIterations,
            reviewCycle: input.attempt,
            maxReviewCycles: input.implementation.maxReviewCycles,
            priorAttempts: input.implementation.priorAttempts ?? [],
        },
    });
    input.implementation.coderSessionId = coderResult.sessionId;
    return {
        changedFiles: coderResult.changedFiles,
        notes: coderResult.implementationNotes,
        summary: coderResult.summary,
    };
}
function recordSetupAttempt(implementation, attempt, attemptResult) {
    implementation.changedFiles = Array.from(new Set([...implementation.changedFiles, ...attemptResult.changedFiles]));
    implementation.iterations.push({
        number: attempt,
        reviewCycle: attempt - 1,
        action: "Apply setup contract",
        checks: [{
                name: "setup-contract",
                kind: "review-gate",
                status: attemptResult.failures.length === 0 ? "pass" : "fail",
                summary: attemptResult.failures.length === 0 ? "Setup contract satisfied." : attemptResult.failures.join("; "),
            }],
        result: attemptResult.failures.length === 0 ? "done" : "review_feedback_applied",
        notes: [...attemptResult.notes, ...attemptResult.failures],
    });
    implementation.priorAttempts?.push({
        iteration: attempt,
        summary: attemptResult.summary,
        outcome: attemptResult.failures.length === 0 ? "passed" : "failed",
    });
    implementation.currentReviewCycle = attempt - 1;
}
