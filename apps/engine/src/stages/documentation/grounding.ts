import type {
  DocumentationArtifact,
  DocumentationSection,
  ProjectReviewArtifact,
  ProjectReviewFinding,
} from "../../types/domain.js"

function formatProjectReviewFinding(finding: ProjectReviewFinding): string {
  return `${finding.id} (${finding.severity}, ${finding.category}): ${finding.message}`
}

function upsertSection(
  sections: DocumentationSection[],
  heading: string,
  content: string,
): DocumentationSection[] {
  const existingIndex = sections.findIndex(section => section.heading === heading)
  if (existingIndex < 0) return [...sections, { heading, content }]

  return sections.map((section, index) => (
    index === existingIndex ? { ...section, content } : section
  ))
}

export function groundDocumentationArtifactInProjectReview(
  artifact: DocumentationArtifact,
  projectReview: ProjectReviewArtifact,
): DocumentationArtifact {
  if (projectReview.findings.length === 0) {
    return { ...artifact, knownIssues: [] }
  }

  const groundedIssues = projectReview.findings.map(formatProjectReviewFinding)
  const groundedIssueText = groundedIssues
    .map((issue, index) => `${index + 1}. ${issue}`)
    .join("\n")

  return {
    ...artifact,
    technicalDoc: {
      ...artifact.technicalDoc,
      sections: upsertSection(artifact.technicalDoc.sections, "Known Issues", groundedIssueText),
    },
    featuresDoc: {
      ...artifact.featuresDoc,
      summary: [
        "Delivered scope is documented below.",
        `Project review status: ${projectReview.overallStatus}; residual findings are listed in Known Issues.`,
      ].join(" "),
      sections: upsertSection(artifact.featuresDoc.sections, "Known Issues", groundedIssueText),
    },
    knownIssues: groundedIssues,
  }
}
