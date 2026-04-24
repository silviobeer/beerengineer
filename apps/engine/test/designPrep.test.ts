import { test } from "node:test"
import assert from "node:assert/strict"

import { mergeAmendments, projectDesign, projectWireframes } from "../src/core/designPrep.js"
import type { DesignArtifact, WireframeArtifact } from "../src/types.js"

const wireframes: WireframeArtifact = {
  inputMode: "none",
  screens: [
    {
      id: "screen-a",
      name: "A",
      purpose: "Project A screen",
      projectIds: ["P1"],
      layout: { kind: "single-column", regions: [{ id: "main", label: "Main" }] },
      elements: [{ id: "el-a", region: "main", kind: "card", label: "A card" }],
    },
    {
      id: "screen-b",
      name: "B",
      purpose: "Shared screen",
      projectIds: ["P1", "P2"],
      layout: { kind: "sidebar-main", regions: [{ id: "main", label: "Main" }, { id: "sidebar", label: "Sidebar" }] },
      elements: [{ id: "el-b", region: "main", kind: "list", label: "B list" }],
    },
  ],
  navigation: {
    entryPoints: [
      { screenId: "screen-a", projectId: "P1" },
      { screenId: "screen-b", projectId: "P2" },
    ],
    flows: [
      { id: "flow-a", from: "screen-a", to: "screen-b", trigger: "Next", projectIds: ["P1"] },
      { id: "flow-b", from: "screen-b", to: "screen-a", trigger: "Back", projectIds: ["P2"] },
    ],
  },
  conceptAmendments: [
    { type: "scope_addition", projectId: "P1", description: "Add export action" },
    { type: "scope_change", description: "Clarify empty state" },
  ],
}

const design: DesignArtifact = {
  inputMode: "none",
  tokens: {
    light: {
      primary: "#000",
      secondary: "#111",
      accent: "#222",
      background: "#fff",
      surface: "#f7f7f7",
      textPrimary: "#111",
      textMuted: "#666",
      success: "#0a0",
      warning: "#aa0",
      error: "#a00",
      info: "#00a",
    },
  },
  typography: {
    display: { family: "Fraunces", weight: "700", usage: "Display" },
    body: { family: "Manrope", weight: "500", usage: "Body" },
    scale: { md: "1rem" },
  },
  spacing: { baseUnit: "8px", sectionPadding: "32px", cardPadding: "16px", contentMaxWidth: "1200px" },
  borders: { buttons: "999px", cards: "16px", badges: "999px" },
  shadows: { sm: "0 1px 2px rgba(0,0,0,0.1)" },
  tone: "Calm and practical.",
  antiPatterns: ["generic defaults"],
}

test("projectWireframes filters screens, navigation, and amendments without mutation", () => {
  const original = structuredClone(wireframes)
  const scoped = projectWireframes(wireframes, "P1")
  assert.deepEqual(scoped.screens.map(screen => screen.id), ["screen-a", "screen-b"])
  assert.deepEqual(scoped.navigation.entryPoints, [{ screenId: "screen-a", projectId: "P1" }])
  assert.deepEqual(scoped.navigation.flows.map(flow => flow.id), ["flow-a"])
  assert.deepEqual(scoped.conceptAmendments?.map(amendment => amendment.description), ["Add export action", "Clarify empty state"])
  assert.deepEqual(wireframes, original)
})

test("projectDesign is pass-through", () => {
  assert.equal(projectDesign(design), design)
})

test("mergeAmendments enriches concept for item-wide and project-scoped amendments", () => {
  const concept = {
    summary: "Base",
    problem: "Problem",
    users: ["User"],
    constraints: ["Existing"],
  }
  const merged = mergeAmendments(concept, wireframes.conceptAmendments, "P1")
  assert.match(merged.summary, /Design prep amendments/)
  assert.ok(merged.constraints.includes("Add export action"))
  assert.ok(merged.constraints.includes("Clarify empty state"))
})
