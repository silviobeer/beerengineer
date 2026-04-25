import type { Item } from "./types";

export const ATTENTION_TRIGGERS = new Set([
  "openPrompt",
  "review-gate-waiting",
  "run-blocked",
]);

export function hasAttentionDot(item: Pick<Item, "pipelineState">): boolean {
  return ATTENTION_TRIGGERS.has(item.pipelineState);
}
