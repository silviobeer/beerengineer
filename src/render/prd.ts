import type { RequirementsArtifact } from "../stages/requirements/types.js"

export function renderPrdMarkdown(artifact: RequirementsArtifact): string {
  return [
    "# PRD",
    "",
    "## Concept Summary",
    artifact.concept.summary,
    "",
    "## User Stories",
    ...artifact.prd.stories.flatMap(story => [
      `### ${story.id} ${story.title}`,
      ...story.acceptanceCriteria.map(ac => `- ${ac.id} [${ac.priority}/${ac.category}] ${ac.text}`),
      "",
    ]),
  ].join("\n")
}
