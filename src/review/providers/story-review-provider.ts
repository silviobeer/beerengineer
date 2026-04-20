import type { ReviewProviderResult } from "../types.js";
import type { WorkflowDeps } from "../../workflow/workflow-deps.js";

function normalizeSeverity(value: string) {
  switch (value.toLowerCase()) {
    case "blocker":
    case "critical":
      return "critical" as const;
    case "high":
    case "major":
      return "high" as const;
    case "medium":
    case "minor":
      return "medium" as const;
    default:
      return "low" as const;
  }
}

export class StoryReviewProvider {
  public constructor(private readonly deps: WorkflowDeps) {}

  public provide(waveStoryExecutionId: string): ReviewProviderResult {
    const latestStoryReviewRun = this.deps.storyReviewRunRepository.getLatestByWaveStoryExecutionId(waveStoryExecutionId);
    const findings = latestStoryReviewRun ? this.deps.storyReviewFindingRepository.listByStoryReviewRunId(latestStoryReviewRun.id) : [];
    return {
      providerId: "story_review",
      sourceSystem: "story_review",
      findings: findings.map((finding) => ({
        reviewerRole: "story-reviewer",
        findingType: finding.category,
        normalizedSeverity: normalizeSeverity(finding.severity),
        sourceSeverity: finding.severity,
        title: finding.title,
        detail: finding.description,
        evidence: finding.evidence,
        filePath: finding.filePath,
        line: finding.line,
        fieldPath: null
      }))
    };
  }
}
