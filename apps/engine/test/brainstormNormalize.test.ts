/**
 * Tests for brainstorm artifact normalization.
 *
 * The real LLM sometimes serialises `constraints` and `users` as a single
 * string rather than an array. This was the root cause of the fb199f59 crash:
 *   "[runService:startRunForItem:start_implementation] concept.constraints is not iterable"
 *
 * These tests verify that normalizeBrainstormArtifact coerces all four shapes
 * (string[], string, null/undefined, non-string[]) to string[] before the
 * artifact is persisted.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { coerceToStringArray, normalizeBrainstormArtifact } from "../src/stages/brainstorm/types.js"
import type { BrainstormArtifact } from "../src/stages/brainstorm/types.js"

// ---------------------------------------------------------------------------
// coerceToStringArray unit tests
// ---------------------------------------------------------------------------

test("coerceToStringArray: string[] passes through unchanged", () => {
  const input = ["Hard boundary: no cross-app imports", "Must run on Node 20"]
  assert.deepStrictEqual(coerceToStringArray(input), input)
})

test("coerceToStringArray: single string with newlines splits into multiple items", () => {
  const input = "Hard boundary: apps/ui imports nothing from apps/engine\nMust run on Node 20\n- Budget: 2 sprints"
  const result = coerceToStringArray(input)
  assert.strictEqual(result.length, 3)
  assert.strictEqual(result[0], "Hard boundary: apps/ui imports nothing from apps/engine")
  assert.strictEqual(result[1], "Must run on Node 20")
  assert.strictEqual(result[2], "Budget: 2 sprints") // bullet stripped
})

test("coerceToStringArray: single string without newlines wraps as one-element array", () => {
  const input = "Hard boundary: apps/ui imports nothing from apps/engine"
  assert.deepStrictEqual(coerceToStringArray(input), [input])
})

test("coerceToStringArray: null returns empty array", () => {
  assert.deepStrictEqual(coerceToStringArray(null), [])
})

test("coerceToStringArray: undefined returns empty array", () => {
  assert.deepStrictEqual(coerceToStringArray(undefined), [])
})

test("coerceToStringArray: non-string array elements are stringified", () => {
  assert.deepStrictEqual(coerceToStringArray([1, true, null]), ["1", "true", ""])
})

// ---------------------------------------------------------------------------
// normalizeBrainstormArtifact: real-LLM single-string crash scenario
// (run fb199f59 repro)
// ---------------------------------------------------------------------------

function makeMalformedArtifact(): BrainstormArtifact {
  // Cast via unknown to simulate raw LLM JSON where the field is a string.
  return {
    concept: {
      summary: "beerengineer_ UI rebuild",
      problem: "The existing UI is broken and needs a full rebuild.",
      users: "Frontend developers; end users of the product" as unknown as string[],
      constraints: "Hard boundary: apps/ui imports nothing from apps/engine; Must run on Node 20" as unknown as string[],
      hasUi: true,
    },
    projects: [
      {
        id: "P01",
        name: "UI Rebuild",
        description: "Full UI rebuild",
        hasUi: true,
        concept: {
          summary: "beerengineer_ UI rebuild",
          problem: "The existing UI is broken.",
          users: "Frontend developers" as unknown as string[],
          constraints: "Hard boundary: apps/ui imports nothing from apps/engine" as unknown as string[],
        },
      },
    ],
  }
}

test("normalizeBrainstormArtifact: coerces string constraints to string[] on concept and projects", () => {
  const raw = makeMalformedArtifact()
  const normalized = normalizeBrainstormArtifact(raw)

  // Top-level concept
  assert.ok(Array.isArray(normalized.concept.constraints), "concept.constraints must be an array")
  assert.ok(normalized.concept.constraints.length > 0, "concept.constraints must be non-empty")
  normalized.concept.constraints.forEach(c => assert.strictEqual(typeof c, "string"))

  assert.ok(Array.isArray(normalized.concept.users), "concept.users must be an array")
  normalized.concept.users.forEach(u => assert.strictEqual(typeof u, "string"))

  // Per-project concept
  normalized.projects.forEach((p, i) => {
    assert.ok(Array.isArray(p.concept.constraints), `projects[${i}].concept.constraints must be an array`)
    assert.ok(Array.isArray(p.concept.users), `projects[${i}].concept.users must be an array`)
  })
})

test("normalizeBrainstormArtifact: spread on constraints does not throw after normalization", () => {
  const raw = makeMalformedArtifact()
  const normalized = normalizeBrainstormArtifact(raw)

  // This is the operation that crashed in run fb199f59.
  assert.doesNotThrow(() => {
    const merged = [...normalized.concept.constraints, "extra"]
    assert.ok(merged.length > 0)
  })
})

test("normalizeBrainstormArtifact: already-valid artifact passes through untouched", () => {
  const valid: BrainstormArtifact = {
    concept: {
      summary: "s",
      problem: "p",
      users: ["Brewers", "End users"],
      constraints: ["No cross-app imports", "Node 20"],
      hasUi: false,
    },
    projects: [
      {
        id: "P01",
        name: "Core",
        description: "d",
        hasUi: false,
        concept: {
          summary: "s",
          problem: "p",
          users: ["Brewers"],
          constraints: ["No cross-app imports"],
        },
      },
    ],
  }
  const normalized = normalizeBrainstormArtifact(valid)
  assert.deepStrictEqual(normalized.concept.users, valid.concept.users)
  assert.deepStrictEqual(normalized.concept.constraints, valid.concept.constraints)
  assert.deepStrictEqual(normalized.projects[0].concept.constraints, valid.projects[0].concept.constraints)
})

test("normalizeBrainstormArtifact: project concept returned as a bare string is reshaped, not character-spread", () => {
  // Reproduces the codex-first run failure: project.concept came back as a
  // single string. Spreading it via `{...c}` produced `{0:"A", 1:" ", ...,
  // users:[], constraints:[]}`, which broke downstream consumers expecting
  // a real Concept object.
  const raw = {
    concept: { summary: "x", problem: "p", users: [], constraints: [] },
    projects: [
      {
        id: "P01",
        name: "Demo",
        description: "d",
        hasUi: true,
        concept: "A narrowly scoped internal demo." as unknown as BrainstormArtifact["projects"][number]["concept"],
      },
    ],
  } as unknown as BrainstormArtifact
  const normalized = normalizeBrainstormArtifact(raw)
  assert.strictEqual(normalized.projects[0].concept.summary, "A narrowly scoped internal demo.")
  assert.deepStrictEqual(normalized.projects[0].concept.users, [])
  assert.deepStrictEqual(normalized.projects[0].concept.constraints, [])
  for (const key of Object.keys(normalized.projects[0].concept)) {
    assert.ok(Number.isNaN(Number(key)), `unexpected numeric key in concept: ${key}`)
  }
})
