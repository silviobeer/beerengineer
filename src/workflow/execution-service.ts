import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { storyExecutionOutputSchema, testPreparationOutputSchema } from "../schemas/output-contracts.js";
import type { StoryExecutionOutput, TestPreparationOutput } from "../schemas/output-contracts.js";
import { AppError } from "../shared/errors.js";
import type { AdapterRuntimeContext, AgentAdapter } from "../adapters/types.js";
import type { ExecutionWorkerRole, GitBranchMetadata } from "../domain/types.js";
import type {
  AcceptanceCriterionRepository,
  AppVerificationRunRepository,
  ArchitecturePlanRepository,
  ProjectRepository,
  ProjectExecutionContextRepository,
  StoryReviewRunRepository,
  TestAgentSessionRepository,
  UserStoryRepository,
  VerificationRunRepository,
  WaveExecutionRepository,
  WaveRepository,
  WaveStoryExecutionRepository,
  WaveStoryRepository,
  WaveStoryTestRunRepository
} from "../persistence/repositories.js";
import type { WorkerProfileKey } from "./worker-profiles.js";
import type { WorkflowDeps } from "./workflow-deps.js";
import type { WorkflowEntityLoaders } from "./entity-loaders.js";
import { resolveCompactExecutionStoryPhase, resolveCompactExecutionStoryStatus } from "./status-resolution.js";

type RetryWaveStoryExecutionResult =
  | {
      phase: "test_preparation";
      waveStoryTestRunId: string;
      waveStoryId: string;
      storyCode: string;
      status: "review_required" | "failed" | "completed";
    }
  | {
      phase: "implementation" | "app_verification" | "story_review";
      waveStoryExecutionId: string;
      waveStoryId: string;
      storyCode: string;
      status: string;
    };

export type ExecutionViewStory = {
  waveStory: ReturnType<WaveStoryRepository["getById"]> extends infer T ? Exclude<T, null> : never;
  story: ReturnType<UserStoryRepository["getById"]> extends infer T ? Exclude<T, null> : never;
  latestTestRun: ReturnType<WaveStoryTestRunRepository["getLatestByWaveStoryId"]>;
  latestExecution: ReturnType<WaveStoryExecutionRepository["getLatestByWaveStoryId"]>;
  blockers: string[];
  testAgentSessions: ReturnType<TestAgentSessionRepository["listByWaveStoryTestRunId"]>;
  verificationRuns: ReturnType<VerificationRunRepository["listByWaveStoryExecutionId"]>;
  appVerificationRuns: ReturnType<AppVerificationRunRepository["listByWaveStoryExecutionId"]>;
  latestBasicVerification: ReturnType<VerificationRunRepository["getLatestByWaveStoryExecutionIdAndMode"]>;
  latestRalphVerification: ReturnType<VerificationRunRepository["getLatestByWaveStoryExecutionIdAndMode"]>;
  latestAppVerificationRun: ReturnType<AppVerificationRunRepository["getLatestByWaveStoryExecutionId"]>;
  latestStoryReviewRun: ReturnType<StoryReviewRunRepository["getLatestByWaveStoryExecutionId"]>;
  latestStoryReviewFindings: ReturnType<WorkflowDeps["storyReviewFindingRepository"]["listByStoryReviewRunId"]>;
  latestStoryReviewRemediationRun: ReturnType<WorkflowDeps["storyReviewRemediationRunRepository"]["listByStoryId"]>[number] | null;
  storyReviewRemediationRuns: Array<{
    remediationRun: ReturnType<WorkflowDeps["storyReviewRemediationRunRepository"]["listByStoryId"]>[number];
    selectedFindings: ReturnType<WorkflowDeps["storyReviewRemediationFindingRepository"]["listByRunId"]>;
    sessions: ReturnType<WorkflowDeps["storyReviewRemediationAgentSessionRepository"]["listByRunId"]>;
  }>;
  agentSessions: ReturnType<WorkflowDeps["executionAgentSessionRepository"]["listByWaveStoryExecutionId"]>;
  storyReviewAgentSessions: ReturnType<WorkflowDeps["storyReviewAgentSessionRepository"]["listByStoryReviewRunId"]>;
};

export type ExecutionViewWave = {
  wave: ReturnType<WaveRepository["getById"]> extends infer T ? Exclude<T, null> : never;
  waveExecution: ReturnType<WaveExecutionRepository["getLatestByWaveId"]>;
  stories: ExecutionViewStory[];
};

