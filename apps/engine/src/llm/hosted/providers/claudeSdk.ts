import type { HostedInvocationResult, HostedProviderInvokeInput } from "../providerRuntime.js"
import type { ChatMessage } from "../../types.js"
import { sanitizePreviewValue } from "../../../core/messagePreview.js"
import {
  emitHostedThinking,
  emitHostedTokens,
  emitHostedToolCalled,
  emitHostedToolResult,
} from "./_stream.js"
import { appendReplayMessages, makeReplaySession, readReplayMessages } from "./_sdkSession.js"

/**
 * Claude SDK adapter — runs the Claude Agent SDK
 * (`@anthropic-ai/claude-agent-sdk`) in-process instead of shelling out to
 * the `claude` CLI.
 *
 * Tradeoffs the operator accepts when picking SDK over CLI:
 *   - API key (ANTHROPIC_API_KEY) instead of `claude login` session
 *   - direct per-token billing instead of subscription bundling
 *   - fewer subprocess spawns, richer event taxonomy
 *
 * Behavior parity targets:
 *   - same JSON envelope on the way out
 *   - same retry / unknown-session recovery shape (handled by the dispatcher)
 *   - permission scope at or below the CLI equivalent for each policy mode
 *   - history replay (via `_sdkSession.ts`) when no server handle is given
 *
 * The SDK package is loaded lazily so that workspaces using only CLI
 * profiles don't need to install the dep — and so the `BEERENGINEER_FORCE_FAKE_LLM=1`
 * test path never imports it.
 */

type ClaudeAgentSdk = {
  query?: (input: {
    prompt: string | AsyncIterable<{ type: string; message: { role: string; content: string } }>
    options?: ClaudeAgentSdkOptions
  }) => AsyncIterable<ClaudeAgentSdkEvent>
}

type ClaudeAgentSdkOptions = {
  model?: string
  cwd?: string
  permissionMode?: "default" | "plan" | "acceptEdits" | "bypassPermissions" | "dontAsk" | "auto"
  /**
   * Required by the SDK when `permissionMode === "bypassPermissions"`. The
   * extra opt-in is a safety measure — without it, the SDK refuses the bypass
   * mode at startup.
   */
  allowDangerouslySkipPermissions?: boolean
  allowedTools?: string[]
  disallowedTools?: string[]
  /**
   * Available built-in tool set. `[]` disables every built-in tool — used for
   * `no-tools` policy stages where we want JSON-only output.
   */
  tools?: string[] | { type: "preset"; preset: "claude_code" }
  resume?: string
  maxTurns?: number
}

type ClaudeAgentSdkEvent = {
  type?: string
  subtype?: "init" | "success" | "error_max_turns" | "error_during_execution" | string
  session_id?: string
  message?: {
    id?: string
    role?: string
    content?: Array<{
      type?: string
      text?: string
      name?: string
      id?: string
      input?: unknown
      content?: unknown
      is_error?: boolean
      tool_use_id?: string
    }>
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
    }
  }
  result?: string
  is_error?: boolean
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_read_input_tokens?: number
  }
  error?: string
}

let cachedSdk: ClaudeAgentSdk | null | undefined

async function loadAgentSdk(): Promise<ClaudeAgentSdk> {
  if (cachedSdk !== undefined) {
    if (!cachedSdk) throw new Error(SDK_MISSING_MESSAGE)
    return cachedSdk
  }
  try {
    // Dynamic import keeps CLI-only workspaces free of the SDK dependency.
    const mod = (await import("@anthropic-ai/claude-agent-sdk" as string)) as ClaudeAgentSdk & {
      default?: ClaudeAgentSdk
    }
    cachedSdk = (mod.default && typeof mod.default.query === "function" ? mod.default : mod) as ClaudeAgentSdk
    return cachedSdk
  } catch {
    cachedSdk = null
    throw new Error(SDK_MISSING_MESSAGE)
  }
}

const SDK_MISSING_MESSAGE =
  "claude:sdk requires @anthropic-ai/claude-agent-sdk. Install it (`npm i @anthropic-ai/claude-agent-sdk`) " +
  "or switch to a claude:cli profile."

function ensureApiKey(): void {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "claude:sdk requires ANTHROPIC_API_KEY in the process environment. " +
        "Workspace .env.local discovery is not yet implemented — export the variable before invoking the engine.",
    )
  }
}

/**
 * Map engine `RuntimePolicy` modes to Claude Agent SDK options. The mapping
 * deliberately mirrors the CLI equivalents in `claude.ts`; when the SDK lacks
 * an exact analogue we choose the stricter option, never broader.
 *
 * | policy mode               | CLI flag (today)                    | Agent SDK setting                 |
 * | ------------------------- | ----------------------------------- | --------------------------------- |
 * | no-tools                  | (none)                              | disallow all tools                |
 * | safe-readonly             | --permission-mode plan              | permission "plan", read-only tools|
 * | safe-workspace-write      | --permission-mode acceptEdits       | permission "acceptEdits"          |
 * | unsafe-autonomous-write   | --dangerously-skip-permissions      | permission "bypassPermissions"    |
 */
