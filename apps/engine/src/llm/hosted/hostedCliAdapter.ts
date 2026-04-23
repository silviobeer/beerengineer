import type { ReviewAgentAdapter, ReviewContext, StageAgentAdapter, StageAgentInput } from "../../core/adapters.js"
import { emitEvent, getActiveRun } from "../../core/runContext.js"
import type { RuntimePolicy } from "../registry.js"
import type { HostedCliRequest, HostedProviderId } from "./promptEnvelope.js"
import { mapReviewEnvelopeToResponse, mapStageEnvelopeToResponse, type HostedReviewOutputEnvelope, type HostedStageOutputEnvelope } from "./outputEnvelope.js"
import { buildReviewPrompt, buildStagePrompt } from "./promptEnvelope.js"
import type { HostedCliExecutionResult, HostedProviderInvokeInput, HostedSession } from "./providerRuntime.js"
import { invokeClaude } from "./providers/claude.js"
import { invokeCodex } from "./providers/codex.js"
import { invokeOpenCode } from "./providers/opencode.js"

export type HostedProviderAdapter = {
  invoke(input: HostedProviderInvokeInput): Promise<HostedCliExecutionResult>
}

function providerAdapter(provider: HostedProviderId): HostedProviderAdapter {
  switch (provider) {
    case "claude-code":
      return { invoke: invokeClaude }
    case "codex":
      return { invoke: invokeCodex }
    case "opencode":
      return { invoke: invokeOpenCode }
  }
}

export async function invokeHostedCli(
  request: HostedCliRequest,
  session?: HostedSession | null,
): Promise<HostedCliExecutionResult> {
  const result = await providerAdapter(request.runtime.provider).invoke({
    prompt: request.prompt,
    runtime: request.runtime,
    session,
  })
  const active = getActiveRun()
  if (active) {
    emitEvent({
      type: "log",
      runId: active.runId,
      message: `llm.invocation provider=${request.runtime.provider} session=${result.session.sessionId && session?.sessionId ? "resumed" : "started"} cachedTokens=${result.cacheStats?.cachedInputTokens ?? 0} totalTokens=${result.cacheStats?.totalInputTokens ?? 0}`,
    })
  }
  return result
}

function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim()
  const candidates: string[] = []
  candidates.push(trimmed)
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence?.[1]) candidates.push(fence[1].trim())
  const outermost = extractOutermostJsonObject(trimmed)
  if (outermost) candidates.push(outermost)

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error(`Provider output did not contain a JSON object: ${trimmed.slice(0, 200)}`)
}

function extractOutermostJsonObject(text: string): string | null {
  let depth = 0
  let start = -1
  let inString = false
  let escape = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escape) escape = false
      else if (ch === "\\") escape = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === "{") {
      if (depth === 0) start = i
      depth++
    } else if (ch === "}") {
      depth--
      if (depth === 0 && start >= 0) {
        return text.slice(start, i + 1)
      }
    }
  }
  return null
}

type HostedAdapterInput = {
  stageId: string
  provider: HostedProviderId
  model?: string
  workspaceRoot: string
  runtimePolicy: RuntimePolicy
}

export class HostedStageAdapter<S, A> implements StageAgentAdapter<S, A> {
  private session: HostedSession

  constructor(private readonly input: HostedAdapterInput) {
    this.session = { provider: input.provider, sessionId: null }
  }

  getSessionId(): string | null {
    return this.session.sessionId
  }

  setSessionId(sessionId: string | null): void {
    this.session = { provider: this.input.provider, sessionId }
  }

  async step(request: StageAgentInput<S>) {
    const runtime = {
      provider: this.input.provider,
      model: this.input.model,
      workspaceRoot: this.input.workspaceRoot,
      policy: this.input.runtimePolicy,
    }
    const basePrompt = buildStagePrompt({
      stageId: this.input.stageId,
      provider: this.input.provider,
      model: this.input.model,
      runtimePolicy: this.input.runtimePolicy,
      request,
    })
    const firstResult = await invokeHostedCli(
      { kind: "stage", runtime, prompt: basePrompt, payload: request },
      this.session,
    )
    this.session = firstResult.session
    try {
      return mapStageEnvelopeToResponse(parseJsonObject(firstResult.outputText) as HostedStageOutputEnvelope<A>)
    } catch (err) {
      const retryPrompt = `${basePrompt}\n\nIMPORTANT: your previous response was not valid JSON. You MUST respond with ONLY a single JSON object that matches the output envelope schema — no prose before or after, no markdown, no code fences. Respond with the JSON object now.\n\nPrevious response (for your reference):\n${firstResult.outputText.slice(0, 2000)}`
      const retryResult = await invokeHostedCli(
        { kind: "stage", runtime, prompt: retryPrompt, payload: request },
        this.session,
      )
      this.session = retryResult.session
      try {
        return mapStageEnvelopeToResponse(parseJsonObject(retryResult.outputText) as HostedStageOutputEnvelope<A>)
      } catch {
        throw err
      }
    }
  }
}

export class HostedReviewAdapter<S, A> implements ReviewAgentAdapter<S, A> {
  private session: HostedSession

  constructor(private readonly input: HostedAdapterInput) {
    this.session = { provider: input.provider, sessionId: null }
  }

  getSessionId(): string | null {
    return this.session.sessionId
  }

  setSessionId(sessionId: string | null): void {
    this.session = { provider: this.input.provider, sessionId }
  }

  async review(request?: { artifact: A; state: S; reviewContext?: ReviewContext }) {
    if (!request) throw new Error("Hosted review adapter requires a review payload")
    const runtime = {
      provider: this.input.provider,
      model: this.input.model,
      workspaceRoot: this.input.workspaceRoot,
      policy: this.input.runtimePolicy,
    }
    const basePrompt = buildReviewPrompt({
      stageId: this.input.stageId,
      provider: this.input.provider,
      model: this.input.model,
      runtimePolicy: this.input.runtimePolicy,
      request,
    })
    const firstResult = await invokeHostedCli(
      { kind: "review", runtime, prompt: basePrompt, payload: request },
      this.session,
    )
    this.session = firstResult.session
    try {
      return mapReviewEnvelopeToResponse(parseJsonObject(firstResult.outputText) as HostedReviewOutputEnvelope)
    } catch (err) {
      const retryPrompt = `${basePrompt}\n\nIMPORTANT: your previous response was not valid JSON. You MUST respond with ONLY a single JSON object that matches the review output envelope schema — no prose before or after, no markdown, no code fences. Respond with the JSON object now.\n\nPrevious response (for your reference):\n${firstResult.outputText.slice(0, 2000)}`
      const retryResult = await invokeHostedCli(
        { kind: "review", runtime, prompt: retryPrompt, payload: request },
        this.session,
      )
      this.session = retryResult.session
      try {
        return mapReviewEnvelopeToResponse(parseJsonObject(retryResult.outputText) as HostedReviewOutputEnvelope)
      } catch {
        throw err
      }
    }
  }
}

export { parseJsonObject }
