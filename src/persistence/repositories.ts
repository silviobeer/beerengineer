import { and, desc, eq, inArray, isNull, lt, notInArray, not, or } from "drizzle-orm";

import type {
  AcceptanceCriterion,
  AppVerificationRun,
  AppVerificationRunStatus,
  ArchitecturePlan,
  BrainstormDraft,
  BrainstormMessage,
  BrainstormSession,
  BoardColumn,
  Concept,
  DocumentationAgentSession,
  DocumentationRun,
  DocumentationRunStatus,
  ExecutionReadinessAction,
  ExecutionReadinessFinding,
  ExecutionReadinessFindingStatus,
  ExecutionReadinessRun,
  VerificationReadinessAction,
  VerificationReadinessFinding,
  VerificationReadinessFindingStatus,
  VerificationReadinessRun,
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
  QualityKnowledgeEntry,
  QualityKnowledgeSource,
  ReviewAssumption,
  ReviewFinding,
  ReviewFindingSeverity,
  ReviewFindingStatus,
  ReviewGateDecision,
  ReviewKind,
  ReviewQuestion,
  ReviewQuestionStatus,
  ReviewRun,
  ReviewRunStatus,
  ReviewSynthesis,
  RecordStatus,
  StageKey,
  StageRunStatus,
  TestAgentSession,
  UserStory,
  VerificationRun,
  VerificationRunMode,
  Workspace,
  WorkspaceAssistMessage,
  WorkspaceAssistSession,
  WorkspaceAssistSessionStatus,
  WorkspaceCoderabbitSettings,
  WorkspaceSettings,
  WorkspaceSonarSettings,
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
  brainstormDrafts,
  brainstormMessages,
  brainstormSessions,
  concepts,
  documentationAgentSessions,
  documentationRuns,
  executionReadinessActions,
  executionReadinessFindings,
  executionReadinessRuns,
  executionAgentSessions,
  verificationReadinessActions,
  verificationReadinessFindings,
  verificationReadinessRuns,
  appVerificationRuns,
  implementationPlans,
  interactiveReviewEntries,
  interactiveReviewMessages,
  interactiveReviewResolutions,
  interactiveReviewSessions,
  items,
  qualityKnowledgeEntries,
  qaAgentSessions,
  qaFindings,
  qaRuns,
  reviewAssumptions,
  reviewFindings,
  reviewQuestions,
  reviewRuns,
  reviewSyntheses,
  projectExecutionContexts,
  projects,
  workspaceSettings,
  workspaceCoderabbitSettings,
  workspaceAssistMessages,
  workspaceAssistSessions,
  workspaceSonarSettings,
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

function parseQualityRelevanceTags(value: string): {
  files: string[];
  storyCodes: string[];
  modules: string[];
  categories: string[];
} {
  return JSON.parse(value) as {
    files: string[];
    storyCodes: string[];
    modules: string[];
    categories: string[];
  };
}

function definedField<TKey extends string, TValue>(key: TKey, value: TValue | undefined): Partial<Record<TKey, TValue>> {
  if (value === undefined) {
    return {};
  }
  return { [key]: value } as Partial<Record<TKey, TValue>>;
}

function valueOrCurrent<TValue>(value: TValue | undefined, current: TValue): TValue {
  if (value === undefined) {
    return current;
  }
  return value;
}

function mapExecutionReadinessFindingRow(row: ExecutionReadinessFindingRow): ExecutionReadinessFinding {
  return {
    ...row,
    isAutoFixable: row.isAutoFixable !== 0
  };
}

function mapVerificationReadinessFindingRow(row: VerificationReadinessFindingRow): VerificationReadinessFinding {
  return {
    ...row,
    isAutoFixable: row.isAutoFixable !== 0
  };
}

type OptionalQueryRow<TValue> = TValue | undefined;

type WorkspaceCreateInput = Omit<Workspace, "id" | "createdAt" | "updatedAt">;
type WorkspaceSettingsCreateInput = Omit<WorkspaceSettings, "createdAt" | "updatedAt">;
type WorkspaceSonarSettingsUpsertInput = Omit<
  WorkspaceSonarSettings,
  "createdAt" | "updatedAt" | "lastTestedAt" | "lastError"
> & { lastTestedAt?: number | null; lastError?: string | null };
type WorkspaceCoderabbitSettingsUpsertInput = Omit<
  WorkspaceCoderabbitSettings,
  "createdAt" | "updatedAt" | "lastTestedAt" | "lastError"
> & { lastTestedAt?: number | null; lastError?: string | null };
type BrainstormSessionCreateInput = Omit<
  BrainstormSession,
  "id" | "startedAt" | "updatedAt" | "resolvedAt" | "lastAssistantMessageId" | "lastUserMessageId"
>;
type BrainstormMessageCreateInput = Omit<BrainstormMessage, "id" | "createdAt">;
type BrainstormDraftCreateInput = Omit<BrainstormDraft, "id" | "lastUpdatedAt">;
type ReviewRunCreateInput = Omit<ReviewRun, "id" | "startedAt" | "updatedAt" | "completedAt">;
type ReviewFindingCreateInput = Omit<ReviewFinding, "id" | "createdAt" | "updatedAt">;
type ReviewSynthesisCreateInput = Omit<ReviewSynthesis, "id" | "createdAt">;
type ReviewQuestionCreateInput = Omit<ReviewQuestion, "id" | "createdAt" | "updatedAt">;
type ReviewAssumptionCreateInput = Omit<ReviewAssumption, "id" | "createdAt">;
type WorkspaceAssistSessionCreateInput = Omit<
  WorkspaceAssistSession,
  "id" | "startedAt" | "updatedAt" | "resolvedAt" | "lastAssistantMessageId" | "lastUserMessageId"
>;
type WorkspaceAssistMessageCreateInput = Omit<WorkspaceAssistMessage, "id" | "createdAt">;

type ConceptCreateInput = Omit<Concept, "id" | "createdAt" | "updatedAt">;

type ProjectCreateInput = Omit<Project, "id" | "createdAt" | "updatedAt">;
type UserStoryCreateInput = Omit<UserStory, "id" | "createdAt" | "updatedAt">;
type AcceptanceCriterionCreateInput = Omit<AcceptanceCriterion, "id" | "createdAt" | "updatedAt">;
type ArchitecturePlanCreateInput = Omit<ArchitecturePlan, "id" | "createdAt" | "updatedAt">;
type ImplementationPlanCreateInput = Omit<ImplementationPlan, "id" | "createdAt" | "updatedAt">;
type WaveCreateInput = Omit<Wave, "id" | "createdAt" | "updatedAt">;
type WaveStoryCreateInput = Omit<WaveStory, "id" | "createdAt" | "updatedAt">;
type ProjectExecutionContextUpsertInput = Omit<ProjectExecutionContext, "id" | "createdAt" | "updatedAt">;
type ExecutionReadinessRunCreateInput = Omit<ExecutionReadinessRun, "id" | "startedAt" | "updatedAt" | "completedAt">;
type ExecutionReadinessFindingCreateInput = Omit<ExecutionReadinessFinding, "id" | "createdAt" | "updatedAt">;
type ExecutionReadinessActionCreateInput = Omit<ExecutionReadinessAction, "id" | "createdAt" | "updatedAt">;
type VerificationReadinessRunCreateInput = Omit<VerificationReadinessRun, "id" | "startedAt" | "updatedAt" | "completedAt">;
type VerificationReadinessFindingCreateInput = Omit<VerificationReadinessFinding, "id" | "createdAt" | "updatedAt">;
type VerificationReadinessActionCreateInput = Omit<VerificationReadinessAction, "id" | "createdAt" | "updatedAt">;

type WaveExecutionCreateInput = Omit<WaveExecution, "id" | "createdAt" | "updatedAt" | "completedAt">;

type WaveStoryExecutionCreateInput = Omit<WaveStoryExecution, "id" | "createdAt" | "updatedAt" | "completedAt">;

type WaveStoryTestRunCreateInput = Omit<WaveStoryTestRun, "id" | "createdAt" | "updatedAt" | "completedAt">;
type TestAgentSessionCreateInput = Omit<TestAgentSession, "id" | "createdAt" | "updatedAt">;
type ExecutionAgentSessionCreateInput = Omit<ExecutionAgentSession, "id" | "createdAt" | "updatedAt">;
type VerificationRunCreateInput = Omit<VerificationRun, "id" | "createdAt" | "updatedAt">;
type StoryReviewRunCreateInput = Omit<StoryReviewRun, "id" | "createdAt" | "updatedAt" | "completedAt">;
type StoryReviewFindingCreateInput = Omit<StoryReviewFinding, "id" | "createdAt" | "updatedAt">;
type StoryReviewAgentSessionCreateInput = Omit<StoryReviewAgentSession, "id" | "createdAt" | "updatedAt">;
type QaRunCreateInput = Omit<QaRun, "id" | "createdAt" | "updatedAt" | "completedAt">;
type QaFindingCreateInput = Omit<QaFinding, "id" | "createdAt" | "updatedAt">;
type QaAgentSessionCreateInput = Omit<QaAgentSession, "id" | "createdAt" | "updatedAt">;
type QualityKnowledgeEntryCreateInput = Omit<QualityKnowledgeEntry, "id" | "createdAt" | "updatedAt">;
type DocumentationRunCreateInput = Omit<DocumentationRun, "id" | "createdAt" | "updatedAt" | "completedAt">;
type DocumentationAgentSessionCreateInput = Omit<DocumentationAgentSession, "id" | "createdAt" | "updatedAt">;
type ArtifactCreateInput = Omit<ArtifactRecord, "id" | "createdAt">;
type StageRunCreateInput = Omit<StageRunRecord, "id" | "createdAt" | "updatedAt" | "completedAt">;
type AgentSessionCreateInput = Omit<AgentSessionRecord, "id" | "createdAt" | "updatedAt">;

type ExecutionReadinessFindingRow = Omit<ExecutionReadinessFinding, "isAutoFixable"> & {
  isAutoFixable: number;
};
type VerificationReadinessFindingRow = Omit<VerificationReadinessFinding, "isAutoFixable"> & {
  isAutoFixable: number;
};

type LatestItemCodeRow = {
  code: string | null;
  createdAt: number;
  id: string;
};

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

  public create(input: WorkspaceCreateInput): Workspace {
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

  public create(input: WorkspaceSettingsCreateInput): WorkspaceSettings {
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
        runtimeProfileJson: updated.runtimeProfileJson,
        autorunPolicyJson: updated.autorunPolicyJson,
        promptOverridesJson: updated.promptOverridesJson,
        skillOverridesJson: updated.skillOverridesJson,
        verificationDefaultsJson: updated.verificationDefaultsJson,
        appTestConfigJson: updated.appTestConfigJson,
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

export class WorkspaceSonarSettingsRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public getByWorkspaceId(workspaceId: string): WorkspaceSonarSettings | null {
    return (
      this.db.select().from(workspaceSonarSettings).where(eq(workspaceSonarSettings.workspaceId, workspaceId)).get() as
        | WorkspaceSonarSettings
        | undefined
    ) ?? null;
  }

  public upsertByWorkspaceId(input: WorkspaceSonarSettingsUpsertInput): WorkspaceSonarSettings {
    const existing = this.getByWorkspaceId(input.workspaceId);
    const timestamp = now();
    const row: WorkspaceSonarSettings = {
      workspaceId: input.workspaceId,
      enabled: input.enabled,
      providerType: input.providerType,
      hostUrl: input.hostUrl,
      organization: input.organization,
      projectKey: input.projectKey,
      token: input.token,
      defaultBranch: input.defaultBranch,
      gatingMode: input.gatingMode,
      validationStatus: input.validationStatus,
      lastTestedAt: input.lastTestedAt ?? null,
      lastError: input.lastError ?? null,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };

    if (existing) {
      this.db.update(workspaceSonarSettings).set(row).where(eq(workspaceSonarSettings.workspaceId, input.workspaceId)).run();
    } else {
      this.db.insert(workspaceSonarSettings).values(row).run();
    }

    return row;
  }

  public clearToken(workspaceId: string): void {
    this.db
      .update(workspaceSonarSettings)
      .set({ token: null, validationStatus: "untested", lastError: null, updatedAt: now() })
      .where(eq(workspaceSonarSettings.workspaceId, workspaceId))
      .run();
  }

  public isConfigured(workspaceId: string): boolean {
    const settings = this.getByWorkspaceId(workspaceId);
    return Boolean(settings?.hostUrl && settings.organization && settings.projectKey && settings.token);
  }
}

export class WorkspaceCoderabbitSettingsRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public getByWorkspaceId(workspaceId: string): WorkspaceCoderabbitSettings | null {
    return (
      this.db
        .select()
        .from(workspaceCoderabbitSettings)
        .where(eq(workspaceCoderabbitSettings.workspaceId, workspaceId))
        .get() as WorkspaceCoderabbitSettings | undefined
    ) ?? null;
  }

  public upsertByWorkspaceId(input: WorkspaceCoderabbitSettingsUpsertInput): WorkspaceCoderabbitSettings {
    const existing = this.getByWorkspaceId(input.workspaceId);
    const timestamp = now();
    const row: WorkspaceCoderabbitSettings = {
      workspaceId: input.workspaceId,
      enabled: input.enabled,
      providerType: input.providerType,
      hostUrl: input.hostUrl,
      organization: input.organization,
      repository: input.repository,
      token: input.token,
      defaultBranch: input.defaultBranch,
      gatingMode: input.gatingMode,
      validationStatus: input.validationStatus,
      lastTestedAt: input.lastTestedAt ?? null,
      lastError: input.lastError ?? null,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };

    if (existing) {
      this.db
        .update(workspaceCoderabbitSettings)
        .set(row)
        .where(eq(workspaceCoderabbitSettings.workspaceId, input.workspaceId))
        .run();
    } else {
      this.db.insert(workspaceCoderabbitSettings).values(row).run();
    }

    return row;
  }

  public clearToken(workspaceId: string): void {
    this.db
      .update(workspaceCoderabbitSettings)
      .set({ token: null, validationStatus: "untested", lastError: null, updatedAt: now() })
      .where(eq(workspaceCoderabbitSettings.workspaceId, workspaceId))
      .run();
  }

  public isConfigured(workspaceId: string): boolean {
    const settings = this.getByWorkspaceId(workspaceId);
    return Boolean(settings?.hostUrl && settings.organization && settings.repository && settings.token);
  }
}

export class BrainstormSessionRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public getLatestByItemId(itemId: string): BrainstormSession | null {
    return (
      this.db
        .select()
        .from(brainstormSessions)
        .where(eq(brainstormSessions.itemId, itemId))
        .orderBy(desc(brainstormSessions.startedAt), desc(brainstormSessions.id))
        .limit(1)
        .get() as BrainstormSession | undefined
    ) ?? null;
  }

  public getById(id: string): BrainstormSession | null {
    return (
      this.db.select().from(brainstormSessions).where(eq(brainstormSessions.id, id)).get() as
        | BrainstormSession
        | undefined
    ) ?? null;
  }

  public findOpenByItemId(itemId: string): BrainstormSession | null {
    return (
      this.db
        .select()
        .from(brainstormSessions)
        .where(and(eq(brainstormSessions.itemId, itemId), notInArray(brainstormSessions.status, ["resolved", "cancelled"])))
        .orderBy(desc(brainstormSessions.startedAt), desc(brainstormSessions.id))
        .limit(1)
        .get() as BrainstormSession | undefined
    ) ?? null;
  }

  public create(input: BrainstormSessionCreateInput): BrainstormSession {
    const timestamp = now();
    const row: BrainstormSession = {
      ...input,
      id: createId("brainstorm_session"),
      startedAt: timestamp,
      updatedAt: timestamp,
      resolvedAt: null,
      lastAssistantMessageId: null,
      lastUserMessageId: null
    };
    this.db.insert(brainstormSessions).values(row).run();
    return row;
  }

  public update(
    id: string,
    input: Partial<Pick<BrainstormSession, "status" | "mode" | "resolvedAt" | "lastAssistantMessageId" | "lastUserMessageId">>
  ): void {
    this.db
      .update(brainstormSessions)
      .set({
        ...definedField("status", input.status),
        ...definedField("mode", input.mode),
        ...definedField("resolvedAt", input.resolvedAt),
        ...definedField("lastAssistantMessageId", input.lastAssistantMessageId),
        ...definedField("lastUserMessageId", input.lastUserMessageId),
        updatedAt: now()
      })
      .where(eq(brainstormSessions.id, id))
      .run();
  }
}

