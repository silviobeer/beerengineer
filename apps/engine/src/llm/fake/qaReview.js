export class FakeQaReviewAdapter {
    async review(input) {
        if (input.artifact.accepted || input.artifact.findings.length === 0) {
            return { kind: "pass" };
        }
        return {
            kind: "revise",
            feedback: input.artifact.findings
                .map(f => `[${f.source}/${f.severity}] ${f.message}`)
                .join("; "),
        };
    }
}
