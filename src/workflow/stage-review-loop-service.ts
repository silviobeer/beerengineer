import type { StageKey } from "../domain/types.js";
import { AppError } from "../shared/errors.js";
import type { ReviewCoreService } from "../review/review-core-service.js";
import type { WorkflowDeps } from "./workflow-deps.js";
import type { StageOwnedReviewFeedback } from "./stage-owned-review-feedback.js";

const MAX_STAGE_REVISIONS = 3;

export type StageReviewFeedback = StageOwnedReviewFeedback;

export type StageLoopInput = {
  stageKey: StageKey;
  itemId: string;
  projectId?: string;
  userClarifications?: string[];
  reviewFeedback?: StageReviewFeedback[];
};

export type StageLoopResult = {
  runId: string;
  status: string;
  question?: string | null;
  followUpHint?: string | null;
  planningReview?: unknown;
};

export class StageReviewLoopService {
  public constructor(
    private readonly options: {
      deps: WorkflowDeps;
      reviewCoreService: ReviewCoreService;
      triggerPlanningReview?(input: {
        sourceType: "architecture_plan" | "implementation_plan";
        sourceId: string;
        step: "architecture" | "plan_writing";
        reviewMode: "readiness";
        interactionMode: "interactive";
        automationLevel: "auto_comment";
      }): Promise<unknown>;
      executeAttempt(input: StageLoopInput): Promise<StageLoopResult>;
    }
  ) {}

  public async run(input: StageLoopInput): Promise<StageLoopResult> {
    if (!input.projectId || input.stageKey === "brainstorm" || input.stageKey === "requirements" || !this.options.triggerPlanningReview) {
      return this.options.executeAttempt(input);
    }

    let reviewFeedback = [...(input.reviewFeedback ?? [])];
    while (true) {
      const result = await this.options.executeAttempt({
        ...input,
        reviewFeedback
      });
      if (result.status !== "completed") {
        return result;
      }

      const reviewSource = this.resolveReviewSource(input.stageKey, input.projectId);
      if (!reviewSource) {
        return result;
      }

      const planningReview = await this.options.triggerPlanningReview({
        sourceType: reviewSource.sourceType,
        sourceId: reviewSource.sourceId,
        step: reviewSource.step,
        reviewMode: "readiness",
        interactionMode: "interactive",
        automationLevel: "auto_comment"
      });
      const latestReviewRun = this.options.deps.reviewRunRepository.getLatestBySubject({
        reviewKind: "planning",
        subjectType: reviewSource.sourceType,
        subjectId: reviewSource.sourceId
      });
      if (!latestReviewRun || this.options.reviewCoreService.isReadyForGate(latestReviewRun)) {
        return {
          ...result,
          planningReview
        };
      }

      const feedback = this.buildReviewFeedback(input.stageKey, latestReviewRun.id);
      reviewFeedback = [...reviewFeedback, feedback];
      if (reviewFeedback.length > MAX_STAGE_REVISIONS) {
        return {
          ...result,
          status: "needs_user_input",
          question:
            feedback.openQuestions[0]?.question
            ?? "What missing information should resolve the remaining planning review concerns for this stage?",
          followUpHint:
            feedback.recommendedAction
            ?? feedback.findings[0]?.detail
            ?? "Clarify the remaining planning review concerns so the stage can produce a final revision.",
          planningReview
        };
      }
    }
  }

  private resolveReviewSource(
    stageKey: StageKey,
    projectId: string
  ): { sourceType: "architecture_plan" | "implementation_plan"; sourceId: string; step: "architecture" | "plan_writing" } | null {
    if (stageKey === "architecture") {
      const latest = this.options.deps.architecturePlanRepository.getLatestByProjectId(projectId);
      return latest
        ? {
            sourceType: "architecture_plan",
            sourceId: latest.id,
            step: "architecture"
          }
        : null;
    }
    if (stageKey === "planning") {
      const latest = this.options.deps.implementationPlanRepository.getLatestByProjectId(projectId);
      return latest
        ? {
            sourceType: "implementation_plan",
            sourceId: latest.id,
            step: "plan_writing"
          }
        : null;
    }
    return null;
  }

  private buildReviewFeedback(stageKey: StageKey, reviewRunId: string): StageReviewFeedback {
    const run = this.options.deps.reviewRunRepository.getById(reviewRunId);
    if (!run) {
      throw new AppError("PLANNING_REVIEW_RUN_NOT_FOUND", `Planning review run ${reviewRunId} not found`);
    }
    const findings = this.options.deps.reviewFindingRepository.listByRunId(reviewRunId);
    const questions = this.options.deps.reviewQuestionRepository.listByRunId(reviewRunId).filter((question) => question.status === "open");
    const synthesis = this.options.deps.reviewSynthesisRepository.getLatestByRunId(reviewRunId);
    return {
      reviewRunId,
      stageKey,
      status: run.status,
      readiness: run.readiness,
      summary: run.reviewSummary ?? "Planning review requires another revision.",
      recommendedAction: synthesis?.recommendedAction ?? null,
      findings: findings.map((finding) => ({
        type: finding.findingType,
        title: finding.title,
        detail: finding.detail,
        evidence: finding.evidence ?? null
      })),
      openQuestions: questions.map((question) => ({
        question: question.question,
        reason: question.reason ?? null,
        impact: question.impact ?? null
      }))
    };
  }
}
