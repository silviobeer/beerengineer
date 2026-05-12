import type { HostedInvocationResult, HostedProviderInvokeInput } from "../providerRuntime.js"
import { invokeProviderCli, type ProviderDriver } from "./_invoke.js"
import { emitHostedTokens, makeJsonLineStreamCallback, type StreamEventSummary } from "./_stream.js"

/**
 * OpenCode CLI stream events (NDJSON lines on stdout when `--format json`).
 * opencode 1.14.x event shape: `step_start | text | step_finish | error`
 * carrying their payload in `event.part`. Only fields we consume are typed.
 */
type OpenCodeStreamEvent = {
  type?: string
  sessionID?: string
  part?: {
    text?: string
    tokens?: {
      input?: number
      output?: number
      reasoning?: number
      cache?: { read?: number; write?: number }
    }
  }
  error?: { name?: string; data?: { message?: string } } | string
  message?: string
}

type OpenCodeUsage = { input?: number; output?: number; cacheRead?: number }

type OpenCodeStreamState = {
  sessionId: string | null
  outputParts: string[]
  streamedSummary: boolean
  usage: OpenCodeUsage | null
}

function createOpenCodeStreamState(): OpenCodeStreamState {
  return { sessionId: null, outputParts: [], streamedSummary: false, usage: null }
}

function describeOpencodeError(error: OpenCodeStreamEvent["error"], message: string | undefined): string {
  if (typeof error === "string") return error
  if (error?.data?.message) return error.data.message
  if (error?.name) return error.name
  return message ?? "unknown"
}

function summarizeOpenCodeEvent(event: OpenCodeStreamEvent, state: OpenCodeStreamState): StreamEventSummary | null {
  if (typeof event.sessionID === "string") state.sessionId = event.sessionID
  switch (event.type) {
    case "step_start":
      state.streamedSummary = true
      return { kind: "dim", text: `opencode: step started (${event.sessionID ?? state.sessionId ?? "unknown"})` }
    case "text":
      if (typeof event.part?.text === "string") state.outputParts.push(event.part.text)
      return null
    case "step_finish": {
      state.streamedSummary = true
      const tokens = event.part?.tokens
      if (tokens) {
        state.usage = {
          input: tokens.input ?? 0,
          output: tokens.output ?? 0,
          cacheRead: tokens.cache?.read ?? 0,
        }
      }
      return { kind: "dim", text: "opencode: step completed" }
    }
    case "error":
      state.streamedSummary = true
      return { kind: "step", text: `opencode error: ${describeOpencodeError(event.error, event.message)}` }
    default:
      return null
  }
}

/**
 * Build the opencode CLI command for a single invocation.
 *
 * opencode run [--session <id>] [--model <provider/model>] --format json
 *
 * The prompt is delivered via stdin (opencode reads stdin when no positional
 * message argv is provided). `--format json` switches stdout to NDJSON events.
 * Provider is encoded as the model path prefix (e.g. "openrouter/qwen/qwen3-coder").
 */
function buildOpenCodeCommand(input: HostedProviderInvokeInput): string[] {
  const command = ["opencode", "run"]
  if (input.session?.sessionId) command.push("--session", input.session.sessionId)
  // Compose provider + model into the opencode model specifier when both are set.
  const modelSpec = input.runtime.provider && input.runtime.model
    ? `${input.runtime.provider}/${input.runtime.model}`
    : (input.runtime.model ?? undefined)
  if (modelSpec) command.push("--model", modelSpec)
  command.push("--format", "json")
  return command
}

const openCodeDriver: ProviderDriver<OpenCodeStreamState> = {
  tag: "opencode",
  buildCommand: buildOpenCodeCommand,
  createStreamState: createOpenCodeStreamState,
  streamCallback: state =>
    makeJsonLineStreamCallback<OpenCodeStreamEvent>({
      summarize: event => summarizeOpenCodeEvent(event, state),
    }),
  streamedSummary: state => state.streamedSummary,
  unknownSession: text => /unknown session|session.*not found|invalid session|could not resume/i.test(text),
  async finalize({ input, raw, command, state }) {
    const outputText = state.outputParts.join("") || raw.stdout
    emitHostedTokens(
      state.usage?.input ?? 0,
      state.usage?.output ?? 0,
      state.usage?.cacheRead ?? 0,
      "opencode",
      input.runtime.model,
    )
    return {
      ...raw,
      command,
      outputText,
      session: { harness: input.runtime.harness, sessionId: state.sessionId ?? input.session?.sessionId ?? null },
      cacheStats: {
        cachedInputTokens: state.usage?.cacheRead ?? 0,
        totalInputTokens: state.usage?.input ?? 0,
      },
    }
  },
}

export async function invokeOpenCode(input: HostedProviderInvokeInput): Promise<HostedInvocationResult> {
  return invokeProviderCli(openCodeDriver, input)
}