export type ExecutionView = {
  project: ReturnType<ProjectRepository["getById"]> extends infer T ? Exclude<T, null> : never;
  implementationPlan: ReturnType<WorkflowDeps["implementationPlanRepository"]["getLatestByProjectId"]> extends infer T ? Exclude<T, null> : never;
  projectExecutionContext: ReturnType<ProjectExecutionContextRepository["getByProjectId"]>;
  activeWave: ExecutionViewWave["wave"] | null;
  waves: ExecutionViewWave[];
};

type ExecutionServiceOptions = {
  deps: WorkflowDeps;
  loaders: Pick<
    WorkflowEntityLoaders,
    | "requireProject"
    | "requireItem"
    | "requireImplementationPlanForProject"
    | "requireWave"
    | "requireWaveExecution"
    | "requireWaveStory"
    | "requireWaveStoryByStoryId"
    | "requireWaveStoryExecution"
    | "requireWaveStoryTestRun"
    | "requireStory"
  >;
  resolveWorkerProfile(profileKey: WorkerProfileKey): {
    promptContent: string;
    skills: Array<{ path: string; content: string }>;
  };
  resolveWorkerRuntime(profileKey: WorkerProfileKey): {
    providerKey: string;
    adapterKey: string;
    model: string | null;
    policy: AdapterRuntimeContext["policy"];
    adapter: AgentAdapter;
  };
  buildAdapterRuntimeContext(input: {
    providerKey: string;
    model: string | null;
    policy: AdapterRuntimeContext["policy"];
  }): AdapterRuntimeContext;
  ensureProjectBranch(projectCode: string): void;
  ensureStoryBranch(projectCode: string, storyCode: string): GitBranchMetadata;
  executeVerificationPipeline(input: {
    project: ReturnType<WorkflowEntityLoaders["requireProject"]>;
    implementationPlan: ReturnType<WorkflowEntityLoaders["requireImplementationPlanForProject"]>;
    wave: ReturnType<WorkflowEntityLoaders["requireWave"]>;
    waveExecution: ReturnType<WorkflowEntityLoaders["requireWaveExecution"]>;
    story: ReturnType<WorkflowEntityLoaders["requireStory"]>;
    storyRunContext: ReturnType<ExecutionService["buildStoryRunContext"]>;
    testPreparationRun: ReturnType<WorkflowEntityLoaders["requireWaveStoryTestRun"]>;
    parsedTestPreparation: TestPreparationOutput;
    execution: ReturnType<WaveStoryExecutionRepository["create"]>;
    implementationOutput: StoryExecutionOutput;
  }): Promise<{
    ralphVerification: { errorMessage: string | null };
    appVerification: { errorMessage: string | null } | null;
    storyReview: { errorMessage: string | null } | null;
    finalExecutionStatus: "passed" | "review_required" | "failed";
  }>;
};

export class ExecutionService {
  public constructor(private readonly options: ExecutionServiceOptions) {}

  public async startExecution(projectId: string) {
    return this.advanceExecution(projectId);
  }

  public async tickExecution(projectId: string) {
    return this.advanceExecution(projectId);
  }

  public async retryWaveStoryExecution(waveStoryExecutionId: string): Promise<RetryWaveStoryExecutionResult> {
    const previous = this.options.deps.waveStoryExecutionRepository.getById(waveStoryExecutionId);
    if (!previous) {
      throw new AppError("WAVE_STORY_EXECUTION_NOT_FOUND", `Wave story execution ${waveStoryExecutionId} not found`);
    }
    if (previous.status !== "failed" && previous.status !== "review_required") {
      throw new AppError("WAVE_STORY_EXECUTION_NOT_RETRYABLE", "Wave story execution is not retryable");
    }

    const waveStory = this.options.loaders.requireWaveStory(previous.waveStoryId);
    const waveExecution = this.options.loaders.requireWaveExecution(previous.waveExecutionId);
    const story = this.options.loaders.requireStory(previous.storyId);
    const project = this.options.loaders.requireProject(story.projectId);
    const plan = this.options.loaders.requireImplementationPlanForProject(project.id);
    const wave = this.options.loaders.requireWave(waveExecution.waveId);
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
      return testRun;
    }
    const gitMetadata = this.options.ensureStoryBranch(project.code, story.code);
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

