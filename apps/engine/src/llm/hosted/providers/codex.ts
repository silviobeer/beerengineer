import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { emitEvent, getActiveRun } from "../../../core/runContext.js"
import { spawnCommand, type HostedCliExecutionResult, type HostedProviderInvokeInput } from "../providerRuntime.js"

function baseCommand(input: HostedProviderInvokeInput, responsePath: string): string[] {
  const command = ["codex", "exec"]
  if (input.session?.sessionId) {
    command.push("resume", input.session.sessionId)
  }
  command.push("--skip-git-repo-check", "--json")
  if (input.runtime.policy.mode === "safe-readonly") {
    command.push("--sandbox", "read-only")
  } else if (input.runtime.policy.mode === "safe-workspace-write") {
    command.push("--sandbox", "workspace-write")
  } else {
    command.push("--full-auto", "--dangerously-bypass-approvals-and-sandbox")
  }
  if (input.runtime.model) command.push("--model", input.runtime.model)
  command.push("--cd", input.runtime.workspaceRoot, "--output-last-message", responsePath, "-")
  return command
}

function unknownSession(text: string): boolean {
  return /unknown thread|expired thread|resume.*not found|invalid thread/i.test(text)
}

function isTransientFailure(exitCode: number, stdout: string, stderr: string): boolean {
  if (exitCode === 143 || exitCode === 137) return true
  const combined = `${stdout}\n${stderr}`.trim()
  if (exitCode !== 0 && combined.length === 0) return true
  if (/network error|socket hang up|ECONNRESET|ETIMEDOUT|temporary failure/i.test(combined)) return true
  return false
}

const TRANSIENT_RETRY_DELAYS_MS = [2000, 8000]

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
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

type CodexStreamEvent = {
  type?: string
  thread_id?: string
  turn_id?: string
  usage?: { cached_input_tokens?: number; input_tokens?: number; output_tokens?: number }
  item?: { type?: string; name?: string; text?: string }
  delta?: string
  message?: string
}

function summarizeStreamEvent(event: CodexStreamEvent): { kind: "dim" | "step"; text: string } | null {
  switch (event.type) {
    case "thread.started":
      return { kind: "dim", text: `codex: thread started (${event.thread_id ?? "unknown"})` }
    case "turn.started":
      return { kind: "dim", text: `codex: turn started` }
    case "turn.completed": {
      const u = event.usage
      const parts: string[] = []
      if (u?.input_tokens !== undefined) parts.push(`in=${u.input_tokens}`)
      if (u?.output_tokens !== undefined) parts.push(`out=${u.output_tokens}`)
      if (u?.cached_input_tokens !== undefined) parts.push(`cache=${u.cached_input_tokens}`)
      return { kind: "dim", text: `codex: turn completed${parts.length > 0 ? ` (${parts.join(" ")})` : ""}` }
    }
    case "item.started":
    case "item.added":
      if (event.item?.type) return { kind: "dim", text: `codex: ${event.item.type}${event.item.name ? ` ${event.item.name}` : ""}` }
      return null
    case "item.completed":
      if (event.item?.type) return { kind: "dim", text: `codex: ${event.item.type} done` }
      return null
    case "error":
      return { kind: "step", text: `codex error: ${event.message ?? "unknown"}` }
    default:
      return null
  }
}

function streamCallbackFor(): ((line: string) => void) | undefined {
  const active = getActiveRun()
  if (!active) return undefined
  return (line: string) => {
    let event: CodexStreamEvent
    try {
      event = JSON.parse(line) as CodexStreamEvent
    } catch {
      return
    }
    const summary = summarizeStreamEvent(event)
    if (!summary) return
    emitEvent({
      type: "presentation",
      runId: active.runId,
      stageRunId: null,
      kind: summary.kind,
      text: summary.text,
    })
  }
}

export async function invokeCodex(input: HostedProviderInvokeInput, attempt = 0): Promise<HostedCliExecutionResult> {
  const tempDir = await mkdtemp(join(tmpdir(), "beerengineer-codex-"))
  const responsePath = join(tempDir, "last-message.txt")
  const command = baseCommand(input, responsePath)
  try {
    const result = await spawnCommand(command, input.prompt, input.runtime.workspaceRoot, {
      onStdoutLine: streamCallbackFor(),
    })
    const combined = `${result.stdout}\n${result.stderr}`
    if (result.exitCode !== 0) {
      if (input.session?.sessionId && unknownSession(combined)) {
        return invokeCodex({ ...input, session: { provider: input.runtime.provider, sessionId: null } }, attempt)
      }
      if (isTransientFailure(result.exitCode, result.stdout, result.stderr) && attempt < TRANSIENT_RETRY_DELAYS_MS.length) {
        await sleep(TRANSIENT_RETRY_DELAYS_MS[attempt])
        return invokeCodex(input, attempt + 1)
      }
      throw new Error(`${input.runtime.provider} exited with code ${result.exitCode}: ${combined.trim() || "no output"}`)
    }
    const outputText = await readFile(responsePath, "utf8").catch(() => "")
    const usage = parseUsage(result.stdout)
    return {
      ...result,
      command,
      outputText: outputText || result.stdout,
      session: { provider: input.runtime.provider, sessionId: usage.sessionId ?? input.session?.sessionId ?? null },
      cacheStats: {
        cachedInputTokens: usage.cachedInputTokens,
        totalInputTokens: usage.totalInputTokens,
      },
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}
