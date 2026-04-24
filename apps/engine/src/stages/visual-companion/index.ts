import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
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

const MAX_USER_REVIEW_ROUNDS = 3

function buildScreenSummary(artifact: WireframeArtifact): string {
  const lines = artifact.screens.map(screen => {
    const regionList = screen.layout.regions.map(r => r.label).join(", ")
    return `  • ${screen.name}: [${regionList}]`
  })
  return lines.join("\n")
}

export async function visualCompanion(
  context: WorkflowContext,
  input: DesignPrepInput,
  llm?: RunLlmConfig,
): Promise<WireframeArtifact> {
  stagePresent.header("visual-companion")

  // Shared state that persists across user-review iterations so the stage
  // agent can see revision feedback on subsequent runStage calls.
  let pendingRevisionFeedback: string | undefined
  let userReviewRound = 0
  let lastApprovedArtifact: WireframeArtifact | undefined
  let lastRun: Awaited<ReturnType<typeof runStage>>["run"] | undefined

  while (true) {
    const revisionFeedback = pendingRevisionFeedback
    const reviewRound = userReviewRound

    const { result: artifact, run } = await runStage({
      stageId: "visual-companion",
      stageAgentLabel: "UX Designer",
      reviewerLabel: "UX Review",
      workspaceId: context.workspaceId,
      runId: reviewRound === 0 ? context.runId : `${context.runId}-rev${reviewRound}`,
      createInitialState: (): VisualCompanionState => ({
        input,
        inputMode: "none",
        references: input.references ?? [],
        history: [],
        clarificationCount: 0,
        maxClarifications: 3,
        pendingRevisionFeedback: revisionFeedback,
        userReviewRound: reviewRound,
      }),
      stageAgent: createVisualCompanionStage(llm),
      reviewer: createVisualCompanionReview(llm),
      askUser: ask,
      async persistArtifacts(run, artifact) {
        const sourceFiles = resolveReferences(context, "wireframes", input.references)
        const enrichedArtifact = { ...artifact, sourceFiles }

        // Write wireframes.json synchronously to disk BEFORE attempting HTML
        // render. This guarantees the raw LLM artifact is on disk even if
        // renderWireframeFiles throws due to a malformed structure (e.g. a region
        // with a null label). Without this, a render crash leaves no JSON artifact
        // at all — as reproduced in run 1a5b6eb0-64e6-463c-96b5-228c97602d46.
        mkdirSync(run.stageArtifactsDir, { recursive: true })
        writeFileSync(
          join(run.stageArtifactsDir, "wireframes.json"),
          JSON.stringify(enrichedArtifact, null, 2),
        )

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
        // a malformed structure (e.g. missing layout.regions or a null label).
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
        // Intentionally do NOT emit wireframes_ready or printStageCompletion here —
        // those happen only after the user approves in the post-artifact review gate.
        lastApprovedArtifact = artifact
        lastRun = run
        return artifact
      },
      maxReviews: 3,
    })

    // ── Post-artifact user review gate ────────────────────────────────────────
    const summary = buildScreenSummary(artifact)
    const prompt =
      `Wireframe summary (${artifact.screens.length} screen${artifact.screens.length !== 1 ? "s" : ""}):\n` +
      `${summary}\n\n` +
      `Type "approve" to commit, or "revise: <feedback>" to adjust.`

    const userReply = (await ask(prompt)).trim()

    if (/^approve$/i.test(userReply)) {
      // User approved — emit events and finalise
      const itemId = getActiveRun()?.itemId ?? context.workspaceId
      emitEvent({
        type: "wireframes_ready",
        runId: run.runId,
        itemId,
        screenCount: artifact.screens.length,
        urls: run.files.filter(file => file.path.endsWith(".html")).map(file => file.path),
      })
      printStageCompletion(run, "visual-companion")
      stagePresent.ok("Wireframes approved.")
      return artifact
    }

    if (/^revise:/i.test(userReply)) {
      userReviewRound++
      if (userReviewRound > MAX_USER_REVIEW_ROUNDS) {
        throw new Error(
          `visual-companion: post-artifact review cap reached (${MAX_USER_REVIEW_ROUNDS} rounds). ` +
          "Approve the artifact or restart the stage with updated references.",
        )
      }
      pendingRevisionFeedback = userReply.replace(/^revise:\s*/i, "").trim()
      stagePresent.step(`User revision round ${userReviewRound}: ${pendingRevisionFeedback}`)
      continue
    }

    // Treat any unrecognised reply as approval to preserve backward compat
    stagePresent.warn(`Unrecognised reply "${userReply}" — treating as approve.`)
    const itemId = getActiveRun()?.itemId ?? context.workspaceId
    emitEvent({
      type: "wireframes_ready",
      runId: run.runId,
      itemId,
      screenCount: artifact.screens.length,
      urls: run.files.filter(file => file.path.endsWith(".html")).map(file => file.path),
    })
    printStageCompletion(run, "visual-companion")
    stagePresent.ok("Wireframes approved.")
    return artifact
  }

  // TypeScript unreachable — loop always returns or throws
  // eslint-disable-next-line no-unreachable
  return lastApprovedArtifact!
}
