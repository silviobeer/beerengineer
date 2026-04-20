import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  architecturePlanOutputSchema,
  implementationPlanOutputSchema,
  projectsOutputSchema,
  storiesOutputSchema,
  type ArchitecturePlanOutput,
  type ImplementationPlanOutput,
  type ProjectsOutput,
  type StoriesOutput
} from "../schemas/output-contracts.js";
import { formatAcceptanceCriterionCode, formatStoryCode } from "../shared/codes.js";
import { AppError } from "../shared/errors.js";
import type { ArtifactRecord } from "../persistence/repositories.js";
import type { StageKey } from "../domain/types.js";
import type { WorkflowDeps } from "./workflow-deps.js";

type ImportOutcome = { status: "completed" | "review_required"; reviewReason: string | null };

export class WorkflowOutputImporters {
  public constructor(
    private readonly deps: WorkflowDeps,
    private readonly options: {
      requireProject(projectId: string): NonNullable<ReturnType<WorkflowDeps["projectRepository"]["getById"]>>;
    }
  ) {}

  public importOutputs(input: {
    stageKey: StageKey;
    itemId: string;
    projectId: string | null;
    artifactsByKind: Map<string, ArtifactRecord>;
  }): ImportOutcome {
    switch (input.stageKey) {
      case "brainstorm":
        return this.importBrainstormOutputs(input);
      case "requirements":
        return this.importRequirementsOutputs(input);
      case "architecture":
        return this.importArchitectureOutputs(input);
      case "planning":
        return this.importPlanningOutputs(input);
    }
  }

  public parseProjectsArtifact(artifact: ArtifactRecord): ProjectsOutput {
    return this.readStructuredArtifact(artifact, projectsOutputSchema);
  }

