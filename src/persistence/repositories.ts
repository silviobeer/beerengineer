import { and, desc, eq, inArray, isNull, notInArray } from "drizzle-orm";

import type {
  AcceptanceCriterion,
  ArchitecturePlan,
  BoardColumn,
  Concept,
  DocumentationAgentSession,
  DocumentationRun,
  DocumentationRunStatus,
  ExecutionAgentSession,
  GitBranchMetadata,
  InteractiveReviewEntry,
  InteractiveReviewEntryStatus,
  InteractiveReviewMessage,
  InteractiveReviewResolution,
  InteractiveReviewSession,
  ImplementationPlan,
  Item,
  ItemPhaseStatus,
  StoryReviewAgentSession,
  StoryReviewFinding,
  StoryReviewFindingCategory,
  StoryReviewFindingSeverity,
  StoryReviewFindingStatus,
  StoryReviewRemediationAgentSession,
  StoryReviewRemediationFinding,
  StoryReviewRemediationRun,
  StoryReviewRun,
  StoryReviewRunStatus,
  QaAgentSession,
  QaFinding,
  QaFindingCategory,
  QaFindingSeverity,
  QaFindingStatus,
  QaRun,
  QaRunMode,
  QaRunStatus,
  ProjectExecutionContext,
  Project,
  RecordStatus,
  StageKey,
  StageRunStatus,
  TestAgentSession,
  UserStory,
  VerificationRun,
  VerificationRunMode,
  Workspace,
  WorkspaceSettings,
  Wave,
  WaveExecution,
  WaveExecutionStatus,
  WaveStoryTestRun,
  WaveStoryTestRunStatus,
  WaveStory,
  WaveStoryDependency,
  WaveStoryExecution,
  WaveStoryExecutionStatus
} from "../domain/types.js";
import { AppError } from "../shared/errors.js";
import { formatItemCode, parseItemCodeSequence } from "../shared/codes.js";
import { createId } from "../shared/ids.js";
import type { DatabaseClient } from "./database.js";
import {
  acceptanceCriteria,
  agentSessions,
  architecturePlans,
  artifacts,
  concepts,
  documentationAgentSessions,
  documentationRuns,
  executionAgentSessions,
  implementationPlans,
  interactiveReviewEntries,
  interactiveReviewMessages,
  interactiveReviewResolutions,
  interactiveReviewSessions,
  items,
  qaAgentSessions,
  qaFindings,
  qaRuns,
  projectExecutionContexts,
  projects,
  workspaceSettings,
  workspaces,
  storyReviewAgentSessions,
  storyReviewFindings,
  storyReviewRemediationAgentSessions,
  storyReviewRemediationFindings,
  storyReviewRemediationRuns,
  storyReviewRuns,
  stageRunInputArtifacts,
  stageRuns,
  testAgentSessions,
  userStories,
  verificationRuns,
  waveExecutions,
  waveStoryTestRuns,
  waveStoryExecutions,
  waveStories,
  waves,
  waveStoryDependencies
} from "./schema.js";

function now(): number {
  return Date.now();
}

function parseStringList(value: string): string[] {
  return JSON.parse(value) as string[];
}

function stringifyStringList(value: string[]): string {
  return JSON.stringify(value);
}

export class WorkspaceRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public getById(id: string): Workspace | null {
    return (this.db.select().from(workspaces).where(eq(workspaces.id, id)).get() as Workspace | undefined) ?? null;
  }

  public getByKey(key: string): Workspace | null {
    return (this.db.select().from(workspaces).where(eq(workspaces.key, key)).get() as Workspace | undefined) ?? null;
  }

  public listAll(): Workspace[] {
    return this.db.select().from(workspaces).orderBy(workspaces.createdAt, workspaces.id).all() as Workspace[];
  }

  public create(input: Omit<Workspace, "id" | "createdAt" | "updatedAt">): Workspace {
    const timestamp = now();
    const row: Workspace = {
      ...input,
      id: createId("workspace"),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.db.insert(workspaces).values(row).run();
    return row;
  }

  public update(input: Pick<Workspace, "id"> & Partial<Pick<Workspace, "name" | "description" | "rootPath">>): Workspace {
    const existing = this.getById(input.id);
    if (!existing) {
      throw new AppError("WORKSPACE_NOT_FOUND", `Workspace ${input.id} not found`);
    }
    const updated: Workspace = {
      ...existing,
      ...input,
      updatedAt: now()
    };
    this.db
      .update(workspaces)
      .set({
        name: updated.name,
        description: updated.description,
        rootPath: updated.rootPath,
        updatedAt: updated.updatedAt
      })
      .where(eq(workspaces.id, input.id))
      .run();
    return updated;
  }
}

export class WorkspaceSettingsRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public getByWorkspaceId(workspaceId: string): WorkspaceSettings | null {
    return (
      this.db.select().from(workspaceSettings).where(eq(workspaceSettings.workspaceId, workspaceId)).get() as
        | WorkspaceSettings
        | undefined
    ) ?? null;
  }

  public create(input: Omit<WorkspaceSettings, "createdAt" | "updatedAt">): WorkspaceSettings {
    const timestamp = now();
    const row: WorkspaceSettings = {
      ...input,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.db.insert(workspaceSettings).values(row).run();
    return row;
  }

  public update(
    workspaceId: string,
    input: Partial<
      Omit<WorkspaceSettings, "workspaceId" | "createdAt" | "updatedAt">
    >
  ): WorkspaceSettings {
    const existing = this.getByWorkspaceId(workspaceId);
    if (!existing) {
      throw new AppError("WORKSPACE_SETTINGS_NOT_FOUND", `Workspace settings for ${workspaceId} not found`);
    }
    const updated: WorkspaceSettings = {
      ...existing,
      ...input,
      updatedAt: now()
    };
    this.db
      .update(workspaceSettings)
      .set({
        defaultAdapterKey: updated.defaultAdapterKey,
        defaultModel: updated.defaultModel,
        autorunPolicyJson: updated.autorunPolicyJson,
        promptOverridesJson: updated.promptOverridesJson,
        skillOverridesJson: updated.skillOverridesJson,
        verificationDefaultsJson: updated.verificationDefaultsJson,
        qaDefaultsJson: updated.qaDefaultsJson,
        gitDefaultsJson: updated.gitDefaultsJson,
        executionDefaultsJson: updated.executionDefaultsJson,
        uiMetadataJson: updated.uiMetadataJson,
        updatedAt: updated.updatedAt
      })
      .where(eq(workspaceSettings.workspaceId, workspaceId))
      .run();
    return updated;
  }
}

type QaFindingRow = {
  id: string;
  qaRunId: string;
  severity: QaFindingSeverity;
  category: QaFindingCategory;
  title: string;
  description: string;
  evidence: string;
  reproStepsJson: string;
  suggestedFix: string | null;
  status: QaFindingStatus;
  storyId: string | null;
  acceptanceCriterionId: string | null;
  waveStoryExecutionId: string | null;
  createdAt: number;
  updatedAt: number;
};

type StoryReviewFindingRow = {
  id: string;
  storyReviewRunId: string;
  severity: StoryReviewFindingSeverity;
  category: StoryReviewFindingCategory;
  title: string;
  description: string;
  evidence: string;
  filePath: string | null;
  line: number | null;
  suggestedFix: string | null;
  status: StoryReviewFindingStatus;
  createdAt: number;
  updatedAt: number;
};

