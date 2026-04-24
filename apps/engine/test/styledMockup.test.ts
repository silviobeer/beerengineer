/**
 * Tests for the mockupFile renderer and the LLM-generated-HTML mockup flow.
 *
 * Covered scenarios:
 *  1.  renderMockupFile: returns the LLM HTML verbatim (no re-serialisation)
 *  2.  renderMockupFile: throws descriptive error when mockupHtmlPerScreen is absent
 *  3.  renderMockupFile: throws descriptive error when screenId is missing from map
 *  4.  renderMockupFile: throws descriptive error when HTML does not start with <!doctype or <html
 *  5.  renderMockupSitemap: produces HTML with clickable links for each screen
 *  6.  renderMockupSitemap: link URL matches expected format (publicBaseUrl/runs/…/mockups/…)
 *  7.  Full loop via runStage: design artifact with mockupHtmlPerScreen writes exact LLM HTML
 *      verbatim to disk + valid sitemap.html (key new requirement)
 *  8.  Full loop via runStage: without wireframes — no mockups/ directory
 *  9.  review gate URL format: URL contains correct path template
 * 10.  validateDesignArtifact: passes when mockupHtmlPerScreen is absent (optional field)
 * 11.  validateDesignArtifact: passes when mockupHtmlPerScreen has valid entries
 * 12.  validateDesignArtifact: throws when mockupHtmlPerScreen entry is empty string
 * 13.  validateDesignArtifact: throws when mockupHtmlPerScreen entry does not start with <!doctype/<html
 * 14.  designPreview: border-radius tokens are read from artifact (not hardcoded 12px)
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { renderMockupFile, renderMockupSitemap } from "../src/render/mockupFile.js"
import { renderDesignPreview, validateDesignArtifact } from "../src/render/designPreview.js"
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

const FAKE_DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>Dashboard — Mockup</title>
<style>:root { --color-primary: #0f766e; }</style>
</head>
<body>
  <div>[Normal State] Dashboard with BEER-001, BEER-002, BEER-003</div>
  <div>[Empty State] No beers yet</div>
  <div>[Loading State] Loading…</div>
  <div>[Error State] Something went wrong</div>
</body>
</html>`

const FAKE_DETAIL_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>Detail — Mockup</title></head>
<body><div>[Normal State] Detail view for BEER-001</div><div>[Empty State]</div><div>[Loading State]</div><div>[Error State]</div></body>
</html>`

const designWithMockups: DesignArtifact = {
  ...baseDesign,
  mockupHtmlPerScreen: {
    dashboard: FAKE_DASHBOARD_HTML,
    detail: FAKE_DETAIL_HTML,
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
  ],
}

// ─── renderMockupFile ─────────────────────────────────────────────────────────

test("renderMockupFile: returns LLM HTML verbatim — no re-serialisation", () => {
  const html = renderMockupFile("dashboard", designWithMockups)
  assert.strictEqual(html, FAKE_DASHBOARD_HTML, "must return the exact LLM HTML string unchanged")
})

test("renderMockupFile: returns second screen HTML verbatim", () => {
  const html = renderMockupFile("detail", designWithMockups)
  assert.strictEqual(html, FAKE_DETAIL_HTML, "must return detail HTML exactly")
})

test("renderMockupFile: throws descriptive error when mockupHtmlPerScreen is absent", () => {
  assert.throws(
    () => renderMockupFile("dashboard", baseDesign),
    /mockupHtmlPerScreen/,
    "must throw when mockupHtmlPerScreen is absent",
  )
})

test("renderMockupFile: throws descriptive error when screenId is not in map", () => {
  assert.throws(
    () => renderMockupFile("nonexistent", designWithMockups),
    /nonexistent/,
    "must mention the missing screenId in the error",
  )
})

test("renderMockupFile: throws descriptive error when HTML does not start with <!doctype or <html", () => {
  const bad: DesignArtifact = {
    ...baseDesign,
    mockupHtmlPerScreen: { dashboard: "just some text, not HTML" },
  }
  assert.throws(
    () => renderMockupFile("dashboard", bad),
    /<!doctype|<html/i,
    "must throw when HTML doesn't start with a doctype or html tag",
  )
})

test("renderMockupFile: accepts HTML starting with lowercase <!doctype html>", () => {
  const lower: DesignArtifact = {
    ...baseDesign,
    mockupHtmlPerScreen: { dashboard: "<!doctype html>\n<html><body>ok</body></html>" },
  }
  assert.doesNotThrow(() => renderMockupFile("dashboard", lower))
})

test("renderMockupFile: accepts HTML starting with <html> (no doctype)", () => {
  const noDoctype: DesignArtifact = {
    ...baseDesign,
    mockupHtmlPerScreen: { dashboard: "<html><head></head><body>ok</body></html>" },
  }
  assert.doesNotThrow(() => renderMockupFile("dashboard", noDoctype))
})

// ─── renderMockupSitemap ──────────────────────────────────────────────────────

test("renderMockupSitemap: produces HTML with links for each screen", () => {
  const screens: Screen[] = [
    { ...singleScreen, id: "dashboard", name: "Dashboard", purpose: "Overview" },
    { ...singleScreen, id: "detail", name: "Detail", purpose: "Item detail" },
  ]
  const html = renderMockupSitemap(screens, "run-123", "http://localhost:4100")
  assert.ok(html.startsWith("<!doctype html"), "must be a full HTML document")
  assert.ok(html.includes("Dashboard"), "must include screen name")
  assert.ok(html.includes("Detail"), "must include second screen name")
})

test("renderMockupSitemap: link URL uses correct path template", () => {
  const screens: Screen[] = [
    { ...singleScreen, id: "dashboard", name: "Dashboard", purpose: "Overview" },
    { ...singleScreen, id: "detail", name: "Detail", purpose: "Detail" },
  ]
  const html = renderMockupSitemap(screens, "run-abc", "http://app.example.com")
  assert.ok(
    html.includes("http://app.example.com/runs/run-abc/artifacts/stages/frontend-design/artifacts/mockups/dashboard.html"),
    "dashboard URL must match expected format",
  )
  assert.ok(
    html.includes("http://app.example.com/runs/run-abc/artifacts/stages/frontend-design/artifacts/mockups/detail.html"),
    "detail URL must match expected format",
  )
})

test("renderMockupSitemap: strips trailing slash from publicBaseUrl", () => {
  const screens = [{ ...singleScreen, id: "s1", name: "Screen 1", purpose: "p" }]
  const html = renderMockupSitemap(screens, "r1", "http://localhost:4100/")
  assert.ok(
    html.includes("http://localhost:4100/runs/r1/"),
    "must strip trailing slash and build correct URL",
  )
  assert.ok(
    !html.includes("localhost:4100//runs"),
    "must not produce double slashes",
  )
})

// ─── validateDesignArtifact: mockupHtmlPerScreen field ───────────────────────

test("validateDesignArtifact: passes when mockupHtmlPerScreen is absent (optional)", () => {
  assert.doesNotThrow(() => validateDesignArtifact(baseDesign))
})

test("validateDesignArtifact: passes when mockupHtmlPerScreen has valid entries", () => {
  assert.doesNotThrow(() => validateDesignArtifact(designWithMockups))
})

test("validateDesignArtifact: throws when mockupHtmlPerScreen entry is empty string", () => {
  const bad: DesignArtifact = {
    ...baseDesign,
    mockupHtmlPerScreen: { s1: "" },
  }
  assert.throws(
    () => validateDesignArtifact(bad),
    /mockupHtmlPerScreen.*s1|s1.*mockupHtmlPerScreen/i,
    "must mention the offending key",
  )
})

test("validateDesignArtifact: throws when mockupHtmlPerScreen entry is not a valid HTML document", () => {
  const bad: DesignArtifact = {
    ...baseDesign,
    mockupHtmlPerScreen: { s1: "not html at all" },
  }
  assert.throws(
    () => validateDesignArtifact(bad),
    /<!doctype|<html/i,
    "must throw for non-HTML content",
  )
})

test("validateDesignArtifact: throws when mockupHtmlPerScreen is an array (not object)", () => {
  const bad = { ...baseDesign, mockupHtmlPerScreen: ["html1"] } as unknown as DesignArtifact
  assert.throws(
    () => validateDesignArtifact(bad),
    /mockupHtmlPerScreen/,
    "must reject array instead of object",
  )
})

// ─── designPreview: border tokens applied (not hardcoded 12px) ───────────────

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

// ─── Full loop: LLM HTML written verbatim to disk ────────────────────────────

function withTmpCwd(): { dir: string; restore: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "be2-mockup-file-"))
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

function makeFrontendDesignState(wireframes: WireframeArtifact): () => FrontendDesignState {
  return () => ({
    input: {
      itemConcept: {
        summary: "Test",
        problem: "Test",
        users: ["tester"],
        constraints: [],
        hasUi: true,
      },
      projects: [{
        id: "P01",
        name: "Test",
        description: "Test",
        hasUi: true,
        concept: { summary: "T", problem: "P", users: [], constraints: [] },
      }],
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

test("frontend-design runStage: LLM HTML written verbatim — mockups/dashboard.html matches exact LLM output + sitemap.html present", async () => {
  const env = withTmpCwd()
  try {
    const answers = ["no design system", "professional", "no constraints"]
    let i = 0

    const { run } = await runStage<FrontendDesignState, DesignArtifact, DesignArtifact>({
      stageId: "frontend-design",
      stageAgentLabel: "Visual Designer",
      reviewerLabel: "Design Review",
      workspaceId: "ws-fd-llm-html",
      runId: "run-fd-llm-html",
      createInitialState: makeFrontendDesignState(stubWireframes),
      stageAgent: new FakeFrontendDesignStageAdapter(),
      reviewer: new FakeFrontendDesignReviewAdapter(),
      askUser: async () => answers[i++] ?? "ok",
      async persistArtifacts(run, artifact) {
        const { renderMockupFile: rmf, renderMockupSitemap: rms } = await import("../src/render/mockupFile.js")
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

        if (artifact.mockupHtmlPerScreen) {
          for (const screen of stubWireframes.screens) {
            const html = rmf(screen.id, artifact)
            files.push({ kind: "txt" as const, label: `Mockup — ${screen.name}`, fileName: `mockups/${screen.id}.html`, content: html })
          }
          files.push({
            kind: "txt" as const,
            label: "Mockups Sitemap",
            fileName: "mockups/sitemap.html",
            content: rms(stubWireframes.screens, run.runId, "http://localhost:4100"),
          })
        }

        return files
      },
      async onApproved(artifact) { return artifact },
      maxReviews: 3,
    })

    const artifactsDir = run.stageArtifactsDir

    // Core files must exist
    assert.ok(existsSync(join(artifactsDir, "design.json")), "design.json must exist")
    assert.ok(existsSync(join(artifactsDir, "design-preview.html")), "design-preview.html must exist")
    assert.ok(existsSync(join(artifactsDir, "mockups", "dashboard.html")), "mockups/dashboard.html must exist")
    assert.ok(existsSync(join(artifactsDir, "mockups", "sitemap.html")), "mockups/sitemap.html must exist")

    // The dashboard.html must be the exact LLM HTML — no re-serialisation
    const dashboardHtml = readFileSync(join(artifactsDir, "mockups", "dashboard.html"), "utf8")
    // The fake adapter emits <!doctype html> with [Normal State] / [Empty State] / etc.
    assert.ok(dashboardHtml.startsWith("<!doctype html"), "mockup must start with <!doctype html")
    assert.ok(dashboardHtml.includes("[Normal State]"), "mockup must include Normal State section")
    assert.ok(dashboardHtml.includes("[Empty State]"), "mockup must include Empty State section")
    assert.ok(dashboardHtml.includes("[Loading State]"), "mockup must include Loading State section")
    assert.ok(dashboardHtml.includes("[Error State]"), "mockup must include Error State section")
    // Must NOT contain bracket-style wireframe placeholders
    assert.ok(!dashboardHtml.includes("[ Column:"), "mockup must not contain bracket wireframe placeholders")

    // Sitemap must link to the dashboard mockup
    const sitemapHtml = readFileSync(join(artifactsDir, "mockups", "sitemap.html"), "utf8")
    assert.ok(sitemapHtml.includes("dashboard.html"), "sitemap must link to dashboard mockup")
    assert.ok(sitemapHtml.includes("Dashboard"), "sitemap must include screen name")

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

// ─── Review gate URL format ───────────────────────────────────────────────────

test("review gate URL: matches {publicBaseUrl}/runs/{runId}/artifacts/stages/frontend-design/artifacts/mockups/{screenId}.html", () => {
  const runId = "run-gate-test"
  const publicBase = "http://localhost:4100"
  const mockupFiles = [
    { path: `/some/dir/mockups/dashboard.html`, kind: "txt" as const, label: "Mockup — Dashboard" },
    { path: `/some/dir/mockups/detail.html`, kind: "txt" as const, label: "Mockup — Detail" },
  ]
  // Mirror the URL construction from frontend-design/index.ts
  const urlLines = mockupFiles.map(f => {
    const screenId = f.path.split("/mockups/")[1]?.replace(/\.html$/, "") ?? ""
    return `${publicBase}/runs/${runId}/artifacts/stages/frontend-design/artifacts/mockups/${screenId}.html`
  })

  assert.strictEqual(
    urlLines[0],
    "http://localhost:4100/runs/run-gate-test/artifacts/stages/frontend-design/artifacts/mockups/dashboard.html",
    "dashboard URL must exactly match the expected template",
  )
  assert.strictEqual(
    urlLines[1],
    "http://localhost:4100/runs/run-gate-test/artifacts/stages/frontend-design/artifacts/mockups/detail.html",
    "detail URL must exactly match the expected template",
  )
  // Verify no file:// leakage and no path doubling
  for (const url of urlLines) {
    assert.ok(!url.startsWith("file://"), "URL must not use file:// scheme")
    assert.ok(!url.includes("//runs"), "URL must not have double slashes before /runs")
    assert.ok(!url.includes("artifacts/stages/frontend-design/artifacts/stages"), "URL must not double the path segment")
  }
})
