import { qaOutputSchema } from "../schemas/output-contracts.js";
import type { QaOutput } from "../schemas/output-contracts.js";
import { AppError } from "../shared/errors.js";
import type { QaRunStatus } from "../domain/types.js";
import type { ReviewCoreService } from "../review/review-core-service.js";
import type { WorkflowDeps } from "./workflow-deps.js";
import type { WorkflowEntityLoaders } from "./entity-loaders.js";
import type { WorkerProfileKey } from "./worker-profiles.js";
import type { ExecutionService } from "./execution-service.js";
import type { BuildAdapterRuntimeContext, ResolvedWorkerProfile, ResolvedWorkerRuntime } from "./runtime-types.js";
import { createQaKnowledgeEntries } from "../services/quality-knowledge-service.js";

type QaServiceOptions = {
  deps: WorkflowDeps;
  reviewCoreService: ReviewCoreService;
  loaders: Pick<
    WorkflowEntityLoaders,
    "requireProject" | "requireItem" | "requireImplementationPlanForProject" | "requireQaRun"
  >;
  resolveWorkerProfile(profileKey: WorkerProfileKey): ResolvedWorkerProfile;
  resolveWorkerRuntime(profileKey: WorkerProfileKey): ResolvedWorkerRuntime;
  buildAdapterRuntimeContext: BuildAdapterRuntimeContext;
  ensureProjectExecutionContext(
    project: ReturnType<WorkflowEntityLoaders["requireProject"]>,
    implementationPlan: ReturnType<WorkflowEntityLoaders["requireImplementationPlanForProject"]>
  ): ReturnType<ExecutionService["ensureProjectExecutionContext"]>;
  groupAcceptanceCriteriaByStoryId(projectId: string): ReturnType<
    WorkflowDeps["acceptanceCriterionRepository"]["listByProjectId"]
  > extends infer T
    ? Map<string, T>
    : never;
  mirrorQaReview?(input: {
    qaRunId: string;
    projectId: string;
    itemId: string;
    status: QaRunStatus;
    findings: Array<{
      severity: string;
      category: string;
      title: string;
      description: string;
      evidence: string;
      storyId: string | null;
      waveStoryExecutionId: string | null;
    }>;
    summary: QaOutput | null;
    errorMessage: string | null;
  }): void;
};

export class QaService {
  public constructor(private readonly options: QaServiceOptions) {}

