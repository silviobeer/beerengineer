import type { ReviewContext, StageAgentInput, StageContext } from "../../core/adapters.js"
import type { RuntimePolicy } from "../registry.js"
import { loadPrompt, PromptLoadError, type PromptKind } from "../prompts/loader.js"

export type HostedProviderId = "claude-code" | "codex" | "opencode"
export type HostedPromptKind = "stage" | "review" | "execution"

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
  kind: HostedPromptKind
  runtime: {
    provider: HostedProviderId
    model?: string
    workspaceRoot: string
    policy: RuntimePolicy
  }
  prompt: string
  payload: unknown
}

type PromptSchema = {
  promptKind: PromptKind
  /** Whether to fall back to `_default` if the per-stage prompt is missing. */
  allowDefaultFallback: boolean
  /** Canonical instructions for the provider. */
  instructions: readonly string[]
}

/**
 * Table of per-kind instruction blocks. Every hosted prompt follows the same
 * shape — loadPrompt + instructions + trailing payload — so the three
 * kind-specific builders collapse to thin wrappers over this table.
 */
const SCHEMAS: Record<HostedPromptKind, PromptSchema> = {
  stage: {
    promptKind: "system",
    allowDefaultFallback: false,
    instructions: [
      "Return exactly one JSON object and nothing else.",
      'Use this exact top-level shape: { "kind": "artifact", "artifact": unknown } OR { "kind": "message", "message": string }',
      'When you need information from the user, emit { "kind": "message", "message": "<your question>" } — the user will respond on the next turn.',
      "Do not use markdown fences.",
      "If this is not your first turn, prior turns may already exist in your native provider session.",
      "The payload's stageContext is the authoritative source for turn counters and review-feedback history.",
      "Do not repeat questions you already asked unless the new payload makes the previous answer insufficient.",
    ],
  },
  review: {
    promptKind: "reviewers",
    allowDefaultFallback: true,
    instructions: [
      "Reviewer runs are read-only.",
      "If this is not your first review cycle, prior reviewer turns may already exist in your native provider session.",
      "The payload's reviewContext is the authoritative source for cycle count, final-cycle semantics, and prior feedback history.",
      "Return exactly one JSON object and nothing else.",
      'Use one of these exact shapes: { "kind": "pass" } | { "kind": "revise", "feedback": string } | { "kind": "block", "reason": string }',
      "Do not use markdown fences.",
    ],
  },
  execution: {
    promptKind: "workers",
    allowDefaultFallback: false,
    instructions: [
      "Modify files directly inside the workspace when required by the task.",
      "If this is not your first implementation iteration, prior turns may already exist in your native provider session.",
      "The payload's iterationContext is the authoritative source for iteration counters and prior failed attempts.",
      "Return exactly one JSON object and nothing else.",
      'Use this exact shape: { "summary": string, "testsRun": Array<{ "command": string, "status": "passed"|"failed"|"not_run" }>, "implementationNotes": string[], "blockers": string[] }',
      "Do not wrap the response in markdown fences.",
    ],
  },
}

function loadPromptWithFallback(schema: PromptSchema, promptId: string): string {
  try {
    return loadPrompt(schema.promptKind, promptId)
  } catch (error) {
    if (!schema.allowDefaultFallback || !(error instanceof PromptLoadError) || !error.missing) throw error
    return loadPrompt(schema.promptKind, "_default")
  }
}

function withPayload<T>(payload: T, context: Record<string, unknown>): T & Record<string, unknown> {
  return { ...(payload as Record<string, unknown>), ...context } as T & Record<string, unknown>
}

/**
 * Assemble a hosted prompt. `promptId` is the per-stage system/reviewer file
 * name (or a fixed id for worker prompts like "execution"). `action` appears
 * as its own line so stage-specific phrasing ("Revise the stage output
 * using the supplied review feedback.") remains visible.
 */
export function buildHostedPrompt(params: {
  kind: HostedPromptKind
  promptId: string
  provider: HostedProviderId
  model?: string
  runtimePolicy: RuntimePolicy
  action?: string
  identityLines?: readonly string[]
  payload: Record<string, unknown>
}): string {
  const schema = SCHEMAS[params.kind]
  const lines: string[] = [loadPromptWithFallback(schema, params.promptId), ...schema.instructions]
  if (params.action) lines.push(params.action)
  if (params.identityLines) lines.push(...params.identityLines)
  lines.push(
    `Provider: ${params.provider}`,
    `Model: ${params.model ?? "default"}`,
    `Runtime policy: ${JSON.stringify(params.runtimePolicy)}`,
    `Payload:\n${JSON.stringify(params.payload, null, 2)}`,
  )
  return lines.join("\n\n")
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
  const stageContext: StageContext | null = input.request.stageContext ?? null
  return buildHostedPrompt({
    kind: "stage",
    promptId: input.stageId,
    provider: input.provider,
    model: input.model,
    runtimePolicy: input.runtimePolicy,
    action,
    identityLines: [`Stage: ${input.stageId}`],
    payload: withPayload(input.request, { stageContext }),
  })
}

export function buildReviewPrompt<S, A>(input: {
  stageId: string
  provider: HostedProviderId
  model?: string
  runtimePolicy: RuntimePolicy
  request: { artifact: A; state: S; reviewContext?: ReviewContext }
}): string {
  return buildHostedPrompt({
    kind: "review",
    promptId: input.stageId,
    provider: input.provider,
    model: input.model,
    runtimePolicy: input.runtimePolicy,
    identityLines: [`Stage: ${input.stageId}`],
    payload: withPayload(input.request, { reviewContext: input.request.reviewContext ?? null }),
  })
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
  return buildHostedPrompt({
    kind: "execution",
    promptId: "execution",
    provider: input.provider,
    model: input.model,
    runtimePolicy: input.runtimePolicy,
    identityLines: [`Story: ${input.storyId}`, `Action: ${input.action}`],
    payload: withPayload(input.payload as Record<string, unknown>, {
      iterationContext: input.iterationContext ?? null,
    }),
  })
}
