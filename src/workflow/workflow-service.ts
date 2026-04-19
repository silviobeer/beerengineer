import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildItemWorkflowSnapshot } from "../domain/aggregate-status.js";
import { assertCanMoveItem } from "../domain/workflow-rules.js";
import type {
  DocumentationRunStatus,
  ExecutionWorkerRole,
  GitBranchMetadata,
  QaRunStatus,
  StageKey,
  StoryReviewFindingSeverity,
  StoryReviewRunStatus,
  VerificationRunStatus
} from "../domain/types.js";
import { PromptResolver } from "../services/prompt-resolver.js";
import { ArtifactService } from "../services/artifact-service.js";
import { GitWorkflowService } from "../services/git-workflow-service.js";
import {
  implementationPlanOutputSchema,
  architecturePlanOutputSchema,
  documentationOutputSchema,
  qaOutputSchema,
  projectsOutputSchema,
  ralphVerificationOutputSchema,
  storyReviewOutputSchema,
  storiesOutputSchema,
  storyExecutionOutputSchema,
  testPreparationOutputSchema
} from "../schemas/output-contracts.js";
import type {
  ImplementationPlanOutput,
  ArchitecturePlanOutput,
  DocumentationOutput,
  ProjectsOutput,
  QaOutput,
  RalphVerificationOutput,
  StoryReviewOutput,
  StoriesOutput,
  StoryExecutionOutput,
  TestPreparationOutput
} from "../schemas/output-contracts.js";
import { AppError } from "../shared/errors.js";
import {
  formatAcceptanceCriterionCode,
  formatProjectCode,
  formatStoryCode
} from "../shared/codes.js";
import type {
  ExecutionAgentSessionRepository,
  DocumentationAgentSessionRepository,
  DocumentationRunRepository,
  QaAgentSessionRepository,
  QaFindingRepository,
  QaRunRepository,
  ProjectExecutionContextRepository,
  StoryReviewAgentSessionRepository,
  StoryReviewFindingRepository,
  StoryReviewRemediationAgentSessionRepository,
  StoryReviewRemediationFindingRepository,
  StoryReviewRemediationRunRepository,
  StoryReviewRunRepository,
  TestAgentSessionRepository,
  VerificationRunRepository,
  AcceptanceCriterionRepository,
  ArchitecturePlanRepository,
  ArtifactRecord,
  ArtifactRepository,
  AgentSessionRepository,
  ConceptRepository,
  ImplementationPlanRepository,
  ItemRepository,
  ProjectRepository,
  StageRunRepository,
  UserStoryRepository,
  WaveRepository,
  WaveExecutionRepository,
  WaveStoryDependencyRepository,
  WaveStoryTestRunRepository,
  WaveStoryExecutionRepository,
  WaveStoryRepository
} from "../persistence/repositories.js";
import { assertStageRunTransitionAllowed } from "./stage-run-rules.js";
import { runProfiles } from "./run-profiles.js";
import { workerProfiles, type WorkerProfileKey } from "./worker-profiles.js";
import type { AgentAdapter } from "../adapters/types.js";

type WorkflowDeps = {
  repoRoot: string;
  workspaceRoot: string;
  artifactRoot: string;
  runInTransaction<T>(fn: () => T): T;
  adapter: AgentAdapter;
  itemRepository: ItemRepository;
  conceptRepository: ConceptRepository;
  projectRepository: ProjectRepository;
  userStoryRepository: UserStoryRepository;
  acceptanceCriterionRepository: AcceptanceCriterionRepository;
  architecturePlanRepository: ArchitecturePlanRepository;
  implementationPlanRepository: ImplementationPlanRepository;
  waveRepository: WaveRepository;
  waveStoryRepository: WaveStoryRepository;
  waveStoryDependencyRepository: WaveStoryDependencyRepository;
  projectExecutionContextRepository: ProjectExecutionContextRepository;
  waveExecutionRepository: WaveExecutionRepository;
  waveStoryTestRunRepository: WaveStoryTestRunRepository;
  testAgentSessionRepository: TestAgentSessionRepository;
  waveStoryExecutionRepository: WaveStoryExecutionRepository;
  executionAgentSessionRepository: ExecutionAgentSessionRepository;
  verificationRunRepository: VerificationRunRepository;
  storyReviewRunRepository: StoryReviewRunRepository;
  storyReviewFindingRepository: StoryReviewFindingRepository;
  storyReviewAgentSessionRepository: StoryReviewAgentSessionRepository;
  storyReviewRemediationRunRepository: StoryReviewRemediationRunRepository;
  storyReviewRemediationFindingRepository: StoryReviewRemediationFindingRepository;
  storyReviewRemediationAgentSessionRepository: StoryReviewRemediationAgentSessionRepository;
  qaRunRepository: QaRunRepository;
  qaFindingRepository: QaFindingRepository;
  qaAgentSessionRepository: QaAgentSessionRepository;
  documentationRunRepository: DocumentationRunRepository;
  documentationAgentSessionRepository: DocumentationAgentSessionRepository;
  stageRunRepository: StageRunRepository;
  artifactRepository: ArtifactRepository;
  agentSessionRepository: AgentSessionRepository;
};

type AutorunScopeType = "item" | "project";

type AutorunStep = {
  action: string;
  scopeType: AutorunScopeType | "run" | "execution" | "remediation" | "qa" | "documentation";
  scopeId: string;
  status: string;
};

type AutorunSummary = {
  trigger: string;
  scopeType: AutorunScopeType;
  scopeId: string;
  steps: AutorunStep[];
  finalStatus: "completed" | "stopped" | "failed";
  stopReason: string;
  createdRunIds: string[];
  createdExecutionIds: string[];
  createdRemediationRunIds: string[];
  successful: boolean;
};

type AutorunDecision =
  | {
      kind: "step";
      action: string;
      scopeType: AutorunStep["scopeType"];
      scopeId: string;
      execute: () => Promise<unknown> | unknown;
    }
  | {
      kind: "stop";
      finalStatus: AutorunSummary["finalStatus"];
      stopReason: string;
    };

type RetryWaveStoryExecutionResult =
  | {
      phase: "test_preparation";
      waveStoryTestRunId: string;
      waveStoryId: string;
      storyCode: string;
      status: "review_required" | "failed";
    }
  | {
      phase: "implementation" | "story_review";
      waveStoryExecutionId: string;
      waveStoryId: string;
      storyCode: string;
      status: string;
    };

export class WorkflowService {
  private readonly promptResolver: PromptResolver;
  private readonly artifactService: ArtifactService;
  private readonly gitWorkflowService: GitWorkflowService;

  public constructor(private readonly deps: WorkflowDeps) {
    this.promptResolver = new PromptResolver(deps.repoRoot);
    this.artifactService = new ArtifactService(deps.artifactRoot);
    this.gitWorkflowService = new GitWorkflowService(deps.workspaceRoot);
  }

  public async startStage(input: { stageKey: StageKey; itemId: string; projectId?: string }): Promise<{ runId: string; status: string }> {
    const item = this.requireItem(input.itemId);
    const project = input.projectId ? this.requireProject(input.projectId) : null;
    const profile = runProfiles[input.stageKey];
    const resolved = this.promptResolver.resolve(profile);
    const inputArtifactIds = this.resolveInputArtifactIds(input.stageKey, item.id, project?.id ?? null);

    const inputSnapshot = JSON.stringify(
      {
        item: {
          id: item.id,
          code: item.code,
          title: item.title,
          description: item.description,
          currentColumn: item.currentColumn
        },
        project: project
          ? {
              id: project.id,
              code: project.code,
              title: project.title,
              summary: project.summary,
              goal: project.goal
            }
          : null
      },
      null,
      2
    );

    const run = this.deps.runInTransaction(() => {
      const createdRun = this.deps.stageRunRepository.create({
        itemId: item.id,
        projectId: project?.id ?? null,
        stageKey: input.stageKey,
        status: "pending",
        inputSnapshotJson: inputSnapshot,
        systemPromptSnapshot: resolved.promptContent,
        skillsSnapshotJson: JSON.stringify(resolved.skills, null, 2),
        outputSummaryJson: null,
        errorMessage: null
      });
      this.deps.stageRunRepository.linkInputArtifacts(createdRun.id, inputArtifactIds);
      this.transitionRun(createdRun.id, "pending", "running");
      this.deps.itemRepository.updatePhaseStatus(item.id, "running");
      if (input.stageKey === "brainstorm" && item.currentColumn === "idea") {
        this.deps.itemRepository.updateColumn(item.id, "brainstorm", "running");
      }
      return createdRun;
    });

    try {
      const result = await this.deps.adapter.run({
        stageKey: input.stageKey,
        prompt: resolved.promptContent,
        skills: resolved.skills,
        item: {
          id: item.id,
          code: item.code,
          title: item.title,
          description: item.description
        },
        project: project
          ? {
              id: project.id,
              code: project.code,
              title: project.title,
              summary: project.summary,
              goal: project.goal
            }
          : null,
        context: project
          ? {
              conceptSummary: this.deps.conceptRepository.getLatestByItemId(item.id)?.summary ?? null,
              architectureSummary: this.deps.architecturePlanRepository.getLatestByProjectId(project.id)?.summary ?? null,
              stories: this.deps.userStoryRepository.listByProjectId(project.id).map((story) => ({
                code: story.code,
                title: story.title,
                priority: story.priority,
                acceptanceCriteria: this.deps.acceptanceCriterionRepository.listByStoryId(story.id).map((criterion) => ({
                  code: criterion.code,
                  text: criterion.text
                }))
              }))
            }
          : null
      });

      const completion = this.deps.runInTransaction(() => {
        this.deps.agentSessionRepository.create({
          stageRunId: run.id,
          adapterKey: this.deps.adapter.key,
          status: result.exitCode === 0 ? "completed" : "failed",
          commandJson: JSON.stringify(result.command),
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode
        });

        const outputArtifacts = this.persistArtifacts({
          itemId: item.id,
          projectId: project?.id ?? null,
          runId: run.id,
          markdownArtifacts: result.markdownArtifacts,
          structuredArtifacts: result.structuredArtifacts
        });

        const importOutcome = this.importOutputs({
          stageKey: input.stageKey,
          itemId: item.id,
          projectId: project?.id ?? null,
          artifactsByKind: new Map(outputArtifacts.map((artifact) => [artifact.kind, artifact]))
        });
        const outputSummaryJson = JSON.stringify(
          {
            stageKey: input.stageKey,
            artifactKinds: outputArtifacts.map((artifact) => artifact.kind),
            artifactIds: outputArtifacts.map((artifact) => artifact.id),
            finalStatus: importOutcome.status,
            reviewReason: importOutcome.reviewReason
          },
          null,
          2
        );

        this.transitionRun(run.id, "running", importOutcome.status, {
          outputSummaryJson,
          errorMessage: importOutcome.reviewReason ?? null
        });
        this.deps.itemRepository.updatePhaseStatus(
          item.id,
          importOutcome.status === "completed" ? "completed" : "review_required"
        );
        return {
          runId: run.id,
          status: importOutcome.status
        };
      });
      return completion;
    } catch (error) {
      this.deps.runInTransaction(() => {
        this.transitionRun(run.id, "running", "failed", {
          errorMessage: error instanceof Error ? error.message : String(error)
        });
        this.deps.itemRepository.updatePhaseStatus(item.id, "failed");
      });
      throw error;
    }
  }

  public importProjects(itemId: string): { importedCount: number } {
    const item = this.requireItem(itemId);
    const concept = this.deps.conceptRepository.getLatestByItemId(itemId);
    if (!concept || concept.status !== "approved") {
      throw new AppError("CONCEPT_NOT_APPROVED", "Concept must be approved before project import");
    }

    const artifact = this.deps.artifactRepository.getLatestByKind({ itemId, kind: "projects" });
    if (!artifact) {
      throw new AppError("ARTIFACT_NOT_FOUND", "No projects artifact found");
    }

    const parsed = projectsOutputSchema.parse(JSON.parse(readFileSync(resolve(this.deps.artifactRoot, artifact.path), "utf8"))) as ProjectsOutput;
    const existingProjects = this.deps.projectRepository.listByConceptId(concept.id);
    if (existingProjects.length > 0) {
      return {
        importedCount: 0
      };
    }

    this.deps.projectRepository.createMany(
      parsed.projects.map((project, index) => ({
        itemId,
        code: formatProjectCode(item.code, existingProjects.length + index + 1),
        conceptId: concept.id,
        title: project.title,
        summary: project.summary,
        goal: project.goal,
        status: "draft",
        position: index
      }))
    );

    const snapshot = this.buildSnapshot(itemId);
    assertCanMoveItem(item.currentColumn, "requirements", snapshot);
    this.deps.itemRepository.updateColumn(itemId, "requirements", "draft");
    return { importedCount: parsed.projects.length };
  }

  public approveConcept(conceptId: string): void {
    const concept = this.deps.conceptRepository.getById(conceptId);
    if (!concept) {
      throw new AppError("CONCEPT_NOT_FOUND", `Concept ${conceptId} not found`);
    }
    if (concept.status === "approved") {
      return;
    }
    this.deps.conceptRepository.updateStatus(conceptId, "approved");
  }

  public approveStories(projectId: string): void {
    if (!this.deps.userStoryRepository.hasAnyByProjectId(projectId)) {
      throw new AppError("STORIES_NOT_FOUND", "No user stories found for project");
    }
    this.deps.userStoryRepository.approveByProjectId(projectId);
    const project = this.requireProject(projectId);
    const snapshot = this.buildSnapshot(project.itemId);
    if (snapshot.allStoriesApproved) {
      const item = this.requireItem(project.itemId);
      assertCanMoveItem(item.currentColumn, "implementation", snapshot);
      this.deps.itemRepository.updateColumn(project.itemId, "implementation", "draft");
    }
  }

  public approveArchitecture(projectId: string): void {
    this.requireProject(projectId);
    const latest = this.deps.architecturePlanRepository.getLatestByProjectId(projectId);
    if (!latest) {
      throw new AppError("ARCHITECTURE_NOT_FOUND", "No architecture plan found for project");
    }
    if (latest.status === "approved") {
      return;
    }
    this.deps.architecturePlanRepository.updateStatus(latest.id, "approved");
  }

  public approvePlanning(projectId: string): void {
    this.requireProject(projectId);
    const latest = this.deps.implementationPlanRepository.getLatestByProjectId(projectId);
    if (!latest) {
      throw new AppError("IMPLEMENTATION_PLAN_NOT_FOUND", "No implementation plan found for project");
    }
    if (latest.status === "approved") {
      return;
    }
    this.deps.implementationPlanRepository.updateStatus(latest.id, "approved");
  }

  public async autorunForItem(input: {
    itemId: string;
    trigger: string;
    initialSteps?: AutorunStep[];
  }): Promise<AutorunSummary> {
    this.requireItem(input.itemId);
    return this.executeAutorun({
      trigger: input.trigger,
      scopeType: "item",
      scopeId: input.itemId,
      initialSteps: input.initialSteps ?? []
    });
  }

  public async autorunForProject(input: {
    projectId: string;
    trigger: string;
    initialSteps?: AutorunStep[];
  }): Promise<AutorunSummary> {
    this.requireProject(input.projectId);
    return this.executeAutorun({
      trigger: input.trigger,
      scopeType: "project",
      scopeId: input.projectId,
      initialSteps: input.initialSteps ?? []
    });
  }

  public async retryRun(runId: string): Promise<{ runId: string; status: string; retriedFromRunId: string }> {
    const run = this.deps.stageRunRepository.getById(runId);
    if (!run) {
      throw new AppError("RUN_NOT_FOUND", `Stage run ${runId} not found`);
    }
    if (run.status !== "review_required" && run.status !== "failed") {
      throw new AppError("RUN_NOT_RETRYABLE", `Stage run ${runId} is not retryable`);
    }
    const next = await this.startStage({
      stageKey: run.stageKey,
      itemId: run.itemId,
      ...(run.projectId ? { projectId: run.projectId } : {})
    });
    return {
      ...next,
      retriedFromRunId: runId
    };
  }

  public showItem(itemId: string) {
    const item = this.requireItem(itemId);
    const concept = this.deps.conceptRepository.getLatestByItemId(itemId);
    const projects = this.deps.projectRepository.listByItemId(itemId);
    const stageRuns = this.deps.stageRunRepository.listByItemId(itemId);
    return { item, concept, projects, stageRuns };
  }

  public listRuns(input: { itemId?: string; projectId?: string }) {
    if (input.projectId) {
      return this.deps.stageRunRepository.listByProjectId(input.projectId);
    }
    if (input.itemId) {
      return this.deps.stageRunRepository.listByItemId(input.itemId);
    }
    throw new AppError("LIST_SCOPE_REQUIRED", "Either itemId or projectId is required");
  }

  public showRun(runId: string) {
    const run = this.deps.stageRunRepository.getById(runId);
    if (!run) {
      throw new AppError("RUN_NOT_FOUND", `Stage run ${runId} not found`);
    }
    const artifacts = this.deps.artifactRepository.listByStageRunId(runId);
    const sessions = this.deps.agentSessionRepository.listByStageRunId(runId);
    return { run, artifacts, sessions };
  }

  public listArtifacts(input: { runId?: string; itemId?: string }) {
    if (input.runId) {
      return this.deps.artifactRepository.listByStageRunId(input.runId);
    }
    if (input.itemId) {
      return this.deps.artifactRepository.listByItemId(input.itemId);
    }
    throw new AppError("LIST_SCOPE_REQUIRED", "Either runId or itemId is required");
  }

