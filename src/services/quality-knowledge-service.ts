import type {
  QaFinding,
  QualityKnowledgeEntry,
  QualityKnowledgeKind,
  QualityKnowledgeScopeType,
  QualityKnowledgeSource,
  StoryReviewFinding,
  Workspace
} from "../domain/types.js";
import type { QualityKnowledgeEntryRepository } from "../persistence/repositories.js";

export type QualityRelevanceTags = {
  files: string[];
  storyCodes: string[];
  modules: string[];
  categories: string[];
};

export type QualityKnowledgeView = Omit<QualityKnowledgeEntry, "evidenceJson" | "relevanceTagsJson"> & {
  evidence: Record<string, unknown>;
  relevanceTags: QualityRelevanceTags;
};

function normalizeModuleFromPath(filePath: string | null): string | null {
  if (!filePath) {
    return null;
  }
  const [topLevel, secondLevel] = filePath.split("/");
  if (!topLevel) {
    return null;
  }
  return secondLevel ? `${topLevel}/${secondLevel}` : topLevel;
}

export function parseQualityKnowledgeEntry(entry: QualityKnowledgeEntry): QualityKnowledgeView {
  return {
    ...entry,
    evidence: JSON.parse(entry.evidenceJson) as Record<string, unknown>,
    relevanceTags: JSON.parse(entry.relevanceTagsJson) as QualityRelevanceTags
  };
}

export function createStoryReviewKnowledgeEntries(input: {
  workspace: Workspace;
  projectId: string;
  waveId: string;
  storyId: string;
  storyCode: string;
  findings: StoryReviewFinding[];
  recommendations: string[];
}): Array<Omit<QualityKnowledgeEntry, "id" | "createdAt" | "updatedAt">> {
  const findingEntries = input.findings.map((finding) => {
    const moduleName = normalizeModuleFromPath(finding.filePath);
    return {
      workspaceId: input.workspace.id,
      projectId: input.projectId,
      waveId: input.waveId,
      storyId: input.storyId,
      source: "story_review" as QualityKnowledgeSource,
      scopeType: (finding.filePath ? "file" : "story") as QualityKnowledgeScopeType,
      scopeId: finding.filePath ?? input.storyId,
      kind: (finding.filePath ? "recurring_issue" : "lesson") as QualityKnowledgeKind,
      summary: finding.title,
      evidenceJson: JSON.stringify(
        {
          severity: finding.severity,
          category: finding.category,
          description: finding.description,
          evidence: finding.evidence,
          filePath: finding.filePath,
          line: finding.line,
          suggestedFix: finding.suggestedFix
        },
        null,
        2
      ),
      status: finding.status,
      relevanceTagsJson: JSON.stringify(
        {
          files: finding.filePath ? [finding.filePath] : [],
          storyCodes: [input.storyCode],
          modules: moduleName ? [moduleName] : [],
          categories: [finding.category]
        },
        null,
        2
      )
    };
  });

  const recommendationEntries = input.recommendations.map((recommendation) => ({
    workspaceId: input.workspace.id,
    projectId: input.projectId,
    waveId: input.waveId,
    storyId: input.storyId,
    source: "story_review" as QualityKnowledgeSource,
    scopeType: "story" as QualityKnowledgeScopeType,
    scopeId: input.storyId,
    kind: "recommendation" as QualityKnowledgeKind,
    summary: recommendation,
    evidenceJson: JSON.stringify({ storyCode: input.storyCode }, null, 2),
    status: "open",
    relevanceTagsJson: JSON.stringify(
      {
        files: [],
        storyCodes: [input.storyCode],
        modules: [],
        categories: ["story_review"]
      },
      null,
      2
    )
  }));

  return [...findingEntries, ...recommendationEntries];
}

export function createQaKnowledgeEntries(input: {
  workspace: Workspace;
  projectId: string;
  waveIds: string[];
  projectCode: string;
  findings: QaFinding[];
  recommendations: string[];
  storyCodeByStoryId: Map<string, string>;
}): Array<Omit<QualityKnowledgeEntry, "id" | "createdAt" | "updatedAt">> {
  const findingEntries = input.findings.map((finding) => ({
    workspaceId: input.workspace.id,
    projectId: input.projectId,
    waveId: input.waveIds[0] ?? null,
    storyId: finding.storyId,
    source: "qa" as QualityKnowledgeSource,
    scopeType: (finding.storyId ? "story" : "project") as QualityKnowledgeScopeType,
    scopeId: finding.storyId ?? input.projectId,
    kind: "lesson" as QualityKnowledgeKind,
    summary: finding.title,
    evidenceJson: JSON.stringify(
      {
        severity: finding.severity,
        category: finding.category,
        description: finding.description,
        evidence: finding.evidence,
        reproSteps: finding.reproSteps,
        suggestedFix: finding.suggestedFix
      },
      null,
      2
    ),
    status: finding.status,
    relevanceTagsJson: JSON.stringify(
      {
        files: [],
        storyCodes: finding.storyId ? [input.storyCodeByStoryId.get(finding.storyId) ?? ""] : [],
        modules: [],
        categories: [finding.category]
      },
      null,
      2
    )
  }));

  const recommendationEntries = input.recommendations.map((recommendation) => ({
    workspaceId: input.workspace.id,
    projectId: input.projectId,
    waveId: input.waveIds[0] ?? null,
    storyId: null,
    source: "qa" as QualityKnowledgeSource,
    scopeType: "project" as QualityKnowledgeScopeType,
    scopeId: input.projectId,
    kind: "constraint" as QualityKnowledgeKind,
    summary: recommendation,
    evidenceJson: JSON.stringify({ projectCode: input.projectCode }, null, 2),
    status: "open",
    relevanceTagsJson: JSON.stringify(
      {
        files: [],
        storyCodes: [],
        modules: [],
        categories: ["qa"]
      },
      null,
      2
    )
  }));

  return [...findingEntries, ...recommendationEntries];
}

export class QualityKnowledgeService {
  public constructor(
    private readonly repository: QualityKnowledgeEntryRepository,
    private readonly workspace: Workspace
  ) {}

  public createEntries(entries: Array<Omit<QualityKnowledgeEntry, "id" | "createdAt" | "updatedAt">>): QualityKnowledgeView[] {
    return this.repository.createMany(entries).map(parseQualityKnowledgeEntry);
  }

  public listRelevantForStory(input: {
    projectId: string;
    waveId?: string | null;
    storyId: string;
    filePaths?: string[];
    modules?: string[];
    limit?: number;
  }): QualityKnowledgeView[] {
    return this.repository
      .listRelevantForStory({
        workspaceId: this.workspace.id,
        ...input
      })
      .map(parseQualityKnowledgeEntry);
  }

  public listProjectRecurring(projectId: string, limit?: number): QualityKnowledgeView[] {
    return this.repository.listRecurringByProjectId(projectId, limit).map(parseQualityKnowledgeEntry);
  }

  public listWaveUnresolved(waveId: string, limit?: number): QualityKnowledgeView[] {
    return this.repository.listUnresolvedByWaveId(waveId, limit).map(parseQualityKnowledgeEntry);
  }

  public listRecentConstraints(limit?: number): QualityKnowledgeView[] {
    return this.repository.listRecentConstraintsByWorkspaceId(this.workspace.id, limit).map(parseQualityKnowledgeEntry);
  }
}
