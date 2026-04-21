import type { StoryTestPlanArtifact } from "../types/execution.js"

export function renderTestPlanMarkdown(artifact: StoryTestPlanArtifact): string {
  return [
    "# Test Plan",
    "",
    "## Story",
    `${artifact.story.id} ${artifact.story.title}`,
    "",
    "## Test Cases",
    ...artifact.testPlan.testCases.map(tc => `- ${tc.id} -> ${tc.mapsToAcId}: ${tc.description}`),
    "",
  ].join("\n")
}
