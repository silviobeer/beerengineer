import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

import { computeScreenOwners } from "../src/core/screenOwners.js"
import { renderDesignTokensCss } from "../src/render/designTokensCss.js"
import { runDesignSystemGate } from "../src/review/designSystemGate.js"
import { buildStoryExecutionContext } from "../src/stages/execution/index.js"
import type { ArchitectureArtifact, DesignArtifact, ImplementationPlanArtifact, StoryTestPlanArtifact, WireframeArtifact, WithArchitecture } from "../src/types.js"

const design: DesignArtifact = {
  tokens: {
    light: {
      primary: "#005a65",
      secondary: "#146b74",
      accent: "#e6bd5c",
      background: "#f8f5ef",
      surface: "#ffffff",
      textPrimary: "#172126",
      textMuted: "#60717a",
      success: "#19734b",
      warning: "#ad7c12",
      error: "#b33d2e",
      info: "#2563eb",
    },
    dark: {
      primary: "#2da3b0",
      secondary: "#74bfca",
      accent: "#f4d487",
      background: "#0d171b",
      surface: "#132127",
      textPrimary: "#f3f7f8",
      textMuted: "#a4b7be",
      success: "#36c177",
      warning: "#d8a62d",
      error: "#ef7f70",
      info: "#60a5fa",
    },
  },
  typography: {
    display: { family: "'Space Grotesk', system-ui, sans-serif", weight: "700", usage: "headings" },
    body: { family: "'Inter', system-ui, sans-serif", weight: "400", usage: "body" },
    mono: { family: "'JetBrains Mono', monospace", weight: "400", usage: "code" },
    scale: { base: "0.9375rem", lg: "1.125rem" },
  },
  spacing: {
    baseUnit: "0.25rem",
    sectionPadding: "1.5rem",
    cardPadding: "1rem",
    contentMaxWidth: "72rem",
  },
  borders: { buttons: "0", cards: "0", badges: "0" },
  shadows: { card: "0 8px 24px rgba(0,0,0,0.08)" },
  tone: "Petrol and gold",
  antiPatterns: ["rounded cards", "generic zinc palette"],
  inputMode: "none",
  mockupHtmlPerScreen: {
    dashboard: "<!doctype html><html><body>dashboard</body></html>",
    detail: "<!doctype html><html><body>detail</body></html>",
  },
}

const architecture: ArchitectureArtifact = {
  project: { id: "P01", name: "Project", description: "demo" },
  concept: { summary: "concept", problem: "problem", users: ["u"], constraints: [] },
  prdSummary: { storyCount: 2, storyIds: ["US-01", "US-02"] },
  architecture: {
    summary: "summary",
    systemShape: "Next.js app",
    components: [{ name: "Topbar", responsibility: "frame" }],
    dataModelNotes: [],
    apiNotes: [],
    deploymentNotes: [],
    constraints: ["Keep design tokens centralized"],
    risks: [],
    openQuestions: [],
  },
}

const testPlan: StoryTestPlanArtifact = {
  project: { id: "P01", name: "Project" },
  story: { id: "US-01", title: "Dashboard" },
  acceptanceCriteria: [{ id: "AC-1", text: "works", priority: "must", category: "functional" }],
  testPlan: { summary: "Ship dashboard", testCases: [], fixtures: [], edgeCases: [], assumptions: [] },
}

