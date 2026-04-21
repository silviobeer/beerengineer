import { runStage } from "../../core/stageRuntime.js"
import { printStageCompletion, stageSummary, summaryArtifactFile } from "../../core/stageHelpers.js"
import { createArchitectureReview, createArchitectureStage, defaultStageConfig } from "../../llm/registry.js"
import { print } from "../../print.js"
import { renderArchitectureMarkdown } from "../../render/architecture.js"
import type { ArchitectureArtifact, WithPrd } from "../../types.js"
import type { ArchitectureState } from "./types.js"

export async function architecture(ctx: WithPrd): Promise<ArchitectureArtifact> {
  print.header(`architecture — ${ctx.project.name}`)

  const { result } = await runStage({
    stageId: "architecture",
    stageAgentLabel: "LLM-4 (Architecture)",
    reviewerLabel: "Architecture-Review-LLM",
    workspaceId: ctx.workspaceId,
    runId: ctx.runId,
    createInitialState: (): ArchitectureState => ({
      projectId: ctx.project.id,
      prd: ctx.prd,
      revisionCount: 0,
    }),
    stageAgent: createArchitectureStage(defaultStageConfig.stageAgent.provider, ctx.project),
    reviewer: createArchitectureReview(defaultStageConfig.reviewer.provider),
    askUser: async () => "",
    showMessage: print.llm,
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
      print.ok("Architecture-Review: Plan ist bereit fuer den naechsten Schritt.")
      print.llm("LLM-4", artifact.architecture.summary)
      printStageCompletion(run, "architecture")
      return artifact
    },
    maxReviews: 2,
  })

  return result
}
