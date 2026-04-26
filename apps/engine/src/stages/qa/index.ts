import { runStage } from "../../core/stageRuntime.js"
import { printStageCompletion, stageSummary, summaryArtifactFile } from "../../core/stageHelpers.js"
import { stagePresent } from "../../core/stagePresentation.js"
import { branchNameProject } from "../../core/repoSimulation.js"
import { createQaReview, createQaStage, type RunLlmConfig } from "../../llm/registry.js"
import { renderPrdDigest } from "../../render/artifactDigests.js"
import { ask } from "../../sim/human.js"
import type { ProjectContext } from "../../types.js"
import type { QaState } from "./types.js"

export async function qa(ctx: ProjectContext, llm?: RunLlmConfig): Promise<void> {
  stagePresent.header(`qa — ${ctx.project.name}`)
  // QA runs after planning + execution + project-review; both prd and
  // projectReview are pipeline invariants by the time we get here. Failing
  // loud is better than silently digesting an empty PRD into garbage QA.
  if (!ctx.prd) throw new Error("qa stage invariant: ctx.prd is required")
  if (!ctx.projectReview) throw new Error("qa stage invariant: ctx.projectReview is required")

  await runStage({
    stageId: "qa",
    stageAgentLabel: "QA-Fixer",
    reviewerLabel: "LLM-8 (QA-Review)",
    workspaceId: ctx.workspaceId,
    runId: ctx.runId,
    createInitialState: (): QaState => ({
      projectId: ctx.project.id,
      projectBranch: branchNameProject(ctx, ctx.project.id),
      prdDigest: renderPrdDigest(ctx.prd!, ctx.project.id),
      projectReview: ctx.projectReview!,
      loop: 0,
      findings: [],
    }),
    stageAgent: createQaStage(llm),
    reviewer: createQaReview(llm),
    askUser: prompt => ask(prompt),
    async persistArtifacts(_run, artifact) {
      const findings = artifact.findings ?? []
      return [
        {
          kind: "json",
          label: "QA Report JSON",
          fileName: "qa-report.json",
          content: JSON.stringify({ ...artifact, findings }, null, 2),
        },
        summaryArtifactFile(
          "qa",
          stageSummary(_run, [
            `Loops: ${artifact.loops}`,
            `Accepted: ${artifact.accepted}`,
            `Open findings: ${findings.length}`,
          ]),
        ),
      ]
    },
    async onApproved(_artifact, run) {
      printStageCompletion(run, "QA")
    },
    maxReviews: 3,
  })
}
