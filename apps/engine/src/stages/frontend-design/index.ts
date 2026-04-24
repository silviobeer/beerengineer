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

const MAX_USER_REVIEW_ROUNDS = 3

function buildDesignSummary(artifact: DesignArtifact): string {
  const palette = artifact.tokens.light
  const paletteStr = [
    `primary=${palette.primary}`,
    `accent=${palette.accent}`,
    `background=${palette.background}`,
  ].join(", ")
  const typographyStr = [
    `display=${artifact.typography.display.family}`,
    artifact.typography.body ? `body=${artifact.typography.body.family}` : null,
  ].filter(Boolean).join(", ")
  const vibeStr = artifact.antiPatterns?.length
    ? `avoids: ${artifact.antiPatterns.slice(0, 2).join(", ")}`
    : "(no explicit anti-patterns)"
  return [
    `  Palette: ${paletteStr}`,
    `  Typography: ${typographyStr}`,
    `  Tone: ${artifact.tone}`,
    `  Vibe: ${vibeStr}`,
  ].join("\n")
}

export async function frontendDesign(
  context: WorkflowContext,
  input: FrontendDesignInput,
  llm?: RunLlmConfig,
): Promise<DesignArtifact> {
  stagePresent.header("frontend-design")

  // Shared state that persists across user-review iterations so the stage
  // agent can see revision feedback on subsequent runStage calls.
  let pendingRevisionFeedback: string | undefined
  let userReviewRound = 0

  while (true) {
    const revisionFeedback = pendingRevisionFeedback
    const reviewRound = userReviewRound

    const { result: artifact, run } = await runStage({
      stageId: "frontend-design",
      stageAgentLabel: "Visual Designer",
      reviewerLabel: "Design Review",
      workspaceId: context.workspaceId,
      runId: reviewRound === 0 ? context.runId : `${context.runId}-rev${reviewRound}`,
      createInitialState: (): FrontendDesignState => ({
        input,
        inputMode: "none",
        references: input.references ?? [],
        history: [],
        clarificationCount: 0,
        maxClarifications: 3,
        pendingRevisionFeedback: revisionFeedback,
        userReviewRound: reviewRound,
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
        // Intentionally do NOT emit design_ready or printStageCompletion here —
        // those happen only after the user approves in the post-artifact review gate.
        return artifact
      },
      maxReviews: 3,
    })

    // ── Post-artifact user review gate ────────────────────────────────────────
    const summary = buildDesignSummary(artifact)
    const prompt =
      `Design summary:\n${summary}\n\n` +
      `Type "approve" to commit, or "revise: <feedback>" to adjust.`

    const userReply = (await ask(prompt)).trim()

    if (/^approve$/i.test(userReply)) {
      // User approved — emit events and finalise
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
      stagePresent.ok("Design language approved.")
      return artifact
    }

    if (/^revise:/i.test(userReply)) {
      userReviewRound++
      if (userReviewRound > MAX_USER_REVIEW_ROUNDS) {
        throw new Error(
          `frontend-design: post-artifact review cap reached (${MAX_USER_REVIEW_ROUNDS} rounds). ` +
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
    const previewPath = run.files.find(file => file.path.endsWith("design-preview.html"))?.path
    emitEvent({
      type: "design_ready",
      runId: run.runId,
      itemId,
      url: previewPath ?? "",
    })
    printStageCompletion(run, "frontend-design")
    stagePresent.ok("Design language approved.")
    return artifact
  }
}
