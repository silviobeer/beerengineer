import type { ColorPalette, DesignArtifact } from "../types/domain.js"

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

// Values landing inside <style> are attacker-controlled (LLM output). Match
// each token against a conservative whitelist; fall back to a safe placeholder
// rather than interpolating raw text that could close the style tag.
const COLOR_PATTERN = /^(#[0-9a-f]{3,8}|rgba?\([0-9.,\s%]+\)|hsla?\([0-9.,\s%]+\)|transparent|currentColor|[a-z]+)$/i
const FONT_FAMILY_PATTERN = /^[A-Za-z0-9 ,'"\-]+$/
const FONT_WEIGHT_PATTERN = /^(normal|bold|lighter|bolder|[1-9]00)$/

function safeCssValue(raw: string | undefined, pattern: RegExp, fallback: string): string {
  if (typeof raw !== "string") return fallback
  const trimmed = raw.trim()
  return pattern.test(trimmed) ? trimmed : fallback
}

function renderPalette(title: string, palette: ColorPalette): string {
  const rows = Object.entries(palette).map(([name, value]) => {
    const chipColor = safeCssValue(value, COLOR_PATTERN, "#cccccc")
    return `
    <div class="swatch">
      <div class="chip" style="background:${chipColor}"></div>
      <div><strong>${escapeHtml(name)}</strong><br />${escapeHtml(value)}</div>
    </div>
  `
  }).join("")
  return `<section><h2>${escapeHtml(title)}</h2><div class="swatches">${rows}</div></section>`
}

export function renderDesignPreview(artifact: DesignArtifact): string {
  const scale = Object.entries(artifact.typography.scale)
    .map(([name, value]) => `<li>${escapeHtml(name)}: ${escapeHtml(value)}</li>`)
    .join("")
  const shadows = Object.entries(artifact.shadows)
    .map(([name, value]) => `<li>${escapeHtml(name)}: ${escapeHtml(value)}</li>`)
    .join("")

  const bg = safeCssValue(artifact.tokens.light.background, COLOR_PATTERN, "#ffffff")
  const fg = safeCssValue(artifact.tokens.light.textPrimary, COLOR_PATTERN, "#111111")
  const surface = safeCssValue(artifact.tokens.light.surface, COLOR_PATTERN, "#f7f7f7")
  const displayFamily = safeCssValue(artifact.typography.display.family, FONT_FAMILY_PATTERN, "sans-serif")
  const displayWeight = safeCssValue(artifact.typography.display.weight, FONT_WEIGHT_PATTERN, "700")
  const bodyFamily = safeCssValue(artifact.typography.body.family, FONT_FAMILY_PATTERN, "sans-serif")
  const bodyWeight = safeCssValue(artifact.typography.body.weight, FONT_WEIGHT_PATTERN, "normal")

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Design Preview</title>
    <style>
      body { font-family: sans-serif; background: ${bg}; color: ${fg}; padding: 24px; }
      .panel { background: ${surface}; border: 1px solid #d7d7d7; padding: 16px; margin-bottom: 16px; border-radius: 12px; }
      .swatches { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
      .swatch { display: flex; gap: 12px; align-items: center; }
      .chip { width: 48px; height: 48px; border-radius: 12px; border: 1px solid #999; }
      .sample-display { font-family: ${displayFamily}; font-weight: ${displayWeight}; font-size: 2rem; }
      .sample-body { font-family: ${bodyFamily}; font-weight: ${bodyWeight}; }
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

export const __testing = { safeCssValue, COLOR_PATTERN, FONT_FAMILY_PATTERN, FONT_WEIGHT_PATTERN }
