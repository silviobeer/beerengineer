import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runStage } from "../../core/stageRuntime.js";
import { printStageCompletion, stageSummary, summaryArtifactFile } from "../../core/stageHelpers.js";
import { stagePresent } from "../../core/stagePresentation.js";
import { createDocumentationReview, createDocumentationStage } from "../../llm/registry.js";
import { renderArchitectureSummary, renderPlanSummary, renderPrdDigest, } from "../../render/artifactDigests.js";
import { buildDocFiles } from "../../render/documentation.js";
import { layout } from "../../core/workspaceLayout.js";
/**
 * The documentation stage writes operator-facing docs (`technical-doc.md`,
 * `features-doc.md`, `README.compact.md`) into the **item worktree** so they
 * land on the item branch as commits — not into the main repo's working
 * tree. The handoff stage's merge of item → main is what brings the docs
 * onto main; before that, the docs need to live on the item branch.
 *
 * Earlier this resolved to `<workspaceRoot>/docs/`, which left the files
 * untracked in the operator's main checkout and never made it into git.
 */
function projectDocsDir(ctx) {
    return join(layout.itemWorktreeDir(ctx), "docs");
}
async function readOptional(path) {
    try {
        return await readFile(path, "utf8");
    }
    catch {
        return undefined;
    }
}
async function loadExistingDocs(ctx) {
    const dir = projectDocsDir(ctx);
    return {
        technicalDoc: await readOptional(join(dir, "technical-doc.md")),
        featuresDoc: await readOptional(join(dir, "features-doc.md")),
        compactReadme: await readOptional(join(dir, "README.compact.md")),
    };
}
async function writeProjectDocs(ctx, artifact) {
    const dir = projectDocsDir(ctx);
    await mkdir(dir, { recursive: true });
    for (const file of buildDocFiles(artifact)) {
        await writeFile(join(dir, file.fileName), file.content);
    }
}
export async function documentation(ctx, llm) {
    stagePresent.header(`documentation — ${ctx.project.name}`);
    const existingDocs = await loadExistingDocs(ctx);
    const { result } = await runStage({
        stageId: "documentation",
        stageAgentLabel: "LLM-9 (Documentation)",
        reviewerLabel: "Documentation-Review-LLM",
        workspaceId: ctx.workspaceId,
        workspaceRoot: ctx.workspaceRoot,
        runId: ctx.runId,
        createInitialState: () => ({
            projectId: ctx.project.id,
            prdDigest: renderPrdDigest(ctx.prd, ctx.project.id),
            architectureSummary: renderArchitectureSummary(ctx.architecture),
            planSummary: renderPlanSummary(ctx.plan),
            executionSummaries: ctx.executionSummaries,
            projectReview: ctx.projectReview,
            revisionCount: 0,
            existingDocs,
        }),
        stageAgent: createDocumentationStage(ctx.project, llm),
        reviewer: createDocumentationReview(llm),
        askUser: async () => "",
        async persistArtifacts(run, artifact) {
            await writeProjectDocs(ctx, artifact);
            return [
                {
                    kind: "json",
                    label: "Documentation JSON",
                    fileName: "documentation.json",
                    content: JSON.stringify(artifact, null, 2),
                },
                ...buildDocFiles(artifact).map(file => ({
                    kind: "md",
                    label: file.label,
                    fileName: file.fileName,
                    content: file.content,
                })),
                summaryArtifactFile("documentation", stageSummary(run, [
                    `Mode: ${artifact.mode}`,
                    "Technical doc: docs/technical-doc.md",
                    "Features doc: docs/features-doc.md",
                    "Compact README: docs/README.compact.md",
                    `Known issues: ${artifact.knownIssues.length}`,
                ])),
            ];
        },
        async onApproved(artifact, run) {
            stagePresent.ok(`Documentation ${artifact.mode === "generate" ? "generated" : "updated"} for ${ctx.project.name}.`);
            stagePresent.chat("LLM-9", artifact.compactReadme.summary);
            stagePresent.dim("→ Docs: docs/technical-doc.md");
            stagePresent.dim("→ Docs: docs/features-doc.md");
            stagePresent.dim("→ Docs: docs/README.compact.md");
            printStageCompletion(run, "documentation");
            return artifact;
        },
        maxReviews: 3,
    });
    return result;
}
