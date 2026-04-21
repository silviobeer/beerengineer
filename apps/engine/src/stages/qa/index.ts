import { runStage } from "../../core/stageRuntime.js"
import { printStageCompletion, stageSummary, summaryArtifactFile } from "../../core/stageHelpers.js"
import { createQaReview, createQaStage, defaultStageConfig } from "../../llm/registry.js"
import { print } from "../../print.js"
import { ask } from "../../sim/human.js"
import type { ProjectContext } from "../../types.js"
import type { QaState } from "./types.js"

export async function qa(ctx: ProjectContext): Promise<void> {
  print.header(`qa — ${ctx.project.name}`)

  await runStage({
    stageId: "qa",
    stageAgentLabel: "QA-Fixer",
    reviewerLabel: "LLM-8 (QA-Review)",
    workspaceId: ctx.workspaceId,
    runId: ctx.runId,
    createInitialState: (): QaState => ({ loop: 0, findings: [] }),
    stageAgent: createQaStage(defaultStageConfig.stageAgent.provider),
    reviewer: createQaReview(defaultStageConfig.reviewer.provider),
    askUser: prompt => ask(prompt),
    showMessage: print.llm,
    async persistArtifacts(_run, artifact) {
      return [
        {
          kind: "json",
          label: "QA Report JSON",
          fileName: "qa-report.json",
          content: JSON.stringify(artifact, null, 2),
        },
        summaryArtifactFile(
          "qa",
          stageSummary(_run, [
            `Loops: ${artifact.loops}`,
            `Accepted: ${artifact.accepted}`,
            `Open findings: ${artifact.findings.length}`,
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
