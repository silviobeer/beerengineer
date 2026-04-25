import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { emitEvent, getActiveRun } from "../../core/runContext.js"
import { resolveReferences } from "../../core/referencesStore.js"
import { printStageCompletion, stageSummary, summaryArtifactFile } from "../../core/stageHelpers.js"
import { type StageArtifactContent } from "../../core/stageRuntime.js"
import { stagePresent } from "../../core/stagePresentation.js"
import { runStageWithUserReview } from "../../core/stageWithUserReview.js"
import { layout } from "../../core/workspaceLayout.js"
import { createFrontendDesignReview, createFrontendDesignStage, type RunLlmConfig } from "../../llm/registry.js"
import { renderDesignPreview } from "../../render/designPreview.js"
import { renderMockupFile, renderMockupSitemap } from "../../render/mockupFile.js"
import { ask } from "../../sim/human.js"
import type { DesignArtifact, WireframeArtifact, WorkflowContext } from "../../types.js"
import type { FrontendDesignInput, FrontendDesignState } from "./types.js"

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
 * in the review-gate summary. Falls back to a hint showing the local HTTP
 * address when no publicBaseUrl is configured, so the user can open files
 * without needing file:// access.
 */
function resolvePublicBase(_context: WorkflowContext): string {
  const activeRun = getActiveRun()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const configured = (activeRun as any)?.publicBaseUrl as string | undefined
  // Return configured URL without trailing slash, or a localhost placeholder.
  // NOTE: never use file:// here — browsers may block local file access and the
  // path would be wrong anyway (file:// + stageArtifactsDir != served URL).
  return configured?.replace(/\/$/, "") ?? "http://localhost:4100"
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

  return runStageWithUserReview<FrontendDesignState, DesignArtifact, DesignArtifact>({
    stageId: "frontend-design",
    stageAgentLabel: "Visual Designer",
    reviewerLabel: "Design Review",
    workspaceId: context.workspaceId,
    baseRunId: context.runId,
    stageAgent: createFrontendDesignStage(llm),
    reviewer: createFrontendDesignReview(llm),
    askUser: ask,
    maxReviews: 2,
    buildFreshState: ({ revisionFeedback, reviewRound }): FrontendDesignState => ({
      input,
      inputMode: "none",
      references: input.references ?? [],
      history: [],
      clarificationCount: 0,
      maxClarifications: 3,
      pendingRevisionFeedback: revisionFeedback,
      userReviewRound: reviewRound,
    }),
    async persistArtifacts(run, artifact): Promise<StageArtifactContent[]> {
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
              // The LLM ships the full HTML inside mockupHtmlPerScreen — we just
              // retrieve it verbatim. No procedural rendering occurs here.
              const html = renderMockupFile(screen.id, enrichedArtifact)
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
                `frontend-design: could not write mockup for screen "${screen.id}": ${(err as Error).message}`,
              )
            }
          }

          if (mockupScreenIds.length > 0) {
            const sitemapHtml = renderMockupSitemap(wireframes.screens, run.runId, publicBase)
            mockupArtifacts.push({
              kind: "txt" as const,
              label: "Mockups Sitemap",
              fileName: "mockups/sitemap.html",
              content: sitemapHtml,
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
    buildGatePrompt: ({ artifact, run }) => {
      const summary = buildDesignSummary(artifact)

      // Build mockup URLs for the gate prompt so the user can open them in a browser.
      // Exclude sitemap.html from the per-screen list (it's the index, not a screen).
      const mockupFiles = run.files.filter(
        f => f.path.includes("/mockups/") && f.path.endsWith(".html") && !f.path.endsWith("sitemap.html"),
      )
      let mockupSection = ""
      if (mockupFiles.length > 0) {
        const publicBase = resolvePublicBase(context)
        const urlLines = mockupFiles.map(f => {
          const screenId = f.path.split("/mockups/")[1]?.replace(/\.html$/, "") ?? ""
          const url = `${publicBase}/runs/${run.runId}/artifacts/stages/frontend-design/artifacts/mockups/${screenId}.html`
          return `  ${url}`
        })
        mockupSection =
          `\nHigh-fidelity mockups (open in browser):\n` + urlLines.join("\n") + "\n"
      }

      return (
        `Design summary:\n${summary}\n` +
        mockupSection +
        `\nType "approve" to commit, or "revise: <feedback>" to adjust.`
      )
    },
    async onUserApprove({ artifact, run }) {
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
    },
  })
}
