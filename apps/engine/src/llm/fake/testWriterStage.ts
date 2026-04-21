import type { StageAgentAdapter, StageAgentInput, StageAgentResponse } from "../../core/adapters.js"
import type { StoryTestPlanArtifact, TestWriterState } from "../../stages/execution/types.js"
import type { Project } from "../../types/domain.js"

function buildArtifact(project: Project, state: TestWriterState): StoryTestPlanArtifact {
  return {
    project: {
      id: project.id,
      name: project.name,
    },
    story: state.story,
    acceptanceCriteria: state.acceptanceCriteria,
    testPlan: {
      summary: `Testplan fuer ${state.story.id} auf Basis der strukturierten Acceptance Criteria.`,
      testCases: state.acceptanceCriteria.map((ac, index) => ({
        id: `TC-${index + 1}`,
        name: `${state.story.id} prueft ${ac.id}`,
        mapsToAcId: ac.id,
        type: index === 0 ? "integration" : "unit",
        description: ac.text,
      })),
      fixtures: ["Seed-Daten fuer Story-Kontext"],
      edgeCases: ["Leere Eingaben", "Ungueltige Statuswerte"],
      assumptions: state.lastReviewFeedback ? [state.lastReviewFeedback] : ["Story-Kontext ist stabil"],
    },
  }
}

export class FakeTestWriterStageAdapter implements StageAgentAdapter<TestWriterState, StoryTestPlanArtifact> {
  constructor(private readonly project: Project) {}

  async step(input: StageAgentInput<TestWriterState>): Promise<StageAgentResponse<StoryTestPlanArtifact>> {
    if (input.kind === "review-feedback") {
      input.state.lastReviewFeedback = input.reviewFeedback
      input.state.revisionCount++
    }
    return { kind: "artifact", artifact: buildArtifact(this.project, input.state) }
  }
}
