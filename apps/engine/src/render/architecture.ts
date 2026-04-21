import type { ArchitectureArtifact } from "../types/domain.js"

export function renderArchitectureMarkdown(artifact: ArchitectureArtifact): string {
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
  ].join("\n")
}
