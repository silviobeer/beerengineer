function hasSection(artifact, heading) {
    return artifact.technicalDoc.sections.some(section => section.heading === heading);
}
export class FakeDocumentationReviewAdapter {
    async review(input) {
        const failures = [];
        if (input.state.projectReview.findings.length > 0 && !hasSection(input.artifact, "Known Risks")) {
            failures.push("Technical doc must call out residual project-review risks.");
        }
        if (input.artifact.compactReadme.sections.length > 4) {
            failures.push("Compact README is still too long.");
        }
        const featureSection = input.artifact.featuresDoc.sections.find(section => section.heading === "Implemented Features");
        const missingStories = Object.keys(input.state.prdDigest.acCountByStory).filter(storyId => !featureSection?.content.includes(storyId));
        if (missingStories.length > 0) {
            failures.push(`Features doc is missing stories: ${missingStories.join(", ")}.`);
        }
        if (failures.length > 0) {
            return { kind: "revise", feedback: failures.join(" ") };
        }
        return { kind: "pass" };
    }
}
