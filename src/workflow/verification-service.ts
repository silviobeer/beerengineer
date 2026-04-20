import { z } from "zod";

import {
  appVerificationOutputSchema,
  ralphVerificationOutputSchema,
  storyReviewOutputSchema
} from "../schemas/output-contracts.js";
import type {
  AppVerificationOutput,
  RalphVerificationOutput,
  StoryExecutionOutput,
  StoryReviewOutput,
  TestPreparationOutput
} from "../schemas/output-contracts.js";
import { AppError } from "../shared/errors.js";
import type {
  AppVerificationRunner,
  AppVerificationRunStatus,
  ExecutionWorkerRole,
  GitBranchMetadata,
  ReviewGateDecision,
  StoryReviewRunStatus,
  VerificationRunStatus
} from "../domain/types.js";
import type { WaveStoryExecutionRepository } from "../persistence/repositories.js";
import { createStoryReviewKnowledgeEntries } from "../services/quality-knowledge-service.js";
import type { WorkerProfileKey } from "./worker-profiles.js";
import type { WorkflowDeps } from "./workflow-deps.js";
import type { WorkflowEntityLoaders } from "./entity-loaders.js";
import { buildStoryWorkflowAdapterContext } from "./adapter-payloads.js";
import type { BuildAdapterRuntimeContext, ResolvedWorkerProfile, ResolvedWorkerRuntime } from "./runtime-types.js";
import { MAX_STORY_REVIEW_REMEDIATION_ATTEMPTS } from "./workflow-constants.js";

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

type WaveStoryExecutionRecord =
  | ReturnType<WaveStoryExecutionRepository["create"]>
  | ReturnType<WorkflowEntityLoaders["requireWaveStoryExecution"]>;

type AppVerificationExecutionResult = {
  status: "passed" | "review_required" | "failed";
  errorMessage: string | null;
  runId: string;
};

type VerificationServiceOptions = {
  deps: WorkflowDeps;
  loaders: Pick<
    WorkflowEntityLoaders,
    | "requireWaveStoryExecution"
    | "requireStory"
    | "requireProject"
    | "requireImplementationPlanForProject"
    | "requireWaveExecution"
    | "requireWave"
    | "requireWaveStory"
    | "requireItem"
    | "requireWaveStoryTestRun"
    | "requireAppVerificationRun"
    | "requireStoryReviewRun"
    | "requireStoryReviewRemediationRun"
  >;
  resolveWorkerProfile(profileKey: WorkerProfileKey): ResolvedWorkerProfile;
  resolveWorkerRuntime(profileKey: WorkerProfileKey): ResolvedWorkerRuntime;
  buildAdapterRuntimeContext: BuildAdapterRuntimeContext;
  ensureProjectExecutionContext(
    project: ReturnType<WorkflowEntityLoaders["requireProject"]>,
    implementationPlan: ReturnType<WorkflowEntityLoaders["requireImplementationPlanForProject"]>
  ): ReturnType<WorkflowDeps["projectExecutionContextRepository"]["getByProjectId"]> extends infer T ? Exclude<T, null> : never;
  buildStoryRunContext(input: {
    project: ReturnType<WorkflowEntityLoaders["requireProject"]>;
    implementationPlan: ReturnType<WorkflowEntityLoaders["requireImplementationPlanForProject"]>;
    wave: ReturnType<WorkflowEntityLoaders["requireWave"]>;
    story: ReturnType<WorkflowEntityLoaders["requireStory"]>;
    projectExecutionContext?: ReturnType<VerificationServiceOptions["ensureProjectExecutionContext"]>;
  }): {
    item: ReturnType<WorkflowEntityLoaders["requireItem"]>;
    architecture: ReturnType<WorkflowDeps["architecturePlanRepository"]["getLatestByProjectId"]>;
    acceptanceCriteria: ReturnType<WorkflowDeps["acceptanceCriterionRepository"]["listByStoryId"]>;
    projectExecutionContext: ReturnType<VerificationServiceOptions["ensureProjectExecutionContext"]>;
    businessContextSnapshotJson: string;
    repoContextSnapshotJson: string;
  };
  parseTestPreparationOutput(
    testRun: ReturnType<WorkflowEntityLoaders["requireWaveStoryTestRun"]>
  ): TestPreparationOutput;
  parseStoryExecutionOutput(
    execution: ReturnType<WorkflowEntityLoaders["requireWaveStoryExecution"]>
  ): StoryExecutionOutput;
  refreshWaveExecutionStatus(waveExecutionId: string): void;
  executeWaveStory(input: {
    project: ReturnType<WorkflowEntityLoaders["requireProject"]>;
    implementationPlan: ReturnType<WorkflowEntityLoaders["requireImplementationPlanForProject"]>;
    wave: ReturnType<WorkflowEntityLoaders["requireWave"]>;
    waveExecution: ReturnType<WorkflowEntityLoaders["requireWaveExecution"]>;
    waveStory: ReturnType<WorkflowEntityLoaders["requireWaveStory"]>;
    story: ReturnType<WorkflowEntityLoaders["requireStory"]>;
    projectExecutionContext?: ReturnType<VerificationServiceOptions["ensureProjectExecutionContext"]>;
    testPreparationRunId: string;
    workerProfileKey?: WorkerProfileKey;
    workerRoleOverride?: ExecutionWorkerRole;
    gitMetadata?: GitBranchMetadata | null;
  }): Promise<{
    waveStoryExecutionId: string;
    status: string;
  }>;
  ensureStoryRemediationBranch(projectCode: string, storyCode: string, storyReviewRunId: string): GitBranchMetadata;
  invalidateDocumentationForProject(projectId: string, reason: string): void;
  mirrorStoryReview?(input: {
    waveStoryExecutionId: string;
    storyReviewRunId: string;
    projectId: string;
    waveId: string;
    storyId: string;
    storyCode: string;
    status: StoryReviewRunStatus;
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
  }): void;
  triggerImplementationReview?(input: {
    waveStoryExecutionId: string;
    automationLevel: "auto_comment";
  }): Promise<unknown>;
};

