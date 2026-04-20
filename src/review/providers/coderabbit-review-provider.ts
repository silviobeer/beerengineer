import type { ReviewProviderResult } from "../types.js";
import type { WorkflowDeps } from "../../workflow/workflow-deps.js";

export class CoderabbitReviewProvider {
  public constructor(private readonly deps: WorkflowDeps) {}

  public provide(input: {
    projectId: string;
    waveId: string;
    storyId: string;
    storyCode?: string | null;
    filePaths: string[];
    modules: string[];
  }): ReviewProviderResult {
    const review = this.deps.coderabbitService.review({
      projectId: input.projectId,
      waveId: input.waveId,
      storyId: input.storyId,
      storyCode: input.storyCode ?? null,
      filePaths: input.filePaths,
      modules: input.modules,
      live: true,
      timeoutMs: 2000
    });

    return {
      providerId: "coderabbit",
      sourceSystem: "coderabbit",
      findings: review.findings.map((finding) => ({
        reviewerRole: finding.reviewerRole,
        findingType: finding.findingType,
        normalizedSeverity: finding.normalizedSeverity,
        sourceSeverity: finding.sourceSeverity,
        title: finding.title,
        detail: finding.detail,
        evidence: finding.evidence,
        filePath: finding.filePath,
        line: finding.line,
        fieldPath: finding.fieldPath
      })),
      providerMetadata: {
        execution: review.execution,
        authSource: review.config.authSource,
        repositorySource: review.config.repositorySource
      }
    };
  }
}