function mapStoryReviewFinding(row: StoryReviewFindingRow): StoryReviewFinding {
  return {
    id: row.id,
    storyReviewRunId: row.storyReviewRunId,
    severity: row.severity,
    category: row.category,
    title: row.title,
    description: row.description,
    evidence: row.evidence,
    filePath: row.filePath,
    line: row.line,
    suggestedFix: row.suggestedFix,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapQaFinding(row: QaFindingRow): QaFinding {
  return {
    id: row.id,
    qaRunId: row.qaRunId,
    severity: row.severity,
    category: row.category,
    title: row.title,
    description: row.description,
    evidence: row.evidence,
    reproSteps: parseStringList(row.reproStepsJson),
    suggestedFix: row.suggestedFix,
    status: row.status,
    storyId: row.storyId,
    acceptanceCriterionId: row.acceptanceCriterionId,
    waveStoryExecutionId: row.waveStoryExecutionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function isItemsCodeUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const sqliteCode = (error as { code?: string }).code;
  if (sqliteCode === "SQLITE_CONSTRAINT_UNIQUE") {
    return true;
  }

  // Fallback to message matching because better-sqlite3 may surface driver-specific errors.
  return error.message.includes("UNIQUE constraint failed");
}

export class ItemRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public create(input: { workspaceId: string; title: string; description: string }): Item {
    const workspaceId = input.workspaceId;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const timestamp = now();
      const item: Item = {
        id: createId("item"),
        workspaceId,
        code: this.allocateNextCode(workspaceId),
        title: input.title,
        description: input.description,
        currentColumn: "idea",
        phaseStatus: "draft",
        createdAt: timestamp,
        updatedAt: timestamp
      };

      try {
        this.db.insert(items).values(item).run();
        return item;
      } catch (error) {
        if (attempt < 2 && isItemsCodeUniqueViolation(error)) {
          continue;
        }
        throw error;
      }
    }

    throw new Error("Failed to allocate a unique item code");
  }

  public listByWorkspaceId(workspaceId: string): Item[] {
    return this.db.select().from(items).where(eq(items.workspaceId, workspaceId)).orderBy(items.createdAt, items.id).all() as Item[];
  }

  private allocateNextCode(workspaceId: string): string {
    const latestCodeRow = this.db
      .select({ code: items.code, createdAt: items.createdAt, id: items.id })
      .from(items)
      .where(eq(items.workspaceId, workspaceId))
      .orderBy(desc(items.createdAt), desc(items.id))
      .limit(1)
      .get() as { code: string | null; createdAt: number; id: string } | undefined;

    if (!latestCodeRow?.code) {
      return formatItemCode(1);
    }

    const latestSequence = parseItemCodeSequence(latestCodeRow.code);
    if (latestSequence === null) {
      throw new Error(`Invalid item code format in database: ${latestCodeRow.code}`);
    }

    return formatItemCode(latestSequence + 1);
  }

  public getById(id: string): Item | null {
    return (this.db.select().from(items).where(eq(items.id, id)).get() as Item | undefined) ?? null;
  }

  public updateColumn(id: string, currentColumn: BoardColumn, phaseStatus?: ItemPhaseStatus): void {
    this.db
      .update(items)
      .set({
        currentColumn,
        ...(phaseStatus ? { phaseStatus } : {}),
        updatedAt: now()
      })
      .where(eq(items.id, id))
      .run();
  }

  public updatePhaseStatus(id: string, phaseStatus: ItemPhaseStatus): void {
    this.db.update(items).set({ phaseStatus, updatedAt: now() }).where(eq(items.id, id)).run();
  }
}

export class ConceptRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public getById(id: string): Concept | null {
    return (this.db.select().from(concepts).where(eq(concepts.id, id)).get() as Concept | undefined) ?? null;
  }

  public getLatestByItemId(itemId: string): Concept | null {
    return (
      this.db
        .select()
        .from(concepts)
        .where(eq(concepts.itemId, itemId))
        .orderBy(desc(concepts.version))
        .get() as Concept | undefined
    ) ?? null;
  }

  public create(input: Omit<Concept, "id" | "createdAt" | "updatedAt">): Concept {
    const timestamp = now();
    const concept: Concept = {
      ...input,
      id: createId("concept"),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.db.insert(concepts).values(concept).run();
    return concept;
  }

  public updateStatus(id: string, status: RecordStatus): void {
    this.db.update(concepts).set({ status, updatedAt: now() }).where(eq(concepts.id, id)).run();
  }
}

export class ProjectRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public listByItemId(itemId: string): Project[] {
    return this.db.select().from(projects).where(eq(projects.itemId, itemId)).orderBy(projects.position).all() as Project[];
  }

  public listByConceptId(conceptId: string): Project[] {
    return this.db.select().from(projects).where(eq(projects.conceptId, conceptId)).orderBy(projects.position).all() as Project[];
  }

  public getById(id: string): Project | null {
    return (this.db.select().from(projects).where(eq(projects.id, id)).get() as Project | undefined) ?? null;
  }

  public createMany(input: Array<Omit<Project, "id" | "createdAt" | "updatedAt">>): Project[] {
    const created = input.map((project) => ({
      ...project,
      id: createId("project"),
      createdAt: now(),
      updatedAt: now()
    }));
    this.db.insert(projects).values(created).run();
    return created as Project[];
  }
}

export class UserStoryRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public listByProjectId(projectId: string): UserStory[] {
    return this.db
      .select()
      .from(userStories)
      .where(eq(userStories.projectId, projectId))
      .orderBy(userStories.createdAt)
      .all() as UserStory[];
  }

  public getById(id: string): UserStory | null {
    return (this.db.select().from(userStories).where(eq(userStories.id, id)).get() as UserStory | undefined) ?? null;
  }

  public createMany(input: Array<Omit<UserStory, "id" | "createdAt" | "updatedAt">>): UserStory[] {
    const timestamp = now();
    const rows = input.map((story) => ({
      ...story,
      id: createId("story"),
      createdAt: timestamp,
      updatedAt: timestamp
    }));
    this.db.insert(userStories).values(rows).run();
    return rows as UserStory[];
  }

  public approveByProjectId(projectId: string): void {
    this.db
      .update(userStories)
      .set({ status: "approved", updatedAt: now() })
      .where(eq(userStories.projectId, projectId))
      .run();
  }

  public approveByIds(storyIds: string[]): void {
    if (storyIds.length === 0) {
      return;
    }
    this.db
      .update(userStories)
      .set({ status: "approved", updatedAt: now() })
      .where(inArray(userStories.id, storyIds))
      .run();
  }

  public update(
    id: string,
    input: Partial<Pick<UserStory, "title" | "description" | "actor" | "goal" | "benefit" | "priority" | "status">>
  ): void {
    this.db
      .update(userStories)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.actor !== undefined ? { actor: input.actor } : {}),
        ...(input.goal !== undefined ? { goal: input.goal } : {}),
        ...(input.benefit !== undefined ? { benefit: input.benefit } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        updatedAt: now()
      })
      .where(eq(userStories.id, id))
      .run();
  }

  public hasAnyByProjectId(projectId: string): boolean {
    const row = this.db
      .select({ id: userStories.id })
      .from(userStories)
      .where(eq(userStories.projectId, projectId))
      .limit(1)
      .get();
    return row !== undefined;
  }
}

export class AcceptanceCriterionRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public getById(id: string): AcceptanceCriterion | null {
    return (
      this.db.select().from(acceptanceCriteria).where(eq(acceptanceCriteria.id, id)).get() as
        | AcceptanceCriterion
        | undefined
    ) ?? null;
  }

  public listByStoryId(storyId: string): AcceptanceCriterion[] {
    return this.db
      .select()
      .from(acceptanceCriteria)
      .where(eq(acceptanceCriteria.storyId, storyId))
      .orderBy(acceptanceCriteria.position)
      .all() as AcceptanceCriterion[];
  }

  public listByProjectId(projectId: string): AcceptanceCriterion[] {
    return this.db
      .select({
        id: acceptanceCriteria.id,
        storyId: acceptanceCriteria.storyId,
        code: acceptanceCriteria.code,
        text: acceptanceCriteria.text,
        position: acceptanceCriteria.position,
        createdAt: acceptanceCriteria.createdAt,
        updatedAt: acceptanceCriteria.updatedAt
      })
      .from(acceptanceCriteria)
      .innerJoin(userStories, eq(acceptanceCriteria.storyId, userStories.id))
      .where(eq(userStories.projectId, projectId))
      .orderBy(userStories.code, acceptanceCriteria.position)
      .all() as AcceptanceCriterion[];
  }

  public createMany(input: Array<Omit<AcceptanceCriterion, "id" | "createdAt" | "updatedAt">>): AcceptanceCriterion[] {
    const timestamp = now();
    const rows = input.map((criterion) => ({
      ...criterion,
      id: createId("ac"),
      createdAt: timestamp,
      updatedAt: timestamp
    }));
    this.db.insert(acceptanceCriteria).values(rows).run();
    return rows as AcceptanceCriterion[];
  }

  public deleteByStoryId(storyId: string): void {
    this.db.delete(acceptanceCriteria).where(eq(acceptanceCriteria.storyId, storyId)).run();
  }
}

