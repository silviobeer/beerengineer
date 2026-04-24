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

function buildArtifact(state: FrontendDesignState): DesignArtifact {
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
