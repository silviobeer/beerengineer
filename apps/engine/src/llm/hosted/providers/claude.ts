import { spawnCommand, type HostedCliExecutionResult, type HostedProviderInvokeInput } from "../providerRuntime.js"

function permissionMode(policy: HostedProviderInvokeInput["runtime"]["policy"]): string | null {
  switch (policy.mode) {
    case "safe-readonly":
      return "plan"
    case "safe-workspace-write":
      return "acceptEdits"
    case "unsafe-autonomous-write":
      return "bypassPermissions"
  }
}

function buildClaudeCommand(input: HostedProviderInvokeInput): string[] {
  const command = ["claude", "--print", "--output-format", "json", "--add-dir", input.runtime.workspaceRoot]
  const mode = permissionMode(input.runtime.policy)
  if (mode) command.push("--permission-mode", mode)
  if (input.runtime.policy.mode === "unsafe-autonomous-write") {
    command.push("--dangerously-skip-permissions")
  }
  if (input.runtime.model) command.push("--model", input.runtime.model)
  if (input.session?.sessionId) command.push("--resume", input.session.sessionId)
  command.push("-p", input.prompt)
  return command
}

function unknownSession(text: string): boolean {
  return /unknown session|expired session|could not resume|resume.*not found/i.test(text)
}

export async function invokeClaude(input: HostedProviderInvokeInput): Promise<HostedCliExecutionResult> {
  const command = buildClaudeCommand(input)
  const result = await spawnCommand(command, null, input.runtime.workspaceRoot)
  const combined = `${result.stdout}\n${result.stderr}`
  if (result.exitCode !== 0) {
    if (input.session?.sessionId && unknownSession(combined)) {
      return invokeClaude({ ...input, session: { provider: input.runtime.provider, sessionId: null } })
    }
    throw new Error(`${input.runtime.provider} exited with code ${result.exitCode}: ${combined.trim() || "no output"}`)
  }
  const parsed = JSON.parse(result.stdout.trim()) as {
    result?: string
    session_id?: string
    usage?: {
      input_tokens?: number
      cache_creation_input_tokens?: number
      cache_read_input_tokens?: number
    }
  }
  return {
    ...result,
    command,
    outputText: parsed.result ?? "",
    session: { provider: input.runtime.provider, sessionId: parsed.session_id ?? input.session?.sessionId ?? null },
    cacheStats: {
      cachedInputTokens: parsed.usage?.cache_read_input_tokens ?? 0,
      totalInputTokens: parsed.usage?.input_tokens ?? 0,
    },
  }
}
