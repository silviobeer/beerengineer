import type { ReviewAgentAdapter, ReviewContext, StageAgentAdapter, StageAgentInput } from "../../core/adapters.js"
import { emitEvent, getActiveRun } from "../../core/runContext.js"
import type { RuntimePolicy } from "../registry.js"
import type { InvocationRuntime } from "../types.js"
import type { HostedHarness, HostedRequest } from "./promptEnvelope.js"
import { buildReviewPrompt, buildStagePrompt } from "./promptEnvelope.js"
import {
  mapReviewEnvelopeToResponse,
  mapStageEnvelopeToResponse,
  type HostedReviewOutputEnvelope,
  type HostedStageOutputEnvelope,
} from "./outputEnvelope.js"
import type { HostedInvocationResult, HostedProviderInvokeInput, HostedSession } from "./providerRuntime.js"
import { invokeClaude } from "./providers/claude.js"
import { invokeCodex } from "./providers/codex.js"
import { invokeOpenCode } from "./providers/opencode.js"
import { invokeClaudeSdk } from "./providers/claudeSdk.js"
import { invokeCodexSdk } from "./providers/codexSdk.js"

export type HostedProviderAdapter = {
  invoke(input: HostedProviderInvokeInput): Promise<HostedInvocationResult>
}

/**
 * Dispatch a hosted invocation by `(harness, runtime)`. The two axes are
 * intentionally orthogonal: `harness` is the agent runtime brand
 * (claude/codex/opencode) and `runtime` is the invocation mechanism
 * (cli vs in-process SDK). `opencode:sdk` is rejected at validation time, so
 * it never lands here — we throw if it does to flag the contract violation.
 */
function invokerFor(harness: HostedHarness, runtime: InvocationRuntime): HostedProviderAdapter {
  switch (`${harness}:${runtime}` as const) {
    case "claude:cli":
      return { invoke: invokeClaude }
    case "claude:sdk":
      return { invoke: invokeClaudeSdk }
    case "codex:cli":
      return { invoke: invokeCodex }
    case "codex:sdk":
      return { invoke: invokeCodexSdk }
    case "opencode:cli":
      return { invoke: invokeOpenCode }
    case "opencode:sdk":
      throw new Error("opencode:sdk is not supported — pick a CLI-backed opencode profile or another harness")
    default: {
      const exhaustive: never = `${harness}:${runtime}` as never
      throw new Error(`Unknown harness/runtime combination: ${exhaustive as string}`)
    }
  }
}

export async function invokeHostedCli(
  request: HostedRequest,
  session?: HostedSession | null,
): Promise<HostedInvocationResult> {
  const { harness, runtime } = request.runtime
  const result = await invokerFor(harness, runtime).invoke({
    prompt: request.prompt,
    runtime: request.runtime,
    session,
  })
  const active = getActiveRun()
  if (active) {
    emitEvent({
      type: "log",
      runId: active.runId,
      message: `llm.invocation harness=${harness} runtime=${runtime} session=${result.session.sessionId && session?.sessionId ? "resumed" : "started"} cachedTokens=${result.cacheStats?.cachedInputTokens ?? 0} totalTokens=${result.cacheStats?.totalInputTokens ?? 0}`,
    })
  }
  return result
}

function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim()
  const candidates: string[] = []
  candidates.push(trimmed)
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)
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
      ({ escape, inString } = updateStringState(ch, escape, inString))
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

function updateStringState(ch: string, escape: boolean, inString: boolean): { escape: boolean; inString: boolean } {
  if (escape) return { escape: false, inString }
  if (ch === "\\") return { escape: true, inString }
  if (ch === '"') return { escape: false, inString: false }
  return { escape: false, inString }
}

type HostedAdapterInput = {
  stageId: string
  harness: HostedHarness
  runtime: InvocationRuntime
  provider: string
  model?: string
  workspaceRoot: string
  runtimePolicy: RuntimePolicy
}

/**
 * Invoke the hosted runtime and parse the response as a JSON envelope. If the
 * first invocation returns non-JSON, re-invoke once with a hardening hint
 * appended to the prompt. Session ids are threaded through both turns so
 * provider-native conversation state keeps working.
 */