  private importBrainstormOutputs(input: {
    itemId: string;
    artifactsByKind: Map<string, ArtifactRecord>;
  }): ImportOutcome {
    const conceptArtifact = input.artifactsByKind.get("concept");
    const projectsArtifact = input.artifactsByKind.get("projects");
    if (!conceptArtifact || !projectsArtifact) {
      return {
        status: "review_required",
        reviewReason: "Brainstorm output is missing concept or projects artifacts"
      };
    }

    try {
      const projects = this.readStructuredArtifact<ProjectsOutput>(projectsArtifact, projectsOutputSchema);
      const previous = this.deps.conceptRepository.getLatestByItemId(input.itemId);
      if (previous?.structuredArtifactId === projectsArtifact.id) {
        return { status: "completed", reviewReason: null };
      }

      const markdownContent = this.readArtifactContent(conceptArtifact);
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
  }): ImportOutcome {
    const { projectId } = input;
    if (!projectId) {
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
      const parsed = this.readStructuredArtifact<StoriesOutput>(storiesArtifact, storiesOutputSchema);
      if (this.deps.userStoryRepository.hasAnyByProjectId(projectId)) {
        return { status: "completed", reviewReason: null };
      }

      const project = this.options.requireProject(projectId);
      const createdStories = this.deps.userStoryRepository.createMany(
        parsed.stories.map((story, index) => ({
          projectId,
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
        throw new AppError(
          "REQUIREMENTS_IMPORT_MISMATCH",
          "Requirements import created a different number of stories than parsed output"
        );
      }

      this.deps.acceptanceCriterionRepository.createMany(
        createdStories.flatMap((storyRecord, storyIndex) =>
          parsed.stories[storyIndex].acceptanceCriteria.map((criterion, criterionIndex) => ({
            storyId: storyRecord.id,
            code: formatAcceptanceCriterionCode(storyRecord.code, criterionIndex + 1),
            text: criterion,
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
  }): ImportOutcome {
    const { projectId } = input;
    if (!projectId) {
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
      const parsed = this.readStructuredArtifact<ArchitecturePlanOutput>(jsonArtifact, architecturePlanOutputSchema);
      const previous = this.deps.architecturePlanRepository.getLatestByProjectId(projectId);
      if (previous?.structuredArtifactId === jsonArtifact.id) {
        return { status: "completed", reviewReason: null };
      }

      this.deps.architecturePlanRepository.create({
        projectId,
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
  }): ImportOutcome {
    const { projectId } = input;
    if (!projectId) {
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
      const parsed = this.readStructuredArtifact<ImplementationPlanOutput>(jsonArtifact, implementationPlanOutputSchema);
      const previous = this.deps.implementationPlanRepository.getLatestByProjectId(projectId);
      if (previous?.structuredArtifactId === jsonArtifact.id) {
        return { status: "completed", reviewReason: null };
      }

      const stories = this.deps.userStoryRepository.listByProjectId(projectId);
      const storyByCode = new Map(stories.map((story) => [story.code, story]));
      const assignedStoryCodes = new Set<string>();
      const waveCodeSet = new Set<string>();

      parsed.waves.forEach((wave, waveIndex) => {
        this.assertPlanningImportCondition(
          !waveCodeSet.has(wave.waveCode),
          "PLANNING_DUPLICATE_WAVE_CODE",
          `Duplicate wave code ${wave.waveCode}`
        );
        waveCodeSet.add(wave.waveCode);
        this.assertPlanningImportCondition(
          wave.stories.length > 0,
          "PLANNING_EMPTY_WAVE",
          `Wave ${wave.waveCode} must contain at least one story`
        );
        wave.stories.forEach((plannedStory) => {
          this.assertPlanningImportCondition(
            storyByCode.has(plannedStory.storyCode),
            "PLANNING_UNKNOWN_STORY_CODE",
            `Unknown story code ${plannedStory.storyCode} in wave ${wave.waveCode}`
          );
          this.assertPlanningImportCondition(
            !assignedStoryCodes.has(plannedStory.storyCode),
            "PLANNING_DUPLICATE_STORY_ASSIGNMENT",
            `Story ${plannedStory.storyCode} is assigned more than once`
          );
          assignedStoryCodes.add(plannedStory.storyCode);
          plannedStory.dependsOnStoryCodes.forEach((dependencyCode) => {
            this.assertPlanningImportCondition(
              storyByCode.has(dependencyCode),
              "PLANNING_UNKNOWN_STORY_DEPENDENCY",
              `Unknown story dependency ${dependencyCode} for ${plannedStory.storyCode}`
            );
          });
        });
        this.assertPlanningImportCondition(
          waveIndex !== 0 || wave.dependsOn.length === 0,
          "PLANNING_INVALID_FIRST_WAVE_DEPENDENCY",
          `First wave ${wave.waveCode} cannot depend on earlier waves`
        );
      });

      this.assertPlanningImportCondition(
        assignedStoryCodes.size === stories.length,
        "PLANNING_INCOMPLETE_STORY_ASSIGNMENT",
        "Implementation plan must assign every project story exactly once"
      );

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
            this.assertPlanningImportCondition(
              dependencyWaveIndex !== undefined && plannedWaveIndex !== undefined,
              "PLANNING_MISSING_DEPENDENCY_ASSIGNMENT",
              `Missing wave assignment for story dependency ${dependencyCode}`
            );
            this.assertPlanningImportCondition(
              dependencyWaveIndex <= plannedWaveIndex,
              "PLANNING_FORWARD_STORY_DEPENDENCY",
              `Story ${plannedStory.storyCode} depends on later story ${dependencyCode}`
            );
          });
        });

        wave.dependsOn.forEach((dependencyWaveCode) => {
          const dependencyIndex = waveIndexByCode.get(dependencyWaveCode);
          const currentIndex = waveIndexByCode.get(wave.waveCode);
          this.assertPlanningImportCondition(
            dependencyIndex !== undefined && currentIndex !== undefined && dependencyIndex < currentIndex,
            "PLANNING_INVALID_WAVE_DEPENDENCY",
            `Wave ${wave.waveCode} depends on unknown or non-earlier wave ${dependencyWaveCode}`
          );
        });
      });

      const createdPlan = this.deps.implementationPlanRepository.create({
        projectId,
        version: (previous?.version ?? 0) + 1,
        summary: parsed.summary,
        status: "draft",
        markdownArtifactId: markdownArtifact.id,
        structuredArtifactId: jsonArtifact.id
      });

      const waves = this.deps.waveRepository.createMany(
        parsed.waves.map((wave, index) => ({
          implementationPlanId: createdPlan.id,
          code: wave.waveCode,
          goal: wave.goal,
          position: index
        }))
      );

      const waveByCode = new Map(waves.map((wave) => [wave.code, wave]));
      const waveStories = this.deps.waveStoryRepository.createMany(
        parsed.waves.flatMap((wave) =>
          wave.stories.map((plannedStory, index) => ({
            waveId: this.requireMappedValue(waveByCode, wave.waveCode, "WAVE_IMPORT_MAPPING_MISSING", `Wave ${wave.waveCode} was not created`).id,
            storyId: this.requireMappedValue(
              storyByCode,
              plannedStory.storyCode,
              "STORY_IMPORT_MAPPING_MISSING",
              `Story ${plannedStory.storyCode} was not found during planning import`
            ).id,
            parallelGroup: plannedStory.parallelGroup ?? null,
            position: index
          }))
        )
      );
      if (waveStories.length !== stories.length) {
        throw new AppError(
          "PLANNING_IMPORT_MISMATCH",
          "Implementation plan import created a different number of wave stories than planned"
        );
      }

      this.deps.waveStoryDependencyRepository.createMany(
        parsed.waves.flatMap((wave) =>
          wave.stories.flatMap((plannedStory) =>
            plannedStory.dependsOnStoryCodes.map((dependencyCode) => ({
              blockingStoryId: this.requireMappedValue(
                storyByCode,
                dependencyCode,
                "PLANNING_DEPENDENCY_MAPPING_MISSING",
                `Dependency story ${dependencyCode} was not found during planning import`
              ).id,
              dependentStoryId: this.requireMappedValue(
                storyByCode,
                plannedStory.storyCode,
                "PLANNING_DEPENDENT_MAPPING_MISSING",
                `Dependent story ${plannedStory.storyCode} was not found during planning import`
              ).id
            }))
          )
        )
      );

      return { status: "completed", reviewReason: null };
    } catch (error) {
      return this.buildReviewOutcome("planning", error);
    }
  }

  private readArtifactContent(artifact: ArtifactRecord): string {
    return readFileSync(resolve(this.deps.artifactRoot, artifact.path), "utf8");
  }

  private readStructuredArtifact<TOutput>(
    artifact: ArtifactRecord,
    schema: { parse(value: unknown): TOutput }
  ): TOutput {
    return schema.parse(JSON.parse(this.readArtifactContent(artifact)));
  }

  private extractHeading(markdown: string): string {
    const line = markdown.split("\n").find((entry) => entry.startsWith("# "));
    return line ? line.replace(/^#\s+/, "") : "Concept";
  }

  private assertPlanningImportCondition(condition: unknown, code: string, message: string): asserts condition {
    if (!condition) {
      throw new AppError(code, message);
    }
  }

  private buildReviewOutcome(stageKey: StageKey, error: unknown): ImportOutcome {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "review_required",
      reviewReason: `Failed to import ${stageKey} output: ${message}`
    };
  }

  private requireMappedValue<TKey, TValue>(
    map: Map<TKey, TValue>,
    key: TKey,
    code: string,
    message: string
  ): TValue {
    const value = map.get(key);
    if (value === undefined) {
      throw new AppError(code, message);
    }
    return value;
  }
}
