import type { StageAgentAdapter, StageAgentInput, StageAgentResponse } from "../../core/adapters.js"
import type { Screen, WireframeArtifact } from "../../types/domain.js"
import type { VisualCompanionState } from "../../stages/visual-companion/types.js"

const CLARIFICATION_QUESTIONS = [
  "Do you already have wireframes or mockups you'd like to reference?",
  "Which screens are highest priority — dashboard, settings, or something else?",
  "Any accessibility or responsive-breakpoint constraints we should plan for?",
]

function pickQuestion(state: VisualCompanionState): string {
  return CLARIFICATION_QUESTIONS[state.clarificationCount % CLARIFICATION_QUESTIONS.length]
}

function buildArtifact(state: VisualCompanionState): WireframeArtifact {
  const uiProjects = state.input.projects.filter(project => project.hasUi)
  const screens: Screen[] = uiProjects.map((project, index) => ({
    id: `screen-${index + 1}`,
    name: `${project.name} Workspace`,
    purpose: `Primary screen for ${project.name}`,
    projectIds: [project.id],
    layout: {
      kind: index % 2 === 0 ? "sidebar-main" : "single-column",
      regions: [
        { id: "header", label: "Header" },
        { id: "main", label: "Main" },
        { id: "aside", label: "Aside" },
      ],
    },
    elements: [
      { id: "heading", region: "header", kind: "heading", label: `${project.name} title` },
      { id: "summary", region: "main", kind: "card", label: project.concept.summary },
      { id: "cta", region: "main", kind: "button", label: "Primary action" },
      { id: "support", region: "aside", kind: "list", label: "Secondary tools" },
    ],
  }))
  return {
    screens,
    navigation: {
      entryPoints: screens.map(screen => ({ screenId: screen.id, projectId: screen.projectIds[0] ?? "unknown" })),
      flows: screens.slice(1).map((screen, index) => ({
        id: `flow-${index + 1}`,
        from: screens[index].id,
        to: screen.id,
        trigger: "Continue",
        projectIds: [screens[index].projectIds[0] ?? "unknown", screen.projectIds[0] ?? "unknown"],
      })),
    },
    inputMode: state.inputMode,
    conceptAmendments: [],
  }
}

export class FakeVisualCompanionStageAdapter implements StageAgentAdapter<VisualCompanionState, WireframeArtifact> {
  async step(input: StageAgentInput<VisualCompanionState>): Promise<StageAgentResponse<WireframeArtifact>> {
    const state = input.state

    if (input.kind === "begin") {
      // If a revision feedback is pending from the user review gate, acknowledge
      // and go straight to a new artifact on the next user-message. For begin,
      // we still ask the first clarification question but include the feedback
      // context in the message so the real LLM adapter can see it too.
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
