import type { StageAgentAdapter, StageAgentInput, StageAgentResponse } from "../../core/adapters.js"
import type { Screen, WireframeArtifact } from "../../types/domain.js"
import type { VisualCompanionState } from "../../stages/visual-companion/types.js"

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
    if (input.kind === "begin") {
      return { kind: "message", message: "Do you already have wireframes or mockups?" }
    }
    if (input.kind === "user-message") {
      const reply = String(input.userMessage ?? "").trim()
      input.state.history.push({ role: "user", text: reply })
      input.state.inputMode = /^no\b/i.test(reply) || reply === "" ? "none" : "references"
      return { kind: "artifact", artifact: buildArtifact(input.state) }
    }
    return { kind: "artifact", artifact: buildArtifact(input.state) }
  }
}
