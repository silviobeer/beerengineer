import type {
  ImplementationReviewProviderRole,
  PlanningReviewAutomationLevel,
  ReviewFindingSeverity,
  ReviewGateDecision,
  ReviewInteractionMode,
  ReviewSourceSystem
} from "../domain/types.js";
import type { ReviewCoreService } from "../review/review-core-service.js";
import { ReviewExecutionPlanner } from "../review/review-execution-planner.js";
import { CoderabbitReviewProvider } from "../review/providers/coderabbit-review-provider.js";
import { SonarcloudReviewProvider } from "../review/providers/sonarcloud-review-provider.js";
import { StoryReviewProvider } from "../review/providers/story-review-provider.js";
import { VerificationSignalProvider } from "../review/providers/verification-signal-provider.js";
import type { ImplementationReviewProviderResult, ReviewProviderResult } from "../review/types.js";
import { implementationReviewOutputSchema } from "../schemas/output-contracts.js";
import { AppError } from "../shared/errors.js";
import type { WorkflowDeps } from "./workflow-deps.js";
import type { ReviewRemediationService } from "./review-remediation-service.js";
import type { ResolvedWorkerProfile } from "./runtime-types.js";

type ImplementationReviewServiceOptions = {
  deps: WorkflowDeps;
  reviewCoreService: ReviewCoreService;
  reviewRemediationService: ReviewRemediationService;
  resolveWorkerProfile(profileKey: "implementationReview"): ResolvedWorkerProfile;
  buildAdapterRuntimeContext(input: {
    providerKey: string;
    model: string | null;
    policy: {
      autonomyMode: "manual" | "yolo";
      approvalMode: "always" | "never";
      filesystemMode: "read-only" | "workspace-write" | "danger-full-access";
      networkMode: "disabled" | "enabled";
      interactionMode: "blocking" | "non_blocking";
    };
  }): {
    provider: string;
    model: string | null;
    policy: {
      autonomyMode: "manual" | "yolo";
      approvalMode: "always" | "never";
      filesystemMode: "read-only" | "workspace-write" | "danger-full-access";
      networkMode: "disabled" | "enabled";
      interactionMode: "blocking" | "non_blocking";
    };
    workspaceRoot: string;
  };
};

