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
 * Codex SDK adapter — runs the OpenAI Codex agent in-process via
 * `@openai/codex-sdk`. The SDK wraps the same `codex` CLI surface
 * (sandboxed exec, session resume via `~/.codex/sessions`, JSONL events),
 * so behavior parity with `codex.ts` is the design target.
 *
 * Tradeoffs the operator accepts when picking SDK over CLI:
 *   - explicit `OPENAI_API_KEY` instead of `codex login` session
 *   - per-token billing instead of subscription bundling
 *   - in-process tool gating + structured event stream
 *
 * The SDK package is loaded lazily so workspaces using only CLI profiles
 * don't need to install the dep. Auth lives in the env (`OPENAI_API_KEY`)
 * or the SDK's own constructor option.
 */

type SandboxMode = "read-only" | "workspace-write" | "danger-full-access"
type ApprovalMode = "never" | "on-request" | "on-failure" | "untrusted"

type ThreadOptions = {
  model?: string
  sandboxMode?: SandboxMode
  workingDirectory?: string
  skipGitRepoCheck?: boolean
  networkAccessEnabled?: boolean
  approvalPolicy?: ApprovalMode
  additionalDirectories?: string[]
}

type CodexCtor = {
  new (options?: { apiKey?: string; baseUrl?: string }): {
    startThread(options?: ThreadOptions): {
      readonly id: string | null
      runStreamed(input: string): Promise<{ events: AsyncIterable<CodexThreadEvent> }>
    }
    resumeThread(id: string, options?: ThreadOptions): {
      readonly id: string | null
      runStreamed(input: string): Promise<{ events: AsyncIterable<CodexThreadEvent> }>
    }
  }
}

type CodexThreadEvent =
  | { type: "thread.started"; thread_id: string }
  | { type: "turn.started" }
  | {
      type: "turn.completed"
      usage: {
        input_tokens: number
        cached_input_tokens: number
        output_tokens: number
        reasoning_output_tokens: number
      }
    }
  | { type: "turn.failed"; error: { message: string } }
  | { type: "item.started"; item: ThreadItem }
  | { type: "item.updated"; item: ThreadItem }
  | { type: "item.completed"; item: ThreadItem }
  | { type: "error"; message: string }

type ThreadItem =
  | { id: string; type: "agent_message"; text: string }
  | { id: string; type: "reasoning"; text: string }
  | { id: string; type: "command_execution"; command: string; aggregated_output: string; exit_code?: number; status: string }
  | { id: string; type: "file_change"; changes: Array<{ path: string; kind: string }>; status: string }
  | { id: string; type: "mcp_tool_call"; server: string; tool: string; arguments: unknown; status: string; result?: { content: unknown }; error?: { message: string } }
  | { id: string; type: "web_search"; query: string }
  | { id: string; type: "todo_list"; items: Array<{ text: string; completed: boolean }> }
  | { id: string; type: "error"; message: string }

let cachedSdkCtor: CodexCtor | null | undefined

async function loadCodexSdk(): Promise<CodexCtor> {
  if (cachedSdkCtor !== undefined) {
    if (!cachedSdkCtor) throw new Error(SDK_MISSING_MESSAGE)
    return cachedSdkCtor
  }
  try {
    // Dynamic import keeps CLI-only workspaces free of the SDK dependency.
    const mod = (await import("@openai/codex-sdk" as string)) as { Codex: CodexCtor }
    cachedSdkCtor = mod.Codex
    return cachedSdkCtor
  } catch {
    cachedSdkCtor = null
    throw new Error(SDK_MISSING_MESSAGE)
  }
}

const SDK_MISSING_MESSAGE =
  "codex:sdk requires @openai/codex-sdk. Install it (`npm i @openai/codex-sdk`) " +
  "or switch to a codex:cli profile."

function ensureApiKey(): void {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "codex:sdk requires OPENAI_API_KEY in the environment (process env or workspace .env.local).",
    )
  }
}

/**
 * Map engine `RuntimePolicy` to Codex SDK `ThreadOptions`. Mirrors the CLI
 * sandbox/approval flags in `codex.ts`. When the SDK lacks a clean analogue,
 * we pick the stricter setting, never broader.
 */
function policyToThreadOptions(input: HostedProviderInvokeInput): ThreadOptions {
  const opts: ThreadOptions = {
    model: input.runtime.model,
    workingDirectory: input.runtime.workspaceRoot,
    skipGitRepoCheck: true,
  }
  switch (input.runtime.policy.mode) {
    case "no-tools":
    case "safe-readonly":
      opts.sandboxMode = "read-only"
      opts.approvalPolicy = "never"
      break
    case "safe-workspace-write":
      opts.sandboxMode = "workspace-write"
      opts.approvalPolicy = "never"
      break
    case "unsafe-autonomous-write":
      opts.sandboxMode = "danger-full-access"
      opts.approvalPolicy = "never"
      break
  }
  return opts
}

type CollectorState = {
  sessionId: string | null
  finalAgentText: string | null
  fallbackTextParts: string[]
  usage: { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number } | null
  sawCompleted: boolean
}