  public listSessions(runId: string) {
    return this.deps.agentSessionRepository.listByStageRunId(runId);
  }

  public async startExecution(projectId: string) {
    return this.advanceExecution(projectId);
  }

  public async tickExecution(projectId: string) {
    return this.advanceExecution(projectId);
  }

  public async retryWaveStoryExecution(waveStoryExecutionId: string): Promise<RetryWaveStoryExecutionResult> {
    const previous = this.deps.waveStoryExecutionRepository.getById(waveStoryExecutionId);
    if (!previous) {
      throw new AppError("WAVE_STORY_EXECUTION_NOT_FOUND", `Wave story execution ${waveStoryExecutionId} not found`);
    }
    if (previous.status !== "failed" && previous.status !== "review_required") {
      throw new AppError("WAVE_STORY_EXECUTION_NOT_RETRYABLE", "Wave story execution is not retryable");
    }

    const waveStory = this.requireWaveStory(previous.waveStoryId);
    const waveExecution = this.requireWaveExecution(previous.waveExecutionId);
    const story = this.requireStory(previous.storyId);
    const project = this.requireProject(story.projectId);
    const plan = this.requireImplementationPlanForProject(project.id);
    const wave = this.requireWave(waveExecution.waveId);
    const projectExecutionContext = this.ensureProjectExecutionContext(project, plan);
    const testRun = await this.ensureWaveStoryTestPreparation({
      project,
      implementationPlan: plan,
      wave,
      waveExecution,
      waveStory,
      story,
      projectExecutionContext
    });
    if (testRun.status !== "completed") {
      this.refreshWaveExecutionStatus(waveExecution.id);
      return {
        phase: "test_preparation",
        waveStoryTestRunId: testRun.waveStoryTestRunId,
        waveStoryId: waveStory.id,
        storyCode: story.code,
        status: testRun.status
      };
    }
    const gitMetadata = this.gitWorkflowService.ensureStoryBranch(project.code, story.code);
    const result = await this.executeWaveStory({
      project,
      implementationPlan: plan,
      wave,
      waveExecution,
      waveStory,
      story,
      projectExecutionContext,
      testPreparationRunId: testRun.waveStoryTestRunId,
      gitMetadata
    });
    this.refreshWaveExecutionStatus(waveExecution.id);
    return {
      ...result,
      phase: result.phase as "implementation" | "story_review"
    };
  }

  public showStoryReviewRemediation(storyId: string) {
    const story = this.requireStory(storyId);
    const remediationRuns = this.deps.storyReviewRemediationRunRepository.listByStoryId(storyId);
    return {
      story,
      latestRemediationRun: remediationRuns.at(-1) ?? null,
      remediationRuns: remediationRuns.map((remediationRun) => ({
        remediationRun,
        selectedFindings: this.deps.storyReviewRemediationFindingRepository.listByRunId(remediationRun.id),
        sessions: this.deps.storyReviewRemediationAgentSessionRepository.listByRunId(remediationRun.id)
      })),
      openFindings: this.deps.storyReviewFindingRepository.listOpenByStoryId(storyId)
    };
  }

  public async startStoryReviewRemediation(storyReviewRunId: string) {
    const storyReviewRun = this.requireStoryReviewRun(storyReviewRunId);
    const sourceExecution = this.requireWaveStoryExecution(storyReviewRun.waveStoryExecutionId);
    if (storyReviewRun.status !== "review_required" && storyReviewRun.status !== "failed") {
      throw new AppError("STORY_REVIEW_RUN_NOT_REMEDIABLE", `Story review run ${storyReviewRunId} is not remediable`);
    }

    const story = this.requireStory(sourceExecution.storyId);
    const project = this.requireProject(story.projectId);
    const item = this.requireItem(project.itemId);
    const implementationPlan = this.requireImplementationPlanForProject(project.id);
    const waveStory = this.requireWaveStory(sourceExecution.waveStoryId);
    const waveExecution = this.requireWaveExecution(sourceExecution.waveExecutionId);
    const wave = this.requireWave(waveExecution.waveId);
    const projectExecutionContext = this.ensureProjectExecutionContext(project, implementationPlan);
    const selectedFindings = this.deps.storyReviewFindingRepository
      .listByStoryReviewRunId(storyReviewRun.id)
      .filter((finding) => finding.status === "open");
    if (selectedFindings.length === 0) {
      throw new AppError("STORY_REVIEW_FINDINGS_NOT_FOUND", `Story review run ${storyReviewRunId} has no open findings`);
    }

    const priorAttempts = this.deps.storyReviewRemediationRunRepository.listByStoryReviewRunId(storyReviewRun.id);
    if (priorAttempts.length >= 2) {
      throw new AppError("STORY_REVIEW_REMEDIATION_LIMIT_REACHED", `Story review run ${storyReviewRunId} reached remediation limit`);
    }

    const openFindings = this.deps.storyReviewFindingRepository.listOpenByStoryId(story.id);
    const resolvedWorkerProfile = this.resolveWorkerProfile("storyReviewRemediation");
    const inputSnapshotJson = JSON.stringify(
      {
        item: { id: item.id, code: item.code },
        project: { id: project.id, code: project.code, title: project.title },
        story: { id: story.id, code: story.code, title: story.title },
        storyReviewRun: { id: storyReviewRun.id, status: storyReviewRun.status },
        selectedFindingIds: selectedFindings.map((finding) => finding.id),
        openFindingIds: openFindings.map((finding) => finding.id),
        allowedPaths: this.deriveAllowedPathsFromStoryContext(projectExecutionContext, sourceExecution),
        successCriteria: [
          "Selected story-review findings are no longer reproduced",
          "Basic verification passes",
          "Ralph verification passes",
          "Story review passes"
        ]
      },
      null,
      2
    );
    const gitMetadata = this.gitWorkflowService.ensureStoryRemediationBranch(project.code, story.code, storyReviewRun.id);
    const remediationRun = this.deps.runInTransaction(() => {
      const createdRun = this.deps.storyReviewRemediationRunRepository.create({
        storyReviewRunId: storyReviewRun.id,
        waveStoryExecutionId: sourceExecution.id,
        remediationWaveStoryExecutionId: null,
        storyId: story.id,
        status: "running",
        attempt: priorAttempts.length + 1,
        workerRole: "story-review-remediator",
        inputSnapshotJson,
        systemPromptSnapshot: resolvedWorkerProfile.promptContent,
        skillsSnapshotJson: JSON.stringify(resolvedWorkerProfile.skills, null, 2),
        gitBranchName: gitMetadata.branchName,
        gitBaseRef: gitMetadata.baseRef,
        gitMetadataJson: JSON.stringify(gitMetadata, null, 2),
        outputSummaryJson: null,
        errorMessage: null
      });
      this.deps.storyReviewRemediationFindingRepository.createMany(
        selectedFindings.map((finding) => ({
          storyReviewRemediationRunId: createdRun.id,
          storyReviewFindingId: finding.id,
          resolutionStatus: "selected"
        }))
      );
      selectedFindings.forEach((finding) => this.deps.storyReviewFindingRepository.updateStatus(finding.id, "in_progress"));
      return createdRun;
    });

    try {
      const result = await this.executeWaveStory({
        project,
        implementationPlan,
        wave,
        waveExecution,
        waveStory,
        story,
        projectExecutionContext,
        testPreparationRunId: sourceExecution.testPreparationRunId,
        workerProfileKey: "storyReviewRemediation",
        workerRoleOverride: "story-review-remediator",
        gitMetadata
      });
      this.deps.storyReviewRemediationAgentSessionRepository.create({
        storyReviewRemediationRunId: remediationRun.id,
        adapterKey: this.deps.adapter.key,
        status: result.status === "failed" ? "failed" : "completed",
        commandJson: JSON.stringify(["remediation", storyReviewRun.id]),
        stdout: JSON.stringify(result),
        stderr: "",
        exitCode: result.status === "failed" ? 1 : 0
      });
      const remediationExecution = this.requireWaveStoryExecution(result.waveStoryExecutionId);
      const latestStoryReviewRun = this.deps.storyReviewRunRepository.getLatestByWaveStoryExecutionId(remediationExecution.id);
      if (!latestStoryReviewRun) {
        throw new AppError("STORY_REVIEW_RUN_NOT_FOUND", "Remediation execution did not create a story review run");
      }
      const latestFindings = this.deps.storyReviewFindingRepository.listByStoryReviewRunId(latestStoryReviewRun.id);
      const latestOpenKeys = new Set(latestFindings.filter((finding) => finding.status === "open").map((finding) => this.findingFingerprint(finding)));
      selectedFindings.forEach((finding) => {
        const stillOpen = latestOpenKeys.has(this.findingFingerprint(finding));
        this.deps.storyReviewRemediationFindingRepository.updateResolutionStatus(
          remediationRun.id,
          finding.id,
          stillOpen ? "still_open" : "resolved"
        );
        this.deps.storyReviewFindingRepository.updateStatus(finding.id, stillOpen ? "open" : "resolved");
      });
      const remediationStatus =
        latestStoryReviewRun.status === "passed"
          ? "completed"
          : latestStoryReviewRun.status === "review_required"
            ? "review_required"
            : "failed";
      this.deps.storyReviewRemediationRunRepository.updateStatus(remediationRun.id, remediationStatus, {
        remediationWaveStoryExecutionId: remediationExecution.id,
        outputSummaryJson: JSON.stringify(
          {
            waveStoryExecutionId: remediationExecution.id,
            storyReviewRunId: latestStoryReviewRun.id,
            selectedFindingIds: selectedFindings.map((finding) => finding.id)
          },
          null,
          2
        ),
        gitMetadata,
        errorMessage: remediationStatus === "failed" ? remediationExecution.errorMessage : null
      });
      if (remediationStatus === "completed") {
        this.invalidateDocumentationForProject(project.id, `story review remediation ${remediationRun.id}`);
      }
      this.refreshWaveExecutionStatus(waveExecution.id);
      return {
        storyReviewRemediationRunId: remediationRun.id,
        remediationWaveStoryExecutionId: remediationExecution.id,
        status: remediationStatus
      };
    } catch (error) {
      this.deps.storyReviewRemediationAgentSessionRepository.create({
        storyReviewRemediationRunId: remediationRun.id,
        adapterKey: this.deps.adapter.key,
        status: "failed",
        commandJson: JSON.stringify(["remediation", storyReviewRun.id]),
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1
      });
      this.deps.runInTransaction(() => {
        selectedFindings.forEach((finding) => this.deps.storyReviewFindingRepository.updateStatus(finding.id, "open"));
        this.deps.storyReviewRemediationRunRepository.updateStatus(remediationRun.id, "failed", {
          gitMetadata,
          errorMessage: error instanceof Error ? error.message : String(error)
        });
      });
      throw error;
    }
  }

  public async retryStoryReviewRemediation(storyReviewRemediationRunId: string) {
    const remediationRun = this.requireStoryReviewRemediationRun(storyReviewRemediationRunId);
    const priorAttempts = this.deps.storyReviewRemediationRunRepository.listByStoryReviewRunId(remediationRun.storyReviewRunId);
    if (priorAttempts.length >= 2) {
      throw new AppError(
        "STORY_REVIEW_REMEDIATION_LIMIT_REACHED",
        `Story review remediation ${storyReviewRemediationRunId} reached remediation limit`
      );
    }
    if (remediationRun.status !== "review_required" && remediationRun.status !== "failed") {
      throw new AppError(
        "STORY_REVIEW_REMEDIATION_NOT_RETRYABLE",
        `Story review remediation ${storyReviewRemediationRunId} is not retryable`
      );
    }
    const next = await this.startStoryReviewRemediation(remediationRun.storyReviewRunId);
    return {
      ...next,
      retriedFromStoryReviewRemediationRunId: storyReviewRemediationRunId
    };
  }

