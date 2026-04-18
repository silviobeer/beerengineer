import { and, desc, eq, isNull } from "drizzle-orm";

import type {
  ArchitecturePlan,
  BoardColumn,
  Concept,
  Item,
  ItemPhaseStatus,
  Project,
  RecordStatus,
  StageKey,
  StageRunStatus,
  UserStory
} from "../domain/types.js";
import { createId } from "../shared/ids.js";
import type { DatabaseClient } from "./database.js";
import {
  agentSessions,
  architecturePlans,
  artifacts,
  concepts,
  items,
  projects,
  stageRunInputArtifacts,
  stageRuns,
  userStories
} from "./schema.js";

function now(): number {
  return Date.now();
}

export class ItemRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public create(input: { title: string; description: string }): Item {
    const timestamp = now();
    const item: Item = {
      id: createId("item"),
      title: input.title,
      description: input.description,
      currentColumn: "idea",
      phaseStatus: "draft",
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.db.insert(items).values(item).run();
    return item;
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
