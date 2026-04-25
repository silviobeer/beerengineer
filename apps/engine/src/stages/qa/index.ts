import { runStage } from "../../core/stageRuntime.js"
import { printStageCompletion, stageSummary, summaryArtifactFile } from "../../core/stageHelpers.js"
import { stagePresent } from "../../core/stagePresentation.js"
import { createQaReview, createQaStage, type RunLlmConfig } from "../../llm/registry.js"
import { ask } from "../../sim/human.js"
import type { ProjectContext } from "../../types.js"
import type { QaState } from "./types.js"

export async function qa(ctx: ProjectContext, llm?: RunLlmConfig): Promise<void> {
  stagePresent.header(`qa — ${ctx.project.name}`)

  await runStage({
    stageId: "qa",
    stageAgentLabel: "QA-Fixer",
    reviewerLabel: "LLM-8 (QA-Review)",
    workspaceId: ctx.workspaceId,
    runId: ctx.runId,
    createInitialState: (): QaState => ({ loop: 0, findings: [] }),
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
    maxReviews: 2,
  })
}
