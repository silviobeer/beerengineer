import { AppError } from "../shared/errors.js";
import type { StageRunStatus } from "../domain/types.js";

const allowedTransitions = new Map<StageRunStatus, StageRunStatus[]>([
  ["pending", ["running", "failed"]],
  ["running", ["completed", "failed", "review_required"]],
  ["completed", []],
  ["failed", []],
  ["review_required", []]
]);

export class StageRunTransitionError extends AppError {
  public constructor(from: StageRunStatus, to: StageRunStatus) {
    super("STAGE_RUN_TRANSITION_ERROR", `Invalid stage run transition from ${from} to ${to}`);
    this.name = "StageRunTransitionError";
  }
}

export function assertStageRunTransitionAllowed(from: StageRunStatus, to: StageRunStatus): void {
  const targets = allowedTransitions.get(from) ?? [];
  if (!targets.includes(to)) {
    throw new StageRunTransitionError(from, to);
  }
}
