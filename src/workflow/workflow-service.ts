import type {
  InteractiveReviewEntryStatus,
  InteractiveReviewResolutionType,
  StageKey,
  StoryReviewFindingSeverity
} from "../domain/types.js";
import { PromptResolver } from "../services/prompt-resolver.js";
import { ArtifactService } from "../services/artifact-service.js";
import { GitWorkflowService } from "../services/git-workflow-service.js";
import { ReviewCoreService } from "../review/review-core-service.js";
import { ralphVerificationOutputSchema, storyReviewOutputSchema } from "../schemas/output-contracts.js";
import type { RalphVerificationOutput, StoryReviewOutput } from "../schemas/output-contracts.js";
import { AppError } from "../shared/errors.js";
import type {
  StoryReviewRunRepository,
  VerificationRunRepository,
  AcceptanceCriterionRepository
} from "../persistence/repositories.js";
import { workerProfiles, type WorkerProfileKey } from "./worker-profiles.js";
import type { AdapterRuntimeContext } from "../adapters/types.js";
import { runtimeWorkerKeyByProfileKey, type InteractiveFlowKey } from "../adapters/runtime.js";
import { AutorunOrchestrator } from "./autorun-orchestrator.js";
import type { AutorunSummary, AutorunStep } from "./autorun-types.js";
import type { WorkflowDeps } from "./workflow-deps.js";
import { createWorkflowEntityLoaders, type WorkflowEntityLoaders } from "./entity-loaders.js";
import { BrainstormService } from "./brainstorm-service.js";
import { DocumentationService } from "./documentation-service.js";
import { ExecutionService, type ExecutionView } from "./execution-service.js";
import { ImplementationReviewService } from "./implementation-review-service.js";
import { InteractiveReviewService } from "./interactive-review-service.js";
import { WorkflowOutputImporters } from "./output-importers.js";
import { PlanningReviewService } from "./planning-review-service.js";
import { QaService } from "./qa-service.js";
import { StageService } from "./stage-service.js";
import { VerificationService } from "./verification-service.js";
import { MAX_STORY_REVIEW_REMEDIATION_ATTEMPTS } from "./workflow-constants.js";

export class WorkflowService {
  private readonly promptResolver: PromptResolver;
  private readonly artifactService: ArtifactService;
  private readonly gitWorkflowService: GitWorkflowService;
  private readonly autorunOrchestrator: AutorunOrchestrator;
  private readonly entityLoaders: WorkflowEntityLoaders;
  private readonly brainstormService: BrainstormService;
  private readonly documentationService: DocumentationService;
  private readonly executionService: ExecutionService;
  private readonly implementationReviewService: ImplementationReviewService;
  private readonly interactiveReviewService: InteractiveReviewService;
  private readonly planningReviewService: PlanningReviewService;
  private readonly outputImporters: WorkflowOutputImporters;
  private readonly qaService: QaService;
  private readonly stageService: StageService;
  private readonly verificationService: VerificationService;
  private readonly reviewCoreService: ReviewCoreService;

