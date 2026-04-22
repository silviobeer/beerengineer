import type {
  AnyAdapterRequest
} from "../hosted-cli-adapter.js";
import { HostedCliAdapterBase } from "../hosted-cli-adapter.js";

export class CodexCliAdapter extends HostedCliAdapterBase {
  public constructor(repoRoot: string, baseCommand: string[], env: Record<string, string>, timeoutMs: number) {
    super("codex", repoRoot, baseCommand, env, timeoutMs);
  }

  protected buildCommand(input: {
    request: AnyAdapterRequest;
    responsePath: string;
  }): string[] {
    const command = [...this.baseCommand, "exec", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox"];
    if (input.request.runtime.model) {
      command.push("--model", input.request.runtime.model);
    }
    command.push("--cd", input.request.runtime.workspaceRoot, "--output-last-message", input.responsePath, "-");
    return command;
  }
}