export class VerificationService {
  public constructor(private readonly options: VerificationServiceOptions) {}

  public async startStoryReview(waveStoryExecutionId: string) {
    const execution = this.options.loaders.requireWaveStoryExecution(waveStoryExecutionId);
    const latestBasicVerification = this.options.deps.verificationRunRepository.getLatestByWaveStoryExecutionIdAndMode(
      execution.id,
      "basic"
    );
    const latestRalphVerification = this.options.deps.verificationRunRepository.getLatestByWaveStoryExecutionIdAndMode(
      execution.id,
      "ralph"
    );
    if (latestBasicVerification?.status !== "passed" || latestRalphVerification?.status !== "passed") {
      throw new AppError(
        "STORY_REVIEW_NOT_READY",
        `Wave story execution ${waveStoryExecutionId} has not passed basic and Ralph verification`
      );
    }

    const latestAppVerification = this.options.deps.appVerificationRunRepository.getLatestByWaveStoryExecutionId(execution.id);
    if (latestAppVerification && latestAppVerification.status !== "passed") {
      throw new AppError(
        "STORY_REVIEW_NOT_READY",
        `Wave story execution ${waveStoryExecutionId} has not passed app verification`
      );
    }

    const story = this.options.loaders.requireStory(execution.storyId);
    const project = this.options.loaders.requireProject(story.projectId);
    const implementationPlan = this.options.loaders.requireImplementationPlanForProject(project.id);
    const waveExecution = this.options.loaders.requireWaveExecution(execution.waveExecutionId);
    const wave = this.options.loaders.requireWave(waveExecution.waveId);
    const testPreparationRun = this.options.loaders.requireWaveStoryTestRun(execution.testPreparationRunId);
    const parsedTestPreparation = this.options.parseTestPreparationOutput(testPreparationRun);
    const implementationOutput = this.options.parseStoryExecutionOutput(execution);
    const basicVerificationSummary = JSON.parse(latestBasicVerification.summaryJson) as {
      storyCode: string;
      changedFiles: string[];
      testsRun: StoryExecutionOutput["testsRun"];
      blockers: string[];
    };
    const ralphVerificationSummary = this.parseRalphVerificationOutput(latestRalphVerification);
    const storyRunContext = this.options.buildStoryRunContext({
      project,
      implementationPlan,
      wave,
      story
    });
    const storyReview = await this.executeStoryReview({
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
    });

    if (execution.status !== "completed" && execution.status !== "review_required") {
      this.options.deps.waveStoryExecutionRepository.updateStatus(
        execution.id,
        storyReview.status === "passed" ? "completed" : "review_required",
        {
          outputSummaryJson: execution.outputSummaryJson,
          errorMessage: storyReview.errorMessage
        }
      );
      this.options.refreshWaveExecutionStatus(waveExecution.id);
    }

    const latestStoryReviewRun = this.options.deps.storyReviewRunRepository.getLatestByWaveStoryExecutionId(execution.id);
    return {
      waveStoryExecutionId: execution.id,
      storyReviewRunId: latestStoryReviewRun?.id ?? null,
      storyCode: story.code,
      status: storyReview.status
    };
  }

