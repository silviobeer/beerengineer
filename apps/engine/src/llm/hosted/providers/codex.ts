import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
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

export async function invokeCodex(input: HostedProviderInvokeInput): Promise<HostedCliExecutionResult> {
  const tempDir = await mkdtemp(join(tmpdir(), "beerengineer-codex-"))
  const responsePath = join(tempDir, "last-message.txt")
  const command = baseCommand(input, responsePath)
  try {
    const result = await spawnCommand(command, input.prompt, input.runtime.workspaceRoot)
    const combined = `${result.stdout}\n${result.stderr}`
    if (result.exitCode !== 0) {
      if (input.session?.sessionId && unknownSession(combined)) {
        return invokeCodex({ ...input, session: { provider: input.runtime.provider, sessionId: null } })
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
