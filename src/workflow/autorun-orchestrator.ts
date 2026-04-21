import { AppError } from "../shared/errors.js";
import type { StageKey } from "../domain/types.js";
import type { AutorunDecision, AutorunHost, AutorunScopeType, AutorunStep, AutorunSummary } from "./autorun-types.js";

const MAX_AUTORUN_STEPS = 100;

export class AutorunOrchestrator {
  public constructor(private readonly host: AutorunHost) {}

  public async executeForItem(input: {
    itemId: string;
    trigger: string;
    initialSteps?: AutorunStep[];
  }): Promise<AutorunSummary> {
    this.host.requireItem(input.itemId);
    return this.execute({
      trigger: input.trigger,
      scopeType: "item",
      scopeId: input.itemId,
      initialSteps: input.initialSteps ?? []
    });
  }

  public async executeForProject(input: {
    projectId: string;
    trigger: string;
    initialSteps?: AutorunStep[];
  }): Promise<AutorunSummary> {
    this.host.requireProject(input.projectId);
    return this.execute({
      trigger: input.trigger,
      scopeType: "project",
      scopeId: input.projectId,
      initialSteps: input.initialSteps ?? []
    });
  }

  private async execute(input: {
    trigger: string;
    scopeType: AutorunScopeType;
    scopeId: string;
    initialSteps: AutorunStep[];
  }): Promise<AutorunSummary> {
    const summary: AutorunSummary = {
      trigger: input.trigger,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      steps: [...input.initialSteps],
      finalStatus: "stopped",
      stopReason: "no_action",
      createdRunIds: [],
      createdExecutionIds: [],
      createdRemediationRunIds: [],
      successful: false
    };
    this.collectIds(summary, input.initialSteps);

    for (let index = 0; index < MAX_AUTORUN_STEPS; index += 1) {
      const decision =
        input.scopeType === "item"
          ? this.resolveNextItemDecision(input.scopeId)
          : this.resolveNextProjectDecision(input.scopeId);

      if (decision.kind === "stop") {
        summary.finalStatus = decision.finalStatus;
        summary.stopReason = decision.stopReason;
        summary.successful = decision.finalStatus === "completed";
        return summary;
      }

      try {
        const result = await decision.execute();
        const step = this.buildStep(decision, result);
        summary.steps.push(step);
        this.collectIds(summary, [step]);
      } catch (error) {
        summary.finalStatus = "failed";
        summary.stopReason = error instanceof AppError ? error.code : "AUTORUN_STEP_FAILED";
        summary.successful = false;
        return summary;
      }
    }

    summary.finalStatus = "failed";
    summary.stopReason = "AUTORUN_STEP_LIMIT_REACHED";
    summary.successful = false;
    return summary;
  }

  private resolveNextItemDecision(itemId: string): AutorunDecision {
    const item = this.host.requireItem(itemId);
    if (item.phaseStatus === "failed") {
      return this.stop("failed", "item_failed");
    }

    const concept = this.host.getLatestConceptByItemId(itemId);
    const latestBrainstormRun = this.host.getLatestStageRun({ itemId, stageKey: "brainstorm" });
    if (!concept) {
      return this.resolveMissingConceptDecision(latestBrainstormRun);
    }

    if (concept.status !== "approved" && concept.status !== "completed") {
      return {
        kind: "stop",
        finalStatus: "stopped",
        stopReason: "concept_approval_required"
      };
    }

    const projects = this.host.getProjectsByItemId(itemId);
    if (projects.length === 0) {
      return {
        kind: "step",
        action: "project:import",
        scopeType: "item",
        scopeId: itemId,
        execute: () => this.host.importProjects(itemId)
      };
    }

    for (const project of projects) {
      const decision = this.resolveNextProjectDecision(project.id);
      if (decision.kind !== "stop" || decision.stopReason !== "project_completed") {
        return decision;
      }
    }

    this.host.completeItemIfDeliveryFinished(itemId);
    const finalItem = this.host.requireItem(itemId);
    return finalItem.currentColumn === "done"
      ? this.stop("completed", "item_completed")
      : this.stop("stopped", "project_incomplete");
  }