  public showExecution(projectId: string): ExecutionView {
    const project = this.options.loaders.requireProject(projectId);
    const plan = this.options.loaders.requireImplementationPlanForProject(projectId);
    const context = this.options.deps.projectExecutionContextRepository.getByProjectId(projectId);
    const waves = this.options.deps.waveRepository.listByImplementationPlanId(plan.id);
    const wavePayload = waves.map((wave) => {
      const waveExecution = this.options.deps.waveExecutionRepository.getLatestByWaveId(wave.id);
      const waveStories = this.options.deps.waveStoryRepository.listByWaveId(wave.id);
      const storyExecutions = waveStories.map((waveStory) => {
        const story = this.options.loaders.requireStory(waveStory.storyId);
        const latestTestRun = this.options.deps.waveStoryTestRunRepository.getLatestByWaveStoryId(waveStory.id);
        const latestExecution = this.options.deps.waveStoryExecutionRepository.getLatestByWaveStoryId(waveStory.id);
        const verificationRuns = latestExecution
          ? this.options.deps.verificationRunRepository.listByWaveStoryExecutionId(latestExecution.id)
          : [];
        const appVerificationRuns = latestExecution
          ? this.options.deps.appVerificationRunRepository.listByWaveStoryExecutionId(latestExecution.id)
          : [];
        const latestBasicVerification = verificationRuns.filter((run) => run.mode === "basic").at(-1) ?? null;
        const latestRalphVerification = verificationRuns.filter((run) => run.mode === "ralph").at(-1) ?? null;
        const latestAppVerificationRun = appVerificationRuns.at(-1) ?? null;
        const latestStoryReviewRun = latestExecution
          ? this.options.deps.storyReviewRunRepository.getLatestByWaveStoryExecutionId(latestExecution.id)
          : null;
        const remediationRuns = this.options.deps.storyReviewRemediationRunRepository.listByStoryId(story.id);
        const blockers = this.options.deps.waveStoryDependencyRepository
          .listByDependentStoryId(story.id)
          .map((dependency) => this.options.loaders.requireStory(dependency.blockingStoryId))
          .filter((blockingStory) => {
            const blockingWaveStory = this.options.loaders.requireWaveStoryByStoryId(blockingStory.id);
            const blockingExecution = this.options.deps.waveStoryExecutionRepository.getLatestByWaveStoryId(blockingWaveStory.id);
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
            ? this.options.deps.testAgentSessionRepository.listByWaveStoryTestRunId(latestTestRun.id)
            : [],
          verificationRuns,
          appVerificationRuns,
          latestBasicVerification,
          latestRalphVerification,
          latestAppVerificationRun,
          latestStoryReviewRun,
          latestStoryReviewFindings: latestStoryReviewRun
            ? this.options.deps.storyReviewFindingRepository.listByStoryReviewRunId(latestStoryReviewRun.id)
            : [],
          latestStoryReviewRemediationRun: remediationRuns.at(-1) ?? null,
          storyReviewRemediationRuns: remediationRuns.map((remediationRun) => ({
            remediationRun,
            selectedFindings: this.options.deps.storyReviewRemediationFindingRepository.listByRunId(remediationRun.id),
            sessions: this.options.deps.storyReviewRemediationAgentSessionRepository.listByRunId(remediationRun.id)
          })),
          agentSessions: latestExecution
            ? this.options.deps.executionAgentSessionRepository.listByWaveStoryExecutionId(latestExecution.id)
            : [],
          storyReviewAgentSessions: latestStoryReviewRun
            ? this.options.deps.storyReviewAgentSessionRepository.listByStoryReviewRunId(latestStoryReviewRun.id)
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

  public showExecutionCompact(projectId: string) {
    const execution = this.showExecution(projectId);
    const waves = execution.waves.map((waveEntry) => {
      const stories = waveEntry.stories.map((storyEntry) => {
        const lastUpdatedAt = [
          storyEntry.latestTestRun?.updatedAt ?? 0,
          storyEntry.latestExecution?.updatedAt ?? 0,
          storyEntry.latestAppVerificationRun?.updatedAt ?? 0,
          storyEntry.latestStoryReviewRun?.updatedAt ?? 0
        ].reduce((latest, current) => Math.max(latest, current), 0);
        return {
          storyId: storyEntry.story.id,
          storyCode: storyEntry.story.code,
          title: storyEntry.story.title,
          status: resolveCompactExecutionStoryStatus(storyEntry),
          lastPhase: resolveCompactExecutionStoryPhase(storyEntry),
          blockers: storyEntry.blockers,
          lastError:
            storyEntry.latestStoryReviewRun?.errorMessage ??
            storyEntry.latestAppVerificationRun?.failureSummary ??
            storyEntry.latestExecution?.errorMessage ??
            storyEntry.latestTestRun?.errorMessage ??
            null,
          lastUpdatedAt: lastUpdatedAt > 0 ? lastUpdatedAt : null
        };
      });
      return {
        waveId: waveEntry.wave.id,
        waveCode: waveEntry.wave.code,
        goal: waveEntry.wave.goal,
        status: waveEntry.waveExecution?.status ?? "pending",
        storyCount: stories.length,
        completedStoryCount: stories.filter((story) => story.status === "completed").length,
        stories
      };
    });

    return {
      project: {
        id: execution.project.id,
        code: execution.project.code,
        title: execution.project.title
      },
      implementationPlan: {
        id: execution.implementationPlan.id,
        version: execution.implementationPlan.version,
        status: execution.implementationPlan.status
      },
      activeWaveCode: execution.activeWave?.code ?? null,
      overallStatus: this.resolveCompactExecutionOverallStatus(waves),
      waves
    };
  }

  public showExecutionLogs(input: { projectId: string; storyCode: string }) {
    const project = this.options.loaders.requireProject(input.projectId);
    const story = this.options.deps
      .userStoryRepository.listByProjectId(project.id)
      .find((candidate) => candidate.code === input.storyCode);
    if (!story) {
      throw new AppError("STORY_NOT_FOUND", `Story ${input.storyCode} not found in project ${project.code}`);
    }
    const waveStory = this.options.loaders.requireWaveStoryByStoryId(story.id);
    const wave = this.options.loaders.requireWave(waveStory.waveId);
    const latestTestRun = this.options.deps.waveStoryTestRunRepository.getLatestByWaveStoryId(waveStory.id);
    const latestExecution = this.options.deps.waveStoryExecutionRepository.getLatestByWaveStoryId(waveStory.id);
    const latestStoryReviewRun = latestExecution
      ? this.options.deps.storyReviewRunRepository.getLatestByWaveStoryExecutionId(latestExecution.id)
      : null;

    return {
      project: {
        id: project.id,
        code: project.code,
        title: project.title
      },
      wave: {
        id: wave.id,
        code: wave.code,
        goal: wave.goal
      },
      story: {
        id: story.id,
        code: story.code,
        title: story.title
      },
      latestTestPreparation: latestTestRun
        ? {
            run: latestTestRun,
            sessions: this.options.deps.testAgentSessionRepository.listByWaveStoryTestRunId(latestTestRun.id)
          }
        : null,
      latestExecution: latestExecution
        ? {
            run: latestExecution,
            sessions: this.options.deps.executionAgentSessionRepository.listByWaveStoryExecutionId(latestExecution.id),
            verificationRuns: this.options.deps.verificationRunRepository.listByWaveStoryExecutionId(latestExecution.id),
            appVerificationRuns: this.options.deps.appVerificationRunRepository.listByWaveStoryExecutionId(latestExecution.id)
          }
        : null,
      latestStoryReview: latestStoryReviewRun
        ? {
            run: latestStoryReviewRun,
            findings: this.options.deps.storyReviewFindingRepository.listByStoryReviewRunId(latestStoryReviewRun.id),
            sessions: this.options.deps.storyReviewAgentSessionRepository.listByStoryReviewRunId(latestStoryReviewRun.id)
          }
        : null
    };
  }

  public ensureProjectExecutionContext(
    project: ReturnType<WorkflowEntityLoaders["requireProject"]>,
    implementationPlan: ReturnType<WorkflowEntityLoaders["requireImplementationPlanForProject"]>
  ) {
    const existing = this.options.deps.projectExecutionContextRepository.getByProjectId(project.id);
    const architecture = this.options.deps.architecturePlanRepository.getLatestByProjectId(project.id);
    const relevantDirectories = ["src", "test", "docs"].filter((directory) =>
      existsSync(resolve(this.options.deps.repoRoot, directory))
    );
    const relevantFiles = ["README.md", "AGENTS.md", "docs/architecture.md"].filter((filePath) =>
      existsSync(resolve(this.options.deps.repoRoot, filePath))
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

    return this.options.deps.projectExecutionContextRepository.upsert({
      projectId: project.id,
      relevantDirectories,
      relevantFiles,
      integrationPoints,
      testLocations,
      repoConventions,
      executionNotes
    });
  }

  public refreshWaveExecutionStatus(waveExecutionId: string): void {
    const waveExecution = this.options.loaders.requireWaveExecution(waveExecutionId);
    const waveStories = this.options.deps.waveStoryRepository.listByWaveId(waveExecution.waveId);
    const latestTestRuns = waveStories.map((waveStory) => this.options.deps.waveStoryTestRunRepository.getLatestByWaveStoryId(waveStory.id));
    const latestStoryExecutions = waveStories.map((waveStory) =>
      this.options.deps.waveStoryExecutionRepository.getLatestByWaveStoryId(waveStory.id)
    );
    const latestRalphRuns = latestStoryExecutions.map((execution) =>
      execution ? this.options.deps.verificationRunRepository.getLatestByWaveStoryExecutionIdAndMode(execution.id, "ralph") : null
    );
    const latestStoryReviewRuns = latestStoryExecutions.map((execution) =>
      execution ? this.options.deps.storyReviewRunRepository.getLatestByWaveStoryExecutionId(execution.id) : null
    );

    if (
      latestTestRuns.some((testRun) => testRun?.status === "failed") ||
      latestStoryExecutions.some((execution) => execution?.status === "failed") ||
      latestStoryReviewRuns.some((reviewRun) => reviewRun?.status === "failed")
    ) {
      this.options.deps.waveExecutionRepository.updateStatus(waveExecutionId, "failed");
      return;
    }
    if (
      latestTestRuns.some((testRun) => testRun?.status === "review_required") ||
      latestStoryExecutions.some((execution) => execution?.status === "review_required") ||
      latestStoryReviewRuns.some((reviewRun) => reviewRun?.status === "review_required")
    ) {
      this.options.deps.waveExecutionRepository.updateStatus(waveExecutionId, "review_required");
      return;
    }
    if (
      latestStoryExecutions.length > 0 &&
      latestTestRuns.every((testRun) => testRun?.status === "completed") &&
      latestStoryExecutions.every((execution) => execution?.status === "completed") &&
      latestRalphRuns.every((run) => run?.status === "passed") &&
      latestStoryReviewRuns.every((run) => run?.status === "passed")
    ) {
      this.options.deps.waveExecutionRepository.updateStatus(waveExecutionId, "completed");
      return;
    }
    if (
      latestTestRuns.some((testRun) => testRun?.status === "running") ||
      latestStoryExecutions.some((execution) => execution?.status === "running") ||
      latestStoryReviewRuns.some((reviewRun) => reviewRun?.status === "running")
    ) {
      this.options.deps.waveExecutionRepository.updateStatus(waveExecutionId, "running");
      return;
    }
    this.options.deps.waveExecutionRepository.updateStatus(waveExecutionId, "blocked");
  }

  public buildStoryRunContext(input: {
    project: ReturnType<WorkflowEntityLoaders["requireProject"]>;
    implementationPlan: ReturnType<WorkflowEntityLoaders["requireImplementationPlanForProject"]>;
    wave: ReturnType<WorkflowEntityLoaders["requireWave"]>;
    story: ReturnType<WorkflowEntityLoaders["requireStory"]>;
    projectExecutionContext?: ReturnType<ExecutionService["ensureProjectExecutionContext"]>;
  }) {
    const item = this.options.loaders.requireItem(input.project.itemId);
    const architecture = this.options.deps.architecturePlanRepository.getLatestByProjectId(input.project.id);
    const acceptanceCriteria = this.options.deps.acceptanceCriterionRepository.listByStoryId(input.story.id);
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

  public parseTestPreparationOutput(
    testRun: ReturnType<WorkflowEntityLoaders["requireWaveStoryTestRun"]>
  ): TestPreparationOutput {
    if (!testRun.outputSummaryJson) {
      throw new AppError("TEST_RUN_OUTPUT_MISSING", `Test run ${testRun.id} has no output summary`);
    }
    return testPreparationOutputSchema.parse(JSON.parse(testRun.outputSummaryJson)) as TestPreparationOutput;
  }

  public parseStoryExecutionOutput(
    execution: ReturnType<WorkflowEntityLoaders["requireWaveStoryExecution"]>
  ): StoryExecutionOutput {
    if (!execution.outputSummaryJson) {
      throw new AppError("EXECUTION_OUTPUT_MISSING", `Execution ${execution.id} has no output summary`);
    }
    return storyExecutionOutputSchema.parse(JSON.parse(execution.outputSummaryJson)) as StoryExecutionOutput;
  }

  public async executeWaveStory(input: {
    project: ReturnType<WorkflowEntityLoaders["requireProject"]>;
    implementationPlan: ReturnType<WorkflowEntityLoaders["requireImplementationPlanForProject"]>;
    wave: ReturnType<WorkflowEntityLoaders["requireWave"]>;
    waveExecution: ReturnType<WorkflowEntityLoaders["requireWaveExecution"]>;
    waveStory: ReturnType<WorkflowEntityLoaders["requireWaveStory"]>;
    story: ReturnType<WorkflowEntityLoaders["requireStory"]>;
    projectExecutionContext?: ReturnType<ExecutionService["ensureProjectExecutionContext"]>;
    testPreparationRunId: string;
    workerProfileKey?: WorkerProfileKey;
    workerRoleOverride?: ExecutionWorkerRole;
    gitMetadata?: GitBranchMetadata | null;
  }) {
    const resolvedWorkerProfile = this.options.resolveWorkerProfile(input.workerProfileKey ?? "execution");
    const runtime = this.options.resolveWorkerRuntime(input.workerProfileKey ?? "execution");
    const storyRunContext = this.buildStoryRunContext({
      project: input.project,
      implementationPlan: input.implementationPlan,
      wave: input.wave,
      story: input.story,
      projectExecutionContext: input.projectExecutionContext
    });
    const testPreparationRun = this.options.loaders.requireWaveStoryTestRun(input.testPreparationRunId);
    const parsedTestPreparation = this.parseTestPreparationOutput(testPreparationRun);
    const workerRole = input.workerRoleOverride ?? this.selectWorkerRole(input.story, storyRunContext.acceptanceCriteria);
    const previousAttempts = this.options.deps.waveStoryExecutionRepository.listByWaveStoryId(input.waveStory.id);
    const execution = this.options.deps.waveStoryExecutionRepository.create({
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
      const result = await runtime.adapter.runStoryExecution({
        runtime: this.options.buildAdapterRuntimeContext(runtime),
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
      this.options.deps.executionAgentSessionRepository.create({
        waveStoryExecutionId: execution.id,
        adapterKey: runtime.adapterKey,
        status: result.exitCode === 0 ? "completed" : "failed",
        commandJson: JSON.stringify(result.command),
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode
      });

      const verification = await this.options.executeVerificationPipeline({
        project: input.project,
        implementationPlan: input.implementationPlan,
        wave: input.wave,
        waveExecution: input.waveExecution,
        story: input.story,
        storyRunContext,
        testPreparationRun,
        parsedTestPreparation,
        execution,
        implementationOutput: parsed
      });
      const outputSummaryJson = JSON.stringify(parsed, null, 2);
      this.options.deps.waveStoryExecutionRepository.updateStatus(
        execution.id,
        verification.finalExecutionStatus === "passed" ? "completed" : verification.finalExecutionStatus,
        {
          outputSummaryJson,
          gitMetadata: input.gitMetadata ?? null,
          errorMessage:
            parsed.blockers.join("; ") ||
            verification.ralphVerification.errorMessage ||
            verification.appVerification?.errorMessage ||
            verification.storyReview?.errorMessage ||
            null
        }
      );
      return {
        phase: verification.storyReview ? "story_review" : verification.appVerification ? "app_verification" : "implementation",
        waveStoryExecutionId: execution.id,
        waveStoryId: input.waveStory.id,
        storyCode: input.story.code,
        status: verification.finalExecutionStatus === "passed" ? "completed" : verification.finalExecutionStatus
      };
    } catch (error) {
      this.options.deps.executionAgentSessionRepository.create({
        waveStoryExecutionId: execution.id,
        adapterKey: runtime.adapterKey,
        status: "failed",
        commandJson: JSON.stringify([]),
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1
      });
      this.options.deps.verificationRunRepository.create({
        waveExecutionId: input.waveExecution.id,
        waveStoryExecutionId: execution.id,
        mode: "basic",
        status: "failed",
        systemPromptSnapshot: null,
        skillsSnapshotJson: null,
        summaryJson: JSON.stringify({ changedFiles: [], testsRun: [], blockers: [] }, null, 2),
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      this.options.deps.verificationRunRepository.create({
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
      this.options.deps.waveStoryExecutionRepository.updateStatus(execution.id, "failed", {
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

  private async advanceExecution(projectId: string) {
    const project = this.options.loaders.requireProject(projectId);
    this.options.ensureProjectBranch(project.code);
    const implementationPlan = this.options.loaders.requireImplementationPlanForProject(projectId);
    const waves = this.options.deps.waveRepository.listByImplementationPlanId(implementationPlan.id);
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
      if (this.canRetryFailedWaveExecutionFromTestPreparation(waveExecution.id)) {
        this.options.deps.waveExecutionRepository.updateStatus(waveExecution.id, "running");
      } else {
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
    }
    const activeWaveExecution = this.options.loaders.requireWaveExecution(waveExecution.id);
    if (activeWaveExecution.status === "failed") {
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
      const story = this.options.loaders.requireStory(waveStory.storyId);
      const gitMetadata = this.options.ensureStoryBranch(project.code, story.code);
      const testRun = await this.ensureWaveStoryTestPreparation({
        project,
        implementationPlan,
        wave: activeWave,
        waveExecution: activeWaveExecution,
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
        waveExecution: activeWaveExecution,
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

  private resolveCompactExecutionOverallStatus(
    waves: Array<{
      status: string;
      stories: Array<{ status: string }>;
    }>
  ): "completed" | "running" | "review_required" | "failed" | "pending" {
    if (waves.length > 0 && waves.every((wave) => wave.status === "completed")) {
      return "completed";
    }
    if (waves.some((wave) => wave.status === "failed" || wave.stories.some((story) => story.status === "failed"))) {
      return "failed";
    }
    if (waves.some((wave) => wave.status === "review_required" || wave.stories.some((story) => story.status === "review_required"))) {
      return "review_required";
    }
    if (waves.some((wave) => wave.status === "running" || wave.stories.some((story) => story.status === "running"))) {
      return "running";
    }
    return "pending";
  }

  private canRetryFailedWaveExecutionFromTestPreparation(waveExecutionId: string): boolean {
    const waveExecution = this.options.loaders.requireWaveExecution(waveExecutionId);
    const waveStories = this.options.deps.waveStoryRepository.listByWaveId(waveExecution.waveId);
    if (waveStories.length === 0) {
      return false;
    }

    const latestTestRuns = waveStories.map((waveStory) => this.options.deps.waveStoryTestRunRepository.getLatestByWaveStoryId(waveStory.id));
    const latestStoryExecutions = waveStories.map((waveStory) =>
      this.options.deps.waveStoryExecutionRepository.getLatestByWaveStoryId(waveStory.id)
    );

    const hasRetryableFailedTestPreparation = waveStories.some((waveStory, index) => {
      const latestTestRun = latestTestRuns[index];
      const latestExecution = latestStoryExecutions[index];
      return latestTestRun?.status === "failed" && latestExecution === null;
    });

    if (!hasRetryableFailedTestPreparation) {
      return false;
    }

    const hasBlockingExecutionFailure = latestStoryExecutions.some(
      (execution) => execution !== null && execution.status !== "completed"
    );
    if (hasBlockingExecutionFailure) {
      return false;
    }

    return !latestTestRuns.some((testRun) => testRun?.status === "review_required");
  }

  private async ensureWaveStoryTestPreparation(input: {
    project: ReturnType<WorkflowEntityLoaders["requireProject"]>;
    implementationPlan: ReturnType<WorkflowEntityLoaders["requireImplementationPlanForProject"]>;
    wave: ReturnType<WorkflowEntityLoaders["requireWave"]>;
    waveExecution: ReturnType<WorkflowEntityLoaders["requireWaveExecution"]>;
    waveStory: ReturnType<WorkflowEntityLoaders["requireWaveStory"]>;
    story: ReturnType<WorkflowEntityLoaders["requireStory"]>;
    projectExecutionContext?: ReturnType<ExecutionService["ensureProjectExecutionContext"]>;
  }) {
    const latest = this.options.deps.waveStoryTestRunRepository.getLatestByWaveStoryId(input.waveStory.id);
    if (latest?.status === "completed") {
      return {
        phase: "test_preparation" as const,
        waveStoryTestRunId: latest.id,
        waveStoryId: input.waveStory.id,
        storyCode: input.story.code,
        status: "completed" as const
      };
    }

    const resolvedWorkerProfile = this.options.resolveWorkerProfile("testPreparation");
    const runtime = this.options.resolveWorkerRuntime("testPreparation");
    const storyRunContext = this.buildStoryRunContext({
      project: input.project,
      implementationPlan: input.implementationPlan,
      wave: input.wave,
      story: input.story,
      projectExecutionContext: input.projectExecutionContext
    });

    const testRun = this.options.deps.waveStoryTestRunRepository.create({
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
      const result = await runtime.adapter.runStoryTestPreparation({
        runtime: this.options.buildAdapterRuntimeContext(runtime),
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
      this.options.deps.testAgentSessionRepository.create({
        waveStoryTestRunId: testRun.id,
        adapterKey: runtime.adapterKey,
        status: result.exitCode === 0 ? "completed" : "failed",
        commandJson: JSON.stringify(result.command),
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode
      });

      const status = this.resolveTestPreparationStatus(parsed, result.exitCode);
      this.options.deps.waveStoryTestRunRepository.updateStatus(testRun.id, status, {
        outputSummaryJson: JSON.stringify(parsed, null, 2),
        errorMessage: parsed.blockers.join("; ") || null
      });

      return {
        phase: "test_preparation" as const,
        waveStoryTestRunId: testRun.id,
        waveStoryId: input.waveStory.id,
        storyCode: input.story.code,
        status
      };
    } catch (error) {
      this.options.deps.testAgentSessionRepository.create({
        waveStoryTestRunId: testRun.id,
        adapterKey: runtime.adapterKey,
        status: "failed",
        commandJson: JSON.stringify([]),
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1
      });
      this.options.deps.waveStoryTestRunRepository.updateStatus(testRun.id, "failed", {
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      return {
        phase: "test_preparation" as const,
        waveStoryTestRunId: testRun.id,
        waveStoryId: input.waveStory.id,
        storyCode: input.story.code,
        status: "failed" as const
      };
    }
  }

  private resolveActiveWave(waves: Array<ReturnType<WorkflowEntityLoaders["requireWave"]>>) {
    for (const wave of waves) {
      const latestExecution = this.options.deps.waveExecutionRepository.getLatestByWaveId(wave.id);
      if (!latestExecution || latestExecution.status !== "completed") {
        return wave;
      }
    }
    return null;
  }

  private ensureWaveExecution(waveId: string) {
    const latest = this.options.deps.waveExecutionRepository.getLatestByWaveId(waveId);
    if (latest?.status === "failed") {
      return latest;
    }
    if (latest && latest.status !== "completed") {
      if (latest.status !== "running") {
        this.options.deps.waveExecutionRepository.updateStatus(latest.id, "running");
        return this.options.loaders.requireWaveExecution(latest.id);
      }
      return latest;
    }
    return this.options.deps.waveExecutionRepository.create({
      waveId,
      status: "running",
      attempt: (latest?.attempt ?? 0) + 1
    });
  }

  private resolveExecutableWaveStories(waveId: string) {
    return this.options.deps.waveStoryRepository.listByWaveId(waveId).filter((waveStory) => {
      const latestExecution = this.options.deps.waveStoryExecutionRepository.getLatestByWaveStoryId(waveStory.id);
      if (latestExecution) {
        return false;
      }
      const story = this.options.loaders.requireStory(waveStory.storyId);
      return this.options.deps.waveStoryDependencyRepository
        .listByDependentStoryId(story.id)
        .every((dependency) => {
          const blockingWaveStory = this.options.loaders.requireWaveStoryByStoryId(dependency.blockingStoryId);
          const blockingExecution = this.options.deps.waveStoryExecutionRepository.getLatestByWaveStoryId(blockingWaveStory.id);
          return blockingExecution?.status === "completed";
        });
    });
  }

  private buildBusinessContextSnapshot(input: {
    item: ReturnType<WorkflowEntityLoaders["requireItem"]>;
    project: ReturnType<WorkflowEntityLoaders["requireProject"]>;
    implementationPlan: ReturnType<WorkflowEntityLoaders["requireImplementationPlanForProject"]>;
    wave: ReturnType<WorkflowEntityLoaders["requireWave"]>;
    story: ReturnType<WorkflowEntityLoaders["requireStory"]>;
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
    project: ReturnType<WorkflowEntityLoaders["requireProject"]>;
    story: ReturnType<WorkflowEntityLoaders["requireStory"]>;
    architectureSummary: string | null;
    projectExecutionContext: ReturnType<ExecutionService["ensureProjectExecutionContext"]>;
  }): string {
    const storyText = `${input.story.title} ${input.story.description} ${input.story.goal} ${input.story.benefit}`.toLowerCase();
    const relevantFiles = [...input.projectExecutionContext.relevantFiles];
    if (storyText.includes("workflow")) {
      relevantFiles.push("src/workflow/");
    }
    if (storyText.includes("cli")) {
      relevantFiles.push("src/cli/main.ts");
    }
    if (storyText.includes("story") || storyText.includes("requirement")) {
      relevantFiles.push("src/persistence/repositories.ts");
    }
    return JSON.stringify(
      {
        projectCode: input.project.code,
        relevantDirectories: input.projectExecutionContext.relevantDirectories,
        relevantFiles: Array.from(new Set(relevantFiles)),
        nearbyTests: input.projectExecutionContext.testLocations,
        repoConventions: input.projectExecutionContext.repoConventions,
        integrationPoints: input.projectExecutionContext.integrationPoints,
        architectureSummary: input.architectureSummary
      },
      null,
      2
    );
  }

  private selectWorkerRole(
    story: ReturnType<WorkflowEntityLoaders["requireStory"]>,
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
}
