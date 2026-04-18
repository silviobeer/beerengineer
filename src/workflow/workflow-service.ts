import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildItemWorkflowSnapshot } from "../domain/aggregate-status.js";
import { assertCanMoveItem } from "../domain/workflow-rules.js";
import type { StageKey } from "../domain/types.js";
import { PromptResolver } from "../services/prompt-resolver.js";
import { ArtifactService } from "../services/artifact-service.js";
import {
  architecturePlanOutputSchema,
  projectsOutputSchema,
  storiesOutputSchema
} from "../schemas/output-contracts.js";
import type {
  ArchitecturePlanOutput,
  ProjectsOutput,
  StoriesOutput
} from "../schemas/output-contracts.js";
import { AppError } from "../shared/errors.js";
import { formatAcceptanceCriterionCode, formatProjectCode, formatStoryCode } from "../shared/codes.js";
import type {
  AcceptanceCriterionRepository,
  ArchitecturePlanRepository,
  ArtifactRecord,
  ArtifactRepository,
  AgentSessionRepository,
  ConceptRepository,
  ItemRepository,
  ProjectRepository,
  StageRunRepository,
  UserStoryRepository
} from "../persistence/repositories.js";
import { assertStageRunTransitionAllowed } from "./stage-run-rules.js";
import { runProfiles } from "./run-profiles.js";
import type { AgentAdapter } from "../adapters/types.js";

type WorkflowDeps = {
  repoRoot: string;
  artifactRoot: string;
  runInTransaction<T>(fn: () => T): T;
  adapter: AgentAdapter;
  itemRepository: ItemRepository;
  conceptRepository: ConceptRepository;
  projectRepository: ProjectRepository;
  userStoryRepository: UserStoryRepository;
  acceptanceCriterionRepository: AcceptanceCriterionRepository;
  architecturePlanRepository: ArchitecturePlanRepository;
  stageRunRepository: StageRunRepository;
  artifactRepository: ArtifactRepository;
  agentSessionRepository: AgentSessionRepository;
};

export class WorkflowService {
  private readonly promptResolver: PromptResolver;
  private readonly artifactService: ArtifactService;

  public constructor(private readonly deps: WorkflowDeps) {
    this.promptResolver = new PromptResolver(deps.repoRoot);
    this.artifactService = new ArtifactService(deps.artifactRoot);
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
    const project = this.requireProject(projectId);
    const latest = this.deps.architecturePlanRepository.getLatestByProjectId(projectId);
    if (!latest) {
      throw new AppError("ARCHITECTURE_NOT_FOUND", "No architecture plan found for project");
    }
    if (latest.status === "approved") {
      return;
    }
    this.deps.architecturePlanRepository.updateStatus(latest.id, "approved");
    const snapshot = this.buildSnapshot(project.itemId);
    if (snapshot.allArchitectureApproved) {
      this.deps.itemRepository.updatePhaseStatus(project.itemId, "completed");
    }
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

  private buildSnapshot(itemId: string) {
    const concept = this.deps.conceptRepository.getLatestByItemId(itemId);
    const projects = this.deps.projectRepository.listByItemId(itemId);
    const storiesByProjectId = new Map(
      projects.map((project) => [project.id, this.deps.userStoryRepository.listByProjectId(project.id)])
    );
    const architecturePlansByProjectId = new Map(
      projects.map((project) => [project.id, this.deps.architecturePlanRepository.getLatestByProjectId(project.id)])
    );
    return buildItemWorkflowSnapshot({
      concept,
      projects,
      storiesByProjectId,
      architecturePlansByProjectId
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
    return this.importArchitectureOutputs(input);
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

  private persistArtifacts(input: {
    itemId: string;
    projectId: string | null;
    runId: string;
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
        stageRunId: input.runId,
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
        stageRunId: input.runId,
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

  private transitionRun(
    runId: string,
    current: "pending" | "running",
    next: "running" | "completed" | "failed" | "review_required",
    options?: { outputSummaryJson?: string | null; errorMessage?: string | null }
  ): void {
    assertStageRunTransitionAllowed(current, next);
    this.deps.stageRunRepository.updateStatus(runId, next, options);
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

  private extractHeading(markdown: string): string {
    const line = markdown.split("\n").find((entry) => entry.startsWith("# "));
    return line ? line.replace(/^#\s+/, "") : "Concept";
  }

  private resolveInputArtifactIds(stageKey: StageKey, itemId: string, projectId: string | null): string[] {
    const kindsByStage: Record<StageKey, string[]> = {
      brainstorm: [],
      requirements: ["concept", "projects"],
      architecture: ["concept", "projects", "stories", "stories-markdown"]
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