  public constructor(private readonly deps: WorkflowDeps) {
    this.promptResolver = new PromptResolver(deps.repoRoot);
    this.artifactService = new ArtifactService(deps.artifactRoot);
    this.gitWorkflowService = new GitWorkflowService(deps.workspaceRoot);
    this.reviewCoreService = new ReviewCoreService(deps);
    this.entityLoaders = createWorkflowEntityLoaders(deps);
    // Cross-service callbacks intentionally capture `this.*Service` lazily.
    // They must not be invoked during sub-service construction.
    this.outputImporters = new WorkflowOutputImporters(deps, {
      requireProject: (projectId) => this.entityLoaders.requireProject(projectId)
    });
    this.stageService = new StageService({
      deps,
      artifactService: this.artifactService,
      promptResolver: this.promptResolver,
      reviewCoreService: this.reviewCoreService,
      loaders: this.entityLoaders,
      outputImporters: this.outputImporters,
      resolveStageRuntime: (stageKey) => this.resolveStageRuntime(stageKey),
      buildAdapterRuntimeContext: (input) => this.buildAdapterRuntimeContext(input),
      triggerPlanningReview: (input) => this.planningReviewService.startReview(input)
    });
    this.brainstormService = new BrainstormService({
      deps,
      artifactService: this.artifactService,
      loaders: {
        requireItem: (itemId) => this.entityLoaders.requireItem(itemId),
        requireBrainstormSession: (sessionId) => this.entityLoaders.requireBrainstormSession(sessionId),
        requireLatestBrainstormDraft: (sessionId) => this.entityLoaders.requireLatestBrainstormDraft(sessionId)
      },
      approveConcept: (conceptId) => this.stageService.approveConcept(conceptId),
      triggerPlanningReview: (input) => this.planningReviewService.startReview(input),
      autorunForItem: (input) => this.autorunForItem(input)
    });
    this.documentationService = new DocumentationService({
      deps,
      loaders: {
        requireProject: (projectId) => this.entityLoaders.requireProject(projectId),
        requireItem: (itemId) => this.entityLoaders.requireItem(itemId),
        requireImplementationPlanForProject: (projectId) => this.entityLoaders.requireImplementationPlanForProject(projectId),
        requireDocumentationRun: (documentationRunId) => this.entityLoaders.requireDocumentationRun(documentationRunId)
      },
      resolveWorkerProfile: (profileKey) => this.resolveWorkerProfile(profileKey),
      resolveWorkerRuntime: (profileKey) => this.resolveWorkerRuntime(profileKey),
      buildAdapterRuntimeContext: (input) => this.buildAdapterRuntimeContext(input),
      ensureProjectExecutionContext: (project, implementationPlan) =>
        this.executionService.ensureProjectExecutionContext(project, implementationPlan),
      parseTestPreparationOutput: (testRun) => this.executionService.parseTestPreparationOutput(testRun),
      parseStoryExecutionOutput: (execution) => this.executionService.parseStoryExecutionOutput(execution),
      parseRalphVerificationOutput: (verificationRun) => this.parseRalphVerificationOutput(verificationRun),
      parseStoryReviewOutput: (storyReviewRun) => this.parseStoryReviewOutput(storyReviewRun),
      persistArtifacts: (input) => this.stageService.persistArtifacts(input),
      buildSnapshot: (itemId) => this.stageService.buildSnapshot(itemId)
    });
    this.executionService = new ExecutionService({
      deps,
      loaders: {
        requireProject: (projectId) => this.entityLoaders.requireProject(projectId),
        requireItem: (itemId) => this.entityLoaders.requireItem(itemId),
        requireImplementationPlanForProject: (projectId) => this.entityLoaders.requireImplementationPlanForProject(projectId),
        requireWave: (waveId) => this.entityLoaders.requireWave(waveId),
        requireWaveExecution: (waveExecutionId) => this.entityLoaders.requireWaveExecution(waveExecutionId),
        requireWaveStory: (waveStoryId) => this.entityLoaders.requireWaveStory(waveStoryId),
        requireWaveStoryByStoryId: (storyId) => this.entityLoaders.requireWaveStoryByStoryId(storyId),
        requireWaveStoryExecution: (waveStoryExecutionId) => this.entityLoaders.requireWaveStoryExecution(waveStoryExecutionId),
        requireWaveStoryTestRun: (waveStoryTestRunId) => this.entityLoaders.requireWaveStoryTestRun(waveStoryTestRunId),
        requireStory: (storyId) => this.entityLoaders.requireStory(storyId)
      },
      resolveWorkerProfile: (profileKey) => this.resolveWorkerProfile(profileKey),
      resolveWorkerRuntime: (profileKey) => this.resolveWorkerRuntime(profileKey),
      buildAdapterRuntimeContext: (input) => this.buildAdapterRuntimeContext(input),
      ensureProjectBranch: (projectCode) => this.gitWorkflowService.ensureProjectBranch(projectCode),
      ensureStoryBranch: (projectCode, storyCode) => this.gitWorkflowService.ensureStoryBranch(projectCode, storyCode),
      executeVerificationPipeline: (input) => this.verificationService.executeVerificationPipeline(input)
    });
    this.interactiveReviewService = new InteractiveReviewService({
      deps,
      loaders: {
        requireProject: (projectId) => this.entityLoaders.requireProject(projectId),
        requireItem: (itemId) => this.entityLoaders.requireItem(itemId),
        requireStory: (storyId) => this.entityLoaders.requireStory(storyId),
        requireInteractiveReviewSession: (sessionId) => this.entityLoaders.requireInteractiveReviewSession(sessionId)
      },
      resolveInteractiveRuntime: (flow) => this.resolveInteractiveRuntime(flow),
      buildAdapterRuntimeContext: (input) => this.buildAdapterRuntimeContext(input),
      approveStories: (projectId) => this.stageService.approveStories(projectId),
      buildSnapshot: (itemId) => this.stageService.buildSnapshot(itemId),
      autorunForProject: (input) => this.autorunForProject(input),
      triggerPlanningReview: (input) => this.planningReviewService.startReview(input)
    });
    this.planningReviewService = new PlanningReviewService({
      deps,
      reviewCoreService: this.reviewCoreService,
      buildAdapterRuntimeContext: (input) => this.buildAdapterRuntimeContext(input)
    });
    this.implementationReviewService = new ImplementationReviewService({
      deps,
      reviewCoreService: this.reviewCoreService
    });
    this.qaService = new QaService({
      deps,
      reviewCoreService: this.reviewCoreService,
      loaders: {
        requireProject: (projectId) => this.entityLoaders.requireProject(projectId),
        requireItem: (itemId) => this.entityLoaders.requireItem(itemId),
        requireImplementationPlanForProject: (projectId) => this.entityLoaders.requireImplementationPlanForProject(projectId),
        requireQaRun: (qaRunId) => this.entityLoaders.requireQaRun(qaRunId)
      },
      resolveWorkerProfile: (profileKey) => this.resolveWorkerProfile(profileKey),
      resolveWorkerRuntime: (profileKey) => this.resolveWorkerRuntime(profileKey),
      buildAdapterRuntimeContext: (input) => this.buildAdapterRuntimeContext(input),
      ensureProjectExecutionContext: (project, implementationPlan) =>
        this.executionService.ensureProjectExecutionContext(project, implementationPlan),
      groupAcceptanceCriteriaByStoryId: (projectId) => this.groupAcceptanceCriteriaByStoryId(projectId),
      mirrorQaReview: (input) => this.mirrorQaReview(input)
    });
    this.verificationService = new VerificationService({
      deps,
      loaders: {
        requireWaveStoryExecution: (waveStoryExecutionId) => this.entityLoaders.requireWaveStoryExecution(waveStoryExecutionId),
        requireStory: (storyId) => this.entityLoaders.requireStory(storyId),
        requireProject: (projectId) => this.entityLoaders.requireProject(projectId),
        requireImplementationPlanForProject: (projectId) => this.entityLoaders.requireImplementationPlanForProject(projectId),
        requireWaveExecution: (waveExecutionId) => this.entityLoaders.requireWaveExecution(waveExecutionId),
        requireWave: (waveId) => this.entityLoaders.requireWave(waveId),
        requireWaveStory: (waveStoryId) => this.entityLoaders.requireWaveStory(waveStoryId),
        requireItem: (itemId) => this.entityLoaders.requireItem(itemId),
        requireWaveStoryTestRun: (waveStoryTestRunId) => this.entityLoaders.requireWaveStoryTestRun(waveStoryTestRunId),
        requireAppVerificationRun: (appVerificationRunId) => this.entityLoaders.requireAppVerificationRun(appVerificationRunId),
        requireStoryReviewRun: (storyReviewRunId) => this.entityLoaders.requireStoryReviewRun(storyReviewRunId),
        requireStoryReviewRemediationRun: (storyReviewRemediationRunId) =>
          this.entityLoaders.requireStoryReviewRemediationRun(storyReviewRemediationRunId)
      },
      resolveWorkerProfile: (profileKey) => this.resolveWorkerProfile(profileKey),
      resolveWorkerRuntime: (profileKey) => this.resolveWorkerRuntime(profileKey),
      buildAdapterRuntimeContext: (input) => this.buildAdapterRuntimeContext(input),
      ensureProjectExecutionContext: (project, implementationPlan) =>
        this.executionService.ensureProjectExecutionContext(project, implementationPlan),
      buildStoryRunContext: (input) => this.executionService.buildStoryRunContext(input),
      parseTestPreparationOutput: (testRun) => this.executionService.parseTestPreparationOutput(testRun),
      parseStoryExecutionOutput: (execution) => this.executionService.parseStoryExecutionOutput(execution),
      refreshWaveExecutionStatus: (waveExecutionId) => this.executionService.refreshWaveExecutionStatus(waveExecutionId),
      executeWaveStory: (input) => this.executionService.executeWaveStory(input),
      ensureStoryRemediationBranch: (projectCode, storyCode, storyReviewRunId) =>
        this.gitWorkflowService.ensureStoryRemediationBranch(projectCode, storyCode, storyReviewRunId),
      invalidateDocumentationForProject: (projectId, reason) => this.invalidateDocumentationForProject(projectId, reason),
      mirrorStoryReview: (input) => this.mirrorStoryReview(input),
      triggerImplementationReview: (input) => Promise.resolve(this.startImplementationReview(input))
    });
    this.autorunOrchestrator = new AutorunOrchestrator({
      requireItem: (itemId) => this.entityLoaders.requireItem(itemId),
      requireProject: (projectId) => this.entityLoaders.requireProject(projectId),
      requireStoryReviewRunById: (storyReviewRunId) => this.entityLoaders.requireStoryReviewRun(storyReviewRunId),
      getLatestConceptByItemId: (itemId) => this.deps.conceptRepository.getLatestByItemId(itemId),
      getProjectsByItemId: (itemId) => this.deps.projectRepository.listByItemId(itemId),
      getLatestStageRun: (input) => this.stageService.getLatestStageRun(input),
      hasAnyStoriesByProjectId: (projectId) => this.deps.userStoryRepository.hasAnyByProjectId(projectId),
      listStoriesByProjectId: (projectId) => this.deps.userStoryRepository.listByProjectId(projectId),
      getLatestArchitecturePlanByProjectId: (projectId) => this.deps.architecturePlanRepository.getLatestByProjectId(projectId),
      getLatestImplementationPlanByProjectId: (projectId) =>
        this.deps.implementationPlanRepository.getLatestByProjectId(projectId),
      getLatestQaRunByProjectId: (projectId) => this.deps.qaRunRepository.getLatestByProjectId(projectId),
      getLatestDocumentationRunByProjectId: (projectId) =>
        this.deps.documentationRunRepository.getLatestByProjectId(projectId),
      showExecution: (projectId) => this.showExecution(projectId),
      importProjects: (itemId) => this.stageService.importProjects(itemId),
      startStage: (input) => this.stageService.startStage(input),
      approveStories: (projectId) => this.stageService.approveStories(projectId),
      approveArchitecture: (projectId) => this.stageService.approveArchitecture(projectId),
      approvePlanning: (projectId) => this.stageService.approvePlanning(projectId),
      startExecution: (projectId) => this.startExecution(projectId),
      tickExecution: (projectId) => this.tickExecution(projectId),
      startStoryReviewRemediation: (storyReviewRunId) => this.startStoryReviewRemediation(storyReviewRunId),
      startQa: (projectId) => this.startQa(projectId),
      startDocumentation: (projectId) => this.startDocumentation(projectId),
      completeItemIfDeliveryFinished: (itemId) => this.completeItemIfDeliveryFinished(itemId),
      canAutorunStoryReviewRemediate: (storyReviewRunId) => this.canAutorunStoryReviewRemediate(storyReviewRunId),
      getStoryReviewRemediationStopReason: (storyReviewRunId) =>
        this.getStoryReviewRemediationStopReason(storyReviewRunId)
    });
  }