function context(root: string): WithArchitecture {
  const wireframes: WireframeArtifact = {
    screens: [
      { id: "dashboard", name: "Dashboard", purpose: "overview", projectIds: ["P01"], layout: { kind: "grid", regions: [] }, elements: [] },
      { id: "detail", name: "Detail", purpose: "details", projectIds: ["P01"], layout: { kind: "grid", regions: [] }, elements: [] },
    ],
    navigation: { entryPoints: [], flows: [] },
    inputMode: "none",
  }
  const plan: ImplementationPlanArtifact = {
    project: { id: "P01", name: "Project" },
    conceptSummary: "concept",
    architectureSummary: "summary",
    plan: {
      summary: "summary",
      assumptions: [],
      sequencingNotes: [],
      dependencies: [],
      risks: [],
      waves: [
        {
          id: "W1",
          number: 1,
          kind: "feature",
          goal: "dashboard",
          stories: [
            { id: "US-01", title: "Dashboard", screenIds: ["dashboard"], sharedFiles: ["apps/ui/app/layout.tsx"] },
            { id: "US-02", title: "Detail", screenIds: ["dashboard", "detail"], sharedFiles: ["apps/ui/app/layout.tsx"] },
          ],
          internallyParallelizable: true,
          dependencies: [],
          exitCriteria: [],
        },
      ],
    },
  }
  return {
    workspaceId: "ws",
    runId: "run-1",
    workspaceRoot: root,
    itemSlug: "item",
    baseBranch: "main",
    project: { id: "P01", name: "Project", description: "demo", concept: architecture.concept, hasUi: true },
    prd: {
      stories: [
        { id: "US-01", title: "Dashboard", acceptanceCriteria: [] },
        { id: "US-02", title: "Detail", acceptanceCriteria: [] },
      ],
    },
    architecture,
    plan,
    design,
    wireframes,
  }
}

test("computeScreenOwners uses plan order and skips later claims on the same screen", () => {
  const ctx = context(process.cwd())
  assert.deepEqual(computeScreenOwners(ctx.prd, ctx.plan, ctx.wireframes), {
    dashboard: "US-01",
    detail: "US-02",
  })
})

test("buildStoryExecutionContext injects design and only the owner mockup", () => {
  const ctx = context(process.cwd())
  const owners = computeScreenOwners(ctx.prd, ctx.plan, ctx.wireframes)
  const storyContext = buildStoryExecutionContext(ctx, ctx.plan.plan.waves[0], architecture, testPlan, {
    worktreeRoot: "/tmp/story",
    screenOwners: owners,
  })

  assert.equal(storyContext.design?.tone, "Petrol and gold")
  assert.deepEqual(storyContext.architectureSummary.decisions, [])
  assert.deepEqual(storyContext.mockupHtmlByScreen, {
    dashboard: "<!doctype html><html><body>dashboard</body></html>",
  })
})

test("renderDesignTokensCss emits light and dark palettes plus sharp-edge reset", () => {
  const css = renderDesignTokensCss(design)
  assert.match(css, /--color-primary: #005a65;/)
  assert.match(css, /--color-primary: #2da3b0;/)
  assert.match(css, /\*, \*::before, \*::after \{ border-radius: 0 !important; \}/)
  assert.match(css, /--font-display: 'Space Grotesk', system-ui, sans-serif;/)
  assert.match(css, /--font-body: 'Inter', system-ui, sans-serif;/)
  assert.match(css, /--font-mono: 'JetBrains Mono', monospace;/)
})

test("runDesignSystemGate reports hardcoded colors and rounded styles in added lines", async () => {
  const root = mkdtempSync(join(tmpdir(), "be2-design-gate-"))
  try {
    spawnSync("git", ["init", "--initial-branch=main"], { cwd: root, encoding: "utf8" })
    spawnSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root, encoding: "utf8" })
    spawnSync("git", ["config", "user.name", "test"], { cwd: root, encoding: "utf8" })
    mkdirSync(join(root, "src"), { recursive: true })
    writeFileSync(join(root, "src", "Topbar.tsx"), "<div className=\"bg-zinc-950 rounded\">x</div>\nconst color = '#123456'\n")

    const result = await runDesignSystemGate({
      workspaceRoot: root,
      artifactsDir: join(root, "artifacts"),
      baselineSha: null,
      storyBranch: "story/demo",
      baseBranch: "main",
      changedFiles: ["src/Topbar.tsx"],
      storyId: "US-01",
      reviewCycle: 1,
      reviewPolicy: {
        coderabbit: { enabled: false },
        sonarcloud: { enabled: false },
      },
      forceFake: true,
    })

    assert.equal(result.status, "ran")
    assert.equal(result.passed, false)
    assert.match(result.findings.map(finding => finding.message).join("\n"), /bg-zinc-950/)
    assert.match(result.findings.map(finding => finding.message).join("\n"), /hardcoded hex color/)
    assert.match(result.findings.map(finding => finding.message).join("\n"), /rounded styling/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
