import type { Screen, WireframeArtifact } from "../types/domain.js"

function escapeHtml(value: string): string {
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
  return [
    { fileName: "screen-map.html", label: "Wireframe Screen Map", content: renderScreenMap(artifact) },
    ...artifact.screens.map(screen => ({
      fileName: `${screen.id}.html`,
      label: `Wireframe ${screen.name}`,
      content: renderScreen(screen),
    })),
  ]
}

