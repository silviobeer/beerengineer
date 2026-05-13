import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildRunArtifactReadModels } from "../src/api/artifactReadModel.js"
import { getRunTree } from "../src/api/board.js"
import { createBus, busToWorkflowIO } from "../src/core/bus.js"
import { attachDbSync } from "../src/core/dbSync.js"
import { generateImportContext, importContextArtifactPath, readImportContextArtifact, writeImportContextArtifact, type GeneratedImportContext } from "../src/core/importContext.js"
import { runWithWorkflowIO } from "../src/core/io.js"
import { loadPreparedImportBundle, preparedImportSourceSnapshotDir, seedPreparedImportArtifacts } from "../src/core/preparedImport.js"
import { runWithActiveRun, withStageLifecycle } from "../src/core/runContext.js"
import { prepareForegroundPreparedImportRun } from "../src/core/runService.js"
import { layout } from "../src/core/workspaceLayout.js"
import { resolveWorkflowContextForItemRun } from "../src/core/workflowContextResolver.js"
import { initDatabase } from "../src/db/connection.js"
import { Repos } from "../src/db/repositories.js"
import { defaultAppConfig } from "../src/setup/config.js"
import { architecture } from "../src/stages/architecture/index.js"

function fileOutcomes(files: Array<{ path: string; outcome: string }>) {
  return files.map(file => [file.path, file.outcome])
}

type DegradedImportContextFixture = {
  status: "partial" | "unavailable"
  warnings: string[]
  files: Array<{ path: string; outcome: string; reason: string }>
}

function tempRepos(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  const db = initDatabase(join(dir, "test.sqlite"))
  const repos = new Repos(db)
  return { dir, db, repos }
}

function makeIo() {
  const bus = createBus()
  return { ...busToWorkflowIO(bus), bus }
}

function fakeScheduler() {
  return {
    setInterval(): number {
      return 0
    },
    clearInterval(): void {},
  }
}

function appConfigFor(root: string) {
  return {
    ...defaultAppConfig(),
    allowedRoots: [root],
  }
}

function seedGitRepo(repoRoot: string): void {
  mkdirSync(repoRoot, { recursive: true })
  spawnSync("git", ["init", "--initial-branch=main"], { cwd: repoRoot, encoding: "utf8" })
  spawnSync("git", ["config", "user.email", "test@example.invalid"], { cwd: repoRoot, encoding: "utf8" })
  spawnSync("git", ["config", "user.name", "test"], { cwd: repoRoot, encoding: "utf8" })
  writeFileSync(join(repoRoot, "README.md"), "seed\n")
  spawnSync("git", ["add", "-A"], { cwd: repoRoot, encoding: "utf8" })
  spawnSync("git", ["commit", "-m", "seed"], { cwd: repoRoot, encoding: "utf8" })
  spawnSync("git", ["remote", "add", "origin", "https://github.com/acme/demo.git"], { cwd: repoRoot, encoding: "utf8" })
  spawnSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"], { cwd: repoRoot, encoding: "utf8" })
}