export class BrainstormMessageRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public create(input: BrainstormMessageCreateInput): BrainstormMessage {
    const row: BrainstormMessage = {
      ...input,
      id: createId("brainstorm_message"),
      createdAt: now()
    };
    this.db.insert(brainstormMessages).values(row).run();
    return row;
  }

  public listBySessionId(sessionId: string): BrainstormMessage[] {
    return this.db
      .select()
      .from(brainstormMessages)
      .where(eq(brainstormMessages.sessionId, sessionId))
      .orderBy(brainstormMessages.createdAt, brainstormMessages.id)
      .all() as BrainstormMessage[];
  }
}

export class BrainstormDraftRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public getById(id: string): BrainstormDraft | null {
    return (
      this.db.select().from(brainstormDrafts).where(eq(brainstormDrafts.id, id)).get() as BrainstormDraft | undefined
    ) ?? null;
  }

  public getLatestBySessionId(sessionId: string): BrainstormDraft | null {
    return (
      this.db
        .select()
        .from(brainstormDrafts)
        .where(eq(brainstormDrafts.sessionId, sessionId))
        .orderBy(desc(brainstormDrafts.revision), desc(brainstormDrafts.id))
        .limit(1)
        .get() as BrainstormDraft | undefined
    ) ?? null;
  }

  public create(input: BrainstormDraftCreateInput): BrainstormDraft {
    const row: BrainstormDraft = {
      ...input,
      id: createId("brainstorm_draft"),
      lastUpdatedAt: now()
    };
    this.db.insert(brainstormDrafts).values(row).run();
    return row;
  }

  public createRevision(
    previous: BrainstormDraft,
    input: Partial<
      Pick<
        BrainstormDraft,
        | "status"
        | "problem"
        | "targetUsersJson"
        | "coreOutcome"
        | "useCasesJson"
        | "constraintsJson"
        | "nonGoalsJson"
        | "risksJson"
        | "openQuestionsJson"
        | "candidateDirectionsJson"
        | "recommendedDirection"
        | "scopeNotes"
        | "assumptionsJson"
        | "lastUpdatedFromMessageId"
      >
    >
  ): BrainstormDraft {
    return this.create({
      itemId: previous.itemId,
      sessionId: previous.sessionId,
      revision: previous.revision + 1,
      status: input.status ?? previous.status,
      problem: valueOrCurrent(input.problem, previous.problem),
      targetUsersJson: input.targetUsersJson ?? previous.targetUsersJson,
      coreOutcome: valueOrCurrent(input.coreOutcome, previous.coreOutcome),
      useCasesJson: input.useCasesJson ?? previous.useCasesJson,
      constraintsJson: input.constraintsJson ?? previous.constraintsJson,
      nonGoalsJson: input.nonGoalsJson ?? previous.nonGoalsJson,
      risksJson: input.risksJson ?? previous.risksJson,
      openQuestionsJson: input.openQuestionsJson ?? previous.openQuestionsJson,
      candidateDirectionsJson: input.candidateDirectionsJson ?? previous.candidateDirectionsJson,
      recommendedDirection: valueOrCurrent(input.recommendedDirection, previous.recommendedDirection),
      scopeNotes: valueOrCurrent(input.scopeNotes, previous.scopeNotes),
      assumptionsJson: input.assumptionsJson ?? previous.assumptionsJson,
      lastUpdatedFromMessageId: valueOrCurrent(input.lastUpdatedFromMessageId, previous.lastUpdatedFromMessageId)
    });
  }
}

