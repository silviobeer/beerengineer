import { runStage } from "../../core/stageRuntime.js";
import { printStageCompletion, stageSummary, summaryArtifactFile } from "../../core/stageHelpers.js";
import { stagePresent } from "../../core/stagePresentation.js";
import { renderConceptMarkdown } from "../../render/concept.js";
import { ask } from "../../sim/human.js";
import { createBrainstormReview, createBrainstormStage } from "../../llm/registry.js";
import { normalizeBrainstormArtifact } from "./types.js";
export async function brainstorm(item, context, git, llm, codebase) {
    stagePresent.header("brainstorm");
    // Brainstorm is the first stage of a fresh run — it owns the creation of
    // the item branch + worktree that every subsequent stage operates against.
    // Both calls are idempotent: re-running brainstorm against an existing
    // worktree just reattaches HEAD to the item branch.
    git.ensureItemBranch();
    git.assertWorkspaceRootOnBaseBranch("brainstorm: after ensureItemBranch");
    stagePresent.step("Interactive session via LLM adapter + stage runtime\n");
    const { result } = await runStage({
        stageId: "brainstorm",
        stageAgentLabel: "LLM-1 (Brainstorm)",
        reviewerLabel: "Review-LLM",
        workspaceId: context.workspaceId,
        workspaceRoot: context.workspaceRoot,
        runId: context.runId,
        createInitialState: () => ({
            item,
            questionsAsked: 0,
            targetQuestions: 3,
            history: [],
            codebase,
        }),
        stageAgent: createBrainstormStage(undefined, llm),
        reviewer: createBrainstormReview(llm),
        askUser: ask,
        async persistArtifacts(run, artifact) {
            // Coerce string-typed array fields that real LLMs may serialise as a
            // single string (e.g. run fb199f59 crash: constraints was a string).
            artifact = normalizeBrainstormArtifact(artifact);
            const hasUi = artifact.projects.some(project => project.hasUi === true);
            return [
                {
                    kind: "json",
                    label: "Concept JSON",
                    fileName: "concept.json",
                    content: JSON.stringify({ ...artifact.concept, hasUi }, null, 2),
                },
                {
                    kind: "json",
                    label: "Projects JSON",
                    fileName: "projects.json",
                    content: JSON.stringify(artifact.projects.map(project => ({ ...project, hasUi: project.hasUi === true })), null, 2),
                },
                {
                    kind: "md",
                    label: "Concept Markdown",
                    fileName: "concept.md",
                    content: renderConceptMarkdown({ ...artifact.concept, hasUi }),
                },
                summaryArtifactFile("brainstorm", stageSummary(run, [
                    `Questions asked: ${run.userTurnCount}`,
                    `Projects produced: ${artifact.projects.length}`,
                ])),
            ];
        },
        async onApproved(artifact, run) {
            stagePresent.ok("LLM review: concept is ready for the next step.");
            stagePresent.step("\nLLM-1 promoted concept to projects...");
            artifact.projects.forEach(p => stagePresent.dim(`→ ${p.id}: ${p.name}${p.hasUi ? " [ui]" : ""}`));
            printStageCompletion(run, "brainstorm");
            return artifact.projects.map(project => ({ ...project, hasUi: project.hasUi === true }));
        },
        maxReviews: 2,
    });
    return result;
}
