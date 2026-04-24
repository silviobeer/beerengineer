import type { ColorPalette, DesignArtifact } from "../types/domain.js"

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function renderPalette(title: string, palette: ColorPalette): string {
  const rows = Object.entries(palette).map(([name, value]) => `
    <div class="swatch">
      <div class="chip" style="background:${escapeHtml(value)}"></div>
      <div><strong>${escapeHtml(name)}</strong><br />${escapeHtml(value)}</div>
    </div>
  `).join("")
  return `<section><h2>${escapeHtml(title)}</h2><div class="swatches">${rows}</div></section>`
}

export function renderDesignPreview(artifact: DesignArtifact): string {
  const scale = Object.entries(artifact.typography.scale)
    .map(([name, value]) => `<li>${escapeHtml(name)}: ${escapeHtml(value)}</li>`)
    .join("")
  const shadows = Object.entries(artifact.shadows)
    .map(([name, value]) => `<li>${escapeHtml(name)}: ${escapeHtml(value)}</li>`)
    .join("")

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Design Preview</title>
    <style>
      body { font-family: sans-serif; background: ${artifact.tokens.light.background}; color: ${artifact.tokens.light.textPrimary}; padding: 24px; }
      .panel { background: ${artifact.tokens.light.surface}; border: 1px solid #d7d7d7; padding: 16px; margin-bottom: 16px; border-radius: 12px; }
      .swatches { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
      .swatch { display: flex; gap: 12px; align-items: center; }
      .chip { width: 48px; height: 48px; border-radius: 12px; border: 1px solid #999; }
      .sample-display { font-family: ${artifact.typography.display.family}; font-weight: ${artifact.typography.display.weight}; font-size: 2rem; }
      .sample-body { font-family: ${artifact.typography.body.family}; font-weight: ${artifact.typography.body.weight}; }
      ul { padding-left: 20px; }
    </style>
  </head>
  <body>
    <div class="panel">
      <h1>Design Preview</h1>
      <p>${escapeHtml(artifact.tone)}</p>
      <p>Avoid: ${escapeHtml(artifact.antiPatterns.join("; "))}</p>
    </div>
    <div class="panel">${renderPalette("Light palette", artifact.tokens.light)}</div>
    ${artifact.tokens.dark ? `<div class="panel">${renderPalette("Dark palette", artifact.tokens.dark)}</div>` : ""}
    <div class="panel">
      <h2>Typography</h2>
      <p class="sample-display">Display sample</p>
      <p class="sample-body">Body sample using ${escapeHtml(artifact.typography.body.family)}</p>
      <ul>${scale}</ul>
    </div>
    <div class="panel">
      <h2>Spacing and surfaces</h2>
      <p>Base unit: ${escapeHtml(artifact.spacing.baseUnit)}</p>
      <p>Section padding: ${escapeHtml(artifact.spacing.sectionPadding)}</p>
      <p>Card padding: ${escapeHtml(artifact.spacing.cardPadding)}</p>
      <p>Content max width: ${escapeHtml(artifact.spacing.contentMaxWidth)}</p>
      <p>Buttons: ${escapeHtml(artifact.borders.buttons)}</p>
      <p>Cards: ${escapeHtml(artifact.borders.cards)}</p>
      <p>Badges: ${escapeHtml(artifact.borders.badges)}</p>
      <ul>${shadows}</ul>
    </div>
  </body>
</html>`
}
