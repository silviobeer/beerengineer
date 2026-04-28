export class FakeTestWriterReviewAdapter {
    attempts = 0;
    async review() {
        this.attempts++;
        if (this.attempts >= 2)
            return { kind: "pass" };
        return {
            kind: "revise",
            feedback: "Please sharpen the test case -> AC mapping and add relevant edge cases.",
        };
    }
}
