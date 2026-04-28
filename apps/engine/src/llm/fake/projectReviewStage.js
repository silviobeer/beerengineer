function hashProjectId(projectId) {
    return Array.from(projectId).reduce((sum, char) => sum + (char.codePointAt(0) ?? 0), 0);
}
function totalBlockedStories(state) {
    return state.executionSummaries.reduce((sum, wave) => sum + wave.storiesBlocked.length, 0);
}
function totalMergedStories(state) {
    return state.executionSummaries.reduce((sum, wave) => sum + wave.storiesMerged.length, 0);
}
function primaryFinding(project, state) {
    const blocked = totalBlockedStories(state);
    if (blocked > 0) {
        return {
            id: "PR-INT-01",
            source: "project-review-llm",
            severity: "high",
            category: "integration",
            message: `${blocked} story/stories ended execution in a blocked state.`,
            evidence: `Execution summaries report ${blocked} blocked story across ${state.executionSummaries.length} wave(s).`,
            recommendation: "Triage blocked stories before shipping — either complete them or scope them out of the release.",
        };
    }
    const selector = (hashProjectId(project.id) + state.planSummary.waveCount + state.prd.stories.length) % 2;
    if (selector === 0) {
        return {
            id: "PR-ARCH-01",
            source: "project-review-llm",
            severity: "high",
            category: "architecture",
            message: "Business rules are duplicated across route and service boundaries.",
            evidence: `Project ${project.id} spans ${state.planSummary.waveCount} waves across ${totalMergedStories(state)} merged stories, but the architecture still describes a single validation boundary.`,
            recommendation: "Consolidate domain validation in the service layer and keep transport handlers thin.",
        };
    }
    return {
        id: "PR-CONS-01",
        source: "project-review-llm",
        severity: "high",
        category: "consistency",
        message: "Error mapping is inconsistent across project handlers.",
        evidence: `The implementation plan covers ${state.prd.stories.length} stories across ${totalMergedStories(state)} merged integrations, but shared failure semantics are not reflected in the architecture artifact.`,
        recommendation: "Define one shared error translation strategy across handlers and background flows.",
    };
}
function lowFinding() {
    return {
        id: "PR-MAINT-01",
        source: "project-review-llm",
        severity: "low",
        category: "maintainability",
        message: "Shared helper logic appears duplicated in multiple modules.",
        evidence: "Project-wide review found repeated support logic that should live behind one reusable helper boundary.",
        recommendation: "Extract the repeated helper code into a shared module and remove dead copies.",
    };
}
function buildArtifact(project, state) {
    if (state.revisionCount <= 0) {
        const findings = [primaryFinding(project, state), lowFinding()];
        return {
            project: { id: project.id, name: project.name },
            scope: "project-wide-code-review",
            overallStatus: "fail",
            summary: "Project-wide technical review found one revision-worthy issue plus one cleanup item.",
            findings,
            recommendations: findings.map(finding => finding.recommendation),
        };
    }
    if (state.revisionCount === 1) {
        if (!state.lastReviewFeedback) {
            throw new Error("Project review revision requires reviewer feedback in state");
        }
        const findings = [lowFinding()];
        return {
            project: { id: project.id, name: project.name },
            scope: "project-wide-code-review",
            overallStatus: "pass_with_risks",
            summary: `Revision addressed the main project-wide concern. Residual cleanup risk remains: ${state.lastReviewFeedback}`,
            findings,
            recommendations: ["Track the remaining cleanup item as post-implementation maintenance work."],
        };
    }
    return {
        project: { id: project.id, name: project.name },
        scope: "project-wide-code-review",
        overallStatus: "pass",
        summary: "Project-wide technical review is clean after revisions.",
        findings: [],
        recommendations: ["No further action required."],
    };
}
export class FakeProjectReviewStageAdapter {
    project;
    constructor(project) {
        this.project = project;
    }
    async step(input) {
        if (input.kind === "user-message") {
            throw new Error("Project review stage does not accept user messages");
        }
        if (input.kind === "review-feedback") {
            input.state.lastReviewFeedback = input.reviewFeedback;
            input.state.revisionCount++;
        }
        return { kind: "artifact", artifact: buildArtifact(this.project, input.state) };
    }
}
