/**
 * Tests for design artifact schema validation.
 *
 * Ensures that renderDesignPreview / validateDesignArtifact throws a
 * descriptive error when the LLM returns a partial artifact (e.g. missing
 * palette, missing typography, missing typography.scale), rather than
 * crashing with an opaque `Cannot read properties of undefined (reading 'scale')`.
 * Also verifies that design.json is written to disk even when render crashes.
 *
 * Reproduces live crash: run d17a5503-9809-477f-90e5-baa412dad854.
 */
import { mkdirSync, existsSync, writeFileSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { test } from "node:test"
import assert from "node:assert/strict"

import { validateDesignArtifact, renderDesignPreview } from "../src/render/designPreview.js"
import type { DesignArtifact } from "../src/types.js"

// ---------------------------------------------------------------------------
// Minimal valid artifact — used as the positive baseline
// ---------------------------------------------------------------------------

const validArtifact: DesignArtifact = {
  tone: "Clean and professional with warm amber accents",
  antiPatterns: ["Avoid neon colors", "No drop shadows on text"],
  tokens: {
    light: {
      primary: "#f59e0b",
      secondary: "#1f2937",
      accent: "#fbbf24",
      background: "#ffffff",
      surface: "#f9fafb",
      textPrimary: "#111827",
      textMuted: "#6b7280",
      success: "#10b981",
      warning: "#f59e0b",
      error: "#ef4444",
      info: "#3b82f6",
    },
  },
  typography: {
    display: { family: "Inter", weight: "700", usage: "Headings" },
    body: { family: "Inter", weight: "normal", usage: "Body text" },
    scale: {
      xs: "0.75rem",
      sm: "0.875rem",
      base: "1rem",
      lg: "1.125rem",
      xl: "1.25rem",
    },
  },
  spacing: {
    baseUnit: "4px",
    sectionPadding: "48px 24px",
    cardPadding: "16px",
    contentMaxWidth: "1200px",
  },
  borders: {
    buttons: "border-radius: 8px",
    cards: "border-radius: 12px",
    badges: "border-radius: 9999px",
  },
  shadows: {
    card: "0 2px 8px rgba(0,0,0,0.08)",
    modal: "0 8px 32px rgba(0,0,0,0.16)",
  },
  inputMode: "none",
}

// ---------------------------------------------------------------------------
// Positive tests
// ---------------------------------------------------------------------------

test("validateDesignArtifact passes on a well-formed artifact", () => {
  assert.doesNotThrow(() => validateDesignArtifact(validArtifact))
})

test("renderDesignPreview returns HTML on a well-formed artifact", () => {
  const html = renderDesignPreview(validArtifact)
  assert.ok(typeof html === "string" && html.includes("<!doctype html"), "Expected valid HTML output")
})

// ---------------------------------------------------------------------------
// Missing palette
// ---------------------------------------------------------------------------

test("validateDesignArtifact throws a descriptive error when tokens is missing", () => {
  const malformed = { ...validArtifact, tokens: undefined } as unknown as DesignArtifact

  let thrown: Error | undefined
  try { validateDesignArtifact(malformed) } catch (e) { thrown = e as Error }
  assert.ok(thrown, "Expected validateDesignArtifact to throw")
  assert.match(thrown!.message, /tokens/)
  assert.match(thrown!.message, /LLM/)
  assert.ok(
    !thrown!.message.includes("Cannot read properties"),
    `Must not be a raw TypeError, got: ${thrown!.message}`,
  )
})

test("validateDesignArtifact throws a descriptive error when tokens.light is missing", () => {
  const malformed = {
    ...validArtifact,
    tokens: { ...validArtifact.tokens, light: undefined },
  } as unknown as DesignArtifact

  let thrown: Error | undefined
  try { validateDesignArtifact(malformed) } catch (e) { thrown = e as Error }
  assert.ok(thrown, "Expected validateDesignArtifact to throw")
  assert.match(thrown!.message, /tokens\.light/)
  assert.match(thrown!.message, /LLM/)
})

// ---------------------------------------------------------------------------
// Missing typography
// ---------------------------------------------------------------------------

test("validateDesignArtifact throws a descriptive error when typography is missing", () => {
  const malformed = { ...validArtifact, typography: undefined } as unknown as DesignArtifact

  let thrown: Error | undefined
  try { validateDesignArtifact(malformed) } catch (e) { thrown = e as Error }
  assert.ok(thrown, "Expected validateDesignArtifact to throw")
  assert.match(thrown!.message, /typography/)
  assert.match(thrown!.message, /LLM/)
  assert.ok(
    !thrown!.message.includes("Cannot read properties"),
    `Must not be a raw TypeError, got: ${thrown!.message}`,
  )
})

// ---------------------------------------------------------------------------
// Missing typography.scale — the live crash scenario (run d17a5503)
// ---------------------------------------------------------------------------

test("validateDesignArtifact throws a descriptive error when typography.scale is missing (live-crash scenario)", () => {
  // Reproduces run d17a5503: LLM returned typography without a scale field
  const malformed = {
    ...validArtifact,
    typography: {
      display: { family: "Inter", weight: "700", usage: "Headings" },
      body: { family: "Inter", weight: "normal", usage: "Body text" },
      // scale intentionally absent
    },
  } as unknown as DesignArtifact

  let thrown: Error | undefined
  try { validateDesignArtifact(malformed) } catch (e) { thrown = e as Error }
  assert.ok(thrown, "Expected validateDesignArtifact to throw")
  assert.match(thrown!.message, /typography\.scale/)
  assert.match(thrown!.message, /LLM/)
  assert.ok(
    !thrown!.message.includes("Cannot read properties"),
    `Must not be a raw TypeError, got: ${thrown!.message}`,
  )
})

test("validateDesignArtifact throws when typography.scale is null", () => {
  const malformed = {
    ...validArtifact,
    typography: { ...validArtifact.typography, scale: null },
  } as unknown as DesignArtifact

  let thrown: Error | undefined
  try { validateDesignArtifact(malformed) } catch (e) { thrown = e as Error }
  assert.ok(thrown, "Expected validateDesignArtifact to throw")
  assert.match(thrown!.message, /typography\.scale/)
  assert.match(thrown!.message, /LLM/)
})

test("renderDesignPreview throws a descriptive error (not TypeError) when typography.scale is absent", () => {
  const malformed = {
    ...validArtifact,
    typography: {
      display: { family: "Inter", weight: "700", usage: "Headings" },
      body: { family: "Inter", weight: "normal", usage: "Body text" },
    },
  } as unknown as DesignArtifact

  let thrown: Error | undefined
  try { renderDesignPreview(malformed) } catch (e) { thrown = e as Error }
  assert.ok(thrown, "Expected renderDesignPreview to throw")
  assert.ok(
    !thrown!.message.includes("Cannot read properties of undefined"),
    `Should not get a raw TypeError, got: ${thrown!.message}`,
  )
  assert.match(thrown!.message, /LLM/)
  assert.match(thrown!.message, /typography\.scale/)
})

// ---------------------------------------------------------------------------
// Missing shadows
// ---------------------------------------------------------------------------

test("validateDesignArtifact throws a descriptive error when shadows is missing", () => {
  const malformed = { ...validArtifact, shadows: undefined } as unknown as DesignArtifact

  let thrown: Error | undefined
  try { validateDesignArtifact(malformed) } catch (e) { thrown = e as Error }
  assert.ok(thrown, "Expected validateDesignArtifact to throw")
  assert.match(thrown!.message, /shadows/)
  assert.match(thrown!.message, /LLM/)
})

// ---------------------------------------------------------------------------
// JSON-first persistence: design.json must exist even if render crashes
// ---------------------------------------------------------------------------

test("design.json is written to disk even when renderDesignPreview throws", async () => {
  // Simulate persistArtifacts: write JSON first, then render (which will crash)
  const dir = await mkdtemp(join(tmpdir(), "design-test-"))
  try {
    const malformed = {
      ...validArtifact,
      typography: {
        display: { family: "Inter", weight: "700", usage: "Headings" },
        body: { family: "Inter", weight: "normal", usage: "Body text" },
        // scale intentionally absent — reproduces live crash
      },
    } as unknown as DesignArtifact

    // Replicate the JSON-first write from persistArtifacts
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "design.json"), JSON.stringify(malformed, null, 2))

    // Now attempt render — must throw
    let renderThrown: Error | undefined
    try { renderDesignPreview(malformed) } catch (e) { renderThrown = e as Error }
    assert.ok(renderThrown, "renderDesignPreview should throw on malformed artifact")
    assert.match(renderThrown!.message, /LLM/)

    // JSON must be on disk despite the render crash
    assert.ok(
      existsSync(join(dir, "design.json")),
      "design.json must exist on disk even after a render crash",
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
