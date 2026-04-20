import { AppError } from "../shared/errors.js";
import type { ReviewCoreService } from "../review/review-core-service.js";
import type { WorkflowDeps } from "./workflow-deps.js";

type ReviewRemediationServiceOptions = {
  deps: WorkflowDeps;
  reviewCoreService: ReviewCoreService;
  startStoryReviewRemediation(input: { storyReviewRunId: string }): Promise<{
    storyReviewRemediationRunId: string;
    remediationWaveStoryExecutionId: string;
    status: "completed" | "review_required" | "failed";
  }>;
};

export class ReviewRemediationService {
  public constructor(private readonly options: ReviewRemediationServiceOptions) {}

  public async remediateImplementationReview(input: {
    review: ReturnType<ReviewCoreService["showReview"]>;
    waveStoryExecutionId: string;
    interactionMode: "auto" | "assisted" | "interactive";
  }) {
    if (input.interactionMode !== "auto") {
      return input.review;
    }

    const latestStoryReviewRun = this.options.deps.storyReviewRunRepository.getLatestByWaveStoryExecutionId(input.waveStoryExecutionId);
    if (!latestStoryReviewRun || (latestStoryReviewRun.status !== "review_required" && latestStoryReviewRun.status !== "failed")) {
      return input.review;
    }

    const storyFindings = input.review.findings.filter((finding) => finding.sourceSystem === "story_review");
    if (storyFindings.length === 0) {
      return input.review;
    }

    const hasUnsafeFinding = storyFindings.some(
      (finding) => finding.normalizedSeverity === "critical" || finding.normalizedSeverity === "high"
    );
    if (hasUnsafeFinding) {
      return input.review;
    }

    const remediation = await this.options.startStoryReviewRemediation({ storyReviewRunId: latestStoryReviewRun.id });
    const rerun = this.options.reviewCoreService.getLatestBySubject({
      reviewKind: "implementation",
      subjectType: "wave_story_execution",
      subjectId: remediation.remediationWaveStoryExecutionId
    });
    if (!rerun) {
      throw new AppError(
        "IMPLEMENTATION_REVIEW_RERUN_NOT_FOUND",
        `Implementation re-review missing after remediation for execution ${remediation.remediationWaveStoryExecutionId}`
      );
    }
    return rerun;
  }
}
