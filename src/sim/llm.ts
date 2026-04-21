import type { Finding, StoryReviewArtifact, UserStory } from "../types.js"
import { print } from "../print.js"

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

export async function llm6bImplement(story: UserStory): Promise<void> {
  await delay(350)
  print.dim(`    → ${story.id} implementiert. Tests: ${story.acceptanceCriteria.length} passed.`)
}

export async function llm6bFix(feedback: string): Promise<void> {
  await delay(400)
  print.dim(`    → Fixes implementiert für: ${feedback.slice(0, 70)}...`)
}

function storyTag(storyId?: string): string {
  return storyId ? `[${storyId}] ` : ""
}

export async function crReview(loop: number, storyId?: string): Promise<Finding[]> {
  await delay(280)
  const tag = storyTag(storyId)
  if (loop === 1) {
    return [
      { source: "coderabbit", severity: "high", message: `${tag}Doppelte Validierungslogik zwischen Route und Service.` },
      { source: "coderabbit", severity: "medium", message: `${tag}Fehlender Guard fuer leeren Fehlerzustand in der UI.` },
    ]
  }

  if (loop === 2) {
    return [
      { source: "coderabbit", severity: "medium", message: `${tag}Fehlender Guard fuer leeren Fehlerzustand in der UI.` },
    ]
  }

  return [
    { source: "coderabbit", severity: "low", message: `${tag}Naming im Hilfsmodul ist noch leicht inkonsistent.` },
  ]
}

export async function sonarReview(
  loop: number,
  storyId?: string,
): Promise<StoryReviewArtifact["gate"]["sonar"] & { findings: Finding[] }> {
  await delay(320)
  const tag = storyTag(storyId)

  if (loop === 1) {
    return {
      passed: false,
      conditions: [
        { metric: "reliability", status: "ok", actual: "A", threshold: "A" },
        { metric: "security", status: "ok", actual: "A", threshold: "A" },
        { metric: "maintainability", status: "error", actual: "B", threshold: "A" },
      ],
      findings: [
        { source: "sonarqube", severity: "medium", message: `${tag}Komplexitaet der Service-Methode liegt ueber dem Zielwert.` },
        { source: "sonarqube", severity: "low", message: `${tag}Unused import in handler.ts.` },
      ],
    }
  }

  if (loop === 2) {
    return {
      passed: false,
      conditions: [
        { metric: "reliability", status: "error", actual: "B", threshold: "A" },
        { metric: "security", status: "ok", actual: "A", threshold: "A" },
        { metric: "maintainability", status: "ok", actual: "A", threshold: "A" },
      ],
      findings: [
        { source: "sonarqube", severity: "medium", message: `${tag}Fehlende Failure-Path-Absicherung im Integrationspfad.` },
      ],
    }
  }

  return {
    passed: true,
    conditions: [
      { metric: "reliability", status: "ok", actual: "A", threshold: "A" },
      { metric: "security", status: "ok", actual: "A", threshold: "A" },
      { metric: "maintainability", status: "ok", actual: "A", threshold: "A" },
    ],
    findings: [
      { source: "sonarqube", severity: "low", message: `${tag}Kleiner Cleanup im Logging-Modul bleibt offen.` },
    ],
  }
}
