import type { ColorPalette, DesignArtifact } from "../types/domain.js"

/**
 * Validate that a DesignArtifact has the shape the renderer needs.
 * Throws a descriptive Error (not a TypeError) when the LLM returned a
 * malformed artifact so callers get an actionable message instead of an
 * opaque `Cannot read properties of undefined (reading 'scale')` crash.
 *
 * Covers every field that `renderDesignPreview` touches:
 *   - artifact.tone (string)
 *   - artifact.antiPatterns (array)
 *   - artifact.tokens.light (ColorPalette object)
 *   - artifact.typography (object)
 *   - artifact.typography.scale (object — not undefined/null)
 *   - artifact.typography.display.family / .weight (strings)
 *   - artifact.typography.body.family / .weight (strings)
 *   - artifact.spacing.baseUnit / .sectionPadding / .cardPadding / .contentMaxWidth (strings)
 *   - artifact.borders.buttons / .cards / .badges (strings)
 *   - artifact.shadows (object — not undefined/null)
 */
export function validateDesignArtifact(artifact: DesignArtifact): void {
  // tone
  if (typeof artifact.tone !== "string" || artifact.tone.length === 0) {
    throw new Error(
      "Invalid design artifact from LLM: artifact.tone is missing or not a string. " +
      "The LLM response may have been truncated or returned a malformed structure.",
    )
  }

  // antiPatterns
  if (!Array.isArray(artifact.antiPatterns)) {
    throw new Error(
      "Invalid design artifact from LLM: artifact.antiPatterns is not an array. " +
      "Every design artifact must include an antiPatterns array — retry or inspect the LLM output.",
    )
  }

  // tokens.light
  if (!artifact.tokens || typeof artifact.tokens !== "object") {
    throw new Error(
      "Invalid design artifact from LLM: artifact.tokens is missing. " +
      "The LLM must return tokens.light and optional tokens.dark — retry or inspect the LLM output.",
    )
  }
  if (!artifact.tokens.light || typeof artifact.tokens.light !== "object") {
    throw new Error(
      "Invalid design artifact from LLM: artifact.tokens.light is missing. " +
      "Every design artifact must include a light-mode token palette — retry or inspect the LLM output.",
    )
  }

  // typography
  if (!artifact.typography || typeof artifact.typography !== "object") {
    throw new Error(
      "Invalid design artifact from LLM: artifact.typography is missing. " +
      "Every design artifact must include a typography object — retry or inspect the LLM output.",
    )
  }
  if (!artifact.typography.scale || typeof artifact.typography.scale !== "object") {
    throw new Error(
      "Invalid design artifact from LLM: artifact.typography.scale is missing or not an object. " +
      "typography.scale must be a Record<string, string> mapping token names to size values " +
      "— retry or inspect the LLM output.",
    )
  }
  if (!artifact.typography.display || typeof artifact.typography.display !== "object") {
    throw new Error(
      "Invalid design artifact from LLM: artifact.typography.display is missing. " +
      "Every design artifact must include typography.display with family and weight — retry or inspect the LLM output.",
    )
  }
  if (typeof artifact.typography.display.family !== "string" || artifact.typography.display.family.length === 0) {
    throw new Error(
      "Invalid design artifact from LLM: artifact.typography.display.family is missing or not a string. " +
      "Every design artifact must have a non-empty display font family — retry or inspect the LLM output.",
    )
  }
  if (typeof artifact.typography.display.weight !== "string" || artifact.typography.display.weight.length === 0) {
    throw new Error(
      "Invalid design artifact from LLM: artifact.typography.display.weight is missing or not a string. " +
      "Every design artifact must have a non-empty display font weight — retry or inspect the LLM output.",
    )
  }
  if (!artifact.typography.body || typeof artifact.typography.body !== "object") {
    throw new Error(
      "Invalid design artifact from LLM: artifact.typography.body is missing. " +
      "Every design artifact must include typography.body with family and weight — retry or inspect the LLM output.",
    )
  }
  if (typeof artifact.typography.body.family !== "string" || artifact.typography.body.family.length === 0) {
    throw new Error(
      "Invalid design artifact from LLM: artifact.typography.body.family is missing or not a string. " +
      "Every design artifact must have a non-empty body font family — retry or inspect the LLM output.",
    )
  }
  if (typeof artifact.typography.body.weight !== "string" || artifact.typography.body.weight.length === 0) {
    throw new Error(
      "Invalid design artifact from LLM: artifact.typography.body.weight is missing or not a string. " +
      "Every design artifact must have a non-empty body font weight — retry or inspect the LLM output.",
    )
  }

  // spacing
  if (!artifact.spacing || typeof artifact.spacing !== "object") {
    throw new Error(
      "Invalid design artifact from LLM: artifact.spacing is missing. " +
      "Every design artifact must include spacing tokens — retry or inspect the LLM output.",
    )
  }
  for (const field of ["baseUnit", "sectionPadding", "cardPadding", "contentMaxWidth"] as const) {
    if (typeof artifact.spacing[field] !== "string" || artifact.spacing[field].length === 0) {
      throw new Error(
        `Invalid design artifact from LLM: artifact.spacing.${field} is missing or not a string. ` +
        "Every design artifact must have all spacing token fields — retry or inspect the LLM output.",
      )
    }
  }

  // borders
  if (!artifact.borders || typeof artifact.borders !== "object") {
    throw new Error(
      "Invalid design artifact from LLM: artifact.borders is missing. " +
      "Every design artifact must include borders tokens — retry or inspect the LLM output.",
    )
  }
  for (const field of ["buttons", "cards", "badges"] as const) {
    if (typeof artifact.borders[field] !== "string" || artifact.borders[field].length === 0) {
      throw new Error(
        `Invalid design artifact from LLM: artifact.borders.${field} is missing or not a string. ` +
        "Every design artifact must have all border token fields — retry or inspect the LLM output.",
      )
    }
  }

  // shadows
  if (!artifact.shadows || typeof artifact.shadows !== "object") {
    throw new Error(
      "Invalid design artifact from LLM: artifact.shadows is missing or not an object. " +
      "Every design artifact must include a shadows Record<string, string> — retry or inspect the LLM output.",
    )
  }

  // mockupHtmlPerScreen — optional but if present must be valid
  if (artifact.mockupHtmlPerScreen !== undefined) {
    if (typeof artifact.mockupHtmlPerScreen !== "object" || Array.isArray(artifact.mockupHtmlPerScreen)) {
      throw new Error(
        "Invalid design artifact from LLM: artifact.mockupHtmlPerScreen is present but not an object. " +
        "It must be a Record<string, string> mapping screenId to a full HTML document — retry or inspect the LLM output.",
      )
    }
    for (const [screenId, html] of Object.entries(artifact.mockupHtmlPerScreen)) {
      if (typeof html !== "string" || html.trim().length === 0) {
        throw new Error(
          `Invalid design artifact from LLM: mockupHtmlPerScreen["${screenId}"] is empty or not a string. ` +
          "Each entry must be a non-empty HTML document — retry or inspect the LLM output.",
        )
      }
      const trimmed = html.trimStart().toLowerCase()
      if (!trimmed.startsWith("<!doctype") && !trimmed.startsWith("<html")) {
        throw new Error(
          `Invalid design artifact from LLM: mockupHtmlPerScreen["${screenId}"] does not start with <!doctype or <html. ` +
          "Each entry must be a self-contained HTML document — retry or inspect the LLM output.",
        )
      }
    }
  }
}

