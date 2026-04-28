import { runStage } from "../../core/stageRuntime.js";
import { printStageCompletion, stageSummary, summaryArtifactFile } from "../../core/stageHelpers.js";
import { stagePresent } from "../../core/stagePresentation.js";
import { createRequirementsReview, createRequirementsStage } from "../../llm/registry.js";
import { projectDesignGuidance } from "../../core/designPrep.js";
import { renderPrdMarkdown } from "../../render/prd.js";
import { ask } from "../../sim/human.js";
export async function requirements(ctx, llm) {
    stagePresent.header(`requirements — ${ctx.project.name}`);
    stagePresent.dim(`Concept: ${ctx.project.concept.summary}`);
    const { result } = await runStage({
        stageId: "requirements",
        stageAgentLabel: "LLM-3 (Requirements)",
        reviewerLabel: "Review-LLM",
        workspaceId: ctx.workspaceId,
        workspaceRoot: ctx.workspaceRoot,
        runId: ctx.runId,
        createInitialState: () => ({
            concept: ctx.project.concept,
            wireframes: ctx.wireframes,
            design: projectDesignGuidance(ctx.design),
            codebase: ctx.codebase,
            decisions: ctx.decisions,
            clarificationCount: 0,
            maxClarifications: 2,
            history: [],
        }),
        stageAgent: createRequirementsStage(llm),
        reviewer: createRequirementsReview(llm),
        askUser: ask,
        async persistArtifacts(run, artifact) {
            return [
                {
                    kind: "json",
                    label: "PRD JSON",
                    fileName: "prd.json",
                    content: JSON.stringify(artifact, null, 2),
                },
                {
                    kind: "md",
                    label: "PRD Markdown",
                    fileName: "prd.md",
                    content: renderPrdMarkdown(artifact),
                },
                summaryArtifactFile("requirements", stageSummary(run, [
                    `Clarification turns: ${run.userTurnCount}`,
                    `Stories produced: ${artifact.prd.stories.length}`,
                ])),
            ];
        },
        async onApproved(artifact, run) {
            stagePresent.ok("LLM review: PRD is ready for the next step.");
            artifact.prd.stories.forEach(story => {
                stagePresent.chat(`Story ${story.id}`, story.title);
                story.acceptanceCriteria.forEach(ac => stagePresent.dim(`  AC ${ac.id}: ${ac.text}`));
            });
            printStageCompletion(run, "requirements");
            return artifact.prd;
        },
        maxReviews: 4,
    });
    return result;
}
