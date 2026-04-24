import type { Screen, WireframeArtifact } from "../types/domain.js"

/**
 * Validate that every screen in a WireframeArtifact has the shape the renderer
 * needs: `layout.regions` must be a non-null array, `elements` must be a
 * non-null array, and every string field consumed by `escapeHtml` must be a
 * non-empty string. Throws a descriptive Error (not a TypeError) if the LLM
 * returned a malformed artifact so callers get an actionable message instead of
 * an opaque `Cannot read properties of undefined (reading 'replaceAll')` crash.
 */
export function validateWireframeArtifact(artifact: WireframeArtifact): void {
  if (!Array.isArray(artifact.screens)) {
    throw new Error(
      "Invalid wireframe artifact from LLM: artifact.screens is not an array. " +
      "The LLM response may have been truncated or returned a malformed structure."
    )
  }
  for (let i = 0; i < artifact.screens.length; i++) {
    const screen = artifact.screens[i]
    if (!screen || typeof screen !== "object") {
      throw new Error(
        `Invalid wireframe artifact from LLM: screens[${i}] is not an object.`
      )
    }

    // Required string fields on the screen itself
    if (typeof screen.name !== "string" || screen.name.length === 0) {
      throw new Error(
        `Invalid wireframe artifact from LLM: screens[${i}] (id="${screen.id ?? "?"}") ` +
        `is missing required string field "name". ` +
        "Every screen must have a non-empty string name — retry or inspect the LLM output."
      )
    }
    if (typeof screen.purpose !== "string" || screen.purpose.length === 0) {
      throw new Error(
        `Invalid wireframe artifact from LLM: screens[${i}] (id="${screen.id ?? "?"}") ` +
        `is missing required string field "purpose". ` +
        "Every screen must have a non-empty string purpose — retry or inspect the LLM output."
      )
    }

    if (!screen.layout || !Array.isArray(screen.layout.regions)) {
      throw new Error(
        `Invalid wireframe artifact from LLM: screens[${i}] (id="${screen.id ?? "?"}") ` +
        `is missing layout.regions array. ` +
        `Got layout=${JSON.stringify(screen.layout)}. ` +
        "The LLM must return each screen with a layout.regions array — retry or inspect the LLM output."
      )
    }

    // Required string fields on each region
    for (let r = 0; r < screen.layout.regions.length; r++) {
      const region = screen.layout.regions[r]
      if (!region || typeof region !== "object") {
        throw new Error(
          `Invalid wireframe artifact from LLM: screens[${i}].layout.regions[${r}] is not an object.`
        )
      }
      if (typeof region.label !== "string" || region.label.length === 0) {
        throw new Error(
          `Invalid wireframe artifact from LLM: screens[${i}] (id="${screen.id ?? "?"}") ` +
          `layout.regions[${r}] (id="${region.id ?? "?"}") is missing required string field "label". ` +
          "Every region must have a non-empty string label — retry or inspect the LLM output."
        )
      }
    }

    if (!Array.isArray(screen.elements)) {
      throw new Error(
        `Invalid wireframe artifact from LLM: screens[${i}] (id="${screen.id ?? "?"}") ` +
        `is missing elements array. ` +
        "The LLM must return each screen with an elements array — retry or inspect the LLM output."
      )
    }

    // Required string fields on each element
    for (let e = 0; e < screen.elements.length; e++) {
      const element = screen.elements[e]
      if (!element || typeof element !== "object") {
        throw new Error(
          `Invalid wireframe artifact from LLM: screens[${i}].elements[${e}] is not an object.`
        )
      }
      if (typeof element.kind !== "string" || element.kind.length === 0) {
        throw new Error(
          `Invalid wireframe artifact from LLM: screens[${i}] (id="${screen.id ?? "?"}") ` +
          `elements[${e}] (id="${element.id ?? "?"}") is missing required string field "kind". ` +
          "Every element must have a non-empty string kind — retry or inspect the LLM output."
        )
      }
      if (typeof element.label !== "string" || element.label.length === 0) {
        throw new Error(
          `Invalid wireframe artifact from LLM: screens[${i}] (id="${screen.id ?? "?"}") ` +
          `elements[${e}] (id="${element.id ?? "?"}") is missing required string field "label". ` +
          "Every element must have a non-empty string label — retry or inspect the LLM output."
        )
      }
      // element.placeholder is optional — only validate if present
      if (
        "placeholder" in element &&
        element.placeholder !== undefined &&
        typeof element.placeholder !== "string"
      ) {
        throw new Error(
          `Invalid wireframe artifact from LLM: screens[${i}] (id="${screen.id ?? "?"}") ` +
          `elements[${e}] (id="${element.id ?? "?"}") has a "placeholder" field that is not a string. ` +
          "When present, placeholder must be a string — retry or inspect the LLM output."
        )
      }
    }
  }
}

