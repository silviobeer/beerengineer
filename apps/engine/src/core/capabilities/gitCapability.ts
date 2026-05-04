import type { RegisterWorkspaceInput } from "../../types/workspace.js"
import { ensureGitRepo } from "../workspaces/shared.js"

export async function ensureWorkspaceGitCapability(
  path: string,
  input: RegisterWorkspaceInput,
  initGit: Parameters<typeof ensureGitRepo>[2],
): Promise<{ ok: boolean; detail?: string; actions: string[] }> {
  return ensureGitRepo(path, input.git?.defaultBranch ?? "main", initGit)
}
