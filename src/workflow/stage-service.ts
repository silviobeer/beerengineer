import { buildItemWorkflowSnapshot } from "../domain/aggregate-status.js";
import { assertCanMoveItem } from "../domain/workflow-rules.js";
import type { PlanningReviewReadinessResult, PlanningReviewRun, StageKey } from "../domain/types.js";
import type { AdapterRuntimeContext } from "../adapters/types.js";
import type { ArtifactRecord } from "../persistence/repositories.js";
import { AppError } from "../shared/errors.js";
import { formatProjectCode } from "../shared/codes.js";
import { assertStageRunTransitionAllowed } from "./stage-run-rules.js";
import { runProfiles } from "./run-profiles.js";
import { ArtifactService } from "../services/artifact-service.js";
import { PromptResolver } from "../services/prompt-resolver.js";
import type { ReviewCoreService } from "../review/review-core-service.js";
import type { WorkflowDeps } from "./workflow-deps.js";
import type { WorkflowEntityLoaders } from "./entity-loaders.js";
import { WorkflowOutputImporters } from "./output-importers.js";

export class StageService {
  public constructor(
    private readonly options: {
      deps: WorkflowDeps;
      artifactService: ArtifactService;
      promptResolver: PromptResolver;
      reviewCoreService: ReviewCoreService;
      loaders: WorkflowEntityLoaders;
      outputImporters: WorkflowOutputImporters;
      resolveStageRuntime(stageKey: StageKey): {
        adapterKey: string;
        providerKey: string;
        model: string | null;
        policy: AdapterRuntimeContext["policy"];
        adapter: WorkflowDeps["agentRuntimeResolver"] extends { resolveStage(stageKey: StageKey): infer T }
          ? T extends { adapter: infer A }
            ? A
            : never
          : never;
      };
      buildAdapterRuntimeContext(input: {
        providerKey: string;
        model: string | null;
        policy: AdapterRuntimeContext["policy"];
      }): AdapterRuntimeContext;
      triggerPlanningReview?(input: {
        sourceType: "architecture_plan" | "implementation_plan";
        sourceId: string;
        step: "architecture" | "plan_writing";
        reviewMode: "readiness";
        interactionMode: "interactive";
        automationLevel: "auto_comment";
      }): Promise<unknown>;
    }
  ) {}

