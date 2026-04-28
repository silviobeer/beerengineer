import type { Finding, UserStory } from "../types.js"
import { stagePresent } from "../core/stagePresentation.js"

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

export async function llm6bImplement(story: UserStory): Promise<void> {
  await delay(350)
  stagePresent.dim(`    → ${story.id} implemented. Tests: ${story.acceptanceCriteria.length} passed.`)
}

export async function llm6bFix(feedback: string): Promise<void> {
  await delay(400)
  stagePresent.dim(`    → Fixes applied for: ${feedback.slice(0, 70)}...`)
}

function storyTag(storyId?: string): string {
  return storyId ? `[${storyId}] ` : ""
}

export async function crReview(loop: number, storyId?: string): Promise<Finding[]> {
  await delay(280)
  const tag = storyTag(storyId)
  if (loop === 1) {
    return [
      { source: "coderabbit", severity: "high", message: `${tag}Duplicated validation logic between route and service.` },
      { source: "coderabbit", severity: "medium", message: `${tag}Missing guard for empty error state in the UI.` },
    ]
  }

  if (loop === 2) {
    return [
      { source: "coderabbit", severity: "medium", message: `${tag}Missing guard for empty error state in the UI.` },
    ]
  }

  return [
    { source: "coderabbit", severity: "low", message: `${tag}Naming in the helper module is still slightly inconsistent.` },
  ]
}

export async function sonarReview(
  loop: number,
  storyId?: string,
): Promise<{
  passed: boolean
  conditions: Array<{
    metric: "reliability" | "security" | "maintainability"
    status: "ok" | "error"
    actual: string
    threshold: string
  }>
  findings: Finding[]
}> {
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
        { source: "sonarqube", severity: "medium", message: `${tag}Service method complexity is above the target threshold.` },
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
        { source: "sonarqube", severity: "medium", message: `${tag}Missing failure-path safeguard in the integration path.` },
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
      { source: "sonarqube", severity: "low", message: `${tag}Small cleanup in the logging module is still outstanding.` },
    ],
  }
}