  public async startQa(projectId: string) {
    const project = this.options.loaders.requireProject(projectId);
    const item = this.options.loaders.requireItem(project.itemId);
    this.assertImplementationReviewGate(project.id);
    const implementationPlan = this.options.loaders.requireImplementationPlanForProject(projectId);
    const architecture = this.options.deps.architecturePlanRepository.getLatestByProjectId(projectId);
    const projectExecutionContext = this.options.ensureProjectExecutionContext(project, implementationPlan);
    const qaContext = this.buildQaRunContext({
      project,
      item,
      implementationPlan,
      projectExecutionContext
    });
    const resolvedWorkerProfile = this.options.resolveWorkerProfile("qa");
    const runtime = this.options.resolveWorkerRuntime("qa");

    this.options.deps.itemRepository.updatePhaseStatus(item.id, "running");

    const qaRun = this.options.deps.qaRunRepository.create({
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
      const result = await runtime.adapter.runProjectQa({
        runtime: this.options.buildAdapterRuntimeContext(runtime),
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

      const parsed = qaOutputSchema.parse(result.output);
      this.options.deps.qaAgentSessionRepository.create({
        qaRunId: qaRun.id,
        adapterKey: runtime.adapterKey,
        status: result.exitCode === 0 ? "completed" : "failed",
        commandJson: JSON.stringify(result.command),
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode
      });
      const status = this.resolveQaRunStatus(parsed, result.exitCode);
      const storyByCode = new Map(qaContext.stories.map((story) => [story.code, story]));
      const acceptanceCriterionByCode = new Map(qaContext.stories.flatMap((story) => story.acceptanceCriteria.map((criterion) => [criterion.code, criterion])));

      const storedFindings = this.options.deps.qaFindingRepository.createMany(
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
      this.options.deps.qualityKnowledgeEntryRepository.createMany(
        createQaKnowledgeEntries({
          workspace: this.options.deps.workspace,
          projectId,
          waveIds: qaContext.waves.map((wave) => wave.id),
          projectCode: project.code,
          findings: storedFindings,
          recommendations: parsed.recommendations,
          storyCodeByStoryId: new Map(qaContext.stories.map((story) => [story.id, story.code]))
        })
      );
      this.options.deps.qaRunRepository.updateStatus(qaRun.id, status, {
        summaryJson: JSON.stringify(parsed, null, 2),
        errorMessage: null
      });
      this.options.mirrorQaReview?.({
        qaRunId: qaRun.id,
        projectId,
        itemId: item.id,
        status,
        findings: storedFindings.map((finding) => ({
          severity: finding.severity,
          category: finding.category,
          title: finding.title,
          description: finding.description,
          evidence: finding.evidence,
          storyId: finding.storyId,
          waveStoryExecutionId: finding.waveStoryExecutionId
        })),
        summary: parsed,
        errorMessage: null
      });
      this.options.deps.itemRepository.updatePhaseStatus(item.id, this.mapQaRunStatusToItemPhaseStatus(status));

      return {
        projectId,
        qaRunId: qaRun.id,
        status
      };
    } catch (error) {
      this.options.deps.qaAgentSessionRepository.create({
        qaRunId: qaRun.id,
        adapterKey: runtime.adapterKey,
        status: "failed",
        commandJson: JSON.stringify([]),
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1
      });
      this.options.deps.qaRunRepository.updateStatus(qaRun.id, "failed", {
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      this.options.mirrorQaReview?.({
        qaRunId: qaRun.id,
        projectId,
        itemId: item.id,
        status: "failed",
        findings: [],
        summary: null,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      this.options.deps.itemRepository.updatePhaseStatus(item.id, "failed");
      throw error;
    }
  }

  public showQa(projectId: string) {
    const project = this.options.loaders.requireProject(projectId);
    const implementationPlan = this.options.loaders.requireImplementationPlanForProject(projectId);
    const qaRuns = this.options.deps.qaRunRepository.listByProjectId(projectId);

    return {
      project,
      implementationPlan,
      latestQaRun: qaRuns.at(-1) ?? null,
      qaRuns: qaRuns.map((qaRun) => ({
        qaRun,
        findings: this.options.deps.qaFindingRepository.listByQaRunId(qaRun.id),
        sessions: this.options.deps.qaAgentSessionRepository.listByQaRunId(qaRun.id)
      }))
    };
  }

  public async retryQa(qaRunId: string) {
    const qaRun = this.options.loaders.requireQaRun(qaRunId);
    if (qaRun.status !== "review_required" && qaRun.status !== "failed") {
      throw new AppError("QA_RUN_NOT_RETRYABLE", `QA run ${qaRunId} is not retryable`);
    }
    const next = await this.startQa(qaRun.projectId);
    return {
      ...next,
      retriedFromQaRunId: qaRunId
    };
  }

  private buildQaRunContext(input: {
    project: ReturnType<WorkflowEntityLoaders["requireProject"]>;
    item: ReturnType<WorkflowEntityLoaders["requireItem"]>;
    implementationPlan: ReturnType<WorkflowEntityLoaders["requireImplementationPlanForProject"]>;
    projectExecutionContext: ReturnType<ExecutionService["ensureProjectExecutionContext"]>;
  }) {
    const architecture = this.options.deps.architecturePlanRepository.getLatestByProjectId(input.project.id);
    const waves = this.options.deps.waveRepository.listByImplementationPlanId(input.implementationPlan.id);
    if (waves.length === 0) {
      throw new AppError("WAVES_NOT_FOUND", "Implementation plan has no waves");
    }

    const stories = this.options.deps.userStoryRepository.listByProjectId(input.project.id);
    const acceptanceCriteriaByStoryId = this.options.groupAcceptanceCriteriaByStoryId(input.project.id);
    const waveStoryByStoryId = new Map(
      this.options.deps.waveStoryRepository.listByStoryIds(stories.map((story) => story.id)).map((waveStory) => [waveStory.storyId, waveStory])
    );
    const latestExecutionByWaveStoryId = new Map(
      this.options.deps.waveStoryExecutionRepository
        .listLatestByWaveStoryIds(Array.from(waveStoryByStoryId.values()).map((waveStory) => waveStory.id))
        .map((execution) => [execution.waveStoryId, execution])
    );
    const latestRalphVerificationByExecutionId = new Map(
      this.options.deps.verificationRunRepository
        .listLatestByWaveStoryExecutionIdsAndMode(Array.from(latestExecutionByWaveStoryId.values()).map((execution) => execution.id), "ralph")
        .map((run) => [run.waveStoryExecutionId!, run])
    );
    const latestStoryReviewByExecutionId = new Map(
      this.options.deps.storyReviewRunRepository
        .listLatestByWaveStoryExecutionIds(Array.from(latestExecutionByWaveStoryId.values()).map((execution) => execution.id))
        .map((run) => [run.waveStoryExecutionId, run])
    );
    const projectQualityKnowledge = this.options.deps.qualityKnowledgeEntryRepository.listRecurringByProjectId(input.project.id, 12);
    const workspaceConstraints = this.options.deps.qualityKnowledgeEntryRepository.listRecentConstraintsByWorkspaceId(
      this.options.deps.workspace.id,
      8
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
      const latestExecution = this.options.deps.waveExecutionRepository.getLatestByWaveId(wave.id);
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
        qualityKnowledge: {
          recurringProjectIssues: projectQualityKnowledge.map((entry) => ({
            source: entry.source,
            summary: entry.summary,
            status: entry.status
          })),
          recentConstraints: workspaceConstraints.map((entry) => ({
            source: entry.source,
            summary: entry.summary,
            status: entry.status
          }))
        },
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

  private mapQaRunStatusToItemPhaseStatus(status: QaRunStatus): "completed" | "review_required" | "failed" {
    if (status === "passed") {
      return "completed";
    }
    if (status === "review_required") {
      return "review_required";
    }
    return "failed";
  }

  private assertImplementationReviewGate(projectId: string): void {
    const implementationPlan = this.options.deps.implementationPlanRepository.getLatestByProjectId(projectId);
    if (!implementationPlan) {
      return;
    }
    const waves = this.options.deps.waveRepository.listByImplementationPlanId(implementationPlan.id);
    const waveStories = this.options.deps.waveStoryRepository.listByWaveIds(waves.map((wave) => wave.id));
    const latestExecutions = this.options.deps.waveStoryExecutionRepository.listLatestByWaveStoryIds(waveStories.map((waveStory) => waveStory.id));
    const blockingRun = latestExecutions
      .map((execution) =>
        this.options.reviewCoreService.getLatestBlockingRunForGate({
          reviewKind: "implementation",
          subjectType: "wave_story_execution",
          subjectId: execution.id
        })
      )
      .find((run) => Boolean(run));
    if (blockingRun) {
      throw new AppError(
        "IMPLEMENTATION_REVIEW_GATE_BLOCKED",
        `Implementation review gate blocks QA until review ${blockingRun.id} is ready`
      );
    }
  }
}
