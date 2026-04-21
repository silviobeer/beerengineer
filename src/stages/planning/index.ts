import { runStage } from "../../core/stageRuntime.js"
import { printStageCompletion, stageSummary, summaryArtifactFile } from "../../core/stageHelpers.js"
import { createPlanningReview, createPlanningStage, defaultStageConfig } from "../../llm/registry.js"
import { print } from "../../print.js"
import { renderPlanMarkdown } from "../../render/plan.js"
import type { ImplementationPlanArtifact, WithArchitecture } from "../../types.js"
import type { PlanningState } from "./types.js"

export async function planning(ctx: WithArchitecture): Promise<ImplementationPlanArtifact> {
  print.header(`planning — ${ctx.project.name}`)

  const { result } = await runStage({
    stageId: "planning",
    stageAgentLabel: "LLM-5 (Planning)",
    reviewerLabel: "Planning-Review-LLM",
    workspaceId: ctx.workspaceId,
    runId: ctx.runId,
    createInitialState: (): PlanningState => ({
      projectId: ctx.project.id,
      prd: ctx.prd,
      architectureArtifact: ctx.architecture,
      revisionCount: 0,
    }),
    stageAgent: createPlanningStage(defaultStageConfig.stageAgent.provider, ctx.project),
    reviewer: createPlanningReview(defaultStageConfig.reviewer.provider),
    askUser: async () => "",
    showMessage: print.llm,
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
        summaryArtifactFile(
          "planning",
          stageSummary(run, [`Waves: ${artifact.plan.waves.length}`]),
        ),
      ]
    },
    async onApproved(artifact, run) {
      print.ok("Planning-Review: Implementierungsplan ist bereit.")
      artifact.plan.waves.forEach(wave => {
        const tag = wave.parallel ? "(parallel)" : "(sequenziell)"
        print.llm(`Wave ${wave.number} ${tag}`, wave.stories.map(story => story.title).join(", "))
      })
      printStageCompletion(run, "planning")
      return artifact
    },
    maxReviews: 2,
  })

  return result
}
