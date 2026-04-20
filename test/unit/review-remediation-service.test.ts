import { describe, expect, it } from "vitest";

import { ReviewRemediationService } from "../../src/workflow/review-remediation-service.js";

describe("ReviewRemediationService", () => {
  it("fails fast when auto remediation does not complete", async () => {
    const service = new ReviewRemediationService({
      deps: {
        storyReviewRunRepository: {
          getLatestByWaveStoryExecutionId: () => ({
            id: "story_review_run_1",
            status: "review_required"
          })
        }
      } as never,
      reviewCoreService: {
        getLatestBySubject: () => {
          throw new Error("implementation rerun should not be queried when remediation is incomplete");
        }
      } as never,
      startStoryReviewRemediation: async () => ({
        storyReviewRemediationRunId: "story_review_remediation_run_1",
        remediationWaveStoryExecutionId: "wave_story_execution_2",
        status: "review_required"
      })
    });

    await expect(
      service.remediateImplementationReview({
        review: {
          findings: [
            {
              sourceSystem: "story_review",
              normalizedSeverity: "medium"
            }
          ]
        } as never,
        waveStoryExecutionId: "wave_story_execution_1",
        interactionMode: "auto"
      })
    ).rejects.toMatchObject({
      code: "IMPLEMENTATION_REVIEW_REMEDIATION_INCOMPLETE"
    });
  });
});
