import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sanitizePreviewValue } from "../../../core/messagePreview.js"
import type { HostedInvocationResult, HostedProviderInvokeInput } from "../providerRuntime.js"
import { invokeProviderCli, type ProviderDriver } from "./_invoke.js"
import { emitHostedThinking, emitHostedTokens, emitHostedToolCalled, emitHostedToolResult, makeJsonLineStreamCallback } from "./_stream.js"

type CodexStreamEvent = {
  type?: string
  thread_id?: string
  turn_id?: string
  usage?: { cached_input_tokens?: number; input_tokens?: number; output_tokens?: number }
  item?: { type?: string; name?: string; text?: string }
  delta?: string
  message?: string
}

type CodexStreamState = {
  streamedSummary: boolean
  /** Temp dir allocated for `--output-last-message`. Set by buildCommand; cleaned
   *  up by `afterEach`. Placing it on the stream state lets the driver's
   *  lifecycle hooks see both command args and the temp-dir path. */
  tempDir: string | null
  responsePath: string | null
}

function createCodexStreamState(): CodexStreamState {
  return { streamedSummary: false, tempDir: null, responsePath: null }
}

function summarizeCodexEvent(event: CodexStreamEvent, state: CodexStreamState): { kind: "dim" | "step"; text: string } | null {
  switch (event.type) {
    case "thread.started":
      state.streamedSummary = true
      return { kind: "dim", text: `codex: thread started (${event.thread_id ?? "unknown"})` }
    case "turn.started":
      state.streamedSummary = true
      return { kind: "dim", text: `codex: turn started` }
    case "turn.completed": {
      state.streamedSummary = true
      const u = event.usage
      const parts: string[] = []
      if (u?.input_tokens !== undefined) parts.push(`in=${u.input_tokens}`)
      if (u?.output_tokens !== undefined) parts.push(`out=${u.output_tokens}`)
      if (u?.cached_input_tokens !== undefined) parts.push(`cache=${u.cached_input_tokens}`)
      return { kind: "dim", text: `codex: turn completed${parts.length > 0 ? ` (${parts.join(" ")})` : ""}` }
    }
    case "item.started":
    case "item.added":
      if (event.item?.type) {
        if (event.item.type === "reasoning" && typeof event.item.text === "string") emitHostedThinking(sanitizePreviewValue(event.item.text) ?? event.item.text, "codex")
        else emitHostedToolCalled(event.item.name ?? event.item.type, sanitizePreviewValue(event.item.text), "codex")
        state.streamedSummary = true
        return { kind: "dim", text: `codex: ${event.item.type}${event.item.name ? ` ${event.item.name}` : ""}` }
      }
      return null
    case "item.completed":
      if (event.item?.type) {
        emitHostedToolResult(event.item.name ?? event.item.type, undefined, sanitizePreviewValue(event.item.text), "codex")
        state.streamedSummary = true
        return { kind: "dim", text: `codex: ${event.item.type} done` }
      }
      return null
    case "error":
      state.streamedSummary = true
      return { kind: "step", text: `codex error: ${event.message ?? "unknown"}` }
    default:
      return null
  }
}