export class ArchitecturePlanRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public getLatestByProjectId(projectId: string): ArchitecturePlan | null {
    return (
      this.db
        .select()
        .from(architecturePlans)
        .where(eq(architecturePlans.projectId, projectId))
        .orderBy(desc(architecturePlans.version))
        .get() as ArchitecturePlan | undefined
    ) ?? null;
  }

  public create(input: Omit<ArchitecturePlan, "id" | "createdAt" | "updatedAt">): ArchitecturePlan {
    const timestamp = now();
    const row: ArchitecturePlan = {
      ...input,
      id: createId("architecture"),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.db.insert(architecturePlans).values(row).run();
    return row;
  }

  public updateStatus(id: string, status: RecordStatus): void {
    this.db
      .update(architecturePlans)
      .set({ status, updatedAt: now() })
      .where(eq(architecturePlans.id, id))
      .run();
  }
}

export class ImplementationPlanRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public getLatestByProjectId(projectId: string): ImplementationPlan | null {
    return (
      this.db
        .select()
        .from(implementationPlans)
        .where(eq(implementationPlans.projectId, projectId))
        .orderBy(desc(implementationPlans.version))
        .get() as ImplementationPlan | undefined
    ) ?? null;
  }

  public create(input: Omit<ImplementationPlan, "id" | "createdAt" | "updatedAt">): ImplementationPlan {
    const timestamp = now();
    const row: ImplementationPlan = {
      ...input,
      id: createId("plan"),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.db.insert(implementationPlans).values(row).run();
    return row;
  }

  public updateStatus(id: string, status: RecordStatus): void {
    this.db
      .update(implementationPlans)
      .set({ status, updatedAt: now() })
      .where(eq(implementationPlans.id, id))
      .run();
  }
}

export class WaveRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public getById(id: string): Wave | null {
    return (this.db.select().from(waves).where(eq(waves.id, id)).get() as Wave | undefined) ?? null;
  }

  public listByImplementationPlanId(implementationPlanId: string): Wave[] {
    return this.db
      .select()
      .from(waves)
      .where(eq(waves.implementationPlanId, implementationPlanId))
      .orderBy(waves.position)
      .all() as Wave[];
  }

  public createMany(input: Array<Omit<Wave, "id" | "createdAt" | "updatedAt">>): Wave[] {
    const timestamp = now();
    const rows = input.map((wave) => ({
      ...wave,
      id: createId("wave"),
      createdAt: timestamp,
      updatedAt: timestamp
    }));
    this.db.insert(waves).values(rows).run();
    return rows as Wave[];
  }
}

export class WaveStoryRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public listByWaveId(waveId: string): WaveStory[] {
    return this.db.select().from(waveStories).where(eq(waveStories.waveId, waveId)).orderBy(waveStories.position).all() as WaveStory[];
  }

  public getById(id: string): WaveStory | null {
    return (this.db.select().from(waveStories).where(eq(waveStories.id, id)).get() as WaveStory | undefined) ?? null;
  }

  public getByStoryId(storyId: string): WaveStory | null {
    return (this.db.select().from(waveStories).where(eq(waveStories.storyId, storyId)).get() as WaveStory | undefined) ?? null;
  }

  public listByStoryIds(storyIds: string[]): WaveStory[] {
    if (storyIds.length === 0) {
      return [];
    }
    return this.db
      .select()
      .from(waveStories)
      .where(inArray(waveStories.storyId, storyIds))
      .orderBy(waveStories.position)
      .all() as WaveStory[];
  }

  public createMany(input: Array<Omit<WaveStory, "id" | "createdAt" | "updatedAt">>): WaveStory[] {
    const timestamp = now();
    const rows = input.map((waveStory) => ({
      ...waveStory,
      id: createId("wave_story"),
      createdAt: timestamp,
      updatedAt: timestamp
    }));
    this.db.insert(waveStories).values(rows).run();
    return rows as WaveStory[];
  }
}

export class WaveStoryDependencyRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public listByDependentStoryId(dependentStoryId: string): WaveStoryDependency[] {
    return this.db
      .select()
      .from(waveStoryDependencies)
      .where(eq(waveStoryDependencies.dependentStoryId, dependentStoryId))
      .all() as WaveStoryDependency[];
  }

  public createMany(input: WaveStoryDependency[]): WaveStoryDependency[] {
    if (input.length === 0) {
      return [];
    }
    this.db.insert(waveStoryDependencies).values(input).run();
    return input;
  }
}

type ProjectExecutionContextRow = {
  id: string;
  projectId: string;
  relevantDirectoriesJson: string;
  relevantFilesJson: string;
  integrationPointsJson: string;
  testLocationsJson: string;
  repoConventionsJson: string;
  executionNotesJson: string;
  createdAt: number;
  updatedAt: number;
};

