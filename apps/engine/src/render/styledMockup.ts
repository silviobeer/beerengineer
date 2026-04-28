import type { DesignArtifact, Screen } from "../types/domain.js"
import { validateDesignArtifact } from "./designPreview.js"

// ── CSS-value safety guards (same conservative approach as designPreview.ts) ──

const COLOR_PATTERN = /^(#[0-9a-f]{3,8}|rgba?\([0-9.,\s%]+\)|hsla?\([0-9.,\s%]+\)|transparent|currentColor|[a-z]+)$/i
const FONT_FAMILY_PATTERN = /^[A-Za-z0-9 ,'"\-]+$/
const FONT_WEIGHT_PATTERN = /^(normal|bold|lighter|bolder|[1-9]00)$/
const BORDER_RADIUS_PATTERN = /^[0-9]+(%|px|rem|em)?$/
const SIZE_PATTERN = /^[0-9]+(%|px|rem|em|vw|vh)?$/
const SHADOW_PATTERN = /^[0-9a-z#(),.\s%]+$/i

function safe(raw: string | undefined, pattern: RegExp, fallback: string): string {
  if (typeof raw !== "string") return fallback
  const t = raw.trim()
  return pattern.test(t) ? t : fallback
}

function escapeHtml(value: string): string {
  if (typeof value !== "string") return ""
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

// ── Element renderers ─────────────────────────────────────────────────────────

function renderHeading(label: string): string {
  return `<h2 class="styled-heading">${escapeHtml(label)}</h2>`
}

function renderButton(label: string): string {
  return `<button class="styled-btn">${escapeHtml(label)}</button>`
}

function renderCard(label: string, placeholder?: string): string {
  const inner = placeholder ? `<p class="card-body">${escapeHtml(placeholder)}</p>` : ""
  return `<div class="styled-card"><div class="card-label">${escapeHtml(label)}</div>${inner}</div>`
}

function renderChip(label: string): string {
  return `<span class="styled-chip">${escapeHtml(label)}</span>`
}

function renderInput(label: string, placeholder?: string): string {
  const ph = placeholder ?? `[ ${label} ]`
  return `<div class="styled-input-wrap"><label class="input-label">${escapeHtml(label)}</label><input class="styled-input" type="text" placeholder="${escapeHtml(ph)}" disabled /></div>`
}

function renderList(label: string): string {
  return `<ul class="styled-list"><li class="list-item">[ ${escapeHtml(label)} item 1 ]</li><li class="list-item">[ ${escapeHtml(label)} item 2 ]</li></ul>`
}

function renderTable(label: string): string {
  return `<table class="styled-table"><caption>${escapeHtml(label)}</caption><thead><tr><th>Col A</th><th>Col B</th><th>Col C</th></tr></thead><tbody><tr><td>—</td><td>—</td><td>—</td></tr></tbody></table>`
}

function renderUnknownElement(kind: string, label: string, placeholder?: string): string {
  const detail = placeholder ? ` <span class="element-placeholder">${escapeHtml(placeholder)}</span>` : ""
  return `<div class="styled-element"><span class="element-kind">${escapeHtml(kind)}</span> ${escapeHtml(label)}${detail}</div>`
}

function renderElement(kind: string, label: string, placeholder?: string): string {
  switch (kind) {
    case "heading": return renderHeading(label)
    case "button": return renderButton(label)
    case "card": return renderCard(label, placeholder)
    case "chip": return renderChip(label)
    case "input": return renderInput(label, placeholder)
    case "list": return renderList(label)
    case "table": return renderTable(label)
    default: return renderUnknownElement(kind, label, placeholder)
  }
}

// ── CSS variable injection ────────────────────────────────────────────────────

function buildCssVars(design: DesignArtifact): string {
  const l = design.tokens.light
  const vars: string[] = [
    `  --color-primary: ${safe(l.primary, COLOR_PATTERN, "#0f766e")};`,
    `  --color-secondary: ${safe(l.secondary, COLOR_PATTERN, "#155e75")};`,
    `  --color-accent: ${safe(l.accent, COLOR_PATTERN, "#f59e0b")};`,
    `  --color-background: ${safe(l.background, COLOR_PATTERN, "#f4f7f6")};`,
    `  --color-surface: ${safe(l.surface, COLOR_PATTERN, "#ffffff")};`,
    `  --color-text-primary: ${safe(l.textPrimary, COLOR_PATTERN, "#102a2a")};`,
    `  --color-text-muted: ${safe(l.textMuted, COLOR_PATTERN, "#527070")};`,
    `  --color-success: ${safe(l.success, COLOR_PATTERN, "#15803d")};`,
    `  --color-warning: ${safe(l.warning, COLOR_PATTERN, "#b45309")};`,
    `  --color-error: ${safe(l.error, COLOR_PATTERN, "#b91c1c")};`,
    `  --color-info: ${safe(l.info, COLOR_PATTERN, "#0369a1")};`,
    `  --radius-buttons: ${safe(design.borders.buttons, BORDER_RADIUS_PATTERN, "4px")};`,
    `  --radius-cards: ${safe(design.borders.cards, BORDER_RADIUS_PATTERN, "4px")};`,
    `  --radius-badges: ${safe(design.borders.badges, BORDER_RADIUS_PATTERN, "999px")};`,
    `  --font-display: ${safe(design.typography.display.family, FONT_FAMILY_PATTERN, "sans-serif")};`,
    `  --font-display-weight: ${safe(design.typography.display.weight, FONT_WEIGHT_PATTERN, "700")};`,
    `  --font-body: ${safe(design.typography.body.family, FONT_FAMILY_PATTERN, "sans-serif")};`,
    `  --font-body-weight: ${safe(design.typography.body.weight, FONT_WEIGHT_PATTERN, "400")};`,
    `  --spacing-card: ${safe(design.spacing.cardPadding, SIZE_PATTERN, "16px")};`,
    `  --spacing-section: ${safe(design.spacing.sectionPadding, SIZE_PATTERN, "24px")};`,
  ]

  // Shadow tokens
  const shadowEntries = Object.entries(design.shadows)
  for (const [name, value] of shadowEntries) {
    const safeVal = safe(value, SHADOW_PATTERN, "none")
    vars.push(`  --shadow-${escapeHtml(name)}: ${safeVal};`)
  }

  return `:root {\n${vars.join("\n")}\n}`
}

function buildDarkCssVars(design: DesignArtifact): string {
  if (!design.tokens.dark) return ""
  const d = design.tokens.dark
  const vars: string[] = [
    `    --color-primary: ${safe(d.primary, COLOR_PATTERN, "#5eead4")};`,
    `    --color-secondary: ${safe(d.secondary, COLOR_PATTERN, "#67e8f9")};`,
    `    --color-accent: ${safe(d.accent, COLOR_PATTERN, "#fbbf24")};`,
    `    --color-background: ${safe(d.background, COLOR_PATTERN, "#0f1720")};`,
    `    --color-surface: ${safe(d.surface, COLOR_PATTERN, "#16212a")};`,
    `    --color-text-primary: ${safe(d.textPrimary, COLOR_PATTERN, "#e6fffb")};`,
    `    --color-text-muted: ${safe(d.textMuted, COLOR_PATTERN, "#9dc9c4")};`,
    `    --color-success: ${safe(d.success, COLOR_PATTERN, "#4ade80")};`,
    `    --color-warning: ${safe(d.warning, COLOR_PATTERN, "#fbbf24")};`,
    `    --color-error: ${safe(d.error, COLOR_PATTERN, "#f87171")};`,
    `    --color-info: ${safe(d.info, COLOR_PATTERN, "#38bdf8")};`,
  ]
  return `@media (prefers-color-scheme: dark) {\n  :root {\n${vars.join("\n")}\n  }\n}`
}

function buildAntiPatternCss(antiPatterns: string[]): string {
  const rules: string[] = []
  const joined = antiPatterns.join(" ").toLowerCase()
  // Enforce "zero rounded corners" anti-patterns literally
  if (/zero.*(round|radius|corner)|no.*(round|radius)|sharp.*(corner|edge)/.test(joined)) {
    rules.push("  * { border-radius: 0 !important; }")
  }
  if (rules.length === 0) return ""
  return `/* Anti-pattern enforcement from design tokens */\n${rules.join("\n")}`
}

// ── Main renderer ─────────────────────────────────────────────────────────────

/**
 * Render a single wireframe screen as a styled HTML mockup, applying the
 * design tokens from `design` end-to-end. Reads CSS variables for every
 * palette color, typography, borders, and shadows. Enforces anti-patterns
 * via CSS rules where they can be expressed declaratively.
 *
 * Validates the design artifact before rendering — throws a descriptive
 * Error (not TypeError) if the artifact is malformed.
 */
export function renderStyledMockup(screen: Screen, design: DesignArtifact): string {
  validateDesignArtifact(design)

  const cssVars = buildCssVars(design)
  const darkVars = buildDarkCssVars(design)
  const antiPatternCss = buildAntiPatternCss(design.antiPatterns)

  const displayFamily = safe(design.typography.display.family, FONT_FAMILY_PATTERN, "sans-serif")
  const displayWeight = safe(design.typography.display.weight, FONT_WEIGHT_PATTERN, "700")
  const bodyFamily = safe(design.typography.body.family, FONT_FAMILY_PATTERN, "sans-serif")
  const bodyWeight = safe(design.typography.body.weight, FONT_WEIGHT_PATTERN, "400")

  // Render each region with its elements
  const regions = screen.layout.regions.map(region => {
    const elements = screen.elements
      .filter(el => el.region === region.id)
      .map(el => renderElement(el.kind, el.label, el.placeholder))
      .join("\n      ")
    return `
    <section class="region">
      <header class="region-label">${escapeHtml(region.label)}</header>
      <div class="region-content">
      ${elements}
      </div>
    </section>`
  }).join("")

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(screen.name)} — Styled Mockup</title>
    <style>
${cssVars}

${darkVars}

${antiPatternCss}

      body {
        font-family: var(--font-body), sans-serif;
        font-weight: var(--font-body-weight);
        background: var(--color-background);
        color: var(--color-text-primary);
        padding: var(--spacing-section);
        margin: 0;
      }

      .screen-shell {
        max-width: 1024px;
        margin: 0 auto;
      }

      .screen-meta {
        background: var(--color-surface);
        border-radius: var(--radius-cards);
        padding: var(--spacing-card);
        margin-bottom: 24px;
        box-shadow: var(--shadow-sm, none);
      }

      .screen-meta h1 {
        font-family: var(--font-display), sans-serif;
        font-weight: var(--font-display-weight);
        color: var(--color-text-primary);
        margin: 0 0 8px 0;
      }

      .screen-meta p {
        color: var(--color-text-muted);
        margin: 0;
        font-size: 0.9em;
      }

      .layout {
        display: grid;
        gap: 16px;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      }

      .region {
        background: var(--color-surface);
        border-radius: var(--radius-cards);
        padding: var(--spacing-card);
        box-shadow: var(--shadow-sm, none);
      }

      .region-label {
        font-family: var(--font-body), sans-serif;
        font-size: 0.7rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--color-text-muted);
        margin-bottom: 12px;
      }

      .region-content {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      /* Heading */
      .styled-heading {
        font-family: var(--font-display), sans-serif;
        font-weight: var(--font-display-weight);
        color: var(--color-text-primary);
        margin: 0;
      }

      /* Button */
      .styled-btn {
        background: var(--color-primary);
        color: #fff;
        border: none;
        border-radius: var(--radius-buttons);
        padding: 10px 20px;
        font-family: var(--font-body), sans-serif;
        font-weight: var(--font-body-weight);
        cursor: pointer;
        font-size: 0.9rem;
        box-shadow: var(--shadow-sm, none);
      }

      /* Card */
      .styled-card {
        background: var(--color-surface);
        border: 1px solid var(--color-text-muted);
        border-radius: var(--radius-cards);
        padding: var(--spacing-card);
        box-shadow: var(--shadow-sm, none);
      }

      .card-label {
        font-weight: 600;
        color: var(--color-text-primary);
        margin-bottom: 4px;
      }

      .card-body {
        color: var(--color-text-muted);
        margin: 0;
        font-size: 0.85rem;
      }

      /* Chip / Badge */
      .styled-chip {
        display: inline-block;
        background: var(--color-accent);
        color: #fff;
        border-radius: var(--radius-badges);
        padding: 3px 10px;
        font-size: 0.75rem;
        font-weight: 600;
      }

      /* Input */
      .styled-input-wrap {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .input-label {
        font-size: 0.8rem;
        color: var(--color-text-muted);
        font-weight: 600;
      }

      .styled-input {
        border: 1px solid var(--color-text-muted);
        border-radius: var(--radius-buttons);
        padding: 8px 12px;
        background: var(--color-background);
        color: var(--color-text-primary);
        font-family: var(--font-body), sans-serif;
        font-size: 0.9rem;
      }

      /* List */
      .styled-list {
        margin: 0;
        padding-left: 16px;
        color: var(--color-text-primary);
      }

      .list-item {
        margin-bottom: 4px;
        font-size: 0.9rem;
      }

      /* Table */
      .styled-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.85rem;
      }

      .styled-table caption {
        text-align: left;
        font-weight: 600;
        color: var(--color-text-muted);
        margin-bottom: 6px;
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .styled-table th {
        background: var(--color-primary);
        color: #fff;
        padding: 8px 12px;
        text-align: left;
        font-weight: 600;
      }

      .styled-table td {
        padding: 8px 12px;
        border-bottom: 1px solid var(--color-text-muted);
        color: var(--color-text-muted);
      }

      /* Fallback element */
      .styled-element {
        border: 1px dashed var(--color-text-muted);
        padding: 8px 12px;
        border-radius: var(--radius-cards);
        font-size: 0.85rem;
        color: var(--color-text-muted);
      }

      .element-kind {
        background: var(--color-accent);
        color: #fff;
        border-radius: var(--radius-badges);
        padding: 2px 8px;
        font-size: 0.7rem;
        font-weight: 700;
        margin-right: 6px;
      }

      .element-placeholder {
        color: var(--color-text-muted);
        font-style: italic;
      }
    </style>
  </head>
  <body>
    <div class="screen-shell">
      <div class="screen-meta">
        <h1>${escapeHtml(screen.name)}</h1>
        <p>${escapeHtml(screen.purpose)}</p>
      </div>
      <div class="layout">
        ${regions}
      </div>
    </div>
  </body>
</html>`
}

/**
 * Render the mockup index page — links to every styled mockup by screen id.
 */
export function renderMockupIndex(screens: Screen[], runId: string, publicBaseUrl: string): string {
  const base = publicBaseUrl.replace(/\/$/, "")
  const screenLabel = screens.length === 1 ? "screen" : "screens"
  const links = screens.map(screen => {
    const url = `${base}/runs/${runId}/artifacts/stages/frontend-design/artifacts/mockups/${screen.id}.html`
    return `<li><a href="${escapeHtml(url)}" class="mockup-link">${escapeHtml(screen.name)}</a><span class="screen-purpose"> — ${escapeHtml(screen.purpose)}</span></li>`
  }).join("\n    ")

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Styled Mockups Index</title>
    <style>
      body { font-family: sans-serif; padding: 24px; background: #f4f4f4; }
      h1 { margin-bottom: 16px; }
      ul { list-style: none; padding: 0; }
      li { margin-bottom: 10px; }
      .mockup-link { color: #0f766e; font-weight: 600; }
      .screen-purpose { color: #666; font-size: 0.9em; }
    </style>
  </head>
  <body>
    <h1>Styled Mockups (${screens.length} ${screenLabel})</h1>
    <ul>
    ${links}
    </ul>
  </body>
</html>`
}

export const __testing = { safe, buildCssVars, buildDarkCssVars, buildAntiPatternCss }
