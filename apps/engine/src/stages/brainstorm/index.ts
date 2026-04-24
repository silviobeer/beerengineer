import type { Item, Project, WorkflowContext } from "../../types.js"
import { runStage } from "../../core/stageRuntime.js"
import { printStageCompletion, stageSummary, summaryArtifactFile } from "../../core/stageHelpers.js"
import { stagePresent } from "../../core/stagePresentation.js"
import { renderConceptMarkdown } from "../../render/concept.js"
import { ask } from "../../sim/human.js"
import { createBrainstormReview, createBrainstormStage, type RunLlmConfig } from "../../llm/registry.js"
import type { BrainstormState } from "./types.js"

export async function brainstorm(item: Item, context: WorkflowContext, llm?: RunLlmConfig): Promise<Project[]> {
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
    stageAgent: createBrainstormStage(undefined, llm),
    reviewer: createBrainstormReview(llm),
    askUser: ask,
    async persistArtifacts(run, artifact) {
      const hasUi = artifact.projects.some(project => project.hasUi === true)
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
        summaryArtifactFile(
          "brainstorm",
          stageSummary(run, [
            `Questions asked: ${run.userTurnCount}`,
            `Projects produced: ${artifact.projects.length}`,
          ]),
        ),
      ]
    },
    async onApproved(artifact, run) {
      stagePresent.ok("LLM review: concept is ready for the next step.")
      stagePresent.step("\nLLM-1 promoted concept to projects...")
      artifact.projects.forEach(p => stagePresent.dim(`→ ${p.id}: ${p.name}${p.hasUi ? " [ui]" : ""}`))
      printStageCompletion(run, "brainstorm")
      return artifact.projects.map(project => ({ ...project, hasUi: project.hasUi === true }))
    },
    maxReviews: 4,
  })

  return result
}
