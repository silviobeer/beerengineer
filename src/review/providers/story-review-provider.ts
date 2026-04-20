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
    const latestCoreRun = this.deps.reviewRunRepository.getLatestBySubject({
      reviewKind: "interactive_story",
      subjectType: "wave_story_execution",
      subjectId: waveStoryExecutionId
    });
    const findings = latestCoreRun
      ? this.deps.reviewFindingRepository.listByRunId(latestCoreRun.id).map((finding) => ({
          reviewerRole: finding.reviewerRole ?? "story-reviewer",
          findingType: finding.findingType,
          normalizedSeverity: normalizeSeverity(finding.sourceSeverity ?? finding.normalizedSeverity),
          sourceSeverity: finding.sourceSeverity ?? finding.normalizedSeverity,
          title: finding.title,
          detail: finding.detail,
          evidence: finding.evidence,
          filePath: finding.filePath,
          line: finding.line,
          fieldPath: finding.fieldPath
        }))
      : [];
    return {
      providerId: "story_review",
      sourceSystem: "story_review",
      findings
    };
  }
}