function buildCodexCommand(input: HostedProviderInvokeInput, state: CodexStreamState, tempDir: string): string[] {
  state.tempDir = tempDir
  state.responsePath = join(tempDir, "last-message.txt")
  const command = ["codex", "exec"]
  const isResume = !!input.session?.sessionId
  if (isResume) command.push("resume", input.session!.sessionId!)
  command.push("--skip-git-repo-check", "--json")
  // `codex exec resume` does not accept `--sandbox <mode>` — only `--full-auto`
  // and `--dangerously-bypass-approvals-and-sandbox`. Route the safe-readonly /
  // safe-workspace-write modes through `-c sandbox_mode=<mode>` on resume, which
  // both subcommands accept.
  if (input.runtime.policy.mode === "no-tools") {
    // Stage agents + reviewers: emit JSON only, no shell. Pin the sandbox to
    // the strictest mode codex offers so a misbehaving model cannot touch the
    // filesystem either way.
    if (isResume) command.push("-c", 'sandbox_mode="read-only"')
    else command.push("--sandbox", "read-only")
  } else if (input.runtime.policy.mode === "safe-readonly") {
    if (isResume) command.push("-c", 'sandbox_mode="read-only"')
    else command.push("--sandbox", "read-only")
  } else if (input.runtime.policy.mode === "safe-workspace-write") {
    if (isResume) command.push("-c", 'sandbox_mode="workspace-write"')
    else command.push("--sandbox", "workspace-write")
  } else {
    command.push("--full-auto", "--dangerously-bypass-approvals-and-sandbox")
  }
  if (input.runtime.model) command.push("--model", input.runtime.model)
  // `codex exec resume` inherits cwd from the original session and rejects
  // `--cd`; only pass it on fresh exec. no-tools also benefits from setting cwd
  // (it still reads stdin → writes JSON, no shell calls), so keep the default.
  if (!isResume) command.push("--cd", input.runtime.workspaceRoot)
  command.push("--output-last-message", state.responsePath, "-")
  return command
}

function parseUsage(stdout: string): { sessionId: string | null; cachedInputTokens: number; totalInputTokens: number } {
  let sessionId: string | null = null
  let cachedInputTokens = 0
  let totalInputTokens = 0
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const event = JSON.parse(line) as {
        type?: string
        thread_id?: string
        usage?: { cached_input_tokens?: number; input_tokens?: number }
      }
      if (event.type === "thread.started" && typeof event.thread_id === "string") sessionId = event.thread_id
      if (event.type === "turn.completed") {
        cachedInputTokens = event.usage?.cached_input_tokens ?? 0
        totalInputTokens = event.usage?.input_tokens ?? 0
      }
    } catch {
      // Ignore non-JSON noise.
    }
  }
  return { sessionId, cachedInputTokens, totalInputTokens }
}

/**
 * Codex needs a fresh temp dir per-attempt because `--output-last-message`
 * writes to a file path. We pre-allocate it before the driver builds the
 * command and clean it up in `afterEach`.
 */
export async function invokeCodex(input: HostedProviderInvokeInput): Promise<HostedInvocationResult> {
  const tempDir = await mkdtemp(join(tmpdir(), "beerengineer-codex-"))
  const driver: ProviderDriver<CodexStreamState> = {
    tag: "codex",
    createStreamState: createCodexStreamState,
    buildCommand: activeInput => buildCodexCommand(activeInput, state, tempDir),
    streamCallback: ownState =>
      makeJsonLineStreamCallback<CodexStreamEvent>({
        summarize: event => summarizeCodexEvent(event, ownState),
      }),
    streamedSummary: ownState => ownState.streamedSummary,
    unknownSession: text => /unknown thread|expired thread|resume.*not found|invalid thread/i.test(text),
    async finalize({ input: activeInput, raw, command, state: finalState }) {
      const outputText =
        (finalState.responsePath
          ? await readFile(finalState.responsePath, "utf8").catch(() => "")
          : "") || raw.stdout
      const usage = parseUsage(raw.stdout)
      emitHostedTokens(usage.totalInputTokens, 0, usage.cachedInputTokens, "codex", activeInput.runtime.model)
      return {
        ...raw,
        command,
        outputText,
        session: { harness: activeInput.runtime.harness, sessionId: usage.sessionId ?? activeInput.session?.sessionId ?? null },
        cacheStats: {
          cachedInputTokens: usage.cachedInputTokens,
          totalInputTokens: usage.totalInputTokens,
        },
      }
    },
  }
  // `state` is the driver's mutable state. We need a reference accessible
  // from `buildCommand` (called before `createStreamState` returns into the
  // driver) — so we pre-create it and use a closure.
  const state = driver.createStreamState()
  // Override createStreamState to hand back the same pre-allocated state.
  driver.createStreamState = () => state

  try {
    return await invokeProviderCli(driver, input)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}
