import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadPreparedImportBundle, preparedImportSourceSnapshotDir, seedPreparedImportArtifacts } from "../src/core/preparedImport.js"
import { layout } from "../src/core/workspaceLayout.js"

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

test("prepared import snapshots the original source folder into the run imports area", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-prepared-snapshot-"))
  const sourceDir = join(dir, "PROJ-1-demo")
  const workspaceRoot = join(dir, "workspace")
  try {
    mkdirSync(join(sourceDir, "1_brainstorm"), { recursive: true })
    mkdirSync(workspaceRoot, { recursive: true })
    writeFileSync(join(sourceDir, "1_brainstorm", "PROJ-1-concept.md"), "# PROJ-1: Snapshot Demo\n")
    writeFileSync(join(sourceDir, "notes.txt"), "original context\n")

    const bundle = loadPreparedImportBundle(sourceDir, { title: "Fallback", description: "Desc" })
    const ctx = { workspaceId: "workspace", workspaceRoot, runId: "run-snapshot" }
    const seeded = seedPreparedImportArtifacts(ctx, bundle, { sourceDir })
    const snapshotDir = preparedImportSourceSnapshotDir(ctx)

    assert.equal(seeded.sourceSnapshotPath, snapshotDir)
    assert.equal(readFileSync(join(snapshotDir, "notes.txt"), "utf8"), "original context\n")
    assert.ok(existsSync(join(snapshotDir, "1_brainstorm", "PROJ-1-concept.md")))
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
