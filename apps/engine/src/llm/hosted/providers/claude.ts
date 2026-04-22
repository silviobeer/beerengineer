import type { RuntimePolicy } from "../../registry.js"

function permissionMode(policy: RuntimePolicy): string | null {
  switch (policy.mode) {
    // Claude Code has no pure read-only permission mode. "plan" refuses file
    // writes and tool calls that mutate the workspace, which is the closest
    // match for reviewer roles.
    case "safe-readonly":
      return "plan"
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
