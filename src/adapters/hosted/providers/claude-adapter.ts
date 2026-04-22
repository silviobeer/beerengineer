import type {
  AnyAdapterRequest
} from "../hosted-cli-adapter.js";
import { HostedCliAdapterBase } from "../hosted-cli-adapter.js";

export class ClaudeCliAdapter extends HostedCliAdapterBase {
  public constructor(repoRoot: string, baseCommand: string[], env: Record<string, string>, timeoutMs: number) {
    super("claude", repoRoot, baseCommand, env, timeoutMs);
  }

  protected buildCommand(input: {
    request: AnyAdapterRequest;
    responsePath: string;
  }): string[] {
    const command = [
      ...this.baseCommand,
      "--print",
      "--output-format",
      "text",
      "--permission-mode",
      "bypassPermissions",
      "--dangerously-skip-permissions",
      "--add-dir",
      input.request.runtime.workspaceRoot
    ];
    if (input.request.runtime.model) {
      command.push("--model", input.request.runtime.model);
    }
    return command;
  }
}
