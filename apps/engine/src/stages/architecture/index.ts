import { runStage } from "../../core/stageRuntime.js"
import { printStageCompletion, stageSummary, summaryArtifactFile } from "../../core/stageHelpers.js"
import { stagePresent } from "../../core/stagePresentation.js"
import { createArchitectureReview, createArchitectureStage, type RunLlmConfig } from "../../llm/registry.js"
import { renderArchitectureMarkdown } from "../../render/architecture.js"
import type { ArchitectureArtifact, WithPrd } from "../../types.js"
import type { ArchitectureState } from "./types.js"

export async function architecture(ctx: WithPrd, llm?: RunLlmConfig): Promise<ArchitectureArtifact> {
  stagePresent.header(`architecture — ${ctx.project.name}`)

  const { result } = await runStage({
    stageId: "architecture",
    stageAgentLabel: "LLM-4 (Architecture)",
    reviewerLabel: "Architecture-Review-LLM",
    workspaceId: ctx.workspaceId,
    runId: ctx.runId,
    createInitialState: (): ArchitectureState => ({
      projectId: ctx.project.id,
      prd: ctx.prd,
      wireframes: ctx.wireframes,
      design: ctx.design,
      codebase: ctx.codebase,
      revisionCount: 0,
    }),
    stageAgent: createArchitectureStage(ctx.project, llm),
    reviewer: createArchitectureReview(llm),
    askUser: async () => "",
    async persistArtifacts(run, artifact) {
      return [
        {
          kind: "json",
          label: "Architecture JSON",
          fileName: "architecture.json",
          content: JSON.stringify(artifact, null, 2),
        },
        {
          kind: "md",
          label: "Architecture Markdown",
          fileName: "architecture.md",
          content: renderArchitectureMarkdown(artifact),
        },
        summaryArtifactFile(
          "architecture",
          stageSummary(run, [`Components: ${artifact.architecture.components.length}`]),
        ),
      ]
    },
    async onApproved(artifact, run) {
      stagePresent.ok("Architecture review: plan is ready for the next step.")
      stagePresent.chat("LLM-4", artifact.architecture.summary)
      printStageCompletion(run, "architecture")
      return artifact
    },
    maxReviews: 4,
  })

  return result
}
