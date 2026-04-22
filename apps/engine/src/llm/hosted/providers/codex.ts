import type { RuntimePolicy } from "../../registry.js"

export function buildCodexCommand(input: {
  model?: string
  workspaceRoot: string
  policy: RuntimePolicy
  responsePath: string
}): string[] {
  const command = ["codex", "exec", "--skip-git-repo-check"]
  if (input.policy.mode === "safe-readonly") {
    command.push("--sandbox", "read-only")
  } else if (input.policy.mode === "safe-workspace-write") {
    command.push("--sandbox", "workspace-write")
  } else {
    command.push("--full-auto", "--dangerously-bypass-approvals-and-sandbox")
  }
  if (input.model) command.push("--model", input.model)
  command.push("--cd", input.workspaceRoot, "--output-last-message", input.responsePath, "-")
  return command
}