async function invokeAndParse<Env>(params: {
  request: HostedRequest
  session: HostedSession
  parse: (raw: Record<string, unknown>) => Env
  retryHint: string
}): Promise<{ envelope: Env; session: HostedSession }> {
  const firstResult = await invokeHostedCli(params.request, params.session)
  let session = firstResult.session
  try {
    return { envelope: params.parse(parseJsonObject(firstResult.outputText)), session }
  } catch (err) {
    const retryPrompt = buildRetryPrompt(params.request.prompt, params.retryHint, firstResult.outputText)
    const retryResult = await invokeHostedCli({ ...params.request, prompt: retryPrompt }, session)
    session = retryResult.session
    try {
      return { envelope: params.parse(parseJsonObject(retryResult.outputText)), session }
    } catch {
      throw err
    }
  }
}

function buildRetryPrompt(prompt: string, retryHint: string, previousOutput: string): string {
  return `${prompt}\n\n${retryHint}\n\nPrevious response (for your reference):\n${previousOutput.slice(0, 2000)}`
}

const STAGE_RETRY_HINT =
  "IMPORTANT: your previous response was not valid JSON. You MUST respond with ONLY a single JSON object that matches the output envelope schema — no prose before or after, no markdown, no code fences. Respond with the JSON object now."

const REVIEW_RETRY_HINT =
  "IMPORTANT: your previous response was not valid JSON. You MUST respond with ONLY a single JSON object that matches the review output envelope schema — no prose before or after, no markdown, no code fences. Respond with the JSON object now."

export class HostedStageAdapter<S, A> implements StageAgentAdapter<S, A> {
  private session: HostedSession

  constructor(private readonly input: HostedAdapterInput) {
    this.session = { harness: input.harness, sessionId: null }
  }

  getSessionId(): string | null {
    return this.session.sessionId
  }

  setSessionId(sessionId: string | null): void {
    this.session = { harness: this.input.harness, sessionId }
  }

  async step(request: StageAgentInput<S>) {
    const runtime: HostedRequest["runtime"] = {
      harness: this.input.harness,
      runtime: this.input.runtime,
      provider: this.input.provider,
      model: this.input.model,
      workspaceRoot: this.input.workspaceRoot,
      policy: this.input.runtimePolicy,
    }
    const prompt = buildStagePrompt({
      stageId: this.input.stageId,
      harness: this.input.harness,
      runtime: this.input.runtime,
      model: this.input.model,
      runtimePolicy: this.input.runtimePolicy,
      request,
    })
    const { envelope, session } = await invokeAndParse<HostedStageOutputEnvelope<A>>({
      request: { kind: "stage", runtime, prompt, payload: request },
      session: this.session,
      parse: raw => raw as HostedStageOutputEnvelope<A>,
      retryHint: STAGE_RETRY_HINT,
    })
    this.session = session
    return mapStageEnvelopeToResponse(envelope)
  }
}

export class HostedReviewAdapter<S, A> implements ReviewAgentAdapter<S, A> {
  private session: HostedSession

  constructor(private readonly input: HostedAdapterInput) {
    this.session = { harness: input.harness, sessionId: null }
  }

  getSessionId(): string | null {
    return this.session.sessionId
  }

  setSessionId(sessionId: string | null): void {
    this.session = { harness: this.input.harness, sessionId }
  }

  async review(request?: { artifact: A; state: S; reviewContext?: ReviewContext }) {
    if (!request) throw new Error("Hosted review adapter requires a review payload")
    const runtime: HostedRequest["runtime"] = {
      harness: this.input.harness,
      runtime: this.input.runtime,
      provider: this.input.provider,
      model: this.input.model,
      workspaceRoot: this.input.workspaceRoot,
      policy: this.input.runtimePolicy,
    }
    const prompt = buildReviewPrompt({
      stageId: this.input.stageId,
      harness: this.input.harness,
      runtime: this.input.runtime,
      model: this.input.model,
      runtimePolicy: this.input.runtimePolicy,
      request,
    })
    const { envelope, session } = await invokeAndParse<HostedReviewOutputEnvelope>({
      request: { kind: "review", runtime, prompt, payload: request },
      session: this.session,
      parse: raw => raw as HostedReviewOutputEnvelope,
      retryHint: REVIEW_RETRY_HINT,
    })
    this.session = session
    return mapReviewEnvelopeToResponse(envelope)
  }
}

export { parseJsonObject }
