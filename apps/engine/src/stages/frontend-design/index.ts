import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { emitEvent, getActiveRun } from "../../core/runContext.js"
import { resolveReferences } from "../../core/referencesStore.js"
import { printStageCompletion, stageSummary, summaryArtifactFile } from "../../core/stageHelpers.js"
import { runStage } from "../../core/stageRuntime.js"
import { stagePresent } from "../../core/stagePresentation.js"
import { layout } from "../../core/workspaceLayout.js"
import { createFrontendDesignReview, createFrontendDesignStage, type RunLlmConfig } from "../../llm/registry.js"
import { renderDesignPreview } from "../../render/designPreview.js"
import { renderMockupIndex, renderStyledMockup } from "../../render/styledMockup.js"
import { ask } from "../../sim/human.js"
import type { DesignArtifact, WireframeArtifact, WorkflowContext } from "../../types.js"
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

/**
 * Try to load the wireframes artifact that visual-companion wrote for this
 * run. Prefers the in-memory value from `input.wireframes` (already passed
 * from workflow.ts when both stages run in sequence); falls back to reading
 * wireframes.json from the visual-companion artifacts directory on disk when
 * resuming or running frontend-design standalone.
 *
 * Returns undefined (not null, never throws) when no wireframes exist — the
 * stage gracefully skips mockup generation in that case.
 */
function loadWireframesForRun(
  context: WorkflowContext,
  input: FrontendDesignInput,
): WireframeArtifact | undefined {
  // 1. In-memory value (fast path — set by workflow.ts when stages run together)
  if (input.wireframes) return input.wireframes

  // 2. Disk lookup — latest visual-companion artifacts for this workspace+run
  const vcArtifactsDir = layout.stageArtifactsDir(context, "visual-companion")
  const vcPath = join(vcArtifactsDir, "wireframes.json")
  if (!existsSync(vcPath)) return undefined

  try {
    return JSON.parse(readFileSync(vcPath, "utf8")) as WireframeArtifact
  } catch {
    stagePresent.warn(`frontend-design: could not parse wireframes.json at ${vcPath} — skipping mockup generation.`)
    return undefined
  }
}

/**
 * Resolve the public base URL used to construct browser-openable mockup links
 * in the review-gate summary. Falls back to a file:// path when no public URL
 * is configured (local development without a publicBaseUrl setting).
 */
function resolvePublicBase(context: WorkflowContext): string {
  // When running in the API/hosted context the active run carries the publicBaseUrl.
  // When running in the CLI (no active run) we fall back to a local placeholder.
  const activeRun = getActiveRun()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const configured = (activeRun as any)?.publicBaseUrl as string | undefined
  return configured?.replace(/\/$/, "") ?? `file://${layout.stageArtifactsDir(context, "frontend-design")}`
}

export async function frontendDesign(
  context: WorkflowContext,
  input: FrontendDesignInput,
  llm?: RunLlmConfig,
): Promise<DesignArtifact> {
  stagePresent.header("frontend-design")

  // Resolve wireframes once — shared across all revise rounds (the wireframe
  // structure is stable; only the design tokens change on revision).
  const wireframes = loadWireframesForRun(context, input)
  const hasWireframes = wireframes !== undefined && wireframes.screens.length > 0

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

        const coreArtifacts = [
          {
            kind: "json" as const,
            label: "Design JSON",
            fileName: "design.json",
            content: JSON.stringify(enrichedArtifact, null, 2),
          },
          {
            kind: "txt" as const,
            label: "Design Preview",
            fileName: "design-preview.html",
            // validateDesignArtifact is called inside renderDesignPreview — this
            // will throw a descriptive Error (not a TypeError) if the LLM returned
            // a malformed structure (e.g. missing typography.scale or null field).
            content: renderDesignPreview(enrichedArtifact),
          },
        ]

        // ── Styled mockups (per wireframe screen) ─────────────────────────────
        // Runs only when a visual-companion artifact exists for this item.
        // On revise rounds we regenerate every mockup file so they stay in sync
        // with the updated tokens.
        const mockupArtifacts: ReturnType<typeof summaryArtifactFile>[] = []
        const mockupScreenIds: string[] = []

        if (hasWireframes && wireframes) {
          const publicBase = resolvePublicBase(context)
          const mockupDir = join(run.stageArtifactsDir, "mockups")
          mkdirSync(mockupDir, { recursive: true })

          for (const screen of wireframes.screens) {
            try {
              const html = renderStyledMockup(screen, enrichedArtifact)
              const fileName = `mockups/${screen.id}.html`
              mockupArtifacts.push({
                kind: "txt" as const,
                label: `Mockup — ${screen.name}`,
                fileName,
                content: html,
              })
              mockupScreenIds.push(screen.id)
            } catch (err) {
              stagePresent.warn(
                `frontend-design: could not render styled mockup for screen "${screen.id}": ${(err as Error).message}`,
              )
            }
          }

          if (mockupScreenIds.length > 0) {
            const indexHtml = renderMockupIndex(wireframes.screens, run.runId, publicBase)
            mockupArtifacts.push({
              kind: "txt" as const,
              label: "Mockups Index",
              fileName: "mockups/index.html",
              content: indexHtml,
            })
          }
        }

        const mockupCount = mockupScreenIds.length
        return [
          ...coreArtifacts,
          ...mockupArtifacts,
          summaryArtifactFile(
            "frontend-design",
            stageSummary(run, [
              `Tone: ${artifact.tone}`,
              `Mode: ${artifact.inputMode}`,
              ...(mockupCount > 0 ? [`Mockups: ${mockupCount}`] : []),
            ]),
          ),
        ]
      },
      async onApproved(artifact, _run) {
        // Intentionally do NOT emit design_ready or printStageCompletion here —
        // those happen only after the user approves in the post-artifact review gate.
        return artifact
      },
      maxReviews: 3,
    })

    // ── Post-artifact user review gate ────────────────────────────────────────
    const summary = buildDesignSummary(artifact)

    // Build mockup URLs for the gate prompt so the user can open them in a browser
    const mockupFiles = run.files.filter(f => f.path.includes("/mockups/") && f.path.endsWith(".html") && !f.path.endsWith("index.html"))
    let mockupSection = ""
    if (mockupFiles.length > 0) {
      const publicBase = resolvePublicBase(context)
      const urlLines = mockupFiles.map(f => {
        // Build a URL the user can open — prefer publicBase URL, fall back to file path
        const screenId = f.path.split("/mockups/")[1]?.replace(/\.html$/, "") ?? ""
        const url = `${publicBase}/runs/${run.runId}/artifacts/stages/frontend-design/artifacts/mockups/${screenId}.html`
        return `  ${url}`
      })
      mockupSection =
        `\nStyled mockups (open in browser):\n` + urlLines.join("\n") + "\n"
    }

    const prompt =
      `Design summary:\n${summary}\n` +
      mockupSection +
      `\nType "approve" to commit, or "revise: <feedback>" to adjust.`

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
