import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { assertCanMoveItem } from "../domain/workflow-rules.js";
import type { DocumentationOutput, RalphVerificationOutput, StoryExecutionOutput, StoryReviewOutput, TestPreparationOutput } from "../schemas/output-contracts.js";
import { documentationOutputSchema } from "../schemas/output-contracts.js";
import { AppError } from "../shared/errors.js";
import type { AdapterRuntimeContext, AgentAdapter } from "../adapters/types.js";
import type { DocumentationRunStatus, GitBranchMetadata, QaRunStatus } from "../domain/types.js";
import type { ArtifactRecord } from "../persistence/repositories.js";
import type { WorkerProfileKey } from "./worker-profiles.js";
import type { WorkflowDeps } from "./workflow-deps.js";
import type { WorkflowEntityLoaders } from "./entity-loaders.js";

type DocumentationServiceOptions = {
  deps: WorkflowDeps;
  loaders: Pick<
    WorkflowEntityLoaders,
    "requireProject" | "requireItem" | "requireImplementationPlanForProject" | "requireDocumentationRun"
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
  ensureProjectExecutionContext(
    project: ReturnType<WorkflowEntityLoaders["requireProject"]>,
    implementationPlan: ReturnType<WorkflowEntityLoaders["requireImplementationPlanForProject"]>
  ): ReturnType<WorkflowDeps["projectExecutionContextRepository"]["getByProjectId"]> extends infer T ? Exclude<T, null> : never;
  parseTestPreparationOutput(
    testRun: ReturnType<WorkflowEntityLoaders["requireWaveStoryTestRun"]>
  ): TestPreparationOutput;
  parseStoryExecutionOutput(
    execution: ReturnType<WorkflowEntityLoaders["requireWaveStoryExecution"]>
  ): StoryExecutionOutput;
  parseRalphVerificationOutput(
    verificationRun: ReturnType<WorkflowDeps["verificationRunRepository"]["getLatestByWaveStoryExecutionIdAndMode"]>
  ): RalphVerificationOutput;
  parseStoryReviewOutput(
    storyReviewRun: ReturnType<WorkflowDeps["storyReviewRunRepository"]["getLatestByWaveStoryExecutionId"]>
  ): StoryReviewOutput;
  persistArtifacts(input: {
    workspaceKey: string;
    itemId: string;
    projectId: string | null;
    runId: string;
    linkStageRunId?: boolean;
    markdownArtifacts: Array<{ kind: string; content: string }>;
    structuredArtifacts: Array<{ kind: string; content: unknown }>;
  }): ArtifactRecord[];
  buildSnapshot(itemId: string): ReturnType<typeof import("../domain/aggregate-status.js").buildItemWorkflowSnapshot>;
};

export class DocumentationService {
  public constructor(private readonly options: DocumentationServiceOptions) {}