function escapeHtml(value: string): string {
  if (typeof value !== "string") {
    throw new Error(
      `escapeHtml received a non-string value: ${JSON.stringify(value)}. ` +
      "Call validateDesignArtifact before rendering to catch missing string fields.",
    )
  }
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
// Border-radius values: "0", "0px", "4px", "8px", "12px", "9999px", "50%", etc.
const BORDER_RADIUS_PATTERN = /^[0-9]+(%|px|rem|em)?$/

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
  // Validate before touching any fields — gives a descriptive Error instead of
  // a raw TypeError when the LLM returns a partial artifact (e.g. missing
  // typography.scale). Live crash: run d17a5503-9809-477f-90e5-baa412dad854.
  validateDesignArtifact(artifact)

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
  // Use artifact border tokens — never hardcode fallback radius values that conflict with the
  // design language. "0px" is an intentional zero-radius design; "4px" is a conservative default
  // for the preview chrome only (not for the actual app components).
  const panelRadius = safeCssValue(artifact.borders.cards, BORDER_RADIUS_PATTERN, "4px")
  const chipRadius = safeCssValue(artifact.borders.badges, BORDER_RADIUS_PATTERN, "4px")

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Design Preview</title>
    <style>
      body { font-family: sans-serif; background: ${bg}; color: ${fg}; padding: 24px; }
      .panel { background: ${surface}; border: 1px solid #d7d7d7; padding: 16px; margin-bottom: 16px; border-radius: ${panelRadius}; }
      .swatches { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
      .swatch { display: flex; gap: 12px; align-items: center; }
      .chip { width: 48px; height: 48px; border-radius: ${chipRadius}; border: 1px solid #999; }
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

export const __testing = { safeCssValue, COLOR_PATTERN, FONT_FAMILY_PATTERN, FONT_WEIGHT_PATTERN, BORDER_RADIUS_PATTERN }