function mapProjectExecutionContext(row: ProjectExecutionContextRow): ProjectExecutionContext {
  return {
    id: row.id,
    projectId: row.projectId,
    relevantDirectories: parseStringList(row.relevantDirectoriesJson),
    relevantFiles: parseStringList(row.relevantFilesJson),
    integrationPoints: parseStringList(row.integrationPointsJson),
    testLocations: parseStringList(row.testLocationsJson),
    repoConventions: parseStringList(row.repoConventionsJson),
    executionNotes: parseStringList(row.executionNotesJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export class ProjectExecutionContextRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public getByProjectId(projectId: string): ProjectExecutionContext | null {
    const row = this.db
      .select()
      .from(projectExecutionContexts)
      .where(eq(projectExecutionContexts.projectId, projectId))
      .get() as ProjectExecutionContextRow | undefined;
    return row ? mapProjectExecutionContext(row) : null;
  }

  public upsert(input: Omit<ProjectExecutionContext, "id" | "createdAt" | "updatedAt">): ProjectExecutionContext {
    const existing = this.getByProjectId(input.projectId);
    const timestamp = now();
    if (existing) {
      this.db
        .update(projectExecutionContexts)
        .set({
          relevantDirectoriesJson: stringifyStringList(input.relevantDirectories),
          relevantFilesJson: stringifyStringList(input.relevantFiles),
          integrationPointsJson: stringifyStringList(input.integrationPoints),
          testLocationsJson: stringifyStringList(input.testLocations),
          repoConventionsJson: stringifyStringList(input.repoConventions),
          executionNotesJson: stringifyStringList(input.executionNotes),
          updatedAt: timestamp
        })
        .where(eq(projectExecutionContexts.projectId, input.projectId))
        .run();
      return {
        ...existing,
        ...input,
        updatedAt: timestamp
      };
    }

    const row: ProjectExecutionContextRow = {
      id: createId("project_context"),
      projectId: input.projectId,
      relevantDirectoriesJson: stringifyStringList(input.relevantDirectories),
      relevantFilesJson: stringifyStringList(input.relevantFiles),
      integrationPointsJson: stringifyStringList(input.integrationPoints),
      testLocationsJson: stringifyStringList(input.testLocations),
      repoConventionsJson: stringifyStringList(input.repoConventions),
      executionNotesJson: stringifyStringList(input.executionNotes),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.db.insert(projectExecutionContexts).values(row).run();
    return mapProjectExecutionContext(row);
  }
}

export class WaveExecutionRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public getById(id: string): WaveExecution | null {
    return (this.db.select().from(waveExecutions).where(eq(waveExecutions.id, id)).get() as WaveExecution | undefined) ?? null;
  }

  public listByWaveId(waveId: string): WaveExecution[] {
    return this.db
      .select()
      .from(waveExecutions)
      .where(eq(waveExecutions.waveId, waveId))
      .orderBy(waveExecutions.attempt)
      .all() as WaveExecution[];
  }

  public getLatestByWaveId(waveId: string): WaveExecution | null {
    return (
      this.db
        .select()
        .from(waveExecutions)
        .where(eq(waveExecutions.waveId, waveId))
        .orderBy(desc(waveExecutions.attempt))
        .limit(1)
        .get() as WaveExecution | undefined
    ) ?? null;
  }

  public create(input: Omit<WaveExecution, "id" | "createdAt" | "updatedAt" | "completedAt">): WaveExecution {
    const timestamp = now();
    const row: WaveExecution = {
      ...input,
      id: createId("wave_execution"),
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null
    };
    this.db.insert(waveExecutions).values(row).run();
    return row;
  }

  public updateStatus(id: string, status: WaveExecutionStatus): void {
    this.db
      .update(waveExecutions)
      .set({
        status,
        updatedAt: now(),
        completedAt: status === "completed" || status === "failed" || status === "review_required" ? now() : null
      })
      .where(eq(waveExecutions.id, id))
      .run();
  }
}

export class WaveStoryExecutionRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public getById(id: string): WaveStoryExecution | null {
    return (
      this.db.select().from(waveStoryExecutions).where(eq(waveStoryExecutions.id, id)).get() as
        | WaveStoryExecution
        | undefined
    ) ?? null;
  }

  public listByWaveExecutionId(waveExecutionId: string): WaveStoryExecution[] {
    return this.db
      .select()
      .from(waveStoryExecutions)
      .where(eq(waveStoryExecutions.waveExecutionId, waveExecutionId))
      .orderBy(waveStoryExecutions.createdAt)
      .all() as WaveStoryExecution[];
  }

  public listByWaveStoryId(waveStoryId: string): WaveStoryExecution[] {
    return this.db
      .select()
      .from(waveStoryExecutions)
      .where(eq(waveStoryExecutions.waveStoryId, waveStoryId))
      .orderBy(waveStoryExecutions.attempt)
      .all() as WaveStoryExecution[];
  }

  public getLatestByWaveStoryId(waveStoryId: string): WaveStoryExecution | null {
    return (
      this.db
        .select()
        .from(waveStoryExecutions)
        .where(eq(waveStoryExecutions.waveStoryId, waveStoryId))
        .orderBy(desc(waveStoryExecutions.attempt))
        .limit(1)
        .get() as WaveStoryExecution | undefined
    ) ?? null;
  }

  public listLatestByWaveStoryIds(waveStoryIds: string[]): WaveStoryExecution[] {
    if (waveStoryIds.length === 0) {
      return [];
    }
    return waveStoryIds
      .map((waveStoryId) => this.getLatestByWaveStoryId(waveStoryId))
      .filter((execution): execution is WaveStoryExecution => execution !== null);
  }

  public create(input: Omit<WaveStoryExecution, "id" | "createdAt" | "updatedAt" | "completedAt">): WaveStoryExecution {
    const timestamp = now();
    const row: WaveStoryExecution = {
      ...input,
      id: createId("wave_story_execution"),
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null
    };
    this.db.insert(waveStoryExecutions).values(row).run();
    return row;
  }

  public updateStatus(
    id: string,
    status: WaveStoryExecutionStatus,
    options?: { outputSummaryJson?: string | null; errorMessage?: string | null; gitMetadata?: GitBranchMetadata | null }
  ): void {
    this.db
      .update(waveStoryExecutions)
      .set({
        gitBranchName: options?.gitMetadata?.branchName,
        gitBaseRef: options?.gitMetadata?.baseRef,
        gitMetadataJson: options?.gitMetadata ? JSON.stringify(options.gitMetadata, null, 2) : undefined,
        status,
        outputSummaryJson: options?.outputSummaryJson,
        errorMessage: options?.errorMessage ?? null,
        updatedAt: now(),
        completedAt: status === "completed" || status === "failed" || status === "review_required" ? now() : null
      })
      .where(eq(waveStoryExecutions.id, id))
      .run();
  }
}

export class WaveStoryTestRunRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public getById(id: string): WaveStoryTestRun | null {
    return (
      this.db.select().from(waveStoryTestRuns).where(eq(waveStoryTestRuns.id, id)).get() as
        | WaveStoryTestRun
        | undefined
    ) ?? null;
  }

  public listByWaveExecutionId(waveExecutionId: string): WaveStoryTestRun[] {
    return this.db
      .select()
      .from(waveStoryTestRuns)
      .where(eq(waveStoryTestRuns.waveExecutionId, waveExecutionId))
      .orderBy(waveStoryTestRuns.createdAt)
      .all() as WaveStoryTestRun[];
  }

  public listByWaveStoryId(waveStoryId: string): WaveStoryTestRun[] {
    return this.db
      .select()
      .from(waveStoryTestRuns)
      .where(eq(waveStoryTestRuns.waveStoryId, waveStoryId))
      .orderBy(waveStoryTestRuns.attempt)
      .all() as WaveStoryTestRun[];
  }

  public getLatestByWaveStoryId(waveStoryId: string): WaveStoryTestRun | null {
    return (
      this.db
        .select()
        .from(waveStoryTestRuns)
        .where(eq(waveStoryTestRuns.waveStoryId, waveStoryId))
        .orderBy(desc(waveStoryTestRuns.attempt))
        .limit(1)
        .get() as WaveStoryTestRun | undefined
    ) ?? null;
  }

  public listLatestByWaveStoryIds(waveStoryIds: string[]): WaveStoryTestRun[] {
    if (waveStoryIds.length === 0) {
      return [];
    }
    return waveStoryIds
      .map((waveStoryId) => this.getLatestByWaveStoryId(waveStoryId))
      .filter((testRun): testRun is WaveStoryTestRun => testRun !== null);
  }

  public create(input: Omit<WaveStoryTestRun, "id" | "createdAt" | "updatedAt" | "completedAt">): WaveStoryTestRun {
    const timestamp = now();
    const row: WaveStoryTestRun = {
      ...input,
      id: createId("wave_story_test_run"),
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null
    };
    this.db.insert(waveStoryTestRuns).values(row).run();
    return row;
  }

  public updateStatus(
    id: string,
    status: WaveStoryTestRunStatus,
    options?: { outputSummaryJson?: string | null; errorMessage?: string | null }
  ): void {
    this.db
      .update(waveStoryTestRuns)
      .set({
        status,
        outputSummaryJson: options?.outputSummaryJson,
        errorMessage: options?.errorMessage ?? null,
        updatedAt: now(),
        completedAt: status === "completed" || status === "failed" || status === "review_required" ? now() : null
      })
      .where(eq(waveStoryTestRuns.id, id))
      .run();
  }
}

export class TestAgentSessionRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public create(input: Omit<TestAgentSession, "id" | "createdAt" | "updatedAt">): TestAgentSession {
    const timestamp = now();
    const row: TestAgentSession = {
      ...input,
      id: createId("test_session"),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.db.insert(testAgentSessions).values(row).run();
    return row;
  }

  public listByWaveStoryTestRunId(waveStoryTestRunId: string): TestAgentSession[] {
    return this.db
      .select()
      .from(testAgentSessions)
      .where(eq(testAgentSessions.waveStoryTestRunId, waveStoryTestRunId))
      .orderBy(testAgentSessions.createdAt)
      .all() as TestAgentSession[];
  }
}

