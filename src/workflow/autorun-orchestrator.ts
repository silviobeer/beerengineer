import { AppError } from "../shared/errors.js";
import type { StageKey } from "../domain/types.js";
import type { AutorunDecision, AutorunHost, AutorunScopeType, AutorunStep, AutorunSummary } from "./autorun-types.js";

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

    for (let index = 0; index < 100; index += 1) {
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
      return {
        kind: "stop",
        finalStatus: "failed",
        stopReason: "item_failed"
      };
    }

    const concept = this.host.getLatestConceptByItemId(itemId);
    const latestBrainstormRun = this.host.getLatestStageRun({ itemId, stageKey: "brainstorm" });
    if (!concept) {
      if (latestBrainstormRun?.status === "review_required") {
        return {
          kind: "stop",
          finalStatus: "stopped",
          stopReason: "brainstorm_review_required"
        };
      }
      if (latestBrainstormRun?.status === "failed") {
        return {
          kind: "stop",
          finalStatus: "failed",
          stopReason: "brainstorm_failed"
        };
      }
      return {
        kind: "stop",
        finalStatus: "stopped",
        stopReason: "concept_missing"
      };
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
    return {
      kind: "stop",
      finalStatus: finalItem.currentColumn === "done" ? "completed" : "stopped",
      stopReason: finalItem.currentColumn === "done" ? "item_completed" : "project_incomplete"
    };
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

    const architectureDecision = this.resolveStageDecision({
      itemId: project.itemId,
      projectId,
      stageKey: "architecture",
      hasStageOutput: this.host.getLatestArchitecturePlanByProjectId(projectId) !== null,
      approvalSatisfied: this.host.getLatestArchitecturePlanByProjectId(projectId)?.status === "approved",
      startAction: "architecture:start",
      approveAction: "architecture:approve",
      approveScopeType: "project",
      approve: () => this.host.approveArchitecture(projectId)
    });
    if (architectureDecision) {
      return architectureDecision;
    }

    const planningDecision = this.resolveStageDecision({
      itemId: project.itemId,
      projectId,
      stageKey: "planning",
      hasStageOutput: this.host.getLatestImplementationPlanByProjectId(projectId) !== null,
      approvalSatisfied: this.host.getLatestImplementationPlanByProjectId(projectId)?.status === "approved",
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
      return {
        kind: "stop",
        finalStatus: "failed",
        stopReason: "qa_failed"
      };
    }
    if (latestQaRun.status === "review_required") {
      return {
        kind: "stop",
        finalStatus: "stopped",
        stopReason: "qa_review_required"
      };
    }

    const latestDocumentationRun = this.host.getLatestDocumentationRunByProjectId(projectId);
    if (!latestDocumentationRun || latestDocumentationRun.staleAt !== null) {
      return {
        kind: "step",
        action: "documentation:start",
        scopeType: "project",
        scopeId: projectId,
        execute: () => this.host.startDocumentation(projectId)
      };
    }
    if (latestDocumentationRun.status === "failed") {
      return {
        kind: "stop",
        finalStatus: "failed",
        stopReason: "documentation_failed"
      };
    }
    if (latestDocumentationRun.status === "review_required") {
      return {
        kind: "stop",
        finalStatus: "stopped",
        stopReason: "documentation_review_required"
      };
    }
    if (latestDocumentationRun.status === "completed" && latestDocumentationRun.staleAt === null) {
      return {
        kind: "stop",
        finalStatus: "completed",
        stopReason: "project_completed"
      };
    }

    return {
      kind: "stop",
      finalStatus: "stopped",
      stopReason: "documentation_pending"
    };
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

    let hasIncompleteWave = false;
    let hasStartedExecution = false;

    for (const wave of execution.waves) {
      if (wave.waveExecution) {
        hasStartedExecution = true;
        if (wave.waveExecution.status === "failed") {
          return {
            kind: "stop",
            finalStatus: "failed",
            stopReason: "execution_failed"
          };
        }
      }

      for (const storyEntry of wave.stories) {
        if (storyEntry.latestTestRun?.status === "failed") {
          return {
            kind: "stop",
            finalStatus: "failed",
            stopReason: "test_preparation_failed"
          };
        }
        if (storyEntry.latestTestRun?.status === "review_required") {
          return {
            kind: "stop",
            finalStatus: "stopped",
            stopReason: "test_preparation_review_required"
          };
        }
        if (storyEntry.latestExecution) {
          hasStartedExecution = true;
          if (storyEntry.latestExecution.status === "failed") {
            return {
              kind: "stop",
              finalStatus: "failed",
              stopReason: "execution_failed"
            };
          }
          if (storyEntry.latestExecution.status === "review_required") {
            const latestStoryReviewRun = storyEntry.latestStoryReviewRun;
            if (latestStoryReviewRun && this.host.canAutorunStoryReviewRemediate(latestStoryReviewRun.id)) {
              return {
                kind: "step",
                action: "remediation:story-review:start",
                scopeType: "remediation",
                scopeId: latestStoryReviewRun.id,
                execute: () => this.host.startStoryReviewRemediation(latestStoryReviewRun.id)
              };
            }
            return {
              kind: "stop",
              finalStatus: "stopped",
              stopReason: latestStoryReviewRun
                ? this.host.getStoryReviewRemediationStopReason(latestStoryReviewRun.id)
                : "execution_review_required"
            };
          }
        }
      }

      if (wave.waveExecution?.status !== "completed") {
        hasIncompleteWave = true;
      }
    }

    if (hasIncompleteWave || !hasStartedExecution) {
      return {
        kind: "step",
        action: hasStartedExecution ? "execution:tick" : "execution:start",
        scopeType: "project",
        scopeId: projectId,
        execute: () => (hasStartedExecution ? this.host.tickExecution(projectId) : this.host.startExecution(projectId))
      };
    }

    return null;
  }

  private buildStep(decision: Extract<AutorunDecision, { kind: "step" }>, result: unknown): AutorunStep {
    const payload = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
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
