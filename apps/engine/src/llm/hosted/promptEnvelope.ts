import type { ReviewContext, StageAgentInput, StageContext } from "../../core/adapters.js"
import type { RuntimePolicy } from "../registry.js"
import { loadPrompt, PromptLoadError } from "../prompts/loader.js"

export type HostedProviderId = "claude-code" | "codex" | "opencode"

export type IterationContext = {
  iteration: number
  maxIterations: number
  reviewCycle: number
  maxReviewCycles: number
  priorAttempts: Array<{
    iteration: number
    summary: string
    outcome: "passed" | "failed" | "blocked"
  }>
}

export type HostedCliRequest = {
  kind: string
  runtime: {
    provider: HostedProviderId
    model?: string
    workspaceRoot: string
    policy: RuntimePolicy
  }
  prompt: string
  payload: unknown
}

function withPayload<T>(payload: T, context: Record<string, unknown>): T & Record<string, unknown> {
  return { ...(payload as Record<string, unknown>), ...context } as T & Record<string, unknown>
}

export function buildStagePrompt<S>(input: {
  stageId: string
  provider: HostedProviderId
  model?: string
  runtimePolicy: RuntimePolicy
  request: StageAgentInput<S>
}): string {
  const action =
    input.request.kind === "begin"
      ? "Start the stage from the provided state."
      : input.request.kind === "user-message"
      ? "Respond to the user and continue the stage."
      : "Revise the stage output using the supplied review feedback."

  return [
    loadPrompt("system", input.stageId),
    "Return exactly one JSON object and nothing else.",
    'Use this exact top-level shape: { "kind": "artifact", "artifact": unknown } OR { "kind": "message", "message": string }',
    'When you need information from the user, emit { "kind": "message", "message": "<your question>" } — the user will respond on the next turn.',
    "Do not use markdown fences.",
    "If this is not your first turn, prior turns may already exist in your native provider session.",
    "The payload's stageContext is the authoritative source for turn counters and review-feedback history.",
    "Do not repeat questions you already asked unless the new payload makes the previous answer insufficient.",
    `Stage: ${input.stageId}`,
    `Provider: ${input.provider}`,
    `Model: ${input.model ?? "default"}`,
    `Runtime policy: ${JSON.stringify(input.runtimePolicy)}`,
    action,
    `Payload:\n${JSON.stringify(withPayload(input.request, { stageContext: input.request.stageContext ?? null }), null, 2)}`,
  ].join("\n\n")
}

export function buildReviewPrompt<S, A>(input: {
  stageId: string
  provider: HostedProviderId
  model?: string
  runtimePolicy: RuntimePolicy
  request: { artifact: A; state: S; reviewContext?: ReviewContext }
}): string {
  let reviewerPrompt: string
  try {
    reviewerPrompt = loadPrompt("reviewers", input.stageId)
  } catch (error) {
    if (!(error instanceof PromptLoadError) || !error.missing) throw error
    reviewerPrompt = loadPrompt("reviewers", "_default")
  }

  return [
    reviewerPrompt,
    "Reviewer runs are read-only.",
    "If this is not your first review cycle, prior reviewer turns may already exist in your native provider session.",
    "The payload's reviewContext is the authoritative source for cycle count, final-cycle semantics, and prior feedback history.",
    "Return exactly one JSON object and nothing else.",
    'Use one of these exact shapes: { "kind": "pass" } | { "kind": "revise", "feedback": string } | { "kind": "block", "reason": string }',
    "Do not use markdown fences.",
    `Stage: ${input.stageId}`,
    `Provider: ${input.provider}`,
    `Model: ${input.model ?? "default"}`,
    `Runtime policy: ${JSON.stringify(input.runtimePolicy)}`,
    `Payload:\n${JSON.stringify(withPayload(input.request, { reviewContext: input.request.reviewContext ?? null }), null, 2)}`,
  ].join("\n\n")
}

export function buildExecutionPrompt(input: {
  provider: HostedProviderId
  model?: string
  runtimePolicy: RuntimePolicy
  storyId: string
  action: "implement" | "fix"
  payload: unknown
  iterationContext?: IterationContext
}): string {
  return [
    loadPrompt("workers", "execution"),
    "Modify files directly inside the workspace when required by the task.",
    "If this is not your first implementation iteration, prior turns may already exist in your native provider session.",
    "The payload's iterationContext is the authoritative source for iteration counters and prior failed attempts.",
    "Return exactly one JSON object and nothing else.",
    'Use this exact shape: { "summary": string, "testsRun": Array<{ "command": string, "status": "passed"|"failed"|"not_run" }>, "implementationNotes": string[], "blockers": string[] }',
    "Do not wrap the response in markdown fences.",
    `Story: ${input.storyId}`,
    `Provider: ${input.provider}`,
    `Model: ${input.model ?? "default"}`,
    `Runtime policy: ${JSON.stringify(input.runtimePolicy)}`,
    `Action: ${input.action}`,
    `Payload:\n${JSON.stringify(withPayload(input.payload, { iterationContext: input.iterationContext ?? null }), null, 2)}`,
  ].join("\n\n")
}