export class ExecutionAgentSessionRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public create(input: Omit<ExecutionAgentSession, "id" | "createdAt" | "updatedAt">): ExecutionAgentSession {
    const timestamp = now();
    const row: ExecutionAgentSession = {
      ...input,
      id: createId("execution_session"),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.db.insert(executionAgentSessions).values(row).run();
    return row;
  }

  public listByWaveStoryExecutionId(waveStoryExecutionId: string): ExecutionAgentSession[] {
    return this.db
      .select()
      .from(executionAgentSessions)
      .where(eq(executionAgentSessions.waveStoryExecutionId, waveStoryExecutionId))
      .orderBy(executionAgentSessions.createdAt)
      .all() as ExecutionAgentSession[];
  }
}

export class VerificationRunRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public create(input: Omit<VerificationRun, "id" | "createdAt" | "updatedAt">): VerificationRun {
    const timestamp = now();
    const row: VerificationRun = {
      ...input,
      id: createId("verification"),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.db.insert(verificationRuns).values(row).run();
    return row;
  }

  public listByWaveStoryExecutionId(waveStoryExecutionId: string): VerificationRun[] {
    return this.db
      .select()
      .from(verificationRuns)
      .where(eq(verificationRuns.waveStoryExecutionId, waveStoryExecutionId))
      .orderBy(verificationRuns.createdAt)
      .all() as VerificationRun[];
  }

  public getLatestByWaveStoryExecutionIdAndMode(
    waveStoryExecutionId: string,
    mode: VerificationRunMode
  ): VerificationRun | null {
    return (
      (this.db
        .select()
        .from(verificationRuns)
        .where(and(eq(verificationRuns.waveStoryExecutionId, waveStoryExecutionId), eq(verificationRuns.mode, mode)))
        .orderBy(desc(verificationRuns.createdAt), desc(verificationRuns.id))
        .limit(1)
        .get() as VerificationRun | undefined) ?? null
    );
  }

  public listByWaveExecutionId(waveExecutionId: string): VerificationRun[] {
    return this.db
      .select()
      .from(verificationRuns)
      .where(eq(verificationRuns.waveExecutionId, waveExecutionId))
      .orderBy(verificationRuns.createdAt)
      .all() as VerificationRun[];
  }

  public listLatestByWaveStoryExecutionIdsAndMode(
    waveStoryExecutionIds: string[],
    mode: VerificationRunMode
  ): VerificationRun[] {
    if (waveStoryExecutionIds.length === 0) {
      return [];
    }
    return waveStoryExecutionIds
      .map((waveStoryExecutionId) => this.getLatestByWaveStoryExecutionIdAndMode(waveStoryExecutionId, mode))
      .filter((run): run is VerificationRun => run !== null);
  }
}

export class StoryReviewRunRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public getById(id: string): StoryReviewRun | null {
    return (this.db.select().from(storyReviewRuns).where(eq(storyReviewRuns.id, id)).get() as StoryReviewRun | undefined) ?? null;
  }

  public listByWaveStoryExecutionId(waveStoryExecutionId: string): StoryReviewRun[] {
    return this.db
      .select()
      .from(storyReviewRuns)
      .where(eq(storyReviewRuns.waveStoryExecutionId, waveStoryExecutionId))
      .orderBy(storyReviewRuns.createdAt)
      .all() as StoryReviewRun[];
  }

  public getLatestByWaveStoryExecutionId(waveStoryExecutionId: string): StoryReviewRun | null {
    return (
      this.db
        .select()
        .from(storyReviewRuns)
        .where(eq(storyReviewRuns.waveStoryExecutionId, waveStoryExecutionId))
        .orderBy(desc(storyReviewRuns.createdAt), desc(storyReviewRuns.id))
        .limit(1)
        .get() as StoryReviewRun | undefined
    ) ?? null;
  }

  public listLatestByWaveStoryExecutionIds(waveStoryExecutionIds: string[]): StoryReviewRun[] {
    if (waveStoryExecutionIds.length === 0) {
      return [];
    }
    return waveStoryExecutionIds
      .map((waveStoryExecutionId) => this.getLatestByWaveStoryExecutionId(waveStoryExecutionId))
      .filter((run): run is StoryReviewRun => run !== null);
  }

  public create(input: Omit<StoryReviewRun, "id" | "createdAt" | "updatedAt" | "completedAt">): StoryReviewRun {
    const timestamp = now();
    const row: StoryReviewRun = {
      ...input,
      id: createId("story_review_run"),
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null
    };
    this.db.insert(storyReviewRuns).values(row).run();
    return row;
  }

  public updateStatus(
    id: string,
    status: StoryReviewRunStatus,
    options?: { summaryJson?: string | null; errorMessage?: string | null }
  ): void {
    this.db
      .update(storyReviewRuns)
      .set({
        status,
        summaryJson: options?.summaryJson,
        errorMessage: options?.errorMessage ?? null,
        updatedAt: now(),
        completedAt: status === "passed" || status === "failed" || status === "review_required" ? now() : null
      })
      .where(eq(storyReviewRuns.id, id))
      .run();
  }
}

export class StoryReviewFindingRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public listByStoryReviewRunId(storyReviewRunId: string): StoryReviewFinding[] {
    const rows = this.db
      .select()
      .from(storyReviewFindings)
      .where(eq(storyReviewFindings.storyReviewRunId, storyReviewRunId))
      .orderBy(storyReviewFindings.createdAt)
      .all() as StoryReviewFindingRow[];
    return rows.map(mapStoryReviewFinding);
  }

  public createMany(input: Array<Omit<StoryReviewFinding, "id" | "createdAt" | "updatedAt">>): StoryReviewFinding[] {
    if (input.length === 0) {
      return [];
    }

    const timestamp = now();
    const rows: StoryReviewFindingRow[] = input.map((finding) => ({
      id: createId("story_review_finding"),
      storyReviewRunId: finding.storyReviewRunId,
      severity: finding.severity,
      category: finding.category,
      title: finding.title,
      description: finding.description,
      evidence: finding.evidence,
      filePath: finding.filePath,
      line: finding.line,
      suggestedFix: finding.suggestedFix,
      status: finding.status,
      createdAt: timestamp,
      updatedAt: timestamp
    }));

    this.db.insert(storyReviewFindings).values(rows).run();
    return rows.map(mapStoryReviewFinding);
  }

  public updateStatus(id: string, status: StoryReviewFindingStatus): void {
    this.db.update(storyReviewFindings).set({ status, updatedAt: now() }).where(eq(storyReviewFindings.id, id)).run();
  }

  public listOpenByStoryId(storyId: string): StoryReviewFinding[] {
    const rows = this.db
      .select({
        id: storyReviewFindings.id,
        storyReviewRunId: storyReviewFindings.storyReviewRunId,
        severity: storyReviewFindings.severity,
        category: storyReviewFindings.category,
        title: storyReviewFindings.title,
        description: storyReviewFindings.description,
        evidence: storyReviewFindings.evidence,
        filePath: storyReviewFindings.filePath,
        line: storyReviewFindings.line,
        suggestedFix: storyReviewFindings.suggestedFix,
        status: storyReviewFindings.status,
        createdAt: storyReviewFindings.createdAt,
        updatedAt: storyReviewFindings.updatedAt
      })
      .from(storyReviewFindings)
      .innerJoin(storyReviewRuns, eq(storyReviewFindings.storyReviewRunId, storyReviewRuns.id))
      .innerJoin(waveStoryExecutions, eq(storyReviewRuns.waveStoryExecutionId, waveStoryExecutions.id))
      .where(and(eq(waveStoryExecutions.storyId, storyId), eq(storyReviewFindings.status, "open")))
      .orderBy(storyReviewFindings.createdAt)
      .all() as StoryReviewFindingRow[];
    return rows.map(mapStoryReviewFinding);
  }

  public listByStoryReviewRunIds(storyReviewRunIds: string[]): StoryReviewFinding[] {
    if (storyReviewRunIds.length === 0) {
      return [];
    }
    const rows = this.db
      .select()
      .from(storyReviewFindings)
      .where(inArray(storyReviewFindings.storyReviewRunId, storyReviewRunIds))
      .orderBy(storyReviewFindings.createdAt)
      .all() as StoryReviewFindingRow[];
    return rows.map(mapStoryReviewFinding);
  }
}

export class StoryReviewAgentSessionRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public create(input: Omit<StoryReviewAgentSession, "id" | "createdAt" | "updatedAt">): StoryReviewAgentSession {
    const timestamp = now();
    const row: StoryReviewAgentSession = {
      ...input,
      id: createId("story_review_session"),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.db.insert(storyReviewAgentSessions).values(row).run();
    return row;
  }

  public listByStoryReviewRunId(storyReviewRunId: string): StoryReviewAgentSession[] {
    return this.db
      .select()
      .from(storyReviewAgentSessions)
      .where(eq(storyReviewAgentSessions.storyReviewRunId, storyReviewRunId))
      .orderBy(storyReviewAgentSessions.createdAt)
      .all() as StoryReviewAgentSession[];
  }
}

export class StoryReviewRemediationRunRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public getById(id: string): StoryReviewRemediationRun | null {
    return (
      this.db.select().from(storyReviewRemediationRuns).where(eq(storyReviewRemediationRuns.id, id)).get() as
        | StoryReviewRemediationRun
        | undefined
    ) ?? null;
  }

  public listByStoryId(storyId: string): StoryReviewRemediationRun[] {
    return this.db
      .select()
      .from(storyReviewRemediationRuns)
      .where(eq(storyReviewRemediationRuns.storyId, storyId))
      .orderBy(storyReviewRemediationRuns.createdAt)
      .all() as StoryReviewRemediationRun[];
  }

  public listByStoryReviewRunId(storyReviewRunId: string): StoryReviewRemediationRun[] {
    return this.db
      .select()
      .from(storyReviewRemediationRuns)
      .where(eq(storyReviewRemediationRuns.storyReviewRunId, storyReviewRunId))
      .orderBy(storyReviewRemediationRuns.createdAt)
      .all() as StoryReviewRemediationRun[];
  }

  public create(
    input: Omit<StoryReviewRemediationRun, "id" | "createdAt" | "updatedAt" | "completedAt">
  ): StoryReviewRemediationRun {
    const timestamp = now();
    const row: StoryReviewRemediationRun = {
      ...input,
      id: createId("story_review_remediation_run"),
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null
    };
    this.db.insert(storyReviewRemediationRuns).values(row).run();
    return row;
  }

  public updateStatus(
    id: string,
    status: StoryReviewRemediationRun["status"],
    options?: {
      remediationWaveStoryExecutionId?: string | null;
      outputSummaryJson?: string | null;
      errorMessage?: string | null;
      gitMetadata?: GitBranchMetadata | null;
    }
  ): void {
    this.db
      .update(storyReviewRemediationRuns)
      .set({
        remediationWaveStoryExecutionId: options?.remediationWaveStoryExecutionId,
        gitBranchName: options?.gitMetadata?.branchName,
        gitBaseRef: options?.gitMetadata?.baseRef,
        gitMetadataJson: options?.gitMetadata ? JSON.stringify(options.gitMetadata, null, 2) : undefined,
        status,
        outputSummaryJson: options?.outputSummaryJson,
        errorMessage: options?.errorMessage ?? null,
        updatedAt: now(),
        completedAt: status === "completed" || status === "failed" || status === "review_required" ? now() : null
      })
      .where(eq(storyReviewRemediationRuns.id, id))
      .run();
  }
}

export class StoryReviewRemediationFindingRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public createMany(
    input: Array<Omit<StoryReviewRemediationFinding, "createdAt" | "updatedAt">>
  ): StoryReviewRemediationFinding[] {
    if (input.length === 0) {
      return [];
    }
    const timestamp = now();
    const rows = input.map((entry) => ({ ...entry, createdAt: timestamp, updatedAt: timestamp }));
    this.db.insert(storyReviewRemediationFindings).values(rows).run();
    return rows as StoryReviewRemediationFinding[];
  }

  public listByRunId(storyReviewRemediationRunId: string): StoryReviewRemediationFinding[] {
    return this.db
      .select()
      .from(storyReviewRemediationFindings)
      .where(eq(storyReviewRemediationFindings.storyReviewRemediationRunId, storyReviewRemediationRunId))
      .orderBy(storyReviewRemediationFindings.createdAt)
      .all() as StoryReviewRemediationFinding[];
  }

  public updateResolutionStatus(
    storyReviewRemediationRunId: string,
    storyReviewFindingId: string,
    resolutionStatus: StoryReviewRemediationFinding["resolutionStatus"]
  ): void {
    this.db
      .update(storyReviewRemediationFindings)
      .set({ resolutionStatus, updatedAt: now() })
      .where(
        and(
          eq(storyReviewRemediationFindings.storyReviewRemediationRunId, storyReviewRemediationRunId),
          eq(storyReviewRemediationFindings.storyReviewFindingId, storyReviewFindingId)
        )
      )
      .run();
  }
}

export class StoryReviewRemediationAgentSessionRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public create(
    input: Omit<StoryReviewRemediationAgentSession, "id" | "createdAt" | "updatedAt">
  ): StoryReviewRemediationAgentSession {
    const timestamp = now();
    const row: StoryReviewRemediationAgentSession = {
      ...input,
      id: createId("story_review_remediation_session"),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.db.insert(storyReviewRemediationAgentSessions).values(row).run();
    return row;
  }

  public listByRunId(storyReviewRemediationRunId: string): StoryReviewRemediationAgentSession[] {
    return this.db
      .select()
      .from(storyReviewRemediationAgentSessions)
      .where(eq(storyReviewRemediationAgentSessions.storyReviewRemediationRunId, storyReviewRemediationRunId))
      .orderBy(storyReviewRemediationAgentSessions.createdAt)
      .all() as StoryReviewRemediationAgentSession[];
  }
}

export class QaRunRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public getById(id: string): QaRun | null {
    return (this.db.select().from(qaRuns).where(eq(qaRuns.id, id)).get() as QaRun | undefined) ?? null;
  }

  public getLatestByProjectId(projectId: string): QaRun | null {
    return (
      this.db
        .select()
        .from(qaRuns)
        .where(eq(qaRuns.projectId, projectId))
        .orderBy(desc(qaRuns.createdAt), desc(qaRuns.id))
        .limit(1)
        .get() as QaRun | undefined
    ) ?? null;
  }

  public listByProjectId(projectId: string): QaRun[] {
    return this.db
      .select()
      .from(qaRuns)
      .where(eq(qaRuns.projectId, projectId))
      .orderBy(qaRuns.createdAt)
      .all() as QaRun[];
  }

  public create(input: Omit<QaRun, "id" | "createdAt" | "updatedAt" | "completedAt">): QaRun {
    const timestamp = now();
    const row: QaRun = {
      ...input,
      id: createId("qa_run"),
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null
    };
    this.db.insert(qaRuns).values(row).run();
    return row;
  }

  public updateStatus(
    id: string,
    status: QaRunStatus,
    options?: { summaryJson?: string | null; errorMessage?: string | null; mode?: QaRunMode }
  ): void {
    this.db
      .update(qaRuns)
      .set({
        ...(options?.mode ? { mode: options.mode } : {}),
        status,
        summaryJson: options?.summaryJson,
        errorMessage: options?.errorMessage ?? null,
        updatedAt: now(),
        completedAt: status === "passed" || status === "failed" || status === "review_required" ? now() : null
      })
      .where(eq(qaRuns.id, id))
      .run();
  }
}

