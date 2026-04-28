export class FakeRequirementsReviewAdapter {
    attempts = 0;
    async review() {
        this.attempts++;
        if (this.attempts >= 2)
            return { kind: "pass" };
        return {
            kind: "revise",
            feedback: "Story US-02 is still too vague. Please refine scope and acceptance criteria based on the concept.",
        };
    }
}
