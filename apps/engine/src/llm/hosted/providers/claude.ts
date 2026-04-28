import type { HostedInvocationResult, HostedProviderInvokeInput } from "../providerRuntime.js"
import { sanitizePreviewValue } from "../../../core/messagePreview.js"
import { invokeProviderCli, type ProviderDriver } from "./_invoke.js"
import {
  emitHostedThinking,
  emitHostedTokens,
  emitHostedToolCalled,
  emitHostedToolResult,
  makeJsonLineStreamCallback,
  type StreamEventSummary,
} from "./_stream.js"

type ClaudeUsage = {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

type ClaudeAssistantContent =
  | { type?: "text"; text?: string }
  | { type?: "tool_use"; name?: string; id?: string; input?: unknown }
  | { type?: string; text?: string; name?: string }

type ClaudeStreamEvent = {
  type?: string
  subtype?: string
  session_id?: string
  attempt?: number
  max_attempts?: number
  retry_delay_ms?: number
  error?: string
  result?: string
  is_error?: boolean
  usage?: ClaudeUsage
  message?: {
    id?: string
    role?: string
    content?: ClaudeAssistantContent[]
    usage?: ClaudeUsage
  }
  event?: {
    type?: string
    usage?: ClaudeUsage
    delta?: { type?: string; text?: string }
    content_block?: { type?: string }
    index?: number
  }
}

type ClaudeStreamState = {
  sessionId: string | null
  resultText: string | null
  fallbackTextParts: string[]
  textBlockTypes: Map<number, string>
  usage: ClaudeUsage | null
  sawResult: boolean
  streamedSummary: boolean
  completedAssistantMessageIds: Set<string>
  toolCalls: Map<string, { name: string; argsPreview?: string }>
}

function createClaudeStreamState(): ClaudeStreamState {
  return {
    sessionId: null,
    resultText: null,
    fallbackTextParts: [],
    textBlockTypes: new Map(),
    usage: null,
    sawResult: false,
    streamedSummary: false,
    completedAssistantMessageIds: new Set(),
    toolCalls: new Map(),
  }
}

function isToolUseContent(part: ClaudeAssistantContent): part is Extract<ClaudeAssistantContent, { type?: "tool_use"; name?: string }> {
  return part.type === "tool_use"
}

function permissionMode(policy: HostedProviderInvokeInput["runtime"]["policy"]): string | null {
  switch (policy.mode) {
    case "no-tools":
      return null
    case "safe-readonly":
      return "plan"
    case "safe-workspace-write":
      return "acceptEdits"
    case "unsafe-autonomous-write":
      return "bypassPermissions"
  }
}

function buildClaudeCommand(input: HostedProviderInvokeInput): string[] {
  const noTools = input.runtime.policy.mode === "no-tools"
  const command = ["claude", "--print"]
  // Tool-using stages (currently only execution) need stream-json so we can
  // surface intermediate tool-use events live; no-tools stages get a single
  // result blob via --output-format=json which is cheaper to parse and avoids
  // streaming overhead per turn. --verbose is irrelevant for one-shot json.
  if (noTools) {
    command.push("--output-format", "json")
  } else {
    command.push("--verbose", "--output-format", "stream-json", "--add-dir", input.runtime.workspaceRoot)
  }
  const mode = permissionMode(input.runtime.policy)
  if (mode) command.push("--permission-mode", mode)
  if (input.runtime.policy.mode === "unsafe-autonomous-write") command.push("--dangerously-skip-permissions")
  if (process.env.CLAUDE_BARE === "1") command.push("--bare")
  if (input.runtime.model) command.push("--model", input.runtime.model)
  if (input.session?.sessionId) command.push("--resume", input.session.sessionId)
  return command
}

function usageParts(usage?: ClaudeUsage | null): string[] {
  const parts: string[] = []
  if (usage?.input_tokens !== undefined) parts.push(`in=${usage.input_tokens}`)
  if (usage?.output_tokens !== undefined) parts.push(`out=${usage.output_tokens}`)
  if (usage?.cache_read_input_tokens !== undefined) parts.push(`cache=${usage.cache_read_input_tokens}`)
  return parts
}

function summarizeClaudeEvent(event: ClaudeStreamEvent, state: ClaudeStreamState): StreamEventSummary | null {
  if (typeof event.session_id === "string") state.sessionId = event.session_id
  if (event.type === "system") {
    if (event.subtype === "init") {
      state.streamedSummary = true
      return { kind: "dim", text: "claude: session started" }
    }
    if (event.subtype === "api_retry") {
      state.streamedSummary = true
      const attempt = typeof event.attempt === "number" ? event.attempt : "?"
      const maxAttempts = typeof event.max_attempts === "number" ? event.max_attempts : "?"
      const delay = typeof event.retry_delay_ms === "number" ? event.retry_delay_ms : 0
      return { kind: "dim", text: `claude: retrying (${attempt}/${maxAttempts} in ${delay} ms)` }
    }
    return null
  }

  if (event.type === "assistant") {
    const message = event.message
    if (!message) return null
    state.usage = message.usage ?? state.usage
    if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type === "text" && typeof part.text === "string") state.fallbackTextParts.push(part.text)
      }
      const toolUse = message.content.find((part): part is Extract<ClaudeAssistantContent, { type?: "tool_use"; name?: string }> => {
        return isToolUseContent(part) && typeof part.name === "string"
      })
      if (toolUse?.name) {
        const argsPreview = sanitizePreviewValue("input" in toolUse ? toolUse.input : undefined)
        if (toolUse.id) state.toolCalls.set(toolUse.id, { name: toolUse.name, argsPreview })
        emitHostedToolCalled(toolUse.name, argsPreview, "claude")
        state.streamedSummary = true
        return { kind: "dim", text: `claude: tool ${toolUse.name}` }
      }
      const messageId = message.id
      const hasText = message.content.some(part => part.type === "text" && typeof part.text === "string" && part.text.length > 0)
      if (hasText && messageId && !state.completedAssistantMessageIds.has(messageId)) {
        state.completedAssistantMessageIds.add(messageId)
        state.streamedSummary = true
        const parts = usageParts(message.usage)
        const usageSuffix = parts.length > 0 ? ` (${parts.join(" ")})` : ""
        return { kind: "dim", text: `claude: turn completed${usageSuffix}` }
      }
    }
    return null
  }

  if (event.type === "user" && event.message?.content) {
    const toolResult = event.message.content.find(part => part.type === "tool_result") as
      | { type?: string; content?: unknown; is_error?: boolean; tool_use_id?: string }
      | undefined
    if (toolResult) {
      const call = toolResult.tool_use_id ? state.toolCalls.get(toolResult.tool_use_id) : undefined
      emitHostedToolResult(
        call?.name ?? toolResult.tool_use_id ?? "tool",
        call?.argsPreview,
        sanitizePreviewValue(toolResult.content),
        "claude",
        toolResult.is_error === true,
      )
    }
  }

  if (event.type === "stream_event" && event.event) {
    const inner = event.event
    if (inner.type === "message_start") {
      state.streamedSummary = true
      return { kind: "dim", text: "claude: turn started" }
    }
    if (inner.type === "message_stop") {
      state.streamedSummary = true
      return { kind: "dim", text: "claude: turn completed" }
    }
    if (inner.type === "content_block_start" && typeof inner.index === "number") {
      const blockType = inner.content_block?.type
      if (typeof blockType === "string") state.textBlockTypes.set(inner.index, blockType)
      if (blockType === "tool_use") {
        emitHostedToolCalled("tool", undefined, "claude")
        state.streamedSummary = true
        return { kind: "dim", text: "claude: tool" }
      }
      if (blockType === "thinking") {
        emitHostedThinking("thinking", "claude")
      }
    }
    if (inner.type === "message_delta" && inner.usage) state.usage = inner.usage
    if (
      inner.type === "content_block_delta" &&
      typeof inner.index === "number" &&
      state.textBlockTypes.get(inner.index) === "text" &&
      inner.delta?.type === "text_delta" &&
      typeof inner.delta.text === "string"
    ) {
      state.fallbackTextParts.push(inner.delta.text)
    }
    if (
      inner.type === "content_block_delta" &&
      typeof inner.index === "number" &&
      state.textBlockTypes.get(inner.index) === "thinking" &&
      inner.delta?.type === "text_delta" &&
      typeof inner.delta.text === "string"
    ) {
      emitHostedThinking(sanitizePreviewValue(inner.delta.text) ?? inner.delta.text, "claude")
    }
    return null
  }

  if (event.type === "result") {
    state.sawResult = true
    state.resultText = typeof event.result === "string" ? event.result : state.resultText
    state.usage = event.usage ?? state.usage
    state.streamedSummary = true
    const parts = usageParts(event.usage)
    const usageSuffix = parts.length > 0 ? ` (${parts.join(" ")})` : ""
    return {
      kind: event.is_error ? "step" : "dim",
      text: `claude: run completed${usageSuffix}`,
    }
  }

  if (event.type === "error") {
    state.streamedSummary = true
    return { kind: "step", text: `claude error: ${event.error ?? "unknown"}` }
  }

  return null
}