export class QaFindingRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public listByQaRunId(qaRunId: string): QaFinding[] {
    const rows = this.db
      .select()
      .from(qaFindings)
      .where(eq(qaFindings.qaRunId, qaRunId))
      .orderBy(qaFindings.createdAt)
      .all() as QaFindingRow[];
    return rows.map(mapQaFinding);
  }

  public createMany(input: Array<Omit<QaFinding, "id" | "createdAt" | "updatedAt">>): QaFinding[] {
    if (input.length === 0) {
      return [];
    }

    const timestamp = now();
    const rows: QaFindingRow[] = input.map((finding) => ({
      id: createId("qa_finding"),
      qaRunId: finding.qaRunId,
      severity: finding.severity,
      category: finding.category,
      title: finding.title,
      description: finding.description,
      evidence: finding.evidence,
      reproStepsJson: stringifyStringList(finding.reproSteps),
      suggestedFix: finding.suggestedFix,
      status: finding.status,
      storyId: finding.storyId,
      acceptanceCriterionId: finding.acceptanceCriterionId,
      waveStoryExecutionId: finding.waveStoryExecutionId,
      createdAt: timestamp,
      updatedAt: timestamp
    }));

    this.db.insert(qaFindings).values(rows).run();
    return rows.map(mapQaFinding);
  }
}

export class QaAgentSessionRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public create(input: Omit<QaAgentSession, "id" | "createdAt" | "updatedAt">): QaAgentSession {
    const timestamp = now();
    const row: QaAgentSession = {
      ...input,
      id: createId("qa_session"),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.db.insert(qaAgentSessions).values(row).run();
    return row;
  }

  public listByQaRunId(qaRunId: string): QaAgentSession[] {
    return this.db
      .select()
      .from(qaAgentSessions)
      .where(eq(qaAgentSessions.qaRunId, qaRunId))
      .orderBy(qaAgentSessions.createdAt)
      .all() as QaAgentSession[];
  }
}

export class DocumentationRunRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public getById(id: string): DocumentationRun | null {
    return (
      this.db.select().from(documentationRuns).where(eq(documentationRuns.id, id)).get() as DocumentationRun | undefined
    ) ?? null;
  }

  public getLatestByProjectId(projectId: string): DocumentationRun | null {
    return (
      this.db
        .select()
        .from(documentationRuns)
        .where(eq(documentationRuns.projectId, projectId))
        .orderBy(desc(documentationRuns.createdAt), desc(documentationRuns.id))
        .limit(1)
        .get() as DocumentationRun | undefined
    ) ?? null;
  }

  public listByProjectId(projectId: string): DocumentationRun[] {
    return this.db
      .select()
      .from(documentationRuns)
      .where(eq(documentationRuns.projectId, projectId))
      .orderBy(documentationRuns.createdAt)
      .all() as DocumentationRun[];
  }

  public create(input: Omit<DocumentationRun, "id" | "createdAt" | "updatedAt" | "completedAt">): DocumentationRun {
    const timestamp = now();
    const row: DocumentationRun = {
      ...input,
      id: createId("documentation_run"),
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null
    };
    this.db.insert(documentationRuns).values(row).run();
    return row;
  }

  public updateStatus(
    id: string,
    status: DocumentationRunStatus,
    options?: { summaryJson?: string | null; errorMessage?: string | null }
  ): void {
    this.db
      .update(documentationRuns)
      .set({
        status,
        summaryJson: options?.summaryJson,
        errorMessage: options?.errorMessage ?? null,
        updatedAt: now(),
        completedAt: status === "completed" || status === "failed" || status === "review_required" ? now() : null
      })
      .where(eq(documentationRuns.id, id))
      .run();
  }

  public markStale(id: string, reason: string): void {
    this.db
      .update(documentationRuns)
      .set({
        staleAt: now(),
        staleReason: reason,
        updatedAt: now()
      })
      .where(eq(documentationRuns.id, id))
      .run();
  }
}

export class DocumentationAgentSessionRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public create(input: Omit<DocumentationAgentSession, "id" | "createdAt" | "updatedAt">): DocumentationAgentSession {
    const timestamp = now();
    const row: DocumentationAgentSession = {
      ...input,
      id: createId("documentation_session"),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.db.insert(documentationAgentSessions).values(row).run();
    return row;
  }

  public listByDocumentationRunId(documentationRunId: string): DocumentationAgentSession[] {
    return this.db
      .select()
      .from(documentationAgentSessions)
      .where(eq(documentationAgentSessions.documentationRunId, documentationRunId))
      .orderBy(documentationAgentSessions.createdAt)
      .all() as DocumentationAgentSession[];
  }
}

export class InteractiveReviewSessionRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public getById(id: string): InteractiveReviewSession | null {
    return (
      this.db.select().from(interactiveReviewSessions).where(eq(interactiveReviewSessions.id, id)).get() as
        | InteractiveReviewSession
        | undefined
    ) ?? null;
  }

  public findOpenByScope(input: {
    scopeType: InteractiveReviewSession["scopeType"];
    scopeId: string;
    artifactType: InteractiveReviewSession["artifactType"];
    reviewType: InteractiveReviewSession["reviewType"];
  }): InteractiveReviewSession | null {
    return (
      this.db
        .select()
        .from(interactiveReviewSessions)
        .where(
          and(
            eq(interactiveReviewSessions.scopeType, input.scopeType),
            eq(interactiveReviewSessions.scopeId, input.scopeId),
            eq(interactiveReviewSessions.artifactType, input.artifactType),
            eq(interactiveReviewSessions.reviewType, input.reviewType),
            notInArray(interactiveReviewSessions.status, ["resolved", "cancelled"])
          )
        )
        .orderBy(desc(interactiveReviewSessions.startedAt), desc(interactiveReviewSessions.id))
        .limit(1)
        .get() as InteractiveReviewSession | undefined
    ) ?? null;
  }

  public create(
    input: Omit<InteractiveReviewSession, "id" | "startedAt" | "updatedAt" | "resolvedAt" | "lastAssistantMessageId" | "lastUserMessageId">
  ): InteractiveReviewSession {
    const timestamp = now();
    const row: InteractiveReviewSession = {
      ...input,
      id: createId("interactive_review_session"),
      startedAt: timestamp,
      updatedAt: timestamp,
      resolvedAt: null,
      lastAssistantMessageId: null,
      lastUserMessageId: null
    };
    this.db.insert(interactiveReviewSessions).values(row).run();
    return row;
  }

  public update(
    id: string,
    input: Partial<Pick<InteractiveReviewSession, "status" | "resolvedAt" | "lastAssistantMessageId" | "lastUserMessageId">>
  ): void {
    this.db
      .update(interactiveReviewSessions)
      .set({
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.resolvedAt !== undefined ? { resolvedAt: input.resolvedAt } : {}),
        ...(input.lastAssistantMessageId !== undefined ? { lastAssistantMessageId: input.lastAssistantMessageId } : {}),
        ...(input.lastUserMessageId !== undefined ? { lastUserMessageId: input.lastUserMessageId } : {}),
        updatedAt: now()
      })
      .where(eq(interactiveReviewSessions.id, id))
      .run();
  }
}

export class InteractiveReviewMessageRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public create(
    input: Omit<InteractiveReviewMessage, "id" | "createdAt">
  ): InteractiveReviewMessage {
    const row: InteractiveReviewMessage = {
      ...input,
      id: createId("interactive_review_message"),
      createdAt: now()
    };
    this.db.insert(interactiveReviewMessages).values(row).run();
    return row;
  }

  public listBySessionId(sessionId: string): InteractiveReviewMessage[] {
    return this.db
      .select()
      .from(interactiveReviewMessages)
      .where(eq(interactiveReviewMessages.sessionId, sessionId))
      .orderBy(interactiveReviewMessages.createdAt, interactiveReviewMessages.id)
      .all() as InteractiveReviewMessage[];
  }
}