  private resolveStageRuntime(stageKey: StageKey) {
    return this.deps.agentRuntimeResolver.resolveStage(stageKey);
  }

  private resolveInteractiveRuntime(flow: InteractiveFlowKey) {
    return this.deps.agentRuntimeResolver.resolveInteractive(flow);
  }

  private resolveWorkerRuntime(workerProfileKey: WorkerProfileKey) {
    return this.deps.agentRuntimeResolver.resolveWorker(runtimeWorkerKeyByProfileKey[workerProfileKey]);
  }

  private buildAdapterRuntimeContext(input: { providerKey: string; model: string | null; policy: AdapterRuntimeContext["policy"] }): AdapterRuntimeContext {
    return {
      provider: input.providerKey,
      model: input.model,
      policy: input.policy,
      workspaceRoot: this.deps.workspaceRoot
    };
  }

  public async startStage(input: {
    stageKey: StageKey;
    itemId: string;
    projectId?: string;
  }): Promise<{ runId: string; status: string; planningReview?: unknown }> {
    return this.stageService.startStage(input);
  }

  public importProjects(itemId: string): { importedCount: number } {
    return this.stageService.importProjects(itemId);
  }

  public approveConcept(conceptId: string): void {
    this.stageService.approveConcept(conceptId);
  }

