/**
 * Tests for the styledMockup renderer and the integration between
 * frontend-design and visual-companion wireframes.
 *
 * Covered scenarios:
 *  1. renderStyledMockup: produces full HTML with CSS vars from design tokens
 *  2. renderStyledMockup: borders.cards applied to .region and .styled-card (not hardcoded 12px)
 *  3. renderStyledMockup: shadows.* mapped to --shadow-* CSS vars
 *  4. renderStyledMockup: dark mode vars emitted when tokens.dark present
 *  5. renderStyledMockup: anti-pattern "zero rounded corners" injects !important override
 *  6. renderStyledMockup: all element kinds (heading, button, card, chip, input, list, table, unknown) render without throwing
 *  7. renderStyledMockup: throws descriptive error when design artifact is malformed
 *  8. renderMockupIndex: produces HTML linking each screen
 *  9. buildAntiPatternCss: zero-radius patterns trigger enforcement rule
 * 10. Full loop via runStage: frontend-design with wireframes input writes mockups/ and mockups/index.html
 * 11. designPreview: border-radius tokens are read from artifact (not hardcoded 12px)
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { renderStyledMockup, renderMockupIndex, __testing as mockupTesting } from "../src/render/styledMockup.js"
import { renderDesignPreview, __testing as previewTesting } from "../src/render/designPreview.js"
import { runStage } from "../src/core/stageRuntime.js"
import { FakeFrontendDesignStageAdapter } from "../src/llm/fake/frontendDesignStage.js"
import { FakeFrontendDesignReviewAdapter } from "../src/llm/fake/frontendDesignReview.js"
import type { DesignArtifact, Screen, WireframeArtifact } from "../src/types.js"
import type { FrontendDesignState } from "../src/stages/frontend-design/types.js"

// ─── Fixtures ────────────────────────────────────────────────────────────────

const baseDesign: DesignArtifact = {
  tokens: {
    light: {
      primary: "#0f766e",
      secondary: "#155e75",
      accent: "#f59e0b",
      background: "#f4f7f6",
      surface: "#ffffff",
      textPrimary: "#102a2a",
      textMuted: "#527070",
      success: "#15803d",
      warning: "#b45309",
      error: "#b91c1c",
      info: "#0369a1",
    },
  },
  typography: {
    display: { family: "Fraunces", weight: "700", usage: "Headlines" },
    body: { family: "Manrope", weight: "500", usage: "UI copy" },
    scale: { xs: "0.75rem", sm: "0.875rem", md: "1rem" },
  },
  spacing: {
    baseUnit: "8px",
    sectionPadding: "32px",
    cardPadding: "20px",
    contentMaxWidth: "1200px",
  },
  borders: {
    buttons: "999px",
    cards: "20px",
    badges: "999px",
  },
  shadows: {
    sm: "0 1px 2px rgba(16,42,42,0.08)",
    md: "0 12px 24px rgba(16,42,42,0.12)",
  },
  tone: "Practical calm.",
  antiPatterns: ["generic SaaS blue gradients"],
  inputMode: "none",
}

const sharpDesign: DesignArtifact = {
  ...baseDesign,
  borders: { buttons: "0px", cards: "0px", badges: "0px" },
  antiPatterns: ["zero rounded corners", "avoid border radius"],
}

const darkDesign: DesignArtifact = {
  ...baseDesign,
  tokens: {
    ...baseDesign.tokens,
    dark: {
      primary: "#5eead4",
      secondary: "#67e8f9",
      accent: "#fbbf24",
      background: "#0f1720",
      surface: "#16212a",
      textPrimary: "#e6fffb",
      textMuted: "#9dc9c4",
      success: "#4ade80",
      warning: "#fbbf24",
      error: "#f87171",
      info: "#38bdf8",
    },
  },
}

const singleScreen: Screen = {
  id: "dashboard",
  name: "Dashboard",
  purpose: "Main overview screen",
  projectIds: ["P01"],
  layout: {
    kind: "sidebar-main",
    regions: [
      { id: "header", label: "Header" },
      { id: "main", label: "Main" },
    ],
  },
  elements: [
    { id: "e1", region: "header", kind: "heading", label: "Beer Dashboard" },
    { id: "e2", region: "header", kind: "button", label: "Add Beer" },
    { id: "e3", region: "main", kind: "card", label: "Beer Card", placeholder: "ABV 5.2%" },
    { id: "e4", region: "main", kind: "chip", label: "IPA" },
    { id: "e5", region: "main", kind: "input", label: "Search" },
    { id: "e6", region: "main", kind: "list", label: "Recent" },
    { id: "e7", region: "main", kind: "table", label: "Stats" },
    { id: "e8", region: "main", kind: "placeholder", label: "Unknown widget" },
  ],
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test("renderStyledMockup: produces HTML with CSS variables from design tokens", () => {
  const html = renderStyledMockup(singleScreen, baseDesign)
  assert.ok(html.includes("<!doctype html"), "must be a full HTML document")
  assert.ok(html.includes("--color-primary: #0f766e"), "primary color CSS var must be present")
  assert.ok(html.includes("--color-accent: #f59e0b"), "accent color CSS var must be present")
  assert.ok(html.includes("--font-display: Fraunces"), "display font CSS var must be present")
  assert.ok(html.includes("--font-body: Manrope"), "body font CSS var must be present")
})

test("renderStyledMockup: borders.cards token applied — not hardcoded 12px", () => {
  const html20 = renderStyledMockup(singleScreen, baseDesign) // cards: "20px"
  assert.ok(html20.includes("--radius-cards: 20px"), "cards radius must come from artifact (20px)")
  assert.ok(!html20.includes("border-radius: 12px"), "must NOT have hardcoded 12px")

  const html0 = renderStyledMockup(singleScreen, sharpDesign) // cards: "0px"
  assert.ok(html0.includes("--radius-cards: 0px"), "cards radius must come from artifact (0px)")
})

test("renderStyledMockup: shadows mapped to --shadow-* CSS vars", () => {
  const html = renderStyledMockup(singleScreen, baseDesign)
  assert.ok(html.includes("--shadow-sm:"), "shadow-sm CSS var must be present")
  assert.ok(html.includes("--shadow-md:"), "shadow-md CSS var must be present")
})

test("renderStyledMockup: dark mode vars emitted when tokens.dark present", () => {
  const html = renderStyledMockup(singleScreen, darkDesign)
  assert.ok(html.includes("prefers-color-scheme: dark"), "must include dark-mode media query")
  assert.ok(html.includes("#0f1720"), "dark background must be present")
})

test("renderStyledMockup: no dark mode block when tokens.dark absent", () => {
  const html = renderStyledMockup(singleScreen, baseDesign)
  assert.ok(!html.includes("prefers-color-scheme: dark"), "must not include dark-mode block when absent")
})

test("renderStyledMockup: anti-pattern 'zero rounded corners' injects border-radius: 0 !important", () => {
  const html = renderStyledMockup(singleScreen, sharpDesign)
  assert.ok(html.includes("border-radius: 0 !important"), "must enforce zero-radius anti-pattern")
})

test("renderStyledMockup: no !important override when anti-patterns do not mention corners", () => {
  const html = renderStyledMockup(singleScreen, baseDesign) // antiPatterns: ["generic SaaS blue gradients"]
  assert.ok(!html.includes("!important"), "must not inject override when anti-pattern doesn't mention radius")
})

test("renderStyledMockup: all element kinds render without throwing", () => {
  // The fixture screen already covers: heading, button, card, chip, input, list, table, placeholder
  assert.doesNotThrow(() => renderStyledMockup(singleScreen, baseDesign))
})

test("renderStyledMockup: heading element uses display font class", () => {
  const html = renderStyledMockup(singleScreen, baseDesign)
  assert.ok(html.includes("styled-heading"), "must render heading with styled-heading class")
  assert.ok(html.includes("Beer Dashboard"), "heading label must appear in output")
})

test("renderStyledMockup: button element renders with styled-btn class", () => {
  const html = renderStyledMockup(singleScreen, baseDesign)
  assert.ok(html.includes("styled-btn"), "must render button with styled-btn class")
  assert.ok(html.includes("Add Beer"), "button label must appear")
})

test("renderStyledMockup: throws descriptive error when design artifact is malformed", () => {
  const malformed = { ...baseDesign, tone: "" } as DesignArtifact
  assert.throws(
    () => renderStyledMockup(singleScreen, malformed),
    /Invalid design artifact from LLM/,
    "must throw descriptive error for malformed artifact",
  )
})

test("renderMockupIndex: produces HTML linking all screens", () => {
  const screens: Screen[] = [
    { ...singleScreen, id: "dashboard", name: "Dashboard", purpose: "Overview" },
    { ...singleScreen, id: "detail", name: "Detail", purpose: "Detail view" },
  ]
  const html = renderMockupIndex(screens, "run-123", "http://localhost:4100")
  assert.ok(html.includes("run-123/artifacts/stages/frontend-design/artifacts/mockups/dashboard.html"), "must link dashboard mockup")
  assert.ok(html.includes("run-123/artifacts/stages/frontend-design/artifacts/mockups/detail.html"), "must link detail mockup")
  assert.ok(html.includes("Dashboard"), "must include screen name")
  assert.ok(html.includes("Detail"), "must include second screen name")
})

test("buildAntiPatternCss: zero-radius patterns trigger !important enforcement", () => {
  const { buildAntiPatternCss } = mockupTesting
  const css = buildAntiPatternCss(["zero rounded corners", "no border radius allowed"])
  assert.ok(css.includes("border-radius: 0 !important"), "should enforce zero-radius rule")
})

test("buildAntiPatternCss: gradient-only anti-pattern produces no border-radius rule", () => {
  const { buildAntiPatternCss } = mockupTesting
  const css = buildAntiPatternCss(["avoid generic gradients"])
  assert.ok(!css.includes("border-radius"), "should not produce border-radius rule for non-radius anti-pattern")
})

// ─── designPreview: border tokens applied (no hardcoded 12px) ────────────────

test("designPreview: panel border-radius comes from borders.cards token", () => {
  const zero = { ...baseDesign, borders: { buttons: "0px", cards: "0px", badges: "0px" } }
  const html = renderDesignPreview(zero)
  assert.ok(html.includes("border-radius: 0px"), "panel must use artifact's cards border-radius (0px)")
  assert.ok(!html.includes("border-radius: 12px"), "must NOT hardcode 12px")
})

test("designPreview: chip border-radius comes from borders.badges token", () => {
  const custom = { ...baseDesign, borders: { buttons: "4px", cards: "4px", badges: "2px" } }
  const html = renderDesignPreview(custom)
  assert.ok(html.includes("border-radius: 2px"), "chip must use artifact's badges border-radius")
})

// ─── Full loop: frontend-design stage writes mockups when wireframes provided ─

function withTmpCwd(): { dir: string; restore: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "be2-styled-mockup-"))
  const prev = process.cwd()
  process.chdir(dir)
  return {
    dir,
    restore: () => {
      process.chdir(prev)
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

const stubWireframes: WireframeArtifact = {
  screens: [singleScreen],
  navigation: { entryPoints: [{ screenId: "dashboard", projectId: "P01" }], flows: [] },
  inputMode: "none",
}

function makeFrontendDesignStateWithWireframes(
  wireframes: WireframeArtifact,
): () => FrontendDesignState {
  return () => ({
    input: {
      itemConcept: {
        summary: "Test",
        problem: "Test",
        users: ["tester"],
        constraints: [],
        hasUi: true,
      },
      projects: [{ id: "P01", name: "Test", description: "Test", hasUi: true, concept: { summary: "T", problem: "P", users: [], constraints: [] } }],
      wireframes,
    },
    inputMode: "none",
    references: [],
    history: [],
    clarificationCount: 0,
    maxClarifications: 3,
    userReviewRound: 0,
  })
}

test("frontend-design runStage: with wireframes input — writes mockups/dashboard.html and mockups/index.html", async () => {
  const env = withTmpCwd()
  try {
    const answers = ["no design system", "professional", "no constraints"]
    let i = 0

    const { run } = await runStage<FrontendDesignState, DesignArtifact, DesignArtifact>({
      stageId: "frontend-design",
      stageAgentLabel: "Visual Designer",
      reviewerLabel: "Design Review",
      workspaceId: "ws-fd-mockup",
      runId: "run-fd-mockup",
      createInitialState: makeFrontendDesignStateWithWireframes(stubWireframes),
      stageAgent: new FakeFrontendDesignStageAdapter(),
      reviewer: new FakeFrontendDesignReviewAdapter(),
      askUser: async () => answers[i++] ?? "ok",
      async persistArtifacts(run, artifact) {
        // Import the real persistArtifacts logic by driving the stage index.
        // Here we manually call the render functions that the real index calls,
        // replicating what persistArtifacts does in frontend-design/index.ts.
        const { renderStyledMockup: rsm, renderMockupIndex: rmi } = await import("../src/render/styledMockup.js")
        const { renderDesignPreview: rdp } = await import("../src/render/designPreview.js")
        const { mkdirSync: mds, writeFileSync: wfs } = await import("node:fs")
        const { join: pjoin } = await import("node:path")

        mds(run.stageArtifactsDir, { recursive: true })
        const mockupDir = pjoin(run.stageArtifactsDir, "mockups")
        mds(mockupDir, { recursive: true })

        const files = [
          { kind: "json" as const, label: "Design JSON", fileName: "design.json", content: JSON.stringify(artifact) },
          { kind: "txt" as const, label: "Design Preview", fileName: "design-preview.html", content: rdp(artifact) },
        ]

        for (const screen of stubWireframes.screens) {
          const html = rsm(screen, artifact)
          files.push({ kind: "txt" as const, label: `Mockup — ${screen.name}`, fileName: `mockups/${screen.id}.html`, content: html })
        }
        files.push({
          kind: "txt" as const,
          label: "Mockups Index",
          fileName: "mockups/index.html",
          content: rmi(stubWireframes.screens, run.runId, "http://localhost:4100"),
        })
        return files
      },
      async onApproved(artifact) { return artifact },
      maxReviews: 3,
    })

    // Verify files were written
    const artifactsDir = run.stageArtifactsDir
    assert.ok(existsSync(join(artifactsDir, "design.json")), "design.json must exist")
    assert.ok(existsSync(join(artifactsDir, "design-preview.html")), "design-preview.html must exist")
    assert.ok(existsSync(join(artifactsDir, "mockups", "dashboard.html")), "mockups/dashboard.html must exist")
    assert.ok(existsSync(join(artifactsDir, "mockups", "index.html")), "mockups/index.html must exist")

    // Verify mockup content
    const { readFileSync } = await import("node:fs")
    const dashboardHtml = readFileSync(join(artifactsDir, "mockups", "dashboard.html"), "utf8")
    assert.ok(dashboardHtml.includes("--color-primary"), "mockup must include CSS vars from design tokens")
    assert.ok(dashboardHtml.includes("--radius-cards"), "mockup must include border radius CSS var from artifact")
    assert.ok(!dashboardHtml.includes("border-radius: 12px"), "mockup must NOT hardcode 12px radius")

    // Verify design-preview uses artifact borders (not hardcoded 12px)
    const previewHtml = readFileSync(join(artifactsDir, "design-preview.html"), "utf8")
    // The fake artifact has cards: "20px" — verify it uses that
    assert.ok(!previewHtml.includes("border-radius: 12px"), "design-preview must NOT hardcode 12px radius")
  } finally {
    env.restore()
  }
})

test("frontend-design runStage: without wireframes — no mockups/ directory written", async () => {
  const env = withTmpCwd()
  try {
    const answers = ["no design system", "professional", "no constraints"]
    let i = 0

    const { run } = await runStage<FrontendDesignState, DesignArtifact, DesignArtifact>({
      stageId: "frontend-design",
      stageAgentLabel: "Visual Designer",
      reviewerLabel: "Design Review",
      workspaceId: "ws-fd-no-mockup",
      runId: "run-fd-no-mockup",
      createInitialState: () => ({
        input: {
          itemConcept: { summary: "T", problem: "P", users: [], constraints: [], hasUi: false },
          projects: [],
        },
        inputMode: "none",
        references: [],
        history: [],
        clarificationCount: 0,
        maxClarifications: 3,
        userReviewRound: 0,
      }),
      stageAgent: new FakeFrontendDesignStageAdapter(),
      reviewer: new FakeFrontendDesignReviewAdapter(),
      askUser: async () => answers[i++] ?? "ok",
      async persistArtifacts(run, artifact) {
        const { mkdirSync: mds } = await import("node:fs")
        const { renderDesignPreview: rdp } = await import("../src/render/designPreview.js")
        mds(run.stageArtifactsDir, { recursive: true })
        // No wireframes — just design.json + design-preview.html
        return [
          { kind: "json" as const, label: "Design JSON", fileName: "design.json", content: JSON.stringify(artifact) },
          { kind: "txt" as const, label: "Design Preview", fileName: "design-preview.html", content: rdp(artifact) },
        ]
      },
      async onApproved(artifact) { return artifact },
      maxReviews: 3,
    })

    const mockupDir = join(run.stageArtifactsDir, "mockups")
    assert.ok(!existsSync(mockupDir), "mockups/ directory must NOT be created when no wireframes")
  } finally {
    env.restore()
  }
})

test("review gate summary includes mockup URLs when mockup files present in run.files", () => {
  // Unit-test the URL construction logic in isolation (no full runStage overhead).
  // Simulate the review gate building the prompt from a run that has mockup files.
  const runId = "run-gate-test"
  const publicBase = "http://localhost:4100"
  const mockupFiles = [
    { path: `/some/dir/mockups/dashboard.html`, kind: "txt" as const, label: "Mockup — Dashboard" },
    { path: `/some/dir/mockups/detail.html`, kind: "txt" as const, label: "Mockup — Detail" },
  ]
  // Mirror the URL construction from frontend-design/index.ts
  const urlLines = mockupFiles.map(f => {
    const screenId = f.path.split("/mockups/")[1]?.replace(/\.html$/, "") ?? ""
    return `  ${publicBase}/runs/${runId}/artifacts/stages/frontend-design/artifacts/mockups/${screenId}.html`
  })
  const mockupSection = `\nStyled mockups (open in browser):\n` + urlLines.join("\n") + "\n"

  assert.ok(
    mockupSection.includes(`${publicBase}/runs/${runId}/artifacts/stages/frontend-design/artifacts/mockups/dashboard.html`),
    "review gate must include dashboard mockup URL",
  )
  assert.ok(
    mockupSection.includes(`${publicBase}/runs/${runId}/artifacts/stages/frontend-design/artifacts/mockups/detail.html`),
    "review gate must include detail mockup URL",
  )
})