type LoadedExecutionContext = {
  execution: NonNullable<ReturnType<WorkflowDeps["waveStoryExecutionRepository"]["getById"]>>;
  story: NonNullable<ReturnType<WorkflowDeps["userStoryRepository"]["getById"]>>;
  waveStory: NonNullable<ReturnType<WorkflowDeps["waveStoryRepository"]["getByStoryId"]>>;
  wave: NonNullable<ReturnType<WorkflowDeps["waveRepository"]["getById"]>>;
  implementationPlan: NonNullable<ReturnType<WorkflowDeps["implementationPlanRepository"]["getById"]>>;
  project: NonNullable<ReturnType<WorkflowDeps["projectRepository"]["getById"]>>;
  item: NonNullable<ReturnType<WorkflowDeps["itemRepository"]["getById"]>>;
  acceptanceCriteria: ReturnType<WorkflowDeps["acceptanceCriterionRepository"]["listByStoryId"]>;
  projectExecutionContext: NonNullable<ReturnType<WorkflowDeps["projectExecutionContextRepository"]["getByProjectId"]>>;
  implementationSummary: Record<string, unknown> | null;
  basicVerificationStatus: "passed" | "review_required" | "failed" | null;
  basicVerificationSummary: Record<string, unknown> | null;
  ralphVerificationStatus: "passed" | "review_required" | "failed" | null;
  ralphVerificationSummary: Record<string, unknown> | null;
  appVerificationStatus: "pending" | "preparing" | "in_progress" | "passed" | "review_required" | "failed" | null;
  appVerificationSummary: Record<string, unknown> | null;
  latestStoryReviewRun: ReturnType<WorkflowDeps["storyReviewRunRepository"]["getLatestByWaveStoryExecutionId"]>;
  latestStoryReviewSummary: Record<string, unknown> | null;
  latestStoryReviewFindings: ReturnType<WorkflowDeps["storyReviewFindingRepository"]["listByStoryReviewRunId"]>;
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

function parseStoredJson(value: string | null): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function mapLlmResultToProviderResult(input: {
  providerId: string;
  reviewerRole: ImplementationReviewProviderRole;
  result: ImplementationReviewProviderResult;
}): ReviewProviderResult {
  return {
    providerId: input.providerId,
    sourceSystem: "llm",
    summary: input.result.summary,
    findings: input.result.findings.map((finding) => ({
      reviewerRole: input.reviewerRole,
      findingType: finding.category,
      normalizedSeverity: finding.severity,
      sourceSeverity: finding.remediationClass ?? finding.category,
      title: finding.title,
      detail: finding.description,
      evidence: finding.evidence,
      filePath: finding.filePath ?? null,
      line: finding.line ?? null,
      fieldPath: null
    }))
  };
}

function mapGateDecision(input: {
  findings: Array<ReviewProviderResult["findings"][number] & { sourceSystem: ReviewSourceSystem }>;
  interactionMode: ReviewInteractionMode;
  automationLevel: PlanningReviewAutomationLevel;
  missingCapabilities: string[];
}): ReviewGateDecision {
  if (input.findings.length === 0) {
    return input.missingCapabilities.length > 0 && input.interactionMode === "auto" ? "needs_human_review" : "pass";
  }
  const hasCritical = input.findings.some((finding) => finding.normalizedSeverity === "critical");
  if (hasCritical) {
    return "blocked";
  }
  const hasHigh = input.findings.some((finding) => finding.normalizedSeverity === "high");
  if (hasHigh) {
    return input.interactionMode === "auto" || input.automationLevel === "auto_gate" ? "needs_human_review" : "advisory";
  }
  return "advisory";
}

export class ImplementationReviewService {
  private readonly executionPlanner: ReviewExecutionPlanner;
  private readonly storyReviewProvider: StoryReviewProvider;
  private readonly verificationSignalProvider: VerificationSignalProvider;
  private readonly coderabbitProvider: CoderabbitReviewProvider;
  private readonly sonarcloudProvider: SonarcloudReviewProvider;

  public constructor(private readonly options: ImplementationReviewServiceOptions) {
    this.executionPlanner = new ReviewExecutionPlanner(options.deps.agentRuntimeResolver, options.deps.workspaceRoot);
    this.storyReviewProvider = new StoryReviewProvider(options.deps);
    this.verificationSignalProvider = new VerificationSignalProvider(options.deps);
    this.coderabbitProvider = new CoderabbitReviewProvider(options.deps);
    this.sonarcloudProvider = new SonarcloudReviewProvider(options.deps);
  }

  public async startReview(input: {
    waveStoryExecutionId: string;
    automationLevel?: PlanningReviewAutomationLevel;
    interactionMode?: ReviewInteractionMode;
  }) {
    const resolvedWorkerProfile = this.options.resolveWorkerProfile("implementationReview");
    const context = this.loadExecutionContext(input.waveStoryExecutionId);
    const interactionMode = this.resolveInteractionMode(input.interactionMode);
    const automationLevel = input.automationLevel ?? "manual";
    const toolProviders = this.collectToolProviders(context);
    const llmCapability = this.executionPlanner.planDualRoleReview({
      roles: ["implementation_reviewer", "regression_reviewer"],
      preferCodexFor: ["implementation_reviewer"],
      preferClaudeFor: ["regression_reviewer"],
      unavailableCode: "IMPLEMENTATION_REVIEW_PROVIDER_UNAVAILABLE"
    });
    const llmProviders = await this.runLlmProviders(
      context,
      llmCapability.assignments,
      toolProviders,
      resolvedWorkerProfile
    );
    const providers = [...toolProviders, ...llmProviders].filter((provider) => provider.findings.length > 0);
    const findings = providers.flatMap((provider) =>
      provider.findings.map((finding) => ({
        ...finding,
        sourceSystem: provider.sourceSystem
      }))
    );
    const missingCapabilities = [...llmCapability.missingCapabilities];
    if (llmProviders.length === 0) {
      missingCapabilities.push("llm_review_not_enabled");
    }
    const gateDecision = mapGateDecision({
      findings,
      interactionMode,
      automationLevel,
      missingCapabilities
    });
    const review = this.options.reviewCoreService.recordReview({
      reviewKind: "implementation",
      subjectType: "wave_story_execution",
      subjectId: context.execution.id,
      subjectStep: "implementation",
      status: gateDecision === "pass" ? "complete" : gateDecision === "blocked" ? "blocked" : "action_required",
      readiness: gateDecision === "pass" ? "ready" : gateDecision === "advisory" ? "review_required" : "needs_human_review",
      interactionMode,
      reviewMode: "readiness",
      automationLevel,
      requestedMode: llmCapability.requestedMode,
      actualMode: llmCapability.actualMode,
      confidence: llmCapability.confidence,
      gateEligibility: llmCapability.gateEligibility,
      sourceSummary: {
        waveStoryExecutionId: context.execution.id,
        storyId: context.story.id,
        storyCode: context.story.code,
        projectId: context.project.id,
        projectCode: context.project.code,
        waveId: context.wave.id,
        providerIds: providers.map((provider) => provider.providerId),
        filePaths: this.collectFilePaths(toolProviders),
        modules: this.collectModules(toolProviders)
      },
      providersUsed: providers.map((provider) => provider.providerId),
      missingCapabilities: Array.from(new Set(missingCapabilities)),
      summary: this.buildSummary(gateDecision, findings.length),
      keyPoints: findings.slice(0, 7).map((finding) => finding.title),
      disagreements: [],
      recommendedAction: this.buildRecommendedAction(gateDecision, interactionMode),
      gateDecision,
      findings,
      assumptions: llmProviders.flatMap((provider) =>
        provider.providerMetadata && Array.isArray(provider.providerMetadata.assumptions)
          ? (provider.providerMetadata.assumptions as Array<{ statement: string; reason: string; source: string }>)
          : []
      ),
      knowledgeContext: {
        workspaceId: this.options.deps.workspace.id,
        projectId: context.project.id,
        waveId: context.wave.id,
        storyId: context.story.id
      }
    });

    return this.options.reviewRemediationService.remediateImplementationReview({
      review,
      waveStoryExecutionId: context.execution.id,
      interactionMode
    });
  }

  public showReview(runId: string) {
    return this.options.reviewCoreService.showReview(runId);
  }

  private loadExecutionContext(waveStoryExecutionId: string): LoadedExecutionContext {
    const execution = this.options.deps.waveStoryExecutionRepository.getById(waveStoryExecutionId);
    if (!execution) {
      throw new AppError("WAVE_STORY_EXECUTION_NOT_FOUND", `Wave story execution ${waveStoryExecutionId} not found`);
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
    const item = this.options.deps.itemRepository.getById(project.itemId);
    if (!item) {
      throw new AppError("ITEM_NOT_FOUND", `Item ${project.itemId} not found`);
    }
    const projectExecutionContext = this.options.deps.projectExecutionContextRepository.getByProjectId(project.id);
    if (!projectExecutionContext) {
      throw new AppError("PROJECT_EXECUTION_CONTEXT_NOT_FOUND", `Project execution context ${project.id} not found`);
    }
    const acceptanceCriteria = this.options.deps.acceptanceCriterionRepository.listByStoryId(story.id);
    const latestStoryReviewRun = this.options.deps.storyReviewRunRepository.getLatestByWaveStoryExecutionId(execution.id);
    const latestStoryReviewFindings = latestStoryReviewRun
      ? this.options.deps.storyReviewFindingRepository.listByStoryReviewRunId(latestStoryReviewRun.id)
      : [];
    const latestBasicVerification = this.options.deps.verificationRunRepository.getLatestByWaveStoryExecutionIdAndMode(execution.id, "basic");
    const latestRalphVerification = this.options.deps.verificationRunRepository.getLatestByWaveStoryExecutionIdAndMode(execution.id, "ralph");
    const latestAppVerification = this.options.deps.appVerificationRunRepository.getLatestByWaveStoryExecutionId(execution.id);
    return {
      execution,
      story,
      waveStory,
      wave,
      implementationPlan,
      project,
      item,
      acceptanceCriteria,
      projectExecutionContext,
      implementationSummary: parseStoredJson(execution.outputSummaryJson),
      basicVerificationStatus: latestBasicVerification?.status ?? null,
      basicVerificationSummary: parseStoredJson(latestBasicVerification?.summaryJson ?? null),
      ralphVerificationStatus: latestRalphVerification?.status ?? null,
      ralphVerificationSummary: parseStoredJson(latestRalphVerification?.summaryJson ?? null),
      appVerificationStatus: latestAppVerification?.status ?? null,
      appVerificationSummary: parseStoredJson(latestAppVerification?.resultJson ?? null),
      latestStoryReviewRun,
      latestStoryReviewSummary: parseStoredJson(latestStoryReviewRun?.summaryJson ?? null),
      latestStoryReviewFindings
    };
  }

  private collectToolProviders(context: LoadedExecutionContext): ReviewProviderResult[] {
    const storyReviewProviderResult = this.storyReviewProvider.provide(context.execution.id);
    const storyFilePaths = this.collectFilePaths([storyReviewProviderResult]);
    const storyModules = Array.from(new Set(storyFilePaths.map((filePath) => filePath.split("/").slice(0, 2).join("/")).filter(Boolean)));
    return [
      storyReviewProviderResult,
      this.verificationSignalProvider.provide(context.execution.id),
      this.coderabbitProvider.provide({
        projectId: context.project.id,
        waveId: context.wave.id,
        storyId: context.story.id,
        storyCode: context.story.code,
        filePaths: storyFilePaths,
        modules: storyModules
      }),
      this.sonarcloudProvider.provide(storyFilePaths)
    ];
  }

  private collectFilePaths(providers: ReviewProviderResult[]): string[] {
    return Array.from(
      new Set(providers.flatMap((provider) => provider.findings.map((finding) => finding.filePath).filter((value): value is string => Boolean(value))))
    );
  }

  private collectModules(providers: ReviewProviderResult[]): string[] {
    return Array.from(new Set(this.collectFilePaths(providers).map((filePath) => filePath.split("/").slice(0, 2).join("/")).filter(Boolean)));
  }

  private async runLlmProviders(
    context: LoadedExecutionContext,
    assignments: Array<{ providerKey: string; role: ImplementationReviewProviderRole }>,
    toolProviders: ReviewProviderResult[],
    resolvedWorkerProfile: ResolvedWorkerProfile
  ): Promise<ReviewProviderResult[]> {
    return Promise.all(
      assignments.map(async (assignment) => {
        const runtime = this.options.deps.agentRuntimeResolver.resolveProvider(assignment.providerKey);
        const result = await runtime.adapter.runImplementationReview({
          runtime: this.options.buildAdapterRuntimeContext(runtime),
          interactionType: "implementation_review",
          prompt: resolvedWorkerProfile.promptContent,
          skills: resolvedWorkerProfile.skills,
          reviewerRole: assignment.role,
          item: {
            id: context.item.id,
            code: context.item.code,
            title: context.item.title,
            description: context.item.description
          },
          project: {
            id: context.project.id,
            code: context.project.code,
            title: context.project.title,
            summary: context.project.summary,
            goal: context.project.goal
          },
          implementationPlan: {
            id: context.implementationPlan.id,
            summary: context.implementationPlan.summary,
            version: context.implementationPlan.version
          },
          wave: {
            id: context.wave.id,
            code: context.wave.code,
            goal: context.wave.goal,
            position: context.wave.position
          },
          story: {
            id: context.story.id,
            code: context.story.code,
            title: context.story.title,
            description: context.story.description,
            actor: context.story.actor,
            goal: context.story.goal,
            benefit: context.story.benefit,
            priority: context.story.priority
          },
          acceptanceCriteria: context.acceptanceCriteria,
          projectExecutionContext: {
            relevantDirectories: context.projectExecutionContext.relevantDirectories,
            relevantFiles: context.projectExecutionContext.relevantFiles,
            integrationPoints: context.projectExecutionContext.integrationPoints,
            testLocations: context.projectExecutionContext.testLocations,
            repoConventions: context.projectExecutionContext.repoConventions,
            executionNotes: context.projectExecutionContext.executionNotes
          },
          implementation: {
            summary: String(context.implementationSummary?.summary ?? ""),
            changedFiles: Array.isArray(context.implementationSummary?.changedFiles)
              ? (context.implementationSummary?.changedFiles as string[])
              : [],
            testsRun: Array.isArray(context.implementationSummary?.testsRun)
              ? (context.implementationSummary?.testsRun as Array<{ command: string; status: "passed" | "failed" | "not_run" }>)
              : [],
            implementationNotes: Array.isArray(context.implementationSummary?.implementationNotes)
              ? (context.implementationSummary?.implementationNotes as string[])
              : [],
            blockers: Array.isArray(context.implementationSummary?.blockers) ? (context.implementationSummary?.blockers as string[]) : []
          },
          basicVerification: {
            status: context.basicVerificationStatus,
            summary: context.basicVerificationSummary
          },
          ralphVerification: {
            status: context.ralphVerificationStatus,
            summary: context.ralphVerificationSummary
          },
          appVerification: {
            status: context.appVerificationStatus,
            summary: context.appVerificationSummary
          },
          latestStoryReview: {
            status: context.latestStoryReviewRun?.status ?? null,
            summary: context.latestStoryReviewSummary,
            findings: context.latestStoryReviewFindings.map((finding) => ({
              severity: finding.severity,
              category: finding.category,
              title: finding.title,
              description: finding.description,
              evidence: finding.evidence,
              filePath: finding.filePath,
              line: finding.line,
              suggestedFix: finding.suggestedFix
            }))
          },
          externalSignals: toolProviders.flatMap((provider) =>
            provider.findings.map((finding) => ({
              sourceSystem: provider.sourceSystem,
              reviewerRole: finding.reviewerRole ?? null,
              normalizedSeverity: finding.normalizedSeverity,
              findingType: finding.findingType,
              title: finding.title,
              detail: finding.detail,
              evidence: finding.evidence ?? null,
              filePath: finding.filePath ?? null,
              line: finding.line ?? null
            }))
          ),
          qualityKnowledge: this.options.deps.qualityKnowledgeEntryRepository
            .listRecurringByProjectId(context.project.id, 8)
            .map((entry) => ({
              source: entry.source,
              scopeType: entry.scopeType,
              scopeId: entry.scopeId,
              summary: entry.summary,
              status: entry.status
            }))
        });
        const parsed = implementationReviewOutputSchema.parse(result.output);
        return mapLlmResultToProviderResult({
          providerId: `${assignment.providerKey}:${assignment.role}`,
          reviewerRole: assignment.role,
          result: {
            reviewerRole: assignment.role,
            overallStatus: parsed.overallStatus,
            summary: parsed.summary,
            findings: parsed.findings.map((finding) => ({
              severity: normalizeSeverity(finding.severity),
              category: finding.category,
              title: finding.title,
              description: finding.description,
              evidence: finding.evidence,
              filePath: finding.filePath ?? null,
              line: finding.line ?? null,
              remediationClass: finding.remediationClass ?? undefined
            })),
            assumptions: parsed.assumptions,
            recommendations: parsed.recommendations
          }
        });
      })
    );
  }

  private resolveInteractionMode(override?: ReviewInteractionMode): ReviewInteractionMode {
    if (override) {
      return override;
    }
    const raw = this.options.deps.workspaceSettings.executionDefaultsJson;
    if (!raw) {
      return "auto";
    }
    try {
      const parsed = JSON.parse(raw) as { implementationReview?: { interactionMode?: ReviewInteractionMode } };
      return parsed.implementationReview?.interactionMode ?? "auto";
    } catch {
      return "auto";
    }
  }

  private buildSummary(gateDecision: ReviewGateDecision, findingCount: number): string {
    if (gateDecision === "pass") {
      return "Implementation review completed without actionable issues.";
    }
    if (gateDecision === "blocked") {
      return "Implementation review found blocking issues.";
    }
    if (gateDecision === "needs_human_review") {
      return `Implementation review found ${findingCount} issue(s) that still require human judgement.`;
    }
    return `Implementation review found ${findingCount} follow-up issue(s).`;
  }

  private buildRecommendedAction(gateDecision: ReviewGateDecision, interactionMode: ReviewInteractionMode): string {
    if (gateDecision === "pass") {
      return "Proceed with the next workflow step.";
    }
    if (interactionMode === "auto") {
      return gateDecision === "blocked"
        ? "Stop automatic progression and escalate the blocking findings."
        : "Apply safe remediations, rerun review, and escalate any remaining uncertainty.";
    }
    return gateDecision === "blocked"
      ? "Resolve the blocking findings before continuing."
      : "Review the findings, remediate them, and rerun the implementation review.";
  }
}