  public approveStories(projectId: string): void {
    this.stageService.approveStories(projectId);
  }

  public approveArchitecture(projectId: string): void {
    this.stageService.approveArchitecture(projectId);
  }

  public approvePlanning(projectId: string): void {
    this.stageService.approvePlanning(projectId);
  }

  public async autorunForItem(input: {
    itemId: string;
    trigger: string;
    initialSteps?: AutorunStep[];
  }): Promise<AutorunSummary> {
    return this.autorunOrchestrator.executeForItem(input);
  }

  public async autorunForProject(input: {
    projectId: string;
    trigger: string;
    initialSteps?: AutorunStep[];
  }): Promise<AutorunSummary> {
    return this.autorunOrchestrator.executeForProject(input);
  }

  public async retryRun(runId: string): Promise<{ runId: string; status: string; retriedFromRunId: string }> {
    return this.stageService.retryRun(runId);
  }

  public showItem(itemId: string) {
    const item = this.entityLoaders.requireItem(itemId);
    const concept = this.deps.conceptRepository.getLatestByItemId(itemId);
    const projects = this.deps.projectRepository.listByItemId(itemId);
    const stageRuns = this.deps.stageRunRepository.listByItemId(itemId);
    const projectIds = projects.map((project) => project.id);
    const implementationPlansByProjectId = this.indexByProjectId(
      this.deps.implementationPlanRepository.listLatestByProjectIds(projectIds)
    );
    const qaRunsByProjectId = this.indexByProjectId(this.deps.qaRunRepository.listLatestByProjectIds(projectIds));
    const documentationRunsByProjectId = this.indexByProjectId(
      this.deps.documentationRunRepository.listLatestByProjectIds(projectIds)
    );
    const projectSummaries = projects.map((project) => {
      const latestImplementationPlan = implementationPlansByProjectId.get(project.id) ?? null;
      const latestQaRun = qaRunsByProjectId.get(project.id) ?? null;
      const latestDocumentationRun = documentationRunsByProjectId.get(project.id) ?? null;
      return {
        project,
        deliveryStatus: latestDocumentationRun?.status === "completed" && latestDocumentationRun.staleAt === null
          ? "completed"
          : "pending",
        latestImplementationPlanStatus: latestImplementationPlan?.status ?? null,
        latestQaStatus: latestQaRun?.status ?? null,
        latestDocumentationStatus: latestDocumentationRun?.status ?? null
      };
    });
    return {
      item,
      concept,
      projects,
      projectSummaries,
      deliverySummary: {
        totalProjects: projects.length,
        completedProjects: projectSummaries.filter((project) => project.deliveryStatus === "completed").length,
        pendingProjects: projectSummaries.filter((project) => project.deliveryStatus !== "completed").length
      },
      stageRuns
    };
  }