function escapeHtml(value: string): string {
  if (typeof value !== "string") {
    throw new Error(
      `escapeHtml received a non-string value: ${JSON.stringify(value)}. ` +
      "Call validateWireframeArtifact before rendering to catch missing string fields."
    )
  }
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function renderElement(kind: string, label: string, placeholder?: string): string {
  const detail = placeholder ? ` <span class="muted">${escapeHtml(placeholder)}</span>` : ""
  return `<div class="element"><span class="badge">${escapeHtml(kind)}</span> ${escapeHtml(label)}${detail}</div>`
}

function renderScreen(screen: Screen): string {
  const regions = screen.layout.regions.map(region => {
    const elements = screen.elements
      .filter(element => element.region === region.id)
      .map(element => renderElement(element.kind, element.label, element.placeholder))
      .join("")
    return `<section class="region"><header>${escapeHtml(region.label)}</header>${elements}</section>`
  }).join("")

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(screen.name)}</title>
    <style>
      body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #f5f5f5; color: #111; padding: 24px; }
      .shell { max-width: 1000px; margin: 0 auto; }
      .meta, .region, .element { border: 2px dashed #8a8a8a; background: #fff; }
      .meta { padding: 16px; margin-bottom: 16px; }
      .layout { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
      .region { padding: 12px; min-height: 180px; }
      .region header { margin-bottom: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
      .element { padding: 10px; margin-bottom: 8px; background: #fafafa; }
      .badge { display: inline-block; min-width: 96px; }
      .muted { color: #666; }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="meta">
        <h1>${escapeHtml(screen.name)}</h1>
        <p>${escapeHtml(screen.purpose)}</p>
        <p>Projects: ${escapeHtml(screen.projectIds.join(", "))}</p>
        <p>Layout: ${escapeHtml(screen.layout.kind)}</p>
      </div>
      <div class="layout">${regions}</div>
    </div>
  </body>
</html>`
}

export function renderScreenMap(artifact: WireframeArtifact): string {
  const screens = artifact.screens.map(screen => {
    const flows = artifact.navigation.flows
      .filter(flow => flow.from === screen.id)
      .map(flow => `<li>${escapeHtml(flow.trigger)} -> ${escapeHtml(flow.to)}</li>`)
      .join("")
    return `<article class="screen">
      <h2>${escapeHtml(screen.name)}</h2>
      <p>${escapeHtml(screen.purpose)}</p>
      <p><strong>Projects:</strong> ${escapeHtml(screen.projectIds.join(", "))}</p>
      <ul>${flows || "<li>No outgoing flows</li>"}</ul>
    </article>`
  }).join("")

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Wireframe Screen Map</title>
    <style>
      body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #f3f3f3; color: #111; padding: 24px; }
      .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
      .screen { border: 2px dashed #7b7b7b; background: #fff; padding: 16px; }
      .meta { margin-bottom: 16px; }
    </style>
  </head>
  <body>
    <div class="meta">
      <h1>Screen Map</h1>
      <p>Input mode: ${escapeHtml(artifact.inputMode)}</p>
      <p>Screens: ${artifact.screens.length}</p>
    </div>
    <div class="grid">${screens}</div>
  </body>
</html>`
}

export function renderWireframeFiles(artifact: WireframeArtifact): Array<{ fileName: string; label: string; content: string }> {
  validateWireframeArtifact(artifact)
  return [
    { fileName: "screen-map.html", label: "Wireframe Screen Map", content: renderScreenMap(artifact) },
    ...artifact.screens.map(screen => ({
      fileName: `${screen.id}.html`,
      label: `Wireframe ${screen.name}`,
      content: renderScreen(screen),
    })),
  ]
}

