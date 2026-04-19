import type { StageKey } from "../domain/types.js";

export type AutorunScopeType = "item" | "project";

export type AutorunStep = {
  action: string;
  scopeType: AutorunScopeType | "run" | "execution" | "remediation" | "qa" | "documentation";
  scopeId: string;
  status: string;
};

export type AutorunSummary = {
  trigger: string;
  scopeType: AutorunScopeType;
  scopeId: string;
  steps: AutorunStep[];
  finalStatus: "completed" | "stopped" | "failed";
  stopReason: string;
  createdRunIds: string[];
  createdExecutionIds: string[];
  createdRemediationRunIds: string[];
  successful: boolean;
};

export type AutorunDecision =
  | {
      kind: "step";
      action: string;
      scopeType: AutorunStep["scopeType"];
      scopeId: string;
      execute: () => Promise<unknown> | unknown;
    }
  | {
      kind: "stop";
      finalStatus: AutorunSummary["finalStatus"];
      stopReason: string;
    };

export type RetryWaveStoryExecutionResult =
  | {
      phase: "test_preparation";
      waveStoryTestRunId: string;
      waveStoryId: string;
      storyCode: string;
      status: "review_required" | "failed";
    }
  | {
      phase: "implementation" | "story_review";
      waveStoryExecutionId: string;
      waveStoryId: string;
      storyCode: string;
      status: string;
    };

export type AutorunHost = {
  requireItem(itemId: string): { currentColumn: string; phaseStatus: string };
  requireProject(projectId: string): { id: string; itemId: string };
  getLatestConceptByItemId(itemId: string): { status: string } | null;
  getProjectsByItemId(itemId: string): Array<{ id: string }>;
  getLatestStageRun(input: { itemId: string; projectId?: string; stageKey: StageKey }): { status: string } | null;
  hasAnyStoriesByProjectId(projectId: string): boolean;
  listStoriesByProjectId(projectId: string): Array<{ status: string }>;
  getLatestArchitecturePlanByProjectId(projectId: string): { status: string } | null;
  getLatestImplementationPlanByProjectId(projectId: string): { status: string } | null;
  getLatestQaRunByProjectId(projectId: string): { status: string } | null;
  getLatestDocumentationRunByProjectId(projectId: string): { status: string; staleAt: number | null } | null;
  showExecution(projectId: string): {
    waves: Array<{
      waveExecution: { status: string } | null;
      stories: Array<{
        latestTestRun: { status: string } | null;
        latestExecution: { status: string } | null;
        latestStoryReviewRun: { id: string; status: string } | null;
      }>;
    }>;
  };
  importProjects(itemId: string): { importedCount: number };
  startStage(input: { stageKey: Exclude<StageKey, "brainstorm">; itemId: string; projectId: string }): Promise<unknown>;
  approveStories(projectId: string): void;
  approveArchitecture(projectId: string): void;
  approvePlanning(projectId: string): void;
  startExecution(projectId: string): Promise<unknown>;
  tickExecution(projectId: string): Promise<unknown>;
  startStoryReviewRemediation(storyReviewRunId: string): Promise<unknown>;
  startQa(projectId: string): Promise<unknown>;
  startDocumentation(projectId: string): Promise<unknown>;
  completeItemIfDeliveryFinished(itemId: string): void;
  canAutorunStoryReviewRemediate(storyReviewRunId: string): boolean;
  getStoryReviewRemediationStopReason(storyReviewRunId: string): string;
};
