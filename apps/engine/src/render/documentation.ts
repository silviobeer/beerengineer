import type { DocumentationArtifact, DocumentationSection } from "../types/domain.js"

function renderDoc(title: string, summary: string, sections: DocumentationSection[]): string {
  return [
    `# ${title}`,
    "",
    summary,
    "",
    ...sections.flatMap(section => [`## ${section.heading}`, section.content, ""]),
  ].join("\n").trimEnd() + "\n"
}

export function renderTechnicalDoc(artifact: DocumentationArtifact): string {
  return renderDoc(artifact.technicalDoc.title, artifact.technicalDoc.summary, artifact.technicalDoc.sections)
}

export function renderFeaturesDoc(artifact: DocumentationArtifact): string {
  return renderDoc(artifact.featuresDoc.title, artifact.featuresDoc.summary, artifact.featuresDoc.sections)
}

export function renderCompactReadme(artifact: DocumentationArtifact): string {
  return renderDoc(artifact.compactReadme.title, artifact.compactReadme.summary, artifact.compactReadme.sections)
}

export function renderKnownIssues(artifact: DocumentationArtifact): string {
  return [
    "# Known Issues",
    "",
    ...(artifact.knownIssues.length > 0 ? artifact.knownIssues.map(issue => `- ${issue}`) : ["- None"]),
    "",
  ].join("\n")
}

export type DocFile = { fileName: string; label: string; content: string }

export function buildDocFiles(artifact: DocumentationArtifact): DocFile[] {
  return [
    { fileName: "technical-doc.md", label: "Technical Doc Markdown", content: renderTechnicalDoc(artifact) },
    { fileName: "features-doc.md", label: "Features Doc Markdown", content: renderFeaturesDoc(artifact) },
    { fileName: "README.compact.md", label: "Compact README Markdown", content: renderCompactReadme(artifact) },
    { fileName: "known-issues.md", label: "Known Issues Markdown", content: renderKnownIssues(artifact) },
  ]
}
