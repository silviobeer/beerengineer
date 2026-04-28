function buildArtifact(project, state) {
    return {
        project: {
            id: project.id,
            name: project.name,
        },
        story: state.story,
        acceptanceCriteria: state.acceptanceCriteria,
        testPlan: {
            summary: `Test plan for ${state.story.id} based on the structured acceptance criteria.`,
            testCases: state.acceptanceCriteria.map((ac, index) => ({
                id: `TC-${index + 1}`,
                name: `${state.story.id} verifies ${ac.id}`,
                mapsToAcId: ac.id,
                type: index === 0 ? "integration" : "unit",
                description: ac.text,
            })),
            fixtures: ["Seed data for story context"],
            edgeCases: ["Empty inputs", "Invalid status values"],
            assumptions: state.lastReviewFeedback ? [state.lastReviewFeedback] : ["Story context is stable"],
        },
    };
}
export class FakeTestWriterStageAdapter {
    project;
    constructor(project) {
        this.project = project;
    }
    async step(input) {
        if (input.kind === "review-feedback") {
            input.state.lastReviewFeedback = input.reviewFeedback;
            input.state.revisionCount++;
        }
        return { kind: "artifact", artifact: buildArtifact(this.project, input.state) };
    }
}