  public showProject(projectId: string) {
    const project = this.entityLoaders.requireProject(projectId);
    const item = this.entityLoaders.requireItem(project.itemId);
    const stories = this.deps.userStoryRepository.listByProjectId(projectId);
    const acceptanceCriteriaByStoryId = this.groupAcceptanceCriteriaByStoryId(projectId);
    const stageRuns = this.deps.stageRunRepository.listByProjectId(projectId);

    return {
      item,
      project,
      deliveryStatus: this.isProjectDeliveryComplete(projectId) ? "completed" : "pending",
      stories: stories.map((story) => ({
        ...story,
        acceptanceCriteria: acceptanceCriteriaByStoryId.get(story.id) ?? []
      })),
      latestArchitecturePlan: this.deps.architecturePlanRepository.getLatestByProjectId(projectId),
      latestImplementationPlan: this.deps.implementationPlanRepository.getLatestByProjectId(projectId),
      latestQaRun: this.deps.qaRunRepository.getLatestByProjectId(projectId),
      latestDocumentationRun: this.deps.documentationRunRepository.getLatestByProjectId(projectId),
      stageRuns
    };
  }

  public startBrainstormSession(itemId: string) {
    return this.brainstormService.startBrainstormSession(itemId);
  }

  public showBrainstormBySessionId(sessionId: string) {
    return this.brainstormService.showBrainstormBySessionId(sessionId);
  }

  public showBrainstormSession(itemId: string) {
    return this.brainstormService.showBrainstormSession(itemId);
  }

  public showBrainstormDraft(sessionId: string) {
    return this.brainstormService.showBrainstormDraft(sessionId);
  }

  public async startPlanningReview(input: {
    sourceType: import("../domain/types.js").PlanningReviewSourceType;
    sourceId: string;
    step: import("../domain/types.js").PlanningReviewStep;
    reviewMode: import("../domain/types.js").PlanningReviewMode;
    interactionMode: import("../domain/types.js").PlanningReviewInteractionMode;
    automationLevel?: import("../domain/types.js").PlanningReviewAutomationLevel;
  }) {
    return this.planningReviewService.startReview(input);
  }

  public startImplementationReview(input: {
    waveStoryExecutionId: string;
    automationLevel?: "manual" | "auto_suggest" | "auto_comment" | "auto_gate";
  }) {
    return this.implementationReviewService.startReview(input);
  }

  public showImplementationReview(runId: string) {
    return this.implementationReviewService.showReview(runId);
  }

  private mirrorStoryReview(input: {
    waveStoryExecutionId: string;
    storyReviewRunId: string;
    projectId: string;
    waveId: string;
    storyId: string;
    storyCode: string;
    status: string;
    findings: Array<{
      severity: string;
      category: string;
      title: string;
      description: string;
      evidence: string;
      filePath: string | null;
      line: number | null;
    }>;
    summary: StoryReviewOutput | null;
    errorMessage: string | null;
  }) {
    const gateDecision =
      input.status === "passed" ? "pass" : input.status === "failed" ? "needs_human_review" : ("advisory" as const);
    this.reviewCoreService.recordReview({
      reviewKind: "interactive_story",
      subjectType: "wave_story_execution",
      subjectId: input.waveStoryExecutionId,
      subjectStep: "story_review",
      status: input.status === "passed" ? "complete" : input.status === "failed" ? "failed" : "action_required",
      readiness: input.status === "passed" ? "ready" : input.status === "failed" ? "needs_human_review" : "review_required",
      interactionMode: "auto",
      reviewMode: "readiness",
      automationLevel: "auto_comment",
      requestedMode: null,
      actualMode: null,
      confidence: "medium",
      gateEligibility: "advisory_only",
      sourceSummary: {
        storyReviewRunId: input.storyReviewRunId,
        storyCode: input.storyCode,
        storyId: input.storyId,
        projectId: input.projectId,
        waveId: input.waveId,
        errorMessage: input.errorMessage
      },
      providersUsed: ["story-reviewer"],
      missingCapabilities: [],
      summary:
        input.status === "passed"
          ? "Story review completed without blocking findings."
          : input.status === "failed"
            ? "Story review failed."
            : "Story review returned actionable findings.",
      keyPoints: input.findings.slice(0, 7).map((finding) => finding.title),
      disagreements: [],
      recommendedAction:
        input.status === "passed"
          ? "Proceed with downstream quality checks."
          : input.status === "failed"
            ? "Retry or inspect the failed story review."
            : "Resolve the story review findings before continuing.",
      gateDecision,
      findings: input.findings.map((finding) => ({
        sourceSystem: "story_review" as const,
        reviewerRole: "story-reviewer",
        findingType: finding.category,
        normalizedSeverity:
          finding.severity === "critical" ? "critical" : finding.severity === "high" ? "high" : finding.severity === "medium" ? "medium" : "low",
        sourceSeverity: finding.severity,
        title: finding.title,
        detail: finding.description,
        evidence: finding.evidence,
        filePath: finding.filePath,
        line: finding.line,
        fieldPath: null
      })),
      knowledgeContext: {
        source: "implementation_review",
        workspaceId: this.deps.workspace.id,
        projectId: input.projectId,
        waveId: input.waveId,
        storyId: input.storyId
      }
    });
  }

