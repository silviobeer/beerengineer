import type { StageAgentAdapter, StageAgentInput, StageAgentResponse } from "../../core/adapters.js"
import type { DesignArtifact } from "../../types/domain.js"
import type { FrontendDesignState } from "../../stages/frontend-design/types.js"

const CLARIFICATION_QUESTIONS = [
  "Do you already have a design system or reference apps you'd like to align with?",
  "What's the primary emotional tone — playful, professional, minimal, bold?",
  "Any hard constraints on color (e.g. accessibility AA, brand guidelines)?",
]

function pickQuestion(state: FrontendDesignState): string {
  return CLARIFICATION_QUESTIONS[state.clarificationCount % CLARIFICATION_QUESTIONS.length]
}

/**
 * Minimal but schema-valid mockup HTML for a single screen.
 * Does not need to look pretty — just needs to pass the validator
 * (starts with <!doctype html, is non-empty).
 */
function buildFakeMockupHtml(screenId: string, screenName: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${screenName} — Mockup</title>
  <style>
    :root {
      --color-primary: #0f766e;
      --color-background: #f4f7f6;
      --color-surface: #ffffff;
      --color-text-primary: #102a2a;
      --font-body: Manrope, sans-serif;
    }
    body { font-family: var(--font-body); background: var(--color-background); color: var(--color-text-primary); margin: 0; padding: 24px; }
    .state-section { margin-bottom: 32px; }
    .state-label { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #527070; margin-bottom: 12px; }
    .card { background: var(--color-surface); border: 1px solid #d4e0de; border-radius: 8px; padding: 16px; }
  </style>
</head>
<body>
  <div class="state-section">
    <div class="state-label">[Normal State] — ${screenName}</div>
    <div class="card">Screen: ${screenId} — Normal state with realistic content.</div>
  </div>
  <div class="state-section">
    <div class="state-label">[Empty State]</div>
    <div class="card">No items yet. Add your first entry to get started.</div>
  </div>
  <div class="state-section">
    <div class="state-label">[Loading State]</div>
    <div class="card" style="color:#9dc9c4">Loading…</div>
  </div>
  <div class="state-section">
    <div class="state-label">[Error State]</div>
    <div class="card" style="color:#b91c1c">Something went wrong. Please retry.</div>
  </div>
</body>
</html>`
}

function buildArtifact(state: FrontendDesignState): DesignArtifact {
  // Collect screen ids from the wireframes payload so we can emit a
  // mockupHtmlPerScreen entry for each one.
  const wireframes = state.input?.wireframes
  const mockupHtmlPerScreen: Record<string, string> = {}
  if (wireframes?.screens) {
    for (const screen of wireframes.screens) {
      mockupHtmlPerScreen[screen.id] = buildFakeMockupHtml(screen.id, screen.name)
    }
  }

  return {
    tokens: {
      light: {
        primary: "#0f766e",
        secondary: "#155e75",
        accent: "#f59e0b",
        background: "#f4f7f6",
        surface: "#ffffff",
        textPrimary: "#102a2a",
        textMuted: "#527070",
        success: "#15803d",
        warning: "#b45309",
        error: "#b91c1c",
        info: "#0369a1",
      },
      dark: {
        primary: "#5eead4",
        secondary: "#67e8f9",
        accent: "#fbbf24",
        background: "#0f1720",
        surface: "#16212a",
        textPrimary: "#e6fffb",
        textMuted: "#9dc9c4",
        success: "#4ade80",
        warning: "#fbbf24",
        error: "#f87171",
        info: "#38bdf8",
      },
    },
    typography: {
      display: { family: "Fraunces", weight: "700", usage: "Headlines" },
      body: { family: "Manrope", weight: "500", usage: "UI copy" },
      mono: { family: "IBM Plex Mono", weight: "400", usage: "Metrics and code-like labels" },
      scale: { xs: "0.75rem", sm: "0.875rem", md: "1rem", lg: "1.25rem", xl: "1.75rem" },
    },
    spacing: {
      baseUnit: "8px",
      sectionPadding: "32px",
      cardPadding: "20px",
      contentMaxWidth: "1200px",
    },
    borders: {
      buttons: "999px",
      cards: "20px",
      badges: "999px",
    },
    shadows: {
      sm: "0 1px 2px rgba(16, 42, 42, 0.08)",
      md: "0 12px 24px rgba(16, 42, 42, 0.12)",
    },
    tone: "Practical operations UI with calm structure and one warm accent for action moments.",
    antiPatterns: ["generic SaaS blue gradients", "tiny low-contrast meta text", "unstyled empty states"],
    inputMode: state.inputMode,
    conceptAmendments: [],
    mockupHtmlPerScreen: Object.keys(mockupHtmlPerScreen).length > 0 ? mockupHtmlPerScreen : undefined,
  }
}

export class FakeFrontendDesignStageAdapter implements StageAgentAdapter<FrontendDesignState, DesignArtifact> {
  async step(input: StageAgentInput<FrontendDesignState>): Promise<StageAgentResponse<DesignArtifact>> {
    const state = input.state

    if (input.kind === "begin") {
      // If a revision feedback is pending from the user review gate, acknowledge
      // and ask the first clarification (the real LLM adapter can see the context).
      if (state.pendingRevisionFeedback) {
        return {
          kind: "message",
          message: `Noted: "${state.pendingRevisionFeedback}". Let me address that — ${pickQuestion(state)}`,
        }
      }
      return { kind: "message", message: pickQuestion(state) }
    }

    if (input.kind === "user-message") {
      const reply = String(input.userMessage ?? "").trim()
      state.history.push({ role: "user", text: reply })
      state.clarificationCount++

      // Ask follow-up questions until we reach maxClarifications
      if (state.clarificationCount < state.maxClarifications) {
        return { kind: "message", message: pickQuestion(state) }
      }

      // Enough context — produce the artifact
      state.inputMode = /^no\b/i.test(state.history[0]?.text ?? "") || state.history.length === 0
        ? "none"
        : "references"
      return { kind: "artifact", artifact: buildArtifact(state) }
    }

    // review-feedback: LLM reviewer asked for a revision — produce updated artifact
    if (input.kind === "review-feedback") {
      return { kind: "artifact", artifact: buildArtifact(state) }
    }

    return { kind: "artifact", artifact: buildArtifact(state) }
  }
}
