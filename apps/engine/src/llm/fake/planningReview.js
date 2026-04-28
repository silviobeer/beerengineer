export class FakePlanningReviewAdapter {
    attempts = 0;
    async review() {
        this.attempts++;
        if (this.attempts >= 2)
            return { kind: "pass" };
        return {
            kind: "revise",
            feedback: "Please sharpen wave goals, dependencies, and exit criteria for the implementation plan.",
        };
    }
}
