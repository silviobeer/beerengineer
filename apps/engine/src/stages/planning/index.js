import { runStage } from "../../core/stageRuntime.js";
import { printStageCompletion, stageSummary, summaryArtifactFile } from "../../core/stageHelpers.js";
import { stagePresent } from "../../core/stagePresentation.js";
import { createPlanningReview, createPlanningStage } from "../../llm/registry.js";
import { enforceWaveParallelism } from "../../core/planValidator.js";
import { renderArchitectureSummary } from "../../render/artifactDigests.js";
import { renderPlanMarkdown } from "../../render/plan.js";
function validatePlanStoryIds(artifact, prd) {
    const prdIds = new Set(prd.stories.map(s => s.id));
    const seen = new Set();
    const issues = [];
    const waves = artifact.plan?.waves;
    if (!Array.isArray(waves)) {
        return `Plan is missing a \`plan.waves\` array. The artifact must include \`plan.waves: Array<{id,number,goal,stories,internallyParallelizable,dependencies,exitCriteria}>\`; got \`${JSON.stringify(artifact.plan ?? null).slice(0, 200)}\`.`;
    }
    if (waves.length === 0) {
        return `Plan contains zero waves. Every PRD story must belong to exactly one wave; emit at least one wave with the PRD stories assigned.`;
    }
    const waveIds = new Set(waves.map(w => w.id));
    const waveIdsBefore = new Map();
    const idsBefore = new Set();
    for (const wave of waves) {
        waveIdsBefore.set(wave.id, new Set(idsBefore));
        idsBefore.add(wave.id);
    }
    for (const wave of waves) {
        validateWaveShape(wave, prdIds, seen, issues);
        validateWaveDependencies(wave, waveIds, waveIdsBefore, issues);
    }
    for (const s of prd.stories) {
        if (!seen.has(s.id))
            issues.push(`PRD story "${s.id}" is not assigned to any wave.`);
    }
    return issues.length > 0 ? issues.join(" ") : null;
}
function validateWaveShape(wave, prdIds, seen, issues) {
    if ((wave.kind ?? "feature") === "setup") {
        validateSetupWave(wave, issues);
        return;
    }
    validateFeatureWave(wave, prdIds, seen, issues);
}
function validateSetupWave(wave, issues) {
    const setupTasks = Array.isArray(wave.tasks) ? wave.tasks : [];
    if (setupTasks.length === 0) {
        issues.push(`Setup wave ${wave.id ?? wave.number ?? "?"} has zero tasks. Setup waves must use \`tasks\` with at least one setup task.`);
    }
    for (const task of setupTasks) {
        if (!task.id || !task.title) {
            issues.push(`Setup wave ${wave.id} contains a task missing \`id\` or \`title\`.`);
            continue;
        }
        validateSetupTask(wave.id, task, issues);
    }
}
function validateSetupTask(waveId, task, issues) {
    const contract = task.contract;
    if (!contract ||
        !Array.isArray(contract.expectedFiles) ||
        !Array.isArray(contract.requiredScripts) ||
        !Array.isArray(contract.postChecks)) {
        issues.push(`Setup wave ${waveId} task "${task.id}" has malformed \`contract\`; required shape is { expectedFiles: string[], requiredScripts: string[], postChecks: string[] }.`);
    }
    if (!Array.isArray(task.sharedFiles)) {
        issues.push(`Setup wave ${waveId} task "${task.id}" is missing \`sharedFiles: string[]\` (use [] when none).`);
    }
}
function validateFeatureWave(wave, prdIds, seen, issues) {
    const storyList = Array.isArray(wave.stories) ? wave.stories : [];
    if (storyList.length === 0) {
        issues.push(`Wave ${wave.id ?? wave.number ?? "?"} has zero stories. Every feature wave must contain at least one PRD story.`);
    }
    for (const ref of storyList) {
        validateFeatureStoryRef(wave.number, ref, prdIds, seen, issues);
    }
}
function validateFeatureStoryRef(waveNumber, ref, prdIds, seen, issues) {
    const id = ref.id;
    const title = ref.title;
    if (!id || typeof id !== "string") {
        issues.push(`Wave ${waveNumber} contains a story without an \`id\` (shape must be {id, title}).`);
        return;
    }
    if (!prdIds.has(id)) {
        const titleSuffix = title ? ` ("${title}")` : "";
        issues.push(`Wave ${waveNumber} references story id "${id}"${titleSuffix} that is not in the PRD. Only PRD story ids are allowed.`);
    }
    if (seen.has(id)) {
        issues.push(`Story id "${id}" appears in more than one wave; each PRD story must appear exactly once.`);
    }
    seen.add(id);
}
function validateWaveDependencies(wave, waveIds, waveIdsBefore, issues) {
    for (const dep of wave.dependencies ?? []) {
        if (typeof dep !== "string" || !/^W\d+$/.test(dep)) {
            issues.push(`Wave ${wave.id} has invalid dependency "${dep}". Dependencies must be an Array<string> of earlier wave ids like "W1" — never prose, never story ids.`);
            continue;
        }
        if (!waveIds.has(dep)) {
            issues.push(`Wave ${wave.id} depends on unknown wave "${dep}".`);
        }
        else if (!waveIdsBefore.get(wave.id).has(dep)) {
            issues.push(`Wave ${wave.id} depends on "${dep}" which is not an earlier wave (dependencies must flow forward only).`);
        }
    }
}
function validatingReviewer(inner, validate) {
    return {
        async review(input) {
            if (!input)
                return inner.review(input);
            const feedback = validate(input.artifact);
            if (feedback)
                return { kind: "revise", feedback };
            return inner.review(input);
        },
        getSessionId: inner.getSessionId?.bind(inner),
        setSessionId: inner.setSessionId?.bind(inner),
    };
}
export async function planning(ctx, llm) {
    stagePresent.header(`planning — ${ctx.project.name}`);
    const { result } = await runStage({
        stageId: "planning",
        stageAgentLabel: "LLM-5 (Planning)",
        reviewerLabel: "Planning-Review-LLM",
        workspaceId: ctx.workspaceId,
        workspaceRoot: ctx.workspaceRoot,
        runId: ctx.runId,
        createInitialState: () => ({
            projectId: ctx.project.id,
            prd: ctx.prd,
            architectureSummary: renderArchitectureSummary(ctx.architecture),
            codebase: ctx.codebase,
            decisions: ctx.decisions,
            revisionCount: 0,
        }),
        stageAgent: createPlanningStage(ctx.project, llm),
        reviewer: validatingReviewer(createPlanningReview(llm), artifact => validatePlanStoryIds(artifact, ctx.prd)),
        askUser: async () => "",
        async persistArtifacts(run, artifact) {
            return [
                {
                    kind: "json",
                    label: "Implementation Plan JSON",
                    fileName: "implementation-plan.json",
                    content: JSON.stringify(artifact, null, 2),
                },
                {
                    kind: "md",
                    label: "Implementation Plan Markdown",
                    fileName: "implementation-plan.md",
                    content: renderPlanMarkdown(artifact),
                },
                summaryArtifactFile("planning", stageSummary(run, [`Waves: ${Array.isArray(artifact.plan?.waves) ? artifact.plan.waves.length : 0}`])),
            ];
        },
        async onApproved(artifact, run) {
            stagePresent.ok("Planning review: implementation plan is ready.");
            // Post-validate: downgrade `internallyParallelizable: true` to
            // false on any wave whose stories share files (or fail to declare
            // sharedFiles, treated as overlap-unknown). Mutates `artifact` in
            // place; emits canonical `wave_serialized` events for audit.
            const decisions = enforceWaveParallelism(artifact, { runId: ctx.runId });
            for (const decision of decisions) {
                const reasonText = decision.cause === "missing_shared_files"
                    ? `wave ${decision.waveId}: forced sequential because stories did not declare sharedFiles (overlap unknown)`
                    : `wave ${decision.waveId}: forced sequential due to shared-file overlap on ${decision.overlappingFiles.join(", ")}`;
                stagePresent.warn(reasonText);
            }
            const waves = Array.isArray(artifact.plan?.waves) ? artifact.plan.waves : [];
            waves.forEach(wave => {
                let tag = "(stories run sequentially)";
                if (wave.kind === "setup")
                    tag = "(shared infra setup)";
                else if (wave.internallyParallelizable)
                    tag = "(stories can run in parallel)";
                let entries = [];
                if (wave.kind === "setup")
                    entries = Array.isArray(wave.tasks) ? wave.tasks : [];
                else
                    entries = Array.isArray(wave.stories) ? wave.stories : [];
                stagePresent.chat(`Wave ${wave.number} ${tag}`, entries.map(story => story.title).join(", "));
            });
            printStageCompletion(run, "planning");
            return artifact;
        },
        maxReviews: 4,
    });
    return result;
}
