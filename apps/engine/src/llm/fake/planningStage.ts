import type { StageAgentAdapter, StageAgentInput, StageAgentResponse } from "../../core/adapters.js"
import type { ImplementationPlanArtifact, PlanningState } from "../../stages/planning/types.js"
import type { Project } from "../../types/domain.js"

function buildArtifact(project: Project, state: PlanningState): ImplementationPlanArtifact {
  return {
    project: {
      id: project.id,
      name: project.name,
    },
    conceptSummary: project.concept.summary,
    architectureSummary: state.architectureSummary.summary,
    plan: {
      summary: "Implementation plan with a base wave and an expansion wave.",
      assumptions: ["PRD and architecture are stable enough"],
      sequencingNotes: ["Core flow first, then overviews and expansion"],
      dependencies: ["API foundation before list view", "Persistence before edit features"],
      risks: state.lastReviewFeedback ? [state.lastReviewFeedback] : ["Wave 2 could become too large"],
      waves: [
        {
          id: "W1",
          number: 1,
          goal: "Deliver core workflow",
          kind: "feature",
          stories: state.prd.stories.slice(0, 1).map(story => ({ id: story.id, title: story.title })),
          internallyParallelizable: false,
          dependencies: [],
          exitCriteria: ["Core workflow works"],
        },
        {
          id: "W2",
          number: 2,
          goal: "Finish overview and edit features",
          kind: "feature",
          stories: state.prd.stories.slice(1).map(story => ({ id: story.id, title: story.title })),
          internallyParallelizable: true,
          dependencies: ["W1"],
          exitCriteria: ["Lists and editing work"],
        },
      ],
    },
  }
}

export class FakePlanningStageAdapter implements StageAgentAdapter<PlanningState, ImplementationPlanArtifact> {
  constructor(private readonly project: Project) {}

  async step(input: StageAgentInput<PlanningState>): Promise<StageAgentResponse<ImplementationPlanArtifact>> {
    if (input.kind === "user-message") {
      throw new Error("Planning stage does not accept user messages")
    }
    if (input.kind === "review-feedback") {
      input.state.lastReviewFeedback = input.reviewFeedback
      input.state.revisionCount++
    }
    return { kind: "artifact", artifact: buildArtifact(this.project, input.state) }
  }
}