function policyToSdkOptions(input: HostedProviderInvokeInput): ClaudeAgentSdkOptions {
  const opts: ClaudeAgentSdkOptions = {
    model: input.runtime.model,
    cwd: input.runtime.workspaceRoot,
  }
  switch (input.runtime.policy.mode) {
    case "no-tools":
      // `tools: []` disables the entire built-in tool set; we still emit
      // `disallowedTools` defensively in case the SDK contract changes.
      opts.tools = []
      opts.disallowedTools = ["*"]
      break
    case "safe-readonly":
      opts.permissionMode = "plan"
      opts.allowedTools = ["Read", "Grep", "Glob"]
      break
    case "safe-workspace-write":
      opts.permissionMode = "acceptEdits"
      break
    case "unsafe-autonomous-write":
      opts.permissionMode = "bypassPermissions"
      // Required by the SDK alongside `bypassPermissions` — see Options docs.
      opts.allowDangerouslySkipPermissions = true
      break
  }
  if (input.session?.sessionId) opts.resume = input.session.sessionId
  return opts
}

type CollectorState = {
  sessionId: string | null
  resultText: string | null
  fallbackTextParts: string[]
  usage: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number } | null
  toolCalls: Map<string, { name: string; argsPreview?: string }>
  sawResult: boolean
}

function emptyState(): CollectorState {
  return {
    sessionId: null,
    resultText: null,
    fallbackTextParts: [],
    usage: null,
    toolCalls: new Map(),
    sawResult: false,
  }
}

function processEvent(event: ClaudeAgentSdkEvent, state: CollectorState): void {
  if (typeof event.session_id === "string") state.sessionId = event.session_id

  if (event.type === "assistant" && event.message?.content) {
    state.usage = event.message.usage ?? state.usage
    for (const part of event.message.content) {
      if (part.type === "text" && typeof part.text === "string") {
        state.fallbackTextParts.push(part.text)
      } else if (part.type === "tool_use" && typeof part.name === "string") {
        const argsPreview = sanitizePreviewValue(part.input)
        if (part.id) state.toolCalls.set(part.id, { name: part.name, argsPreview })
        emitHostedToolCalled(part.name, argsPreview, "claude")
      } else if (part.type === "thinking" && typeof part.text === "string") {
        emitHostedThinking(sanitizePreviewValue(part.text) ?? part.text, "claude")
      }
    }
  } else if (event.type === "user" && event.message?.content) {
    for (const part of event.message.content) {
      if (part.type === "tool_result") {
        const call = part.tool_use_id ? state.toolCalls.get(part.tool_use_id) : undefined
        emitHostedToolResult(
          call?.name ?? part.tool_use_id ?? "tool",
          call?.argsPreview,
          sanitizePreviewValue(part.content),
          "claude",
          part.is_error === true,
        )
      }
    }
  } else if (event.type === "result") {
    state.sawResult = true
    if (typeof event.result === "string") state.resultText = event.result
    state.usage = event.usage ?? state.usage
    // The SDK splits `result` events into success and error subtypes; both
    // carry `is_error`. Treat error results as fatal so the engine surfaces
    // a clear failure instead of swallowing the empty payload.
    if (event.is_error === true) {
      throw new Error(`claude:sdk result reported an error (subtype=${event.subtype ?? "?"})`)
    }
  } else if (event.type === "error") {
    throw new Error(`claude:sdk error: ${event.error ?? "unknown"}`)
  }
}

function finalText(state: CollectorState): string {
  if (typeof state.resultText === "string") return state.resultText
  if (state.fallbackTextParts.length > 0) return state.fallbackTextParts.join("")
  return ""
}

export async function invokeClaudeSdk(input: HostedProviderInvokeInput): Promise<HostedInvocationResult> {
  ensureApiKey()
  const sdk = await loadAgentSdk()
  if (!sdk.query) throw new Error(SDK_MISSING_MESSAGE)

  const replayHistory = readReplayMessages(input.session)
  // When no server handle is available, prepend the persisted history as
  // assistant/user messages on top of the new prompt so the model sees the
  // full transcript. The stage payload still carries authoritative context.
  const promptParts: string[] = []
  for (const msg of replayHistory) {
    promptParts.push(`[${msg.role}] ${msg.text}`)
  }
  promptParts.push(input.prompt)
  const fullPrompt = promptParts.join("\n\n")

  const state = emptyState()
  const events = sdk.query({ prompt: fullPrompt, options: policyToSdkOptions(input) })
  for await (const event of events) {
    processEvent(event, state)
  }

  const outputText = finalText(state)
  if (!state.sawResult && outputText.length === 0) {
    throw new Error("claude:sdk stream ended without a result event or recoverable assistant text")
  }

  emitHostedTokens(
    state.usage?.input_tokens ?? 0,
    state.usage?.output_tokens ?? 0,
    state.usage?.cache_read_input_tokens ?? 0,
    "claude",
    input.runtime.model,
  )

  // If the SDK didn't return a server-side session handle, persist the
  // message exchange locally for the next step's replay.
  const baseSession = { harness: input.runtime.harness, sessionId: state.sessionId ?? input.session?.sessionId ?? null }
  const updatedHistory: ChatMessage[] = state.sessionId
    ? []
    : appendReplayMessages(input.session, [
        { role: "user", text: input.prompt },
        { role: "assistant", text: outputText },
      ])
  const session = state.sessionId
    ? makeReplaySession(baseSession, [], state.sessionId)
    : makeReplaySession(baseSession, updatedHistory, baseSession.sessionId)

  return {
    stdout: "",
    stderr: "",
    exitCode: 0,
    command: ["@anthropic-ai/claude-agent-sdk"],
    outputText,
    session,
    cacheStats: {
      cachedInputTokens: state.usage?.cache_read_input_tokens ?? 0,
      totalInputTokens: state.usage?.input_tokens ?? 0,
    },
  }
}
