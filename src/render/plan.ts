import type { ImplementationPlanArtifact } from "../types/domain.js"

export function renderPlanMarkdown(artifact: ImplementationPlanArtifact): string {
  return [
    "# Implementation Plan",
    "",
    "## Summary",
    artifact.plan.summary,
    "",
    "## Waves",
    ...artifact.plan.waves.flatMap(wave => [
      `### Wave ${wave.number}: ${wave.goal}`,
      ...wave.stories.map(story => `- ${story.id} ${story.title}`),
      "",
    ]),
  ].join("\n")
}
