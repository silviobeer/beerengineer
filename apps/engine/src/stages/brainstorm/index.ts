import type { Item, Project, WorkflowContext } from "../../types.js"
import { runStage } from "../../core/stageRuntime.js"
import { printStageCompletion, stageSummary, summaryArtifactFile } from "../../core/stageHelpers.js"
import { stagePresent } from "../../core/stagePresentation.js"
import { renderConceptMarkdown } from "../../render/concept.js"
import { ask } from "../../sim/human.js"
import { createBrainstormReview, createBrainstormStage, defaultStageConfig } from "../../llm/registry.js"
import type { BrainstormState } from "./types.js"

export async function brainstorm(item: Item, context: WorkflowContext): Promise<Project[]> {
  stagePresent.header("brainstorm")
  stagePresent.step("Interactive session via LLM adapter + stage runtime\n")

  const { result } = await runStage({
    stageId: "brainstorm",
    stageAgentLabel: "LLM-1 (Brainstorm)",
    reviewerLabel: "Review-LLM",
    workspaceId: context.workspaceId,
    runId: context.runId,
    createInitialState: (): BrainstormState => ({
      item,
      questionsAsked: 0,
      targetQuestions: 3,
      history: [],
    }),
    stageAgent: createBrainstormStage(defaultStageConfig.stageAgent.provider),
    reviewer: createBrainstormReview(defaultStageConfig.reviewer.provider),
    askUser: ask,
    async persistArtifacts(run, artifact) {
      return [
        {
          kind: "json",
          label: "Concept JSON",
          fileName: "concept.json",
          content: JSON.stringify(artifact.concept, null, 2),
        },
        {
          kind: "json",
          label: "Projects JSON",
          fileName: "projects.json",
          content: JSON.stringify(artifact.projects, null, 2),
        },
        {
          kind: "md",
          label: "Concept Markdown",
          fileName: "concept.md",
          content: renderConceptMarkdown(artifact.concept),
        },
        summaryArtifactFile(
          "brainstorm",
          stageSummary(run, [
            `Questions asked: ${run.iteration}`,
            `Projects produced: ${artifact.projects.length}`,
          ]),
        ),
      ]
    },
    async onApproved(artifact, run) {
      stagePresent.ok("LLM review: concept is ready for the next step.")
      stagePresent.step("\nLLM-1 promoted concept to projects...")
      artifact.projects.forEach(p => stagePresent.dim(`→ ${p.id}: ${p.name}`))
      printStageCompletion(run, "brainstorm")
      return artifact.projects
    },
    maxReviews: 2,
  })

  return result
}
