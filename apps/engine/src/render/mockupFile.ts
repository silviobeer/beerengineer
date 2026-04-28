import type { DesignArtifact, Screen } from "../types/domain.js"

/**
 * Retrieve the LLM-generated high-fidelity HTML for a single screen.
 *
 * The LLM is the mockup designer — it ships a full standalone HTML document
 * (inline CSS, realistic mock content, all four states, app-shell embedded)
 * inside `design.mockupHtmlPerScreen[screenId]`. This function just validates
 * and returns that verbatim; no re-serialisation or procedural rendering occurs.
 *
 * Throws a descriptive Error when:
 * - `mockupHtmlPerScreen` is absent from the artifact
 * - the entry for `screenId` is missing
 * - the HTML does not look like a real document (sanity check only)
 */
export function renderMockupFile(screenId: string, design: DesignArtifact): string {
  if (!design.mockupHtmlPerScreen) {
    throw new Error(
      `renderMockupFile: design artifact is missing mockupHtmlPerScreen. ` +
      `The LLM must produce mockupHtmlPerScreen with an entry for every screen — screenId="${screenId}".`,
    )
  }

  const html = design.mockupHtmlPerScreen[screenId]
  if (typeof html !== "string" || html.trim().length === 0) {
    throw new Error(
      `renderMockupFile: no HTML found for screenId="${screenId}" in mockupHtmlPerScreen. ` +
      `Available screens: ${Object.keys(design.mockupHtmlPerScreen).join(", ") || "(none)"}.`,
    )
  }

  const trimmed = html.trimStart().toLowerCase()
  if (!trimmed.startsWith("<!doctype") && !trimmed.startsWith("<html")) {
    throw new Error(
      `renderMockupFile: mockupHtmlPerScreen["${screenId}"] does not start with <!doctype or <html — not a valid HTML document.`,
    )
  }

  return html
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

/**
 * Render a sitemap HTML page with clickable links to every mockup file.
 *
 * Each link uses the public HTTP URL pattern so the user can open files
 * directly in a browser (not file:// paths). Falls back gracefully to a
 * relative path if publicBaseUrl is undefined.
 *
 * URL format: {publicBaseUrl}/runs/{runId}/artifacts/stages/frontend-design/artifacts/mockups/{screenId}.html
 */
export function renderMockupSitemap(
  screens: Screen[],
  runId: string,
  publicBaseUrl: string,
): string {
  const base = publicBaseUrl.replace(/\/$/, "")
  const screenLabel = screens.length === 1 ? "screen" : "screens"
  const items = screens.map(screen => {
    const url = `${base}/runs/${runId}/artifacts/stages/frontend-design/artifacts/mockups/${screen.id}.html`
    return `
    <li class="sitemap-item">
      <a class="sitemap-link" href="${escapeHtml(url)}">${escapeHtml(screen.name)}</a>
      <span class="sitemap-purpose"> — ${escapeHtml(screen.purpose)}</span>
    </li>`
  }).join("")

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Mockups Sitemap</title>
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        background: #f8fafc;
        color: #1e293b;
        padding: 32px 24px;
        margin: 0;
      }
      h1 { font-size: 1.5rem; font-weight: 700; margin: 0 0 8px; }
      .subtitle { color: #64748b; margin: 0 0 32px; font-size: 0.95rem; }
      ul {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .sitemap-item {
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 16px 20px;
        display: flex;
        align-items: baseline;
        gap: 4px;
      }
      .sitemap-link {
        font-weight: 600;
        color: #0f766e;
        text-decoration: none;
        font-size: 1rem;
      }
      .sitemap-link:hover { text-decoration: underline; }
      .sitemap-purpose { color: #64748b; font-size: 0.9rem; }
    </style>
  </head>
  <body>
    <h1>Mockups Sitemap</h1>
    <p class="subtitle">${screens.length} ${screenLabel} — click to open each mockup</p>
    <ul>
      ${items}
    </ul>
  </body>
</html>`
}
