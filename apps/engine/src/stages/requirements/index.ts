import { runStage } from "../../core/stageRuntime.js"
import { printStageCompletion, stageSummary, summaryArtifactFile } from "../../core/stageHelpers.js"
import { createRequirementsReview, createRequirementsStage, defaultStageConfig } from "../../llm/registry.js"
import { print } from "../../print.js"
import { renderPrdMarkdown } from "../../render/prd.js"
import { ask } from "../../sim/human.js"
import type { PRD, ProjectContext } from "../../types.js"
import type { RequirementsState } from "./types.js"

export async function requirements(ctx: ProjectContext): Promise<PRD> {
  print.header(`requirements — ${ctx.project.name}`)
  print.dim(`Konzept: ${ctx.project.concept.summary}`)

  const { result } = await runStage({
    stageId: "requirements",
    stageAgentLabel: "LLM-3 (Requirements)",
    reviewerLabel: "Review-LLM",
    workspaceId: ctx.workspaceId,
    runId: ctx.runId,
    createInitialState: (): RequirementsState => ({
      concept: ctx.project.concept,
      clarificationCount: 0,
      maxClarifications: 2,
      history: [],
    }),
    stageAgent: createRequirementsStage(defaultStageConfig.stageAgent.provider),
    reviewer: createRequirementsReview(defaultStageConfig.reviewer.provider),
    askUser: ask,
    showMessage: print.llm,
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
        summaryArtifactFile(
          "requirements",
          stageSummary(run, [
            `Clarification turns: ${run.iteration}`,
            `Stories produced: ${artifact.prd.stories.length}`,
          ]),
        ),
      ]
    },
    async onApproved(artifact, run) {
      print.ok("LLM-Review: PRD ist bereit fuer den naechsten Schritt.")
      artifact.prd.stories.forEach(story => {
        print.llm(`Story ${story.id}`, story.title)
        story.acceptanceCriteria.forEach(ac => print.dim(`  AC ${ac.id}: ${ac.text}`))
      })
      printStageCompletion(run, "requirements")
      return artifact.prd
    },
    maxReviews: 2,
  })

  return result
}
