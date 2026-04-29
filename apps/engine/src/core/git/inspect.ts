import { isAbsolute, relative, resolve } from "node:path"
import type { WorkflowContext } from "../workspaceLayout.js"
import { layout } from "../workspaceLayout.js"
import { type GitMode, currentBranch, itemRoot, runGit } from "./shared.js"

/**
 * Result of inspecting a workspace for run-readiness, expressed as
 * structured data. Single source of truth for both the throwing path
 * ({@link detectGitMode}) and non-throwing CLI preflight, so the two
 * always agree on whether the workspace is runnable.
 */
export type WorkspaceInspection =
  | { kind: "ok"; currentBranch: string }
  | { kind: "not-a-repo" }
  | { kind: "git-status-failed"; stderr: string }
  | { kind: "dirty"; currentBranch: string; trackedCount: number; untrackedCount: number }

function ignoredPathspecs(workspaceRoot: string, ignoredPaths: string[] | undefined): string[] {
  if (!ignoredPaths?.length) return []
  const root = resolve(workspaceRoot)
  return ignoredPaths
    .map(path => {
      const absolute = isAbsolute(path) ? resolve(path) : resolve(root, path)
      const rel = relative(root, absolute)
      if (!rel || rel.startsWith("..")) return null
      return `:(exclude)${rel.replaceAll("\\", "/")}`
    })
    .filter((pathspec): pathspec is string => Boolean(pathspec))
}

export function inspectWorkspaceState(
  workspaceRoot: string,
  options: { ignoredPaths?: string[] } = {},
): WorkspaceInspection {
  const inside = runGit(workspaceRoot, ["rev-parse", "--is-inside-work-tree"])
  if (!inside.ok || inside.stdout !== "true") return { kind: "not-a-repo" }
  const status = runGit(workspaceRoot, [
    "status",
    "--porcelain",
    "--branch",
    "--",
    ".",
    ":(exclude).beerengineer",
    ...ignoredPathspecs(workspaceRoot, options.ignoredPaths),
  ])
  if (!status.ok) return { kind: "git-status-failed", stderr: status.stderr }
  const lines = status.stdout.split(/\r?\n/).filter(Boolean)
  const branchLine = lines.find(line => line.startsWith("## ")) ?? "## unknown"
  const branchName = branchLine.startsWith("## ") ? branchLine.slice(3) : branchLine
  const branchWithoutRemote = branchName.split("...")[0] ?? "unknown"
  const aheadBehindIndex = branchWithoutRemote.indexOf(" [")
  const branch = (aheadBehindIndex >= 0 ? branchWithoutRemote.slice(0, aheadBehindIndex) : branchWithoutRemote).trim()
  const changed = lines.filter(line => !line.startsWith("## "))
  if (changed.length === 0) return { kind: "ok", currentBranch: branch }
  const untrackedCount = changed.filter(line => line.startsWith("?? ")).length
  return {
    kind: "dirty",
    currentBranch: branch,
    trackedCount: changed.length - untrackedCount,
    untrackedCount,
  }
}

export function detectGitMode(context: WorkflowContext): GitMode {
  const workspaceRoot = context.workspaceRoot
  if (!workspaceRoot) {
    throw new Error("git: workspaceRoot is required (simulation mode has been removed)")
  }
  const baseBranch = context.baseBranch?.trim()
  if (!baseBranch) {
    throw new Error("git: base branch could not be resolved (set context.baseBranch)")
  }
  if (!context.itemSlug?.trim()) {
    throw new Error("git: itemSlug is required (item worktree is mandatory)")
  }
  const inspection = inspectWorkspaceState(workspaceRoot, { ignoredPaths: context.dirtyCheckIgnoredPaths })
  switch (inspection.kind) {
    case "not-a-repo":
      throw new Error(`git: workspace ${workspaceRoot} is not a git repository`)
    case "git-status-failed":
      throw new Error(`git: git status failed: ${inspection.stderr}`)
    case "dirty":
      throw new Error(
        `git: workspace ${workspaceRoot} has uncommitted changes (dirty repo); commit or stash before starting`,
      )
    case "ok":
      return {
        enabled: true,
        workspaceRoot,
        baseBranch,
        itemWorktreeRoot: layout.itemWorktreeDir(context),
      }
  }
}

// Guards the invariant that all branch/checkout work happens in the item
// worktree, never in the primary checkout. If the engine ever lands HEAD of
// `mode.workspaceRoot` on something other than `baseBranch`, fail fast —
// silently mutating main is the worst possible failure mode.
export function assertWorkspaceRootOnBaseBranch(mode: GitMode, when: string): void {
  if (resolve(mode.workspaceRoot) === resolve(mode.itemWorktreeRoot)) {
    throw new Error(
      `branch_gate: workspaceRoot and itemWorktreeRoot must differ (${mode.workspaceRoot}) — ${when}`,
    )
  }
  const actual = currentBranch(mode.workspaceRoot)
  if (actual !== mode.baseBranch) {
    throw new Error(
      `branch_gate: primary workspaceRoot was hijacked off ${mode.baseBranch} (now on ${actual || "<detached>"}) — ${when}`,
    )
  }
}

export function assertActiveBranch(mode: GitMode, expected: string, reason: string): void {
  const actual = currentBranch(itemRoot(mode))
  if (actual !== expected) {
    throw new Error(`branch_gate: expected ${expected} after ${reason}, but HEAD is ${actual || "<detached>"}`)
  }
}
