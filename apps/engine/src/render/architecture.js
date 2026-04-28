export function renderArchitectureMarkdown(artifact) {
    return [
        "# Architecture",
        "",
        "## Summary",
        artifact.architecture.summary,
        "",
        "## Components",
        ...artifact.architecture.components.map(component => `- ${component.name}: ${component.responsibility}`),
        "",
        "## Risks",
        ...artifact.architecture.risks.map(risk => `- ${risk}`),
    ].join("\n");
}
