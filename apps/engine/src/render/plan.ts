import type { ImplementationPlanArtifact } from "../types/domain.js"

export function renderPlanMarkdown(artifact: ImplementationPlanArtifact): string {
  const plan = artifact.plan ?? ({} as ImplementationPlanArtifact["plan"])
  const waves = Array.isArray(plan.waves) ? plan.waves : []
  return [
    "# Implementation Plan",
    "",
    "## Summary",
    plan.summary ?? "(no summary)",
    "",
    "## Waves",
    ...(waves.length === 0
      ? ["_No waves were emitted._", ""]
      : waves.flatMap(wave => [
          `### Wave ${wave.number ?? "?"}: ${wave.goal ?? "(no goal)"}`,
          ...(Array.isArray(wave.stories) ? wave.stories : []).map(story => `- ${story.id} ${story.title}`),
          "",
        ])),
  ].join("\n")
}