  private resolveNextProjectDecision(projectId: string): AutorunDecision {
    const project = this.host.requireProject(projectId);

    const requirementsDecision = this.resolveStageDecision({
      itemId: project.itemId,
      projectId,
      stageKey: "requirements",
      hasStageOutput: this.host.hasAnyStoriesByProjectId(projectId),
      approvalSatisfied: this.host.listStoriesByProjectId(projectId).every((story) => story.status === "approved"),
      startAction: "requirements:start",
      approveAction: "stories:approve",
      approveScopeType: "project",
      approve: () => this.host.approveStories(projectId)
    });
    if (requirementsDecision) {
      return requirementsDecision;
    }

    const latestArchitecturePlan = this.host.getLatestArchitecturePlanByProjectId(projectId);
    const architectureDecision = this.resolveStageDecision({
      itemId: project.itemId,
      projectId,
      stageKey: "architecture",
      hasStageOutput: latestArchitecturePlan !== null,
      approvalSatisfied: latestArchitecturePlan?.status === "approved",
      startAction: "architecture:start",
      approveAction: "architecture:approve",
      approveScopeType: "project",
      approve: () => this.host.approveArchitecture(projectId)
    });
    if (architectureDecision) {
      return architectureDecision;
    }

    const latestImplementationPlan = this.host.getLatestImplementationPlanByProjectId(projectId);
    const planningDecision = this.resolveStageDecision({
      itemId: project.itemId,
      projectId,
      stageKey: "planning",
      hasStageOutput: latestImplementationPlan !== null,
      approvalSatisfied: latestImplementationPlan?.status === "approved",
      startAction: "planning:start",
      approveAction: "planning:approve",
      approveScopeType: "project",
      approve: () => this.host.approvePlanning(projectId)
    });
    if (planningDecision) {
      return planningDecision;
    }

    const executionDecision = this.resolveExecutionDecision(projectId);
    if (executionDecision) {
      return executionDecision;
    }

    const latestQaRun = this.host.getLatestQaRunByProjectId(projectId);
    const qaDecision = this.resolveQaDecision(projectId, latestQaRun);
    if (qaDecision) {
      return qaDecision;
    }

    const latestDocumentationRun = this.host.getLatestDocumentationRunByProjectId(projectId);
    return this.resolveDocumentationDecision(projectId, latestDocumentationRun);
  }

  private resolveStageDecision(input: {
    itemId: string;
    projectId: string;
    stageKey: Exclude<StageKey, "brainstorm">;
    hasStageOutput: boolean;
    approvalSatisfied: boolean;
    startAction: string;
    approveAction: string;
    approveScopeType: AutorunStep["scopeType"];
    approve: () => void;
  }): AutorunDecision | null {
    const latestRun = this.host.getLatestStageRun({
      itemId: input.itemId,
      projectId: input.projectId,
      stageKey: input.stageKey
    });

    if (!input.hasStageOutput) {
      if (latestRun?.status === "needs_user_input") {
        return {
          kind: "stop",
          finalStatus: "stopped",
          stopReason: `${input.stageKey}_needs_user_input`
        };
      }
      if (latestRun?.status === "review_required") {
        return {
          kind: "stop",
          finalStatus: "stopped",
          stopReason: `${input.stageKey}_review_required`
        };
      }
      if (latestRun?.status === "failed") {
        return {
          kind: "stop",
          finalStatus: "failed",
          stopReason: `${input.stageKey}_failed`
        };
      }
      return {
        kind: "step",
        action: input.startAction,
        scopeType: "project",
        scopeId: input.projectId,
        execute: () =>
          this.host.startStage({
            stageKey: input.stageKey,
            itemId: input.itemId,
            projectId: input.projectId
          })
      };
    }

    if (!input.approvalSatisfied) {
      return {
        kind: "step",
        action: input.approveAction,
        scopeType: input.approveScopeType,
        scopeId: input.projectId,
        execute: () => input.approve()
      };
    }

    return null;
  }

