export function renderProjectReviewMarkdown(artifact) {
    return [
        "# Project Review",
        "",
        "## Summary",
        artifact.summary,
        "",
        "## Overall Status",
        artifact.overallStatus,
        "",
        "## Findings",
        ...(artifact.findings.length > 0
            ? artifact.findings.flatMap(finding => [
                `### ${finding.id} (${finding.severity} / ${finding.category})`,
                finding.message,
                "",
                `Evidence: ${finding.evidence}`,
                `Recommendation: ${finding.recommendation}`,
                "",
            ])
            : ["No project-wide findings.", ""]),
        "## Recommendations",
        ...artifact.recommendations.map(recommendation => `- ${recommendation}`),
    ].join("\n");
}
