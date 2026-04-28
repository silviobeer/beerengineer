import { runStage } from "../../core/stageRuntime.js";
import { projectDesignGuidance } from "../../core/designPrep.js";
import { createTestWriterReview, createTestWriterStage, } from "../../llm/registry.js";
import { renderArchitectureSummary } from "../../render/artifactDigests.js";
import { renderTestPlanMarkdown } from "../../render/testPlan.js";
export async function writeStoryTestPlan(ctx, wave, story, llm) {
    const acs = story.acceptanceCriteria.length > 0
        ? story.acceptanceCriteria
        : [
            { id: "AC-01", text: `${story.id} core flow works`, priority: "must", category: "functional" },
            { id: "AC-02", text: `${story.id} validation covers error cases`, priority: "must", category: "validation" },
        ];
    const { result } = await runStage({
        stageId: `execution/waves/${wave.number}/stories/${story.id}/test-writer`,
        stageAgentLabel: "LLM-6a (Test Writer)",
        reviewerLabel: "Test-Review-LLM",
        workspaceId: ctx.workspaceId,
        workspaceRoot: ctx.workspaceRoot,
        runId: ctx.runId,
        createInitialState: () => ({
            projectId: ctx.project.id,
            wave,
            story: { id: story.id, title: story.title },
            acceptanceCriteria: acs,
            design: projectDesignGuidance(ctx.design),
            architectureSummary: renderArchitectureSummary(ctx.architecture),
            revisionCount: 0,
        }),
        stageAgent: createTestWriterStage(ctx.project, llm),
        reviewer: createTestWriterReview(llm),
        askUser: async () => "",
        async persistArtifacts(_run, artifact) {
            return [
                {
                    kind: "json",
                    label: "Test Plan JSON",
                    fileName: "test-plan.json",
                    content: JSON.stringify(artifact, null, 2),
                },
                {
                    kind: "md",
                    label: "Test Plan Markdown",
                    fileName: "test-plan.md",
                    content: renderTestPlanMarkdown(artifact),
                },
            ];
        },
        async onApproved(artifact) {
            return artifact;
        },
        maxReviews: 4,
    });
    return result;
}