  private mirrorQaReview(input: {
    qaRunId: string;
    projectId: string;
    itemId: string;
    status: string;
    findings: Array<{
      severity: string;
      category: string;
      title: string;
      description: string;
      evidence: string;
      storyId: string | null;
      waveStoryExecutionId: string | null;
    }>;
    summary: import("../schemas/output-contracts.js").QaOutput | null;
    errorMessage: string | null;
  }) {
    const gateDecision =
      input.status === "passed" ? "pass" : input.status === "failed" ? "blocked" : ("advisory" as const);
    this.reviewCoreService.recordReview({
      reviewKind: "qa",
      subjectType: "project",
      subjectId: input.projectId,
      subjectStep: "qa",
      status: input.status === "passed" ? "complete" : input.status === "failed" ? "failed" : "action_required",
      readiness: input.status === "passed" ? "ready" : input.status === "failed" ? "needs_human_review" : "review_required",
      interactionMode: "auto",
      reviewMode: "readiness",
      automationLevel: "auto_comment",
      requestedMode: null,
      actualMode: null,
      confidence: "medium",
      gateEligibility: "advisory_only",
      sourceSummary: {
        qaRunId: input.qaRunId,
        projectId: input.projectId,
        itemId: input.itemId,
        errorMessage: input.errorMessage
      },
      providersUsed: ["qa-verifier"],
      missingCapabilities: [],
      summary:
        input.status === "passed"
          ? "QA completed without actionable findings."
          : input.status === "failed"
            ? "QA failed."
            : "QA completed with follow-up findings.",
      keyPoints: input.findings.slice(0, 7).map((finding) => finding.title),
      disagreements: [],
      recommendedAction:
        input.status === "passed"
          ? "Proceed with documentation or delivery."
          : input.status === "failed"
            ? "Retry QA or inspect the failure."
            : "Resolve the QA findings before continuing.",
      gateDecision,
      findings: input.findings.map((finding) => ({
        sourceSystem: "qa" as const,
        reviewerRole: "qa-verifier",
        findingType: finding.category,
        normalizedSeverity:
          finding.severity === "critical" ? "critical" : finding.severity === "high" ? "high" : finding.severity === "medium" ? "medium" : "low",
        sourceSeverity: finding.severity,
        title: finding.title,
        detail: finding.description,
        evidence: finding.evidence,
        filePath: null,
        line: null,
        fieldPath: finding.storyId ?? finding.waveStoryExecutionId
      })),
      knowledgeContext: null
    });
  }

  public showPlanningReview(runId: string) {
    return this.planningReviewService.showReview(runId);
  }

  public answerPlanningReviewQuestion(input: { runId: string; questionId: string; answer: string }) {
    return this.planningReviewService.answerQuestion(input);
  }

  public async rerunPlanningReview(runId: string) {
    return this.planningReviewService.rerunReview(runId);
  }

  public updateBrainstormDraft(input: {
    sessionId: string;
    problem?: string;
    coreOutcome?: string;
    targetUsers?: string[];
    useCases?: string[];
    constraints?: string[];
    nonGoals?: string[];
    risks?: string[];
    openQuestions?: string[];
    candidateDirections?: string[];
    recommendedDirection?: string | null;
    scopeNotes?: string | null;
    assumptions?: string[];
  }) {
    return this.brainstormService.updateBrainstormDraft(input);
  }

  public async chatBrainstorm(sessionId: string, message: string) {
    return this.brainstormService.chatBrainstorm(sessionId, message);
  }

  public async promoteBrainstorm(sessionId: string, options?: { autorun?: boolean }) {
    return this.brainstormService.promoteBrainstorm(sessionId, options);
  }

  public async startInteractiveReview(input: { type: "stories"; projectId: string }) {
    return this.interactiveReviewService.startInteractiveReview(input);
  }

  public showInteractiveReview(sessionId: string) {
    return this.interactiveReviewService.showInteractiveReview(sessionId);
  }

  public async chatInteractiveReview(sessionId: string, message: string) {
    return this.interactiveReviewService.chatInteractiveReview(sessionId, message);
  }

