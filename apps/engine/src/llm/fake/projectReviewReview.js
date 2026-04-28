export class FakeProjectReviewReviewAdapter {
    async review(input) {
        const highOrCriticalCount = input.artifact.findings.filter(finding => finding.severity === "critical" || finding.severity === "high").length;
        const mediumCount = input.artifact.findings.filter(finding => finding.severity === "medium").length;
        if (highOrCriticalCount > 0 || mediumCount >= 2) {
            return {
                kind: "revise",
                feedback: "Address the project-wide technical coherence issues, then resubmit with only residual low-risk cleanup items if any remain.",
            };
        }
        return { kind: "pass" };
    }
}
