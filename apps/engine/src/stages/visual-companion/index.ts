import { emitEvent, getActiveRun } from "../../core/runContext.js"
import { resolveReferences } from "../../core/referencesStore.js"
import { printStageCompletion, stageSummary, summaryArtifactFile } from "../../core/stageHelpers.js"
import { runStage, type StageArtifactContent } from "../../core/stageRuntime.js"
import { stagePresent } from "../../core/stagePresentation.js"
import { createVisualCompanionReview, createVisualCompanionStage, type RunLlmConfig } from "../../llm/registry.js"
import { renderWireframeFiles } from "../../render/wireframes.js"
import { ask } from "../../sim/human.js"
import type { WorkflowContext, WireframeArtifact } from "../../types.js"
import type { DesignPrepInput, VisualCompanionState } from "./types.js"

export async function visualCompanion(
  context: WorkflowContext,
  input: DesignPrepInput,
  llm?: RunLlmConfig,
): Promise<WireframeArtifact> {
  stagePresent.header("visual-companion")
  const { result } = await runStage({
    stageId: "visual-companion",
    stageAgentLabel: "UX Designer",
    reviewerLabel: "UX Review",
    workspaceId: context.workspaceId,
    runId: context.runId,
    createInitialState: (): VisualCompanionState => ({
      input,
      inputMode: "none",
      references: input.references ?? [],
      history: [],
      clarificationCount: 0,
      maxClarifications: 1,
    }),
    stageAgent: createVisualCompanionStage(llm),
    reviewer: createVisualCompanionReview(llm),
    askUser: ask,
    async persistArtifacts(run, artifact) {
      const sourceFiles = resolveReferences(context, "wireframes", input.references)
      const enrichedArtifact = { ...artifact, sourceFiles }
      // Write JSON artifacts first so raw data is preserved on disk even if
      // HTML rendering fails due to a malformed LLM response.
      const jsonFiles: StageArtifactContent[] = [
        {
          kind: "json",
          label: "Wireframes JSON",
          fileName: "wireframes.json",
          content: JSON.stringify(enrichedArtifact, null, 2),
        },
        {
          kind: "json",
          label: "Design Prep Freeze",
          fileName: "project-freeze.json",
          content: JSON.stringify({ projectIds: input.projects.map(project => project.id) }, null, 2),
        },
      ]
      // validateWireframeArtifact is called inside renderWireframeFiles — this
      // will throw a descriptive Error (not a TypeError) if the LLM returned
      // a malformed structure (e.g. missing layout.regions).
      const htmlFiles = renderWireframeFiles(enrichedArtifact)
      return [
        ...jsonFiles,
        ...htmlFiles.map(file => ({
          kind: "txt" as const,
          label: file.label,
          fileName: file.fileName,
          content: file.content,
        })),
        summaryArtifactFile(
          "visual-companion",
          stageSummary(run, [`Screens: ${artifact.screens.length}`, `Mode: ${artifact.inputMode}`]),
        ),
      ]
    },
    async onApproved(artifact, run) {
      const itemId = getActiveRun()?.itemId ?? context.workspaceId
      emitEvent({
        type: "wireframes_ready",
        runId: run.runId,
        itemId,
        screenCount: artifact.screens.length,
        urls: run.files.filter(file => file.path.endsWith(".html")).map(file => file.path),
      })
      printStageCompletion(run, "visual-companion")
      return artifact
    },
    maxReviews: 3,
  })
  stagePresent.ok("Wireframes approved.")
  return result
}