  public updateInteractiveReviewEntry(input: {
    sessionId: string;
    storyId: string;
    status: InteractiveReviewEntryStatus;
    summary?: string;
    changeRequest?: string;
    rationale?: string;
    severity?: "critical" | "high" | "medium" | "low";
  }) {
    return this.interactiveReviewService.updateInteractiveReviewEntry(input);
  }

  public applyInteractiveReviewStoryEdits(input: {
    sessionId: string;
    storyId: string;
    title?: string;
    description?: string;
    actor?: string;
    goal?: string;
    benefit?: string;
    priority?: string;
    acceptanceCriteria?: string[];
    summary?: string;
    rationale?: string;
    status?: Extract<InteractiveReviewEntryStatus, "resolved" | "accepted" | "needs_revision">;
  }) {
    return this.interactiveReviewService.applyInteractiveReviewStoryEdits(input);
  }

  public async resolveInteractiveReview(input: {
    sessionId: string;
    action: Extract<
      InteractiveReviewResolutionType,
      | "approve"
      | "approve_and_autorun"
      | "approve_all"
      | "approve_all_and_autorun"
      | "approve_selected"
      | "request_changes"
      | "request_story_revisions"
      | "apply_story_edits"
    >;
    storyIds?: string[];
    rationale?: string;
  }) {
    return this.interactiveReviewService.resolveInteractiveReview(input);
  }

  public listRuns(input: { itemId?: string; projectId?: string }) {
    if (input.projectId) {
      this.entityLoaders.requireProject(input.projectId);
      return this.deps.stageRunRepository.listByProjectId(input.projectId);
    }
    if (input.itemId) {
      this.entityLoaders.requireItem(input.itemId);
      return this.deps.stageRunRepository.listByItemId(input.itemId);
    }
    throw new AppError("LIST_SCOPE_REQUIRED", "Either itemId or projectId is required");
  }

  public showRun(runId: string) {
    const run = this.deps.stageRunRepository.getById(runId);
    if (!run) {
      throw new AppError("RUN_NOT_FOUND", `Stage run ${runId} not found`);
    }
    this.entityLoaders.requireItem(run.itemId);
    const artifacts = this.deps.artifactRepository.listByStageRunId(runId);
    const sessions = this.deps.agentSessionRepository.listByStageRunId(runId);
    return { run, artifacts, sessions };
  }

  public listArtifacts(input: { runId?: string; itemId?: string }) {
    if (input.runId) {
      const run = this.deps.stageRunRepository.getById(input.runId);
      if (!run) {
        throw new AppError("RUN_NOT_FOUND", `Stage run ${input.runId} not found`);
      }
      this.entityLoaders.requireItem(run.itemId);
      return this.deps.artifactRepository.listByStageRunId(input.runId);
    }
    if (input.itemId) {
      this.entityLoaders.requireItem(input.itemId);
      return this.deps.artifactRepository.listByItemId(input.itemId);
    }
    throw new AppError("LIST_SCOPE_REQUIRED", "Either runId or itemId is required");
  }

  public listSessions(runId: string) {
    return this.deps.agentSessionRepository.listByStageRunId(runId);
  }

  public async startExecution(projectId: string) {
    return this.executionService.startExecution(projectId);
  }

  public async tickExecution(projectId: string) {
    return this.executionService.tickExecution(projectId);
  }

  public async retryWaveStoryExecution(waveStoryExecutionId: string) {
    return this.executionService.retryWaveStoryExecution(waveStoryExecutionId);
  }

  public async startAppVerification(waveStoryExecutionId: string) {
    return this.verificationService.startAppVerification(waveStoryExecutionId);
  }

  public showAppVerification(appVerificationRunId: string) {
    return this.verificationService.showAppVerification(appVerificationRunId);
  }

  public async startStoryReview(waveStoryExecutionId: string) {
    return this.verificationService.startStoryReview(waveStoryExecutionId);
  }

  public showStoryReview(storyId: string) {
    return this.verificationService.showStoryReview(storyId);
  }

  public async retryAppVerification(appVerificationRunId: string) {
    return this.verificationService.retryAppVerification(appVerificationRunId);
  }

  public showStoryReviewRemediation(storyId: string) {
    return this.verificationService.showStoryReviewRemediation(storyId);
  }

  public async startStoryReviewRemediation(storyReviewRunId: string) {
    return this.verificationService.startStoryReviewRemediation(storyReviewRunId);
  }

  public async retryStoryReviewRemediation(storyReviewRemediationRunId: string) {
    return this.verificationService.retryStoryReviewRemediation(storyReviewRemediationRunId);
  }

  public async startQa(projectId: string) {
    return this.qaService.startQa(projectId);
  }

  public showQa(projectId: string) {
    return this.qaService.showQa(projectId);
  }

  public async retryQa(qaRunId: string) {
    return this.qaService.retryQa(qaRunId);
  }

