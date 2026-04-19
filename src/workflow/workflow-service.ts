import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

import { buildItemWorkflowSnapshot } from "../domain/aggregate-status.js";
import { assertCanMoveItem } from "../domain/workflow-rules.js";
import type {
  AppVerificationRun,
  AppVerificationRunStatus,
  AppVerificationRunner,
  BrainstormDraft,
  BrainstormDraftStatus,
  BrainstormSession,
  BrainstormSessionMode,
  BrainstormSessionStatus,
  DocumentationRunStatus,
  ExecutionWorkerRole,
  GitBranchMetadata,
  InteractiveReviewEntryStatus,
  InteractiveReviewSeverity,
  InteractiveReviewResolutionType,
  InteractiveReviewSession,
  QaRunStatus,
  StageKey,
  StoryReviewFindingSeverity,
  StoryReviewRunStatus,
  VerificationRunStatus,
  Workspace,
  WorkspaceSettings
} from "../domain/types.js";
import { PromptResolver } from "../services/prompt-resolver.js";
import { ArtifactService } from "../services/artifact-service.js";
import { GitWorkflowService } from "../services/git-workflow-service.js";
import {
  implementationPlanOutputSchema,
  appVerificationOutputSchema,
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
  AppVerificationOutput,
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
  InteractiveReviewEntryRepository,
  InteractiveReviewMessageRepository,
  InteractiveReviewResolutionRepository,
  InteractiveReviewSessionRepository,
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
  AppVerificationRunRepository,
  ArchitecturePlanRepository,
  ArtifactRecord,
  ArtifactRepository,
  AgentSessionRepository,
  BrainstormDraftRepository,
  BrainstormMessageRepository,
  BrainstormSessionRepository,
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
import { AutorunOrchestrator } from "./autorun-orchestrator.js";
import type { AutorunSummary, AutorunStep } from "./autorun-types.js";
import {
  interactiveReviewEntryStatuses,
  interactiveReviewSeverities
} from "../domain/types.js";

const supportedInteractiveReviewResolutionActions = [
  "approve",
  "approve_and_autorun",
  "approve_all",
  "approve_all_and_autorun",
  "approve_selected",
  "request_changes",
  "request_story_revisions",
  "apply_story_edits"
] as const;

const appTestConfigSchema = z.object({
  baseUrl: z.string().min(1).optional(),
  runnerPreference: z.array(z.enum(["agent_browser", "playwright"])).min(1).optional(),
  readiness: z.object({
    healthUrl: z.string().min(1).optional(),
    command: z.string().min(1).optional(),
    timeoutMs: z.number().int().positive().optional()
  }).nullable().optional(),
  auth: z.object({
    strategy: z.enum(["password", "existing_session"]),
    defaultRole: z.string().min(1).optional()
  }).optional(),
  users: z.array(
    z.object({
      key: z.string().min(1),
      role: z.string().min(1),
      email: z.string().min(1).optional(),
      passwordSecretRef: z.string().min(1).optional()
    })
  ).optional(),
  fixtures: z.object({
    seedCommand: z.string().min(1).optional(),
    resetCommand: z.string().min(1).optional()
  }).nullable().optional(),
  routes: z.record(z.string(), z.string().min(1)).optional(),
  featureFlags: z.record(z.string(), z.union([z.boolean(), z.string()])).optional()
});

type WorkflowDeps = {
  repoRoot: string;
  workspace: Workspace;
  workspaceSettings: WorkspaceSettings;
  workspaceRoot: string;
  artifactRoot: string;
  runInTransaction<T>(fn: () => T): T;
  adapter: AgentAdapter;
  itemRepository: ItemRepository;
  brainstormSessionRepository: BrainstormSessionRepository;
  brainstormMessageRepository: BrainstormMessageRepository;
  brainstormDraftRepository: BrainstormDraftRepository;
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
  interactiveReviewSessionRepository: InteractiveReviewSessionRepository;
  interactiveReviewMessageRepository: InteractiveReviewMessageRepository;
  interactiveReviewEntryRepository: InteractiveReviewEntryRepository;
  interactiveReviewResolutionRepository: InteractiveReviewResolutionRepository;
  stageRunRepository: StageRunRepository;
  artifactRepository: ArtifactRepository;
  agentSessionRepository: AgentSessionRepository;
  appVerificationRunRepository: AppVerificationRunRepository;
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
      phase: "implementation" | "app_verification" | "story_review";
      waveStoryExecutionId: string;
      waveStoryId: string;
      storyCode: string;
      status: string;
    };

export class WorkflowService {
  private readonly promptResolver: PromptResolver;
  private readonly artifactService: ArtifactService;
  private readonly gitWorkflowService: GitWorkflowService;
  private readonly autorunOrchestrator: AutorunOrchestrator;

  public constructor(private readonly deps: WorkflowDeps) {
    this.promptResolver = new PromptResolver(deps.repoRoot);
    this.artifactService = new ArtifactService(deps.artifactRoot);
    this.gitWorkflowService = new GitWorkflowService(deps.workspaceRoot);
    this.autorunOrchestrator = new AutorunOrchestrator({
      requireItem: (itemId) => this.requireItem(itemId),
      requireProject: (projectId) => this.requireProject(projectId),
      requireStoryReviewRunById: (storyReviewRunId) => this.requireStoryReviewRun(storyReviewRunId),
      getLatestConceptByItemId: (itemId) => this.deps.conceptRepository.getLatestByItemId(itemId),
      getProjectsByItemId: (itemId) => this.deps.projectRepository.listByItemId(itemId),
      getLatestStageRun: (input) => this.getLatestStageRun(input),
      hasAnyStoriesByProjectId: (projectId) => this.deps.userStoryRepository.hasAnyByProjectId(projectId),
      listStoriesByProjectId: (projectId) => this.deps.userStoryRepository.listByProjectId(projectId),
      getLatestArchitecturePlanByProjectId: (projectId) => this.deps.architecturePlanRepository.getLatestByProjectId(projectId),
      getLatestImplementationPlanByProjectId: (projectId) =>
        this.deps.implementationPlanRepository.getLatestByProjectId(projectId),
      getLatestQaRunByProjectId: (projectId) => this.deps.qaRunRepository.getLatestByProjectId(projectId),
      getLatestDocumentationRunByProjectId: (projectId) =>
        this.deps.documentationRunRepository.getLatestByProjectId(projectId),
      showExecution: (projectId) => this.showExecution(projectId),
      importProjects: (itemId) => this.importProjects(itemId),
      startStage: (input) => this.startStage(input),
      approveStories: (projectId) => this.approveStories(projectId),
      approveArchitecture: (projectId) => this.approveArchitecture(projectId),
      approvePlanning: (projectId) => this.approvePlanning(projectId),
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
          workspaceKey: this.deps.workspace.key,
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

  public startBrainstormSession(itemId: string) {
    const item = this.requireItem(itemId);
    const existing = this.deps.brainstormSessionRepository.findOpenByItemId(item.id);
    if (existing) {
      return {
        sessionId: existing.id,
        status: existing.status,
        reused: true
      };
    }

    const created = this.deps.runInTransaction(() => {
      if (item.currentColumn === "idea") {
        this.deps.itemRepository.updateColumn(item.id, "brainstorm", "running");
      }
      const session = this.deps.brainstormSessionRepository.create({
        itemId: item.id,
        status: "open",
        mode: "explore"
      });
      this.deps.brainstormMessageRepository.create({
        sessionId: session.id,
        role: "system",
        content: "Interactive brainstorm session for item.",
        structuredPayloadJson: JSON.stringify(
          {
            itemId: item.id,
            itemCode: item.code
          },
          null,
          2
        ),
        derivedUpdatesJson: null
      });
      const draft = this.deps.brainstormDraftRepository.create({
        itemId: item.id,
        sessionId: session.id,
        revision: 1,
        status: "needs_input",
        problem: item.description || item.title,
        targetUsersJson: JSON.stringify([]),
        coreOutcome: item.title,
        useCasesJson: JSON.stringify([]),
        constraintsJson: JSON.stringify([]),
        nonGoalsJson: JSON.stringify([]),
        risksJson: JSON.stringify([]),
        openQuestionsJson: JSON.stringify(["What is the smallest useful user outcome for this item?"]),
        candidateDirectionsJson: JSON.stringify([]),
        recommendedDirection: null,
        scopeNotes: null,
        assumptionsJson: JSON.stringify([]),
        lastUpdatedFromMessageId: null
      });
      const assistantMessage = this.deps.brainstormMessageRepository.create({
        sessionId: session.id,
        role: "assistant",
        content: this.buildBrainstormKickoffMessage(item),
        structuredPayloadJson: JSON.stringify(
          {
            draftRevision: draft.revision
          },
          null,
          2
        ),
        derivedUpdatesJson: null
      });
      const nextStatus = this.computeBrainstormSessionStatus(draft);
      const nextMode = this.computeBrainstormSessionMode(draft);
      this.deps.brainstormSessionRepository.update(session.id, {
        status: nextStatus,
        mode: nextMode,
        lastAssistantMessageId: assistantMessage.id
      });
      return { sessionId: session.id, status: nextStatus };
    });

    return {
      ...created,
      reused: false
    };
  }

  public showBrainstormBySessionId(sessionId: string) {
    const session = this.requireBrainstormSession(sessionId);
    const item = this.requireItem(session.itemId);
    const draft = this.requireLatestBrainstormDraft(session.id);
    const messages = this.deps.brainstormMessageRepository.listBySessionId(session.id);
    return {
      session,
      item,
      draft: this.mapBrainstormDraft(draft),
      messages
    };
  }

  public showBrainstormSession(itemId: string) {
    const item = this.requireItem(itemId);
    const session = this.deps.brainstormSessionRepository.getLatestByItemId(item.id);
    if (session) {
      return this.showBrainstormBySessionId(session.id);
    }
    const started = this.startBrainstormSession(item.id);
    return this.showBrainstormBySessionId(started.sessionId);
  }

  public showBrainstormDraft(sessionId: string) {
    const session = this.requireBrainstormSession(sessionId);
    this.requireItem(session.itemId);
    return this.mapBrainstormDraft(this.requireLatestBrainstormDraft(session.id));
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
    const session = this.requireBrainstormSession(input.sessionId);
    this.assertBrainstormSessionOpen(session);
    const item = this.requireItem(session.itemId);
    const previousDraft = this.requireLatestBrainstormDraft(session.id);
    const previousView = this.mapBrainstormDraft(previousDraft);

    const draftUpdate: Partial<BrainstormDraft> = {};
    const summaryParts: string[] = [];

    const assignScalar = (
      key: "problem" | "coreOutcome" | "recommendedDirection" | "scopeNotes",
      nextValue: string | null | undefined,
      label: string
    ) => {
      if (nextValue === undefined) {
        return;
      }
      draftUpdate[key] = nextValue;
      summaryParts.push(`${label}=${nextValue ?? "cleared"}`);
    };

    const assignList = (
      key:
        | "targetUsersJson"
        | "useCasesJson"
        | "constraintsJson"
        | "nonGoalsJson"
        | "risksJson"
        | "openQuestionsJson"
        | "candidateDirectionsJson"
        | "assumptionsJson",
      nextValue: string[] | undefined,
      label: string
    ) => {
      if (nextValue === undefined) {
        return;
      }
      const normalized = this.normalizeBrainstormEntries(nextValue);
      draftUpdate[key] = JSON.stringify(normalized);
      summaryParts.push(`${label}=${normalized.length}`);
    };

    assignScalar("problem", input.problem, "problem");
    assignScalar("coreOutcome", input.coreOutcome, "coreOutcome");
    assignScalar("recommendedDirection", input.recommendedDirection, "recommendedDirection");
    assignScalar("scopeNotes", input.scopeNotes, "scopeNotes");
    assignList("targetUsersJson", input.targetUsers, "targetUsers");
    assignList("useCasesJson", input.useCases, "useCases");
    assignList("constraintsJson", input.constraints, "constraints");
    assignList("nonGoalsJson", input.nonGoals, "nonGoals");
    assignList("risksJson", input.risks, "risks");
    assignList("openQuestionsJson", input.openQuestions, "openQuestions");
    assignList("candidateDirectionsJson", input.candidateDirections, "candidateDirections");
    assignList("assumptionsJson", input.assumptions, "assumptions");

    if (summaryParts.length === 0) {
      throw new AppError("BRAINSTORM_DRAFT_UPDATE_EMPTY", "No brainstorm draft changes were provided");
    }

    return this.deps.runInTransaction(() => {
      const userMessage = this.deps.brainstormMessageRepository.create({
        sessionId: session.id,
        role: "user",
        content: `Structured brainstorm draft update: ${summaryParts.join(", ")}`,
        structuredPayloadJson: JSON.stringify(input, null, 2),
        derivedUpdatesJson: null
      });
      const nextDraftInput = {
        ...previousDraft,
        ...draftUpdate,
        lastUpdatedFromMessageId: userMessage.id
      } as BrainstormDraft;
      const nextDraft = this.deps.brainstormDraftRepository.createRevision(previousDraft, {
        ...draftUpdate,
        status: this.computeBrainstormDraftStatus(nextDraftInput),
        lastUpdatedFromMessageId: userMessage.id
      });
      const assistantMessage = this.deps.brainstormMessageRepository.create({
        sessionId: session.id,
        role: "assistant",
        content: this.buildBrainstormFollowUpMessage(item, nextDraft),
        structuredPayloadJson: JSON.stringify(
          {
            draftRevision: nextDraft.revision,
            updateType: "structured"
          },
          null,
          2
        ),
        derivedUpdatesJson: JSON.stringify(
          {
            previousDraft: previousView,
            nextDraft: this.mapBrainstormDraft(nextDraft)
          },
          null,
          2
        )
      });
      const nextStatus = this.computeBrainstormSessionStatus(nextDraft);
      const nextMode = this.computeBrainstormSessionMode(nextDraft);
      this.deps.brainstormSessionRepository.update(session.id, {
        status: nextStatus,
        mode: nextMode,
        lastAssistantMessageId: assistantMessage.id,
        lastUserMessageId: userMessage.id
      });
      this.deps.itemRepository.updatePhaseStatus(item.id, nextStatus === "ready_for_concept" ? "completed" : "running");
      return {
        sessionId: session.id,
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        status: nextStatus,
        mode: nextMode,
        draft: this.mapBrainstormDraft(nextDraft)
      };
    });
  }

  public chatBrainstorm(sessionId: string, message: string) {
    const session = this.requireBrainstormSession(sessionId);
    this.assertBrainstormSessionOpen(session);
    const item = this.requireItem(session.itemId);
    const previousDraft = this.requireLatestBrainstormDraft(session.id);

    return this.deps.runInTransaction(() => {
      const userMessage = this.deps.brainstormMessageRepository.create({
        sessionId: session.id,
        role: "user",
        content: message,
        structuredPayloadJson: null,
        derivedUpdatesJson: null
      });
      const draftUpdate = this.deriveBrainstormDraftUpdate(previousDraft, message);
      const nextDraft = this.deps.brainstormDraftRepository.createRevision(previousDraft, {
        ...draftUpdate,
        status: this.computeBrainstormDraftStatus({
          ...previousDraft,
          ...draftUpdate
        } as BrainstormDraft),
        lastUpdatedFromMessageId: userMessage.id
      });
      const assistantMessage = this.deps.brainstormMessageRepository.create({
        sessionId: session.id,
        role: "assistant",
        content: this.buildBrainstormFollowUpMessage(item, nextDraft),
        structuredPayloadJson: JSON.stringify(
          {
            draftRevision: nextDraft.revision
          },
          null,
          2
        ),
        derivedUpdatesJson: JSON.stringify(this.mapBrainstormDraft(nextDraft), null, 2)
      });
      const nextStatus = this.computeBrainstormSessionStatus(nextDraft);
      const nextMode = this.computeBrainstormSessionMode(nextDraft);
      this.deps.brainstormSessionRepository.update(session.id, {
        status: nextStatus,
        mode: nextMode,
        lastAssistantMessageId: assistantMessage.id,
        lastUserMessageId: userMessage.id
      });
      this.deps.itemRepository.updatePhaseStatus(item.id, nextStatus === "ready_for_concept" ? "completed" : "running");
      return {
        sessionId: session.id,
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        status: nextStatus,
        mode: nextMode,
        draft: this.mapBrainstormDraft(nextDraft)
      };
    });
  }

  public async promoteBrainstorm(sessionId: string, options?: { autorun?: boolean }) {
    const session = this.requireBrainstormSession(sessionId);
    this.assertBrainstormSessionOpen(session);
    const item = this.requireItem(session.itemId);
    const draft = this.requireLatestBrainstormDraft(session.id);
    const draftView = this.mapBrainstormDraft(draft);
    const previousConcept = this.deps.conceptRepository.getLatestByItemId(item.id);

    const result = this.deps.runInTransaction(() => {
      const conceptMarkdown = this.renderConceptFromBrainstormDraft(item, draftView);
      const projectsPayload = this.buildProjectsFromBrainstormDraft(item, draftView);
      const conceptArtifactRecord = this.persistManualArtifact({
        item,
        sessionScopedId: session.id,
        kind: "concept",
        format: "md",
        content: conceptMarkdown
      });
      const projectsArtifactRecord = this.persistManualArtifact({
        item,
        sessionScopedId: session.id,
        kind: "projects",
        format: "json",
        content: JSON.stringify(projectsPayload, null, 2)
      });
      const concept = this.deps.conceptRepository.create({
        itemId: item.id,
        version: (previousConcept?.version ?? 0) + 1,
        title: `${item.title} Concept`,
        summary: projectsPayload.projects.map((project) => project.title).join(", "),
        status: "draft",
        markdownArtifactId: conceptArtifactRecord.id,
        structuredArtifactId: projectsArtifactRecord.id
      });
      this.deps.brainstormSessionRepository.update(session.id, {
        status: "resolved",
        resolvedAt: Date.now()
      });
      this.deps.itemRepository.updatePhaseStatus(item.id, "completed");
      return { concept, draftRevision: draft.revision };
    });

    if (options?.autorun) {
      this.approveConcept(result.concept.id);
      const autorun = await this.autorunForItem({
        itemId: item.id,
        trigger: "brainstorm:promote",
        initialSteps: [{ action: "brainstorm:promote", scopeType: "item", scopeId: item.id, status: "promoted" }]
      });
      return {
        sessionId: session.id,
        conceptId: result.concept.id,
        draftRevision: result.draftRevision,
        autorun
      };
    }

    return {
      sessionId: session.id,
      conceptId: result.concept.id,
      draftRevision: result.draftRevision,
      status: "promoted"
    };
  }

  public startInteractiveReview(input: { type: "stories"; projectId: string }) {
    if (input.type !== "stories") {
      throw new AppError("INTERACTIVE_REVIEW_TYPE_NOT_SUPPORTED", `Review type ${input.type} is not supported yet`);
    }

    const project = this.requireProject(input.projectId);
    const item = this.requireItem(project.itemId);
    const stories = this.deps.userStoryRepository.listByProjectId(project.id);
    if (stories.length === 0) {
      throw new AppError("STORIES_NOT_FOUND", "No user stories found for project");
    }

    const existing = this.deps.interactiveReviewSessionRepository.findOpenByScope({
      scopeType: "project",
      scopeId: project.id,
      artifactType: "stories",
      reviewType: "collection_review"
    });
    if (existing) {
      return {
        sessionId: existing.id,
        status: existing.status,
        reused: true
      };
    }

    const created = this.deps.runInTransaction(() => {
      const session = this.deps.interactiveReviewSessionRepository.create({
        scopeType: "project",
        scopeId: project.id,
        artifactType: "stories",
        reviewType: "collection_review",
        status: "open"
      });
      this.deps.interactiveReviewMessageRepository.create({
        sessionId: session.id,
        role: "system",
        content: "Interactive review session for project stories.",
        structuredPayloadJson: JSON.stringify(
          {
            itemId: item.id,
            projectId: project.id,
            storyIds: stories.map((story) => story.id)
          },
          null,
          2
        ),
        derivedUpdatesJson: null
      });
      const assistantMessage = this.deps.interactiveReviewMessageRepository.create({
        sessionId: session.id,
        role: "assistant",
        content: this.buildStoryReviewKickoffMessage(project.code, stories),
        structuredPayloadJson: JSON.stringify(
          {
            availableActions: [...supportedInteractiveReviewResolutionActions]
          },
          null,
          2
        ),
        derivedUpdatesJson: null
      });
      this.deps.interactiveReviewEntryRepository.createMany(
        stories.map((story) => ({
          sessionId: session.id,
          entryType: "story",
          entryId: story.id,
          title: `${story.code} ${story.title}`,
          status: story.status === "approved" ? "accepted" : "pending",
          summary: null,
          changeRequest: null,
          rationale: null,
          severity: null
        }))
      );
      const nextStatus = this.computeInteractiveReviewStatus(
        stories.map((story) => ({
          status: story.status === "approved" ? "accepted" : "pending"
        }))
      );
      this.deps.interactiveReviewSessionRepository.update(session.id, {
        lastAssistantMessageId: assistantMessage.id,
        status: nextStatus
      });
      return session;
    });

    return {
      sessionId: created.id,
      status: this.showInteractiveReview(created.id).session.status,
      reused: false
    };
  }

  public showInteractiveReview(sessionId: string) {
    const session = this.requireInteractiveReviewSession(sessionId);
    const messages = this.deps.interactiveReviewMessageRepository.listBySessionId(sessionId);
    const entries = this.deps.interactiveReviewEntryRepository.listBySessionId(sessionId);
    const resolutions = this.deps.interactiveReviewResolutionRepository.listBySessionId(sessionId);

    if (session.artifactType === "stories" && session.scopeType === "project") {
      const project = this.requireProject(session.scopeId);
      const item = this.requireItem(project.itemId);
      const stories = this.deps.userStoryRepository.listByProjectId(project.id).map((story) => ({
        ...story,
        acceptanceCriteria: this.deps.acceptanceCriterionRepository.listByStoryId(story.id)
      }));
      return { session, item, project, stories, messages, entries, resolutions };
    }

    return { session, messages, entries, resolutions };
  }

  public chatInteractiveReview(sessionId: string, message: string) {
    const session = this.requireInteractiveReviewSession(sessionId);
    this.assertInteractiveReviewOpen(session);
    const storyScope = this.getStoryReviewScope(session);
    const derivedUpdates = this.deriveStoryEntryUpdates(storyScope.stories, message);

    const result = this.deps.runInTransaction(() => {
      const userMessage = this.deps.interactiveReviewMessageRepository.create({
        sessionId,
        role: "user",
        content: message,
        structuredPayloadJson: null,
        derivedUpdatesJson: derivedUpdates.length > 0 ? JSON.stringify({ entryUpdates: derivedUpdates }, null, 2) : null
      });
      this.deps.interactiveReviewSessionRepository.update(sessionId, {
        lastUserMessageId: userMessage.id
      });

      for (const update of derivedUpdates) {
        this.deps.interactiveReviewEntryRepository.updateByEntryId(sessionId, update.entryId, {
          status: update.status,
          summary: update.summary,
          changeRequest: update.changeRequest,
          severity: update.severity
        });
      }

      const entries = this.deps.interactiveReviewEntryRepository.listBySessionId(sessionId);
      const assistantMessage = this.deps.interactiveReviewMessageRepository.create({
        sessionId,
        role: "assistant",
        content: this.buildStoryReviewFollowUpMessage(storyScope.project.code, entries, derivedUpdates),
        structuredPayloadJson: JSON.stringify(
          {
            availableActions: [...supportedInteractiveReviewResolutionActions],
            derivedUpdateCount: derivedUpdates.length
          },
          null,
          2
        ),
        derivedUpdatesJson: derivedUpdates.length > 0 ? JSON.stringify({ entryUpdates: derivedUpdates }, null, 2) : null
      });
      const nextStatus = this.computeInteractiveReviewStatus(entries);
      this.deps.interactiveReviewSessionRepository.update(sessionId, {
        lastAssistantMessageId: assistantMessage.id,
        status: nextStatus
      });

      return {
        sessionId,
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        status: nextStatus,
        derivedUpdates
      };
    });

    return result;
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
    const session = this.requireInteractiveReviewSession(input.sessionId);
    this.assertInteractiveReviewOpen(session);
    this.assertInteractiveReviewEntryStatus(input.status);
    this.assertInteractiveReviewSeverity(input.severity);
    const storyScope = this.getStoryReviewScope(session);
    const project = storyScope.project;
    const story = this.deps.userStoryRepository.getById(input.storyId);
    if (!story || story.projectId !== project.id) {
      throw new AppError("STORY_NOT_FOUND", `Story ${input.storyId} not found in review scope`);
    }

    this.deps.interactiveReviewEntryRepository.updateByEntryId(session.id, story.id, {
      status: input.status,
      summary: input.summary ?? null,
      changeRequest: input.changeRequest ?? null,
      rationale: input.rationale ?? null,
      severity: input.severity ?? null
    });
    const entries = this.deps.interactiveReviewEntryRepository.listBySessionId(session.id);
    const nextStatus = this.computeInteractiveReviewStatus(entries);
    this.deps.interactiveReviewSessionRepository.update(session.id, {
      status: nextStatus
    });
    return {
      sessionId: session.id,
      storyId: story.id,
      status: nextStatus
    };
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
    const session = this.requireInteractiveReviewSession(input.sessionId);
    this.assertInteractiveReviewOpen(session);
    const storyScope = this.getStoryReviewScope(session);
    const story = this.requireStory(input.storyId);
    if (story.projectId !== storyScope.project.id) {
      throw new AppError("STORY_NOT_FOUND", `Story ${input.storyId} not found in review scope`);
    }

    const sanitizedAcceptanceCriteria = input.acceptanceCriteria?.map((criterion) => criterion.trim()).filter(Boolean);
    if (sanitizedAcceptanceCriteria && sanitizedAcceptanceCriteria.length === 0) {
      throw new AppError("ACCEPTANCE_CRITERIA_INVALID", "Acceptance criteria must not be empty when provided");
    }
    const nextEntryStatus = input.status ?? "resolved";

    const updatedStory = this.deps.runInTransaction(() => {
      this.deps.userStoryRepository.update(story.id, {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description.trim() } : {}),
        ...(input.actor !== undefined ? { actor: input.actor.trim() } : {}),
        ...(input.goal !== undefined ? { goal: input.goal.trim() } : {}),
        ...(input.benefit !== undefined ? { benefit: input.benefit.trim() } : {}),
        ...(input.priority !== undefined ? { priority: input.priority.trim() } : {}),
        status: "draft"
      });

      if (sanitizedAcceptanceCriteria) {
        this.deps.acceptanceCriterionRepository.deleteByStoryId(story.id);
        this.deps.acceptanceCriterionRepository.createMany(
          sanitizedAcceptanceCriteria.map((criterion, index) => ({
            storyId: story.id,
            code: formatAcceptanceCriterionCode(story.code, index + 1),
            text: criterion,
            position: index
          }))
        );
      }

      this.deps.interactiveReviewEntryRepository.updateByEntryId(session.id, story.id, {
        status: nextEntryStatus,
        summary: input.summary ?? "Guided edits applied",
        changeRequest: null,
        rationale: input.rationale ?? null,
        severity: null
      });
      const assistantMessage = this.deps.interactiveReviewMessageRepository.create({
        sessionId: session.id,
        role: "assistant",
        content: `Applied guided edits to ${story.code}.`,
        structuredPayloadJson: JSON.stringify(
          {
            storyId: story.id,
            changedFields: [
              ...(input.title !== undefined ? ["title"] : []),
              ...(input.description !== undefined ? ["description"] : []),
              ...(input.actor !== undefined ? ["actor"] : []),
              ...(input.goal !== undefined ? ["goal"] : []),
              ...(input.benefit !== undefined ? ["benefit"] : []),
              ...(input.priority !== undefined ? ["priority"] : []),
              ...(sanitizedAcceptanceCriteria ? ["acceptanceCriteria"] : [])
            ]
          },
          null,
          2
        ),
        derivedUpdatesJson: JSON.stringify(
          {
            entryUpdates: [
              {
                entryId: story.id,
                status: nextEntryStatus
              }
            ]
          },
          null,
          2
        )
      });
      const entries = this.deps.interactiveReviewEntryRepository.listBySessionId(session.id);
      this.deps.interactiveReviewSessionRepository.update(session.id, {
        lastAssistantMessageId: assistantMessage.id,
        status: this.computeInteractiveReviewStatus(entries)
      });
      return this.requireStory(story.id);
    });

    return {
      sessionId: session.id,
      story: updatedStory,
      acceptanceCriteria: this.deps.acceptanceCriterionRepository.listByStoryId(story.id)
    };
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
    const session = this.requireInteractiveReviewSession(input.sessionId);
    this.assertInteractiveReviewOpen(session);
    this.assertInteractiveReviewResolutionAction(input.action);
    const storyScope = this.getStoryReviewScope(session);
    const { project, item } = storyScope;
    const targetedStoryIds = input.storyIds ? this.resolveInteractiveReviewStoryIds(project.id, input.storyIds) : [];
    const resolution = this.deps.runInTransaction(() => {
      const payload = {
        ...(input.rationale ? { rationale: input.rationale } : {}),
        ...(targetedStoryIds.length > 0 ? { storyIds: targetedStoryIds } : {})
      };
      const createdResolution = this.deps.interactiveReviewResolutionRepository.create({
        sessionId: session.id,
        resolutionType: input.action,
        payloadJson: Object.keys(payload).length > 0 ? JSON.stringify(payload, null, 2) : null
      });

      if (input.action === "approve" || input.action === "approve_and_autorun" || input.action === "approve_all" || input.action === "approve_all_and_autorun") {
        this.approveStories(project.id);
      }

      if (input.action === "approve_selected") {
        if (targetedStoryIds.length === 0) {
          throw new AppError("INTERACTIVE_REVIEW_STORY_IDS_REQUIRED", "approve_selected requires at least one story id");
        }
        this.deps.userStoryRepository.approveByIds(targetedStoryIds);
        for (const storyId of targetedStoryIds) {
          this.deps.interactiveReviewEntryRepository.updateByEntryId(session.id, storyId, {
            status: "accepted",
            summary: "Approved via selected resolution",
            changeRequest: null
          });
        }
        this.maybeAdvanceAfterPartialStoryApproval(project.id);
      }

      if (input.action === "request_changes" || input.action === "request_story_revisions") {
        const affectedStoryIds =
          targetedStoryIds.length > 0
            ? targetedStoryIds
            : this.deps.interactiveReviewEntryRepository
                .listBySessionId(session.id)
                .filter((entry) => entry.entryType === "story")
                .map((entry) => entry.entryId);
        if (input.action === "request_story_revisions") {
          for (const storyId of affectedStoryIds) {
            this.deps.interactiveReviewEntryRepository.updateByEntryId(session.id, storyId, {
              status: "needs_revision",
              summary: "Revision requested via session resolution",
              changeRequest: input.rationale ?? "Revise the story based on review feedback"
            });
          }
        }
        this.deps.itemRepository.updatePhaseStatus(item.id, "review_required");
      }

      if (input.action === "apply_story_edits") {
        if (targetedStoryIds.length === 0) {
          throw new AppError("INTERACTIVE_REVIEW_STORY_IDS_REQUIRED", "apply_story_edits requires at least one edited story id");
        }
        for (const storyId of targetedStoryIds) {
          this.deps.interactiveReviewEntryRepository.updateByEntryId(session.id, storyId, {
            status: "resolved",
            summary: "Guided edits applied and accepted for follow-up workflow",
            changeRequest: null,
            rationale: input.rationale ?? null
          });
        }
        this.deps.itemRepository.updatePhaseStatus(item.id, "draft");
      }

      this.deps.interactiveReviewResolutionRepository.markApplied(createdResolution.id);
      this.deps.interactiveReviewSessionRepository.update(session.id, {
        status: "resolved",
        resolvedAt: Date.now()
      });
      return createdResolution;
    });

    if (input.action === "approve_and_autorun" || input.action === "approve_all_and_autorun") {
      const autorun = await this.autorunForProject({
        projectId: project.id,
        trigger: "review:resolve",
        initialSteps: [{ action: "review:resolve", scopeType: "project", scopeId: project.id, status: "approved" }]
      });
      this.deps.interactiveReviewResolutionRepository.updatePayloadJson(
        resolution.id,
        JSON.stringify(
          {
            ...(input.rationale ? { rationale: input.rationale } : {}),
            autorun
          },
          null,
          2
        )
      );
      return {
        sessionId: session.id,
        resolutionId: resolution.id,
        status: "resolved",
        autorun
      };
    }

    return {
      sessionId: session.id,
      resolutionId: resolution.id,
      status: "resolved",
      action: input.action
    };
  }

  public listRuns(input: { itemId?: string; projectId?: string }) {
    if (input.projectId) {
      this.requireProject(input.projectId);
      return this.deps.stageRunRepository.listByProjectId(input.projectId);
    }
    if (input.itemId) {
      this.requireItem(input.itemId);
      return this.deps.stageRunRepository.listByItemId(input.itemId);
    }
    throw new AppError("LIST_SCOPE_REQUIRED", "Either itemId or projectId is required");
  }

  public showRun(runId: string) {
    const run = this.deps.stageRunRepository.getById(runId);
    if (!run) {
      throw new AppError("RUN_NOT_FOUND", `Stage run ${runId} not found`);
    }
    this.requireItem(run.itemId);
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
      this.requireItem(run.itemId);
      return this.deps.artifactRepository.listByStageRunId(input.runId);
    }
    if (input.itemId) {
      this.requireItem(input.itemId);
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
      phase: result.phase as "implementation" | "app_verification" | "story_review"
    };
  }

  public async startAppVerification(waveStoryExecutionId: string) {
    const execution = this.requireWaveStoryExecution(waveStoryExecutionId);
    const latestBasicVerification = this.deps.verificationRunRepository.getLatestByWaveStoryExecutionIdAndMode(
      execution.id,
      "basic"
    );
    const latestRalphVerification = this.deps.verificationRunRepository.getLatestByWaveStoryExecutionIdAndMode(
      execution.id,
      "ralph"
    );
    if (latestBasicVerification?.status !== "passed" || latestRalphVerification?.status !== "passed") {
      throw new AppError(
        "APP_VERIFICATION_NOT_READY",
        `Wave story execution ${waveStoryExecutionId} has not passed basic and Ralph verification`
      );
    }

    const latestAppVerification = this.deps.appVerificationRunRepository.getLatestByWaveStoryExecutionId(execution.id);
    if (latestAppVerification?.status === "passed") {
      throw new AppError(
        "APP_VERIFICATION_ALREADY_PASSED",
        `Wave story execution ${waveStoryExecutionId} already has a passed app verification`
      );
    }

    const story = this.requireStory(execution.storyId);
    const project = this.requireProject(story.projectId);
    const implementationPlan = this.requireImplementationPlanForProject(project.id);
    const waveExecution = this.requireWaveExecution(execution.waveExecutionId);
    const wave = this.requireWave(waveExecution.waveId);
    const testPreparationRun = this.requireWaveStoryTestRun(execution.testPreparationRunId);
    const parsedTestPreparation = this.parseTestPreparationOutput(testPreparationRun);
    const implementationOutput = this.parseStoryExecutionOutput(execution);
    const basicVerificationSummary = JSON.parse(latestBasicVerification.summaryJson) as {
      storyCode: string;
      changedFiles: string[];
      testsRun: StoryExecutionOutput["testsRun"];
      blockers: string[];
    };
    const ralphVerificationSummary = this.parseRalphVerificationOutput(latestRalphVerification);
    const storyRunContext = this.buildStoryRunContext({
      project,
      implementationPlan,
      wave,
      story
    });

    const appVerification = await this.executeAppVerification({
      project,
      implementationPlan,
      wave,
      story,
      storyRunContext,
      execution,
      implementationOutput
    });

    const storyReview =
      appVerification.status === "passed"
        ? await this.executeStoryReview({
            project,
            implementationPlan,
            wave,
            story,
            storyRunContext,
            testPreparationRun,
            parsedTestPreparation,
            execution,
            implementationOutput,
            basicVerificationStatus: latestBasicVerification.status,
            basicVerificationSummary,
            ralphVerificationStatus: latestRalphVerification.status,
            ralphVerificationSummary
          })
        : null;
    const finalExecutionStatus = this.resolveOverallExecutionStatus(
      latestBasicVerification.status,
      latestRalphVerification.status,
      appVerification.status,
      storyReview?.status ?? null
    );
    this.deps.waveStoryExecutionRepository.updateStatus(
      execution.id,
      finalExecutionStatus === "passed" ? "completed" : finalExecutionStatus,
      {
        outputSummaryJson: execution.outputSummaryJson,
        errorMessage: appVerification.errorMessage ?? storyReview?.errorMessage ?? null
      }
    );
    this.refreshWaveExecutionStatus(waveExecution.id);

    return {
      phase: storyReview ? "story_review" : "app_verification",
      appVerificationRunId: appVerification.runId,
      waveStoryExecutionId: execution.id,
      storyCode: story.code,
      status: finalExecutionStatus === "passed" ? "completed" : finalExecutionStatus
    };
  }

  public showAppVerification(appVerificationRunId: string) {
    const run = this.requireAppVerificationRun(appVerificationRunId);
    const execution = this.requireWaveStoryExecution(run.waveStoryExecutionId);
    const story = this.requireStory(execution.storyId);
    return {
      run,
      execution,
      story,
      projectAppTestContext: this.parseStoredJson(run.projectAppTestContextJson, "APP_VERIFICATION_CONTEXT_INVALID", "Project app test context"),
      storyContext: this.parseStoredJson(run.storyContextJson, "APP_VERIFICATION_CONTEXT_INVALID", "Story app verification context"),
      preparedSession: this.parseStoredJson(run.preparedSessionJson, "APP_VERIFICATION_CONTEXT_INVALID", "Prepared app verification session"),
      result: this.parseStoredJson(run.resultJson, "APP_VERIFICATION_RESULT_INVALID", "App verification result"),
      artifacts: this.parseStoredJson(run.artifactsJson, "APP_VERIFICATION_ARTIFACTS_INVALID", "App verification artifacts") ?? []
    };
  }

  public async retryAppVerification(appVerificationRunId: string) {
    const run = this.requireAppVerificationRun(appVerificationRunId);
    if (run.status !== "failed" && run.status !== "review_required") {
      throw new AppError("APP_VERIFICATION_RUN_NOT_RETRYABLE", `App verification run ${appVerificationRunId} is not retryable`);
    }
    return this.startAppVerification(run.waveStoryExecutionId);
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
        workspaceKey: this.deps.workspace.key,
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
        const appVerificationRuns = latestExecution
          ? this.deps.appVerificationRunRepository.listByWaveStoryExecutionId(latestExecution.id)
          : [];
        const latestBasicVerification = verificationRuns.filter((run) => run.mode === "basic").at(-1) ?? null;
        const latestRalphVerification = verificationRuns.filter((run) => run.mode === "ralph").at(-1) ?? null;
        const latestAppVerificationRun = appVerificationRuns.at(-1) ?? null;
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
          appVerificationRuns,
          latestBasicVerification,
          latestRalphVerification,
          latestAppVerificationRun,
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
      const appVerification =
        basicVerificationStatus === "passed" && ralphVerification.status === "passed"
          ? await this.executeAppVerification({
              project: input.project,
              implementationPlan: input.implementationPlan,
              wave: input.wave,
              story: input.story,
              storyRunContext,
              execution,
              implementationOutput: parsed
            })
          : null;
      const storyReview =
        basicVerificationStatus === "passed" &&
        ralphVerification.status === "passed" &&
        appVerification?.status === "passed"
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
        appVerification?.status ?? null,
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
            appVerification?.errorMessage ||
            storyReview?.errorMessage ||
            null
        }
      );
      return {
        phase: storyReview ? "story_review" : appVerification ? "app_verification" : "implementation",
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

  private parseAppVerificationOutput(
    appVerificationRun: ReturnType<AppVerificationRunRepository["getLatestByWaveStoryExecutionId"]>
  ): AppVerificationOutput {
    if (!appVerificationRun?.resultJson) {
      throw new AppError("APP_VERIFICATION_OUTPUT_MISSING", "App verification has no stored result");
    }
    return appVerificationOutputSchema.parse(JSON.parse(appVerificationRun.resultJson)) as AppVerificationOutput;
  }

  private parseStoryReviewOutput(
    storyReviewRun: ReturnType<StoryReviewRunRepository["getLatestByWaveStoryExecutionId"]>
  ): StoryReviewOutput {
    if (!storyReviewRun?.summaryJson) {
      throw new AppError("STORY_REVIEW_OUTPUT_MISSING", "Story review has no summary");
    }
    return storyReviewOutputSchema.parse(JSON.parse(storyReviewRun.summaryJson)) as StoryReviewOutput;
  }

  private getDefaultAppTestConfig() {
    return {
      baseUrl: "http://127.0.0.1:3000",
      runnerPreference: ["agent_browser", "playwright"] as AppVerificationRunner[],
      readiness: null,
      auth: {
        strategy: "existing_session" as const,
        defaultRole: "user"
      },
      users: [],
      fixtures: null,
      routes: {} as Record<string, string>,
      featureFlags: {} as Record<string, boolean | string>
    };
  }

  private parseStoredJson<T>(value: string | null, errorCode: string, label: string): T | null {
    if (value === null) {
      return null;
    }
    try {
      return JSON.parse(value) as T;
    } catch (error) {
      throw new AppError(errorCode, `${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private buildProjectAppTestContext(project: ReturnType<WorkflowService["requireProject"]>) {
    const defaults = this.getDefaultAppTestConfig();
    const raw = this.deps.workspaceSettings.appTestConfigJson;
    if (!raw) {
      return {
        projectId: project.id,
        workspaceRoot: this.deps.workspaceRoot,
        ...defaults
      };
    }

    let parsed: z.infer<typeof appTestConfigSchema>;
    try {
      parsed = appTestConfigSchema.parse(JSON.parse(raw));
    } catch (error) {
      throw new AppError(
        "APP_TEST_CONFIG_INVALID",
        `Workspace app test config is invalid: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    return {
      projectId: project.id,
      workspaceRoot: this.deps.workspaceRoot,
      baseUrl: parsed.baseUrl ?? defaults.baseUrl,
      runnerPreference: (parsed.runnerPreference as AppVerificationRunner[] | undefined) ?? defaults.runnerPreference,
      readiness: parsed.readiness ?? defaults.readiness,
      auth: {
        strategy: parsed.auth?.strategy ?? defaults.auth.strategy,
        defaultRole: parsed.auth?.defaultRole ?? defaults.auth.defaultRole
      },
      users: parsed.users ?? defaults.users,
      fixtures: parsed.fixtures ?? defaults.fixtures,
      routes: parsed.routes ?? defaults.routes,
      featureFlags: parsed.featureFlags ?? defaults.featureFlags
    };
  }

  private buildStoryAppVerificationContext(input: {
    execution: ReturnType<WaveStoryExecutionRepository["create"]> | ReturnType<WorkflowService["requireWaveStoryExecution"]>;
    story: ReturnType<WorkflowService["requireStory"]>;
    storyRunContext: ReturnType<WorkflowService["buildStoryRunContext"]>;
    implementationOutput: StoryExecutionOutput;
    projectAppTestContext: ReturnType<WorkflowService["buildProjectAppTestContext"]>;
  }) {
    const startRoute =
      input.projectAppTestContext.routes[input.story.code] ??
      input.projectAppTestContext.routes.default ??
      "/";
    return {
      waveStoryExecutionId: input.execution.id,
      storyId: input.story.id,
      storyTitle: input.story.title,
      summary: input.implementationOutput.summary,
      acceptanceCriteria: input.storyRunContext.acceptanceCriteria.map((criterion) => criterion.text),
      preferredRole: input.projectAppTestContext.auth.defaultRole,
      startRoute,
      changedFiles: input.implementationOutput.changedFiles,
      checks: input.storyRunContext.acceptanceCriteria.map((criterion) => ({
        id: criterion.code,
        description: criterion.text,
        expectedOutcome: `Acceptance criterion ${criterion.code} is satisfied in the app flow.`
      })),
      preconditions: [
        `Base URL ${input.projectAppTestContext.baseUrl} is reachable`,
        `Story ${input.story.code} is available in the running product flow`
      ],
      notes: [
        `Execution summary: ${input.implementationOutput.summary}`,
        `Changed files: ${input.implementationOutput.changedFiles.join(", ") || "none"}`
      ]
    };
  }

  private prepareAppVerificationSession(input: {
    projectAppTestContext: ReturnType<WorkflowService["buildProjectAppTestContext"]>;
    storyAppVerificationContext: ReturnType<WorkflowService["buildStoryAppVerificationContext"]>;
  }) {
    const runner = input.projectAppTestContext.runnerPreference[0] ?? "agent_browser";
    const loginRole = input.storyAppVerificationContext.preferredRole ?? input.projectAppTestContext.auth.defaultRole;
    const loginUser = loginRole
      ? input.projectAppTestContext.users.find((user) => user.role === loginRole) ?? null
      : null;
    const baseUrl = input.projectAppTestContext.baseUrl.replace(/\/+$/, "");
    const route = input.storyAppVerificationContext.startRoute.startsWith("/")
      ? input.storyAppVerificationContext.startRoute
      : `/${input.storyAppVerificationContext.startRoute}`;
    return {
      runner,
      baseUrl: input.projectAppTestContext.baseUrl,
      ready: baseUrl.length > 0,
      ...(loginRole ? { loginRole } : {}),
      ...(loginUser ? { loginUserKey: loginUser.key } : {}),
      resolvedStartUrl: `${baseUrl}${route}`,
      seeded: Boolean(input.projectAppTestContext.fixtures?.seedCommand),
      artifactsDir: "artifacts/app-verification"
    };
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

  private async executeAppVerification(input: {
    project: ReturnType<WorkflowService["requireProject"]>;
    implementationPlan: ReturnType<WorkflowService["requireImplementationPlanForProject"]>;
    wave: ReturnType<WorkflowService["requireWave"]>;
    story: ReturnType<WorkflowService["requireStory"]>;
    storyRunContext: ReturnType<WorkflowService["buildStoryRunContext"]>;
    execution: ReturnType<WaveStoryExecutionRepository["create"]> | ReturnType<WorkflowService["requireWaveStoryExecution"]>;
    implementationOutput: StoryExecutionOutput;
  }): Promise<{ status: "passed" | "review_required" | "failed"; errorMessage: string | null; runId: string }> {
    const resolvedWorkerProfile = this.resolveWorkerProfile("appVerification");
    const previousRuns = this.deps.appVerificationRunRepository.listByWaveStoryExecutionId(input.execution.id);
    const projectAppTestContext = this.buildProjectAppTestContext(input.project);
    const storyAppVerificationContext = this.buildStoryAppVerificationContext({
      execution: input.execution,
      story: input.story,
      storyRunContext: input.storyRunContext,
      implementationOutput: input.implementationOutput,
      projectAppTestContext
    });
    const preparedSession = this.prepareAppVerificationSession({
      projectAppTestContext,
      storyAppVerificationContext
    });
    const startedAt = Date.now();
    const run = this.deps.appVerificationRunRepository.create({
      waveStoryExecutionId: input.execution.id,
      status: "pending",
      runner: preparedSession.runner,
      attempt: previousRuns.length + 1,
      projectAppTestContextJson: null,
      storyContextJson: null,
      preparedSessionJson: null,
      resultJson: null,
      artifactsJson: null,
      failureSummary: null
    });

    try {
      this.deps.appVerificationRunRepository.updateStatus(run.id, "preparing", {
        runner: preparedSession.runner,
        startedAt,
        projectAppTestContextJson: JSON.stringify(projectAppTestContext, null, 2),
        storyContextJson: JSON.stringify(storyAppVerificationContext, null, 2)
      });

      if (!preparedSession.ready) {
        this.deps.appVerificationRunRepository.updateStatus(run.id, "failed", {
          runner: preparedSession.runner,
          startedAt,
          preparedSessionJson: JSON.stringify(preparedSession, null, 2),
          failureSummary: "App verification session could not be prepared."
        });
        return {
          status: "failed",
          errorMessage: "App verification session could not be prepared.",
          runId: run.id
        };
      }

      this.deps.appVerificationRunRepository.updateStatus(run.id, "in_progress", {
        runner: preparedSession.runner,
        startedAt,
        projectAppTestContextJson: JSON.stringify(projectAppTestContext, null, 2),
        storyContextJson: JSON.stringify(storyAppVerificationContext, null, 2),
        preparedSessionJson: JSON.stringify(preparedSession, null, 2)
      });

      const result = await this.deps.adapter.runStoryAppVerification({
        workerRole: "app-verifier",
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
        implementation: input.implementationOutput,
        projectAppTestContext,
        storyAppVerificationContext,
        preparedSession
      });

      const parsed = appVerificationOutputSchema.parse(result.output) as AppVerificationOutput;
      const status = this.resolveAppVerificationStatus(parsed, result.exitCode);
      this.deps.appVerificationRunRepository.updateStatus(run.id, status, {
        runner: parsed.runner,
        startedAt,
        projectAppTestContextJson: JSON.stringify(projectAppTestContext, null, 2),
        storyContextJson: JSON.stringify(storyAppVerificationContext, null, 2),
        preparedSessionJson: JSON.stringify(preparedSession, null, 2),
        resultJson: JSON.stringify(parsed, null, 2),
        artifactsJson: JSON.stringify(parsed.artifacts, null, 2),
        failureSummary: parsed.failureSummary ?? null
      });
      return {
        status,
        errorMessage: status === "failed" ? parsed.failureSummary ?? "App verification failed" : null,
        runId: run.id
      };
    } catch (error) {
      this.deps.appVerificationRunRepository.updateStatus(run.id, "failed", {
        runner: preparedSession.runner,
        startedAt,
        projectAppTestContextJson: JSON.stringify(projectAppTestContext, null, 2),
        storyContextJson: JSON.stringify(storyAppVerificationContext, null, 2),
        preparedSessionJson: JSON.stringify(preparedSession, null, 2),
        failureSummary: error instanceof Error ? error.message : String(error)
      });
      return {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        runId: run.id
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

  private resolveAppVerificationStatus(
    output: AppVerificationOutput,
    exitCode: number
  ): "passed" | "review_required" | "failed" {
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
    appVerificationStatus: AppVerificationRunStatus | null,
    storyReviewStatus: StoryReviewRunStatus | null
  ): VerificationRunStatus {
    if (
      basicStatus === "failed" ||
      ralphStatus === "failed" ||
      appVerificationStatus === "failed" ||
      storyReviewStatus === "failed"
    ) {
      return "failed";
    }
    if (
      basicStatus === "review_required" ||
      ralphStatus === "review_required" ||
      appVerificationStatus === "review_required" ||
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
    workspaceKey: string;
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
        workspaceKey: input.workspaceKey,
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
        workspaceKey: input.workspaceKey,
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

  private requireInteractiveReviewSession(sessionId: string): InteractiveReviewSession {
    const session = this.deps.interactiveReviewSessionRepository.getById(sessionId);
    if (!session) {
      throw new AppError("INTERACTIVE_REVIEW_SESSION_NOT_FOUND", `Interactive review session ${sessionId} not found`);
    }
    return session;
  }

  private requireBrainstormSession(sessionId: string): BrainstormSession {
    const session = this.deps.brainstormSessionRepository.getById(sessionId);
    if (!session) {
      throw new AppError("BRAINSTORM_SESSION_NOT_FOUND", `Brainstorm session ${sessionId} not found`);
    }
    return session;
  }

  private requireBrainstormSessionByItemId(itemId: string): BrainstormSession {
    const session = this.deps.brainstormSessionRepository.getLatestByItemId(itemId);
    if (!session) {
      throw new AppError("BRAINSTORM_SESSION_NOT_FOUND", `No brainstorm session found for item ${itemId}`);
    }
    return session;
  }

  private requireLatestBrainstormDraft(sessionId: string): BrainstormDraft {
    const draft = this.deps.brainstormDraftRepository.getLatestBySessionId(sessionId);
    if (!draft) {
      throw new AppError("BRAINSTORM_DRAFT_NOT_FOUND", `No brainstorm draft found for session ${sessionId}`);
    }
    return draft;
  }

  private assertBrainstormSessionOpen(session: BrainstormSession): void {
    if (session.status === "resolved" || session.status === "cancelled") {
      throw new AppError("BRAINSTORM_SESSION_CLOSED", `Brainstorm session ${session.id} is already closed`);
    }
  }

  private mapBrainstormDraft(draft: BrainstormDraft) {
    return {
      id: draft.id,
      itemId: draft.itemId,
      sessionId: draft.sessionId,
      revision: draft.revision,
      status: draft.status,
      problem: draft.problem,
      targetUsers: JSON.parse(draft.targetUsersJson) as string[],
      coreOutcome: draft.coreOutcome,
      useCases: JSON.parse(draft.useCasesJson) as string[],
      constraints: JSON.parse(draft.constraintsJson) as string[],
      nonGoals: JSON.parse(draft.nonGoalsJson) as string[],
      risks: JSON.parse(draft.risksJson) as string[],
      openQuestions: JSON.parse(draft.openQuestionsJson) as string[],
      candidateDirections: JSON.parse(draft.candidateDirectionsJson) as string[],
      recommendedDirection: draft.recommendedDirection,
      scopeNotes: draft.scopeNotes,
      assumptions: JSON.parse(draft.assumptionsJson) as string[],
      lastUpdatedAt: draft.lastUpdatedAt,
      lastUpdatedFromMessageId: draft.lastUpdatedFromMessageId
    };
  }

  private deriveBrainstormDraftUpdate(previousDraft: BrainstormDraft, message: string): Partial<BrainstormDraft> {
    const view = this.mapBrainstormDraft(previousDraft);
    const normalized = message.trim();
    const targetUsers = [...view.targetUsers];
    const useCases = [...view.useCases];
    const constraints = [...view.constraints];
    const nonGoals = [...view.nonGoals];
    const risks = [...view.risks];
    const openQuestions = [...view.openQuestions];
    const candidateDirections = [...view.candidateDirections];
    const assumptions = [...view.assumptions];
    const labeled = this.parseBrainstormStructuredMessage(normalized);

    const pushUnique = (list: string[], value: string) => {
      if (value && !list.includes(value)) {
        list.push(value);
      }
    };
    const pushMany = (list: string[], values: string[]) => {
      for (const value of values) {
        pushUnique(list, value);
      }
    };

    if (!view.problem) {
      pushUnique(openQuestions, "What problem is most important to solve first?");
    }

    pushMany(targetUsers, labeled.targetUsers);
    pushMany(useCases, labeled.useCases);
    pushMany(constraints, labeled.constraints);
    pushMany(nonGoals, labeled.nonGoals);
    pushMany(risks, labeled.risks);
    pushMany(openQuestions, labeled.openQuestions);
    pushMany(candidateDirections, labeled.candidateDirections);
    pushMany(assumptions, labeled.assumptions);

    const unlabeledLines = labeled.unlabeled;
    for (const line of unlabeledLines) {
      const lineLower = line.toLowerCase();
      if (lineLower.includes("?")) {
        pushUnique(openQuestions, line);
      } else if (
        lineLower.includes("direction") ||
        lineLower.includes("approach") ||
        lineLower.includes("option") ||
        lineLower.includes("should") ||
        lineLower.includes("could")
      ) {
        pushUnique(candidateDirections, line);
      } else if (lineLower.includes("constraint") || lineLower.includes("must") || lineLower.includes("cannot")) {
        pushUnique(constraints, line);
      } else if (lineLower.includes("non-goal") || lineLower.includes("out of scope") || lineLower.startsWith("not ")) {
        pushUnique(nonGoals, line);
      } else if (lineLower.includes("risk") || lineLower.includes("danger")) {
        pushUnique(risks, line);
      } else if (lineLower.includes("assume") || lineLower.includes("likely") || lineLower.includes("probably")) {
        pushUnique(assumptions, line);
      } else if (
        lineLower.includes("user") ||
        lineLower.includes("operator") ||
        lineLower.includes("admin") ||
        lineLower.includes("customer")
      ) {
        pushUnique(targetUsers, line);
      } else {
        pushUnique(useCases, line);
      }
    }

    const nextProblem = labeled.problem ?? view.problem ?? normalized;
    const nextCoreOutcome = labeled.coreOutcome ?? view.coreOutcome ?? (normalized.length > 0 ? normalized : null);
    const nextRecommendedDirection =
      labeled.recommendedDirection ?? view.recommendedDirection ?? (candidateDirections[0] ?? null);
    const nextScopeNotes = this.appendBrainstormScopeNotes(view.scopeNotes, normalized);

    return {
      problem: nextProblem,
      coreOutcome: nextCoreOutcome,
      targetUsersJson: JSON.stringify(this.normalizeBrainstormEntries(targetUsers)),
      useCasesJson: JSON.stringify(this.normalizeBrainstormEntries(useCases)),
      constraintsJson: JSON.stringify(this.normalizeBrainstormEntries(constraints)),
      nonGoalsJson: JSON.stringify(this.normalizeBrainstormEntries(nonGoals)),
      risksJson: JSON.stringify(this.normalizeBrainstormEntries(risks)),
      openQuestionsJson: JSON.stringify(this.normalizeBrainstormEntries(openQuestions)),
      candidateDirectionsJson: JSON.stringify(this.normalizeBrainstormEntries(candidateDirections)),
      recommendedDirection: nextRecommendedDirection,
      assumptionsJson: JSON.stringify(this.normalizeBrainstormEntries(assumptions)),
      scopeNotes: labeled.scopeNotes ?? nextScopeNotes
    };
  }

  private normalizeBrainstormEntries(values: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
      const normalized = value.replace(/\s+/g, " ").trim();
      const dedupeKey = normalized.toLowerCase();
      if (!normalized || seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      result.push(normalized);
    }
    return result;
  }

  private splitBrainstormEntries(value: string): string[] {
    return this.normalizeBrainstormEntries(value.split(/\n|;|,/g));
  }

  private parseBrainstormStructuredMessage(message: string): {
    problem?: string;
    coreOutcome?: string;
    targetUsers: string[];
    useCases: string[];
    constraints: string[];
    nonGoals: string[];
    risks: string[];
    openQuestions: string[];
    candidateDirections: string[];
    recommendedDirection?: string;
    assumptions: string[];
    scopeNotes?: string;
    unlabeled: string[];
  } {
    const result = {
      targetUsers: [],
      useCases: [],
      constraints: [],
      nonGoals: [],
      risks: [],
      openQuestions: [],
      candidateDirections: [],
      assumptions: [],
      unlabeled: []
    } as {
      problem?: string;
      coreOutcome?: string;
      targetUsers: string[];
      useCases: string[];
      constraints: string[];
      nonGoals: string[];
      risks: string[];
      openQuestions: string[];
      candidateDirections: string[];
      recommendedDirection?: string;
      assumptions: string[];
      scopeNotes?: string;
      unlabeled: string[];
    };

    const lines = message
      .split("\n")
      .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
      .filter((line) => line.length > 0);

    for (const line of lines) {
      const match = line.match(/^([a-z ]+):\s*(.+)$/i);
      if (!match) {
        result.unlabeled.push(line);
        continue;
      }
      const label = match[1].trim().toLowerCase();
      const value = match[2].trim();
      if (!value) {
        continue;
      }
      if (label === "problem") {
        result.problem = value;
        continue;
      }
      if (label === "outcome" || label === "core outcome" || label === "goal") {
        result.coreOutcome = value;
        continue;
      }
      if (label === "user" || label === "users" || label === "target user" || label === "target users" || label === "actor") {
        result.targetUsers.push(...this.splitBrainstormEntries(value));
        continue;
      }
      if (label === "use case" || label === "use cases") {
        result.useCases.push(...this.splitBrainstormEntries(value));
        continue;
      }
      if (label === "constraint" || label === "constraints") {
        result.constraints.push(...this.splitBrainstormEntries(value));
        continue;
      }
      if (label === "non-goal" || label === "non-goals") {
        result.nonGoals.push(...this.splitBrainstormEntries(value));
        continue;
      }
      if (label === "risk" || label === "risks") {
        result.risks.push(...this.splitBrainstormEntries(value));
        continue;
      }
      if (label === "question" || label === "questions" || label === "open question" || label === "open questions") {
        result.openQuestions.push(...this.splitBrainstormEntries(value));
        continue;
      }
      if (label === "direction" || label === "directions" || label === "candidate direction" || label === "candidate directions") {
        result.candidateDirections.push(...this.splitBrainstormEntries(value));
        continue;
      }
      if (label === "recommended direction" || label === "recommendation") {
        result.recommendedDirection = value;
        continue;
      }
      if (label === "assumption" || label === "assumptions") {
        result.assumptions.push(...this.splitBrainstormEntries(value));
        continue;
      }
      if (label === "scope notes" || label === "scope") {
        result.scopeNotes = value;
        continue;
      }
      result.unlabeled.push(line);
    }

    return result;
  }

  private appendBrainstormScopeNotes(previous: string | null, message: string): string | null {
    const normalized = message.trim();
    if (!normalized) {
      return previous;
    }
    if (!previous) {
      return normalized;
    }
    return `${previous}\n${normalized}`;
  }

  private computeBrainstormDraftStatus(draft: BrainstormDraft): BrainstormDraftStatus {
    const view = this.mapBrainstormDraft(draft);
    const hasCore = Boolean(view.problem && view.coreOutcome);
    const hasUsers = view.targetUsers.length > 0;
    const hasUseCases = view.useCases.length > 0;
    const hasDirection = Boolean(view.recommendedDirection || view.candidateDirections.length > 0);
    if (hasCore && hasUsers && hasUseCases && hasDirection) {
      return "ready_for_concept";
    }
    return hasCore ? "drafting" : "needs_input";
  }

  private computeBrainstormSessionStatus(draft: BrainstormDraft): BrainstormSessionStatus {
    const status = this.computeBrainstormDraftStatus(draft);
    if (status === "ready_for_concept") {
      return "ready_for_concept";
    }
    return "waiting_for_user";
  }

  private computeBrainstormSessionMode(draft: BrainstormDraft): BrainstormSessionMode {
    const view = this.mapBrainstormDraft(draft);
    if (this.computeBrainstormDraftStatus(draft) === "ready_for_concept") {
      return "converge";
    }
    if (!view.problem || view.targetUsers.length === 0) {
      return "explore";
    }
    if (view.candidateDirections.length > 1) {
      return "compare";
    }
    return "shape";
  }

  private buildBrainstormKickoffMessage(item: { code: string; title: string; description: string }): string {
    return [
      `Interactive brainstorm for ${item.code} is open.`,
      "",
      `Current item: ${item.title}`,
      item.description ? `Description: ${item.description}` : "Description: none provided",
      "",
      "Start by clarifying the core problem, the target users, or the smallest useful outcome."
    ].join("\n");
  }

  private buildBrainstormFollowUpMessage(item: { code: string; title: string }, draft: BrainstormDraft): string {
    const view = this.mapBrainstormDraft(draft);
    const nextQuestion =
      view.targetUsers.length === 0
        ? "Who is the primary user or actor for this item?"
        : view.useCases.length === 0
          ? "What is the first concrete use case we should support?"
          : view.recommendedDirection === null
            ? "Which direction should become the recommended MVP approach?"
            : "The draft is converging. Add any remaining assumptions or promote it to a concept.";
    return [
      `Brainstorm summary for ${item.code}:`,
      `problem=${view.problem ?? "missing"}`,
      `targetUsers=${view.targetUsers.length}`,
      `useCases=${view.useCases.length}`,
      `candidateDirections=${view.candidateDirections.length}`,
      "",
      nextQuestion
    ].join("\n");
  }

  private renderConceptFromBrainstormDraft(
    item: { code: string; title: string; description: string },
    draft: ReturnType<WorkflowService["mapBrainstormDraft"]>
  ): string {
    return [
      `# ${item.title} Concept`,
      "",
      "## Item Code",
      item.code,
      "",
      "## Problem",
      draft.problem ?? item.description,
      "",
      "## Desired Outcome",
      draft.coreOutcome ?? item.title,
      "",
      "## Target Users",
      draft.targetUsers.length > 0 ? draft.targetUsers.map((entry) => `- ${entry}`).join("\n") : "- TBD",
      "",
      "## Use Cases",
      draft.useCases.length > 0 ? draft.useCases.map((entry) => `- ${entry}`).join("\n") : "- TBD",
      "",
      "## Constraints",
      draft.constraints.length > 0 ? draft.constraints.map((entry) => `- ${entry}`).join("\n") : "- None captured",
      "",
      "## Non-Goals",
      draft.nonGoals.length > 0 ? draft.nonGoals.map((entry) => `- ${entry}`).join("\n") : "- None captured",
      "",
      "## Risks",
      draft.risks.length > 0 ? draft.risks.map((entry) => `- ${entry}`).join("\n") : "- None captured",
      "",
      "## Recommended Approach",
      draft.recommendedDirection ?? draft.candidateDirections[0] ?? "Refine during concept review",
      "",
      "## Assumptions",
      draft.assumptions.length > 0 ? draft.assumptions.map((entry) => `- ${entry}`).join("\n") : "- None captured",
      "",
      "## Scope Notes",
      draft.scopeNotes ?? "No additional scope notes captured.",
      ""
    ].join("\n");
  }

  private buildProjectsFromBrainstormDraft(
    item: { title: string },
    draft: ReturnType<WorkflowService["mapBrainstormDraft"]>
  ): { projects: Array<{ title: string; summary: string; goal: string }> } {
    const candidateSeeds = this.normalizeBrainstormEntries([
      ...(draft.recommendedDirection ? [draft.recommendedDirection] : []),
      ...draft.candidateDirections,
      ...draft.useCases
    ]).slice(0, 3);

    if (candidateSeeds.length === 0) {
      candidateSeeds.push(draft.coreOutcome ?? draft.problem ?? item.title);
    }

    return {
      projects: candidateSeeds.map((seed, index) => ({
        title: this.buildBrainstormProjectTitle(item.title, seed, index),
        summary: index === 0 ? draft.problem ?? seed : seed,
        goal:
          candidateSeeds.length === 1
            ? draft.coreOutcome ?? `Deliver the first usable slice for ${item.title}.`
            : `${draft.coreOutcome ?? `Deliver the first usable slice for ${item.title}`}: ${seed}`
      }))
    };
  }

  private buildBrainstormProjectTitle(itemTitle: string, seed: string, index: number): string {
    const cleaned = seed
      .replace(/^(build|create|support|enable|deliver)\s+/i, "")
      .replace(/[.?!].*$/, "")
      .trim();
    if (!cleaned) {
      return `${itemTitle} Track ${index + 1}`;
    }
    const words = cleaned.split(/\s+/).slice(0, 6);
    const title = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
    return title.toLowerCase().startsWith(itemTitle.toLowerCase()) ? title : `${itemTitle} ${title}`;
  }

  private persistManualArtifact(input: {
    item: { id: string };
    sessionScopedId: string;
    kind: string;
    format: "md" | "json";
    content: string;
  }): ArtifactRecord {
    const written = this.artifactService.writeArtifact({
      workspaceKey: this.deps.workspace.key,
      itemId: input.item.id,
      projectId: null,
      stageRunId: input.sessionScopedId,
      kind: input.kind,
      format: input.format,
      content: input.content
    });
    return this.deps.artifactRepository.create({
      stageRunId: null,
      itemId: input.item.id,
      projectId: null,
      kind: input.kind,
      format: input.format,
      path: written.path,
      sha256: written.sha256,
      sizeBytes: written.sizeBytes
    });
  }

  private getStoryReviewScope(session: InteractiveReviewSession) {
    this.assertStoryProjectSession(session);
    const project = this.requireProject(session.scopeId);
    const item = this.requireItem(project.itemId);
    const stories = this.deps.userStoryRepository.listByProjectId(project.id);
    return { item, project, stories };
  }

  private buildStoryReviewKickoffMessage(projectCode: string, stories: Array<{ code: string; title: string; priority: string }>): string {
    const storyLines = stories.map((story) => `- ${story.code}: ${story.title} (${story.priority})`).join("\n");
    return [
      `Story review for ${projectCode} is open.`,
      "",
      "Current scope:",
      storyLines,
      "",
      "Use `review:chat` for feedback, `review:entry:update` for structured per-story status, `review:story:edit` for guided edits, then finish with `review:resolve`."
    ].join("\n");
  }

  private buildStoryReviewFollowUpMessage(
    projectCode: string,
    entries: Array<{ title: string; status: string }>,
    derivedUpdates: Array<{ title: string; status: string }>
  ): string {
    const accepted = entries.filter((entry) => entry.status === "accepted").length;
    const needsRevision = entries.filter((entry) => entry.status === "needs_revision").length;
    const rejected = entries.filter((entry) => entry.status === "rejected").length;
    const pending = entries.filter((entry) => entry.status === "pending").length;
    const updatedLines =
      derivedUpdates.length > 0
        ? derivedUpdates.map((update) => `- ${update.title}: ${update.status}`).join("\n")
        : "- no structured story updates derived automatically";

    return [
      `Story review summary for ${projectCode}:`,
      `accepted=${accepted}, needs_revision=${needsRevision}, rejected=${rejected}, pending=${pending}`,
      "",
      "Latest structured updates:",
      updatedLines,
      "",
      "If needed, refine individual story states with `review:entry:update`, then resolve the session."
    ].join("\n");
  }

  private deriveStoryEntryUpdates(
    stories: Array<{ id: string; code: string; title: string }>,
    message: string
  ): Array<{
    entryId: string;
    title: string;
    status: InteractiveReviewEntryStatus;
    summary: string;
    changeRequest: string | null;
    severity: InteractiveReviewSeverity | null;
  }> {
    const normalized = message.toLowerCase();
    const revisionSignals = ["needs revision", "need revision", "revise", "revision", "change", "fix", "ueberarbeiten"];
    const rejectSignals = ["reject", "rejected", "ablehnen"];
    const approveSignals = ["approve", "approved", "looks good", "ok", "passt", "freigeben"];
    const severitySignals: Array<{ severity: InteractiveReviewSeverity; keywords: string[] }> = [
      { severity: "critical", keywords: ["critical"] },
      { severity: "high", keywords: ["high"] },
      { severity: "medium", keywords: ["medium"] },
      { severity: "low", keywords: ["low"] }
    ];

    const hasPositiveSignal = (signals: string[]): boolean =>
      signals.some((signal) => this.messageIncludesPositiveSignal(normalized, signal));

    const status = hasPositiveSignal(rejectSignals)
      ? "rejected"
      : hasPositiveSignal(revisionSignals)
        ? "needs_revision"
        : hasPositiveSignal(approveSignals)
          ? "accepted"
          : null;

    if (!status) {
      return [];
    }

    const severity = severitySignals.find((candidate) => candidate.keywords.some((keyword) => normalized.includes(keyword)))?.severity ?? null;
    const matchedStories = stories.filter(
      (story) => normalized.includes(story.code.toLowerCase()) || normalized.includes(story.title.toLowerCase())
    );

    // v1 heuristic: story targeting still relies on code/title substring matches.
    // Keep this explicit until entries are updated from structured UI selections.
    return matchedStories.map((story) => ({
      entryId: story.id,
      title: `${story.code} ${story.title}`,
      status,
      summary: this.buildDerivedStoryEntrySummary(status),
      changeRequest:
        status === "needs_revision" || status === "rejected"
          ? this.buildDerivedStoryEntryChangeRequest(story.code, message, matchedStories.length)
          : null,
      severity
    }));
  }

  private computeInteractiveReviewStatus(entries: Array<{ status: string }>): "waiting_for_user" | "ready_for_resolution" {
    return entries.length > 0 && entries.every((entry) => entry.status !== "pending") ? "ready_for_resolution" : "waiting_for_user";
  }

  private resolveInteractiveReviewStoryIds(projectId: string, storyIds: string[]): string[] {
    const uniqueStoryIds = Array.from(new Set(storyIds));
    const projectStoryIds = new Set(this.deps.userStoryRepository.listByProjectId(projectId).map((story) => story.id));
    for (const storyId of uniqueStoryIds) {
      if (!projectStoryIds.has(storyId)) {
        throw new AppError("STORY_NOT_FOUND", `Story ${storyId} not found in review scope`);
      }
    }
    return uniqueStoryIds;
  }

  private maybeAdvanceAfterPartialStoryApproval(projectId: string): void {
    const project = this.requireProject(projectId);
    const snapshot = this.buildSnapshot(project.itemId);
    if (!snapshot.allStoriesApproved) {
      return;
    }
    const item = this.requireItem(project.itemId);
    assertCanMoveItem(item.currentColumn, "implementation", snapshot);
    this.deps.itemRepository.updateColumn(project.itemId, "implementation", "draft");
  }

  private assertInteractiveReviewOpen(session: InteractiveReviewSession): void {
    if (session.status === "resolved" || session.status === "cancelled") {
      throw new AppError("INTERACTIVE_REVIEW_CLOSED", `Interactive review session ${session.id} is already closed`);
    }
  }

  private assertStoryProjectSession(session: InteractiveReviewSession): void {
    if (session.scopeType !== "project" || session.artifactType !== "stories") {
      throw new AppError("INTERACTIVE_REVIEW_TYPE_NOT_SUPPORTED", "Session is not a story review");
    }
  }

  private assertInteractiveReviewEntryStatus(status: string): asserts status is InteractiveReviewEntryStatus {
    if (!(interactiveReviewEntryStatuses as readonly string[]).includes(status)) {
      throw new AppError("INTERACTIVE_REVIEW_ENTRY_STATUS_INVALID", `Interactive review entry status ${status} is invalid`);
    }
  }

  private assertInteractiveReviewSeverity(severity?: string): asserts severity is InteractiveReviewSeverity | undefined {
    if (severity !== undefined && !(interactiveReviewSeverities as readonly string[]).includes(severity)) {
      throw new AppError("INTERACTIVE_REVIEW_SEVERITY_INVALID", `Interactive review severity ${severity} is invalid`);
    }
  }

  private assertInteractiveReviewResolutionAction(
    action: string
  ): asserts action is (typeof supportedInteractiveReviewResolutionActions)[number] {
    if (!(supportedInteractiveReviewResolutionActions as readonly string[]).includes(action)) {
      throw new AppError("INTERACTIVE_REVIEW_ACTION_INVALID", `Interactive review action ${action} is invalid`);
    }
  }

  private messageIncludesPositiveSignal(message: string, signal: string): boolean {
    const escapedSignal = this.escapeRegExp(signal);
    const negativePrefixes = ["do not", "don't", "dont", "no", "not", "never", "avoid", "skip"];
    if (negativePrefixes.some((prefix) => new RegExp(`\\b${this.escapeRegExp(prefix)}\\s+${escapedSignal}\\b`).test(message))) {
      return false;
    }
    return new RegExp(`\\b${escapedSignal}\\b`).test(message);
  }

  private buildDerivedStoryEntrySummary(status: InteractiveReviewEntryStatus): string {
    switch (status) {
      case "accepted":
        return "Accepted from review chat";
      case "needs_revision":
        return "Revision requested from review chat";
      case "rejected":
        return "Rejected from review chat";
      case "resolved":
        return "Resolved from review chat";
      default:
        return "Updated from review chat";
    }
  }

  private buildDerivedStoryEntryChangeRequest(storyCode: string, message: string, matchCount: number): string {
    if (matchCount === 1) {
      return message;
    }
    return `Shared review feedback requested changes affecting ${storyCode}. Inspect the session chat for the full combined message.`;
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private requireItem(itemId: string) {
    const item = this.deps.itemRepository.getById(itemId);
    if (!item) {
      throw new AppError("ITEM_NOT_FOUND", `Item ${itemId} not found`);
    }
    if (item.workspaceId !== this.deps.workspace.id) {
      throw new AppError("ITEM_NOT_FOUND", `Item ${itemId} not found in workspace ${this.deps.workspace.key}`);
    }
    return item;
  }

  private requireProject(projectId: string) {
    const project = this.deps.projectRepository.getById(projectId);
    if (!project) {
      throw new AppError("PROJECT_NOT_FOUND", `Project ${projectId} not found`);
    }
    this.requireItem(project.itemId);
    return project;
  }

  private requireStory(storyId: string) {
    const story = this.deps.userStoryRepository.getById(storyId);
    if (!story) {
      throw new AppError("STORY_NOT_FOUND", `Story ${storyId} not found`);
    }
    this.requireProject(story.projectId);
    return story;
  }

  private requireAcceptanceCriterion(acceptanceCriterionId: string) {
    const acceptanceCriterion = this.deps.acceptanceCriterionRepository.getById(acceptanceCriterionId);
    if (!acceptanceCriterion) {
      throw new AppError("ACCEPTANCE_CRITERION_NOT_FOUND", `Acceptance criterion ${acceptanceCriterionId} not found`);
    }
    this.requireStory(acceptanceCriterion.storyId);
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
    this.requireStory(waveStory.storyId);
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

  private requireAppVerificationRun(appVerificationRunId: string): AppVerificationRun {
    const appVerificationRun = this.deps.appVerificationRunRepository.getById(appVerificationRunId);
    if (!appVerificationRun) {
      throw new AppError("APP_VERIFICATION_RUN_NOT_FOUND", `App verification run ${appVerificationRunId} not found`);
    }
    return appVerificationRun;
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