  public async startQa(projectId: string) {
    const project = this.requireProject(projectId);
    const item = this.requireItem(project.itemId);
    const implementationPlan = this.requireImplementationPlanForProject(projectId);
    const architecture = this.deps.architecturePlanRepository.getLatestByProjectId(projectId);
    const projectExecutionContext = this.ensureProjectExecutionContext(project, implementationPlan);
    const qaContext = this.buildQaRunContext({
      project,
      item,
      implementationPlan,
      projectExecutionContext
    });
    const resolvedWorkerProfile = this.resolveWorkerProfile("qa");

    this.deps.itemRepository.updatePhaseStatus(item.id, "running");

    const qaRun = this.deps.qaRunRepository.create({
      projectId,
      mode: "full",
      status: "running",
      inputSnapshotJson: qaContext.inputSnapshotJson,
      systemPromptSnapshot: resolvedWorkerProfile.promptContent,
      skillsSnapshotJson: JSON.stringify(resolvedWorkerProfile.skills, null, 2),
      summaryJson: null,
      errorMessage: null
    });

    try {
      const result = await this.deps.adapter.runProjectQa({
        workerRole: "qa-verifier",
        prompt: resolvedWorkerProfile.promptContent,
        skills: resolvedWorkerProfile.skills,
        item: {
          id: item.id,
          code: item.code,
          title: item.title,
          description: item.description
        },
        project: {
          id: project.id,
          code: project.code,
          title: project.title,
          summary: project.summary,
          goal: project.goal
        },
        implementationPlan: {
          id: implementationPlan.id,
          summary: implementationPlan.summary,
          version: implementationPlan.version
        },
        architecture: architecture
          ? {
              id: architecture.id,
              summary: architecture.summary,
              version: architecture.version
            }
          : null,
        projectExecutionContext: qaContext.projectExecutionContext,
        inputSnapshotJson: qaRun.inputSnapshotJson,
        waves: qaContext.waves,
        stories: qaContext.stories
      });

      const parsed = qaOutputSchema.parse(result.output) as QaOutput;
      this.deps.qaAgentSessionRepository.create({
        qaRunId: qaRun.id,
        adapterKey: this.deps.adapter.key,
        status: result.exitCode === 0 ? "completed" : "failed",
        commandJson: JSON.stringify(result.command),
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode
      });
      const status = this.resolveQaRunStatus(parsed, result.exitCode);
      const storyByCode = new Map(qaContext.stories.map((story) => [story.code, story]));
      const acceptanceCriterionByCode = new Map(
        qaContext.stories.flatMap((story) =>
          story.acceptanceCriteria.map((criterion) => [criterion.code, criterion] as const)
        )
      );

      this.deps.qaFindingRepository.createMany(
        parsed.findings.map((finding) => {
          const storyContext = finding.storyCode ? storyByCode.get(finding.storyCode) ?? null : null;
          const acceptanceCriterion = finding.acceptanceCriterionCode
            ? acceptanceCriterionByCode.get(finding.acceptanceCriterionCode) ?? null
            : null;
          return {
            qaRunId: qaRun.id,
            severity: finding.severity,
            category: finding.category,
            title: finding.title,
            description: finding.description,
            evidence: finding.evidence,
            reproSteps: finding.reproSteps,
            suggestedFix: finding.suggestedFix ?? null,
            status: "open",
            storyId: storyContext?.id ?? null,
            acceptanceCriterionId: acceptanceCriterion?.id ?? null,
            waveStoryExecutionId: storyContext?.latestExecution.id ?? null
          };
        })
      );
      this.deps.qaRunRepository.updateStatus(qaRun.id, status, {
        summaryJson: JSON.stringify(parsed, null, 2),
        errorMessage: null
      });
      this.deps.itemRepository.updatePhaseStatus(item.id, this.mapQaRunStatusToItemPhaseStatus(status));

      return {
        projectId,
        qaRunId: qaRun.id,
        status
      };
    } catch (error) {
      this.deps.qaAgentSessionRepository.create({
        qaRunId: qaRun.id,
        adapterKey: this.deps.adapter.key,
        status: "failed",
        commandJson: JSON.stringify([]),
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1
      });
      this.deps.qaRunRepository.updateStatus(qaRun.id, "failed", {
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      this.deps.itemRepository.updatePhaseStatus(item.id, "failed");
      throw error;
    }
  }

  public showQa(projectId: string) {
    const project = this.requireProject(projectId);
    const implementationPlan = this.requireImplementationPlanForProject(projectId);
    const qaRuns = this.deps.qaRunRepository.listByProjectId(projectId);

    return {
      project,
      implementationPlan,
      latestQaRun: qaRuns.at(-1) ?? null,
      qaRuns: qaRuns.map((qaRun) => ({
        qaRun,
        findings: this.deps.qaFindingRepository.listByQaRunId(qaRun.id),
        sessions: this.deps.qaAgentSessionRepository.listByQaRunId(qaRun.id)
      }))
    };
  }

  public async retryQa(qaRunId: string) {
    const qaRun = this.requireQaRun(qaRunId);
    if (qaRun.status !== "review_required" && qaRun.status !== "failed") {
      throw new AppError("QA_RUN_NOT_RETRYABLE", `QA run ${qaRunId} is not retryable`);
    }
    const next = await this.startQa(qaRun.projectId);
    return {
      ...next,
      retriedFromQaRunId: qaRunId
    };
  }

  public async startDocumentation(projectId: string) {
    const project = this.requireProject(projectId);
    const item = this.requireItem(project.itemId);
    const implementationPlan = this.requireImplementationPlanForProject(projectId);
    const projectExecutionContext = this.ensureProjectExecutionContext(project, implementationPlan);
    const documentationContext = this.buildDocumentationRunContext({
      project,
      item,
      implementationPlan,
      projectExecutionContext
    });
    const staleDocumentationRun = this.deps.documentationRunRepository.getLatestByProjectId(projectId);
    const resolvedWorkerProfile = this.resolveWorkerProfile("documentation");

    this.deps.itemRepository.updatePhaseStatus(item.id, "running");

    const documentationRun = this.deps.documentationRunRepository.create({
      projectId,
      status: "running",
      inputSnapshotJson: documentationContext.inputSnapshotJson,
      systemPromptSnapshot: resolvedWorkerProfile.promptContent,
      skillsSnapshotJson: JSON.stringify(resolvedWorkerProfile.skills, null, 2),
      staleAt: null,
      staleReason: null,
      summaryJson: null,
      errorMessage: null
    });

    try {
      const result = await this.deps.adapter.runProjectDocumentation({
        workerRole: "documentation-writer",
        prompt: resolvedWorkerProfile.promptContent,
        skills: resolvedWorkerProfile.skills,
        item: {
          id: item.id,
          code: item.code,
          title: item.title,
          description: item.description
        },
        project: {
          id: project.id,
          code: project.code,
          title: project.title,
          summary: project.summary,
          goal: project.goal
        },
        concept: documentationContext.concept
          ? {
              id: documentationContext.concept.id,
              version: documentationContext.concept.version,
              title: documentationContext.concept.title,
              summary: documentationContext.concept.summary
            }
          : null,
        implementationPlan: {
          id: implementationPlan.id,
          summary: implementationPlan.summary,
          version: implementationPlan.version
        },
        architecture: documentationContext.architecture
          ? {
              id: documentationContext.architecture.id,
              summary: documentationContext.architecture.summary,
              version: documentationContext.architecture.version
            }
          : null,
        projectExecutionContext: documentationContext.projectExecutionContext,
        inputSnapshotJson: documentationRun.inputSnapshotJson,
        latestQaRun: {
          id: documentationContext.latestQaRun.id,
          status: documentationContext.latestQaRun.status,
          summaryJson: documentationContext.latestQaRun.summaryJson
        },
        openQaFindings: documentationContext.openQaFindings,
        waves: documentationContext.waves,
        stories: documentationContext.stories
      });

      const parsed = documentationOutputSchema.parse(result.output) as DocumentationOutput;
      this.deps.documentationAgentSessionRepository.create({
        documentationRunId: documentationRun.id,
        adapterKey: this.deps.adapter.key,
        status: result.exitCode === 0 ? "completed" : "failed",
        commandJson: JSON.stringify(result.command),
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode
      });
      const artifactRecords = this.persistArtifacts({
        itemId: item.id,
        projectId: project.id,
        runId: documentationRun.id,
        linkStageRunId: false,
        markdownArtifacts: [{ kind: "delivery-report", content: parsed.reportMarkdown }],
        structuredArtifacts: [
          {
            kind: "delivery-report-data",
            content: {
              projectCode: parsed.projectCode,
              overallStatus: parsed.overallStatus,
              summary: parsed.summary,
              originalScope: parsed.originalScope,
              deliveredScope: parsed.deliveredScope,
              architectureSnapshot: parsed.architectureSnapshot,
              waves: parsed.waves,
              storiesDelivered: parsed.storiesDelivered,
              verificationSummary: parsed.verificationSummary,
              technicalReviewSummary: parsed.technicalReviewSummary,
              qaSummary: parsed.qaSummary,
              openFollowUps: parsed.openFollowUps,
              keyChangedAreas: parsed.keyChangedAreas
            }
          }
        ]
      });
      const status = this.resolveDocumentationRunStatus(documentationContext.latestQaRun.status, result.exitCode, parsed);
      this.deps.documentationRunRepository.updateStatus(documentationRun.id, status, {
        summaryJson: JSON.stringify(
          {
            projectCode: parsed.projectCode,
            overallStatus: parsed.overallStatus,
            summary: parsed.summary,
            originalScope: parsed.originalScope,
            deliveredScope: parsed.deliveredScope,
            architectureSnapshot: parsed.architectureSnapshot,
            waves: parsed.waves,
            storiesDelivered: parsed.storiesDelivered,
            verificationSummary: parsed.verificationSummary,
            technicalReviewSummary: parsed.technicalReviewSummary,
            qaSummary: parsed.qaSummary,
            openFollowUps: parsed.openFollowUps,
            keyChangedAreas: parsed.keyChangedAreas,
            artifactIds: artifactRecords.map((artifact) => artifact.id),
            artifactKinds: artifactRecords.map((artifact) => artifact.kind)
          },
          null,
          2
        ),
        errorMessage: null
      });
      this.deps.itemRepository.updatePhaseStatus(item.id, this.mapDocumentationRunStatusToItemPhaseStatus(status));
      if (status === "completed") {
        this.completeItemIfDeliveryFinished(item.id);
      }

      return {
        projectId,
        documentationRunId: documentationRun.id,
        status,
        replacesStaleDocumentationRunId: staleDocumentationRun?.staleAt ? staleDocumentationRun.id : null
      };
    } catch (error) {
      this.deps.documentationAgentSessionRepository.create({
        documentationRunId: documentationRun.id,
        adapterKey: this.deps.adapter.key,
        status: "failed",
        commandJson: JSON.stringify([]),
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1
      });
      this.deps.documentationRunRepository.updateStatus(documentationRun.id, "failed", {
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      this.deps.itemRepository.updatePhaseStatus(item.id, "failed");
      throw error;
    }
  }

  public showDocumentation(projectId: string) {
    const project = this.requireProject(projectId);
    const implementationPlan = this.requireImplementationPlanForProject(projectId);
    const documentationRuns = this.deps.documentationRunRepository.listByProjectId(projectId);

    return {
      project,
      implementationPlan,
      latestDocumentationRun: documentationRuns.at(-1) ?? null,
      hasStaleDocumentation: documentationRuns.some((documentationRun) => documentationRun.staleAt !== null),
      documentationRuns: documentationRuns.map((documentationRun) => ({
        documentationRun,
        artifacts: this.listArtifactsForDocumentationRun(documentationRun),
        sessions: this.deps.documentationAgentSessionRepository.listByDocumentationRunId(documentationRun.id)
      }))
    };
  }

  public async retryDocumentation(documentationRunId: string) {
    const documentationRun = this.requireDocumentationRun(documentationRunId);
    if (documentationRun.status !== "review_required" && documentationRun.status !== "failed") {
      throw new AppError(
        "DOCUMENTATION_RUN_NOT_RETRYABLE",
        `Documentation run ${documentationRunId} is not retryable`
      );
    }
    const next = await this.startDocumentation(documentationRun.projectId);
    return {
      ...next,
      retriedFromDocumentationRunId: documentationRunId
    };
  }

  public showExecution(projectId: string) {
    const project = this.requireProject(projectId);
    const plan = this.requireImplementationPlanForProject(projectId);
    const context = this.deps.projectExecutionContextRepository.getByProjectId(projectId);
    const waves = this.deps.waveRepository.listByImplementationPlanId(plan.id);
    const wavePayload = waves.map((wave) => {
      const waveExecution = this.deps.waveExecutionRepository.getLatestByWaveId(wave.id);
      const waveStories = this.deps.waveStoryRepository.listByWaveId(wave.id);
      const storyExecutions = waveStories.map((waveStory) => {
        const story = this.requireStory(waveStory.storyId);
        const latestTestRun = this.deps.waveStoryTestRunRepository.getLatestByWaveStoryId(waveStory.id);
        const latestExecution = this.deps.waveStoryExecutionRepository.getLatestByWaveStoryId(waveStory.id);
        const verificationRuns = latestExecution
          ? this.deps.verificationRunRepository.listByWaveStoryExecutionId(latestExecution.id)
          : [];
        const latestBasicVerification = verificationRuns.filter((run) => run.mode === "basic").at(-1) ?? null;
        const latestRalphVerification = verificationRuns.filter((run) => run.mode === "ralph").at(-1) ?? null;
        const latestStoryReviewRun = latestExecution
          ? this.deps.storyReviewRunRepository.getLatestByWaveStoryExecutionId(latestExecution.id)
          : null;
        const remediationRuns = this.deps.storyReviewRemediationRunRepository.listByStoryId(story.id);
        const blockers = this.deps.waveStoryDependencyRepository
          .listByDependentStoryId(story.id)
          .map((dependency) => this.requireStory(dependency.blockingStoryId))
          .filter((blockingStory) => {
            const blockingWaveStory = this.requireWaveStoryByStoryId(blockingStory.id);
            const blockingExecution = this.deps.waveStoryExecutionRepository.getLatestByWaveStoryId(blockingWaveStory.id);
            return blockingExecution?.status !== "completed";
          })
          .map((blockingStory) => blockingStory.code);
        return {
          waveStory,
          story,
          latestTestRun,
          latestExecution,
          blockers,
          testAgentSessions: latestTestRun
            ? this.deps.testAgentSessionRepository.listByWaveStoryTestRunId(latestTestRun.id)
            : [],
          verificationRuns,
          latestBasicVerification,
          latestRalphVerification,
          latestStoryReviewRun,
          latestStoryReviewFindings: latestStoryReviewRun
            ? this.deps.storyReviewFindingRepository.listByStoryReviewRunId(latestStoryReviewRun.id)
            : [],
          latestStoryReviewRemediationRun: remediationRuns.at(-1) ?? null,
          storyReviewRemediationRuns: remediationRuns.map((remediationRun) => ({
            remediationRun,
            selectedFindings: this.deps.storyReviewRemediationFindingRepository.listByRunId(remediationRun.id),
            sessions: this.deps.storyReviewRemediationAgentSessionRepository.listByRunId(remediationRun.id)
          })),
          agentSessions: latestExecution
            ? this.deps.executionAgentSessionRepository.listByWaveStoryExecutionId(latestExecution.id)
            : [],
          storyReviewAgentSessions: latestStoryReviewRun
            ? this.deps.storyReviewAgentSessionRepository.listByStoryReviewRunId(latestStoryReviewRun.id)
            : []
        };
      });
      return {
        wave,
        waveExecution,
        stories: storyExecutions
      };
    });

    const activeWave = wavePayload.find((entry) => entry.waveExecution?.status !== "completed") ?? null;

    return {
      project,
      implementationPlan: plan,
      projectExecutionContext: context,
      activeWave: activeWave?.wave ?? null,
      waves: wavePayload
    };
  }

  private async advanceExecution(projectId: string) {
    const project = this.requireProject(projectId);
    this.gitWorkflowService.ensureProjectBranch(project.code);
    const implementationPlan = this.requireImplementationPlanForProject(projectId);
    const waves = this.deps.waveRepository.listByImplementationPlanId(implementationPlan.id);
    if (waves.length === 0) {
      throw new AppError("WAVES_NOT_FOUND", "Implementation plan has no waves");
    }

    const activeWave = this.resolveActiveWave(waves);
    if (!activeWave) {
      return {
        projectId,
        implementationPlanId: implementationPlan.id,
        activeWaveCode: null,
        scheduledCount: 0,
        completed: true,
        executions: []
      };
    }

    const projectExecutionContext = this.ensureProjectExecutionContext(project, implementationPlan);
    const waveExecution = this.ensureWaveExecution(activeWave.id);
    if (waveExecution.status === "failed") {
      return {
        projectId,
        implementationPlanId: implementationPlan.id,
        activeWaveCode: activeWave.code,
        scheduledCount: 0,
        completed: false,
        blockedByFailure: true,
        executions: []
      };
    }
    const executableStories = this.resolveExecutableWaveStories(activeWave.id);
    if (executableStories.length === 0) {
      this.refreshWaveExecutionStatus(waveExecution.id);
      return {
        projectId,
        implementationPlanId: implementationPlan.id,
        activeWaveCode: activeWave.code,
        scheduledCount: 0,
        completed: false,
        blockedByFailure: false,
        executions: []
      };
    }

    const executions = [];
    for (const waveStory of executableStories) {
      const story = this.requireStory(waveStory.storyId);
      const gitMetadata = this.gitWorkflowService.ensureStoryBranch(project.code, story.code);
      const testRun = await this.ensureWaveStoryTestPreparation({
        project,
        implementationPlan,
        wave: activeWave,
        waveExecution,
        waveStory,
        story,
        projectExecutionContext
      });
      if (testRun.status !== "completed") {
        executions.push(testRun);
        continue;
      }
      const result = await this.executeWaveStory({
        project,
        implementationPlan,
        wave: activeWave,
        waveExecution,
        waveStory,
        story,
        projectExecutionContext,
        testPreparationRunId: testRun.waveStoryTestRunId,
        gitMetadata
      });
      executions.push(result);
    }

    this.refreshWaveExecutionStatus(waveExecution.id);
    return {
      projectId,
      implementationPlanId: implementationPlan.id,
      activeWaveCode: activeWave.code,
      scheduledCount: executions.length,
      completed: false,
      blockedByFailure: false,
      executions
    };
  }

  private async executeWaveStory(input: {
    project: ReturnType<WorkflowService["requireProject"]>;
    implementationPlan: ReturnType<WorkflowService["requireImplementationPlanForProject"]>;
    wave: ReturnType<WorkflowService["requireWave"]>;
    waveExecution: ReturnType<WorkflowService["requireWaveExecution"]>;
    waveStory: ReturnType<WorkflowService["requireWaveStory"]>;
    story: ReturnType<WorkflowService["requireStory"]>;
    projectExecutionContext?: ReturnType<WorkflowService["ensureProjectExecutionContext"]>;
    testPreparationRunId: string;
    workerProfileKey?: WorkerProfileKey;
    workerRoleOverride?: ExecutionWorkerRole;
    gitMetadata?: GitBranchMetadata | null;
  }) {
    const resolvedWorkerProfile = this.resolveWorkerProfile(input.workerProfileKey ?? "execution");
    const storyRunContext = this.buildStoryRunContext({
      project: input.project,
      implementationPlan: input.implementationPlan,
      wave: input.wave,
      story: input.story,
      projectExecutionContext: input.projectExecutionContext
    });
    const testPreparationRun = this.requireWaveStoryTestRun(input.testPreparationRunId);
    const parsedTestPreparation = this.parseTestPreparationOutput(testPreparationRun);
    const workerRole = input.workerRoleOverride ?? this.selectWorkerRole(input.story, storyRunContext.acceptanceCriteria);
    const previousAttempts = this.deps.waveStoryExecutionRepository.listByWaveStoryId(input.waveStory.id);
    const execution = this.deps.waveStoryExecutionRepository.create({
      waveExecutionId: input.waveExecution.id,
      testPreparationRunId: testPreparationRun.id,
      waveStoryId: input.waveStory.id,
      storyId: input.story.id,
      status: "running",
      attempt: previousAttempts.length + 1,
      workerRole,
      systemPromptSnapshot: resolvedWorkerProfile.promptContent,
      skillsSnapshotJson: JSON.stringify(resolvedWorkerProfile.skills, null, 2),
      businessContextSnapshotJson: storyRunContext.businessContextSnapshotJson,
      repoContextSnapshotJson: storyRunContext.repoContextSnapshotJson,
      gitBranchName: input.gitMetadata?.branchName ?? null,
      gitBaseRef: input.gitMetadata?.baseRef ?? null,
      gitMetadataJson: input.gitMetadata ? JSON.stringify(input.gitMetadata, null, 2) : null,
      outputSummaryJson: null,
      errorMessage: null
    });

    try {
      const result = await this.deps.adapter.runStoryExecution({
        workerRole,
        prompt: resolvedWorkerProfile.promptContent,
        skills: resolvedWorkerProfile.skills,
        item: storyRunContext.item,
        project: input.project,
        implementationPlan: {
          id: input.implementationPlan.id,
          summary: input.implementationPlan.summary,
          version: input.implementationPlan.version
        },
        wave: {
          id: input.wave.id,
          code: input.wave.code,
          goal: input.wave.goal,
          position: input.wave.position
        },
        story: input.story,
        acceptanceCriteria: storyRunContext.acceptanceCriteria,
        architecture: storyRunContext.architecture
          ? {
              id: storyRunContext.architecture.id,
              summary: storyRunContext.architecture.summary,
              version: storyRunContext.architecture.version
            }
          : null,
        projectExecutionContext: storyRunContext.projectExecutionContext,
        businessContextSnapshotJson: storyRunContext.businessContextSnapshotJson,
        repoContextSnapshotJson: storyRunContext.repoContextSnapshotJson,
        testPreparation: {
          id: testPreparationRun.id,
          summary: parsedTestPreparation.summary,
          testFiles: parsedTestPreparation.testFiles,
          testsGenerated: parsedTestPreparation.testsGenerated,
          assumptions: parsedTestPreparation.assumptions
        }
      });

      const parsed = storyExecutionOutputSchema.parse(result.output) as StoryExecutionOutput;
      this.deps.executionAgentSessionRepository.create({
        waveStoryExecutionId: execution.id,
        adapterKey: this.deps.adapter.key,
        status: result.exitCode === 0 ? "completed" : "failed",
        commandJson: JSON.stringify(result.command),
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode
      });

      const basicVerificationStatus = this.resolveVerificationStatus(parsed, result.exitCode);
      const basicVerificationSummary = {
        storyCode: input.story.code,
        changedFiles: parsed.changedFiles,
        testsRun: parsed.testsRun,
        blockers: parsed.blockers
      };
      this.deps.verificationRunRepository.create({
        waveExecutionId: input.waveExecution.id,
        waveStoryExecutionId: execution.id,
        mode: "basic",
        status: basicVerificationStatus,
        systemPromptSnapshot: null,
        skillsSnapshotJson: null,
        summaryJson: JSON.stringify(basicVerificationSummary, null, 2),
        errorMessage: basicVerificationStatus === "failed" ? "Execution worker reported failed verification" : null
      });
      const ralphVerification = await this.executeRalphVerification({
        project: input.project,
        implementationPlan: input.implementationPlan,
        wave: input.wave,
        waveExecution: input.waveExecution,
        story: input.story,
        storyRunContext,
        testPreparationRun,
        parsedTestPreparation,
        execution,
        implementationOutput: parsed,
        basicVerificationStatus,
        basicVerificationSummary
      });
      const storyReview =
        basicVerificationStatus === "passed" && ralphVerification.status === "passed"
          ? await this.executeStoryReview({
              project: input.project,
              implementationPlan: input.implementationPlan,
              wave: input.wave,
              story: input.story,
              storyRunContext,
              testPreparationRun,
              parsedTestPreparation,
              execution,
              implementationOutput: parsed,
              basicVerificationStatus,
              basicVerificationSummary,
              ralphVerificationStatus: ralphVerification.status,
              ralphVerificationSummary: ralphVerification.summary
            })
          : null;
      const finalExecutionStatus = this.resolveOverallExecutionStatus(
        basicVerificationStatus,
        ralphVerification.status,
        storyReview?.status ?? null
      );
      const outputSummaryJson = JSON.stringify(parsed, null, 2);
      this.deps.waveStoryExecutionRepository.updateStatus(
        execution.id,
        finalExecutionStatus === "passed" ? "completed" : finalExecutionStatus,
        {
          outputSummaryJson,
          gitMetadata: input.gitMetadata ?? null,
          errorMessage:
            parsed.blockers.join("; ") ||
            ralphVerification.errorMessage ||
            storyReview?.errorMessage ||
            null
        }
      );
      return {
        phase: storyReview ? "story_review" : "implementation",
        waveStoryExecutionId: execution.id,
        waveStoryId: input.waveStory.id,
        storyCode: input.story.code,
        status: finalExecutionStatus === "passed" ? "completed" : finalExecutionStatus
      };
    } catch (error) {
      this.deps.executionAgentSessionRepository.create({
        waveStoryExecutionId: execution.id,
        adapterKey: this.deps.adapter.key,
        status: "failed",
        commandJson: JSON.stringify([]),
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1
      });
      this.deps.verificationRunRepository.create({
        waveExecutionId: input.waveExecution.id,
        waveStoryExecutionId: execution.id,
        mode: "basic",
        status: "failed",
        systemPromptSnapshot: null,
        skillsSnapshotJson: null,
        summaryJson: JSON.stringify({ changedFiles: [], testsRun: [], blockers: [] }, null, 2),
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      this.deps.verificationRunRepository.create({
        waveExecutionId: input.waveExecution.id,
        waveStoryExecutionId: execution.id,
        mode: "ralph",
        status: "failed",
        systemPromptSnapshot: null,
        skillsSnapshotJson: null,
        summaryJson: JSON.stringify(
          {
            storyCode: input.story.code,
            overallStatus: "failed",
            summary: `Ralph verification could not run for ${input.story.code}.`,
            acceptanceCriteriaResults: [],
            blockers: [error instanceof Error ? error.message : String(error)]
          },
          null,
          2
        ),
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      this.deps.waveStoryExecutionRepository.updateStatus(execution.id, "failed", {
        gitMetadata: input.gitMetadata ?? null,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      return {
        phase: "implementation",
        waveStoryExecutionId: execution.id,
        waveStoryId: input.waveStory.id,
        storyCode: input.story.code,
        status: "failed"
      };
    }
  }

  private async ensureWaveStoryTestPreparation(input: {
    project: ReturnType<WorkflowService["requireProject"]>;
    implementationPlan: ReturnType<WorkflowService["requireImplementationPlanForProject"]>;
    wave: ReturnType<WorkflowService["requireWave"]>;
    waveExecution: ReturnType<WorkflowService["requireWaveExecution"]>;
    waveStory: ReturnType<WorkflowService["requireWaveStory"]>;
    story: ReturnType<WorkflowService["requireStory"]>;
    projectExecutionContext?: ReturnType<WorkflowService["ensureProjectExecutionContext"]>;
  }) {
    const latest = this.deps.waveStoryTestRunRepository.getLatestByWaveStoryId(input.waveStory.id);
    if (latest?.status === "completed") {
      return {
        phase: "test_preparation",
        waveStoryTestRunId: latest.id,
        waveStoryId: input.waveStory.id,
        storyCode: input.story.code,
        status: "completed" as const
      };
    }

    const resolvedWorkerProfile = this.resolveWorkerProfile("testPreparation");
    const storyRunContext = this.buildStoryRunContext({
      project: input.project,
      implementationPlan: input.implementationPlan,
      wave: input.wave,
      story: input.story,
      projectExecutionContext: input.projectExecutionContext
    });

    const testRun = this.deps.waveStoryTestRunRepository.create({
      waveExecutionId: input.waveExecution.id,
      waveStoryId: input.waveStory.id,
      storyId: input.story.id,
      status: "running",
      attempt: (latest?.attempt ?? 0) + 1,
      workerRole: "test-writer",
      systemPromptSnapshot: resolvedWorkerProfile.promptContent,
      skillsSnapshotJson: JSON.stringify(resolvedWorkerProfile.skills, null, 2),
      businessContextSnapshotJson: storyRunContext.businessContextSnapshotJson,
      repoContextSnapshotJson: storyRunContext.repoContextSnapshotJson,
      outputSummaryJson: null,
      errorMessage: null
    });

    try {
      const result = await this.deps.adapter.runStoryTestPreparation({
        workerRole: "test-writer",
        prompt: resolvedWorkerProfile.promptContent,
        skills: resolvedWorkerProfile.skills,
        item: storyRunContext.item,
        project: input.project,
        implementationPlan: {
          id: input.implementationPlan.id,
          summary: input.implementationPlan.summary,
          version: input.implementationPlan.version
        },
        wave: {
          id: input.wave.id,
          code: input.wave.code,
          goal: input.wave.goal,
          position: input.wave.position
        },
        story: input.story,
        acceptanceCriteria: storyRunContext.acceptanceCriteria,
        architecture: storyRunContext.architecture
          ? {
              id: storyRunContext.architecture.id,
              summary: storyRunContext.architecture.summary,
              version: storyRunContext.architecture.version
            }
          : null,
        projectExecutionContext: storyRunContext.projectExecutionContext,
        businessContextSnapshotJson: storyRunContext.businessContextSnapshotJson,
        repoContextSnapshotJson: storyRunContext.repoContextSnapshotJson
      });

      const parsed = testPreparationOutputSchema.parse(result.output) as TestPreparationOutput;
      this.deps.testAgentSessionRepository.create({
        waveStoryTestRunId: testRun.id,
        adapterKey: this.deps.adapter.key,
        status: result.exitCode === 0 ? "completed" : "failed",
        commandJson: JSON.stringify(result.command),
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode
      });

      const status = this.resolveTestPreparationStatus(parsed, result.exitCode);
      this.deps.waveStoryTestRunRepository.updateStatus(testRun.id, status, {
        outputSummaryJson: JSON.stringify(parsed, null, 2),
        errorMessage: parsed.blockers.join("; ") || null
      });

      return {
        phase: "test_preparation",
        waveStoryTestRunId: testRun.id,
        waveStoryId: input.waveStory.id,
        storyCode: input.story.code,
        status
      };
    } catch (error) {
      this.deps.testAgentSessionRepository.create({
        waveStoryTestRunId: testRun.id,
        adapterKey: this.deps.adapter.key,
        status: "failed",
        commandJson: JSON.stringify([]),
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1
      });
      this.deps.waveStoryTestRunRepository.updateStatus(testRun.id, "failed", {
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      return {
        phase: "test_preparation",
        waveStoryTestRunId: testRun.id,
        waveStoryId: input.waveStory.id,
        storyCode: input.story.code,
        status: "failed" as const
      };
    }
  }

  private ensureProjectExecutionContext(
    project: ReturnType<WorkflowService["requireProject"]>,
    implementationPlan: ReturnType<WorkflowService["requireImplementationPlanForProject"]>
  ) {
    const existing = this.deps.projectExecutionContextRepository.getByProjectId(project.id);
    const architecture = this.deps.architecturePlanRepository.getLatestByProjectId(project.id);
    const relevantDirectories = ["src", "test", "docs"].filter((directory) =>
      existsSync(resolve(this.deps.repoRoot, directory))
    );
    const relevantFiles = ["README.md", "AGENTS.md", "docs/architecture.md"].filter((filePath) =>
      existsSync(resolve(this.deps.repoRoot, filePath))
    );
    const integrationPoints = [
      `implementation-plan:${implementationPlan.id}`,
      architecture ? `architecture-plan:${architecture.id}` : null,
      "cli",
      "workflow-service"
    ].filter((value): value is string => value !== null);
    const testLocations = ["test/unit", "test/integration", "test/e2e"];
    const repoConventions = [
      "Engine controls orchestration and retries",
      "One bounded worker run per executable story",
      "Prompts and skills stay file-based with stored snapshots"
    ];
    const executionNotes = existing?.executionNotes ?? ["Initial execution context created by engine heuristics"];

    return this.deps.projectExecutionContextRepository.upsert({
      projectId: project.id,
      relevantDirectories,
      relevantFiles,
      integrationPoints,
      testLocations,
      repoConventions,
      executionNotes
    });
  }

  private resolveActiveWave(waves: Array<ReturnType<WorkflowService["requireWave"]>>) {
    for (const wave of waves) {
      const latestExecution = this.deps.waveExecutionRepository.getLatestByWaveId(wave.id);
      if (!latestExecution || latestExecution.status !== "completed") {
        return wave;
      }
    }
    return null;
  }

  private ensureWaveExecution(waveId: string) {
    const latest = this.deps.waveExecutionRepository.getLatestByWaveId(waveId);
    if (latest?.status === "failed") {
      return latest;
    }
    if (latest && latest.status !== "completed") {
      if (latest.status !== "running") {
        this.deps.waveExecutionRepository.updateStatus(latest.id, "running");
        return this.requireWaveExecution(latest.id);
      }
      return latest;
    }
    return this.deps.waveExecutionRepository.create({
      waveId,
      status: "running",
      attempt: (latest?.attempt ?? 0) + 1
    });
  }

  private resolveExecutableWaveStories(waveId: string) {
    return this.deps.waveStoryRepository.listByWaveId(waveId).filter((waveStory) => {
      const latestExecution = this.deps.waveStoryExecutionRepository.getLatestByWaveStoryId(waveStory.id);
      if (latestExecution) {
        return false;
      }
      const story = this.requireStory(waveStory.storyId);
      return this.deps.waveStoryDependencyRepository
        .listByDependentStoryId(story.id)
        .every((dependency) => {
          const blockingWaveStory = this.requireWaveStoryByStoryId(dependency.blockingStoryId);
          const blockingExecution = this.deps.waveStoryExecutionRepository.getLatestByWaveStoryId(blockingWaveStory.id);
          return blockingExecution?.status === "completed";
        });
    });
  }

  private refreshWaveExecutionStatus(waveExecutionId: string): void {
    const waveExecution = this.requireWaveExecution(waveExecutionId);
    const waveStories = this.deps.waveStoryRepository.listByWaveId(waveExecution.waveId);
    const latestTestRuns = waveStories.map((waveStory) => this.deps.waveStoryTestRunRepository.getLatestByWaveStoryId(waveStory.id));
    const latestStoryExecutions = waveStories.map((waveStory) =>
      this.deps.waveStoryExecutionRepository.getLatestByWaveStoryId(waveStory.id)
    );
    const latestRalphRuns = latestStoryExecutions.map((execution) =>
      execution ? this.deps.verificationRunRepository.getLatestByWaveStoryExecutionIdAndMode(execution.id, "ralph") : null
    );
    const latestStoryReviewRuns = latestStoryExecutions.map((execution) =>
      execution ? this.deps.storyReviewRunRepository.getLatestByWaveStoryExecutionId(execution.id) : null
    );

    if (
      latestTestRuns.some((testRun) => testRun?.status === "failed") ||
      latestStoryExecutions.some((execution) => execution?.status === "failed") ||
      latestStoryReviewRuns.some((reviewRun) => reviewRun?.status === "failed")
    ) {
      this.deps.waveExecutionRepository.updateStatus(waveExecutionId, "failed");
      return;
    }
    if (
      latestTestRuns.some((testRun) => testRun?.status === "review_required") ||
      latestStoryExecutions.some((execution) => execution?.status === "review_required") ||
      latestStoryReviewRuns.some((reviewRun) => reviewRun?.status === "review_required")
    ) {
      this.deps.waveExecutionRepository.updateStatus(waveExecutionId, "review_required");
      return;
    }
    // A wave can only be completed if every story has both a completed test-preparation run
    // and a completed implementation run. Today implementation is gated on test preparation,
    // but keeping the check explicit here makes the invariant visible in the status reducer.
    if (
      latestStoryExecutions.length > 0 &&
      latestTestRuns.every((testRun) => testRun?.status === "completed") &&
      latestStoryExecutions.every((execution) => execution?.status === "completed") &&
      latestRalphRuns.every((run) => run?.status === "passed") &&
      latestStoryReviewRuns.every((run) => run?.status === "passed")
    ) {
      this.deps.waveExecutionRepository.updateStatus(waveExecutionId, "completed");
      return;
    }
    if (
      latestTestRuns.some((testRun) => testRun?.status === "running") ||
      latestStoryExecutions.some((execution) => execution?.status === "running") ||
      latestStoryReviewRuns.some((reviewRun) => reviewRun?.status === "running")
    ) {
      this.deps.waveExecutionRepository.updateStatus(waveExecutionId, "running");
      return;
    }
    this.deps.waveExecutionRepository.updateStatus(waveExecutionId, "blocked");
  }

  private buildQaRunContext(input: {
    project: ReturnType<WorkflowService["requireProject"]>;
    item: ReturnType<WorkflowService["requireItem"]>;
    implementationPlan: ReturnType<WorkflowService["requireImplementationPlanForProject"]>;
    projectExecutionContext: ReturnType<WorkflowService["ensureProjectExecutionContext"]>;
  }) {
    const architecture = this.deps.architecturePlanRepository.getLatestByProjectId(input.project.id);
    const waves = this.deps.waveRepository.listByImplementationPlanId(input.implementationPlan.id);
    if (waves.length === 0) {
      throw new AppError("WAVES_NOT_FOUND", "Implementation plan has no waves");
    }

    const stories = this.deps.userStoryRepository.listByProjectId(input.project.id);
    const acceptanceCriteriaByStoryId = this.groupAcceptanceCriteriaByStoryId(input.project.id);
    const waveStoryByStoryId = new Map(
      this.deps.waveStoryRepository.listByStoryIds(stories.map((story) => story.id)).map((waveStory) => [waveStory.storyId, waveStory])
    );
    const latestExecutionByWaveStoryId = new Map(
      this.deps.waveStoryExecutionRepository
        .listLatestByWaveStoryIds(Array.from(waveStoryByStoryId.values()).map((waveStory) => waveStory.id))
        .map((execution) => [execution.waveStoryId, execution])
    );
    const latestRalphVerificationByExecutionId = new Map(
      this.deps.verificationRunRepository
        .listLatestByWaveStoryExecutionIdsAndMode(Array.from(latestExecutionByWaveStoryId.values()).map((execution) => execution.id), "ralph")
        .map((run) => [run.waveStoryExecutionId!, run])
    );
    const latestStoryReviewByExecutionId = new Map(
      this.deps.storyReviewRunRepository
        .listLatestByWaveStoryExecutionIds(Array.from(latestExecutionByWaveStoryId.values()).map((execution) => execution.id))
        .map((run) => [run.waveStoryExecutionId, run])
    );

    const qaStories = stories.map((story) => {
      const acceptanceCriteria = acceptanceCriteriaByStoryId.get(story.id) ?? [];
      const waveStory = waveStoryByStoryId.get(story.id);
      if (!waveStory) {
        throw new AppError("WAVE_STORY_NOT_FOUND", `No wave story found for story ${story.code}`);
      }
      const latestExecution = latestExecutionByWaveStoryId.get(waveStory.id);
      if (!latestExecution || latestExecution.status !== "completed") {
        throw new AppError("QA_EXECUTION_INCOMPLETE", `Story ${story.code} is not completed yet`);
      }
      const latestRalphVerification = latestRalphVerificationByExecutionId.get(latestExecution.id);
      if (!latestRalphVerification || latestRalphVerification.status !== "passed") {
        throw new AppError("QA_RALPH_INCOMPLETE", `Story ${story.code} has no passing Ralph verification`);
      }
      const latestStoryReview = latestStoryReviewByExecutionId.get(latestExecution.id);
      if (!latestStoryReview || latestStoryReview.status !== "passed") {
        throw new AppError("QA_STORY_REVIEW_INCOMPLETE", `Story ${story.code} has no passing story review`);
      }

      return {
        id: story.id,
        code: story.code,
        title: story.title,
        description: story.description,
        actor: story.actor,
        goal: story.goal,
        benefit: story.benefit,
        priority: story.priority,
        acceptanceCriteria,
        latestExecution: {
          id: latestExecution.id,
          status: latestExecution.status,
          outputSummaryJson: latestExecution.outputSummaryJson,
          businessContextSnapshotJson: latestExecution.businessContextSnapshotJson,
          repoContextSnapshotJson: latestExecution.repoContextSnapshotJson
        },
        latestRalphVerification: {
          id: latestRalphVerification.id,
          status: latestRalphVerification.status,
          summaryJson: latestRalphVerification.summaryJson
        },
        latestStoryReview: {
          id: latestStoryReview.id,
          status: latestStoryReview.status,
          summaryJson: latestStoryReview.summaryJson
        }
      };
    });

    const incompleteWave = waves.find((wave) => {
      const latestExecution = this.deps.waveExecutionRepository.getLatestByWaveId(wave.id);
      return latestExecution?.status !== "completed";
    });
    if (incompleteWave) {
      throw new AppError("QA_EXECUTION_INCOMPLETE", `Wave ${incompleteWave.code} is not completed yet`);
    }

    const inputSnapshotJson = JSON.stringify(
      {
        item: {
          id: input.item.id,
          code: input.item.code,
          title: input.item.title
        },
        project: {
          id: input.project.id,
          code: input.project.code,
          title: input.project.title
        },
        implementationPlan: {
          id: input.implementationPlan.id,
          version: input.implementationPlan.version,
          summary: input.implementationPlan.summary
        },
        architecture: architecture
          ? {
              id: architecture.id,
              version: architecture.version,
              summary: architecture.summary
            }
          : null,
        waves: waves.map((wave) => ({
          id: wave.id,
          code: wave.code,
          goal: wave.goal,
          position: wave.position
        })),
        stories: qaStories.map((story) => ({
          code: story.code,
          acceptanceCriteria: story.acceptanceCriteria.map((criterion) => criterion.code),
          latestExecutionId: story.latestExecution.id,
          latestRalphVerificationId: story.latestRalphVerification.id,
          latestStoryReviewId: story.latestStoryReview.id
        }))
      },
      null,
      2
    );

    return {
      item: input.item,
      projectExecutionContext: input.projectExecutionContext,
      inputSnapshotJson,
      waves: waves.map((wave) => ({
        id: wave.id,
        code: wave.code,
        goal: wave.goal,
        position: wave.position
      })),
      stories: qaStories
    };
  }

  private buildDocumentationRunContext(input: {
    project: ReturnType<WorkflowService["requireProject"]>;
    item: ReturnType<WorkflowService["requireItem"]>;
    implementationPlan: ReturnType<WorkflowService["requireImplementationPlanForProject"]>;
    projectExecutionContext: ReturnType<WorkflowService["ensureProjectExecutionContext"]>;
  }) {
    const concept = this.deps.conceptRepository.getLatestByItemId(input.item.id);
    const architecture = this.deps.architecturePlanRepository.getLatestByProjectId(input.project.id);
    const latestQaRun = this.deps.qaRunRepository.getLatestByProjectId(input.project.id);
    if (!latestQaRun || (latestQaRun.status !== "passed" && latestQaRun.status !== "review_required")) {
      throw new AppError("DOCUMENTATION_QA_INCOMPLETE", "Documentation requires a passed or review-required QA run");
    }

    const waves = this.deps.waveRepository.listByImplementationPlanId(input.implementationPlan.id);
    if (waves.length === 0) {
      throw new AppError("WAVES_NOT_FOUND", "Implementation plan has no waves");
    }

    const stories = this.deps.userStoryRepository.listByProjectId(input.project.id);
    const storyById = new Map(stories.map((story) => [story.id, story]));
    const acceptanceCriteriaByStoryId = this.groupAcceptanceCriteriaByStoryId(input.project.id);
    const acceptanceCriterionById = new Map(
      Array.from(acceptanceCriteriaByStoryId.values()).flat().map((criterion) => [criterion.id, criterion])
    );
    const waveStories = this.deps.waveStoryRepository.listByStoryIds(stories.map((story) => story.id));
    const waveStoryByStoryId = new Map(waveStories.map((waveStory) => [waveStory.storyId, waveStory]));
    const waveStoryCodesByWaveId = new Map(
      waves.map((wave) => [wave.id, waveStories.filter((waveStory) => waveStory.waveId === wave.id).map((waveStory) => storyById.get(waveStory.storyId)!.code)])
    );
    const latestTestPreparationByWaveStoryId = new Map(
      this.deps.waveStoryTestRunRepository
        .listLatestByWaveStoryIds(waveStories.map((waveStory) => waveStory.id))
        .map((testRun) => [testRun.waveStoryId, testRun])
    );
    const latestExecutionByWaveStoryId = new Map(
      this.deps.waveStoryExecutionRepository
        .listLatestByWaveStoryIds(waveStories.map((waveStory) => waveStory.id))
        .map((execution) => [execution.waveStoryId, execution])
    );
    const latestExecutions = Array.from(latestExecutionByWaveStoryId.values());
    const latestBasicVerificationByExecutionId = new Map(
      this.deps.verificationRunRepository
        .listLatestByWaveStoryExecutionIdsAndMode(latestExecutions.map((execution) => execution.id), "basic")
        .map((run) => [run.waveStoryExecutionId!, run])
    );
    const latestRalphVerificationByExecutionId = new Map(
      this.deps.verificationRunRepository
        .listLatestByWaveStoryExecutionIdsAndMode(latestExecutions.map((execution) => execution.id), "ralph")
        .map((run) => [run.waveStoryExecutionId!, run])
    );
    const latestStoryReviewByExecutionId = new Map(
      this.deps.storyReviewRunRepository
        .listLatestByWaveStoryExecutionIds(latestExecutions.map((execution) => execution.id))
        .map((run) => [run.waveStoryExecutionId, run])
    );
    const storyReviewFindingsByRunId = this.groupStoryReviewFindingsByRunId(Array.from(latestStoryReviewByExecutionId.values()).map((run) => run.id));

    const documentationStories = stories.map((story) => {
      const acceptanceCriteria = acceptanceCriteriaByStoryId.get(story.id) ?? [];
      const waveStory = waveStoryByStoryId.get(story.id);
      if (!waveStory) {
        throw new AppError("WAVE_STORY_NOT_FOUND", `No wave story found for story ${story.code}`);
      }
      const latestTestPreparationRun = latestTestPreparationByWaveStoryId.get(waveStory.id);
      if (!latestTestPreparationRun || latestTestPreparationRun.status !== "completed") {
        throw new AppError("DOCUMENTATION_TEST_PREPARATION_INCOMPLETE", `Story ${story.code} has no completed test preparation run`);
      }
      const latestExecution = latestExecutionByWaveStoryId.get(waveStory.id);
      if (!latestExecution || latestExecution.status !== "completed") {
        throw new AppError("DOCUMENTATION_EXECUTION_INCOMPLETE", `Story ${story.code} is not completed yet`);
      }
      const latestBasicVerification = latestBasicVerificationByExecutionId.get(latestExecution.id);
      if (!latestBasicVerification || latestBasicVerification.status !== "passed") {
        throw new AppError("DOCUMENTATION_BASIC_VERIFICATION_INCOMPLETE", `Story ${story.code} has no passing basic verification`);
      }
      const latestRalphVerification = latestRalphVerificationByExecutionId.get(latestExecution.id);
      if (!latestRalphVerification || latestRalphVerification.status !== "passed") {
        throw new AppError("DOCUMENTATION_RALPH_INCOMPLETE", `Story ${story.code} has no passing Ralph verification`);
      }
      const latestStoryReview = latestStoryReviewByExecutionId.get(latestExecution.id);
      if (!latestStoryReview || latestStoryReview.status !== "passed" || !latestStoryReview.summaryJson) {
        throw new AppError("DOCUMENTATION_STORY_REVIEW_INCOMPLETE", `Story ${story.code} has no passing story review`);
      }

      return {
        id: story.id,
        code: story.code,
        title: story.title,
        description: story.description,
        acceptanceCriteria,
        latestTestPreparation: this.parseTestPreparationOutput(latestTestPreparationRun),
        latestExecution: this.parseStoryExecutionOutput(latestExecution),
        latestBasicVerification: latestBasicVerification,
        latestRalphVerification: {
          id: latestRalphVerification.id,
          status: latestRalphVerification.status,
          summary: this.parseRalphVerificationOutput(latestRalphVerification)
        },
        latestStoryReview: {
          id: latestStoryReview.id,
          status: latestStoryReview.status,
          summary: this.parseStoryReviewOutput(latestStoryReview),
          findings: storyReviewFindingsByRunId.get(latestStoryReview.id) ?? []
        }
      };
    });

    const openQaFindings = this.deps.qaFindingRepository
      .listByQaRunId(latestQaRun.id)
      .filter((finding) => finding.status === "open")
      .map((finding) => ({
        severity: finding.severity,
        category: finding.category,
        title: finding.title,
        description: finding.description,
        evidence: finding.evidence,
        reproSteps: finding.reproSteps,
        suggestedFix: finding.suggestedFix,
        storyCode: finding.storyId ? storyById.get(finding.storyId)?.code ?? null : null,
        acceptanceCriterionCode: finding.acceptanceCriterionId ? acceptanceCriterionById.get(finding.acceptanceCriterionId)?.code ?? null : null
      }));

    const inputSnapshotJson = JSON.stringify(
      {
        item: {
          id: input.item.id,
          code: input.item.code,
          title: input.item.title
        },
        project: {
          id: input.project.id,
          code: input.project.code,
          title: input.project.title
        },
        concept: concept ? { id: concept.id, version: concept.version } : null,
        implementationPlan: {
          id: input.implementationPlan.id,
          version: input.implementationPlan.version
        },
        architecture: architecture ? { id: architecture.id, version: architecture.version } : null,
        latestQaRun: {
          id: latestQaRun.id,
          status: latestQaRun.status
        },
        openQaFindingCount: openQaFindings.length,
        waves: waves.map((wave) => ({
          id: wave.id,
          code: wave.code,
          storyCodes: waveStoryCodesByWaveId.get(wave.id) ?? []
        })),
        stories: documentationStories.map((story) => ({
          code: story.code,
          latestBasicVerificationId: story.latestBasicVerification.id,
          latestRalphVerificationId: story.latestRalphVerification.id,
          latestStoryReviewId: story.latestStoryReview.id
        }))
      },
      null,
      2
    );

    return {
      item: input.item,
      concept,
      architecture,
      latestQaRun,
      openQaFindings,
      projectExecutionContext: input.projectExecutionContext,
      inputSnapshotJson,
      waves: waves.map((wave) => ({
        id: wave.id,
        code: wave.code,
        goal: wave.goal,
        position: wave.position,
        storiesDelivered: waveStoryCodesByWaveId.get(wave.id) ?? []
      })),
      stories: documentationStories
    };
  }

  private buildBusinessContextSnapshot(input: {
    item: ReturnType<WorkflowService["requireItem"]>;
    project: ReturnType<WorkflowService["requireProject"]>;
    implementationPlan: ReturnType<WorkflowService["requireImplementationPlanForProject"]>;
    wave: ReturnType<WorkflowService["requireWave"]>;
    story: ReturnType<WorkflowService["requireStory"]>;
    acceptanceCriteria: ReturnType<AcceptanceCriterionRepository["listByStoryId"]>;
    architecture: ReturnType<ArchitecturePlanRepository["getLatestByProjectId"]>;
  }): string {
    return JSON.stringify(
      {
        item: {
          code: input.item.code,
          title: input.item.title,
          description: input.item.description
        },
        project: {
          code: input.project.code,
          title: input.project.title,
          summary: input.project.summary,
          goal: input.project.goal
        },
        implementationPlan: {
          id: input.implementationPlan.id,
          version: input.implementationPlan.version,
          summary: input.implementationPlan.summary
        },
        wave: {
          code: input.wave.code,
          goal: input.wave.goal,
          position: input.wave.position
        },
        story: {
          code: input.story.code,
          title: input.story.title,
          description: input.story.description,
          actor: input.story.actor,
          goal: input.story.goal,
          benefit: input.story.benefit,
          priority: input.story.priority
        },
        acceptanceCriteria: input.acceptanceCriteria.map((criterion) => ({
          code: criterion.code,
          text: criterion.text,
          position: criterion.position
        })),
        architecture: input.architecture
          ? {
              version: input.architecture.version,
              summary: input.architecture.summary
            }
          : null
      },
      null,
      2
    );
  }

  private buildRepoContextSnapshot(input: {
    project: ReturnType<WorkflowService["requireProject"]>;
    story: ReturnType<WorkflowService["requireStory"]>;
    architectureSummary: string | null;
    projectExecutionContext: ReturnType<WorkflowService["ensureProjectExecutionContext"]>;
  }): string {
    const storyText = `${input.story.title} ${input.story.description} ${input.story.goal} ${input.story.benefit}`.toLowerCase();
    const relevantFiles = [...input.projectExecutionContext.relevantFiles];
    if (storyText.includes("workflow")) {
      relevantFiles.push("src/workflow/workflow-service.ts");
    }
    if (storyText.includes("cli")) {
      relevantFiles.push("src/cli/main.ts");
    }
    if (storyText.includes("story") || storyText.includes("requirement")) {
      relevantFiles.push("src/persistence/repositories.ts");
    }
    const repoContext = {
      projectCode: input.project.code,
      relevantDirectories: input.projectExecutionContext.relevantDirectories,
      relevantFiles: Array.from(new Set(relevantFiles)),
      nearbyTests: input.projectExecutionContext.testLocations,
      repoConventions: input.projectExecutionContext.repoConventions,
      integrationPoints: input.projectExecutionContext.integrationPoints,
      architectureSummary: input.architectureSummary
    };
    return JSON.stringify(repoContext, null, 2);
  }

  private buildStoryRunContext(input: {
    project: ReturnType<WorkflowService["requireProject"]>;
    implementationPlan: ReturnType<WorkflowService["requireImplementationPlanForProject"]>;
    wave: ReturnType<WorkflowService["requireWave"]>;
    story: ReturnType<WorkflowService["requireStory"]>;
    projectExecutionContext?: ReturnType<WorkflowService["ensureProjectExecutionContext"]>;
  }) {
    const item = this.requireItem(input.project.itemId);
    const architecture = this.deps.architecturePlanRepository.getLatestByProjectId(input.project.id);
    const acceptanceCriteria = this.deps.acceptanceCriterionRepository.listByStoryId(input.story.id);
    const projectExecutionContext =
      input.projectExecutionContext ?? this.ensureProjectExecutionContext(input.project, input.implementationPlan);
    const businessContextSnapshotJson = this.buildBusinessContextSnapshot({
      item,
      project: input.project,
      implementationPlan: input.implementationPlan,
      wave: input.wave,
      story: input.story,
      acceptanceCriteria,
      architecture
    });
    const repoContextSnapshotJson = this.buildRepoContextSnapshot({
      project: input.project,
      story: input.story,
      architectureSummary: architecture?.summary ?? null,
      projectExecutionContext
    });

    return {
      item,
      architecture,
      acceptanceCriteria,
      projectExecutionContext,
      businessContextSnapshotJson,
      repoContextSnapshotJson
    };
  }

  private selectWorkerRole(
    story: ReturnType<WorkflowService["requireStory"]>,
    acceptanceCriteria: ReturnType<AcceptanceCriterionRepository["listByStoryId"]>
  ): ExecutionWorkerRole {
    const combinedText = `${story.title} ${story.description} ${story.goal} ${acceptanceCriteria.map((criterion) => criterion.text).join(" ")}`.toLowerCase();
    const frontendKeywords = ["ui", "screen", "page", "component", "route", "form"];
    const backendKeywords = ["workflow", "database", "repository", "api", "engine", "cli", "persist"];
    if (frontendKeywords.some((keyword) => combinedText.includes(keyword))) {
      return "frontend-implementer";
    }
    if (backendKeywords.some((keyword) => combinedText.includes(keyword))) {
      return "backend-implementer";
    }
    return "implementer";
  }

  private resolveVerificationStatus(
    output: StoryExecutionOutput,
    exitCode: number
  ): "passed" | "review_required" | "failed" {
    if (exitCode !== 0 || output.testsRun.some((testRun) => testRun.status === "failed")) {
      return "failed";
    }
    if (output.blockers.length > 0) {
      return "review_required";
    }
    return "passed";
  }

  private resolveTestPreparationStatus(
    output: TestPreparationOutput,
    exitCode: number
  ): "completed" | "review_required" | "failed" {
    if (exitCode !== 0) {
      return "failed";
    }
    if (output.blockers.length > 0) {
      return "review_required";
    }
    return "completed";
  }

  private parseTestPreparationOutput(
    testRun: ReturnType<WorkflowService["requireWaveStoryTestRun"]>
  ): TestPreparationOutput {
    if (!testRun.outputSummaryJson) {
      throw new AppError("TEST_RUN_OUTPUT_MISSING", `Test run ${testRun.id} has no output summary`);
    }
    return testPreparationOutputSchema.parse(JSON.parse(testRun.outputSummaryJson)) as TestPreparationOutput;
  }

  private parseStoryExecutionOutput(
    execution: ReturnType<WorkflowService["requireWaveStoryExecution"]>
  ): StoryExecutionOutput {
    if (!execution.outputSummaryJson) {
      throw new AppError("EXECUTION_OUTPUT_MISSING", `Execution ${execution.id} has no output summary`);
    }
    return storyExecutionOutputSchema.parse(JSON.parse(execution.outputSummaryJson)) as StoryExecutionOutput;
  }

  private parseRalphVerificationOutput(
    verificationRun: ReturnType<VerificationRunRepository["getLatestByWaveStoryExecutionIdAndMode"]>
  ): RalphVerificationOutput {
    if (!verificationRun?.summaryJson) {
      throw new AppError("RALPH_OUTPUT_MISSING", "Ralph verification has no summary");
    }
    return ralphVerificationOutputSchema.parse(JSON.parse(verificationRun.summaryJson)) as RalphVerificationOutput;
  }

  private parseStoryReviewOutput(
    storyReviewRun: ReturnType<StoryReviewRunRepository["getLatestByWaveStoryExecutionId"]>
  ): StoryReviewOutput {
    if (!storyReviewRun?.summaryJson) {
      throw new AppError("STORY_REVIEW_OUTPUT_MISSING", "Story review has no summary");
    }
    return storyReviewOutputSchema.parse(JSON.parse(storyReviewRun.summaryJson)) as StoryReviewOutput;
  }

  private async executeRalphVerification(input: {
    project: ReturnType<WorkflowService["requireProject"]>;
    implementationPlan: ReturnType<WorkflowService["requireImplementationPlanForProject"]>;
    wave: ReturnType<WorkflowService["requireWave"]>;
    waveExecution: ReturnType<WorkflowService["requireWaveExecution"]>;
    story: ReturnType<WorkflowService["requireStory"]>;
    storyRunContext: ReturnType<WorkflowService["buildStoryRunContext"]>;
    testPreparationRun: ReturnType<WorkflowService["requireWaveStoryTestRun"]>;
    parsedTestPreparation: TestPreparationOutput;
    execution: ReturnType<WaveStoryExecutionRepository["create"]>;
    implementationOutput: StoryExecutionOutput;
    basicVerificationStatus: VerificationRunStatus;
    basicVerificationSummary: {
      storyCode: string;
      changedFiles: string[];
      testsRun: StoryExecutionOutput["testsRun"];
      blockers: string[];
    };
  }): Promise<{ status: VerificationRunStatus; summary: RalphVerificationOutput; errorMessage: string | null }> {
    const resolvedWorkerProfile = this.resolveWorkerProfile("ralph");
    try {
      const result = await this.deps.adapter.runStoryRalphVerification({
        workerRole: "ralph-verifier",
        prompt: resolvedWorkerProfile.promptContent,
        skills: resolvedWorkerProfile.skills,
        item: input.storyRunContext.item,
        project: input.project,
        implementationPlan: {
          id: input.implementationPlan.id,
          summary: input.implementationPlan.summary,
          version: input.implementationPlan.version
        },
        wave: {
          id: input.wave.id,
          code: input.wave.code,
          goal: input.wave.goal,
          position: input.wave.position
        },
        story: input.story,
        acceptanceCriteria: input.storyRunContext.acceptanceCriteria,
        architecture: input.storyRunContext.architecture
          ? {
              id: input.storyRunContext.architecture.id,
              summary: input.storyRunContext.architecture.summary,
              version: input.storyRunContext.architecture.version
            }
          : null,
        projectExecutionContext: input.storyRunContext.projectExecutionContext,
        businessContextSnapshotJson: input.storyRunContext.businessContextSnapshotJson,
        repoContextSnapshotJson: input.storyRunContext.repoContextSnapshotJson,
        testPreparation: {
          id: input.testPreparationRun.id,
          summary: input.parsedTestPreparation.summary,
          testFiles: input.parsedTestPreparation.testFiles,
          testsGenerated: input.parsedTestPreparation.testsGenerated,
          assumptions: input.parsedTestPreparation.assumptions
        },
        implementation: input.implementationOutput,
        basicVerification: {
          status: input.basicVerificationStatus,
          summary: input.basicVerificationSummary
        }
      });

      const parsed = ralphVerificationOutputSchema.parse(result.output) as RalphVerificationOutput;
      const status = this.resolveRalphVerificationStatus(parsed, result.exitCode);
      this.deps.verificationRunRepository.create({
        waveExecutionId: input.waveExecution.id,
        waveStoryExecutionId: input.execution.id,
        mode: "ralph",
        status,
        systemPromptSnapshot: resolvedWorkerProfile.promptContent,
        skillsSnapshotJson: JSON.stringify(resolvedWorkerProfile.skills, null, 2),
        summaryJson: JSON.stringify(parsed, null, 2),
        errorMessage: status === "failed" ? parsed.blockers.join("; ") || "Ralph verification failed" : null
      });
      return {
        status,
        summary: parsed,
        errorMessage: parsed.blockers.join("; ") || null
      };
    } catch (error) {
      const fallbackSummary = {
        storyCode: input.story.code,
        overallStatus: "failed" as const,
        summary: `Ralph verification failed to execute for ${input.story.code}.`,
        acceptanceCriteriaResults: input.storyRunContext.acceptanceCriteria.map((criterion) => ({
          acceptanceCriterionId: criterion.id,
          acceptanceCriterionCode: criterion.code,
          status: "failed" as const,
          evidence: "No Ralph verifier output was produced.",
          notes: "Verification execution failed before a per-criterion verdict could be recorded."
        })),
        blockers: [error instanceof Error ? error.message : String(error)]
      };
      this.deps.verificationRunRepository.create({
        waveExecutionId: input.waveExecution.id,
        waveStoryExecutionId: input.execution.id,
        mode: "ralph",
        status: "failed",
        systemPromptSnapshot: resolvedWorkerProfile.promptContent,
        skillsSnapshotJson: JSON.stringify(resolvedWorkerProfile.skills, null, 2),
        summaryJson: JSON.stringify(fallbackSummary, null, 2),
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      return {
        status: "failed",
        summary: fallbackSummary,
        errorMessage: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async executeStoryReview(input: {
    project: ReturnType<WorkflowService["requireProject"]>;
    implementationPlan: ReturnType<WorkflowService["requireImplementationPlanForProject"]>;
    wave: ReturnType<WorkflowService["requireWave"]>;
    story: ReturnType<WorkflowService["requireStory"]>;
    storyRunContext: ReturnType<WorkflowService["buildStoryRunContext"]>;
    testPreparationRun: ReturnType<WorkflowService["requireWaveStoryTestRun"]>;
    parsedTestPreparation: TestPreparationOutput;
    execution: ReturnType<WaveStoryExecutionRepository["create"]>;
    implementationOutput: StoryExecutionOutput;
    basicVerificationStatus: VerificationRunStatus;
    basicVerificationSummary: {
      storyCode: string;
      changedFiles: string[];
      testsRun: StoryExecutionOutput["testsRun"];
      blockers: string[];
    };
    ralphVerificationStatus: VerificationRunStatus;
    ralphVerificationSummary: RalphVerificationOutput;
  }): Promise<{ status: StoryReviewRunStatus; errorMessage: string | null }> {
    const resolvedWorkerProfile = this.resolveWorkerProfile("storyReview");
    const reviewRun = this.deps.storyReviewRunRepository.create({
      waveStoryExecutionId: input.execution.id,
      status: "running",
      inputSnapshotJson: JSON.stringify(
        {
          storyCode: input.story.code,
          waveCode: input.wave.code,
          acceptanceCriteria: input.storyRunContext.acceptanceCriteria.map((criterion) => ({
            code: criterion.code,
            text: criterion.text
          })),
          implementationSummary: input.implementationOutput.summary,
          changedFiles: input.implementationOutput.changedFiles,
          basicVerificationStatus: input.basicVerificationStatus,
          ralphVerificationStatus: input.ralphVerificationStatus
        },
        null,
        2
      ),
      systemPromptSnapshot: resolvedWorkerProfile.promptContent,
      skillsSnapshotJson: JSON.stringify(resolvedWorkerProfile.skills, null, 2),
      summaryJson: null,
      errorMessage: null
    });

    try {
      const result = await this.deps.adapter.runStoryReview({
        workerRole: "story-reviewer",
        prompt: resolvedWorkerProfile.promptContent,
        skills: resolvedWorkerProfile.skills,
        item: input.storyRunContext.item,
        project: input.project,
        implementationPlan: {
          id: input.implementationPlan.id,
          summary: input.implementationPlan.summary,
          version: input.implementationPlan.version
        },
        wave: {
          id: input.wave.id,
          code: input.wave.code,
          goal: input.wave.goal,
          position: input.wave.position
        },
        story: input.story,
        acceptanceCriteria: input.storyRunContext.acceptanceCriteria,
        architecture: input.storyRunContext.architecture
          ? {
              id: input.storyRunContext.architecture.id,
              summary: input.storyRunContext.architecture.summary,
              version: input.storyRunContext.architecture.version
            }
          : null,
        projectExecutionContext: input.storyRunContext.projectExecutionContext,
        inputSnapshotJson: reviewRun.inputSnapshotJson,
        businessContextSnapshotJson: input.storyRunContext.businessContextSnapshotJson,
        repoContextSnapshotJson: input.storyRunContext.repoContextSnapshotJson,
        testPreparation: {
          id: input.testPreparationRun.id,
          summary: input.parsedTestPreparation.summary,
          testFiles: input.parsedTestPreparation.testFiles,
          testsGenerated: input.parsedTestPreparation.testsGenerated,
          assumptions: input.parsedTestPreparation.assumptions
        },
        implementation: input.implementationOutput,
        basicVerification: {
          status: input.basicVerificationStatus,
          summary: input.basicVerificationSummary
        },
        ralphVerification: {
          status: input.ralphVerificationStatus,
          summary: input.ralphVerificationSummary
        }
      });

      const parsed = storyReviewOutputSchema.parse(result.output) as StoryReviewOutput;
      this.deps.storyReviewAgentSessionRepository.create({
        storyReviewRunId: reviewRun.id,
        adapterKey: this.deps.adapter.key,
        status: result.exitCode === 0 ? "completed" : "failed",
        commandJson: JSON.stringify(result.command),
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode
      });
      const status = this.resolveStoryReviewStatus(parsed, result.exitCode);
      this.deps.storyReviewFindingRepository.createMany(
        parsed.findings.map((finding) => ({
          storyReviewRunId: reviewRun.id,
          severity: finding.severity,
          category: finding.category,
          title: finding.title,
          description: finding.description,
          evidence: finding.evidence,
          filePath: finding.filePath ?? null,
          line: finding.line ?? null,
          suggestedFix: finding.suggestedFix ?? null,
          status: "open"
        }))
      );
      this.deps.storyReviewRunRepository.updateStatus(reviewRun.id, status, {
        summaryJson: JSON.stringify(parsed, null, 2),
        errorMessage: null
      });
      return {
        status,
        errorMessage: null
      };
    } catch (error) {
      this.deps.storyReviewAgentSessionRepository.create({
        storyReviewRunId: reviewRun.id,
        adapterKey: this.deps.adapter.key,
        status: "failed",
        commandJson: JSON.stringify([]),
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1
      });
      this.deps.storyReviewRunRepository.updateStatus(reviewRun.id, "failed", {
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      return {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private resolveRalphVerificationStatus(
    output: RalphVerificationOutput,
    exitCode: number
  ): VerificationRunStatus {
    if (exitCode !== 0) {
      return "failed";
    }
    return output.overallStatus;
  }

  private resolveStoryReviewStatus(
    output: StoryReviewOutput,
    exitCode: number
  ): StoryReviewRunStatus {
    if (exitCode !== 0) {
      return "failed";
    }
    if (output.findings.some((finding) => finding.severity === "critical" || finding.severity === "high")) {
      return "failed";
    }
    if (output.findings.length > 0) {
      return "review_required";
    }
    return "passed";
  }

  private resolveQaRunStatus(output: QaOutput, exitCode: number): QaRunStatus {
    if (exitCode !== 0) {
      return "failed";
    }
    if (output.findings.some((finding) => finding.severity === "critical" || finding.severity === "high")) {
      return "failed";
    }
    if (output.findings.length > 0) {
      return "review_required";
    }
    return "passed";
  }

  private resolveDocumentationRunStatus(
    qaRunStatus: QaRunStatus,
    exitCode: number,
    output: DocumentationOutput
  ): DocumentationRunStatus {
    if (exitCode !== 0) {
      return "failed";
    }
    if (qaRunStatus === "review_required" || output.overallStatus === "review_required") {
      return "review_required";
    }
    return "completed";
  }

  private mapQaRunStatusToItemPhaseStatus(status: QaRunStatus): "completed" | "review_required" | "failed" {
    if (status === "passed") {
      return "completed";
    }
    if (status === "review_required") {
      return "review_required";
    }
    return "failed";
  }

  private mapDocumentationRunStatusToItemPhaseStatus(
    status: DocumentationRunStatus
  ): "completed" | "review_required" | "failed" {
    if (status === "completed") {
      return "completed";
    }
    if (status === "review_required") {
      return "review_required";
    }
    return "failed";
  }

  private resolveOverallExecutionStatus(
    basicStatus: VerificationRunStatus,
    ralphStatus: VerificationRunStatus,
    storyReviewStatus: StoryReviewRunStatus | null
  ): VerificationRunStatus {
    if (basicStatus === "failed" || ralphStatus === "failed" || storyReviewStatus === "failed") {
      return "failed";
    }
    if (
      basicStatus === "review_required" ||
      ralphStatus === "review_required" ||
      storyReviewStatus === "review_required"
    ) {
      return "review_required";
    }
    return "passed";
  }

  private buildSnapshot(itemId: string) {
    const concept = this.deps.conceptRepository.getLatestByItemId(itemId);
    const projects = this.deps.projectRepository.listByItemId(itemId);
    const storiesByProjectId = new Map(
      projects.map((project) => [project.id, this.deps.userStoryRepository.listByProjectId(project.id)])
    );
    const implementationPlansByProjectId = new Map(
      projects.map((project) => [project.id, this.deps.implementationPlanRepository.getLatestByProjectId(project.id)])
    );
    return buildItemWorkflowSnapshot({
      concept,
      projects,
      storiesByProjectId,
      implementationPlansByProjectId
    });
  }

  private importOutputs(input: {
    stageKey: StageKey;
    itemId: string;
    projectId: string | null;
    artifactsByKind: Map<string, ArtifactRecord>;
  }): { status: "completed" | "review_required"; reviewReason: string | null } {
    if (input.stageKey === "brainstorm") {
      return this.importBrainstormOutputs(input);
    }
    if (input.stageKey === "requirements") {
      return this.importRequirementsOutputs(input);
    }
    if (input.stageKey === "architecture") {
      return this.importArchitectureOutputs(input);
    }
    return this.importPlanningOutputs(input);
  }

  private importBrainstormOutputs(input: {
    itemId: string;
    artifactsByKind: Map<string, ArtifactRecord>;
  }): { status: "completed" | "review_required"; reviewReason: string | null } {
    const conceptArtifact = input.artifactsByKind.get("concept");
    const projectsArtifact = input.artifactsByKind.get("projects");
    if (!conceptArtifact || !projectsArtifact) {
      return {
        status: "review_required",
        reviewReason: "Brainstorm output is missing concept or projects artifacts"
      };
    }
    try {
      const projects = projectsOutputSchema.parse(
        JSON.parse(readFileSync(resolve(this.deps.artifactRoot, projectsArtifact.path), "utf8"))
      ) as ProjectsOutput;
      const previous = this.deps.conceptRepository.getLatestByItemId(input.itemId);
      if (previous?.structuredArtifactId === projectsArtifact.id) {
        return { status: "completed", reviewReason: null };
      }
      const markdownContent = readFileSync(resolve(this.deps.artifactRoot, conceptArtifact.path), "utf8");
      this.deps.conceptRepository.create({
        itemId: input.itemId,
        version: (previous?.version ?? 0) + 1,
        title: this.extractHeading(markdownContent),
        summary: projects.projects.map((project) => project.title).join(", "),
        status: "draft",
        markdownArtifactId: conceptArtifact.id,
        structuredArtifactId: projectsArtifact.id
      });
      return { status: "completed", reviewReason: null };
    } catch (error) {
      return this.buildReviewOutcome("brainstorm", error);
    }
  }

  private importRequirementsOutputs(input: {
    projectId: string | null;
    artifactsByKind: Map<string, ArtifactRecord>;
  }): { status: "completed" | "review_required"; reviewReason: string | null } {
    if (!input.projectId) {
      throw new AppError("PROJECT_REQUIRED", "Requirements stage requires a project");
    }
    const storiesArtifact = input.artifactsByKind.get("stories");
    if (!storiesArtifact) {
      return {
        status: "review_required",
        reviewReason: "Requirements output is missing stories artifact"
      };
    }
    try {
      const parsed = storiesOutputSchema.parse(
        JSON.parse(readFileSync(resolve(this.deps.artifactRoot, storiesArtifact.path), "utf8"))
      ) as StoriesOutput;
      if (this.deps.userStoryRepository.hasAnyByProjectId(input.projectId)) {
        return { status: "completed", reviewReason: null };
      }
      const project = this.requireProject(input.projectId);
      const createdStories = this.deps.userStoryRepository.createMany(
        parsed.stories.map((story, index) => ({
          projectId: input.projectId as string,
          code: formatStoryCode(project.code, index + 1),
          title: story.title,
          description: story.description,
          actor: story.actor,
          goal: story.goal,
          benefit: story.benefit,
          priority: story.priority,
          status: "draft",
          sourceArtifactId: storiesArtifact.id
        }))
      );
      if (createdStories.length !== parsed.stories.length) {
        throw new Error("Requirements import created a different number of stories than parsed output");
      }

      const storiesWithDefinitions = createdStories.map((storyRecord, storyIndex) => ({
        storyRecord,
        storyDefinition: parsed.stories[storyIndex] as StoriesOutput["stories"][number]
      }));

      this.deps.acceptanceCriterionRepository.createMany(
        storiesWithDefinitions.flatMap(({ storyRecord, storyDefinition }) =>
          storyDefinition.acceptanceCriteria.map((criterion, criterionIndex) => ({
            storyId: storyRecord.id,
            code: formatAcceptanceCriterionCode(storyRecord.code, criterionIndex + 1),
            text: criterion,
            // position is 0-indexed; code suffix is 1-indexed (AC01 => position 0)
            position: criterionIndex
          }))
        )
      );
      return { status: "completed", reviewReason: null };
    } catch (error) {
      return this.buildReviewOutcome("requirements", error);
    }
  }

  private importArchitectureOutputs(input: {
    projectId: string | null;
    artifactsByKind: Map<string, ArtifactRecord>;
  }): { status: "completed" | "review_required"; reviewReason: string | null } {
    if (!input.projectId) {
      throw new AppError("PROJECT_REQUIRED", "Architecture stage requires a project");
    }
    const markdownArtifact = input.artifactsByKind.get("architecture-plan");
    const jsonArtifact = input.artifactsByKind.get("architecture-plan-data");
    if (!markdownArtifact || !jsonArtifact) {
      return {
        status: "review_required",
        reviewReason: "Architecture output is missing markdown or structured plan artifact"
      };
    }
    try {
      const parsed = architecturePlanOutputSchema.parse(
        JSON.parse(readFileSync(resolve(this.deps.artifactRoot, jsonArtifact.path), "utf8"))
      ) as ArchitecturePlanOutput;
      const previous = this.deps.architecturePlanRepository.getLatestByProjectId(input.projectId);
      if (previous?.structuredArtifactId === jsonArtifact.id) {
        return { status: "completed", reviewReason: null };
      }
      this.deps.architecturePlanRepository.create({
        projectId: input.projectId,
        version: (previous?.version ?? 0) + 1,
        summary: parsed.summary,
        status: "draft",
        markdownArtifactId: markdownArtifact.id,
        structuredArtifactId: jsonArtifact.id
      });
      return { status: "completed", reviewReason: null };
    } catch (error) {
      return this.buildReviewOutcome("architecture", error);
    }
  }

  private importPlanningOutputs(input: {
    projectId: string | null;
    artifactsByKind: Map<string, ArtifactRecord>;
  }): { status: "completed" | "review_required"; reviewReason: string | null } {
    if (!input.projectId) {
      throw new AppError("PROJECT_REQUIRED", "Planning stage requires a project");
    }
    const markdownArtifact = input.artifactsByKind.get("implementation-plan");
    const jsonArtifact = input.artifactsByKind.get("implementation-plan-data");
    if (!markdownArtifact || !jsonArtifact) {
      return {
        status: "review_required",
        reviewReason: "Planning output is missing markdown or structured implementation plan artifact"
      };
    }
    try {
      const parsed = implementationPlanOutputSchema.parse(
        JSON.parse(readFileSync(resolve(this.deps.artifactRoot, jsonArtifact.path), "utf8"))
      ) as ImplementationPlanOutput;
      const previous = this.deps.implementationPlanRepository.getLatestByProjectId(input.projectId);
      if (previous?.structuredArtifactId === jsonArtifact.id) {
        return { status: "completed", reviewReason: null };
      }

      const stories = this.deps.userStoryRepository.listByProjectId(input.projectId);
      const storyByCode = new Map(stories.map((story) => [story.code, story]));
      const assignedStoryCodes = new Set<string>();
      const waveCodeSet = new Set<string>();

      parsed.waves.forEach((wave, waveIndex) => {
        if (waveCodeSet.has(wave.waveCode)) {
          throw new Error(`Duplicate wave code ${wave.waveCode}`);
        }
        waveCodeSet.add(wave.waveCode);

        if (wave.stories.length === 0) {
          throw new Error(`Wave ${wave.waveCode} must contain at least one story`);
        }

        wave.stories.forEach((plannedStory) => {
          if (!storyByCode.has(plannedStory.storyCode)) {
            throw new Error(`Unknown story code ${plannedStory.storyCode} in wave ${wave.waveCode}`);
          }
          if (assignedStoryCodes.has(plannedStory.storyCode)) {
            throw new Error(`Story ${plannedStory.storyCode} is assigned more than once`);
          }
          assignedStoryCodes.add(plannedStory.storyCode);
          plannedStory.dependsOnStoryCodes.forEach((dependencyCode) => {
            if (!storyByCode.has(dependencyCode)) {
              throw new Error(`Unknown story dependency ${dependencyCode} for ${plannedStory.storyCode}`);
            }
          });
        });

        if (waveIndex === 0 && wave.dependsOn.length > 0) {
          throw new Error(`First wave ${wave.waveCode} cannot depend on earlier waves`);
        }
      });

      if (assignedStoryCodes.size !== stories.length) {
        throw new Error("Implementation plan must assign every project story exactly once");
      }

      const waveIndexByCode = new Map(parsed.waves.map((wave, index) => [wave.waveCode, index]));
      const storyWaveIndexByCode = new Map<string, number>();
      parsed.waves.forEach((wave, waveIndex) => {
        wave.stories.forEach((plannedStory) => {
          storyWaveIndexByCode.set(plannedStory.storyCode, waveIndex);
        });
      });

      parsed.waves.forEach((wave) => {
        wave.stories.forEach((plannedStory) => {
          plannedStory.dependsOnStoryCodes.forEach((dependencyCode) => {
            const dependencyWaveIndex = storyWaveIndexByCode.get(dependencyCode);
            const plannedWaveIndex = storyWaveIndexByCode.get(plannedStory.storyCode);
            if (dependencyWaveIndex === undefined || plannedWaveIndex === undefined) {
              throw new Error(`Missing wave assignment for story dependency ${dependencyCode}`);
            }
            if (dependencyWaveIndex > plannedWaveIndex) {
              throw new Error(`Story ${plannedStory.storyCode} depends on later story ${dependencyCode}`);
            }
          });
        });

        wave.dependsOn.forEach((dependencyWaveCode) => {
          const dependencyIndex = waveIndexByCode.get(dependencyWaveCode);
          const currentIndex = waveIndexByCode.get(wave.waveCode);
          if (dependencyIndex === undefined || currentIndex === undefined || dependencyIndex >= currentIndex) {
            throw new Error(`Wave ${wave.waveCode} depends on unknown or non-earlier wave ${dependencyWaveCode}`);
          }
        });
      });

      const createdPlan = this.deps.implementationPlanRepository.create({
        projectId: input.projectId,
        version: (previous?.version ?? 0) + 1,
        summary: parsed.summary,
        status: "draft",
        markdownArtifactId: markdownArtifact.id,
        structuredArtifactId: jsonArtifact.id
      });

      const createdWaves = this.deps.waveRepository.createMany(
        parsed.waves.map((wave, index) => ({
          implementationPlanId: createdPlan.id,
          code: wave.waveCode,
          goal: wave.goal,
          position: index
        }))
      );
      const waveByCode = new Map(createdWaves.map((wave) => [wave.code, wave]));

      const createdWaveStories = this.deps.waveStoryRepository.createMany(
        parsed.waves.flatMap((wave) =>
          wave.stories.map((plannedStory, index) => ({
            waveId: waveByCode.get(wave.waveCode)!.id,
            storyId: storyByCode.get(plannedStory.storyCode)!.id,
            parallelGroup: plannedStory.parallelGroup ?? null,
            position: index
          }))
        )
      );
      if (createdWaveStories.length !== stories.length) {
        throw new Error("Implementation plan import created a different number of wave stories than planned");
      }

      this.deps.waveStoryDependencyRepository.createMany(
        parsed.waves.flatMap((wave) =>
          wave.stories.flatMap((plannedStory) =>
            plannedStory.dependsOnStoryCodes.map((dependencyCode) => ({
              blockingStoryId: storyByCode.get(dependencyCode)!.id,
              dependentStoryId: storyByCode.get(plannedStory.storyCode)!.id
            }))
          )
        )
      );

      return { status: "completed", reviewReason: null };
    } catch (error) {
      return this.buildReviewOutcome("planning", error);
    }
  }

  private persistArtifacts(input: {
    itemId: string;
    projectId: string | null;
    runId: string;
    linkStageRunId?: boolean;
    markdownArtifacts: Array<{ kind: string; content: string }>;
    structuredArtifacts: Array<{ kind: string; content: unknown }>;
  }): ArtifactRecord[] {
    const records: ArtifactRecord[] = [];

    for (const artifact of input.markdownArtifacts) {
      const written = this.artifactService.writeArtifact({
        itemId: input.itemId,
        projectId: input.projectId,
        stageRunId: input.runId,
        kind: artifact.kind,
        format: "md",
        content: artifact.content
      });
      const record = this.deps.artifactRepository.create({
        stageRunId: input.linkStageRunId === false ? null : input.runId,
        itemId: input.itemId,
        projectId: input.projectId,
        kind: artifact.kind,
        format: "md",
        path: written.path,
        sha256: written.sha256,
        sizeBytes: written.sizeBytes
      });
      records.push(record);
    }

    for (const artifact of input.structuredArtifacts) {
      const written = this.artifactService.writeArtifact({
        itemId: input.itemId,
        projectId: input.projectId,
        stageRunId: input.runId,
        kind: artifact.kind,
        format: "json",
        content: JSON.stringify(artifact.content, null, 2)
      });
      const record = this.deps.artifactRepository.create({
        stageRunId: input.linkStageRunId === false ? null : input.runId,
        itemId: input.itemId,
        projectId: input.projectId,
        kind: artifact.kind,
        format: "json",
        path: written.path,
        sha256: written.sha256,
        sizeBytes: written.sizeBytes
      });
      records.push(record);
    }

    return records;
  }

  private listArtifactsForDocumentationRun(documentationRun: ReturnType<DocumentationRunRepository["getById"]>) {
    if (!documentationRun?.summaryJson) {
      return [];
    }
    try {
      const parsed = JSON.parse(documentationRun.summaryJson) as { artifactIds?: string[] };
      return (parsed.artifactIds ?? [])
        .map((artifactId) => this.deps.artifactRepository.getById(artifactId))
        .filter((artifact): artifact is ArtifactRecord => artifact !== null);
    } catch {
      return [];
    }
  }

  private transitionRun(
    runId: string,
    current: "pending" | "running",
    next: "running" | "completed" | "failed" | "review_required",
    options?: { outputSummaryJson?: string | null; errorMessage?: string | null }
  ): void {
    assertStageRunTransitionAllowed(current, next);
    this.deps.stageRunRepository.updateStatus(runId, next, options);
  }

  private async executeAutorun(input: {
    trigger: string;
    scopeType: AutorunScopeType;
    scopeId: string;
    initialSteps: AutorunStep[];
  }): Promise<AutorunSummary> {
    const summary: AutorunSummary = {
      trigger: input.trigger,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      steps: [...input.initialSteps],
      finalStatus: "stopped",
      stopReason: "no_action",
      createdRunIds: [],
      createdExecutionIds: [],
      createdRemediationRunIds: [],
      successful: false
    };
    this.collectAutorunIds(summary, input.initialSteps);

    for (let index = 0; index < 100; index += 1) {
      const decision =
        input.scopeType === "item"
          ? this.resolveNextItemAutorunDecision(input.scopeId)
          : this.resolveNextProjectAutorunDecision(input.scopeId);

      if (decision.kind === "stop") {
        summary.finalStatus = decision.finalStatus;
        summary.stopReason = decision.stopReason;
        summary.successful = decision.finalStatus === "completed";
        return summary;
      }

      try {
        const result = await decision.execute();
        const step = this.buildAutorunStep(decision, result);
        summary.steps.push(step);
        this.collectAutorunIds(summary, [step]);
      } catch (error) {
        summary.finalStatus = "failed";
        summary.stopReason = error instanceof AppError ? error.code : "AUTORUN_STEP_FAILED";
        summary.successful = false;
        return summary;
      }
    }

    summary.finalStatus = "failed";
    summary.stopReason = "AUTORUN_STEP_LIMIT_REACHED";
    summary.successful = false;
    return summary;
  }

  private resolveNextItemAutorunDecision(itemId: string): AutorunDecision {
    const item = this.requireItem(itemId);
    if (item.phaseStatus === "failed") {
      return {
        kind: "stop",
        finalStatus: "failed",
        stopReason: "item_failed"
      };
    }

    const concept = this.deps.conceptRepository.getLatestByItemId(itemId);
    const latestBrainstormRun = this.getLatestStageRun({ itemId, stageKey: "brainstorm" });
    if (!concept) {
      if (latestBrainstormRun?.status === "review_required") {
        return {
          kind: "stop",
          finalStatus: "stopped",
          stopReason: "brainstorm_review_required"
        };
      }
      if (latestBrainstormRun?.status === "failed") {
        return {
          kind: "stop",
          finalStatus: "failed",
          stopReason: "brainstorm_failed"
        };
      }
      return {
        kind: "stop",
        finalStatus: "stopped",
        stopReason: "concept_missing"
      };
    }

    if (concept.status !== "approved" && concept.status !== "completed") {
      return {
        kind: "stop",
        finalStatus: "stopped",
        stopReason: "concept_approval_required"
      };
    }

    const projects = this.deps.projectRepository.listByItemId(itemId);
    if (projects.length === 0) {
      return {
        kind: "step",
        action: "project:import",
        scopeType: "item",
        scopeId: itemId,
        execute: () => this.importProjects(itemId)
      };
    }

    for (const project of projects) {
      const decision = this.resolveNextProjectAutorunDecision(project.id);
      if (decision.kind !== "stop" || decision.stopReason !== "project_completed") {
        return decision;
      }
    }

    this.completeItemIfDeliveryFinished(itemId);
    const finalItem = this.requireItem(itemId);
    return {
      kind: "stop",
      finalStatus: finalItem.currentColumn === "done" ? "completed" : "stopped",
      stopReason: finalItem.currentColumn === "done" ? "item_completed" : "project_incomplete"
    };
  }

  private resolveNextProjectAutorunDecision(projectId: string): AutorunDecision {
    const project = this.requireProject(projectId);

    const requirementsDecision = this.resolveStageAutorunDecision({
      itemId: project.itemId,
      projectId,
      stageKey: "requirements",
      hasStageOutput: this.deps.userStoryRepository.hasAnyByProjectId(projectId),
      approvalSatisfied: this.deps.userStoryRepository
        .listByProjectId(projectId)
        .every((story) => story.status === "approved"),
      startAction: "requirements:start",
      approveAction: "stories:approve",
      approveScopeType: "project",
      approve: () => this.approveStories(projectId)
    });
    if (requirementsDecision) {
      return requirementsDecision;
    }

    const architectureDecision = this.resolveStageAutorunDecision({
      itemId: project.itemId,
      projectId,
      stageKey: "architecture",
      hasStageOutput: this.deps.architecturePlanRepository.getLatestByProjectId(projectId) !== null,
      approvalSatisfied: this.deps.architecturePlanRepository.getLatestByProjectId(projectId)?.status === "approved",
      startAction: "architecture:start",
      approveAction: "architecture:approve",
      approveScopeType: "project",
      approve: () => this.approveArchitecture(projectId)
    });
    if (architectureDecision) {
      return architectureDecision;
    }

    const planningDecision = this.resolveStageAutorunDecision({
      itemId: project.itemId,
      projectId,
      stageKey: "planning",
      hasStageOutput: this.deps.implementationPlanRepository.getLatestByProjectId(projectId) !== null,
      approvalSatisfied: this.deps.implementationPlanRepository.getLatestByProjectId(projectId)?.status === "approved",
      startAction: "planning:start",
      approveAction: "planning:approve",
      approveScopeType: "project",
      approve: () => this.approvePlanning(projectId)
    });
    if (planningDecision) {
      return planningDecision;
    }

    const executionDecision = this.resolveExecutionAutorunDecision(projectId);
    if (executionDecision) {
      return executionDecision;
    }

    const latestQaRun = this.deps.qaRunRepository.getLatestByProjectId(projectId);
    if (!latestQaRun) {
      return {
        kind: "step",
        action: "qa:start",
        scopeType: "project",
        scopeId: projectId,
        execute: () => this.startQa(projectId)
      };
    }
    if (latestQaRun.status === "failed") {
      return {
        kind: "stop",
        finalStatus: "failed",
        stopReason: "qa_failed"
      };
    }
    if (latestQaRun.status === "review_required") {
      return {
        kind: "stop",
        finalStatus: "stopped",
        stopReason: "qa_review_required"
      };
    }

    const latestDocumentationRun = this.deps.documentationRunRepository.getLatestByProjectId(projectId);
    if (!latestDocumentationRun || latestDocumentationRun.staleAt !== null) {
      return {
        kind: "step",
        action: "documentation:start",
        scopeType: "project",
        scopeId: projectId,
        execute: () => this.startDocumentation(projectId)
      };
    }
    if (latestDocumentationRun.status === "failed") {
      return {
        kind: "stop",
        finalStatus: "failed",
        stopReason: "documentation_failed"
      };
    }
    if (latestDocumentationRun.status === "review_required") {
      return {
        kind: "stop",
        finalStatus: "stopped",
        stopReason: "documentation_review_required"
      };
    }
    if (latestDocumentationRun.status === "completed" && latestDocumentationRun.staleAt === null) {
      return {
        kind: "stop",
        finalStatus: "completed",
        stopReason: "project_completed"
      };
    }

    return {
      kind: "stop",
      finalStatus: "stopped",
      stopReason: "documentation_pending"
    };
  }

  private resolveStageAutorunDecision(input: {
    itemId: string;
    projectId: string;
    stageKey: Exclude<StageKey, "brainstorm">;
    hasStageOutput: boolean;
    approvalSatisfied: boolean;
    startAction: string;
    approveAction: string;
    approveScopeType: AutorunStep["scopeType"];
    approve: () => void;
  }): AutorunDecision | null {
    const latestRun = this.getLatestStageRun({
      itemId: input.itemId,
      projectId: input.projectId,
      stageKey: input.stageKey
    });

    if (!input.hasStageOutput) {
      if (latestRun?.status === "review_required") {
        return {
          kind: "stop",
          finalStatus: "stopped",
          stopReason: `${input.stageKey}_review_required`
        };
      }
      if (latestRun?.status === "failed") {
        return {
          kind: "stop",
          finalStatus: "failed",
          stopReason: `${input.stageKey}_failed`
        };
      }
      return {
        kind: "step",
        action: input.startAction,
        scopeType: "project",
        scopeId: input.projectId,
        execute: () =>
          this.startStage({
            stageKey: input.stageKey,
            itemId: input.itemId,
            projectId: input.projectId
          })
      };
    }

    if (!input.approvalSatisfied) {
      return {
        kind: "step",
        action: input.approveAction,
        scopeType: input.approveScopeType,
        scopeId: input.projectId,
        execute: () => input.approve()
      };
    }

    return null;
  }

  private resolveExecutionAutorunDecision(projectId: string): AutorunDecision | null {
    const execution = this.showExecution(projectId);

    let hasIncompleteWave = false;
    let hasStartedExecution = false;

    for (const wave of execution.waves) {
      if (wave.waveExecution) {
        hasStartedExecution = true;
        if (wave.waveExecution.status === "failed") {
          return {
            kind: "stop",
            finalStatus: "failed",
            stopReason: "execution_failed"
          };
        }
      }

      for (const storyEntry of wave.stories) {
        if (storyEntry.latestTestRun?.status === "failed") {
          return {
            kind: "stop",
            finalStatus: "failed",
            stopReason: "test_preparation_failed"
          };
        }
        if (storyEntry.latestTestRun?.status === "review_required") {
          return {
            kind: "stop",
            finalStatus: "stopped",
            stopReason: "test_preparation_review_required"
          };
        }
        if (storyEntry.latestExecution) {
          hasStartedExecution = true;
          if (storyEntry.latestExecution.status === "failed") {
            return {
              kind: "stop",
              finalStatus: "failed",
              stopReason: "execution_failed"
            };
          }
          if (storyEntry.latestExecution.status === "review_required") {
            const latestStoryReviewRun = storyEntry.latestStoryReviewRun
              ? this.requireStoryReviewRun(storyEntry.latestStoryReviewRun.id)
              : null;
            if (latestStoryReviewRun && this.canAutorunStoryReviewRemediate(latestStoryReviewRun.id)) {
              return {
                kind: "step",
                action: "remediation:story-review:start",
                scopeType: "remediation",
                scopeId: latestStoryReviewRun.id,
                execute: () => this.startStoryReviewRemediation(latestStoryReviewRun.id)
              };
            }
            return {
              kind: "stop",
              finalStatus: "stopped",
              stopReason: latestStoryReviewRun
                ? this.getStoryReviewRemediationStopReason(latestStoryReviewRun.id)
                : "execution_review_required"
            };
          }
        }
      }

      if (wave.waveExecution?.status !== "completed") {
        hasIncompleteWave = true;
      }
    }

    if (hasIncompleteWave || !hasStartedExecution) {
      return {
        kind: "step",
        action: hasStartedExecution ? "execution:tick" : "execution:start",
        scopeType: "project",
        scopeId: projectId,
        execute: () => (hasStartedExecution ? this.tickExecution(projectId) : this.startExecution(projectId))
      };
    }

    return null;
  }

  private canAutorunStoryReviewRemediate(storyReviewRunId: string): boolean {
    const storyReviewRun = this.requireStoryReviewRun(storyReviewRunId);
    if (storyReviewRun.status !== "review_required") {
      return false;
    }
    const findings = this.deps.storyReviewFindingRepository
      .listByStoryReviewRunId(storyReviewRunId)
      .filter((finding) => finding.status === "open");
    if (findings.length === 0) {
      return false;
    }
    if (findings.some((finding) => !this.isAutoFixableStoryReviewSeverity(finding.severity))) {
      return false;
    }
    return this.deps.storyReviewRemediationRunRepository.listByStoryReviewRunId(storyReviewRunId).length < 2;
  }

  private getStoryReviewRemediationStopReason(storyReviewRunId: string): string {
    const storyReviewRun = this.requireStoryReviewRun(storyReviewRunId);
    if (storyReviewRun.status === "failed") {
      return "story_review_failed";
    }
    const findings = this.deps.storyReviewFindingRepository
      .listByStoryReviewRunId(storyReviewRunId)
      .filter((finding) => finding.status === "open");
    if (findings.some((finding) => !this.isAutoFixableStoryReviewSeverity(finding.severity))) {
      return "story_review_review_required";
    }
    if (this.deps.storyReviewRemediationRunRepository.listByStoryReviewRunId(storyReviewRunId).length >= 2) {
      return "story_review_remediation_limit_reached";
    }
    return "story_review_review_required";
  }

  private isAutoFixableStoryReviewSeverity(severity: StoryReviewFindingSeverity): boolean {
    return severity === "medium" || severity === "low";
  }

  private buildAutorunStep(decision: Extract<AutorunDecision, { kind: "step" }>, result: unknown): AutorunStep {
    const payload = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
    return {
      action: decision.action,
      scopeType: this.resolveAutorunStepScopeType(decision, payload),
      scopeId: this.resolveAutorunStepScopeId(decision, payload),
      status: typeof payload.status === "string" ? payload.status : "completed"
    };
  }

  private resolveAutorunStepScopeType(
    decision: Extract<AutorunDecision, { kind: "step" }>,
    payload: Record<string, unknown>
  ): AutorunStep["scopeType"] {
    if (typeof payload.runId === "string") {
      return "run";
    }
    if (typeof payload.waveStoryExecutionId === "string") {
      return "execution";
    }
    if (typeof payload.storyReviewRemediationRunId === "string") {
      return "remediation";
    }
    if (typeof payload.qaRunId === "string") {
      return "qa";
    }
    if (typeof payload.documentationRunId === "string") {
      return "documentation";
    }
    return decision.scopeType;
  }

  private resolveAutorunStepScopeId(
    decision: Extract<AutorunDecision, { kind: "step" }>,
    payload: Record<string, unknown>
  ): string {
    const candidateIds = [
      payload.runId,
      payload.waveStoryExecutionId,
      payload.storyReviewRemediationRunId,
      payload.qaRunId,
      payload.documentationRunId
    ];
    const resolved = candidateIds.find((value): value is string => typeof value === "string");
    return resolved ?? decision.scopeId;
  }

  private collectAutorunIds(summary: AutorunSummary, steps: AutorunStep[]): void {
    for (const step of steps) {
      if (step.scopeType === "run") {
        summary.createdRunIds.push(step.scopeId);
      } else if (step.scopeType === "execution") {
        summary.createdExecutionIds.push(step.scopeId);
      } else if (step.scopeType === "remediation") {
        summary.createdRemediationRunIds.push(step.scopeId);
      }
    }
  }

  private getLatestStageRun(input: {
    itemId: string;
    projectId?: string;
    stageKey: StageKey;
  }) {
    const runs = input.projectId
      ? this.deps.stageRunRepository.listByProjectId(input.projectId)
      : this.deps.stageRunRepository.listByItemId(input.itemId);
    return runs.filter((run) => run.stageKey === input.stageKey).at(-1) ?? null;
  }

  private completeItemIfDeliveryFinished(itemId: string): void {
    const item = this.requireItem(itemId);
    const projects = this.deps.projectRepository.listByItemId(itemId);
    if (projects.length === 0 || projects.some((project) => !this.isProjectDeliveryComplete(project.id))) {
      return;
    }

    const snapshot = this.buildSnapshot(itemId);
    if (item.currentColumn !== "done") {
      assertCanMoveItem(item.currentColumn, "done", snapshot);
      this.deps.itemRepository.updateColumn(itemId, "done", "completed");
      return;
    }

    this.deps.itemRepository.updatePhaseStatus(itemId, "completed");
  }

  private isProjectDeliveryComplete(projectId: string): boolean {
    const latestDocumentationRun = this.deps.documentationRunRepository.getLatestByProjectId(projectId);
    return latestDocumentationRun?.status === "completed" && latestDocumentationRun.staleAt === null;
  }

  private requireItem(itemId: string) {
    const item = this.deps.itemRepository.getById(itemId);
    if (!item) {
      throw new AppError("ITEM_NOT_FOUND", `Item ${itemId} not found`);
    }
    return item;
  }

  private requireProject(projectId: string) {
    const project = this.deps.projectRepository.getById(projectId);
    if (!project) {
      throw new AppError("PROJECT_NOT_FOUND", `Project ${projectId} not found`);
    }
    return project;
  }

  private requireStory(storyId: string) {
    const story = this.deps.userStoryRepository.getById(storyId);
    if (!story) {
      throw new AppError("STORY_NOT_FOUND", `Story ${storyId} not found`);
    }
    return story;
  }

  private requireAcceptanceCriterion(acceptanceCriterionId: string) {
    const acceptanceCriterion = this.deps.acceptanceCriterionRepository.getById(acceptanceCriterionId);
    if (!acceptanceCriterion) {
      throw new AppError("ACCEPTANCE_CRITERION_NOT_FOUND", `Acceptance criterion ${acceptanceCriterionId} not found`);
    }
    return acceptanceCriterion;
  }

  private requireWave(waveId: string) {
    const wave = this.deps.waveRepository.getById(waveId);
    if (!wave) {
      throw new AppError("WAVE_NOT_FOUND", `Wave ${waveId} not found`);
    }
    return wave;
  }

  private requireWaveStory(waveStoryId: string) {
    const waveStory = this.deps.waveStoryRepository.getById(waveStoryId);
    if (!waveStory) {
      throw new AppError("WAVE_STORY_NOT_FOUND", `Wave story ${waveStoryId} not found`);
    }
    return waveStory;
  }

  private requireWaveStoryByStoryId(storyId: string) {
    const waveStory = this.deps.waveStoryRepository.getByStoryId(storyId);
    if (!waveStory) {
      throw new AppError("WAVE_STORY_NOT_FOUND", `No wave story found for story ${storyId}`);
    }
    return waveStory;
  }

  private requireWaveExecution(waveExecutionId: string) {
    const waveExecution = this.deps.waveExecutionRepository.getById(waveExecutionId);
    if (!waveExecution) {
      throw new AppError("WAVE_EXECUTION_NOT_FOUND", `Wave execution ${waveExecutionId} not found`);
    }
    return waveExecution;
  }

  private requireWaveStoryTestRun(waveStoryTestRunId: string) {
    const waveStoryTestRun = this.deps.waveStoryTestRunRepository.getById(waveStoryTestRunId);
    if (!waveStoryTestRun) {
      throw new AppError("WAVE_STORY_TEST_RUN_NOT_FOUND", `Wave story test run ${waveStoryTestRunId} not found`);
    }
    return waveStoryTestRun;
  }

  private requireWaveStoryExecution(waveStoryExecutionId: string) {
    const waveStoryExecution = this.deps.waveStoryExecutionRepository.getById(waveStoryExecutionId);
    if (!waveStoryExecution) {
      throw new AppError("WAVE_STORY_EXECUTION_NOT_FOUND", `Wave story execution ${waveStoryExecutionId} not found`);
    }
    return waveStoryExecution;
  }

  private requireStoryReviewRun(storyReviewRunId: string) {
    const storyReviewRun = this.deps.storyReviewRunRepository.getById(storyReviewRunId);
    if (!storyReviewRun) {
      throw new AppError("STORY_REVIEW_RUN_NOT_FOUND", `Story review run ${storyReviewRunId} not found`);
    }
    return storyReviewRun;
  }

  private requireStoryReviewRemediationRun(storyReviewRemediationRunId: string) {
    const remediationRun = this.deps.storyReviewRemediationRunRepository.getById(storyReviewRemediationRunId);
    if (!remediationRun) {
      throw new AppError(
        "STORY_REVIEW_REMEDIATION_RUN_NOT_FOUND",
        `Story review remediation run ${storyReviewRemediationRunId} not found`
      );
    }
    return remediationRun;
  }

  private requireQaRun(qaRunId: string) {
    const qaRun = this.deps.qaRunRepository.getById(qaRunId);
    if (!qaRun) {
      throw new AppError("QA_RUN_NOT_FOUND", `QA run ${qaRunId} not found`);
    }
    return qaRun;
  }

  private requireDocumentationRun(documentationRunId: string) {
    const documentationRun = this.deps.documentationRunRepository.getById(documentationRunId);
    if (!documentationRun) {
      throw new AppError("DOCUMENTATION_RUN_NOT_FOUND", `Documentation run ${documentationRunId} not found`);
    }
    return documentationRun;
  }

  private findingFingerprint(finding: {
    category: string;
    title: string;
    filePath: string | null;
    line: number | null;
  }) {
    // This is intentionally coarse for the first cut. Cross-run matching may miss semantically identical
    // findings if the reviewer rewrites the title, but it keeps the remediation loop deterministic.
    return `${finding.category}::${finding.title}::${finding.filePath ?? ""}::${finding.line ?? ""}`;
  }

  private deriveAllowedPathsFromStoryContext(
    projectExecutionContext: ReturnType<WorkflowService["ensureProjectExecutionContext"]>,
    sourceExecution: ReturnType<WorkflowService["requireWaveStoryExecution"]>
  ): string[] {
    const implementation = sourceExecution.outputSummaryJson ? JSON.parse(sourceExecution.outputSummaryJson) as StoryExecutionOutput : null;
    const changedFiles = implementation?.changedFiles ?? [];
    return Array.from(new Set([...changedFiles, ...projectExecutionContext.relevantFiles]));
  }

  private invalidateDocumentationForProject(projectId: string, reason: string): void {
    const latestDocumentationRun = this.deps.documentationRunRepository.getLatestByProjectId(projectId);
    if (!latestDocumentationRun) {
      return;
    }
    if (latestDocumentationRun.status !== "completed" && latestDocumentationRun.status !== "review_required") {
      return;
    }
    this.deps.documentationRunRepository.markStale(latestDocumentationRun.id, reason);
  }

  private groupAcceptanceCriteriaByStoryId(projectId: string) {
    return this.deps.acceptanceCriterionRepository.listByProjectId(projectId).reduce((map, criterion) => {
      const current = map.get(criterion.storyId) ?? [];
      current.push(criterion);
      map.set(criterion.storyId, current);
      return map;
    }, new Map<string, ReturnType<AcceptanceCriterionRepository["listByProjectId"]>>());
  }

  private groupStoryReviewFindingsByRunId(storyReviewRunIds: string[]) {
    return this.deps.storyReviewFindingRepository.listByStoryReviewRunIds(storyReviewRunIds).reduce((map, finding) => {
      const current = map.get(finding.storyReviewRunId) ?? [];
      current.push(finding);
      map.set(finding.storyReviewRunId, current);
      return map;
    }, new Map<string, ReturnType<StoryReviewFindingRepository["listByStoryReviewRunId"]>>());
  }

  private requireImplementationPlanForProject(projectId: string) {
    const implementationPlan = this.deps.implementationPlanRepository.getLatestByProjectId(projectId);
    if (!implementationPlan || implementationPlan.status !== "approved") {
      throw new AppError("IMPLEMENTATION_PLAN_NOT_APPROVED", "Approved implementation plan is required for execution");
    }
    return implementationPlan;
  }

  private extractHeading(markdown: string): string {
    const line = markdown.split("\n").find((entry) => entry.startsWith("# "));
    return line ? line.replace(/^#\s+/, "") : "Concept";
  }

  private resolveWorkerProfile(profileKey: WorkerProfileKey) {
    return this.promptResolver.resolve(workerProfiles[profileKey]);
  }

  private resolveInputArtifactIds(stageKey: StageKey, itemId: string, projectId: string | null): string[] {
    const kindsByStage: Record<StageKey, string[]> = {
      brainstorm: [],
      requirements: ["concept", "projects"],
      architecture: ["concept", "projects", "stories", "stories-markdown"],
      planning: [
        "concept",
        "projects",
        "stories",
        "stories-markdown",
        "architecture-plan",
        "architecture-plan-data"
      ]
    };

    const ids = new Set<string>();
    for (const kind of kindsByStage[stageKey]) {
      const artifact = this.deps.artifactRepository.getLatestByKind({
        itemId,
        ...(kind === "stories" || kind === "stories-markdown" ? { projectId } : {}),
        kind
      });
      if (artifact) {
        ids.add(artifact.id);
      }
    }
    return [...ids];
  }

  private buildReviewOutcome(
    stageKey: StageKey,
    error: unknown
  ): { status: "review_required"; reviewReason: string } {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "review_required",
      reviewReason: `Failed to import ${stageKey} output: ${message}`
    };
  }
}
