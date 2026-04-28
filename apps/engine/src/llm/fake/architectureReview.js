export class FakeArchitectureReviewAdapter {
    attempts = 0;
    async review() {
        this.attempts++;
        if (this.attempts >= 2)
            return { kind: "pass" };
        return {
            kind: "revise",
            feedback: "Please sharpen system boundaries, core components, and risks for this project.",
        };
    }
}
