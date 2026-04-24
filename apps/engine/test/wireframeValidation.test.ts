/**
 * Tests for wireframe artifact schema validation (Bug 1).
 *
 * Ensures that renderWireframeFiles / validateWireframeArtifact throws a
 * descriptive error when the LLM returns a partial artifact (e.g. missing
 * layout.regions), rather than crashing with an opaque TypeError from .map().
 */
import { test } from "node:test"
import assert from "node:assert/strict"

import { renderWireframeFiles, validateWireframeArtifact } from "../src/render/wireframes.js"
import type { WireframeArtifact } from "../src/types.js"

const validArtifact: WireframeArtifact = {
  inputMode: "none",
  screens: [
    {
      id: "home",
      name: "Home",
      purpose: "Overview",
      projectIds: ["P1"],
      layout: { kind: "single-column", regions: [{ id: "main", label: "Main" }] },
      elements: [{ id: "heading", region: "main", kind: "heading", label: "Welcome" }],
    },
  ],
  navigation: { entryPoints: [{ screenId: "home", projectId: "P1" }], flows: [] },
}

test("validateWireframeArtifact passes on a well-formed artifact", () => {
  assert.doesNotThrow(() => validateWireframeArtifact(validArtifact))
})

test("validateWireframeArtifact throws a descriptive error when layout is missing (LLM put regions at the top level)", () => {
  // Simulate the LLM structure from run.json: layout only has `kind`,
  // regions are erroneously at the screen top-level, not inside layout.
  const malformed = {
    inputMode: "none",
    screens: [
      {
        id: "board",
        name: "Workflow Board",
        purpose: "6-column board",
        projectIds: ["ui-board"],
        layout: { kind: "app-shell" }, // <-- no `regions` key inside layout
        regions: [                     // LLM put this at the wrong level
          { id: "header", role: "header", description: "Topbar" },
        ],
        elements: [
          { region: "header", kind: "control", label: "Workspace switcher" },
        ],
      },
    ],
    navigation: { entryPoints: [], flows: [] },
  } as unknown as WireframeArtifact

  let thrown: Error | undefined
  try {
    validateWireframeArtifact(malformed)
  } catch (e) {
    thrown = e as Error
  }
  assert.ok(thrown, "Expected validateWireframeArtifact to throw")
  assert.ok(
    thrown!.message.includes("layout.regions"),
    `Expected error to mention "layout.regions", got: ${thrown!.message}`,
  )
  assert.ok(
    thrown!.message.includes("LLM"),
    `Expected error to mention "LLM", got: ${thrown!.message}`,
  )
  // Must not be a generic TypeError from .map()
  assert.ok(
    !thrown!.message.includes("Cannot read properties"),
    `Error must not be a generic TypeError, got: ${thrown!.message}`,
  )
})

test("validateWireframeArtifact throws a descriptive error when layout.regions is missing entirely", () => {
  const malformed = {
    inputMode: "none",
    screens: [
      {
        id: "s1",
        name: "S1",
        purpose: "test",
        projectIds: ["P1"],
        layout: { kind: "single-column" }, // missing regions
        elements: [],
      },
    ],
    navigation: { entryPoints: [], flows: [] },
  } as unknown as WireframeArtifact

  let thrown: Error | undefined
  try {
    validateWireframeArtifact(malformed)
  } catch (e) {
    thrown = e as Error
  }
  assert.ok(thrown, "Expected validateWireframeArtifact to throw")
  assert.match(thrown!.message, /layout\.regions/)
  assert.match(thrown!.message, /screens\[0\]/)
  assert.match(thrown!.message, /id="s1"/)
})

test("validateWireframeArtifact throws a descriptive error when elements is missing", () => {
  const malformed = {
    inputMode: "none",
    screens: [
      {
        id: "s1",
        name: "S1",
        purpose: "test",
        projectIds: ["P1"],
        layout: { kind: "single-column", regions: [{ id: "main", label: "Main" }] },
        // missing elements
      },
    ],
    navigation: { entryPoints: [], flows: [] },
  } as unknown as WireframeArtifact

  let thrown: Error | undefined
  try {
    validateWireframeArtifact(malformed)
  } catch (e) {
    thrown = e as Error
  }
  assert.ok(thrown, "Expected validateWireframeArtifact to throw")
  assert.match(thrown!.message, /elements/)
  assert.match(thrown!.message, /screens\[0\]/)
})

test("validateWireframeArtifact throws when screens is not an array", () => {
  const malformed = {
    inputMode: "none",
    screens: null,
    navigation: { entryPoints: [], flows: [] },
  } as unknown as WireframeArtifact

  let thrown: Error | undefined
  try {
    validateWireframeArtifact(malformed)
  } catch (e) {
    thrown = e as Error
  }
  assert.ok(thrown, "Expected validateWireframeArtifact to throw")
  assert.match(thrown!.message, /screens/)
})

test("renderWireframeFiles throws a descriptive error (not TypeError) on partial LLM artifact", () => {
  const partial = {
    inputMode: "none",
    screens: [
      {
        id: "board",
        name: "Board",
        purpose: "Board screen",
        projectIds: ["ui-board"],
        layout: { kind: "app-shell" }, // no regions
        elements: [],
      },
    ],
    navigation: { entryPoints: [], flows: [] },
  } as unknown as WireframeArtifact

  let thrown: Error | undefined
  try {
    renderWireframeFiles(partial)
  } catch (e) {
    thrown = e as Error
  }
  assert.ok(thrown, "Expected renderWireframeFiles to throw")
  assert.ok(
    !thrown!.message.includes("Cannot read properties of undefined"),
    `Should not get a raw TypeError, got: ${thrown!.message}`,
  )
  assert.match(thrown!.message, /LLM/)
  assert.match(thrown!.message, /layout\.regions/)
})
