import type { StageAgentAdapter, StageAgentInput, StageAgentResponse } from "../../core/adapters.js"
import type { ArchitectureArtifact, ArchitectureState } from "../../stages/architecture/types.js"
import type { Project } from "../../types/domain.js"

function buildArtifact(project: Project, state: ArchitectureState): ArchitectureArtifact {
  return {
    project: {
      id: project.id,
      name: project.name,
      description: project.description,
    },
    concept: project.concept,
    prdSummary: {
      storyCount: state.prd.stories.length,
      storyIds: state.prd.stories.map(story => story.id),
    },
    architecture: {
      summary: "Projektweite Kernarchitektur fuer UI, API und Datenhaltung.",
      systemShape: "Monorepo mit UI, API und gemeinsamer Datenhaltung",
      components: [
        { name: "Frontend", responsibility: "Kern-Workflow und Listenansichten" },
        { name: "Backend", responsibility: "Validierung, Speicherung und Workflow-Logik" },
        { name: "Storage", responsibility: "Dauerhafte Ablage von Eintraegen und Status" },
      ],
      dataModelNotes: ["Eintrag", "Status", "Audit-Event"],
      apiNotes: ["CRUD-Endpunkte", "Filterbare Listen-API"],
      deploymentNotes: ["Web-first", "Einfaches Deployment fuer kleine Teams"],
      constraints: project.concept.constraints,
      risks: ["Zu breiter Scope", "Unklare Datenfluesse"],
      openQuestions: state.lastReviewFeedback ? [state.lastReviewFeedback] : [],
    },
  }
}

export class FakeArchitectureStageAdapter implements StageAgentAdapter<ArchitectureState, ArchitectureArtifact> {
  constructor(private readonly project: Project) {}

  async step(input: StageAgentInput<ArchitectureState>): Promise<StageAgentResponse<ArchitectureArtifact>> {
    if (input.kind === "user-message") {
      throw new Error("Architecture stage does not accept user messages")
    }
    if (input.kind === "review-feedback") {
      input.state.lastReviewFeedback = input.reviewFeedback
      input.state.revisionCount++
    }
    return { kind: "artifact", artifact: buildArtifact(this.project, input.state) }
  }
}
