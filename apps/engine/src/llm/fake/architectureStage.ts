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
      summary: "Project-wide core architecture for UI, API, and data storage.",
      systemShape: "Monorepo with UI, API, and shared data storage",
      components: [
        { name: "Frontend", responsibility: "Core workflow and list views" },
        { name: "Backend", responsibility: "Validation, persistence, and workflow logic" },
        { name: "Storage", responsibility: "Durable storage of entries and status" },
      ],
      dataModelNotes: ["Entry", "Status", "Audit event"],
      apiNotes: ["CRUD endpoints", "Filterable list API"],
      deploymentNotes: ["Web-first", "Simple deployment for small teams"],
      constraints: project.concept.constraints,
      risks: ["Scope too broad", "Unclear data flows"],
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
