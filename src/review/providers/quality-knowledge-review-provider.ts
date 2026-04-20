import type { ReviewProviderResult } from "../types.js";
import type { WorkflowDeps } from "../../workflow/workflow-deps.js";

export class QualityKnowledgeReviewProvider {
  public constructor(private readonly deps: WorkflowDeps) {}

  public provide(input: {
    providerId: "coderabbit";
    projectId: string;
    waveId: string;
    storyId: string;
    filePaths: string[];
    modules: string[];
  }): ReviewProviderResult {
    const entries = this.deps.qualityKnowledgeService.listRelevantForStory({
      projectId: input.projectId,
      waveId: input.waveId,
      storyId: input.storyId,
      filePaths: input.filePaths,
      modules: input.modules,
      limit: 20
    });

    return {
      providerId: input.providerId,
      sourceSystem: input.providerId,
      findings: entries
        .filter((entry) => entry.source === input.providerId)
        .map((entry) => ({
          reviewerRole: input.providerId,
          findingType: entry.kind,
          normalizedSeverity: "medium" as const,
          sourceSeverity: entry.status,
          title: entry.summary,
          detail: typeof entry.evidence.detail === "string" ? entry.evidence.detail : `${input.providerId} surfaced ${entry.kind}.`,
          evidence: JSON.stringify(entry.evidence),
          filePath: entry.scopeType === "file" ? entry.scopeId : null,
          line: null,
          fieldPath: null
        }))
    };
  }
}
