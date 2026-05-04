import type { CapabilityId, ReviewCapabilityEnvelope, ReviewOutcome } from "./types.js"

function reviewOutcome<ToolResult>(
  capabilityId: CapabilityId,
  phase: string,
  outcome: Exclude<ReviewOutcome, "ran">,
  reason: string,
  summary = reason,
): ReviewCapabilityEnvelope<ToolResult> {
  return {
    capabilityId,
    phase,
    outcome,
    blocking: false,
    summary,
    reason,
    artifacts: [],
  }
}

export function reviewRan<ToolResult>(
  capabilityId: CapabilityId,
  phase: string,
  summary: string,
  toolResult?: ToolResult,
): ReviewCapabilityEnvelope<ToolResult> {
  return {
    capabilityId,
    phase,
    outcome: "ran",
    blocking: false,
    summary,
    artifacts: [],
    ...(toolResult === undefined ? {} : { toolResult }),
  }
}

export function skippedReviewOutcome<ToolResult = unknown>(
  capabilityId: CapabilityId,
  phase: string,
  reason: string,
): ReviewCapabilityEnvelope<ToolResult> {
  return reviewOutcome(capabilityId, phase, "skipped", reason)
}

export function notConfiguredReviewOutcome<ToolResult = unknown>(
  capabilityId: CapabilityId,
  phase: string,
  reason: string,
): ReviewCapabilityEnvelope<ToolResult> {
  return reviewOutcome(capabilityId, phase, "not_configured", reason)
}

export function failedReviewOutcome<ToolResult = unknown>(
  capabilityId: CapabilityId,
  phase: string,
  reason: string,
): ReviewCapabilityEnvelope<ToolResult> {
  return reviewOutcome(capabilityId, phase, "failed", reason)
}

export function notMeaningfulReviewOutcome<ToolResult = unknown>(
  capabilityId: CapabilityId,
  phase: string,
  reason: string,
): ReviewCapabilityEnvelope<ToolResult> {
  return reviewOutcome(capabilityId, phase, "not_meaningful", reason)
}
