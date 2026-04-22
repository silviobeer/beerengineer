import type { StageAgentInput } from "../../core/adapters.js"
import type { RuntimePolicy } from "../registry.js"

export type HostedProviderId = "claude-code" | "codex" | "opencode"

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
    "You are the BeerEngineer stage agent backend.",
    "Return exactly one JSON object and nothing else.",
    'Use this exact top-level shape: { "kind": "artifact"|"message", "artifact"?: unknown, "message"?: string|null, "needsUserInput"?: boolean, "userInputQuestion"?: string|null, "followUpHint"?: string|null }',
    "Do not use markdown fences.",
    `Stage: ${input.stageId}`,
    `Provider: ${input.provider}`,
    `Model: ${input.model ?? "default"}`,
    `Runtime policy: ${JSON.stringify(input.runtimePolicy)}`,
    action,
    `Payload:\n${JSON.stringify(input.request, null, 2)}`,
  ].join("\n\n")
}

export function buildReviewPrompt<S, A>(input: {
  stageId: string
  provider: HostedProviderId
  model?: string
  runtimePolicy: RuntimePolicy
  request: { artifact: A; state: S }
}): string {
  return [
    "You are the BeerEngineer reviewer backend.",
    "Reviewer runs are read-only.",
    "Return exactly one JSON object and nothing else.",
    'Use one of these exact shapes: { "kind": "pass" } | { "kind": "revise", "feedback": string } | { "kind": "block", "reason": string }',
    "Do not use markdown fences.",
    `Stage: ${input.stageId}`,
    `Provider: ${input.provider}`,
    `Model: ${input.model ?? "default"}`,
    `Runtime policy: ${JSON.stringify(input.runtimePolicy)}`,
    `Payload:\n${JSON.stringify(input.request, null, 2)}`,
  ].join("\n\n")
}

export function buildExecutionPrompt(input: {
  provider: HostedProviderId
  model?: string
  runtimePolicy: RuntimePolicy
  storyId: string
  action: "implement" | "fix"
  payload: unknown
}): string {
  return [
    "You are the BeerEngineer execution coder backend.",
    "Modify files directly inside the workspace when required by the task.",
    "Return exactly one JSON object and nothing else.",
    'Use this exact shape: { "summary": string, "testsRun": Array<{ "command": string, "status": "passed"|"failed"|"not_run" }>, "implementationNotes": string[], "blockers": string[] }',
    "Do not wrap the response in markdown fences.",
    `Story: ${input.storyId}`,
    `Provider: ${input.provider}`,
    `Model: ${input.model ?? "default"}`,
    `Runtime policy: ${JSON.stringify(input.runtimePolicy)}`,
    `Action: ${input.action}`,
    `Payload:\n${JSON.stringify(input.payload, null, 2)}`,
  ].join("\n\n")
}
