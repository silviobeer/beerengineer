import { test } from "node:test"
import assert from "node:assert/strict"

import { renderDesignPreview } from "../src/render/designPreview.js"
import { renderWireframeFiles } from "../src/render/wireframes.js"
import type { DesignArtifact, WireframeArtifact } from "../src/types.js"

test("renderWireframeFiles emits screen map and per-screen html", () => {
  const artifact: WireframeArtifact = {
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
  const files = renderWireframeFiles(artifact)
  assert.equal(files.length, 2)
  assert.ok(files.some(file => file.fileName === "screen-map.html"))
  assert.ok(files.some(file => file.content.includes("Welcome")))
})

test("renderDesignPreview renders token sections", () => {
  const artifact: DesignArtifact = {
    inputMode: "none",
    tokens: {
      light: {
        primary: "#000",
        secondary: "#111",
        accent: "#222",
        background: "#fff",
        surface: "#f0f0f0",
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
    spacing: { baseUnit: "8px", sectionPadding: "32px", cardPadding: "20px", contentMaxWidth: "1200px" },
    borders: { buttons: "999px", cards: "20px", badges: "999px" },
    shadows: { sm: "0 1px 2px rgba(0,0,0,0.1)" },
    tone: "Sharp and calm.",
    antiPatterns: ["muddy contrast"],
  }
  const html = renderDesignPreview(artifact)
  assert.match(html, /Design Preview/)
  assert.match(html, /Fraunces/)
  assert.match(html, /#000/)
})

test("renderDesignPreview neutralizes hostile token values inside <style>", () => {
  const artifact: DesignArtifact = {
    inputMode: "none",
    tokens: {
      light: {
        primary: "#fff; }</style><script>alert('pwn')</script><style>",
        secondary: "javascript:alert(1)",
        accent: "url(evil)",
        background: "#fff; }</style><script>alert(2)</script>",
        surface: "#f0f0f0",
        textPrimary: "expression(alert(3))",
        textMuted: "#666",
        success: "#0a0",
        warning: "#aa0",
        error: "#a00",
        info: "#00a",
      },
    },
    typography: {
      display: { family: `"; } body { display:none; /*`, weight: "700", usage: "Display" },
      body: { family: "</style><script>", weight: "500", usage: "Body" },
      scale: { md: "1rem" },
    },
    spacing: { baseUnit: "8px", sectionPadding: "32px", cardPadding: "20px", contentMaxWidth: "1200px" },
    borders: { buttons: "999px", cards: "20px", badges: "999px" },
    shadows: { sm: "0 1px 2px rgba(0,0,0,0.1)" },
    tone: "Hostile test fixture",
    antiPatterns: ["injection"],
  }
  const html = renderDesignPreview(artifact)
  // Injected payload must not land as a real tag — the <style> block values
  // were validated and fell back to safe defaults, and body-level echoes were
  // HTML-escaped.
  assert.doesNotMatch(html, /<script>alert/i)
  // Exactly one </style> is expected: the closing tag of our own header block.
  assert.equal(html.match(/<\/style>/gi)?.length ?? 0, 1)
})