function finalOutputText(state: ClaudeStreamState): string {
  if (typeof state.resultText === "string") return state.resultText
  if (state.fallbackTextParts.length > 0) return state.fallbackTextParts.join("")
  return ""
}

const claudeDriver: ProviderDriver<ClaudeStreamState> = {
  tag: "claude",
  buildCommand: buildClaudeCommand,
  createStreamState: createClaudeStreamState,
  streamCallback: state =>
    makeJsonLineStreamCallback<ClaudeStreamEvent>({
      summarize: event => summarizeClaudeEvent(event, state),
    }),
  streamedSummary: state => state.streamedSummary,
  unknownSession: text => /unknown session|expired session|could not resume|resume.*not found/i.test(text),
  async finalize({ input, raw, command, state }) {
    const outputText = finalOutputText(state)
    if (!state.sawResult && outputText.length === 0) {
      const combined = `${raw.stdout}\n${raw.stderr}`
      throw new Error(`claude stream ended without a result event or recoverable assistant text: ${combined.trim() || "no output"}`)
    }
    emitHostedTokens(
      state.usage?.input_tokens ?? 0,
      state.usage?.output_tokens ?? 0,
      state.usage?.cache_read_input_tokens ?? 0,
      "claude",
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

export async function invokeClaude(input: HostedProviderInvokeInput): Promise<HostedInvocationResult> {
  return invokeProviderCli(claudeDriver, input)
}
