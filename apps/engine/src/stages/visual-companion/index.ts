import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { emitEvent, getActiveRun } from "../../core/runContext.js"
import { resolveReferences } from "../../core/referencesStore.js"
import { printStageCompletion, stageSummary, summaryArtifactFile } from "../../core/stageHelpers.js"
import { type StageArtifactContent } from "../../core/stageRuntime.js"
import { stagePresent } from "../../core/stagePresentation.js"
import { runStageWithUserReview } from "../../core/stageWithUserReview.js"
import { createVisualCompanionReview, createVisualCompanionStage, type RunLlmConfig } from "../../llm/registry.js"
import { renderWireframeFiles } from "../../render/wireframes.js"
import { ask } from "../../sim/human.js"
import type { WorkflowContext, WireframeArtifact } from "../../types.js"
import type { CodebaseSnapshot } from "../../types/context.js"
import type { DesignPrepInput, VisualCompanionState } from "./types.js"
import type { StageAgentAdapter, StageAgentInput, StageAgentResponse } from "../../core/adapters.js"

const MODE_QUESTION =
  "Do you already have wireframes or mockups you'd like to reference? Reply with exactly `none` or `references`."
const REFERENCE_DETAILS_QUESTION =
  "Share the references, mockups, or links we should consider before drafting wireframes."
const PRIORITY_QUESTION =
  "Which screens or flows are highest priority for the first pass?"
const CONSTRAINTS_QUESTION =
  "Any accessibility, responsive, or interaction constraints we should honor before drafting wireframes?"

export function parseClarificationModeReply(reply: string): "none" | "references" | null {
  const trimmed = reply.trim().toLowerCase()
  if (trimmed === "none" || trimmed === "references") return trimmed
  return null
}

export function nextClarificationQuestion(state: VisualCompanionState): string | null {
  if (state.clarificationCount === 0) return MODE_QUESTION
  if (state.inputMode === "references") {
    if (state.clarificationCount === 1) return REFERENCE_DETAILS_QUESTION
    if (state.clarificationCount === 2) return PRIORITY_QUESTION
    if (state.clarificationCount === 3) return CONSTRAINTS_QUESTION
    return null
  }
  if (state.clarificationCount === 1) return PRIORITY_QUESTION
  if (state.clarificationCount === 2) return CONSTRAINTS_QUESTION
  return null
}

function withClarificationGate(
  delegate: StageAgentAdapter<VisualCompanionState, WireframeArtifact>,
): StageAgentAdapter<VisualCompanionState, WireframeArtifact> {
  return {
    async step(input: StageAgentInput<VisualCompanionState>): Promise<StageAgentResponse<WireframeArtifact>> {
      const state = input.state
      if (input.kind === "review-feedback") {
        return delegate.step(input)
      }

      if (state.clarificationCount < state.maxClarifications) {
        if (input.kind === "begin") {
          const prefix = state.pendingRevisionFeedback
            ? `Noted: "${state.pendingRevisionFeedback}". `
            : ""
          return { kind: "message", message: `${prefix}${nextClarificationQuestion(state) ?? MODE_QUESTION}` }
        }

        const reply = input.userMessage.trim()
        if (state.clarificationCount === 0) {
          const mode = parseClarificationModeReply(reply)
          if (!mode) {
            return {
              kind: "message",
              message:
                "Reply with exactly `none` or `references`. If you choose `references`, the next answer can contain the actual links or mockups.",
            }
          }
          state.inputMode = mode
          state.maxClarifications = mode === "references" ? 4 : 3
        }
        state.history.push({ role: "user", text: reply })
        state.clarificationCount++
        const nextQuestion = nextClarificationQuestion(state)
        if (nextQuestion) {
          return { kind: "message", message: nextQuestion }
        }
      }

      return delegate.step(input)
    },
    getSessionId() {
      return delegate.getSessionId?.() ?? null
    },
    setSessionId(sessionId) {
      delegate.setSessionId?.(sessionId)
    },
  }
}

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
  codebase?: CodebaseSnapshot,
): Promise<WireframeArtifact> {
  stagePresent.header("visual-companion")

  return runStageWithUserReview<VisualCompanionState, WireframeArtifact, WireframeArtifact>({
    stageId: "visual-companion",
    stageAgentLabel: "UX Designer",
    reviewerLabel: "UX Review",
    workspaceId: context.workspaceId,
    workspaceRoot: context.workspaceRoot!,
    baseRunId: context.runId,
    stageAgent: withClarificationGate(createVisualCompanionStage(llm)),
    reviewer: createVisualCompanionReview(llm),
    askUser: ask,
    maxReviews: 2,
    buildFreshState: ({ revisionFeedback, reviewRound }): VisualCompanionState => ({
      input,
      inputMode: "none",
      references: input.references ?? [],
      history: [],
      clarificationCount: 0,
      maxClarifications: 3,
      pendingRevisionFeedback: revisionFeedback,
      userReviewRound: reviewRound,
      codebase,
    }),
    async persistArtifacts(run, artifact): Promise<StageArtifactContent[]> {
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
    buildGatePrompt: ({ artifact }) => {
      const summary = buildScreenSummary(artifact)
      const screenLabel = artifact.screens.length === 1 ? "screen" : "screens"
      return (
        `Wireframe summary (${artifact.screens.length} ${screenLabel}):\n` +
        `${summary}\n\n` +
        `Type "approve" to commit, or "revise: <feedback>" to adjust.`
      )
    },
    async onUserApprove({ artifact, run }) {
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
    },
  })
}