function emptyState(): CollectorState {
  return {
    sessionId: null,
    finalAgentText: null,
    fallbackTextParts: [],
    usage: null,
    sawCompleted: false,
  }
}

function processEvent(event: CodexThreadEvent, state: CollectorState): void {
  if (event.type === "thread.started") {
    state.sessionId = event.thread_id
  } else if (event.type === "turn.completed") {
    state.sawCompleted = true
    state.usage = event.usage
  } else if (event.type === "turn.failed") {
    throw new Error(`codex:sdk turn failed: ${event.error.message}`)
  } else if (event.type === "error") {
    throw new Error(`codex:sdk error: ${event.message}`)
  } else if (event.type === "item.completed" || event.type === "item.started" || event.type === "item.updated") {
    const item = event.item
    if (event.type === "item.completed" && item.type === "agent_message") {
      // Codex emits the assistant's final text as an `agent_message` item.
      // Capturing the latest one matches the CLI's `--output-last-message`.
      state.finalAgentText = item.text
      state.fallbackTextParts.push(item.text)
    } else if (item.type === "reasoning" && (event.type === "item.started" || event.type === "item.completed")) {
      emitHostedThinking(sanitizePreviewValue(item.text) ?? item.text, "codex")
    } else if (item.type === "command_execution") {
      if (event.type === "item.started") {
        emitHostedToolCalled("Bash", sanitizePreviewValue(item.command), "codex")
      } else if (event.type === "item.completed") {
        emitHostedToolResult(
          "Bash",
          sanitizePreviewValue(item.command),
          sanitizePreviewValue(item.aggregated_output),
          "codex",
          item.status === "failed",
        )
      }
    } else if (item.type === "file_change" && event.type === "item.completed") {
      emitHostedToolResult(
        "Edit",
        sanitizePreviewValue(item.changes.map(c => `${c.kind} ${c.path}`).join(", ")),
        undefined,
        "codex",
        item.status === "failed",
      )
    } else if (item.type === "mcp_tool_call" && event.type === "item.started") {
      emitHostedToolCalled(`${item.server}/${item.tool}`, sanitizePreviewValue(item.arguments), "codex")
    } else if (item.type === "mcp_tool_call" && event.type === "item.completed") {
      emitHostedToolResult(
        `${item.server}/${item.tool}`,
        sanitizePreviewValue(item.arguments),
        sanitizePreviewValue(item.result?.content ?? item.error?.message),
        "codex",
        item.status === "failed",
      )
    }
  }
}

function finalText(state: CollectorState): string {
  if (typeof state.finalAgentText === "string") return state.finalAgentText
  if (state.fallbackTextParts.length > 0) return state.fallbackTextParts.join("")
  return ""
}

export async function invokeCodexSdk(input: HostedProviderInvokeInput): Promise<HostedInvocationResult> {
  ensureApiKey()
  const Codex = await loadCodexSdk()

  // Replay any persisted local history for SDK runtimes — the Codex SDK
  // returns a server-side handle on first turn (`thread_id`), but we still
  // want a deterministic prompt history on the local side as a fallback.
  const replayHistory = readReplayMessages(input.session)
  const promptParts: string[] = []
  for (const msg of replayHistory) promptParts.push(`[${msg.role}] ${msg.text}`)
  promptParts.push(input.prompt)
  const fullPrompt = promptParts.join("\n\n")

  const codex = new Codex({ apiKey: process.env.OPENAI_API_KEY })
  const threadOptions = policyToThreadOptions(input)
  const thread = input.session?.sessionId
    ? codex.resumeThread(input.session.sessionId, threadOptions)
    : codex.startThread(threadOptions)

  const state = emptyState()
  const turn = await thread.runStreamed(fullPrompt)
  for await (const event of turn.events) {
    processEvent(event, state)
  }

  if (!state.sawCompleted && state.finalAgentText === null && state.fallbackTextParts.length === 0) {
    throw new Error("codex:sdk turn ended without a turn.completed event or any agent_message")
  }

  const outputText = finalText(state)
  emitHostedTokens(
    state.usage?.input_tokens ?? 0,
    state.usage?.output_tokens ?? 0,
    state.usage?.cached_input_tokens ?? 0,
    "codex",
    input.runtime.model,
  )

  const baseSession = {
    harness: input.runtime.harness,
    sessionId: state.sessionId ?? thread.id ?? input.session?.sessionId ?? null,
  }
  const updatedHistory: ChatMessage[] = baseSession.sessionId
    ? []
    : appendReplayMessages(input.session, [
        { role: "user", text: input.prompt },
        { role: "assistant", text: outputText },
      ])
  const session = baseSession.sessionId
    ? makeReplaySession(baseSession, [], baseSession.sessionId)
    : makeReplaySession(baseSession, updatedHistory, null)

  return {
    stdout: "",
    stderr: "",
    exitCode: 0,
    command: ["@openai/codex-sdk"],
    outputText,
    session,
    cacheStats: {
      cachedInputTokens: state.usage?.cached_input_tokens ?? 0,
      totalInputTokens: state.usage?.input_tokens ?? 0,
    },
  }
}
