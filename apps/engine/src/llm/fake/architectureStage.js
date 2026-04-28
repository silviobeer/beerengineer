function buildArtifact(project, state) {
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
            decisions: [
                {
                    id: "ARCH-01",
                    summary: "Keep workflow state changes behind the backend boundary.",
                    rationale: "Preserves one validation path and avoids duplicating business rules in the UI.",
                },
            ],
            risks: ["Scope too broad", "Unclear data flows"],
            openQuestions: state.lastReviewFeedback ? [state.lastReviewFeedback] : [],
        },
    };
}
export class FakeArchitectureStageAdapter {
    project;
    constructor(project) {
        this.project = project;
    }
    async step(input) {
        if (input.kind === "user-message") {
            throw new Error("Architecture stage does not accept user messages");
        }
        if (input.kind === "review-feedback") {
            input.state.lastReviewFeedback = input.reviewFeedback;
            input.state.revisionCount++;
        }
        return { kind: "artifact", artifact: buildArtifact(this.project, input.state) };
    }
}
