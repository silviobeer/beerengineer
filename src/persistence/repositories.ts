import { and, desc, eq, isNull } from "drizzle-orm";

import type {
  AcceptanceCriterion,
  ArchitecturePlan,
  BoardColumn,
  Concept,
  ExecutionAgentSession,
  ImplementationPlan,
  Item,
  ItemPhaseStatus,
  StoryReviewAgentSession,
  StoryReviewFinding,
  StoryReviewFindingCategory,
  StoryReviewFindingSeverity,
  StoryReviewFindingStatus,
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
import { formatItemCode, parseItemCodeSequence } from "../shared/codes.js";
import { createId } from "../shared/ids.js";
import type { DatabaseClient } from "./database.js";
import {
  acceptanceCriteria,
  agentSessions,
  architecturePlans,
  artifacts,
  concepts,
  executionAgentSessions,
  implementationPlans,
  items,
  qaAgentSessions,
  qaFindings,
  qaRuns,
  projectExecutionContexts,
  projects,
  storyReviewAgentSessions,
  storyReviewFindings,
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

  public create(input: { title: string; description: string }): Item {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const timestamp = now();
      const item: Item = {
        id: createId("item"),
        code: this.allocateNextCode(),
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

  private allocateNextCode(): string {
    const latestCodeRow = this.db
      .select({ code: items.code, createdAt: items.createdAt, id: items.id })
      .from(items)
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
    options?: { outputSummaryJson?: string | null; errorMessage?: string | null }
  ): void {
    this.db
      .update(waveStoryExecutions)
      .set({
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