  public async startAppVerification(waveStoryExecutionId: string) {
    const execution = this.options.loaders.requireWaveStoryExecution(waveStoryExecutionId);
    const latestBasicVerification = this.options.deps.verificationRunRepository.getLatestByWaveStoryExecutionIdAndMode(
      execution.id,
      "basic"
    );
    const latestRalphVerification = this.options.deps.verificationRunRepository.getLatestByWaveStoryExecutionIdAndMode(
      execution.id,
      "ralph"
    );
    if (latestBasicVerification?.status !== "passed" || latestRalphVerification?.status !== "passed") {
      throw new AppError(
        "APP_VERIFICATION_NOT_READY",
        `Wave story execution ${waveStoryExecutionId} has not passed basic and Ralph verification`
      );
    }

    const latestAppVerification = this.options.deps.appVerificationRunRepository.getLatestByWaveStoryExecutionId(execution.id);
    if (latestAppVerification?.status === "passed") {
      throw new AppError(
        "APP_VERIFICATION_ALREADY_PASSED",
        `Wave story execution ${waveStoryExecutionId} already has a passed app verification`
      );
    }

    const story = this.options.loaders.requireStory(execution.storyId);
    const project = this.options.loaders.requireProject(story.projectId);
    const implementationPlan = this.options.loaders.requireImplementationPlanForProject(project.id);
    const waveExecution = this.options.loaders.requireWaveExecution(execution.waveExecutionId);
    const wave = this.options.loaders.requireWave(waveExecution.waveId);
    const testPreparationRun = this.options.loaders.requireWaveStoryTestRun(execution.testPreparationRunId);
    const parsedTestPreparation = this.options.parseTestPreparationOutput(testPreparationRun);
    const implementationOutput = this.options.parseStoryExecutionOutput(execution);
    const basicVerificationSummary = JSON.parse(latestBasicVerification.summaryJson) as {
      storyCode: string;
      changedFiles: string[];
      testsRun: StoryExecutionOutput["testsRun"];
      blockers: string[];
    };
    const ralphVerificationSummary = this.parseRalphVerificationOutput(latestRalphVerification);
    const storyRunContext = this.options.buildStoryRunContext({
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
    this.options.deps.waveStoryExecutionRepository.updateStatus(
      execution.id,
      finalExecutionStatus === "passed" ? "completed" : finalExecutionStatus,
      {
        outputSummaryJson: execution.outputSummaryJson,
        errorMessage: appVerification.errorMessage ?? storyReview?.errorMessage ?? null
      }
    );
    this.options.refreshWaveExecutionStatus(waveExecution.id);

    return {
      phase: storyReview ? "story_review" : "app_verification",
      appVerificationRunId: appVerification.runId,
      waveStoryExecutionId: execution.id,
      storyCode: story.code,
      status: finalExecutionStatus === "passed" ? "completed" : finalExecutionStatus
    };
  }

  public showAppVerification(appVerificationRunId: string) {
    const run = this.options.loaders.requireAppVerificationRun(appVerificationRunId);
    const execution = this.options.loaders.requireWaveStoryExecution(run.waveStoryExecutionId);
    const story = this.options.loaders.requireStory(execution.storyId);
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

  public showStoryReview(storyId: string) {
    const story = this.options.loaders.requireStory(storyId);
    const waveStory = this.options.deps.waveStoryRepository.listByStoryIds([storyId])[0];
    if (!waveStory) {
      throw new AppError("WAVE_STORY_NOT_FOUND", `No wave story found for story ${story.code}`);
    }
    const executions = this.options.deps.waveStoryExecutionRepository.listByWaveStoryId(waveStory.id);
    const reviewRuns = executions.flatMap((execution) =>
      this.options.deps.storyReviewRunRepository.listByWaveStoryExecutionId(execution.id).map((storyReviewRun) => ({
        execution,
        storyReviewRun,
        findings: this.options.deps.storyReviewFindingRepository.listByStoryReviewRunId(storyReviewRun.id),
        sessions: this.options.deps.storyReviewAgentSessionRepository.listByStoryReviewRunId(storyReviewRun.id)
      }))
    );
    return {
      story,
      latestStoryReviewRun: reviewRuns.at(-1)?.storyReviewRun ?? null,
      reviewRuns
    };
  }

  public async retryAppVerification(appVerificationRunId: string) {
    const run = this.options.loaders.requireAppVerificationRun(appVerificationRunId);
    if (run.status !== "failed" && run.status !== "review_required") {
      throw new AppError("APP_VERIFICATION_RUN_NOT_RETRYABLE", `App verification run ${appVerificationRunId} is not retryable`);
    }
    return this.startAppVerification(run.waveStoryExecutionId);
  }

  public showStoryReviewRemediation(storyId: string) {
    const story = this.options.loaders.requireStory(storyId);
    const remediationRuns = this.options.deps.storyReviewRemediationRunRepository.listByStoryId(storyId);
    return {
      story,
      latestRemediationRun: remediationRuns.at(-1) ?? null,
      remediationRuns: remediationRuns.map((remediationRun) => ({
        remediationRun,
        selectedFindings: this.options.deps.storyReviewRemediationFindingRepository.listByRunId(remediationRun.id),
        sessions: this.options.deps.storyReviewRemediationAgentSessionRepository.listByRunId(remediationRun.id)
      })),
      openFindings: this.options.deps.storyReviewFindingRepository.listOpenByStoryId(storyId)
    };
  }

  public async startStoryReviewRemediation(storyReviewRunId: string) {
    const storyReviewRun = this.options.loaders.requireStoryReviewRun(storyReviewRunId);
    const sourceExecution = this.options.loaders.requireWaveStoryExecution(storyReviewRun.waveStoryExecutionId);
    if (storyReviewRun.status !== "review_required" && storyReviewRun.status !== "failed") {
      throw new AppError("STORY_REVIEW_RUN_NOT_REMEDIABLE", `Story review run ${storyReviewRunId} is not remediable`);
    }

    const story = this.options.loaders.requireStory(sourceExecution.storyId);
    const project = this.options.loaders.requireProject(story.projectId);
    const item = this.options.loaders.requireItem(project.itemId);
    const implementationPlan = this.options.loaders.requireImplementationPlanForProject(project.id);
    const waveStory = this.options.loaders.requireWaveStory(sourceExecution.waveStoryId);
    const waveExecution = this.options.loaders.requireWaveExecution(sourceExecution.waveExecutionId);
    const wave = this.options.loaders.requireWave(waveExecution.waveId);
    const projectExecutionContext = this.options.ensureProjectExecutionContext(project, implementationPlan);
    const selectedFindings = this.options.deps.storyReviewFindingRepository
      .listByStoryReviewRunId(storyReviewRun.id)
      .filter((finding) => finding.status === "open");
    if (selectedFindings.length === 0) {
      throw new AppError("STORY_REVIEW_FINDINGS_NOT_FOUND", `Story review run ${storyReviewRunId} has no open findings`);
    }

    const openFindings = this.options.deps.storyReviewFindingRepository.listOpenByStoryId(story.id);
    const resolvedWorkerProfile = this.options.resolveWorkerProfile("storyReviewRemediation");
    const runtime = this.options.resolveWorkerRuntime("storyReviewRemediation");
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
    const gitMetadata = this.options.ensureStoryRemediationBranch(project.code, story.code, storyReviewRun.id);
    const remediationRun = this.options.deps.runInTransaction(() => {
      const priorAttempts = this.options.deps.storyReviewRemediationRunRepository.listByStoryReviewRunId(storyReviewRun.id);
      if (priorAttempts.length >= MAX_STORY_REVIEW_REMEDIATION_ATTEMPTS) {
        throw new AppError(
          "STORY_REVIEW_REMEDIATION_LIMIT_REACHED",
          `Story review run ${storyReviewRunId} reached remediation limit`
        );
      }
      const createdRun = this.options.deps.storyReviewRemediationRunRepository.create({
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
      this.options.deps.storyReviewRemediationFindingRepository.createMany(
        selectedFindings.map((finding) => ({
          storyReviewRemediationRunId: createdRun.id,
          storyReviewFindingId: finding.id,
          resolutionStatus: "selected"
        }))
      );
      selectedFindings.forEach((finding) => this.options.deps.storyReviewFindingRepository.updateStatus(finding.id, "in_progress"));
      return createdRun;
    });

    try {
      const result = await this.options.executeWaveStory({
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
      this.options.deps.storyReviewRemediationAgentSessionRepository.create({
        storyReviewRemediationRunId: remediationRun.id,
        adapterKey: runtime.adapterKey,
        status: result.status === "failed" ? "failed" : "completed",
        commandJson: JSON.stringify(["remediation", storyReviewRun.id]),
        stdout: JSON.stringify(result),
        stderr: "",
        exitCode: result.status === "failed" ? 1 : 0
      });
      const remediationExecution = this.options.loaders.requireWaveStoryExecution(result.waveStoryExecutionId);
      const latestStoryReviewRun = this.options.deps.storyReviewRunRepository.getLatestByWaveStoryExecutionId(remediationExecution.id);
      if (!latestStoryReviewRun) {
        throw new AppError("STORY_REVIEW_RUN_NOT_FOUND", "Remediation execution did not create a story review run");
      }
      const latestFindings = this.options.deps.storyReviewFindingRepository.listByStoryReviewRunId(latestStoryReviewRun.id);
      const latestOpenKeys = new Set(
        latestFindings.filter((finding) => finding.status === "open").map((finding) => this.findingFingerprint(finding))
      );
      selectedFindings.forEach((finding) => {
        const stillOpen = latestOpenKeys.has(this.findingFingerprint(finding));
        this.options.deps.storyReviewRemediationFindingRepository.updateResolutionStatus(
          remediationRun.id,
          finding.id,
          stillOpen ? "still_open" : "resolved"
        );
        this.options.deps.storyReviewFindingRepository.updateStatus(finding.id, stillOpen ? "open" : "resolved");
      });
      let remediationStatus: "completed" | "review_required" | "failed" = "failed";
      if (latestStoryReviewRun.status === "passed") {
        remediationStatus = "completed";
      } else if (latestStoryReviewRun.status === "review_required") {
        remediationStatus = "review_required";
      }
      this.options.deps.storyReviewRemediationRunRepository.updateStatus(remediationRun.id, remediationStatus, {
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
        this.options.invalidateDocumentationForProject(project.id, `story review remediation ${remediationRun.id}`);
      }
      this.options.refreshWaveExecutionStatus(waveExecution.id);
      return {
        storyReviewRemediationRunId: remediationRun.id,
        remediationWaveStoryExecutionId: remediationExecution.id,
        status: remediationStatus
      };
    } catch (error) {
      this.options.deps.storyReviewRemediationAgentSessionRepository.create({
        storyReviewRemediationRunId: remediationRun.id,
        adapterKey: runtime.adapterKey,
        status: "failed",
        commandJson: JSON.stringify(["remediation", storyReviewRun.id]),
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1
      });
      this.options.deps.runInTransaction(() => {
        selectedFindings.forEach((finding) => this.options.deps.storyReviewFindingRepository.updateStatus(finding.id, "open"));
        this.options.deps.storyReviewRemediationRunRepository.updateStatus(remediationRun.id, "failed", {
          gitMetadata,
          errorMessage: error instanceof Error ? error.message : String(error)
        });
      });
      throw error;
    }
  }

  public async retryStoryReviewRemediation(storyReviewRemediationRunId: string) {
    const remediationRun = this.options.loaders.requireStoryReviewRemediationRun(storyReviewRemediationRunId);
    const priorAttempts = this.options.deps.storyReviewRemediationRunRepository.listByStoryReviewRunId(remediationRun.storyReviewRunId);
    if (priorAttempts.length >= MAX_STORY_REVIEW_REMEDIATION_ATTEMPTS) {
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

  public async executeVerificationPipeline(input: {
    project: ReturnType<WorkflowEntityLoaders["requireProject"]>;
    implementationPlan: ReturnType<WorkflowEntityLoaders["requireImplementationPlanForProject"]>;
    wave: ReturnType<WorkflowEntityLoaders["requireWave"]>;
    waveExecution: ReturnType<WorkflowEntityLoaders["requireWaveExecution"]>;
    story: ReturnType<WorkflowEntityLoaders["requireStory"]>;
    storyRunContext: ReturnType<VerificationServiceOptions["buildStoryRunContext"]>;
    testPreparationRun: ReturnType<WorkflowEntityLoaders["requireWaveStoryTestRun"]>;
    parsedTestPreparation: TestPreparationOutput;
    execution: ReturnType<WaveStoryExecutionRepository["create"]>;
    implementationOutput: StoryExecutionOutput;
  }) {
    const basicVerificationStatus = this.resolveVerificationStatus(input.implementationOutput, 0);
    const basicVerificationSummary = {
      storyCode: input.story.code,
      changedFiles: input.implementationOutput.changedFiles,
      testsRun: input.implementationOutput.testsRun,
      blockers: input.implementationOutput.blockers
    };
    this.options.deps.verificationRunRepository.create({
      waveExecutionId: input.waveExecution.id,
      waveStoryExecutionId: input.execution.id,
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
      storyRunContext: input.storyRunContext,
      testPreparationRun: input.testPreparationRun,
      parsedTestPreparation: input.parsedTestPreparation,
      execution: input.execution,
      implementationOutput: input.implementationOutput,
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
            storyRunContext: input.storyRunContext,
            execution: input.execution,
            implementationOutput: input.implementationOutput
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
            storyRunContext: input.storyRunContext,
            testPreparationRun: input.testPreparationRun,
            parsedTestPreparation: input.parsedTestPreparation,
            execution: input.execution,
            implementationOutput: input.implementationOutput,
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
    return {
      basicVerificationStatus,
      basicVerificationSummary,
      ralphVerification,
      appVerification,
      storyReview,
      finalExecutionStatus
    };
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

  private parseRalphVerificationOutput(
    verificationRun: ReturnType<WorkflowDeps["verificationRunRepository"]["getLatestByWaveStoryExecutionIdAndMode"]>
  ): RalphVerificationOutput {
    if (!verificationRun?.summaryJson) {
      throw new AppError("RALPH_OUTPUT_MISSING", "Ralph verification has no summary");
    }
    return ralphVerificationOutputSchema.parse(JSON.parse(verificationRun.summaryJson));
  }

  private buildProjectAppTestContext(project: ReturnType<WorkflowEntityLoaders["requireProject"]>) {
    const defaults = this.getDefaultAppTestConfig();
    const raw = this.options.deps.workspaceSettings.appTestConfigJson;
    if (!raw) {
      return {
        projectId: project.id,
        workspaceRoot: this.options.deps.workspaceRoot,
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
      workspaceRoot: this.options.deps.workspaceRoot,
      baseUrl: parsed.baseUrl ?? defaults.baseUrl,
      runnerPreference: parsed.runnerPreference ?? defaults.runnerPreference,
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
    execution: ReturnType<WaveStoryExecutionRepository["create"]> | ReturnType<WorkflowEntityLoaders["requireWaveStoryExecution"]>;
    story: ReturnType<WorkflowEntityLoaders["requireStory"]>;
    storyRunContext: ReturnType<VerificationServiceOptions["buildStoryRunContext"]>;
    implementationOutput: StoryExecutionOutput;
    projectAppTestContext: ReturnType<VerificationService["buildProjectAppTestContext"]>;
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
    projectAppTestContext: ReturnType<VerificationService["buildProjectAppTestContext"]>;
    storyAppVerificationContext: ReturnType<VerificationService["buildStoryAppVerificationContext"]>;
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
    project: ReturnType<WorkflowEntityLoaders["requireProject"]>;
    implementationPlan: ReturnType<WorkflowEntityLoaders["requireImplementationPlanForProject"]>;
    wave: ReturnType<WorkflowEntityLoaders["requireWave"]>;
    waveExecution: ReturnType<WorkflowEntityLoaders["requireWaveExecution"]>;
    story: ReturnType<WorkflowEntityLoaders["requireStory"]>;
    storyRunContext: ReturnType<VerificationServiceOptions["buildStoryRunContext"]>;
    testPreparationRun: ReturnType<WorkflowEntityLoaders["requireWaveStoryTestRun"]>;
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
    const resolvedWorkerProfile = this.options.resolveWorkerProfile("ralph");
    const runtime = this.options.resolveWorkerRuntime("ralph");
    const storyWorkflowContext = this.buildStoryWorkflowAdapterContext({
      project: input.project,
      implementationPlan: input.implementationPlan,
      wave: input.wave,
      story: input.story,
      storyRunContext: input.storyRunContext
    });
    const testPreparation = this.buildTestPreparationPayload(input.testPreparationRun, input.parsedTestPreparation);
    try {
      const result = await runtime.adapter.runStoryRalphVerification({
        runtime: this.options.buildAdapterRuntimeContext(runtime),
        workerRole: "ralph-verifier",
        prompt: resolvedWorkerProfile.promptContent,
        skills: resolvedWorkerProfile.skills,
        ...storyWorkflowContext,
        testPreparation,
        implementation: input.implementationOutput,
        basicVerification: {
          status: input.basicVerificationStatus,
          summary: input.basicVerificationSummary
        }
      });

      const parsed = ralphVerificationOutputSchema.parse(result.output);
      const status = this.resolveRalphVerificationStatus(parsed, result.exitCode);
      this.options.deps.verificationRunRepository.create({
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
      this.options.deps.verificationRunRepository.create({
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
    project: ReturnType<WorkflowEntityLoaders["requireProject"]>;
    implementationPlan: ReturnType<WorkflowEntityLoaders["requireImplementationPlanForProject"]>;
    wave: ReturnType<WorkflowEntityLoaders["requireWave"]>;
    story: ReturnType<WorkflowEntityLoaders["requireStory"]>;
    storyRunContext: ReturnType<VerificationServiceOptions["buildStoryRunContext"]>;
    testPreparationRun: ReturnType<WorkflowEntityLoaders["requireWaveStoryTestRun"]>;
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
    const resolvedWorkerProfile = this.options.resolveWorkerProfile("storyReview");
    const runtime = this.options.resolveWorkerRuntime("storyReview");
    const reviewRun = this.options.deps.storyReviewRunRepository.create({
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

    const storyWorkflowContext = this.buildStoryWorkflowAdapterContext({
      project: input.project,
      implementationPlan: input.implementationPlan,
      wave: input.wave,
      story: input.story,
      storyRunContext: input.storyRunContext
    });
    const testPreparation = this.buildTestPreparationPayload(input.testPreparationRun, input.parsedTestPreparation);
    try {
      const result = await runtime.adapter.runStoryReview({
        runtime: this.options.buildAdapterRuntimeContext(runtime),
        workerRole: "story-reviewer",
        prompt: resolvedWorkerProfile.promptContent,
        skills: resolvedWorkerProfile.skills,
        ...storyWorkflowContext,
        inputSnapshotJson: reviewRun.inputSnapshotJson,
        testPreparation,
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

      const parsed = storyReviewOutputSchema.parse(result.output);
      this.options.deps.storyReviewAgentSessionRepository.create({
        storyReviewRunId: reviewRun.id,
        adapterKey: runtime.adapterKey,
        status: result.exitCode === 0 ? "completed" : "failed",
        commandJson: JSON.stringify(result.command),
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode
      });
      const status = this.resolveStoryReviewStatus(parsed, result.exitCode);
      const storedFindings = this.options.deps.storyReviewFindingRepository.createMany(
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
      this.options.deps.qualityKnowledgeEntryRepository.createMany(
        createStoryReviewKnowledgeEntries({
          workspace: this.options.deps.workspace,
          projectId: input.project.id,
          waveId: input.wave.id,
          storyId: input.story.id,
          storyCode: input.story.code,
          findings: storedFindings,
          recommendations: parsed.recommendations
        })
      );
      this.options.deps.storyReviewRunRepository.updateStatus(reviewRun.id, status, {
        summaryJson: JSON.stringify(parsed, null, 2),
        errorMessage: null
      });
      this.options.mirrorStoryReview?.({
        waveStoryExecutionId: input.execution.id,
        storyReviewRunId: reviewRun.id,
        projectId: input.project.id,
        waveId: input.wave.id,
        storyId: input.story.id,
        storyCode: input.story.code,
        status,
        findings: storedFindings.map((finding) => ({
          severity: finding.severity,
          category: finding.category,
          title: finding.title,
          description: finding.description,
          evidence: finding.evidence,
          filePath: finding.filePath,
          line: finding.line
        })),
        summary: parsed,
        errorMessage: null
      });
      await this.options.triggerImplementationReview?.({
        waveStoryExecutionId: input.execution.id,
        automationLevel: "auto_comment"
      });
      return {
        status,
        errorMessage: null
      };
    } catch (error) {
      this.options.deps.storyReviewAgentSessionRepository.create({
        storyReviewRunId: reviewRun.id,
        adapterKey: runtime.adapterKey,
        status: "failed",
        commandJson: JSON.stringify([]),
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1
      });
      this.options.deps.storyReviewRunRepository.updateStatus(reviewRun.id, "failed", {
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      this.options.mirrorStoryReview?.({
        waveStoryExecutionId: input.execution.id,
        storyReviewRunId: reviewRun.id,
        projectId: input.project.id,
        waveId: input.wave.id,
        storyId: input.story.id,
        storyCode: input.story.code,
        status: "failed",
        findings: [],
        summary: null,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      await this.options.triggerImplementationReview?.({
        waveStoryExecutionId: input.execution.id,
        automationLevel: "auto_comment"
      });
      return {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async executeAppVerification(input: {
    project: ReturnType<WorkflowEntityLoaders["requireProject"]>;
    implementationPlan: ReturnType<WorkflowEntityLoaders["requireImplementationPlanForProject"]>;
    wave: ReturnType<WorkflowEntityLoaders["requireWave"]>;
    story: ReturnType<WorkflowEntityLoaders["requireStory"]>;
    storyRunContext: ReturnType<VerificationServiceOptions["buildStoryRunContext"]>;
    execution: WaveStoryExecutionRecord;
    implementationOutput: StoryExecutionOutput;
  }): Promise<AppVerificationExecutionResult> {
    const resolvedWorkerProfile = this.options.resolveWorkerProfile("appVerification");
    const runtime = this.options.resolveWorkerRuntime("appVerification");
    const previousRuns = this.options.deps.appVerificationRunRepository.listByWaveStoryExecutionId(input.execution.id);
    const projectAppTestContext = this.buildProjectAppTestContext(input.project);
    const storyAppVerificationContext = this.buildStoryAppVerificationContext({
      execution: input.execution,
      story: input.story,
      storyRunContext: input.storyRunContext,
      implementationOutput: input.implementationOutput,
      projectAppTestContext
    });
    const storyWorkflowContext = this.buildStoryWorkflowAdapterContext({
      project: input.project,
      implementationPlan: input.implementationPlan,
      wave: input.wave,
      story: input.story,
      storyRunContext: input.storyRunContext
    });
    const preparedSession = this.prepareAppVerificationSession({
      projectAppTestContext,
      storyAppVerificationContext
    });
    const startedAt = Date.now();
    const run = this.options.deps.appVerificationRunRepository.create({
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
      this.options.deps.appVerificationRunRepository.updateStatus(run.id, "preparing", {
        runner: preparedSession.runner,
        startedAt,
        projectAppTestContextJson: JSON.stringify(projectAppTestContext, null, 2),
        storyContextJson: JSON.stringify(storyAppVerificationContext, null, 2)
      });

      if (!preparedSession.ready) {
        this.options.deps.appVerificationRunRepository.updateStatus(run.id, "failed", {
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

      this.options.deps.appVerificationRunRepository.updateStatus(run.id, "in_progress", {
        runner: preparedSession.runner,
        startedAt,
        projectAppTestContextJson: JSON.stringify(projectAppTestContext, null, 2),
        storyContextJson: JSON.stringify(storyAppVerificationContext, null, 2),
        preparedSessionJson: JSON.stringify(preparedSession, null, 2)
      });

      const result = await runtime.adapter.runStoryAppVerification({
        runtime: this.options.buildAdapterRuntimeContext(runtime),
        workerRole: "app-verifier",
        prompt: resolvedWorkerProfile.promptContent,
        skills: resolvedWorkerProfile.skills,
        ...storyWorkflowContext,
        implementation: input.implementationOutput,
        projectAppTestContext,
        storyAppVerificationContext,
        preparedSession
      });

      const parsed = appVerificationOutputSchema.parse(result.output);
      const status = this.resolveAppVerificationStatus(parsed, result.exitCode);
      this.options.deps.appVerificationRunRepository.updateStatus(run.id, status, {
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
      this.options.deps.appVerificationRunRepository.updateStatus(run.id, "failed", {
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

  private resolveVerificationStatus(output: StoryExecutionOutput, exitCode: number): VerificationRunStatus {
    if (exitCode !== 0 || output.testsRun.some((testRun) => testRun.status === "failed")) {
      return "failed";
    }
    if (output.blockers.length > 0) {
      return "review_required";
    }
    return "passed";
  }

  private resolveRalphVerificationStatus(output: RalphVerificationOutput, exitCode: number): VerificationRunStatus {
    return this.resolveExternalVerificationStatus(output.overallStatus, exitCode);
  }

  private resolveAppVerificationStatus(
    output: AppVerificationOutput,
    exitCode: number
  ): "passed" | "review_required" | "failed" {
    return this.resolveExternalVerificationStatus(output.overallStatus, exitCode);
  }

  private resolveStoryReviewStatus(output: StoryReviewOutput, exitCode: number): StoryReviewRunStatus {
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

  private findingFingerprint(finding: {
    category: string;
    title: string;
    filePath: string | null;
    line: number | null;
  }) {
    return `${finding.category}::${finding.title}::${finding.filePath ?? ""}::${finding.line ?? ""}`;
  }

  private deriveAllowedPathsFromStoryContext(
    projectExecutionContext: ReturnType<VerificationServiceOptions["ensureProjectExecutionContext"]>,
    sourceExecution: ReturnType<WorkflowEntityLoaders["requireWaveStoryExecution"]>
  ): string[] {
    const implementation = this.parseStoredJson<StoryExecutionOutput>(
      sourceExecution.outputSummaryJson,
      "SOURCE_EXECUTION_OUTPUT_INVALID",
      "Source execution output"
    );
    const changedFiles = implementation?.changedFiles ?? [];
    return Array.from(new Set([...changedFiles, ...projectExecutionContext.relevantFiles]));
  }

  private buildStoryWorkflowAdapterContext(input: {
    project: ReturnType<WorkflowEntityLoaders["requireProject"]>;
    implementationPlan: ReturnType<WorkflowEntityLoaders["requireImplementationPlanForProject"]>;
    wave: ReturnType<WorkflowEntityLoaders["requireWave"]>;
    story: ReturnType<WorkflowEntityLoaders["requireStory"]>;
    storyRunContext: ReturnType<VerificationServiceOptions["buildStoryRunContext"]>;
  }) {
    return buildStoryWorkflowAdapterContext({
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
      repoContextSnapshotJson: input.storyRunContext.repoContextSnapshotJson
    });
  }

  private buildTestPreparationPayload(
    testPreparationRun: ReturnType<WorkflowEntityLoaders["requireWaveStoryTestRun"]>,
    parsedTestPreparation: TestPreparationOutput
  ) {
    return {
      id: testPreparationRun.id,
      summary: parsedTestPreparation.summary,
      testFiles: parsedTestPreparation.testFiles,
      testsGenerated: parsedTestPreparation.testsGenerated,
      assumptions: parsedTestPreparation.assumptions
    };
  }

  private resolveExternalVerificationStatus<TStatus extends "passed" | "review_required" | "failed">(
    status: TStatus,
    exitCode: number
  ): TStatus {
    if (exitCode !== 0) {
      return "failed" as TStatus;
    }
    return status;
  }
}