export class InteractiveReviewEntryRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public createMany(
    input: Array<Omit<InteractiveReviewEntry, "id" | "createdAt" | "updatedAt">>
  ): InteractiveReviewEntry[] {
    if (input.length === 0) {
      return [];
    }
    const timestamp = now();
    const rows: InteractiveReviewEntry[] = input.map((entry) => ({
      ...entry,
      id: createId("interactive_review_entry"),
      createdAt: timestamp,
      updatedAt: timestamp
    }));
    this.db.insert(interactiveReviewEntries).values(rows).run();
    return rows;
  }

  public listBySessionId(sessionId: string): InteractiveReviewEntry[] {
    return this.db
      .select()
      .from(interactiveReviewEntries)
      .where(eq(interactiveReviewEntries.sessionId, sessionId))
      .orderBy(interactiveReviewEntries.createdAt, interactiveReviewEntries.id)
      .all() as InteractiveReviewEntry[];
  }

  public updateByEntryId(
    sessionId: string,
    entryId: string,
    input: {
      status?: InteractiveReviewEntryStatus;
      summary?: string | null;
      changeRequest?: string | null;
      rationale?: string | null;
      severity?: InteractiveReviewEntry["severity"];
    }
  ): void {
    this.db
      .update(interactiveReviewEntries)
      .set({
        ...(input.status ? { status: input.status } : {}),
        ...(input.summary !== undefined ? { summary: input.summary } : {}),
        ...(input.changeRequest !== undefined ? { changeRequest: input.changeRequest } : {}),
        ...(input.rationale !== undefined ? { rationale: input.rationale } : {}),
        ...(input.severity !== undefined ? { severity: input.severity } : {}),
        updatedAt: now()
      })
      .where(and(eq(interactiveReviewEntries.sessionId, sessionId), eq(interactiveReviewEntries.entryId, entryId)))
      .run();
  }
}

export class InteractiveReviewResolutionRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public create(
    input: Omit<InteractiveReviewResolution, "id" | "createdAt" | "appliedAt">
  ): InteractiveReviewResolution {
    const timestamp = now();
    const row: InteractiveReviewResolution = {
      ...input,
      id: createId("interactive_review_resolution"),
      createdAt: timestamp,
      appliedAt: null
    };
    this.db.insert(interactiveReviewResolutions).values(row).run();
    return row;
  }

  public listBySessionId(sessionId: string): InteractiveReviewResolution[] {
    return this.db
      .select()
      .from(interactiveReviewResolutions)
      .where(eq(interactiveReviewResolutions.sessionId, sessionId))
      .orderBy(interactiveReviewResolutions.createdAt, interactiveReviewResolutions.id)
      .all() as InteractiveReviewResolution[];
  }

  public markApplied(id: string): void {
    this.db
      .update(interactiveReviewResolutions)
      .set({
        appliedAt: now()
      })
      .where(eq(interactiveReviewResolutions.id, id))
      .run();
  }

  public updatePayloadJson(id: string, payloadJson: string | null): void {
    this.db
      .update(interactiveReviewResolutions)
      .set({
        payloadJson
      })
      .where(eq(interactiveReviewResolutions.id, id))
      .run();
  }
}

export type ArtifactRecord = {
  id: string;
  stageRunId: string | null;
  itemId: string;
  projectId: string | null;
  kind: string;
  format: string;
  path: string;
  sha256: string;
  sizeBytes: number;
  createdAt: number;
};

export class ArtifactRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public create(input: Omit<ArtifactRecord, "id" | "createdAt">): ArtifactRecord {
    const row: ArtifactRecord = {
      ...input,
      id: createId("artifact"),
      createdAt: now()
    };
    this.db.insert(artifacts).values(row).run();
    return row;
  }

  public getById(id: string): ArtifactRecord | null {
    return (this.db.select().from(artifacts).where(eq(artifacts.id, id)).get() as ArtifactRecord | undefined) ?? null;
  }

  public listByStageRunId(stageRunId: string): ArtifactRecord[] {
    return this.db.select().from(artifacts).where(eq(artifacts.stageRunId, stageRunId)).all() as ArtifactRecord[];
  }

  public listByItemId(itemId: string): ArtifactRecord[] {
    return this.db.select().from(artifacts).where(eq(artifacts.itemId, itemId)).orderBy(artifacts.createdAt).all() as ArtifactRecord[];
  }

  public getLatestByKind(input: { itemId: string; projectId?: string | null; kind: string }): ArtifactRecord | null {
    const whereClause =
      input.projectId === undefined
        ? and(eq(artifacts.itemId, input.itemId), eq(artifacts.kind, input.kind))
        : and(
            eq(artifacts.itemId, input.itemId),
            eq(artifacts.kind, input.kind),
            input.projectId === null ? isNull(artifacts.projectId) : eq(artifacts.projectId, input.projectId)
          );

    return (
      this.db
        .select()
        .from(artifacts)
        .where(whereClause)
        .orderBy(desc(artifacts.createdAt))
        .limit(1)
        .get() as ArtifactRecord | undefined
    ) ?? null;
  }
}

export type StageRunRecord = {
  id: string;
  itemId: string;
  projectId: string | null;
  stageKey: StageKey;
  status: StageRunStatus;
  inputSnapshotJson: string;
  systemPromptSnapshot: string;
  skillsSnapshotJson: string;
  outputSummaryJson: string | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
};

export class StageRunRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public create(input: Omit<StageRunRecord, "id" | "createdAt" | "updatedAt" | "completedAt">): StageRunRecord {
    const timestamp = now();
    const row: StageRunRecord = {
      ...input,
      id: createId("run"),
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null
    };
    this.db.insert(stageRuns).values(row).run();
    return row;
  }

  public getById(id: string): StageRunRecord | null {
    return (this.db.select().from(stageRuns).where(eq(stageRuns.id, id)).get() as StageRunRecord | undefined) ?? null;
  }

  public listByItemId(itemId: string): StageRunRecord[] {
    return this.db.select().from(stageRuns).where(eq(stageRuns.itemId, itemId)).orderBy(stageRuns.createdAt).all() as StageRunRecord[];
  }

  public listByProjectId(projectId: string): StageRunRecord[] {
    return this.db.select().from(stageRuns).where(eq(stageRuns.projectId, projectId)).orderBy(stageRuns.createdAt).all() as StageRunRecord[];
  }

  public updateStatus(id: string, status: StageRunStatus, options?: { outputSummaryJson?: string | null; errorMessage?: string | null }): void {
    this.db
      .update(stageRuns)
      .set({
        status,
        outputSummaryJson: options?.outputSummaryJson,
        errorMessage: options?.errorMessage ?? null,
        updatedAt: now(),
        completedAt: status === "completed" || status === "failed" || status === "review_required" ? now() : null
      })
      .where(eq(stageRuns.id, id))
      .run();
  }

  public linkInputArtifacts(stageRunId: string, artifactIds: string[]): void {
    if (artifactIds.length === 0) {
      return;
    }
    this.db
      .insert(stageRunInputArtifacts)
      .values(artifactIds.map((artifactId) => ({ stageRunId, artifactId })))
      .run();
  }
}

export type AgentSessionRecord = {
  id: string;
  stageRunId: string;
  adapterKey: string;
  status: string;
  commandJson: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  createdAt: number;
  updatedAt: number;
};

export class AgentSessionRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public create(input: Omit<AgentSessionRecord, "id" | "createdAt" | "updatedAt">): AgentSessionRecord {
    const timestamp = now();
    const row: AgentSessionRecord = {
      ...input,
      id: createId("session"),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.db.insert(agentSessions).values(row).run();
    return row;
  }

  public listByStageRunId(stageRunId: string): AgentSessionRecord[] {
    return this.db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.stageRunId, stageRunId))
      .orderBy(agentSessions.createdAt)
      .all() as AgentSessionRecord[];
  }
}
