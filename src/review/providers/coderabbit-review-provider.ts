import type { ReviewProviderResult } from "../types.js";
import type { WorkflowDeps } from "../../workflow/workflow-deps.js";
import { QualityKnowledgeReviewProvider } from "./quality-knowledge-review-provider.js";

export class CoderabbitReviewProvider {
  private readonly qualityKnowledgeProvider: QualityKnowledgeReviewProvider;

  public constructor(private readonly deps: WorkflowDeps) {
    this.qualityKnowledgeProvider = new QualityKnowledgeReviewProvider(deps);
  }

  public provide(input: {
    projectId: string;
    waveId: string;
    storyId: string;
    filePaths: string[];
    modules: string[];
  }): ReviewProviderResult {
    const preflight = this.deps.coderabbitService.preflight();
    if (!preflight.config.configured) {
      return {
        providerId: "coderabbit",
        sourceSystem: "coderabbit",
        findings: []
      };
    }

    return this.qualityKnowledgeProvider.provide({
      providerId: "coderabbit",
      sourceSystem: "coderabbit",
      projectId: input.projectId,
      waveId: input.waveId,
      storyId: input.storyId,
      filePaths: input.filePaths,
      modules: input.modules
    });
  }
}
