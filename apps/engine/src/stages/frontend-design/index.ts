import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { emitEvent, getActiveRun } from "../../core/runContext.js"
import { resolveReferences } from "../../core/referencesStore.js"
import { printStageCompletion, stageSummary, summaryArtifactFile } from "../../core/stageHelpers.js"
import { runStage } from "../../core/stageRuntime.js"
import { stagePresent } from "../../core/stagePresentation.js"
import { createFrontendDesignReview, createFrontendDesignStage, type RunLlmConfig } from "../../llm/registry.js"
import { renderDesignPreview } from "../../render/designPreview.js"
import { ask } from "../../sim/human.js"
import type { DesignArtifact, WorkflowContext } from "../../types.js"
import type { FrontendDesignInput, FrontendDesignState } from "./types.js"

export async function frontendDesign(
  context: WorkflowContext,
  input: FrontendDesignInput,
  llm?: RunLlmConfig,
): Promise<DesignArtifact> {
  stagePresent.header("frontend-design")
  const { result } = await runStage({
    stageId: "frontend-design",
    stageAgentLabel: "Visual Designer",
    reviewerLabel: "Design Review",
    workspaceId: context.workspaceId,
    runId: context.runId,
    createInitialState: (): FrontendDesignState => ({
      input,
      inputMode: "none",
      references: input.references ?? [],
      history: [],
      clarificationCount: 0,
      maxClarifications: 1,
    }),
    stageAgent: createFrontendDesignStage(llm),
    reviewer: createFrontendDesignReview(llm),
    askUser: ask,
    async persistArtifacts(run, artifact) {
      const sourceFiles = resolveReferences(context, "design", input.references)
      const enrichedArtifact = { ...artifact, sourceFiles }

      // Write design.json synchronously to disk BEFORE attempting HTML render.
      // This guarantees the raw LLM artifact is on disk even if renderDesignPreview
      // throws due to a malformed structure (e.g. missing typography.scale).
      // Without this, a render crash leaves no JSON artifact at all —
      // as reproduced in run d17a5503-9809-477f-90e5-baa412dad854.
      mkdirSync(run.stageArtifactsDir, { recursive: true })
      writeFileSync(
        join(run.stageArtifactsDir, "design.json"),
        JSON.stringify(enrichedArtifact, null, 2),
      )

      return [
        {
          kind: "json",
          label: "Design JSON",
          fileName: "design.json",
          content: JSON.stringify(enrichedArtifact, null, 2),
        },
        {
          kind: "txt",
          label: "Design Preview",
          fileName: "design-preview.html",
          // validateDesignArtifact is called inside renderDesignPreview — this
          // will throw a descriptive Error (not a TypeError) if the LLM returned
          // a malformed structure (e.g. missing typography.scale or null field).
          content: renderDesignPreview(enrichedArtifact),
        },
        summaryArtifactFile(
          "frontend-design",
          stageSummary(run, [`Tone: ${artifact.tone}`, `Mode: ${artifact.inputMode}`]),
        ),
      ]
    },
    async onApproved(artifact, run) {
      const itemId = getActiveRun()?.itemId ?? context.workspaceId
      const previewPath = run.files.find(file => file.path.endsWith("design-preview.html"))?.path
      if (!previewPath) {
        stagePresent.warn("design-preview.html missing from persisted artifacts; design_ready event will carry an empty url.")
      }
      emitEvent({
        type: "design_ready",
        runId: run.runId,
        itemId,
        url: previewPath ?? "",
      })
      printStageCompletion(run, "frontend-design")
      return artifact
    },
    maxReviews: 3,
  })
  stagePresent.ok("Design language approved.")
  return result
}
