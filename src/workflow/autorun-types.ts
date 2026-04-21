import type { StageKey } from "../domain/types.js";

export type AutorunScopeType = "item" | "project";

export type AutorunStep = {
  action: string;
  // Only `run`, `execution`, and `remediation` are collected into created*Ids on AutorunSummary.
  // `qa` and `documentation` remain visible in ordered steps but do not currently have dedicated arrays.
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
      execute: () => unknown;
    }
  | {
      kind: "stop";
      finalStatus: AutorunSummary["finalStatus"];
      stopReason: string;
    };

export type AutorunHost = {
  requireItem(itemId: string): { currentColumn: string; phaseStatus: string };
  requireProject(projectId: string): { id: string; itemId: string };
  // The orchestrator may pass a latestStoryReviewRun.id from showExecution into these methods.
  // Hosts must treat the id as opaque and re-load the canonical run from persistence.
  requireStoryReviewRunById(storyReviewRunId: string): { id: string; status: string };
  getLatestConceptByItemId(itemId: string): { status: string } | null;
  getProjectsByItemId(itemId: string): Array<{ id: string }>;
  getLatestStageRun(input: { itemId: string; projectId?: string; stageKey: StageKey }): { status: string } | null;
  hasAnyStoriesByProjectId(projectId: string): boolean;
  listStoriesByProjectId(projectId: string): Array<{ status: string }>;
  getLatestArchitecturePlanByProjectId(projectId: string): { status: string } | null;
  getLatestImplementationPlanByProjectId(projectId: string): { status: string } | null;
  getLatestQaRunByProjectId(projectId: string): { status: string } | null;
  getLatestDocumentationRunByProjectId(projectId: string): { status: string; staleAt: number | null } | null;
  getLatestExecutionReadinessByProjectId(projectId: string): { status: string } | null;
  getLatestVerificationReadinessByProjectId(projectId: string): { status: string } | null;
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
  autoAcceptStoryReviewRemediationLimit(storyReviewRunId: string): Promise<unknown>;
  startQa(projectId: string): Promise<unknown>;
  startDocumentation(projectId: string): Promise<unknown>;
  completeItemIfDeliveryFinished(itemId: string): void;
  canAutorunStoryReviewRemediate(storyReviewRunId: string): boolean;
  canAutorunStoryReviewAutoAccept(storyReviewRunId: string): boolean;
  getStoryReviewRemediationStopReason(storyReviewRunId: string): string;
};
