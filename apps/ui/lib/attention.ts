import type { Item } from "./types";

export const ATTENTION_TRIGGERS = new Set([
  "openPrompt",
  "review-gate-waiting",
  "run-blocked",
]);

export const PHASE_STATUS_ATTENTION_TRIGGERS = new Set([
  "prompt",
  "review",
  "blocked",
]);

export const FAILURE_STATES = new Set(["failed"]);

export function hasAttentionDot(item: Pick<Item, "pipelineState">): boolean {
  return (
    ATTENTION_TRIGGERS.has(item.pipelineState) ||
    PHASE_STATUS_ATTENTION_TRIGGERS.has(item.pipelineState)
  );
}

export function hasFailureIndicator(item: Pick<Item, "pipelineState">): boolean {
  return FAILURE_STATES.has(item.pipelineState);
}
