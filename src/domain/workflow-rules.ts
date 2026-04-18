import { AppError } from "../shared/errors.js";
import type { BoardColumn, ItemWorkflowSnapshot } from "./types.js";

export class WorkflowGateError extends AppError {
  public constructor(message: string) {
    super("WORKFLOW_GATE_ERROR", message);
    this.name = "WorkflowGateError";
  }
}

export function canMoveItem(
  currentColumn: BoardColumn,
  targetColumn: BoardColumn,
  snapshot: ItemWorkflowSnapshot
): boolean {
  if (currentColumn === targetColumn) {
    return true;
  }

  if (currentColumn === "idea" && targetColumn === "brainstorm") {
    return true;
  }

  if (currentColumn === "brainstorm" && targetColumn === "requirements") {
    return snapshot.hasApprovedConcept;
  }

  if (currentColumn === "requirements" && targetColumn === "implementation") {
    return snapshot.projectCount > 0 && snapshot.allStoriesApproved;
  }

  if (currentColumn === "implementation" && targetColumn === "done") {
    return snapshot.projectCount > 0 && snapshot.allArchitectureApproved;
  }

  return false;
}

export function assertCanMoveItem(
  currentColumn: BoardColumn,
  targetColumn: BoardColumn,
  snapshot: ItemWorkflowSnapshot
): void {
  if (!canMoveItem(currentColumn, targetColumn, snapshot)) {
    throw new WorkflowGateError(
      `Cannot move item from ${currentColumn} to ${targetColumn} with current approvals`
    );
  }
}