  public async startDocumentation(projectId: string) {
    return this.documentationService.startDocumentation(projectId);
  }

  public showDocumentation(projectId: string) {
    return this.documentationService.showDocumentation(projectId);
  }

  public async retryDocumentation(documentationRunId: string) {
    return this.documentationService.retryDocumentation(documentationRunId);
  }

  public showExecution(projectId: string): ExecutionView {
    return this.executionService.showExecution(projectId);
  }

  public showExecutionCompact(projectId: string) {
    return this.executionService.showExecutionCompact(projectId);
  }

  public showExecutionLogs(input: { projectId: string; storyCode: string }) {
    return this.executionService.showExecutionLogs(input);
  }

  private parseRalphVerificationOutput(
    verificationRun: ReturnType<VerificationRunRepository["getLatestByWaveStoryExecutionIdAndMode"]>
  ): RalphVerificationOutput {
    if (!verificationRun?.summaryJson) {
      throw new AppError("RALPH_OUTPUT_MISSING", "Ralph verification has no summary");
    }
    return ralphVerificationOutputSchema.parse(JSON.parse(verificationRun.summaryJson));
  }

  private parseStoryReviewOutput(
    storyReviewRun: ReturnType<StoryReviewRunRepository["getLatestByWaveStoryExecutionId"]>
  ): StoryReviewOutput {
    if (!storyReviewRun?.summaryJson) {
      throw new AppError("STORY_REVIEW_OUTPUT_MISSING", "Story review has no summary");
    }
    return storyReviewOutputSchema.parse(JSON.parse(storyReviewRun.summaryJson));
  }

  private completeItemIfDeliveryFinished(itemId: string): void {
    this.documentationService.completeItemIfDeliveryFinished(itemId);
  }

  private isProjectDeliveryComplete(projectId: string): boolean {
    return this.documentationService.isProjectDeliveryComplete(projectId);
  }

  private canAutorunStoryReviewRemediate(storyReviewRunId: string): boolean {
    const storyReviewRun = this.entityLoaders.requireStoryReviewRun(storyReviewRunId);
    if (storyReviewRun.status !== "review_required") {
      return false;
    }
    const findings = this.deps.storyReviewFindingRepository
      .listByStoryReviewRunId(storyReviewRunId)
      .filter((finding) => finding.status === "open");
    if (findings.length === 0) {
      return false;
    }
    if (!this.hasOnlyAutoFixableStoryReviewFindings(findings)) {
      return false;
    }
    return (
      this.deps.storyReviewRemediationRunRepository.listByStoryReviewRunId(storyReviewRunId).length <
      MAX_STORY_REVIEW_REMEDIATION_ATTEMPTS
    );
  }

  private getStoryReviewRemediationStopReason(storyReviewRunId: string): string {
    const storyReviewRun = this.entityLoaders.requireStoryReviewRun(storyReviewRunId);
    if (storyReviewRun.status === "failed") {
      return "story_review_failed";
    }
    const findings = this.deps.storyReviewFindingRepository
      .listByStoryReviewRunId(storyReviewRunId)
      .filter((finding) => finding.status === "open");
    if (!this.hasOnlyAutoFixableStoryReviewFindings(findings)) {
      return "story_review_review_required";
    }
    if (
      this.deps.storyReviewRemediationRunRepository.listByStoryReviewRunId(storyReviewRunId).length >=
      MAX_STORY_REVIEW_REMEDIATION_ATTEMPTS
    ) {
      return "story_review_remediation_limit_reached";
    }
    return "story_review_review_required";
  }

  private isAutoFixableStoryReviewSeverity(severity: StoryReviewFindingSeverity): boolean {
    return severity === "medium" || severity === "low";
  }

  private hasOnlyAutoFixableStoryReviewFindings(
    findings: ReturnType<WorkflowDeps["storyReviewFindingRepository"]["listByStoryReviewRunId"]>
  ): boolean {
    return findings.every((finding) => this.isAutoFixableStoryReviewSeverity(finding.severity));
  }

  private invalidateDocumentationForProject(projectId: string, reason: string): void {
    this.documentationService.invalidateDocumentationForProject(projectId, reason);
  }

  private groupAcceptanceCriteriaByStoryId(projectId: string) {
    return this.deps.acceptanceCriterionRepository.listByProjectId(projectId).reduce((map, criterion) => {
      const current = map.get(criterion.storyId) ?? [];
      current.push(criterion);
      map.set(criterion.storyId, current);
      return map;
    }, new Map<string, ReturnType<AcceptanceCriterionRepository["listByProjectId"]>>());
  }

  private resolveWorkerProfile(profileKey: WorkerProfileKey) {
    return this.promptResolver.resolve(workerProfiles[profileKey]);
  }

  private indexByProjectId<T extends { projectId: string }>(records: T[]): Map<string, T> {
    return new Map(records.map((record) => [record.projectId, record]));
  }

}