export class ReviewRunRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public getById(id: string): ReviewRun | null {
    return (this.db.select().from(reviewRuns).where(eq(reviewRuns.id, id)).get() as ReviewRun | undefined) ?? null;
  }

  public getLatestBySubject(input: {
    reviewKind: ReviewKind;
    subjectType: string;
    subjectId: string;
  }): ReviewRun | null {
    return (
      this.db
        .select()
        .from(reviewRuns)
        .where(and(eq(reviewRuns.reviewKind, input.reviewKind), eq(reviewRuns.subjectType, input.subjectType), eq(reviewRuns.subjectId, input.subjectId)))
        .orderBy(desc(reviewRuns.startedAt), desc(reviewRuns.id))
        .limit(1)
        .get() as ReviewRun | undefined
    ) ?? null;
  }

  public getLatestComparable(input: {
    reviewKind: ReviewKind;
    subjectType: string;
    subjectId: string;
    subjectStep?: string | null;
    reviewMode?: string | null;
  }): ReviewRun | null {
    const subjectStepClause =
      input.subjectStep === undefined ? undefined : input.subjectStep === null ? isNull(reviewRuns.subjectStep) : eq(reviewRuns.subjectStep, input.subjectStep);
    const reviewModeClause =
      input.reviewMode === undefined ? undefined : input.reviewMode === null ? isNull(reviewRuns.reviewMode) : eq(reviewRuns.reviewMode, input.reviewMode);
    return (
      this.db
        .select()
        .from(reviewRuns)
        .where(
          and(
            eq(reviewRuns.reviewKind, input.reviewKind),
            eq(reviewRuns.subjectType, input.subjectType),
            eq(reviewRuns.subjectId, input.subjectId),
            subjectStepClause,
            reviewModeClause
          )
        )
        .orderBy(desc(reviewRuns.startedAt), desc(reviewRuns.id))
        .limit(1)
        .get() as ReviewRun | undefined
    ) ?? null;
  }

  public getPreviousComparable(input: {
    reviewKind: ReviewKind;
    subjectType: string;
    subjectId: string;
    subjectStep?: string | null;
    reviewMode?: string | null;
    beforeStartedAt: number;
    excludeRunId: string;
  }): ReviewRun | null {
    const subjectStepClause =
      input.subjectStep === undefined ? undefined : input.subjectStep === null ? isNull(reviewRuns.subjectStep) : eq(reviewRuns.subjectStep, input.subjectStep);
    const reviewModeClause =
      input.reviewMode === undefined ? undefined : input.reviewMode === null ? isNull(reviewRuns.reviewMode) : eq(reviewRuns.reviewMode, input.reviewMode);
    return (
      this.db
        .select()
        .from(reviewRuns)
        .where(
          and(
            eq(reviewRuns.reviewKind, input.reviewKind),
            eq(reviewRuns.subjectType, input.subjectType),
            eq(reviewRuns.subjectId, input.subjectId),
            subjectStepClause,
            reviewModeClause,
            lt(reviewRuns.startedAt, input.beforeStartedAt),
            not(eq(reviewRuns.id, input.excludeRunId))
          )
        )
        .orderBy(desc(reviewRuns.startedAt), desc(reviewRuns.id))
        .limit(1)
        .get() as ReviewRun | undefined
    ) ?? null;
  }

  public create(input: ReviewRunCreateInput): ReviewRun {
    const timestamp = now();
    const row: ReviewRun = {
      ...input,
      id: createId("review_run"),
      startedAt: timestamp,
      updatedAt: timestamp,
      completedAt: null
    };
    this.db.insert(reviewRuns).values(row).run();
    return row;
  }

  public update(
    id: string,
    input: Partial<
      Pick<
        ReviewRun,
        | "status"
        | "readiness"
        | "interactionMode"
        | "reviewMode"
        | "automationLevel"
        | "requestedMode"
        | "actualMode"
        | "confidence"
        | "gateEligibility"
        | "sourceSummaryJson"
        | "providersUsedJson"
        | "missingCapabilitiesJson"
        | "reviewSummary"
        | "completedAt"
        | "failedReason"
      >
    >
  ): void {
    this.db
      .update(reviewRuns)
      .set({
        ...definedField("status", input.status),
        ...definedField("readiness", input.readiness),
        ...definedField("interactionMode", input.interactionMode),
        ...definedField("reviewMode", input.reviewMode),
        ...definedField("automationLevel", input.automationLevel),
        ...definedField("requestedMode", input.requestedMode),
        ...definedField("actualMode", input.actualMode),
        ...definedField("confidence", input.confidence),
        ...definedField("gateEligibility", input.gateEligibility),
        ...definedField("sourceSummaryJson", input.sourceSummaryJson),
        ...definedField("providersUsedJson", input.providersUsedJson),
        ...definedField("missingCapabilitiesJson", input.missingCapabilitiesJson),
        ...definedField("reviewSummary", input.reviewSummary),
        ...definedField("completedAt", input.completedAt),
        ...definedField("failedReason", input.failedReason),
        updatedAt: now()
      })
      .where(eq(reviewRuns.id, id))
      .run();
  }
}

