import type { ImplementationPlanArtifact } from "../types/domain.js"

export function renderPlanMarkdown(artifact: ImplementationPlanArtifact): string {
  const plan = artifact.plan ?? ({} as ImplementationPlanArtifact["plan"])
  const waves = Array.isArray(plan.waves) ? plan.waves : []
  const waveLines = waves.length === 0
    ? ["_No waves were emitted._", ""]
    : waves.flatMap(wave => {
        let entriesSource: Array<{ id: string; title: string }> = []
        if (wave.kind === "setup") {
          entriesSource = Array.isArray(wave.tasks) ? wave.tasks : []
        } else {
          entriesSource = Array.isArray(wave.stories) ? wave.stories : []
        }
        const entries = entriesSource.map(entry => `- ${entry.id} ${entry.title}`)
        return [
          `### Wave ${wave.number ?? "?"}: ${wave.goal ?? "(no goal)"}${wave.kind === "setup" ? " [setup]" : ""}`,
          ...entries,
          "",
        ]
      })
  return [
    "# Implementation Plan",
    "",
    "## Summary",
    plan.summary ?? "(no summary)",
    "",
    "## Waves",
    ...waveLines,
  ].join("\n")
}