test("prepared import loads engine JSON and seeds project-scoped PRD artifacts", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-prepared-"))
  try {
    writeFileSync(
      join(dir, "concept.json"),
      JSON.stringify({ summary: "Prepared", problem: "Manual prep", users: ["operator"], constraints: ["local"] }),
    )
    writeFileSync(
      join(dir, "projects.json"),
      JSON.stringify([{ id: "P01", name: "Core", description: "Core project", concept: { summary: "Core", problem: "", users: [], constraints: [] } }]),
    )
    writeFileSync(
      join(dir, "P01.prd.json"),
      JSON.stringify({ prd: { stories: [{ id: "US-1", title: "Import", acceptanceCriteria: [] }] } }),
    )

    const bundle = loadPreparedImportBundle(dir, { title: "Item", description: "Desc" })
    assert.equal(bundle.projects[0]?.id, "P01")
    assert.equal(bundle.prdsByProjectId.P01?.stories.length, 1)

    const ctx = { workspaceId: "workspace", workspaceRoot: dir, runId: "run-1" }
    const seeded = seedPreparedImportArtifacts(ctx, bundle)
    assert.equal(seeded.projectStartStages.P01, "architecture")
    assert.ok(layout.stageArtifactsDir(ctx, "brainstorm"))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("prepared import derives a project from a skill pipeline PROJ folder without inventing PRDs", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-prepared-proj-"))
  const projectDir = join(dir, "PROJ-1-trendradar-demo")
  try {
    mkdirSync(join(projectDir, "1_brainstorm"), { recursive: true })
    mkdirSync(join(projectDir, "2_visual-companion"), { recursive: true })
    mkdirSync(join(projectDir, "5_mockups"), { recursive: true })
    writeFileSync(
      join(projectDir, "1_brainstorm", "PROJ-1-concept.md"),
      [
        "# PROJ-1: Trendradar Demo Frontend",
        "",
        "## Ziel und Scope",
        "Eine lokale Demo-Oberflaeche fuer Trendradar-Daten.",
        "",
        "## Nutzer und Nutzungsszenario",
        "- Demo-Operatoren nutzen die Seite in Stakeholder-Terminen.",
        "",
        "## Out of Scope",
        "- Login und Rechteverwaltung.",
      ].join("\n"),
    )
    writeFileSync(join(projectDir, "2_visual-companion", "layout-decision.md"), "# Layout")
    writeFileSync(join(projectDir, "5_mockups", "PROJ-1-PRD-1-overview.html"), "<main>Mockup</main>")

    const bundle = loadPreparedImportBundle(projectDir, { title: "Fallback", description: "Desc" })
    assert.equal(bundle.projects[0]?.id, "PROJ-1")
    assert.equal(bundle.projects[0]?.name, "Trendradar Demo Frontend")
    assert.equal(bundle.projects[0]?.hasUi, true)
    assert.equal(bundle.concept.hasUi, true)
    assert.equal(bundle.prdsByProjectId["PROJ-1"], undefined)

    const seeded = seedPreparedImportArtifacts({ workspaceId: "workspace", workspaceRoot: projectDir, runId: "run-3" }, bundle)
    assert.equal(seeded.projectStartStages["PROJ-1"], "requirements")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("prepared import preserves an explicit top-level backend-only signal from concept.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-prepared-backend-only-"))
  try {
    mkdirSync(join(dir, "5_mockups"), { recursive: true })
    writeFileSync(
      join(dir, "concept.json"),
      JSON.stringify({
        summary: "Prepared backend item",
        problem: "Skip design prep",
        users: ["operator"],
        constraints: ["local only"],
        hasUi: false,
      }),
    )
    writeFileSync(
      join(dir, "projects.json"),
      JSON.stringify([
        {
          id: "P01",
          name: "Core",
          description: "Core project",
          hasUi: true,
          concept: { summary: "Core", problem: "", users: [], constraints: [] },
        },
      ]),
    )
    writeFileSync(join(dir, "5_mockups", "P01-overview.html"), "<main>UI evidence that should not override concept.hasUi=false</main>")

    const bundle = loadPreparedImportBundle(dir, { title: "Item", description: "Desc" })

    assert.equal(bundle.concept.hasUi, false)
    assert.equal(bundle.projects[0]?.hasUi, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("prepared import does not synthesize a backend-only top-level signal when concept.hasUi is omitted", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-prepared-hasui-omitted-"))
  try {
    writeFileSync(
      join(dir, "concept.json"),
      JSON.stringify({
        summary: "Prepared backend item",
        problem: "Keep design prep when the top-level signal is missing",
        users: ["operator"],
        constraints: ["local only"],
      }),
    )
    writeFileSync(
      join(dir, "projects.json"),
      JSON.stringify([
        {
          id: "P01",
          name: "Core",
          description: "Core project",
          hasUi: false,
          concept: { summary: "Core", problem: "", users: [], constraints: [] },
        },
      ]),
    )

    const bundle = loadPreparedImportBundle(dir, { title: "Item", description: "Desc" })

    assert.equal(bundle.concept.hasUi, undefined)
    assert.equal(bundle.projects[0]?.hasUi, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("prepared import ignores malformed JSON and invalid PRD stories", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-prepared-malformed-"))
  try {
    writeFileSync(join(dir, "concept.json"), "{broken")
    writeFileSync(join(dir, "projects.json"), JSON.stringify({ id: "not-an-array" }))
    writeFileSync(join(dir, "concept.md"), "# PROJ-1: Markdown Fallback\n")
    writeFileSync(
      join(dir, "PROJ-1.prd.json"),
      JSON.stringify({
        prd: {
          stories: [
            { title: "Missing id", acceptanceCriteria: [] },
            { id: "US-1", title: "Valid story", acceptanceCriteria: [{ id: "AC-1", text: "Works" }] },
          ],
        },
      }),
    )
    writeFileSync(join(dir, "PROJ-2.prd.json"), JSON.stringify({ prd: { stories: [{ title: "Missing id" }] } }))

    const bundle = loadPreparedImportBundle(dir, { title: "Fallback", description: "Desc" })

    assert.equal(bundle.concept.summary, "Markdown Fallback")
    assert.equal(bundle.projects[0]?.id, "PROJ-1")
    assert.equal(bundle.prdsByProjectId["PROJ-1"]?.stories.length, 1)
    assert.equal(bundle.prdsByProjectId["PROJ-1"]?.stories[0]?.id, "US-1")
    assert.match(bundle.warnings.join("\n"), /concept\.json present but unparseable/)
    assert.match(bundle.warnings.join("\n"), /projects\.json present but not an array/)
    assert.match(bundle.warnings.join("\n"), /ignored PRD JSON \(no valid stories\): PROJ-2\.prd\.json/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("import context generation is reusable outside the prepared-import start flow", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-import-context-"))
  try {
    mkdirSync(join(dir, "1_brainstorm"), { recursive: true })
    mkdirSync(join(dir, "3_PRDs"), { recursive: true })
    writeFileSync(
      join(dir, "1_brainstorm", "PROJ-1-concept.md"),
      [
        "# PROJ-1: Shared Import Context",
        "",
        "## Summary",
        "Import context summary",
      ].join("\n"),
    )
    writeFileSync(
      join(dir, "3_PRDs", "PROJ-1-PRD-1-overview.md"),
      [
        "# Overview PRD",
        "",
        "### US-1: Review imported context",
        "- AC-1: Imported context is visible downstream.",
      ].join("\n"),
    )
    writeFileSync(join(dir, "notes.txt"), "omitted from downstream context\n")

    const generated = await generateImportContext(dir, { title: "Fallback", description: "Desc" })

    assert.equal(generated.bundle.projects[0]?.id, "PROJ-1")
    assert.equal(generated.importContext.status, "partial")
    assert.deepEqual(
      fileOutcomes(generated.importContext.files),
      [
        ["1_brainstorm/PROJ-1-concept.md", "visible"],
        ["3_PRDs/PROJ-1-PRD-1-overview.md", "visible"],
        ["notes.txt", "omitted"],
      ],
    )
    assert.deepEqual(generated.importContext.context.prdProjectIds, ["PROJ-1"])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("prepared import snapshots the original source folder into the run imports area", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-prepared-snapshot-"))
  const sourceDir = join(dir, "PROJ-1-demo")
  const workspaceRoot = join(dir, "workspace")
  const outsideSecret = join(dir, "outside-secret.txt")
  try {
    mkdirSync(join(sourceDir, "1_brainstorm"), { recursive: true })
    mkdirSync(workspaceRoot, { recursive: true })
    writeFileSync(join(sourceDir, "1_brainstorm", "PROJ-1-concept.md"), "# PROJ-1: Snapshot Demo\n")
    writeFileSync(join(sourceDir, "notes.txt"), "original context\n")
    writeFileSync(outsideSecret, "do not import\n")
    symlinkSync(outsideSecret, join(sourceDir, "linked-secret.txt"))

    const bundle = loadPreparedImportBundle(sourceDir, { title: "Fallback", description: "Desc" })
    const ctx = { workspaceId: "workspace", workspaceRoot, runId: "run-snapshot" }
    const seeded = seedPreparedImportArtifacts(ctx, bundle, { sourceDir })
    const snapshotDir = preparedImportSourceSnapshotDir(ctx)

    assert.equal(seeded.sourceSnapshotPath, snapshotDir)
    assert.equal(readFileSync(join(snapshotDir, "notes.txt"), "utf8"), "original context\n")
    assert.ok(existsSync(join(snapshotDir, "1_brainstorm", "PROJ-1-concept.md")))
    assert.equal(existsSync(join(snapshotDir, "linked-secret.txt")), false)
    assert.ok(existsSync(join(snapshotDir, ".beerengineer-import.json")))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("prepared import merges multiple PROJ PRD markdown files into one project PRD", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-prepared-proj-prds-"))
  const projectDir = join(dir, "PROJ-1-trendradar-demo")
  try {
    mkdirSync(join(projectDir, "1_brainstorm"), { recursive: true })
    mkdirSync(join(projectDir, "3_PRDs"), { recursive: true })
    writeFileSync(join(projectDir, "1_brainstorm", "PROJ-1-concept.md"), "# PROJ-1: Trendradar Demo Frontend")
    writeFileSync(
      join(projectDir, "3_PRDs", "PROJ-1-PRD-1-overview.md"),
      [
        "# Overview PRD",
        "",
        "### US-1: Uebersicht sehen",
        "- AC-1.1: Die Uebersicht ist sichtbar.",
        "",
        "## Edge Cases",
        "- Darf nicht an die Story-Beschreibung angehaengt werden.",
      ].join("\n"),
    )
    writeFileSync(
      join(projectDir, "3_PRDs", "PROJ-1-PRD-2-detail.md"),
      [
        "# Detail PRD",
        "",
        "### US-2: Detail sehen",
        "- AC-1: Das Detail ist sichtbar.",
      ].join("\n"),
    )

    const bundle = loadPreparedImportBundle(projectDir, { title: "Fallback", description: "Desc" })
    assert.equal(bundle.projects[0]?.id, "PROJ-1")
    assert.equal(bundle.prdsByProjectId["PROJ-1"]?.stories.length, 2)
    assert.equal(bundle.prdsByProjectId["PROJ-1"]?.stories[0]?.id, "PROJ-1-PRD-1-US-1")
    assert.equal(bundle.prdsByProjectId["PROJ-1"]?.stories[0]?.acceptanceCriteria[0]?.id, "AC-1.1")
    assert.doesNotMatch(bundle.prdsByProjectId["PROJ-1"]?.stories[0]?.description ?? "", /Edge Cases/)
    assert.equal(bundle.prdsByProjectId["PROJ-1"]?.stories[1]?.id, "PROJ-1-PRD-2-US-2")

    const seeded = seedPreparedImportArtifacts({ workspaceId: "workspace", workspaceRoot: projectDir, runId: "run-4" }, bundle)
    assert.equal(seeded.projectStartStages["PROJ-1"], "architecture")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("prepared import assigns deterministic suffixes to duplicate story ids", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-prepared-duplicates-"))
  try {
    mkdirSync(join(dir, "prds"), { recursive: true })
    writeFileSync(
      join(dir, "projects.json"),
      JSON.stringify([{ id: "P01", name: "Core", description: "Core project", concept: { summary: "Core", problem: "", users: [], constraints: [] } }]),
    )
    writeFileSync(join(dir, "concept.md"), "# P01\n")
    writeFileSync(join(dir, "P01.prd.json"), JSON.stringify({ prd: { stories: [{ id: "US-1", title: "Root", acceptanceCriteria: [] }] } }))
    writeFileSync(join(dir, "prds", "prd.json"), JSON.stringify({ prd: { stories: [{ id: "US-1", title: "Nested", acceptanceCriteria: [] }] } }))

    const bundle = loadPreparedImportBundle(dir, { title: "Fallback", description: "Desc" })

    assert.deepEqual(bundle.prdsByProjectId.P01?.stories.map(story => story.id), ["US-1", "US-1-2"])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("prepared import parses markdown PRDs and falls incomplete projects back to requirements", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-prepared-md-"))
  try {
    writeFileSync(
      join(dir, "concept.md"),
      [
        "# Concept",
        "",
        "## Summary",
        "Markdown concept",
        "",
        "## Problem",
        "Need a shortcut",
      ].join("\n"),
    )
    writeFileSync(
      join(dir, "projects.json"),
      JSON.stringify([
        { id: "P01", name: "Ready", description: "Ready", concept: { summary: "Ready", problem: "", users: [], constraints: [] } },
        { id: "P02", name: "Missing", description: "Missing", concept: { summary: "Missing", problem: "", users: [], constraints: [] } },
      ]),
    )
    writeFileSync(
      join(dir, "P01.md"),
      [
        "# PROJ-1-PRD-1: Import",
        "",
        "### US-1: Als Operator moechte ich Artefakte importieren",
        "**Acceptance Criteria:**",
        "- [ ] AC-1: Der Import startet die Architecture-Phase.",
      ].join("\n"),
    )

    const bundle = loadPreparedImportBundle(dir, { title: "Item", description: "Desc" })
    const ctx = { workspaceId: "workspace", workspaceRoot: dir, runId: "run-2" }
    const seeded = seedPreparedImportArtifacts(ctx, bundle)
    assert.equal(seeded.projectStartStages.P01, "architecture")
    assert.equal(seeded.projectStartStages.P02, "requirements")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("shared import-context artifact can be persisted into the run workspace", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-import-context-seed-"))
  const sourceDir = join(dir, "PROJ-1-demo")
  const workspaceRoot = join(dir, "workspace")
  try {
    mkdirSync(join(sourceDir, "1_brainstorm"), { recursive: true })
    mkdirSync(workspaceRoot, { recursive: true })
    writeFileSync(join(sourceDir, "1_brainstorm", "PROJ-1-concept.md"), "# PROJ-1: Snapshot Demo\n")
    writeFileSync(join(sourceDir, "notes.txt"), "original context\n")

    const generated = await generateImportContext(sourceDir, { title: "Fallback", description: "Desc" })
    const ctx = { workspaceId: "workspace", workspaceRoot, runId: "run-shared-import-context" }
    seedPreparedImportArtifacts(ctx, generated.bundle, { sourceDir })
    writeImportContextArtifact(ctx, generated.importContext)

    const artifactPath = importContextArtifactPath(ctx)
    const artifact: typeof generated.importContext = JSON.parse(readFileSync(artifactPath, "utf8"))

    assert.equal(artifact.status, "partial")
    assert.deepEqual(
      fileOutcomes(artifact.files),
      [
        ["1_brainstorm/PROJ-1-concept.md", "visible"],
        ["notes.txt", "omitted"],
      ],
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("prepared import persists the same import-context contract produced by the shared generator", async () => {
  const { dir, db, repos } = tempRepos("be2-import-context-run-")
  const repoRoot = join(dir, "repo")
  const sourceDir = join(dir, "prepared")
  seedGitRepo(repoRoot)
  try {
    mkdirSync(join(sourceDir, "1_brainstorm"), { recursive: true })
    mkdirSync(join(sourceDir, "3_PRDs"), { recursive: true })
    writeFileSync(join(sourceDir, "1_brainstorm", "PROJ-1-concept.md"), "# PROJ-1: Shared Context\n")
    writeFileSync(
      join(sourceDir, "3_PRDs", "PROJ-1-PRD-1-overview.md"),
      [
        "# Overview PRD",
        "",
        "### US-1: Review imported context",
        "- AC-1: Imported context is visible downstream.",
      ].join("\n"),
    )
    writeFileSync(join(sourceDir, "notes.txt"), "omitted from downstream context\n")

    const direct = await generateImportContext(sourceDir, { title: "Fallback", description: "Desc" })
    const workspace = repos.upsertWorkspace({ key: "local", name: "Local", rootPath: repoRoot })
    const io = makeIo()

    const prepared = await prepareForegroundPreparedImportRun(repos, io, {
      sourceDir,
      workspaceKey: workspace.key,
      owner: "cli",
      appConfig: appConfigFor(dir),
      workerLeaseScheduler: fakeScheduler(),
    })

    assert.equal(prepared.ok, true)
    if (!prepared.ok) return

    const item = repos.getItem(prepared.itemId)
    const run = repos.getRun(prepared.runId)
    assert.ok(item)
    assert.ok(run)
    if (!item || !run) return

    const ctx = resolveWorkflowContextForItemRun(repos, item, run)
    assert.ok(ctx)
    if (!ctx) return

    const persisted: typeof direct.importContext = JSON.parse(readFileSync(importContextArtifactPath(ctx), "utf8"))
    assert.deepEqual(persisted, direct.importContext)
    assert.deepEqual(
      repos.listArtifactsForRun(prepared.runId).map(artifact => ({ label: artifact.label, kind: artifact.kind, path: artifact.path })),
      [{ label: "Import Context", kind: "json", path: importContextArtifactPath(ctx) }],
    )
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("prepared import accepts degraded shared import-context results without blocking run setup", async () => {
  const { dir, db, repos } = tempRepos("be2-import-context-degraded-")
  const repoRoot = join(dir, "repo")
  const sourceDir = join(dir, "prepared")
  seedGitRepo(repoRoot)
  try {
    mkdirSync(join(sourceDir, "1_brainstorm"), { recursive: true })
    writeFileSync(join(sourceDir, "1_brainstorm", "PROJ-1-concept.md"), "# PROJ-1: Shared Context\n")
    writeFileSync(join(sourceDir, "notes.txt"), "omitted from downstream context\n")

    const workspace = repos.upsertWorkspace({ key: "local", name: "Local", rootPath: repoRoot })
    const io = makeIo()
    const fixtures: DegradedImportContextFixture[] = [
      {
        status: "partial",
        warnings: ["partial import-context fixture"],
        files: [
          { path: "1_brainstorm/PROJ-1-concept.md", outcome: "visible", reason: "concept_markdown" },
          { path: "notes.txt", outcome: "omitted", reason: "unsupported" },
        ],
      },
      {
        status: "unavailable",
        warnings: ["import-context generation unavailable: injected failure"],
        files: [],
      },
    ]

    for (const fixture of fixtures) {
      const prepared = await prepareForegroundPreparedImportRun(repos, io, {
        sourceDir,
        workspaceKey: workspace.key,
        owner: "cli",
        appConfig: appConfigFor(dir),
        workerLeaseScheduler: fakeScheduler(),
        importContextGenerator: async ({ sourceDir: preparedSourceDir, item }): Promise<GeneratedImportContext> => {
          const bundle = loadPreparedImportBundle(preparedSourceDir, item)
          return {
            bundle,
            importContext: {
              status: fixture.status,
              files: fixture.files,
              context: {
                conceptSummary: bundle.concept.summary,
                hasUi: bundle.concept.hasUi === true,
                projectIds: bundle.projects.map(project => project.id),
                prdProjectIds: Object.keys(bundle.prdsByProjectId).sort(),
              },
              warnings: fixture.warnings,
            },
          }
        },
      })

      assert.equal(prepared.ok, true)
      if (!prepared.ok) continue
      assert.deepEqual(prepared.warnings, fixture.warnings)

      const item = repos.getItem(prepared.itemId)
      const run = repos.getRun(prepared.runId)
      assert.ok(item)
      assert.ok(run)
      if (!item || !run) continue

      const ctx = resolveWorkflowContextForItemRun(repos, item, run)
      assert.ok(ctx)
      if (!ctx) continue

      const persisted: {
        status: string
        files: Array<{ path: string; outcome: string; reason: string }>
        warnings: string[]
      } = JSON.parse(readFileSync(importContextArtifactPath(ctx), "utf8"))
      assert.equal(persisted.status, fixture.status)
      assert.deepEqual(persisted.files, fixture.files)
      assert.deepEqual(persisted.warnings, fixture.warnings)
    }
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("prepared import records an explicit empty import-context outcome", async () => {
  const { dir, db, repos } = tempRepos("be2-import-context-empty-")
  const repoRoot = join(dir, "repo")
  const sourceDir = join(dir, "prepared")
  seedGitRepo(repoRoot)
  mkdirSync(sourceDir, { recursive: true })
  try {
    const workspace = repos.upsertWorkspace({ key: "local", name: "Local", rootPath: repoRoot })
    const io = makeIo()

    const prepared = await prepareForegroundPreparedImportRun(repos, io, {
      sourceDir,
      workspaceKey: workspace.key,
      owner: "cli",
      appConfig: appConfigFor(dir),
      workerLeaseScheduler: fakeScheduler(),
    })

    assert.equal(prepared.ok, true)
    if (!prepared.ok) return

    const item = repos.getItem(prepared.itemId)
    const run = repos.getRun(prepared.runId)
    assert.ok(item)
    assert.ok(run)
    if (!item || !run) return

    const ctx = resolveWorkflowContextForItemRun(repos, item, run)
    assert.ok(ctx)
    if (!ctx) return

    const persisted: { status: string; files: unknown[] } = JSON.parse(readFileSync(importContextArtifactPath(ctx), "utf8"))
    assert.equal(persisted.status, "empty")
    assert.deepEqual(persisted.files, [])
    assert.equal(repos.listArtifactsForRun(prepared.runId)[0]?.label, "Import Context")
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("repeated identical prepared imports persist identical semantic import-context output", async () => {
  const { dir, db, repos } = tempRepos("be2-import-context-repeat-")
  const repoRoot = join(dir, "repo")
  const sourceDir = join(dir, "prepared")
  seedGitRepo(repoRoot)
  try {
    mkdirSync(join(sourceDir, "1_brainstorm"), { recursive: true })
    mkdirSync(join(sourceDir, "3_PRDs"), { recursive: true })
    writeFileSync(join(sourceDir, "1_brainstorm", "PROJ-1-concept.md"), "# PROJ-1: Shared Context\n")
    writeFileSync(
      join(sourceDir, "3_PRDs", "PROJ-1-PRD-1-overview.md"),
      [
        "# Overview PRD",
        "",
        "### US-1: Review imported context",
        "- AC-1: Imported context is visible downstream.",
      ].join("\n"),
    )
    writeFileSync(join(sourceDir, "notes.txt"), "omitted from downstream context\n")

    const workspace = repos.upsertWorkspace({ key: "local", name: "Local", rootPath: repoRoot })
    const io = makeIo()
    const outputs: Array<unknown> = []

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const prepared = await prepareForegroundPreparedImportRun(repos, io, {
        sourceDir,
        workspaceKey: workspace.key,
        owner: "cli",
        appConfig: appConfigFor(dir),
        workerLeaseScheduler: fakeScheduler(),
      })
      assert.equal(prepared.ok, true)
      if (!prepared.ok) continue

      const item = repos.getItem(prepared.itemId)
      const run = repos.getRun(prepared.runId)
      assert.ok(item)
      assert.ok(run)
      if (!item || !run) continue

      const ctx = resolveWorkflowContextForItemRun(repos, item, run)
      assert.ok(ctx)
      if (!ctx) continue
      outputs.push(JSON.parse(readFileSync(importContextArtifactPath(ctx), "utf8")))
    }

    assert.equal(outputs.length, 2)
    assert.deepEqual(outputs[0], outputs[1])
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("prepared import injects import-context into downstream stage state", async () => {
  const { dir, db, repos } = tempRepos("be2-import-context-stage-")
  const repoRoot = join(dir, "repo")
  const sourceDir = join(dir, "prepared")
  seedGitRepo(repoRoot)
  try {
    mkdirSync(sourceDir, { recursive: true })
    writeFileSync(
      join(sourceDir, "concept.json"),
      JSON.stringify({ summary: "Prepared", problem: "Import", users: ["operator"], constraints: [] }),
    )
    writeFileSync(
      join(sourceDir, "projects.json"),
      JSON.stringify([{ id: "P01", name: "Core", description: "Core", concept: { summary: "Core", problem: "", users: [], constraints: [] } }]),
    )
    writeFileSync(
      join(sourceDir, "P01.prd.json"),
      JSON.stringify({ prd: { stories: [{ id: "US-1", title: "Import", acceptanceCriteria: [] }] } }),
    )
    writeFileSync(join(sourceDir, "notes.txt"), "omitted from downstream context\n")

    const direct = await generateImportContext(sourceDir, { title: "Fallback", description: "Desc" })
    const workspace = repos.upsertWorkspace({ key: "local", name: "Local", rootPath: repoRoot })
    const io = makeIo()

    const prepared = await prepareForegroundPreparedImportRun(repos, io, {
      sourceDir,
      workspaceKey: workspace.key,
      owner: "cli",
      appConfig: appConfigFor(dir),
      workerLeaseScheduler: fakeScheduler(),
    })

    assert.equal(prepared.ok, true)
    if (!prepared.ok) return
    assert.deepEqual(repos.listStageRunsForRun(prepared.runId).map(stageRun => stageRun.stage_key), [])

    const item = repos.getItem(prepared.itemId)
    const run = repos.getRun(prepared.runId)
    assert.ok(item)
    assert.ok(run)
    if (!item || !run) return

    const ctx = resolveWorkflowContextForItemRun(repos, item, run)
    assert.ok(ctx)
    if (!ctx) return

    const imported = await readImportContextArtifact(ctx)
    assert.ok(imported)
    if (!imported) return
    assert.deepEqual(imported, direct.importContext)
    const project = direct.bundle.projects[0]
    const prd = direct.bundle.prdsByProjectId.P01
    assert.ok(project)
    assert.ok(prd)
    if (!project || !prd) return
    repos.createProject({
      id: project.id,
      itemId: prepared.itemId,
      code: project.id,
      name: project.name,
      summary: project.description,
      position: 0,
    })
    const downstreamIo = makeIo()
    const detachDbSync = attachDbSync(downstreamIo.bus, repos, { runId: prepared.runId, itemId: prepared.itemId })
    try {
      await runWithWorkflowIO(downstreamIo, async () =>
        runWithActiveRun({ runId: prepared.runId, itemId: prepared.itemId, title: item.title }, async () =>
          withStageLifecycle("architecture", () =>
            architecture({
              ...ctx,
              project,
              prd,
              importContext: imported,
            }),
          { projectId: project.id })))
    } finally {
      detachDbSync()
    }

    const architectureRun: {
      state: { importContext?: unknown }
      status: string
    } = JSON.parse(readFileSync(layout.stageRunFile(ctx, "architecture"), "utf8"))
    assert.equal(architectureRun.status, "approved")
    assert.deepEqual(architectureRun.state.importContext, direct.importContext)
    assert.deepEqual(repos.listStageRunsForRun(prepared.runId).map(stageRun => stageRun.stage_key), ["architecture"])
    assert.ok(!existsSync(layout.stageRunFile(ctx, "import-context")), "import-context must not run as a separate stage")
    assert.ok(!existsSync(layout.stageArtifactsDir(ctx, "import-context")), "import-context must not create a stage artifact directory")
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("import-context artifacts distinguish full, partial, unavailable, and empty outcomes while degraded context stays non-blocking downstream", async () => {
  const { dir, db, repos } = tempRepos("be2-import-context-visibility-")
  const repoRoot = join(dir, "repo")
  seedGitRepo(repoRoot)
  try {
    const workspace = repos.upsertWorkspace({ key: "local", name: "Local", rootPath: repoRoot })
    const io = makeIo()
    const statuses = new Set<string>()

    const fixtures: Array<{
      name: string
      sourceDir: string
      importContextGenerator?: Parameters<typeof prepareForegroundPreparedImportRun>[2]["importContextGenerator"]
      runArchitecture: boolean
      expectedStatus: "full" | "partial" | "unavailable" | "empty"
      expectedWarnings: string[]
    }> = [
      {
        name: "full",
        sourceDir: join(dir, "prepared-full"),
        runArchitecture: true,
        expectedStatus: "full",
        expectedWarnings: [],
      },
      {
        name: "partial",
        sourceDir: join(dir, "prepared-partial"),
        runArchitecture: true,
        expectedStatus: "partial",
        expectedWarnings: ["partial import-context fixture"],
        importContextGenerator: async ({ sourceDir: preparedSourceDir, item }): Promise<GeneratedImportContext> => {
          const bundle = loadPreparedImportBundle(preparedSourceDir, item)
          return {
            bundle,
            importContext: {
              status: "partial",
              files: [
                { path: "P01.prd.json", outcome: "visible", reason: "prd_json" },
                { path: "concept.json", outcome: "visible", reason: "concept_json" },
                { path: "notes.txt", outcome: "omitted", reason: "unsupported" },
                { path: "projects.json", outcome: "visible", reason: "projects_json" },
              ],
              context: {
                conceptSummary: bundle.concept.summary,
                hasUi: bundle.concept.hasUi === true,
                projectIds: bundle.projects.map(project => project.id),
                prdProjectIds: Object.keys(bundle.prdsByProjectId).sort(),
              },
              warnings: ["partial import-context fixture"],
            },
          }
        },
      },
      {
        name: "unavailable",
        sourceDir: join(dir, "prepared-unavailable"),
        runArchitecture: true,
        expectedStatus: "unavailable",
        expectedWarnings: ["import-context generation unavailable: injected failure"],
        importContextGenerator: async ({ sourceDir: preparedSourceDir, item }): Promise<GeneratedImportContext> => {
          const bundle = loadPreparedImportBundle(preparedSourceDir, item)
          return {
            bundle,
            importContext: {
              status: "unavailable",
              files: [],
              context: {
                conceptSummary: bundle.concept.summary,
                hasUi: bundle.concept.hasUi === true,
                projectIds: bundle.projects.map(project => project.id),
                prdProjectIds: Object.keys(bundle.prdsByProjectId).sort(),
              },
              warnings: ["import-context generation unavailable: injected failure"],
            },
          }
        },
      },
      {
        name: "empty",
        sourceDir: join(dir, "prepared-empty"),
        runArchitecture: false,
        expectedStatus: "empty",
        expectedWarnings: [],
      },
    ]

    for (const fixture of fixtures) {
      mkdirSync(fixture.sourceDir, { recursive: true })
      if (fixture.expectedStatus !== "empty") {
        writeFileSync(
          join(fixture.sourceDir, "concept.json"),
          JSON.stringify({ summary: "Prepared", problem: "Import", users: ["operator"], constraints: [] }),
        )
        writeFileSync(
          join(fixture.sourceDir, "projects.json"),
          JSON.stringify([{ id: "P01", name: "Core", description: "Core", concept: { summary: "Core", problem: "", users: [], constraints: [] } }]),
        )
        writeFileSync(
          join(fixture.sourceDir, "P01.prd.json"),
          JSON.stringify({ prd: { stories: [{ id: "US-1", title: "Import", acceptanceCriteria: [] }] } }),
        )
      }
      if (fixture.expectedStatus === "partial") {
        writeFileSync(join(fixture.sourceDir, "notes.txt"), "omitted from downstream context\n")
      }

      const prepared = await prepareForegroundPreparedImportRun(repos, io, {
        sourceDir: fixture.sourceDir,
        workspaceKey: workspace.key,
        owner: "cli",
        appConfig: appConfigFor(dir),
        workerLeaseScheduler: fakeScheduler(),
        importContextGenerator: fixture.importContextGenerator,
      })

      assert.equal(prepared.ok, true)
      if (!prepared.ok) continue
      assert.deepEqual(prepared.warnings, fixture.expectedWarnings)

      const item = repos.getItem(prepared.itemId)
      const run = repos.getRun(prepared.runId)
      assert.ok(item)
      assert.ok(run)
      if (!item || !run) continue

      const ctx = resolveWorkflowContextForItemRun(repos, item, run)
      assert.ok(ctx)
      if (!ctx) continue

      const importArtifact = repos.listArtifactsForRun(prepared.runId).find(artifact => artifact.label === "Import Context")
      assert.ok(importArtifact)
      if (!importArtifact) continue

      const operatorArtifacts = buildRunArtifactReadModels(repos.listArtifactsForRun(prepared.runId))
      const operatorImportArtifact = operatorArtifacts.find(artifact => artifact.label === "Import Context")
      assert.equal(operatorImportArtifact?.metadata?.importContext?.status, fixture.expectedStatus)

      const persisted: {
        status: string
        warnings: string[]
      } = JSON.parse(readFileSync(importArtifact.path, "utf8"))
      assert.equal(persisted.status, fixture.expectedStatus)
      assert.deepEqual(persisted.warnings, fixture.expectedWarnings)
      statuses.add(persisted.status)

      const runTree = getRunTree(repos, prepared.runId)
      const runTreeImportArtifact = runTree?.artifacts.find(artifact => artifact.label === "Import Context")
      assert.equal(runTreeImportArtifact?.metadata?.importContext?.status, fixture.expectedStatus)

      if (!fixture.runArchitecture) continue

      const imported = await readImportContextArtifact(ctx)
      assert.ok(imported)
      if (!imported) continue

      const project = loadPreparedImportBundle(fixture.sourceDir, { title: item.title, description: item.description ?? "" }).projects[0]
      const prd = loadPreparedImportBundle(fixture.sourceDir, { title: item.title, description: item.description ?? "" }).prdsByProjectId.P01
      assert.ok(project)
      assert.ok(prd)
      if (!project || !prd) continue

      await architecture({
        ...ctx,
        project,
        prd,
        importContext: imported,
      })

      const architectureRun: {
        state: { importContext?: { status?: string } }
        status: string
      } = JSON.parse(readFileSync(layout.stageRunFile(ctx, "architecture"), "utf8"))
      assert.equal(architectureRun.status, "approved")
      assert.equal(architectureRun.state.importContext?.status, fixture.expectedStatus)
    }

    assert.deepEqual([...statuses].sort(), ["empty", "full", "partial", "unavailable"])
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
