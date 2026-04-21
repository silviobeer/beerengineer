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
    architectureSummary: state.architectureArtifact.architecture.summary,
    plan: {
      summary: "Umsetzungsplan mit einer Basis-Welle und einer Ausbau-Welle.",
      assumptions: ["PRD und Architektur sind ausreichend stabil"],
      sequencingNotes: ["Zuerst Kernfluss, dann Uebersichten und Ausbau"],
      dependencies: ["API-Grundlage vor Listenansicht", "Persistenz vor Bearbeitungsfunktionen"],
      risks: state.lastReviewFeedback ? [state.lastReviewFeedback] : ["Wave 2 koennte zu gross werden"],
      waves: [
        {
          id: "W1",
          number: 1,
          goal: "Kern-Workflow liefern",
          stories: state.prd.stories.slice(0, 1).map(story => ({ id: story.id, title: story.title })),
          parallel: false,
          dependencies: [],
          exitCriteria: ["Kern-Workflow funktioniert"],
        },
        {
          id: "W2",
          number: 2,
          goal: "Uebersicht und Bearbeitung fertigstellen",
          stories: state.prd.stories.slice(1).map(story => ({ id: story.id, title: story.title })),
          parallel: true,
          dependencies: ["W1"],
          exitCriteria: ["Listen und Bearbeitung funktionieren"],
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