export class ReviewFindingRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public createMany(input: ReviewFindingCreateInput[]): ReviewFinding[] {
    const timestamp = now();
    const rows = input.map((entry) => ({
      ...entry,
      id: createId("review_finding"),
      createdAt: timestamp,
      updatedAt: timestamp
    }));
    if (rows.length > 0) {
      this.db.insert(reviewFindings).values(rows).run();
    }
    return rows;
  }

  public listByRunId(runId: string): ReviewFinding[] {
    return this.db
      .select()
      .from(reviewFindings)
      .where(eq(reviewFindings.runId, runId))
      .orderBy(reviewFindings.createdAt, reviewFindings.id)
      .all() as ReviewFinding[];
  }

  public listUnresolvedByRunId(runId: string): ReviewFinding[] {
    return this.db
      .select()
      .from(reviewFindings)
      .where(and(eq(reviewFindings.runId, runId), inArray(reviewFindings.status, ["new", "open"] satisfies ReviewFindingStatus[])))
      .orderBy(reviewFindings.createdAt, reviewFindings.id)
      .all() as ReviewFinding[];
  }

  public markResolved(runId: string, fingerprints: string[]): void {
    if (fingerprints.length === 0) {
      return;
    }
    this.db
      .update(reviewFindings)
      .set({
        status: "resolved",
        updatedAt: now()
      })
      .where(and(eq(reviewFindings.runId, runId), inArray(reviewFindings.fingerprint, fingerprints)))
      .run();
  }
}

export class ReviewSynthesisRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public create(input: ReviewSynthesisCreateInput): ReviewSynthesis {
    const row: ReviewSynthesis = {
      ...input,
      id: createId("review_synthesis"),
      createdAt: now()
    };
    this.db.insert(reviewSyntheses).values(row).run();
    return row;
  }

  public getLatestByRunId(runId: string): ReviewSynthesis | null {
    return (
      this.db
        .select()
        .from(reviewSyntheses)
        .where(eq(reviewSyntheses.runId, runId))
        .orderBy(desc(reviewSyntheses.createdAt), desc(reviewSyntheses.id))
        .limit(1)
        .get() as ReviewSynthesis | undefined
    ) ?? null;
  }
}

export class ReviewQuestionRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public createMany(input: ReviewQuestionCreateInput[]): ReviewQuestion[] {
    const timestamp = now();
    const rows = input.map((entry) => ({
      ...entry,
      id: createId("review_question"),
      createdAt: timestamp,
      updatedAt: timestamp
    }));
    if (rows.length > 0) {
      this.db.insert(reviewQuestions).values(rows).run();
    }
    return rows;
  }

  public listByRunId(runId: string): ReviewQuestion[] {
    return this.db
      .select()
      .from(reviewQuestions)
      .where(eq(reviewQuestions.runId, runId))
      .orderBy(reviewQuestions.createdAt, reviewQuestions.id)
      .all() as ReviewQuestion[];
  }

  public answer(questionId: string, answer: string): void {
    this.db
      .update(reviewQuestions)
      .set({
        answer,
        status: "answered",
        answeredAt: now(),
        updatedAt: now()
      })
      .where(eq(reviewQuestions.id, questionId))
      .run();
  }
}

export class ReviewAssumptionRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public createMany(input: ReviewAssumptionCreateInput[]): ReviewAssumption[] {
    const timestamp = now();
    const rows = input.map((entry) => ({
      ...entry,
      id: createId("review_assumption"),
      createdAt: timestamp
    }));
    if (rows.length > 0) {
      this.db.insert(reviewAssumptions).values(rows).run();
    }
    return rows;
  }

  public listByRunId(runId: string): ReviewAssumption[] {
    return this.db
      .select()
      .from(reviewAssumptions)
      .where(eq(reviewAssumptions.runId, runId))
      .orderBy(reviewAssumptions.createdAt, reviewAssumptions.id)
      .all() as ReviewAssumption[];
  }
}

export class WorkspaceAssistSessionRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public getById(id: string): WorkspaceAssistSession | null {
    return (
      this.db.select().from(workspaceAssistSessions).where(eq(workspaceAssistSessions.id, id)).get() as
        | WorkspaceAssistSession
        | undefined
    ) ?? null;
  }

  public getLatestByWorkspaceId(workspaceId: string): WorkspaceAssistSession | null {
    return (
      this.db
        .select()
        .from(workspaceAssistSessions)
        .where(eq(workspaceAssistSessions.workspaceId, workspaceId))
        .orderBy(desc(workspaceAssistSessions.startedAt), desc(workspaceAssistSessions.id))
        .limit(1)
        .get() as WorkspaceAssistSession | undefined
    ) ?? null;
  }

  public findOpenByWorkspaceId(workspaceId: string): WorkspaceAssistSession | null {
    return (
      this.db
        .select()
        .from(workspaceAssistSessions)
        .where(
          and(
            eq(workspaceAssistSessions.workspaceId, workspaceId),
            notInArray(workspaceAssistSessions.status, ["resolved", "cancelled"] satisfies WorkspaceAssistSessionStatus[])
          )
        )
        .orderBy(desc(workspaceAssistSessions.startedAt), desc(workspaceAssistSessions.id))
        .limit(1)
        .get() as WorkspaceAssistSession | undefined
    ) ?? null;
  }

  public listByWorkspaceId(workspaceId: string): WorkspaceAssistSession[] {
    return this.db
      .select()
      .from(workspaceAssistSessions)
      .where(eq(workspaceAssistSessions.workspaceId, workspaceId))
      .orderBy(desc(workspaceAssistSessions.startedAt), desc(workspaceAssistSessions.id))
      .all() as WorkspaceAssistSession[];
  }

  public create(input: WorkspaceAssistSessionCreateInput): WorkspaceAssistSession {
    const timestamp = now();
    const row: WorkspaceAssistSession = {
      ...input,
      id: createId("workspace_assist_session"),
      startedAt: timestamp,
      updatedAt: timestamp,
      resolvedAt: null,
      lastAssistantMessageId: null,
      lastUserMessageId: null
    };
    this.db.insert(workspaceAssistSessions).values(row).run();
    return row;
  }

  public update(
    id: string,
    input: Partial<Pick<WorkspaceAssistSession, "status" | "currentPlanJson" | "resolvedAt" | "lastAssistantMessageId" | "lastUserMessageId">>
  ): void {
    this.db
      .update(workspaceAssistSessions)
      .set({
        ...definedField("status", input.status),
        ...definedField("currentPlanJson", input.currentPlanJson),
        ...definedField("resolvedAt", input.resolvedAt),
        ...definedField("lastAssistantMessageId", input.lastAssistantMessageId),
        ...definedField("lastUserMessageId", input.lastUserMessageId),
        updatedAt: now()
      })
      .where(eq(workspaceAssistSessions.id, id))
      .run();
  }
}

export class WorkspaceAssistMessageRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public create(input: WorkspaceAssistMessageCreateInput): WorkspaceAssistMessage {
    const row: WorkspaceAssistMessage = {
      ...input,
      id: createId("workspace_assist_message"),
      createdAt: now()
    };
    this.db.insert(workspaceAssistMessages).values(row).run();
    return row;
  }

  public listBySessionId(sessionId: string): WorkspaceAssistMessage[] {
    return this.db
      .select()
      .from(workspaceAssistMessages)
      .where(eq(workspaceAssistMessages.sessionId, sessionId))
      .orderBy(workspaceAssistMessages.createdAt, workspaceAssistMessages.id)
      .all() as WorkspaceAssistMessage[];
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
      .get() as OptionalQueryRow<LatestItemCodeRow>;

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

  public create(input: ConceptCreateInput): Concept {
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

  public createMany(input: ProjectCreateInput[]): Project[] {
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

  public createMany(input: UserStoryCreateInput[]): UserStory[] {
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
        ...definedField("title", input.title),
        ...definedField("description", input.description),
        ...definedField("actor", input.actor),
        ...definedField("goal", input.goal),
        ...definedField("benefit", input.benefit),
        ...definedField("priority", input.priority),
        ...definedField("status", input.status),
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

  public createMany(input: AcceptanceCriterionCreateInput[]): AcceptanceCriterion[] {
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

  public getById(id: string): ArchitecturePlan | null {
    return (
      this.db.select().from(architecturePlans).where(eq(architecturePlans.id, id)).get() as ArchitecturePlan | undefined
    ) ?? null;
  }

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

  public create(input: ArchitecturePlanCreateInput): ArchitecturePlan {
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

  public getById(id: string): ImplementationPlan | null {
    return this.db.select().from(implementationPlans).where(eq(implementationPlans.id, id)).get() as ImplementationPlan | null;
  }

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

  public listLatestByProjectIds(projectIds: string[]): ImplementationPlan[] {
    if (projectIds.length === 0) {
      return [];
    }
    return projectIds
      .map((projectId) => this.getLatestByProjectId(projectId))
      .filter((plan): plan is ImplementationPlan => plan !== null);
  }

  public create(input: ImplementationPlanCreateInput): ImplementationPlan {
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

  public delete(id: string): void {
    this.db.delete(implementationPlans).where(eq(implementationPlans.id, id)).run();
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

  public createMany(input: WaveCreateInput[]): Wave[] {
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

  public deleteByImplementationPlanId(implementationPlanId: string): void {
    this.db.delete(waves).where(eq(waves.implementationPlanId, implementationPlanId)).run();
  }
}

export class WaveStoryRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public listByWaveId(waveId: string): WaveStory[] {
    return this.db.select().from(waveStories).where(eq(waveStories.waveId, waveId)).orderBy(waveStories.position).all() as WaveStory[];
  }

  public listByWaveIds(waveIds: string[]): WaveStory[] {
    if (waveIds.length === 0) {
      return [];
    }
    return this.db
      .select()
      .from(waveStories)
      .where(inArray(waveStories.waveId, waveIds))
      .orderBy(waveStories.waveId, waveStories.position)
      .all() as WaveStory[];
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

  public createMany(input: WaveStoryCreateInput[]): WaveStory[] {
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

  public deleteByWaveIds(waveIds: string[]): void {
    if (waveIds.length === 0) {
      return;
    }
    this.db.delete(waveStories).where(inArray(waveStories.waveId, waveIds)).run();
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

  public deleteByStoryIds(storyIds: string[]): void {
    if (storyIds.length === 0) {
      return;
    }
    this.db
      .delete(waveStoryDependencies)
      .where(or(inArray(waveStoryDependencies.blockingStoryId, storyIds), inArray(waveStoryDependencies.dependentStoryId, storyIds)))
      .run();
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

  public upsert(input: ProjectExecutionContextUpsertInput): ProjectExecutionContext {
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

export class ExecutionReadinessRunRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public getById(id: string): ExecutionReadinessRun | null {
    return (
      this.db.select().from(executionReadinessRuns).where(eq(executionReadinessRuns.id, id)).get() as
        | ExecutionReadinessRun
        | undefined
    ) ?? null;
  }

  public getLatestByProjectId(projectId: string): ExecutionReadinessRun | null {
    return (
      this.db
        .select()
        .from(executionReadinessRuns)
        .where(eq(executionReadinessRuns.projectId, projectId))
        .orderBy(desc(executionReadinessRuns.startedAt), desc(executionReadinessRuns.id))
        .limit(1)
        .get() as ExecutionReadinessRun | undefined
    ) ?? null;
  }

  public findLatestReusable(input: {
    projectId: string;
    waveId: string | null;
    storyId: string | null;
    workspaceRoot: string;
    inputSnapshotJson: string;
  }): ExecutionReadinessRun | null {
    return (
      this.db
        .select()
        .from(executionReadinessRuns)
        .where(
          and(
            eq(executionReadinessRuns.projectId, input.projectId),
            input.waveId === null ? isNull(executionReadinessRuns.waveId) : eq(executionReadinessRuns.waveId, input.waveId),
            input.storyId === null ? isNull(executionReadinessRuns.storyId) : eq(executionReadinessRuns.storyId, input.storyId),
            eq(executionReadinessRuns.workspaceRoot, input.workspaceRoot),
            eq(executionReadinessRuns.inputSnapshotJson, input.inputSnapshotJson),
            not(eq(executionReadinessRuns.status, "running"))
          )
        )
        .orderBy(desc(executionReadinessRuns.startedAt), desc(executionReadinessRuns.id))
        .limit(1)
        .get() as ExecutionReadinessRun | undefined
    ) ?? null;
  }

  public create(input: ExecutionReadinessRunCreateInput): ExecutionReadinessRun {
    const timestamp = now();
    const row: ExecutionReadinessRun = {
      ...input,
      id: createId("execution_readiness_run"),
      startedAt: timestamp,
      updatedAt: timestamp,
      completedAt: null
    };
    this.db.insert(executionReadinessRuns).values(row).run();
    return row;
  }

  public update(
    id: string,
    input: Partial<Pick<ExecutionReadinessRun, "status" | "summaryJson" | "errorMessage" | "completedAt">>
  ): void {
    this.db
      .update(executionReadinessRuns)
      .set({
        ...definedField("status", input.status),
        ...definedField("summaryJson", input.summaryJson),
        ...definedField("errorMessage", input.errorMessage),
        ...definedField("completedAt", input.completedAt),
        updatedAt: now()
      })
      .where(eq(executionReadinessRuns.id, id))
      .run();
  }
}

export class ExecutionReadinessFindingRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public createMany(input: ExecutionReadinessFindingCreateInput[]): ExecutionReadinessFinding[] {
    const timestamp = now();
    const rows = input.map((entry) => ({
      ...entry,
      id: createId("execution_readiness_finding"),
      createdAt: timestamp,
      updatedAt: timestamp
    }));
    if (rows.length > 0) {
      this.db
        .insert(executionReadinessFindings)
        .values(rows.map((row) => ({ ...row, isAutoFixable: row.isAutoFixable ? 1 : 0 })))
        .run();
    }
    return rows;
  }

  public listByRunId(runId: string): ExecutionReadinessFinding[] {
    return (this.db
      .select()
      .from(executionReadinessFindings)
      .where(eq(executionReadinessFindings.runId, runId))
      .orderBy(executionReadinessFindings.checkIteration, executionReadinessFindings.createdAt, executionReadinessFindings.id)
      .all() as ExecutionReadinessFindingRow[]).map(mapExecutionReadinessFindingRow);
  }

  public listLatestByRunId(runId: string): ExecutionReadinessFinding[] {
    return this.listByRunId(runId).filter((finding) => finding.status !== "resolved");
  }

  public markByIterationResolved(runId: string, checkIteration: number): void {
    this.db
      .update(executionReadinessFindings)
      .set({
        status: "resolved" satisfies ExecutionReadinessFindingStatus,
        updatedAt: now()
      })
      .where(and(eq(executionReadinessFindings.runId, runId), eq(executionReadinessFindings.checkIteration, checkIteration)))
      .run();
  }
}

export class ExecutionReadinessActionRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public create(input: ExecutionReadinessActionCreateInput): ExecutionReadinessAction {
    const timestamp = now();
    const row: ExecutionReadinessAction = {
      ...input,
      id: createId("execution_readiness_action"),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.db.insert(executionReadinessActions).values(row).run();
    return row;
  }

  public listByRunId(runId: string): ExecutionReadinessAction[] {
    return this.db
      .select()
      .from(executionReadinessActions)
      .where(eq(executionReadinessActions.runId, runId))
      .orderBy(executionReadinessActions.checkIteration, executionReadinessActions.createdAt, executionReadinessActions.id)
      .all() as ExecutionReadinessAction[];
  }

  public update(
    id: string,
    input: Partial<
      Pick<ExecutionReadinessAction, "status" | "stdout" | "stderr" | "exitCode" | "startedAt" | "completedAt">
    >
  ): void {
    this.db
      .update(executionReadinessActions)
      .set({
        ...definedField("status", input.status),
        ...definedField("stdout", input.stdout),
        ...definedField("stderr", input.stderr),
        ...definedField("exitCode", input.exitCode),
        ...definedField("startedAt", input.startedAt),
        ...definedField("completedAt", input.completedAt),
        updatedAt: now()
      })
      .where(eq(executionReadinessActions.id, id))
      .run();
  }
}

export class VerificationReadinessRunRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public getById(id: string): VerificationReadinessRun | null {
    return (this.db.select().from(verificationReadinessRuns).where(eq(verificationReadinessRuns.id, id)).get() as
      | VerificationReadinessRun
      | undefined) ?? null;
  }

  public getLatestByProjectId(projectId: string): VerificationReadinessRun | null {
    return (this.db
      .select()
      .from(verificationReadinessRuns)
      .where(eq(verificationReadinessRuns.projectId, projectId))
      .orderBy(desc(verificationReadinessRuns.startedAt), desc(verificationReadinessRuns.id))
      .limit(1)
      .get() as VerificationReadinessRun | undefined) ?? null;
  }

  public getLatestByStoryId(storyId: string): VerificationReadinessRun | null {
    return (this.db
      .select()
      .from(verificationReadinessRuns)
      .where(eq(verificationReadinessRuns.storyId, storyId))
      .orderBy(desc(verificationReadinessRuns.startedAt), desc(verificationReadinessRuns.id))
      .limit(1)
      .get() as VerificationReadinessRun | undefined) ?? null;
  }

  public findLatestReusable(input: {
    projectId: string;
    waveId: string | null;
    storyId: string | null;
    workspaceRoot: string;
    inputSnapshotJson: string;
  }): VerificationReadinessRun | null {
    return (this.db
      .select()
      .from(verificationReadinessRuns)
      .where(
        and(
          eq(verificationReadinessRuns.projectId, input.projectId),
          input.waveId === null ? isNull(verificationReadinessRuns.waveId) : eq(verificationReadinessRuns.waveId, input.waveId),
          input.storyId === null ? isNull(verificationReadinessRuns.storyId) : eq(verificationReadinessRuns.storyId, input.storyId),
          eq(verificationReadinessRuns.workspaceRoot, input.workspaceRoot),
          eq(verificationReadinessRuns.inputSnapshotJson, input.inputSnapshotJson),
          not(eq(verificationReadinessRuns.status, "running"))
        )
      )
      .orderBy(desc(verificationReadinessRuns.startedAt), desc(verificationReadinessRuns.id))
      .limit(1)
      .get() as VerificationReadinessRun | undefined) ?? null;
  }

  public create(input: VerificationReadinessRunCreateInput): VerificationReadinessRun {
    const timestamp = now();
    const row: VerificationReadinessRun = {
      ...input,
      id: createId("verification_readiness_run"),
      startedAt: timestamp,
      updatedAt: timestamp,
      completedAt: null
    };
    this.db.insert(verificationReadinessRuns).values(row).run();
    return row;
  }

  public update(
    id: string,
    input: Partial<Pick<VerificationReadinessRun, "status" | "summaryJson" | "errorMessage" | "completedAt">>
  ): void {
    this.db
      .update(verificationReadinessRuns)
      .set({
        ...definedField("status", input.status),
        ...definedField("summaryJson", input.summaryJson),
        ...definedField("errorMessage", input.errorMessage),
        ...definedField("completedAt", input.completedAt),
        updatedAt: now()
      })
      .where(eq(verificationReadinessRuns.id, id))
      .run();
  }
}

export class VerificationReadinessFindingRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public createMany(input: VerificationReadinessFindingCreateInput[]): VerificationReadinessFinding[] {
    const timestamp = now();
    const rows = input.map((entry) => ({
      ...entry,
      id: createId("verification_readiness_finding"),
      createdAt: timestamp,
      updatedAt: timestamp
    }));
    if (rows.length > 0) {
      this.db
        .insert(verificationReadinessFindings)
        .values(rows.map((row) => ({ ...row, isAutoFixable: row.isAutoFixable ? 1 : 0 })))
        .run();
    }
    return rows;
  }

  public listByRunId(runId: string): VerificationReadinessFinding[] {
    return (this.db
      .select()
      .from(verificationReadinessFindings)
      .where(eq(verificationReadinessFindings.runId, runId))
      .orderBy(
        verificationReadinessFindings.checkIteration,
        verificationReadinessFindings.createdAt,
        verificationReadinessFindings.id
      )
      .all() as VerificationReadinessFindingRow[]).map(mapVerificationReadinessFindingRow);
  }

  public listLatestByRunId(runId: string): VerificationReadinessFinding[] {
    return this.listByRunId(runId).filter((finding) => finding.status !== "resolved");
  }

  public markByIterationResolved(runId: string, checkIteration: number): void {
    this.db
      .update(verificationReadinessFindings)
      .set({
        status: "resolved" satisfies VerificationReadinessFindingStatus,
        updatedAt: now()
      })
      .where(and(eq(verificationReadinessFindings.runId, runId), eq(verificationReadinessFindings.checkIteration, checkIteration)))
      .run();
  }
}

export class VerificationReadinessActionRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public create(input: VerificationReadinessActionCreateInput): VerificationReadinessAction {
    const timestamp = now();
    const row: VerificationReadinessAction = {
      ...input,
      id: createId("verification_readiness_action"),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.db.insert(verificationReadinessActions).values(row).run();
    return row;
  }

  public listByRunId(runId: string): VerificationReadinessAction[] {
    return this.db
      .select()
      .from(verificationReadinessActions)
      .where(eq(verificationReadinessActions.runId, runId))
      .orderBy(
        verificationReadinessActions.checkIteration,
        verificationReadinessActions.createdAt,
        verificationReadinessActions.id
      )
      .all() as VerificationReadinessAction[];
  }

  public update(
    id: string,
    input: Partial<
      Pick<VerificationReadinessAction, "status" | "stdout" | "stderr" | "exitCode" | "startedAt" | "completedAt">
    >
  ): void {
    this.db
      .update(verificationReadinessActions)
      .set({
        ...definedField("status", input.status),
        ...definedField("stdout", input.stdout),
        ...definedField("stderr", input.stderr),
        ...definedField("exitCode", input.exitCode),
        ...definedField("startedAt", input.startedAt),
        ...definedField("completedAt", input.completedAt),
        updatedAt: now()
      })
      .where(eq(verificationReadinessActions.id, id))
      .run();
  }
}

export class WaveExecutionRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public getById(id: string): WaveExecution | null {
    return (this.db.select().from(waveExecutions).where(eq(waveExecutions.id, id)).get() as OptionalQueryRow<WaveExecution>) ?? null;
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
        .get() as OptionalQueryRow<WaveExecution>
    ) ?? null;
  }

  public create(input: WaveExecutionCreateInput): WaveExecution {
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

  public cleanupSubtreeByWaveIds(waveIds: string[]): void {
    if (waveIds.length === 0) {
      return;
    }
    const waveExecutionRows = this.db
      .select({ id: waveExecutions.id })
      .from(waveExecutions)
      .where(inArray(waveExecutions.waveId, waveIds))
      .all() as Array<{ id: string }>;
    const waveExecutionIds = waveExecutionRows.map((row) => row.id);

    const waveStoryExecutionIds = waveExecutionIds.length === 0
      ? []
      : (this.db
          .select({ id: waveStoryExecutions.id })
          .from(waveStoryExecutions)
          .where(inArray(waveStoryExecutions.waveExecutionId, waveExecutionIds))
          .all() as Array<{ id: string }>).map((row) => row.id);

    const waveStoryTestRunIds = waveExecutionIds.length === 0
      ? []
      : (this.db
          .select({ id: waveStoryTestRuns.id })
          .from(waveStoryTestRuns)
          .where(inArray(waveStoryTestRuns.waveExecutionId, waveExecutionIds))
          .all() as Array<{ id: string }>).map((row) => row.id);

    const storyReviewRunIds = waveStoryExecutionIds.length === 0
      ? []
      : (this.db
          .select({ id: storyReviewRuns.id })
          .from(storyReviewRuns)
          .where(inArray(storyReviewRuns.waveStoryExecutionId, waveStoryExecutionIds))
          .all() as Array<{ id: string }>).map((row) => row.id);

    const remediationRunIds = waveStoryExecutionIds.length === 0
      ? []
      : (this.db
          .select({ id: storyReviewRemediationRuns.id })
          .from(storyReviewRemediationRuns)
          .where(
            or(
              inArray(storyReviewRemediationRuns.waveStoryExecutionId, waveStoryExecutionIds),
              inArray(storyReviewRemediationRuns.remediationWaveStoryExecutionId, waveStoryExecutionIds)
            )
          )
          .all() as Array<{ id: string }>).map((row) => row.id);

    if (remediationRunIds.length > 0) {
      this.db
        .delete(storyReviewRemediationFindings)
        .where(inArray(storyReviewRemediationFindings.storyReviewRemediationRunId, remediationRunIds))
        .run();
      this.db
        .delete(storyReviewRemediationAgentSessions)
        .where(inArray(storyReviewRemediationAgentSessions.storyReviewRemediationRunId, remediationRunIds))
        .run();
      this.db
        .delete(storyReviewRemediationRuns)
        .where(inArray(storyReviewRemediationRuns.id, remediationRunIds))
        .run();
    }

    if (storyReviewRunIds.length > 0) {
      this.db
        .delete(storyReviewFindings)
        .where(inArray(storyReviewFindings.storyReviewRunId, storyReviewRunIds))
        .run();
      this.db
        .delete(storyReviewAgentSessions)
        .where(inArray(storyReviewAgentSessions.storyReviewRunId, storyReviewRunIds))
        .run();
      this.db
        .delete(storyReviewRuns)
        .where(inArray(storyReviewRuns.id, storyReviewRunIds))
        .run();
    }

    if (waveStoryExecutionIds.length > 0) {
      this.db
        .delete(appVerificationRuns)
        .where(inArray(appVerificationRuns.waveStoryExecutionId, waveStoryExecutionIds))
        .run();
      this.db
        .update(qaFindings)
        .set({ waveStoryExecutionId: null, updatedAt: now() })
        .where(inArray(qaFindings.waveStoryExecutionId, waveStoryExecutionIds))
        .run();
      this.db
        .delete(executionAgentSessions)
        .where(inArray(executionAgentSessions.waveStoryExecutionId, waveStoryExecutionIds))
        .run();
      this.db
        .delete(verificationRuns)
        .where(inArray(verificationRuns.waveStoryExecutionId, waveStoryExecutionIds))
        .run();
    }

    if (waveStoryTestRunIds.length > 0) {
      this.db
        .delete(testAgentSessions)
        .where(inArray(testAgentSessions.waveStoryTestRunId, waveStoryTestRunIds))
        .run();
    }

    if (waveStoryExecutionIds.length > 0) {
      this.db
        .delete(waveStoryExecutions)
        .where(inArray(waveStoryExecutions.id, waveStoryExecutionIds))
        .run();
    }

    if (waveStoryTestRunIds.length > 0) {
      this.db
        .delete(waveStoryTestRuns)
        .where(inArray(waveStoryTestRuns.id, waveStoryTestRunIds))
        .run();
    }

    if (waveExecutionIds.length > 0) {
      this.db
        .delete(verificationRuns)
        .where(inArray(verificationRuns.waveExecutionId, waveExecutionIds))
        .run();
      this.db
        .delete(waveExecutions)
        .where(inArray(waveExecutions.id, waveExecutionIds))
        .run();
    }

    const executionReadinessRunIds = (this.db
      .select({ id: executionReadinessRuns.id })
      .from(executionReadinessRuns)
      .where(inArray(executionReadinessRuns.waveId, waveIds))
      .all() as Array<{ id: string }>).map((row) => row.id);
    if (executionReadinessRunIds.length > 0) {
      this.db
        .delete(executionReadinessActions)
        .where(inArray(executionReadinessActions.runId, executionReadinessRunIds))
        .run();
      this.db
        .delete(executionReadinessFindings)
        .where(inArray(executionReadinessFindings.runId, executionReadinessRunIds))
        .run();
      this.db
        .delete(executionReadinessRuns)
        .where(inArray(executionReadinessRuns.id, executionReadinessRunIds))
        .run();
    }

    const verificationReadinessRunIds = (this.db
      .select({ id: verificationReadinessRuns.id })
      .from(verificationReadinessRuns)
      .where(inArray(verificationReadinessRuns.waveId, waveIds))
      .all() as Array<{ id: string }>).map((row) => row.id);
    if (verificationReadinessRunIds.length > 0) {
      this.db
        .delete(verificationReadinessActions)
        .where(inArray(verificationReadinessActions.runId, verificationReadinessRunIds))
        .run();
      this.db
        .delete(verificationReadinessFindings)
        .where(inArray(verificationReadinessFindings.runId, verificationReadinessRunIds))
        .run();
      this.db
        .delete(verificationReadinessRuns)
        .where(inArray(verificationReadinessRuns.id, verificationReadinessRunIds))
        .run();
    }

    this.db
      .delete(qualityKnowledgeEntries)
      .where(inArray(qualityKnowledgeEntries.waveId, waveIds))
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

  public create(input: WaveStoryExecutionCreateInput): WaveStoryExecution {
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

  public create(input: WaveStoryTestRunCreateInput): WaveStoryTestRun {
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

  public create(input: TestAgentSessionCreateInput): TestAgentSession {
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

  public update(
    id: string,
    input: Partial<Pick<TestAgentSession, "status" | "commandJson" | "stdout" | "stderr" | "exitCode">>
  ): void {
    this.db
      .update(testAgentSessions)
      .set({
        ...definedField("status", input.status),
        ...definedField("commandJson", input.commandJson),
        ...definedField("stdout", input.stdout),
        ...definedField("stderr", input.stderr),
        ...definedField("exitCode", input.exitCode),
        updatedAt: now()
      })
      .where(eq(testAgentSessions.id, id))
      .run();
  }
}

export class ExecutionAgentSessionRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public create(input: ExecutionAgentSessionCreateInput): ExecutionAgentSession {
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

  public update(
    id: string,
    input: Partial<Pick<ExecutionAgentSession, "status" | "commandJson" | "stdout" | "stderr" | "exitCode">>
  ): void {
    this.db
      .update(executionAgentSessions)
      .set({
        ...definedField("status", input.status),
        ...definedField("commandJson", input.commandJson),
        ...definedField("stdout", input.stdout),
        ...definedField("stderr", input.stderr),
        ...definedField("exitCode", input.exitCode),
        updatedAt: now()
      })
      .where(eq(executionAgentSessions.id, id))
      .run();
  }
}

export class VerificationRunRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public create(input: VerificationRunCreateInput): VerificationRun {
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

export class AppVerificationRunRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public getById(id: string): AppVerificationRun | null {
    return (
      this.db.select().from(appVerificationRuns).where(eq(appVerificationRuns.id, id)).get() as
        | AppVerificationRun
        | undefined
    ) ?? null;
  }

  public listByWaveStoryExecutionId(waveStoryExecutionId: string): AppVerificationRun[] {
    return this.db
      .select()
      .from(appVerificationRuns)
      .where(eq(appVerificationRuns.waveStoryExecutionId, waveStoryExecutionId))
      .orderBy(appVerificationRuns.createdAt)
      .all() as AppVerificationRun[];
  }

  public getLatestByWaveStoryExecutionId(waveStoryExecutionId: string): AppVerificationRun | null {
    return (
      this.db
        .select()
        .from(appVerificationRuns)
        .where(eq(appVerificationRuns.waveStoryExecutionId, waveStoryExecutionId))
        .orderBy(desc(appVerificationRuns.attempt), desc(appVerificationRuns.id))
        .limit(1)
        .get() as AppVerificationRun | undefined
    ) ?? null;
  }

  public create(
    input: Omit<AppVerificationRun, "id" | "createdAt" | "updatedAt" | "startedAt" | "completedAt">
  ): AppVerificationRun {
    const timestamp = now();
    const row: AppVerificationRun = {
      ...input,
      id: createId("app_verification_run"),
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: null,
      completedAt: null
    };
    this.db.insert(appVerificationRuns).values(row).run();
    return row;
  }

  public updateStatus(
    id: string,
    status: AppVerificationRunStatus,
    options?: {
      runner?: AppVerificationRun["runner"];
      projectAppTestContextJson?: string | null;
      storyContextJson?: string | null;
      preparedSessionJson?: string | null;
      resultJson?: string | null;
      artifactsJson?: string | null;
      failureSummary?: string | null;
      startedAt?: number | null;
    }
  ): void {
    const terminal = status === "passed" || status === "review_required" || status === "failed";
    this.db
      .update(appVerificationRuns)
      .set({
        runner: options?.runner,
        status,
        projectAppTestContextJson: options?.projectAppTestContextJson,
        storyContextJson: options?.storyContextJson,
        preparedSessionJson: options?.preparedSessionJson,
        resultJson: options?.resultJson,
        artifactsJson: options?.artifactsJson,
        failureSummary: options?.failureSummary ?? null,
        startedAt: options?.startedAt,
        updatedAt: now(),
        completedAt: terminal ? now() : null
      })
      .where(eq(appVerificationRuns.id, id))
      .run();
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

  public create(input: StoryReviewRunCreateInput): StoryReviewRun {
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

  public createMany(input: StoryReviewFindingCreateInput[]): StoryReviewFinding[] {
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

  public create(input: StoryReviewAgentSessionCreateInput): StoryReviewAgentSession {
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

  public listLatestByProjectIds(projectIds: string[]): QaRun[] {
    if (projectIds.length === 0) {
      return [];
    }
    return projectIds
      .map((projectId) => this.getLatestByProjectId(projectId))
      .filter((run): run is QaRun => run !== null);
  }

  public listByProjectId(projectId: string): QaRun[] {
    return this.db
      .select()
      .from(qaRuns)
      .where(eq(qaRuns.projectId, projectId))
      .orderBy(qaRuns.createdAt)
      .all() as QaRun[];
  }

  public create(input: QaRunCreateInput): QaRun {
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

  public createMany(input: QaFindingCreateInput[]): QaFinding[] {
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

  public create(input: QaAgentSessionCreateInput): QaAgentSession {
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

export class QualityKnowledgeEntryRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public createMany(input: QualityKnowledgeEntryCreateInput[]): QualityKnowledgeEntry[] {
    if (input.length === 0) {
      return [];
    }

    const timestamp = now();
    const rows: QualityKnowledgeEntry[] = input.map((entry) => ({
      ...entry,
      id: createId("quality_knowledge"),
      createdAt: timestamp,
      updatedAt: timestamp
    }));

    for (const row of rows) {
      const existing = this.db
        .select()
        .from(qualityKnowledgeEntries)
        .where(
          and(
            eq(qualityKnowledgeEntries.workspaceId, row.workspaceId),
            eq(qualityKnowledgeEntries.source, row.source),
            eq(qualityKnowledgeEntries.scopeType, row.scopeType),
            eq(qualityKnowledgeEntries.scopeId, row.scopeId),
            eq(qualityKnowledgeEntries.kind, row.kind),
            eq(qualityKnowledgeEntries.summary, row.summary)
          )
        )
        .get() as QualityKnowledgeEntry | undefined;

      if (existing) {
        this.db
          .update(qualityKnowledgeEntries)
          .set({
            evidenceJson: row.evidenceJson,
            status: row.status,
            relevanceTagsJson: row.relevanceTagsJson,
            updatedAt: timestamp
          })
          .where(eq(qualityKnowledgeEntries.id, existing.id))
          .run();
      } else {
        this.db.insert(qualityKnowledgeEntries).values(row).run();
      }
    }

    return this.listByWorkspaceId(input[0]!.workspaceId, { limit: rows.length * 4 }).filter((entry) =>
      input.some(
        (candidate) =>
          candidate.workspaceId === entry.workspaceId &&
          candidate.source === entry.source &&
          candidate.scopeType === entry.scopeType &&
          candidate.scopeId === entry.scopeId &&
          candidate.kind === entry.kind &&
          candidate.summary === entry.summary
      )
    );
  }

  public listByWorkspaceId(
    workspaceId: string,
    options?: {
      source?: QualityKnowledgeSource;
      status?: string;
      limit?: number;
    }
  ): QualityKnowledgeEntry[] {
    const rows = this.db
      .select()
      .from(qualityKnowledgeEntries)
      .where(eq(qualityKnowledgeEntries.workspaceId, workspaceId))
      .orderBy(desc(qualityKnowledgeEntries.createdAt), desc(qualityKnowledgeEntries.id))
      .all() as QualityKnowledgeEntry[];

    return rows
      .filter((entry) => (options?.source ? entry.source === options.source : true))
      .filter((entry) => (options?.status ? entry.status === options.status : true))
      .slice(0, options?.limit ?? rows.length);
  }

  public listRelevantForStory(input: {
    workspaceId: string;
    projectId: string;
    waveId?: string | null;
    storyId: string;
    filePaths?: string[];
    modules?: string[];
    limit?: number;
  }): QualityKnowledgeEntry[] {
    const rows = this.listByWorkspaceId(input.workspaceId, { limit: 400 });
    const filePathSet = new Set(input.filePaths ?? []);
    const moduleSet = new Set(input.modules ?? []);

    return rows
      .filter((entry) => !entry.projectId || entry.projectId === input.projectId)
      .filter((entry) => !entry.waveId || !input.waveId || entry.waveId === input.waveId)
      .filter((entry) => {
        if (entry.storyId && entry.storyId === input.storyId) {
          return true;
        }
        if (entry.scopeType === "project" || entry.scopeType === "workspace") {
          return true;
        }
        const tags = parseQualityRelevanceTags(entry.relevanceTagsJson);
        return (
          tags.storyCodes.length > 0 ||
          tags.files.some((file) => filePathSet.has(file)) ||
          tags.modules.some((module) => moduleSet.has(module))
        );
      })
      .slice(0, input.limit ?? 20);
  }

  public listRecurringByProjectId(projectId: string, limit = 20): QualityKnowledgeEntry[] {
    const rows = this.db
      .select()
      .from(qualityKnowledgeEntries)
      .where(eq(qualityKnowledgeEntries.projectId, projectId))
      .orderBy(desc(qualityKnowledgeEntries.updatedAt), desc(qualityKnowledgeEntries.id))
      .all() as QualityKnowledgeEntry[];
    return rows.filter((entry) => entry.kind === "recurring_issue").slice(0, limit);
  }

  public listUnresolvedByWaveId(waveId: string, limit = 20): QualityKnowledgeEntry[] {
    const rows = this.db
      .select()
      .from(qualityKnowledgeEntries)
      .where(eq(qualityKnowledgeEntries.waveId, waveId))
      .orderBy(desc(qualityKnowledgeEntries.updatedAt), desc(qualityKnowledgeEntries.id))
      .all() as QualityKnowledgeEntry[];
    return rows.filter((entry) => entry.status !== "resolved").slice(0, limit);
  }

  public listRecentConstraintsByWorkspaceId(workspaceId: string, limit = 20): QualityKnowledgeEntry[] {
    return this.listByWorkspaceId(workspaceId, { limit: 200 })
      .filter((entry) => entry.kind === "constraint")
      .slice(0, limit);
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

  public listLatestByProjectIds(projectIds: string[]): DocumentationRun[] {
    if (projectIds.length === 0) {
      return [];
    }
    return projectIds
      .map((projectId) => this.getLatestByProjectId(projectId))
      .filter((run): run is DocumentationRun => run !== null);
  }

  public listByProjectId(projectId: string): DocumentationRun[] {
    return this.db
      .select()
      .from(documentationRuns)
      .where(eq(documentationRuns.projectId, projectId))
      .orderBy(documentationRuns.createdAt)
      .all() as DocumentationRun[];
  }

  public create(input: DocumentationRunCreateInput): DocumentationRun {
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

  public create(input: DocumentationAgentSessionCreateInput): DocumentationAgentSession {
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

  public getLatestByScope(input: {
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
            eq(interactiveReviewSessions.reviewType, input.reviewType)
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
        ...definedField("status", input.status),
        ...definedField("resolvedAt", input.resolvedAt),
        ...definedField("lastAssistantMessageId", input.lastAssistantMessageId),
        ...definedField("lastUserMessageId", input.lastUserMessageId),
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
        ...definedField("status", input.status),
        ...definedField("summary", input.summary),
        ...definedField("changeRequest", input.changeRequest),
        ...definedField("rationale", input.rationale),
        ...definedField("severity", input.severity),
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

  public create(input: ArtifactCreateInput): ArtifactRecord {
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
    let projectFilter = null;
    if (input.projectId === null) {
      projectFilter = isNull(artifacts.projectId);
    } else if (input.projectId !== undefined) {
      projectFilter = eq(artifacts.projectId, input.projectId);
    }
    const whereClause =
      projectFilter === null
        ? and(eq(artifacts.itemId, input.itemId), eq(artifacts.kind, input.kind))
        : and(eq(artifacts.itemId, input.itemId), eq(artifacts.kind, input.kind), projectFilter);

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

  public create(input: StageRunCreateInput): StageRunRecord {
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
        completedAt:
          status === "completed" || status === "failed" || status === "review_required" || status === "needs_user_input"
            ? now()
            : null
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

  public create(input: AgentSessionCreateInput): AgentSessionRecord {
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