  private resolveExecutionDecision(projectId: string): AutorunDecision | null {
    const execution = this.host.showExecution(projectId);
    const latestReadiness = this.host.getLatestExecutionReadinessByProjectId(projectId);
    const latestVerificationReadiness = this.host.getLatestVerificationReadinessByProjectId(projectId);
    const hasAnyExecutionProgress = execution.waves.some((wave) =>
      wave.stories.some(
        (story) => story.latestTestRun !== null || story.latestExecution !== null || story.latestStoryReviewRun !== null
      )
    );

    let hasIncompleteWave = false;
    let hasStartedExecution = false;

    for (const wave of execution.waves) {
      const waveResult = this.resolveWaveExecutionDecision(wave);
      hasStartedExecution ||= waveResult.hasStartedExecution;
      hasIncompleteWave ||= !waveResult.isCompleted;
      if (waveResult.decision) {
        return waveResult.decision;
      }
    }

    if (hasIncompleteWave || !hasStartedExecution) {
      if (!hasAnyExecutionProgress && latestReadiness && latestReadiness.status !== "ready") {
        return this.stop("stopped", "execution_readiness_blocked");
      }
      if (!hasAnyExecutionProgress && latestVerificationReadiness && latestVerificationReadiness.status !== "ready") {
        return this.stop("stopped", "verification_readiness_blocked");
      }
      const action = hasStartedExecution ? "execution:tick" : "execution:start";
      const execute = () => (hasStartedExecution ? this.host.tickExecution(projectId) : this.host.startExecution(projectId));
      return {
        kind: "step",
        action,
        scopeType: "project",
        scopeId: projectId,
        execute
      };
    }

    return null;
  }

  private resolveMissingConceptDecision(
    latestBrainstormRun: ReturnType<AutorunHost["getLatestStageRun"]>
  ): Extract<AutorunDecision, { kind: "stop" }> {
    if (latestBrainstormRun?.status === "review_required") {
      return this.stop("stopped", "brainstorm_review_required");
    }
    if (latestBrainstormRun?.status === "failed") {
      return this.stop("failed", "brainstorm_failed");
    }
    return this.stop("stopped", "concept_missing");
  }

  private resolveQaDecision(
    projectId: string,
    latestQaRun: ReturnType<AutorunHost["getLatestQaRunByProjectId"]>
  ): AutorunDecision | null {
    if (!latestQaRun) {
      return {
        kind: "step",
        action: "qa:start",
        scopeType: "project",
        scopeId: projectId,
        execute: () => this.host.startQa(projectId)
      };
    }
    if (latestQaRun.status === "failed") {
      return this.stop("failed", "qa_failed");
    }
    if (latestQaRun.status === "review_required") {
      return this.stop("stopped", "qa_review_required");
    }
    return null;
  }

  private resolveDocumentationDecision(
    projectId: string,
    latestDocumentationRun: ReturnType<AutorunHost["getLatestDocumentationRunByProjectId"]>
  ): AutorunDecision {
    if (latestDocumentationRun?.staleAt !== null) {
      return {
        kind: "step",
        action: "documentation:start",
        scopeType: "project",
        scopeId: projectId,
        execute: () => this.host.startDocumentation(projectId)
      };
    }
    if (latestDocumentationRun.status === "failed") {
      return this.stop("failed", "documentation_failed");
    }
    if (latestDocumentationRun.status === "review_required") {
      return this.stop("stopped", "documentation_review_required");
    }
    if (latestDocumentationRun.status === "completed") {
      return this.stop("completed", "project_completed");
    }
    return this.stop("stopped", "documentation_pending");
  }

  private resolveWaveExecutionDecision(
    wave: ReturnType<AutorunHost["showExecution"]>["waves"][number]
  ): { decision: AutorunDecision | null; hasStartedExecution: boolean; isCompleted: boolean } {
    let hasStartedExecution = wave.waveExecution !== null;
    if (wave.waveExecution?.status === "failed") {
      return this.waveDecisionResult(this.stop("failed", "execution_failed"), hasStartedExecution, false);
    }

    for (const storyEntry of wave.stories) {
      const storyDecision = this.resolveStoryExecutionDecision(storyEntry);
      hasStartedExecution ||= storyDecision.hasStartedExecution;
      if (storyDecision.decision) {
        return this.waveDecisionResult(storyDecision.decision, hasStartedExecution, false);
      }
    }

    return this.waveDecisionResult(null, hasStartedExecution, wave.waveExecution?.status === "completed");
  }

