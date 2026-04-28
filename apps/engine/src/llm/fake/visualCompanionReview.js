export class FakeVisualCompanionReviewAdapter {
    async review(input) {
        const artifact = input?.artifact;
        const uiProjects = input?.state.input.projects.filter(project => project.hasUi) ?? [];
        if (!artifact || artifact.screens.length < uiProjects.length) {
            return { kind: "revise", feedback: "Every UI-bearing project needs at least one screen." };
        }
        return { kind: "pass" };
    }
}
