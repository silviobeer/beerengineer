import type { PlanningReviewAutomationLevel, ReviewFindingSeverity, ReviewGateDecision } from "../domain/types.js";
import type { ReviewCoreService } from "../review/review-core-service.js";
import type { ReviewProviderResult } from "../review/types.js";
import { QualityKnowledgeReviewProvider } from "../review/providers/quality-knowledge-review-provider.js";
import { SonarcloudReviewProvider } from "../review/providers/sonarcloud-review-provider.js";
import { StoryReviewProvider } from "../review/providers/story-review-provider.js";
import { VerificationSignalProvider } from "../review/providers/verification-signal-provider.js";
import type { WorkflowDeps } from "./workflow-deps.js";
import { AppError } from "../shared/errors.js";

type ImplementationReviewServiceOptions = {
  deps: WorkflowDeps;
  reviewCoreService: ReviewCoreService;
};

function normalizeSeverity(value: string): ReviewFindingSeverity {
  switch (value.toLowerCase()) {
    case "blocker":
    case "critical":
      return "critical";
    case "high":
    case "major":
      return "high";
    case "medium":
    case "minor":
      return "medium";
    default:
      return "low";
  }
}

function mapGateDecision(input: { findings: ReviewProviderResult["findings"]; automationLevel: PlanningReviewAutomationLevel }): ReviewGateDecision {
  if (input.findings.length === 0) {
    return "pass";
  }
  const hasCritical = input.findings.some((finding) => finding.normalizedSeverity === "critical" || finding.normalizedSeverity === "high");
  if (hasCritical) {
    return input.automationLevel === "auto_gate" ? "blocked" : "needs_human_review";
  }
  return "advisory";
}

export class ImplementationReviewService {
  private readonly storyReviewProvider: StoryReviewProvider;
  private readonly verificationSignalProvider: VerificationSignalProvider;
  private readonly qualityKnowledgeProvider: QualityKnowledgeReviewProvider;
  private readonly sonarcloudProvider: SonarcloudReviewProvider;

  public constructor(private readonly options: ImplementationReviewServiceOptions) {
    this.storyReviewProvider = new StoryReviewProvider(options.deps);
    this.verificationSignalProvider = new VerificationSignalProvider(options.deps);
    this.qualityKnowledgeProvider = new QualityKnowledgeReviewProvider(options.deps);
    this.sonarcloudProvider = new SonarcloudReviewProvider(options.deps);
  }

  public startReview(input: {
    waveStoryExecutionId: string;
    automationLevel?: PlanningReviewAutomationLevel;
  }) {
    const execution = this.options.deps.waveStoryExecutionRepository.getById(input.waveStoryExecutionId);
    if (!execution) {
      throw new AppError("WAVE_STORY_EXECUTION_NOT_FOUND", `Wave story execution ${input.waveStoryExecutionId} not found`);
    }
    const story = this.options.deps.userStoryRepository.getById(execution.storyId);
    if (!story) {
      throw new AppError("STORY_NOT_FOUND", `Story ${execution.storyId} not found`);
    }
    const waveStory = this.options.deps.waveStoryRepository.getByStoryId(story.id);
    if (!waveStory) {
      throw new AppError("WAVE_STORY_NOT_FOUND", `Wave story for story ${story.id} not found`);
    }
    const wave = this.options.deps.waveRepository.getById(waveStory.waveId);
    if (!wave) {
      throw new AppError("WAVE_NOT_FOUND", `Wave ${waveStory.waveId} not found`);
    }
    const implementationPlan = this.options.deps.implementationPlanRepository.getById(wave.implementationPlanId);
    if (!implementationPlan) {
      throw new AppError("IMPLEMENTATION_PLAN_NOT_FOUND", `Implementation plan ${wave.implementationPlanId} not found`);
    }
    const project = this.options.deps.projectRepository.getById(implementationPlan.projectId);
    if (!project) {
      throw new AppError("PROJECT_NOT_FOUND", `Project ${implementationPlan.projectId} not found`);
    }

    const storyReviewProviderResult = this.storyReviewProvider.provide(execution.id);
    const storyFilePaths = Array.from(
      new Set(storyReviewProviderResult.findings.map((finding) => finding.filePath).filter((value): value is string => Boolean(value)))
    );
    const storyModules = Array.from(new Set(storyFilePaths.map((filePath) => filePath.split("/").slice(0, 2).join("/")).filter(Boolean)));

    const providers: ReviewProviderResult[] = [
      storyReviewProviderResult,
      this.verificationSignalProvider.provide(execution.id),
      this.qualityKnowledgeProvider.provide({
        providerId: "coderabbit",
        projectId: project.id,
        waveId: wave.id,
        storyId: story.id,
        filePaths: storyFilePaths,
        modules: storyModules
      }),
      this.sonarcloudProvider.provide(storyFilePaths)
    ].filter((provider) => provider.findings.length > 0);

    const allFindings = providers.flatMap((provider) => provider.findings);
    const gateDecision = mapGateDecision({
      findings: providers.flatMap((provider) =>
        provider.findings.map((finding) => ({
          ...finding,
          sourceSystem: provider.sourceSystem
        }))
      ),
      automationLevel: input.automationLevel ?? "manual"
    });
    const status = gateDecision === "pass" ? "complete" : gateDecision === "blocked" ? "blocked" : "action_required";
    const readiness = gateDecision === "pass" ? "ready" : gateDecision === "blocked" ? "needs_human_review" : "review_required";
    const summary =
      gateDecision === "pass"
        ? "Implementation review completed without actionable issues."
        : gateDecision === "blocked"
          ? "Implementation review found issues severe enough to block auto-gated progression."
          : "Implementation review found follow-up issues that should be addressed before progressing.";
    const recommendedAction =
      gateDecision === "pass"
        ? "Proceed with the next workflow step."
        : gateDecision === "blocked"
          ? "Escalate the implementation findings and resolve them before continuing."
          : "Review the aggregated findings, remediate them, and rerun the implementation review.";

    return this.options.reviewCoreService.recordReview({
      reviewKind: "implementation",
      subjectType: "wave_story_execution",
      subjectId: execution.id,
      subjectStep: "implementation",
      status,
      readiness,
      interactionMode: "auto",
      reviewMode: "readiness",
      automationLevel: input.automationLevel ?? "manual",
      requestedMode: null,
      actualMode: "minimal_review",
      confidence: providers.length >= 3 ? "high" : providers.length >= 2 ? "medium" : "low",
      gateEligibility: "advisory_only",
      sourceSummary: {
        waveStoryExecutionId: execution.id,
        storyId: story.id,
        storyCode: story.code,
        projectId: project.id,
        projectCode: project.code,
        waveId: wave.id,
        providerIds: providers.map((provider) => provider.providerId),
        filePaths: storyFilePaths,
        modules: storyModules
      },
      providersUsed: providers.map((provider) => provider.providerId),
      missingCapabilities: providers.some((provider) => provider.sourceSystem === "llm") ? [] : ["llm_review_not_enabled"],
      summary,
      keyPoints: allFindings.slice(0, 7).map((finding) => finding.title),
      disagreements: [],
      recommendedAction,
      gateDecision,
      findings: providers.flatMap((provider) =>
        provider.findings.map((finding) => ({
          ...finding,
          sourceSystem: provider.sourceSystem
        }))
      ),
      knowledgeContext: {
        source: "implementation_review",
        workspaceId: this.options.deps.workspace.id,
        projectId: project.id,
        waveId: wave.id,
        storyId: story.id
      }
    });
  }

  public showReview(runId: string) {
    return this.options.reviewCoreService.showReview(runId);
  }
}
