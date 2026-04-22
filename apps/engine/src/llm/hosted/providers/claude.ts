import type { RuntimePolicy } from "../../registry.js"

function permissionMode(policy: RuntimePolicy): string | null {
  switch (policy.mode) {
    case "safe-readonly":
      return "default"
    case "safe-workspace-write":
      return "acceptEdits"
    case "unsafe-autonomous-write":
      return "bypassPermissions"
  }
}

export function buildClaudeCommand(input: {
  model?: string
  workspaceRoot: string
  policy: RuntimePolicy
}): string[] {
  const command = ["claude", "--print", "--output-format", "text", "--add-dir", input.workspaceRoot]
  const mode = permissionMode(input.policy)
  if (mode) command.push("--permission-mode", mode)
  if (input.policy.mode === "unsafe-autonomous-write") {
    command.push("--dangerously-skip-permissions")
  }
  if (input.model) command.push("--model", input.model)
  return command
}