  public async startStage(input: {
    stageKey: StageKey;
    itemId: string;
    projectId?: string;
  }): Promise<{ runId: string; status: string; planningReview?: unknown }> {
    const item = this.options.loaders.requireItem(input.itemId);
    const project = input.projectId ? this.options.loaders.requireProject(input.projectId) : null;
    const profile = runProfiles[input.stageKey];
    const resolved = this.options.promptResolver.resolve(profile);
    const runtime = this.options.resolveStageRuntime(input.stageKey);
    const inputArtifactIds = this.resolveInputArtifactIds(input.stageKey, item.id, project?.id ?? null);
    const inputSnapshot = this.buildStageInputSnapshot(item, project);

    const run = this.options.deps.runInTransaction(() => {
      const createdRun = this.options.deps.stageRunRepository.create({
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
      this.options.deps.stageRunRepository.linkInputArtifacts(createdRun.id, inputArtifactIds);
      this.transitionRun(createdRun.id, "pending", "running");
      this.options.deps.itemRepository.updatePhaseStatus(item.id, "running");
      if (input.stageKey === "brainstorm" && item.currentColumn === "idea") {
        this.options.deps.itemRepository.updateColumn(item.id, "brainstorm", "running");
      }
      return createdRun;
    });

    try {
      const result = await runtime.adapter.run({
        runtime: this.options.buildAdapterRuntimeContext(runtime),
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
        context: project ? this.buildProjectStageContext(project.id, item.id) : null
      });

      const completedRun = this.options.deps.runInTransaction(() => {
        this.options.deps.agentSessionRepository.create({
          stageRunId: run.id,
          adapterKey: runtime.adapterKey,
          status: result.exitCode === 0 ? "completed" : "failed",
          commandJson: JSON.stringify(result.command),
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode
        });

        const outputArtifacts = this.persistArtifacts({
          workspaceKey: this.options.deps.workspace.key,
          itemId: item.id,
          projectId: project?.id ?? null,
          runId: run.id,
          markdownArtifacts: result.markdownArtifacts,
          structuredArtifacts: result.structuredArtifacts
        });

        const importOutcome = this.options.outputImporters.importOutputs({
          stageKey: input.stageKey,
          itemId: item.id,
          projectId: project?.id ?? null,
          artifactsByKind: new Map(outputArtifacts.map((artifact) => [artifact.kind, artifact]))
        });
        this.transitionRun(run.id, "running", importOutcome.status, {
          outputSummaryJson: JSON.stringify(
            {
              stageKey: input.stageKey,
              artifactKinds: outputArtifacts.map((artifact) => artifact.kind),
              artifactIds: outputArtifacts.map((artifact) => artifact.id),
              finalStatus: importOutcome.status,
              reviewReason: importOutcome.reviewReason
            },
            null,
            2
          ),
          errorMessage: importOutcome.reviewReason ?? null
        });
        this.options.deps.itemRepository.updatePhaseStatus(
          item.id,
          importOutcome.status === "completed" ? "completed" : "review_required"
        );
        return { runId: run.id, status: importOutcome.status };
      });

      if (completedRun.status === "completed" && this.options.triggerPlanningReview && project) {
        if (input.stageKey === "architecture") {
          const latest = this.options.deps.architecturePlanRepository.getLatestByProjectId(project.id);
          if (latest) {
            return {
              ...completedRun,
              planningReview: await this.options.triggerPlanningReview({
                sourceType: "architecture_plan",
                sourceId: latest.id,
                step: "architecture",
                reviewMode: "readiness",
                interactionMode: "interactive",
                automationLevel: "auto_comment"
              })
            };
          }
        }
        if (input.stageKey === "planning") {
          const latest = this.options.deps.implementationPlanRepository.getLatestByProjectId(project.id);
          if (latest) {
            return {
              ...completedRun,
              planningReview: await this.options.triggerPlanningReview({
                sourceType: "implementation_plan",
                sourceId: latest.id,
                step: "plan_writing",
                reviewMode: "readiness",
                interactionMode: "interactive",
                automationLevel: "auto_comment"
              })
            };
          }
        }
      }

      return completedRun;
    } catch (error) {
      this.options.deps.runInTransaction(() => {
        this.transitionRun(run.id, "running", "failed", {
          errorMessage: error instanceof Error ? error.message : String(error)
        });
        this.options.deps.itemRepository.updatePhaseStatus(item.id, "failed");
      });
      throw error;
    }
  }

  public importProjects(itemId: string): { importedCount: number } {
    const item = this.options.loaders.requireItem(itemId);
    const concept = this.options.deps.conceptRepository.getLatestByItemId(itemId);
    if (concept?.status !== "approved") {
      throw new AppError("CONCEPT_NOT_APPROVED", "Concept must be approved before project import");
    }

    const artifact = this.options.deps.artifactRepository.getLatestByKind({ itemId, kind: "projects" });
    if (!artifact) {
      throw new AppError("ARTIFACT_NOT_FOUND", "No projects artifact found");
    }

    const parsed = this.options.outputImporters.parseProjectsArtifact(artifact);
    const existingProjects = this.options.deps.projectRepository.listByConceptId(concept.id);
    if (existingProjects.length > 0) {
      return { importedCount: 0 };
    }

    this.options.deps.projectRepository.createMany(
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
    this.options.deps.itemRepository.updateColumn(itemId, "requirements", "draft");
    return { importedCount: parsed.projects.length };
  }

  public approveConcept(conceptId: string): void {
    const concept = this.options.deps.conceptRepository.getById(conceptId);
    if (!concept) {
      throw new AppError("CONCEPT_NOT_FOUND", `Concept ${conceptId} not found`);
    }
    if (concept.status !== "approved") {
      this.options.deps.conceptRepository.updateStatus(conceptId, "approved");
    }
  }

  public approveStories(projectId: string): void {
    if (!this.options.deps.userStoryRepository.hasAnyByProjectId(projectId)) {
      throw new AppError("STORIES_NOT_FOUND", "No user stories found for project");
    }
    this.assertRequirementsPlanningReviewGate(projectId);
    this.options.deps.userStoryRepository.approveByProjectId(projectId);
    const project = this.options.loaders.requireProject(projectId);
    const snapshot = this.buildSnapshot(project.itemId);
    if (snapshot.allStoriesApproved) {
      const item = this.options.loaders.requireItem(project.itemId);
      assertCanMoveItem(item.currentColumn, "implementation", snapshot);
      this.options.deps.itemRepository.updateColumn(project.itemId, "implementation", "draft");
    }
  }

  public approveArchitecture(projectId: string): void {
    this.options.loaders.requireProject(projectId);
    const latest = this.options.deps.architecturePlanRepository.getLatestByProjectId(projectId);
    if (!latest) {
      throw new AppError("ARCHITECTURE_NOT_FOUND", "No architecture plan found for project");
    }
    this.assertPlanningReviewGate({
      sourceType: "architecture_plan",
      sourceId: latest.id,
      stepLabel: "architecture approval"
    });
    if (latest.status !== "approved") {
      this.options.deps.architecturePlanRepository.updateStatus(latest.id, "approved");
    }
  }

  public approvePlanning(projectId: string): void {
    this.options.loaders.requireProject(projectId);
    const latest = this.options.deps.implementationPlanRepository.getLatestByProjectId(projectId);
    if (!latest) {
      throw new AppError("IMPLEMENTATION_PLAN_NOT_FOUND", "No implementation plan found for project");
    }
    this.assertPlanningReviewGate({
      sourceType: "implementation_plan",
      sourceId: latest.id,
      stepLabel: "planning approval"
    });
    if (latest.status !== "approved") {
      this.options.deps.implementationPlanRepository.updateStatus(latest.id, "approved");
    }
  }

  private assertRequirementsPlanningReviewGate(projectId: string): void {
    const latestInteractiveReview = this.options.deps.interactiveReviewSessionRepository.getLatestByScope({
      scopeType: "project",
      scopeId: projectId,
      artifactType: "stories",
      reviewType: "collection_review"
    });
    if (!latestInteractiveReview) {
      return;
    }
    this.assertPlanningReviewGate({
      sourceType: "interactive_review_session",
      sourceId: latestInteractiveReview.id,
      stepLabel: "story approval"
    });
  }

  private assertPlanningReviewGate(input: {
    sourceType: PlanningReviewRun["sourceType"];
    sourceId: string;
    stepLabel: string;
  }): void {
    const latestCoreRun = this.options.reviewCoreService.getLatestBlockingRunForGate({
      reviewKind: "planning",
      subjectType: input.sourceType,
      subjectId: input.sourceId
    });
    if (latestCoreRun) {
      throw new AppError(
        "PLANNING_REVIEW_GATE_BLOCKED",
        `${input.stepLabel} is blocked by planning review ${latestCoreRun.id} (${latestCoreRun.status}/${latestCoreRun.readiness}).`
      );
    }

    const latestRun = this.options.deps.planningReviewRunRepository.getLatestBySource({
      sourceType: input.sourceType,
      sourceId: input.sourceId
    });
    if (!this.shouldEnforcePlanningReviewGate(latestRun)) {
      return;
    }
    throw new AppError(
      "PLANNING_REVIEW_GATE_BLOCKED",
      `${input.stepLabel} is blocked by planning review ${latestRun.id} (${latestRun.status}/${latestRun.readiness}).`
    );
  }

  private shouldEnforcePlanningReviewGate(run: PlanningReviewRun | null): run is PlanningReviewRun {
    if (!run) {
      return false;
    }
    if (run.automationLevel !== "auto_gate") {
      return false;
    }
    if (run.gateEligibility !== "advisory") {
      return false;
    }
    return !this.isPlanningReviewReadyForGate(run.readiness, run.status);
  }

  private isPlanningReviewReadyForGate(
    readiness: PlanningReviewReadinessResult | null,
    status: PlanningReviewRun["status"]
  ): boolean {
    return status === "ready" && (readiness === "ready" || readiness === "ready_with_assumptions");
  }

  public async retryRun(runId: string): Promise<{ runId: string; status: string; retriedFromRunId: string }> {
    const run = this.options.deps.stageRunRepository.getById(runId);
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
    return { ...next, retriedFromRunId: runId };
  }

  public buildSnapshot(itemId: string) {
    const concept = this.options.deps.conceptRepository.getLatestByItemId(itemId);
    const projects = this.options.deps.projectRepository.listByItemId(itemId);
    const storiesByProjectId = new Map(
      projects.map((project) => [project.id, this.options.deps.userStoryRepository.listByProjectId(project.id)])
    );
    const implementationPlansByProjectId = new Map(
      projects.map((project) => [project.id, this.options.deps.implementationPlanRepository.getLatestByProjectId(project.id)])
    );
    return buildItemWorkflowSnapshot({
      concept,
      projects,
      storiesByProjectId,
      implementationPlansByProjectId
    });
  }

  public persistArtifacts(input: {
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
      records.push(this.persistArtifactRecord({ ...input, artifact, format: "md", content: artifact.content }));
    }
    for (const artifact of input.structuredArtifacts) {
      records.push(
        this.persistArtifactRecord({
          ...input,
          artifact,
          format: "json",
          content: JSON.stringify(artifact.content, null, 2)
        })
      );
    }
    return records;
  }

  public getLatestStageRun(input: { itemId: string; projectId?: string; stageKey: StageKey }) {
    const runs = input.projectId
      ? this.options.deps.stageRunRepository.listByProjectId(input.projectId)
      : this.options.deps.stageRunRepository.listByItemId(input.itemId);
    return [...runs].reverse().find((run) => run.stageKey === input.stageKey) ?? null;
  }

  private buildStageInputSnapshot(
    item: ReturnType<WorkflowEntityLoaders["requireItem"]>,
    project: ReturnType<WorkflowEntityLoaders["requireProject"]> | null
  ): string {
    return JSON.stringify(
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
  }

  private buildProjectStageContext(projectId: string, itemId: string) {
    return {
      conceptSummary: this.options.deps.conceptRepository.getLatestByItemId(itemId)?.summary ?? null,
      architectureSummary: this.options.deps.architecturePlanRepository.getLatestByProjectId(projectId)?.summary ?? null,
      stories: this.options.deps.userStoryRepository.listByProjectId(projectId).map((story) => ({
        code: story.code,
        title: story.title,
        priority: story.priority,
        acceptanceCriteria: this.options.deps.acceptanceCriterionRepository.listByStoryId(story.id).map((criterion) => ({
          code: criterion.code,
          text: criterion.text
        }))
      }))
    };
  }

  private persistArtifactRecord(input: {
    workspaceKey: string;
    itemId: string;
    projectId: string | null;
    runId: string;
    linkStageRunId?: boolean;
    artifact: { kind: string };
    format: "md" | "json";
    content: string;
  }): ArtifactRecord {
    const written = this.options.artifactService.writeArtifact({
      workspaceKey: input.workspaceKey,
      itemId: input.itemId,
      projectId: input.projectId,
      stageRunId: input.runId,
      kind: input.artifact.kind,
      format: input.format,
      content: input.content
    });
    return this.options.deps.artifactRepository.create({
      stageRunId: input.linkStageRunId === false ? null : input.runId,
      itemId: input.itemId,
      projectId: input.projectId,
      kind: input.artifact.kind,
      format: input.format,
      path: written.path,
      sha256: written.sha256,
      sizeBytes: written.sizeBytes
    });
  }

  private transitionRun(
    runId: string,
    current: "pending" | "running",
    next: "running" | "completed" | "failed" | "review_required",
    options?: { outputSummaryJson?: string | null; errorMessage?: string | null }
  ): void {
    assertStageRunTransitionAllowed(current, next);
    this.options.deps.stageRunRepository.updateStatus(runId, next, options);
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
      const artifact = this.options.deps.artifactRepository.getLatestByKind({
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
}
