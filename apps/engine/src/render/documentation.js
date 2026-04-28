function renderDoc(title, summary, sections) {
    return [
        `# ${title}`,
        "",
        summary,
        "",
        ...sections.flatMap(section => [`## ${section.heading}`, section.content, ""]),
    ].join("\n").trimEnd() + "\n";
}
export function renderTechnicalDoc(artifact) {
    return renderDoc(artifact.technicalDoc.title, artifact.technicalDoc.summary, artifact.technicalDoc.sections);
}
export function renderFeaturesDoc(artifact) {
    return renderDoc(artifact.featuresDoc.title, artifact.featuresDoc.summary, artifact.featuresDoc.sections);
}
export function renderCompactReadme(artifact) {
    return renderDoc(artifact.compactReadme.title, artifact.compactReadme.summary, artifact.compactReadme.sections);
}
export function renderKnownIssues(artifact) {
    return [
        "# Known Issues",
        "",
        ...(artifact.knownIssues.length > 0 ? artifact.knownIssues.map(issue => `- ${issue}`) : ["- None"]),
        "",
    ].join("\n");
}
export function buildDocFiles(artifact) {
    return [
        { fileName: "technical-doc.md", label: "Technical Doc Markdown", content: renderTechnicalDoc(artifact) },
        { fileName: "features-doc.md", label: "Features Doc Markdown", content: renderFeaturesDoc(artifact) },
        { fileName: "README.compact.md", label: "Compact README Markdown", content: renderCompactReadme(artifact) },
        { fileName: "known-issues.md", label: "Known Issues Markdown", content: renderKnownIssues(artifact) },
    ];
}
