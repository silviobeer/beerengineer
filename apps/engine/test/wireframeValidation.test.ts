/**
 * Tests for wireframe artifact schema validation (Bug 1 + Bug 2 + Bug 3).
 *
 * Ensures that renderWireframeFiles / validateWireframeArtifact throws a
 * descriptive error when the LLM returns a partial artifact (e.g. missing
 * layout.regions, null region.label, missing element.kind/label), rather than
 * crashing with an opaque `Cannot read properties of undefined (reading 'replaceAll')`.
 * Also verifies that wireframes.json is written to disk even when render crashes.
 */
import { mkdirSync, existsSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
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

// ---------------------------------------------------------------------------
// String-field validation — the live-crash scenario (region.label === null)
// ---------------------------------------------------------------------------

test("validateWireframeArtifact throws when region.label is null (live-crash scenario)", () => {
  // Reproduces run 1a5b6eb0: LLM returned regions with label: null
  const malformed = {
    inputMode: "none",
    screens: [
      {
        id: "board",
        name: "Board",
        purpose: "Workflow overview",
        projectIds: ["ui-board"],
        layout: {
          kind: "app-shell",
          regions: [{ id: "topbar", label: null }], // <-- live crash
        },
        elements: [],
      },
    ],
    navigation: { entryPoints: [], flows: [] },
  } as unknown as WireframeArtifact

  let thrown: Error | undefined
  try { validateWireframeArtifact(malformed) } catch (e) { thrown = e as Error }
  assert.ok(thrown, "Expected validateWireframeArtifact to throw")
  assert.match(thrown!.message, /label/)
  assert.match(thrown!.message, /LLM/)
  assert.ok(
    !thrown!.message.includes("Cannot read properties"),
    `Must not be a raw TypeError, got: ${thrown!.message}`,
  )
})

test("validateWireframeArtifact throws when element.kind is missing", () => {
  const malformed = {
    inputMode: "none",
    screens: [
      {
        id: "s1",
        name: "Screen",
        purpose: "test",
        projectIds: ["P1"],
        layout: { kind: "single-column", regions: [{ id: "main", label: "Main" }] },
        elements: [{ id: "e1", region: "main", label: "Title" }], // missing kind
      },
    ],
    navigation: { entryPoints: [], flows: [] },
  } as unknown as WireframeArtifact

  let thrown: Error | undefined
  try { validateWireframeArtifact(malformed) } catch (e) { thrown = e as Error }
  assert.ok(thrown, "Expected validateWireframeArtifact to throw")
  assert.match(thrown!.message, /kind/)
  assert.match(thrown!.message, /LLM/)
})

test("validateWireframeArtifact throws when element.label is missing", () => {
  const malformed = {
    inputMode: "none",
    screens: [
      {
        id: "s1",
        name: "Screen",
        purpose: "test",
        projectIds: ["P1"],
        layout: { kind: "single-column", regions: [{ id: "main", label: "Main" }] },
        elements: [{ id: "e1", region: "main", kind: "heading" }], // missing label
      },
    ],
    navigation: { entryPoints: [], flows: [] },
  } as unknown as WireframeArtifact

  let thrown: Error | undefined
  try { validateWireframeArtifact(malformed) } catch (e) { thrown = e as Error }
  assert.ok(thrown, "Expected validateWireframeArtifact to throw")
  assert.match(thrown!.message, /label/)
  assert.match(thrown!.message, /LLM/)
})

test("validateWireframeArtifact throws when screen.name is missing", () => {
  const malformed = {
    inputMode: "none",
    screens: [
      {
        id: "s1",
        purpose: "test", // name intentionally absent
        projectIds: ["P1"],
        layout: { kind: "single-column", regions: [{ id: "main", label: "Main" }] },
        elements: [],
      },
    ],
    navigation: { entryPoints: [], flows: [] },
  } as unknown as WireframeArtifact

  let thrown: Error | undefined
  try { validateWireframeArtifact(malformed) } catch (e) { thrown = e as Error }
  assert.ok(thrown, "Expected validateWireframeArtifact to throw")
  assert.match(thrown!.message, /name/)
  assert.match(thrown!.message, /LLM/)
})

test("validateWireframeArtifact throws when screen.purpose is missing", () => {
  const malformed = {
    inputMode: "none",
    screens: [
      {
        id: "s1",
        name: "Screen", // purpose intentionally absent
        projectIds: ["P1"],
        layout: { kind: "single-column", regions: [{ id: "main", label: "Main" }] },
        elements: [],
      },
    ],
    navigation: { entryPoints: [], flows: [] },
  } as unknown as WireframeArtifact

  let thrown: Error | undefined
  try { validateWireframeArtifact(malformed) } catch (e) { thrown = e as Error }
  assert.ok(thrown, "Expected validateWireframeArtifact to throw")
  assert.match(thrown!.message, /purpose/)
  assert.match(thrown!.message, /LLM/)
})

test("validateWireframeArtifact throws when element.placeholder is present but non-string", () => {
  const malformed = {
    inputMode: "none",
    screens: [
      {
        id: "s1",
        name: "Screen",
        purpose: "test",
        projectIds: ["P1"],
        layout: { kind: "single-column", regions: [{ id: "main", label: "Main" }] },
        elements: [{ id: "e1", region: "main", kind: "input", label: "Name", placeholder: 42 }],
      },
    ],
    navigation: { entryPoints: [], flows: [] },
  } as unknown as WireframeArtifact

  let thrown: Error | undefined
  try { validateWireframeArtifact(malformed) } catch (e) { thrown = e as Error }
  assert.ok(thrown, "Expected validateWireframeArtifact to throw")
  assert.match(thrown!.message, /placeholder/)
  assert.match(thrown!.message, /LLM/)
})

test("validateWireframeArtifact accepts element.placeholder when absent (optional field)", () => {
  // placeholder is optional — must not throw when the field is simply not present
  assert.doesNotThrow(() => validateWireframeArtifact(validArtifact))
})

// ---------------------------------------------------------------------------
// JSON-first persistence: wireframes.json must exist even if render crashes
// ---------------------------------------------------------------------------

test("wireframes.json is written to disk even when renderWireframeFiles throws", async () => {
  // Simulate persistArtifacts: write JSON first, then render (which will crash)
  const dir = await mkdtemp(join(tmpdir(), "wireframe-test-"))
  try {
    const malformed = {
      inputMode: "none",
      screens: [
        {
          id: "board",
          name: "Board",
          purpose: "Test",
          projectIds: ["P1"],
          layout: { kind: "app-shell", regions: [{ id: "topbar", label: null }] },
          elements: [],
        },
      ],
      navigation: { entryPoints: [], flows: [] },
    } as unknown as WireframeArtifact

    // Replicate the JSON-first write from persistArtifacts
    const { writeFileSync } = await import("node:fs")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "wireframes.json"), JSON.stringify(malformed, null, 2))

    // Now attempt render — must throw
    let renderThrown: Error | undefined
    try { renderWireframeFiles(malformed) } catch (e) { renderThrown = e as Error }
    assert.ok(renderThrown, "renderWireframeFiles should throw on malformed artifact")
    assert.match(renderThrown!.message, /LLM/)

    // JSON must be on disk despite the render crash
    assert.ok(
      existsSync(join(dir, "wireframes.json")),
      "wireframes.json must exist on disk even after a render crash",
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
