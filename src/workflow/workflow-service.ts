import { existsSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

import type {
  GitBranchMetadata,
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
import { ReviewRemediationService } from "./review-remediation-service.js";
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
  private readonly reviewRemediationService: ReviewRemediationService;
  private readonly stageService: StageService;
  private readonly verificationService: VerificationService;
  private readonly reviewCoreService: ReviewCoreService;

  public constructor(private readonly deps: WorkflowDeps) {
    this.promptResolver = new PromptResolver(deps.repoRoot);
    this.artifactService = new ArtifactService(deps.artifactRoot);
    this.gitWorkflowService = new GitWorkflowService(deps.workspaceRoot, deps.workspace.key);
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
      pruneGitWorktrees: () => this.gitWorkflowService.pruneWorktrees(),
      ensureProjectBranch: (projectCode) => this.gitWorkflowService.ensureProjectBranch(projectCode),
      ensureStoryBranch: (projectCode, storyCode) => this.gitWorkflowService.ensureStoryBranch(projectCode, storyCode),
      ensureStoryWorktree: (storyCode, gitMetadata) => this.ensureStoryWorktree(storyCode, gitMetadata),
      finalizeAcceptedExecution: (waveStoryExecutionId) => this.finalizeAcceptedExecution(waveStoryExecutionId),
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
    this.reviewRemediationService = new ReviewRemediationService({
      deps,
      reviewCoreService: this.reviewCoreService,
      startStoryReviewRemediation: (input) => this.verificationService.startStoryReviewRemediation(input.storyReviewRunId)
    });
    this.implementationReviewService = new ImplementationReviewService({
      deps,
      reviewCoreService: this.reviewCoreService,
      reviewRemediationService: this.reviewRemediationService,
      buildAdapterRuntimeContext: (input) => this.buildAdapterRuntimeContext(input)
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
      groupAcceptanceCriteriaByStoryId: (projectId) => this.groupAcceptanceCriteriaByStoryId(projectId)
    });
    this.verificationService = new VerificationService({
      deps,
      reviewCoreService: this.reviewCoreService,
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
      ensureStoryRemediationWorktree: (storyCode, storyReviewRunId, gitMetadata) =>
        this.ensureStoryRemediationWorktree(storyCode, storyReviewRunId, gitMetadata),
      finalizeAcceptedExecution: (waveStoryExecutionId) => this.finalizeAcceptedExecution(waveStoryExecutionId),
      finalizeAcceptedRemediation: (storyReviewRemediationRunId) => this.finalizeAcceptedRemediation(storyReviewRemediationRunId),
      invalidateDocumentationForProject: (projectId, reason) => this.invalidateDocumentationForProject(projectId, reason),
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

  private ensureStoryWorktree(storyCode: string, gitMetadata: GitBranchMetadata): GitBranchMetadata {
    if (gitMetadata.strategy !== "applied") {
      return gitMetadata;
    }
    const worktreePath = gitMetadata.worktreePath ?? this.gitWorkflowService.describeStoryWorktreePath(storyCode);
    this.gitWorkflowService.worktreeAdd(worktreePath, gitMetadata.branchName);
    return { ...gitMetadata, worktreePath };
  }

  private ensureStoryRemediationWorktree(
    storyCode: string,
    storyReviewRunId: string,
    gitMetadata: GitBranchMetadata
  ): GitBranchMetadata {
    if (gitMetadata.strategy !== "applied") {
      return gitMetadata;
    }
    const worktreePath =
      gitMetadata.worktreePath ?? this.gitWorkflowService.describeStoryRemediationWorktreePath(storyCode, storyReviewRunId);
    this.gitWorkflowService.worktreeAdd(worktreePath, gitMetadata.branchName);
    return { ...gitMetadata, worktreePath };
  }

  private finalizeAcceptedExecution(waveStoryExecutionId: string): void {
    const execution = this.entityLoaders.requireWaveStoryExecution(waveStoryExecutionId);
    const gitMetadata = this.parseGitMetadata(execution.gitMetadataJson);
    if (!gitMetadata || gitMetadata.strategy !== "applied") {
      return;
    }
    const story = this.entityLoaders.requireStory(execution.storyId);
    const project = this.entityLoaders.requireProject(story.projectId);
    const projectBranch = this.gitWorkflowService.describeProjectBranch(project.code);
    if (gitMetadata.mergedIntoRef === projectBranch && gitMetadata.mergedCommitSha) {
      return;
    }

    const mergedCommitSha = this.gitWorkflowService.mergeBranch(gitMetadata.branchName, projectBranch, story.code);
    this.deps.waveStoryExecutionRepository.updateStatus(execution.id, execution.status, {
      outputSummaryJson: execution.outputSummaryJson,
      errorMessage: execution.errorMessage,
      gitMetadata: {
        ...gitMetadata,
        mergedIntoRef: projectBranch,
        mergedCommitSha
      }
    });
    if (gitMetadata.worktreePath) {
      this.gitWorkflowService.worktreeRemove(gitMetadata.worktreePath);
    }
    this.gitWorkflowService.deleteBranch(gitMetadata.branchName);
  }

  private finalizeAcceptedRemediation(storyReviewRemediationRunId: string): void {
    const remediationRun = this.entityLoaders.requireStoryReviewRemediationRun(storyReviewRemediationRunId);
    const gitMetadata = this.parseGitMetadata(remediationRun.gitMetadataJson);
    if (gitMetadata && gitMetadata.strategy === "applied" && !gitMetadata.mergedCommitSha) {
      const sourceExecution = this.entityLoaders.requireWaveStoryExecution(remediationRun.waveStoryExecutionId);
      const story = this.entityLoaders.requireStory(remediationRun.storyId);
      const sourceGitMetadata = this.parseGitMetadata(sourceExecution.gitMetadataJson);
      if (!sourceGitMetadata) {
        throw new AppError(
          "REMEDIATION_SOURCE_GIT_METADATA_INVALID",
          `Cannot finalize remediation ${storyReviewRemediationRunId}: source execution has no parseable git metadata`
        );
      }
      const mergedCommitSha =
        sourceGitMetadata.worktreePath &&
        gitMetadata.branchName !== sourceGitMetadata.branchName
          ? this.gitWorkflowService.mergeIntoWorktree(sourceGitMetadata.worktreePath, gitMetadata.branchName)
          : this.gitWorkflowService.mergeBranch(
              gitMetadata.branchName,
              sourceGitMetadata.branchName,
              `${story.code}-fix-${remediationRun.attempt}`
            );
      this.deps.storyReviewRemediationRunRepository.updateStatus(remediationRun.id, remediationRun.status, {
        remediationWaveStoryExecutionId: remediationRun.remediationWaveStoryExecutionId,
        outputSummaryJson: remediationRun.outputSummaryJson,
        errorMessage: remediationRun.errorMessage,
        gitMetadata: {
          ...gitMetadata,
          mergedIntoRef: sourceGitMetadata.branchName,
          mergedCommitSha
        }
      });
      if (gitMetadata.worktreePath) {
        this.gitWorkflowService.worktreeRemove(gitMetadata.worktreePath);
      }
      this.gitWorkflowService.deleteBranch(gitMetadata.branchName);
    }

    this.finalizeAcceptedExecution(remediationRun.waveStoryExecutionId);
  }

  private finalizeCompletedProject(projectId: string):
    | { status: "merged" | "already_finalized"; message: string }
    | { status: "manual_resolution_required"; message: string } {
    if (!this.isProjectDeliveryComplete(projectId)) {
      return {
        status: "manual_resolution_required",
        message: `Project ${projectId} is not delivery-complete yet; finalize Git after completed documentation.`
      };
    }
    const project = this.entityLoaders.requireProject(projectId);
    const projectBranch = this.gitWorkflowService.describeProjectBranch(project.code);
    if (!this.gitWorkflowService.branchExists(projectBranch)) {
      return {
        status: "already_finalized",
        message: `Project branch ${projectBranch} is already absent.`
      };
    }
    try {
      this.gitWorkflowService.mergeBranch(projectBranch, "main", `project-${project.code}`);
      this.gitWorkflowService.deleteBranch(projectBranch);
      return {
        status: "merged",
        message: `Merged ${projectBranch} into main and cleaned up the project branch.`
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        status: "manual_resolution_required",
        message: `Project branch ${projectBranch} could not be merged into main automatically: ${message}`
      };
    }
  }

  private parseGitMetadata(gitMetadataJson: string | null): GitBranchMetadata | null {
    if (!gitMetadataJson) {
      return null;
    }
    try {
      return JSON.parse(gitMetadataJson) as GitBranchMetadata;
    } catch {
      return null;
    }
  }

  private listCompletedExecutionsWithGitMetadata() {
    const items = this.deps.itemRepository.listByWorkspaceId(this.deps.workspace.id);
    const projects = items.flatMap((item) => this.deps.projectRepository.listByItemId(item.id));
    const implementationPlans = this.deps.implementationPlanRepository.listLatestByProjectIds(projects.map((project) => project.id));
    const waves = implementationPlans.flatMap((plan) => this.deps.waveRepository.listByImplementationPlanId(plan.id));
    const waveStories = this.deps.waveStoryRepository.listByWaveIds(waves.map((wave) => wave.id));
    return this.deps.waveStoryExecutionRepository
      .listLatestByWaveStoryIds(waveStories.map((waveStory) => waveStory.id))
      .filter((execution) => execution.gitMetadataJson && (execution.status === "completed" || execution.status === "failed"));
  }

  private listCompletedRemediationsWithGitMetadata() {
    const items = this.deps.itemRepository.listByWorkspaceId(this.deps.workspace.id);
    const projects = items.flatMap((item) => this.deps.projectRepository.listByItemId(item.id));
    const stories = projects.flatMap((project) => this.deps.userStoryRepository.listByProjectId(project.id));
    return stories.flatMap((story) =>
      this.deps.storyReviewRemediationRunRepository
        .listByStoryId(story.id)
        .filter((run) => run.gitMetadataJson && (run.status === "completed" || run.status === "failed"))
    );
  }

  private buildAdapterRuntimeContext(input: {
    providerKey: string;
    model: string | null;
    policy: AdapterRuntimeContext["policy"];
    workspaceRoot?: string;
  }): AdapterRuntimeContext {
    return {
      provider: input.providerKey,
      model: input.model,
      policy: input.policy,
      workspaceRoot: input.workspaceRoot ?? this.deps.workspaceRoot
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

  public async startImplementationReview(input: {
    waveStoryExecutionId: string;
    automationLevel?: "manual" | "auto_suggest" | "auto_comment" | "auto_gate";
    interactionMode?: "auto" | "assisted" | "interactive";
  }) {
    return this.implementationReviewService.startReview(input);
  }

  public showImplementationReview(runId: string) {
    return this.implementationReviewService.showReview(runId);
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
    const result = await this.documentationService.startDocumentation(projectId);
    let projectFinalization:
      | { status: "merged" | "already_finalized"; message: string }
      | { status: "manual_resolution_required"; message: string } = {
      status: "already_finalized",
      message: "Project branch was already finalized."
    };
    if (result.status === "completed") {
      projectFinalization = this.finalizeCompletedProject(projectId);
    }
    return { ...result, projectFinalization };
  }

  public showDocumentation(projectId: string) {
    return this.documentationService.showDocumentation(projectId);
  }

  public finalizeProjectGit(projectId: string) {
    return this.finalizeCompletedProject(projectId);
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

  public pruneGitWorktrees() {
    const before = this.gitWorkflowService.worktreeList();
    this.gitWorkflowService.pruneWorktrees();
    const removed: string[] = [];

    for (const execution of this.listCompletedExecutionsWithGitMetadata()) {
      const gitMetadata = this.parseGitMetadata(execution.gitMetadataJson);
      if (!gitMetadata?.worktreePath) {
        continue;
      }
      const branchMissing = !this.gitWorkflowService.branchExists(gitMetadata.branchName);
      if (gitMetadata.mergedIntoRef || branchMissing) {
        this.gitWorkflowService.worktreeRemove(gitMetadata.worktreePath);
        removed.push(gitMetadata.worktreePath);
      }
    }

    for (const remediationRun of this.listCompletedRemediationsWithGitMetadata()) {
      const gitMetadata = this.parseGitMetadata(remediationRun.gitMetadataJson);
      if (!gitMetadata?.worktreePath) {
        continue;
      }
      const branchMissing = !this.gitWorkflowService.branchExists(gitMetadata.branchName);
      if (gitMetadata.mergedIntoRef || branchMissing) {
        this.gitWorkflowService.worktreeRemove(gitMetadata.worktreePath);
        removed.push(gitMetadata.worktreePath);
      }
    }

    const registeredWorktrees = new Set(this.gitWorkflowService.worktreeList());
    const managedRoots = [this.gitWorkflowService.managedWorktreeRoot(), this.gitWorkflowService.legacyManagedWorktreeRoot()];
    for (const managedRoot of managedRoots) {
      if (!existsSync(managedRoot)) {
        continue;
      }
      for (const entry of readdirSync(managedRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
          continue;
        }
        const candidatePath = resolve(managedRoot, entry.name);
        if (entry.name === "_merge") {
          for (const mergeEntry of readdirSync(candidatePath, { withFileTypes: true })) {
            if (!mergeEntry.isDirectory()) {
              continue;
            }
            const mergeCandidatePath = resolve(candidatePath, mergeEntry.name);
            if (registeredWorktrees.has(mergeCandidatePath)) {
              continue;
            }
            rmSync(mergeCandidatePath, { recursive: true, force: true });
            removed.push(mergeCandidatePath);
          }
          continue;
        }
        if (registeredWorktrees.has(candidatePath)) {
          continue;
        }
        rmSync(candidatePath, { recursive: true, force: true });
        removed.push(candidatePath);
      }
    }

    const after = this.gitWorkflowService.worktreeList();
    return { before, after, removed };
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
