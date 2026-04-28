import { runGit } from "./shared.js"

/**
 * Stage every change in `worktreePath` and commit with `message`.
 * Returns the new commit SHA on success, or `null` when the tree is already
 * clean (no-op path — idempotent, safe to call unconditionally).
 */
export function commitAll(worktreePath: string, message: string): string | null {
  const inside = runGit(worktreePath, ["rev-parse", "--is-inside-work-tree"])
  if (!inside.ok || inside.stdout !== "true") return null
  const status = runGit(worktreePath, ["status", "--porcelain"])
  if (!status.ok || !status.stdout) return null
  if (!runGit(worktreePath, ["add", "-A"]).ok) return null
  if (!runGit(worktreePath, ["commit", "-m", message]).ok) return null
  const sha = runGit(worktreePath, ["rev-parse", "HEAD"])
  return sha.ok ? sha.stdout : null
}