  public async startDocumentation(projectId: string) {
    const project = this.options.loaders.requireProject(projectId);
    const item = this.options.loaders.requireItem(project.itemId);
    const implementationPlan = this.options.loaders.requireImplementationPlanForProject(projectId);
    const projectExecutionContext = this.options.ensureProjectExecutionContext(project, implementationPlan);
    const documentationContext = this.buildDocumentationRunContext({
      project,
      item,
      implementationPlan,
      projectExecutionContext
    });
    const staleDocumentationRun = this.options.deps.documentationRunRepository.getLatestByProjectId(projectId);
    const resolvedWorkerProfile = this.options.resolveWorkerProfile("documentation");
    const runtime = this.options.resolveWorkerRuntime("documentation");

    this.options.deps.itemRepository.updatePhaseStatus(item.id, "running");

    const documentationRun = this.options.deps.documentationRunRepository.create({
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
      const result = await runtime.adapter.runProjectDocumentation({
        runtime: this.options.buildAdapterRuntimeContext(runtime),
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
      this.options.deps.documentationAgentSessionRepository.create({
        documentationRunId: documentationRun.id,
        adapterKey: runtime.adapterKey,
        status: result.exitCode === 0 ? "completed" : "failed",
        commandJson: JSON.stringify(result.command),
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode
      });
      const artifactRecords = this.options.persistArtifacts({
        workspaceKey: this.options.deps.workspace.key,
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
      let workspaceArtifacts: { markdownPath: string; jsonPath: string } | null = null;
      let workspaceMaterializationError: string | null = null;
      try {
        workspaceArtifacts = this.materializeDocumentationArtifactsInWorkspace(project.id, project.code, parsed);
      } catch (error) {
        workspaceMaterializationError = error instanceof Error ? error.message : String(error);
      }
      const persistedStatus = workspaceMaterializationError ? "review_required" : status;
      this.options.deps.documentationRunRepository.updateStatus(documentationRun.id, persistedStatus, {
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
            workspaceArtifacts,
            workspaceMaterializationError,
            artifactIds: artifactRecords.map((artifact) => artifact.id),
            artifactKinds: artifactRecords.map((artifact) => artifact.kind)
          },
          null,
          2
        ),
        errorMessage: workspaceMaterializationError
      });
      this.options.deps.itemRepository.updatePhaseStatus(item.id, this.mapDocumentationRunStatusToItemPhaseStatus(persistedStatus));
      if (persistedStatus === "completed") {
        this.completeItemIfDeliveryFinished(item.id);
      }

      return {
        projectId,
        documentationRunId: documentationRun.id,
        status: persistedStatus,
        replacesStaleDocumentationRunId: staleDocumentationRun?.staleAt ? staleDocumentationRun.id : null
      };
    } catch (error) {
      this.options.deps.documentationAgentSessionRepository.create({
        documentationRunId: documentationRun.id,
        adapterKey: runtime.adapterKey,
        status: "failed",
        commandJson: JSON.stringify([]),
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1
      });
      this.options.deps.documentationRunRepository.updateStatus(documentationRun.id, "failed", {
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      this.options.deps.itemRepository.updatePhaseStatus(item.id, "failed");
      throw error;
    }
  }

  public showDocumentation(projectId: string) {
    const project = this.options.loaders.requireProject(projectId);
    const implementationPlan = this.options.loaders.requireImplementationPlanForProject(projectId);
    const documentationRuns = this.options.deps.documentationRunRepository.listByProjectId(projectId);

    return {
      project,
      implementationPlan,
      latestDocumentationRun: documentationRuns.at(-1) ?? null,
      hasStaleDocumentation: documentationRuns.some((documentationRun) => documentationRun.staleAt !== null),
      documentationRuns: documentationRuns.map((documentationRun) => ({
        documentationRun,
        artifacts: this.listArtifactsForDocumentationRun(documentationRun),
        sessions: this.options.deps.documentationAgentSessionRepository.listByDocumentationRunId(documentationRun.id)
      }))
    };
  }

  public async retryDocumentation(documentationRunId: string) {
    const documentationRun = this.options.loaders.requireDocumentationRun(documentationRunId);
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

  public completeItemIfDeliveryFinished(itemId: string): void {
    const item = this.options.loaders.requireItem(itemId);
    const projects = this.options.deps.projectRepository.listByItemId(itemId);
    if (projects.length === 0 || projects.some((project) => !this.isProjectDeliveryComplete(project.id))) {
      return;
    }

    const snapshot = this.options.buildSnapshot(itemId);
    if (item.currentColumn !== "done") {
      assertCanMoveItem(item.currentColumn, "done", snapshot);
      this.options.deps.itemRepository.updateColumn(itemId, "done", "completed");
      return;
    }

    this.options.deps.itemRepository.updatePhaseStatus(itemId, "completed");
  }

  public isProjectDeliveryComplete(projectId: string): boolean {
    const latestDocumentationRun = this.options.deps.documentationRunRepository.getLatestByProjectId(projectId);
    return latestDocumentationRun?.status === "completed" && latestDocumentationRun.staleAt === null;
  }

  public invalidateDocumentationForProject(projectId: string, reason: string): void {
    const latestDocumentationRun = this.options.deps.documentationRunRepository.getLatestByProjectId(projectId);
    if (!latestDocumentationRun) {
      return;
    }
    if (latestDocumentationRun.status !== "completed" && latestDocumentationRun.status !== "review_required") {
      return;
    }
    this.options.deps.documentationRunRepository.markStale(latestDocumentationRun.id, reason);
  }

  private listArtifactsForDocumentationRun(documentationRun: ReturnType<WorkflowDeps["documentationRunRepository"]["getById"]>) {
    if (!documentationRun?.summaryJson) {
      return [];
    }
    try {
      const parsed = JSON.parse(documentationRun.summaryJson) as { artifactIds?: string[] };
      return (parsed.artifactIds ?? [])
        .map((artifactId) => this.options.deps.artifactRepository.getById(artifactId))
        .filter((artifact): artifact is ArtifactRecord => artifact !== null);
    } catch {
      return [];
    }
  }

  private materializeDocumentationArtifactsInWorkspace(
    projectId: string,
    projectCode: string,
    parsed: DocumentationOutput
  ): { markdownPath: string; jsonPath: string } {
    const docsDir = resolve(this.resolveProjectWorkspaceRoot(projectId), "docs");
    mkdirSync(docsDir, { recursive: true });
    const markdownPath = resolve(docsDir, `${projectCode}-delivery-report.md`);
    const jsonPath = resolve(docsDir, `${projectCode}-delivery-report.json`);
    writeFileSync(markdownPath, parsed.reportMarkdown, "utf8");
    writeFileSync(
      jsonPath,
      JSON.stringify(
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
          keyChangedAreas: parsed.keyChangedAreas
        },
        null,
        2
      ),
      "utf8"
    );
    return {
      markdownPath,
      jsonPath
    };
  }

  private resolveProjectWorkspaceRoot(projectId: string): string {
    const implementationPlan = this.options.deps.implementationPlanRepository.getLatestByProjectId(projectId);
    if (!implementationPlan) {
      return this.options.deps.workspaceRoot;
    }

    const waves = this.options.deps.waveRepository.listByImplementationPlanId(implementationPlan.id);
    const waveStories = this.options.deps.waveStoryRepository.listByWaveIds(waves.map((wave) => wave.id));
    const latestExecutions = this.options.deps.waveStoryExecutionRepository.listLatestByWaveStoryIds(
      waveStories.map((waveStory) => waveStory.id)
    );

    const workspaceCandidates = latestExecutions.flatMap((execution) => {
      if (!execution.gitMetadataJson) {
        return [];
      }
      try {
        const gitMetadata = JSON.parse(execution.gitMetadataJson) as Partial<GitBranchMetadata>;
        return typeof gitMetadata.workspaceRoot === "string" && gitMetadata.workspaceRoot.length > 0
          ? [{ workspaceRoot: gitMetadata.workspaceRoot, updatedAt: execution.updatedAt }]
          : [];
      } catch {
        return [];
      }
    });

    if (workspaceCandidates.length === 0) {
      return this.options.deps.workspaceRoot;
    }

    const candidateSummary = new Map<string, { count: number; latestUpdatedAt: number }>();
    for (const candidate of workspaceCandidates) {
      const existing = candidateSummary.get(candidate.workspaceRoot);
      candidateSummary.set(candidate.workspaceRoot, {
        count: (existing?.count ?? 0) + 1,
        latestUpdatedAt: Math.max(existing?.latestUpdatedAt ?? 0, candidate.updatedAt)
      });
    }

    return [...candidateSummary.entries()]
      .sort((left, right) => {
        const byCount = right[1].count - left[1].count;
        if (byCount !== 0) {
          return byCount;
        }
        const leftIsRepoRoot = left[0] === this.options.deps.repoRoot;
        const rightIsRepoRoot = right[0] === this.options.deps.repoRoot;
        if (leftIsRepoRoot !== rightIsRepoRoot) {
          return Number(leftIsRepoRoot) - Number(rightIsRepoRoot);
        }
        return right[1].latestUpdatedAt - left[1].latestUpdatedAt;
      })[0]?.[0] ?? this.options.deps.workspaceRoot;
  }

  private buildDocumentationRunContext(input: {
    project: ReturnType<WorkflowEntityLoaders["requireProject"]>;
    item: ReturnType<WorkflowEntityLoaders["requireItem"]>;
    implementationPlan: ReturnType<WorkflowEntityLoaders["requireImplementationPlanForProject"]>;
    projectExecutionContext: ReturnType<DocumentationServiceOptions["ensureProjectExecutionContext"]>;
  }) {
    const concept = this.options.deps.conceptRepository.getLatestByItemId(input.item.id);
    const architecture = this.options.deps.architecturePlanRepository.getLatestByProjectId(input.project.id);
    const latestQaRun = this.options.deps.qaRunRepository.getLatestByProjectId(input.project.id);
    if (!latestQaRun || (latestQaRun.status !== "passed" && latestQaRun.status !== "review_required")) {
      throw new AppError("DOCUMENTATION_QA_INCOMPLETE", "Documentation requires a passed or review-required QA run");
    }

    const waves = this.options.deps.waveRepository.listByImplementationPlanId(input.implementationPlan.id);
    if (waves.length === 0) {
      throw new AppError("WAVES_NOT_FOUND", "Implementation plan has no waves");
    }

    const stories = this.options.deps.userStoryRepository.listByProjectId(input.project.id);
    const storyById = new Map(stories.map((story) => [story.id, story]));
    const acceptanceCriteriaByStoryId = this.groupAcceptanceCriteriaByStoryId(input.project.id);
    const acceptanceCriterionById = new Map(
      Array.from(acceptanceCriteriaByStoryId.values()).flat().map((criterion) => [criterion.id, criterion])
    );
    const waveStories = this.options.deps.waveStoryRepository.listByStoryIds(stories.map((story) => story.id));
    const waveStoryByStoryId = new Map(waveStories.map((waveStory) => [waveStory.storyId, waveStory]));
    const waveStoryCodesByWaveId = new Map(
      waves.map((wave) => [wave.id, waveStories.filter((waveStory) => waveStory.waveId === wave.id).map((waveStory) => storyById.get(waveStory.storyId)!.code)])
    );
    const latestTestPreparationByWaveStoryId = new Map(
      this.options.deps.waveStoryTestRunRepository
        .listLatestByWaveStoryIds(waveStories.map((waveStory) => waveStory.id))
        .map((testRun) => [testRun.waveStoryId, testRun])
    );
    const latestExecutionByWaveStoryId = new Map(
      this.options.deps.waveStoryExecutionRepository
        .listLatestByWaveStoryIds(waveStories.map((waveStory) => waveStory.id))
        .map((execution) => [execution.waveStoryId, execution])
    );
    const latestExecutions = Array.from(latestExecutionByWaveStoryId.values());
    const latestBasicVerificationByExecutionId = new Map(
      this.options.deps.verificationRunRepository
        .listLatestByWaveStoryExecutionIdsAndMode(latestExecutions.map((execution) => execution.id), "basic")
        .map((run) => [run.waveStoryExecutionId!, run])
    );
    const latestRalphVerificationByExecutionId = new Map(
      this.options.deps.verificationRunRepository
        .listLatestByWaveStoryExecutionIdsAndMode(latestExecutions.map((execution) => execution.id), "ralph")
        .map((run) => [run.waveStoryExecutionId!, run])
    );
    const latestStoryReviewByExecutionId = new Map(
      this.options.deps.storyReviewRunRepository
        .listLatestByWaveStoryExecutionIds(latestExecutions.map((execution) => execution.id))
        .map((run) => [run.waveStoryExecutionId, run])
    );
    const storyReviewFindingsByRunId = this.groupStoryReviewFindingsByRunId(
      Array.from(latestStoryReviewByExecutionId.values()).map((run) => run.id)
    );

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
        latestTestPreparation: this.options.parseTestPreparationOutput(latestTestPreparationRun),
        latestExecution: this.options.parseStoryExecutionOutput(latestExecution),
        latestBasicVerification: latestBasicVerification,
        latestRalphVerification: {
          id: latestRalphVerification.id,
          status: latestRalphVerification.status,
          summary: this.options.parseRalphVerificationOutput(latestRalphVerification)
        },
        latestStoryReview: {
          id: latestStoryReview.id,
          status: latestStoryReview.status,
          summary: this.options.parseStoryReviewOutput(latestStoryReview),
          findings: storyReviewFindingsByRunId.get(latestStoryReview.id) ?? []
        }
      };
    });

    const openQaFindings = this.options.deps.qaFindingRepository
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

  private groupAcceptanceCriteriaByStoryId(projectId: string) {
    return this.options.deps.acceptanceCriterionRepository.listByProjectId(projectId).reduce((map, criterion) => {
      const current = map.get(criterion.storyId) ?? [];
      current.push(criterion);
      map.set(criterion.storyId, current);
      return map;
    }, new Map<string, ReturnType<WorkflowDeps["acceptanceCriterionRepository"]["listByProjectId"]>>());
  }

  private groupStoryReviewFindingsByRunId(storyReviewRunIds: string[]) {
    return this.options.deps.storyReviewFindingRepository.listByStoryReviewRunIds(storyReviewRunIds).reduce((map, finding) => {
      const current = map.get(finding.storyReviewRunId) ?? [];
      current.push(finding);
      map.set(finding.storyReviewRunId, current);
      return map;
    }, new Map<string, ReturnType<WorkflowDeps["storyReviewFindingRepository"]["listByStoryReviewRunId"]>>());
  }
}