  private resolveStoryExecutionDecision(
    storyEntry: ReturnType<AutorunHost["showExecution"]>["waves"][number]["stories"][number]
  ): { decision: AutorunDecision | null; hasStartedExecution: boolean } {
    const testRunStatus = storyEntry.latestTestRun?.status;
    if (testRunStatus === "failed") {
      return { decision: this.stop("failed", "test_preparation_failed"), hasStartedExecution: false };
    }
    if (testRunStatus === "review_required") {
      return { decision: this.stop("stopped", "test_preparation_review_required"), hasStartedExecution: false };
    }

    const latestExecution = storyEntry.latestExecution;
    if (!latestExecution) {
      return { decision: null, hasStartedExecution: false };
    }
    if (latestExecution.status === "failed") {
      return { decision: this.stop("failed", "execution_failed"), hasStartedExecution: true };
    }
    if (latestExecution.status !== "review_required") {
      return { decision: null, hasStartedExecution: true };
    }

    const latestStoryReviewRun = storyEntry.latestStoryReviewRun
      ? this.host.requireStoryReviewRunById(storyEntry.latestStoryReviewRun.id)
      : null;
    const decision = this.resolveStoryReviewDecision(latestStoryReviewRun);
    return { decision, hasStartedExecution: true };
  }

  private resolveStoryReviewDecision(
    latestStoryReviewRun: ReturnType<AutorunHost["requireStoryReviewRunById"]> | null
  ): AutorunDecision {
    if (!latestStoryReviewRun) {
      return this.stop("stopped", "execution_review_required");
    }
    if (this.host.canAutorunStoryReviewRemediate(latestStoryReviewRun.id)) {
      return {
        kind: "step",
        action: "remediation:story-review:start",
        scopeType: "remediation",
        scopeId: latestStoryReviewRun.id,
        execute: () => this.host.startStoryReviewRemediation(latestStoryReviewRun.id)
      };
    }
    return this.stop("stopped", this.host.getStoryReviewRemediationStopReason(latestStoryReviewRun.id));
  }

  private waveDecisionResult(
    decision: AutorunDecision | null,
    hasStartedExecution: boolean,
    isCompleted: boolean
  ): { decision: AutorunDecision | null; hasStartedExecution: boolean; isCompleted: boolean } {
    return { decision, hasStartedExecution, isCompleted };
  }

  private stop(
    finalStatus: Extract<AutorunSummary["finalStatus"], "completed" | "stopped" | "failed">,
    stopReason: string
  ): Extract<AutorunDecision, { kind: "stop" }> {
    return {
      kind: "stop",
      finalStatus,
      stopReason
    };
  }

  private buildStep(decision: Extract<AutorunDecision, { kind: "step" }>, result: unknown): AutorunStep {
    const payload = result && typeof result === "object" && !Array.isArray(result) ? (result as Record<string, unknown>) : {};
    return {
      action: decision.action,
      scopeType: this.resolveStepScopeType(decision, payload),
      scopeId: this.resolveStepScopeId(decision, payload),
      status: typeof payload.status === "string" ? payload.status : "completed"
    };
  }

  private resolveStepScopeType(
    decision: Extract<AutorunDecision, { kind: "step" }>,
    payload: Record<string, unknown>
  ): AutorunStep["scopeType"] {
    if (typeof payload.runId === "string") {
      return "run";
    }
    if (typeof payload.waveStoryExecutionId === "string") {
      return "execution";
    }
    if (typeof payload.storyReviewRemediationRunId === "string") {
      return "remediation";
    }
    if (typeof payload.qaRunId === "string") {
      return "qa";
    }
    if (typeof payload.documentationRunId === "string") {
      return "documentation";
    }
    return decision.scopeType;
  }

  private resolveStepScopeId(
    decision: Extract<AutorunDecision, { kind: "step" }>,
    payload: Record<string, unknown>
  ): string {
    const candidateIds = [
      payload.runId,
      payload.waveStoryExecutionId,
      payload.storyReviewRemediationRunId,
      payload.qaRunId,
      payload.documentationRunId
    ];
    const resolved = candidateIds.find((value): value is string => typeof value === "string");
    return resolved ?? decision.scopeId;
  }

  private collectIds(summary: AutorunSummary, steps: AutorunStep[]): void {
    for (const step of steps) {
      if (step.scopeType === "run") {
        summary.createdRunIds.push(step.scopeId);
      } else if (step.scopeType === "execution") {
        summary.createdExecutionIds.push(step.scopeId);
      } else if (step.scopeType === "remediation") {
        summary.createdRemediationRunIds.push(step.scopeId);
      }
    }
  }
}
