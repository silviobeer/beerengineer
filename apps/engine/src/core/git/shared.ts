import { spawnSync } from "node:child_process"
import type { MergeResolverHarness } from "../mergeResolver.js"

export type GitMergeOptions = {
  mergeResolver?: MergeResolverHarness
  resolverLogDir?: string
  expectedSharedFiles?: string[]
}

export type GitMode = {
  enabled: true
  workspaceRoot: string
  baseBranch: string
  itemWorktreeRoot: string
}

export type GitResult = { ok: boolean; stdout: string; stderr: string }

export type WorktreeEntry = { path: string; branch: string | null }

export type ManagedWorktreeGcResult = {
  removed: string[]
  kept: Array<{ path: string; reason: string }>
}

export function runGit(workspaceRoot: string, args: string[]): GitResult {
  const result = spawnSync("git", args, { cwd: workspaceRoot, encoding: "utf8" })
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  }
}

export function branchExists(workspaceRoot: string, branch: string): boolean {
  return runGit(workspaceRoot, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).ok
}

export function currentBranch(workspaceRoot: string): string {
  return runGit(workspaceRoot, ["branch", "--show-current"]).stdout
}

export function itemRoot(mode: GitMode): string {
  return mode.itemWorktreeRoot
}
