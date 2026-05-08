import type { HostedInvocationResult, HostedProviderInvokeInput } from "../providerRuntime.js"
import { invokeProviderCli, type ProviderDriver } from "./_invoke.js"
import { emitHostedTokens, makeJsonLineStreamCallback, type StreamEventSummary } from "./_stream.js"

/**
 * OpenCode CLI stream events (NDJSON lines on stdout).
 * Only the fields we consume are typed; extras are ignored.
 */
type OpenCodeStreamEvent = {
  type?: string
  session_id?: string
  message?: string
  text?: string
  error?: string
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
}

type OpenCodeStreamState = {
  sessionId: string | null
  outputParts: string[]
  streamedSummary: boolean
  usage: OpenCodeStreamEvent["usage"] | null
}

function createOpenCodeStreamState(): OpenCodeStreamState {
  return { sessionId: null, outputParts: [], streamedSummary: false, usage: null }
}

function summarizeOpenCodeEvent(event: OpenCodeStreamEvent, state: OpenCodeStreamState): StreamEventSummary | null {
  if (typeof event.session_id === "string") state.sessionId = event.session_id
  if (event.usage) state.usage = event.usage
  switch (event.type) {
    case "session.started":
      state.streamedSummary = true
      return { kind: "dim", text: `opencode: session started (${event.session_id ?? "unknown"})` }
    case "assistant.text":
      if (typeof event.text === "string") state.outputParts.push(event.text)
      return null
    case "assistant.end":
      state.streamedSummary = true
      return { kind: "dim", text: "opencode: turn completed" }
    case "error":
      state.streamedSummary = true
      return { kind: "step", text: `opencode error: ${event.error ?? event.message ?? "unknown"}` }
    default:
      return null
  }
}

/**
 * Build the opencode CLI command for a single invocation.
 *
 * opencode run [--model <provider/model>] [--session <id>] -p <prompt>
 *
 * The prompt is passed via stdin (the `-` sentinel) so large prompts
 * don't hit shell arg-length limits.  Provider is encoded as the model
 * path prefix (e.g. "langdock/openai/gpt-5.5"), consistent with how
 * opencode-china passes "openrouter/qwen/qwen3.5-coder".
 */
function buildOpenCodeCommand(input: HostedProviderInvokeInput): string[] {
  const command = ["opencode", "run"]
  if (input.session?.sessionId) command.push("--session", input.session.sessionId)
  // Compose provider + model into the opencode model specifier when both are set.
  const modelSpec = input.runtime.provider && input.runtime.model
    ? `${input.runtime.provider}/${input.runtime.model}`
    : (input.runtime.model ?? undefined)
  if (modelSpec) command.push("--model", modelSpec)
  // Prompt is delivered via stdin; `-` tells opencode to read stdin.
  command.push("-p", "-")
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
      state.usage?.input_tokens ?? 0,
      state.usage?.output_tokens ?? 0,
      state.usage?.cache_read_input_tokens ?? 0,
      "opencode",
      input.runtime.model,
    )
    return {
      ...raw,
      command,
      outputText,
      session: { harness: input.runtime.harness, sessionId: state.sessionId ?? input.session?.sessionId ?? null },
      cacheStats: {
        cachedInputTokens: state.usage?.cache_read_input_tokens ?? 0,
        totalInputTokens: state.usage?.input_tokens ?? 0,
      },
    }
  },
}

export async function invokeOpenCode(input: HostedProviderInvokeInput): Promise<HostedInvocationResult> {
  return invokeProviderCli(openCodeDriver, input)
}
