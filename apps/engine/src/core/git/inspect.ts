import { isAbsolute, matchesGlob, relative, resolve } from "node:path"
import { layout, requireItemScopedContext, type WorkflowContext } from "../workspaceLayout.js"
import { emitEvent, getActiveRun } from "../runContext.js"
import { readWorkspaceConfigSync } from "../workspaces/configFile.js"
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
  | { kind: "dirty"; currentBranch: string; trackedCount: number; untrackedCount: number; dirtyPaths: string[] }

type WorkspaceStatusEntry = {
  path: string
  tracked: boolean
}

type WorkspaceStatusSnapshot =
  | { kind: "not-a-repo" }
  | { kind: "git-status-failed"; stderr: string }
  | { kind: "status"; currentBranch: string; entries: WorkspaceStatusEntry[] }

type DirtyMasterRestoreAttempt = {
  paths: string[]
  status: "completed" | "failed"
  error?: string
}

type DirtyMasterGateInspection =
  | ({ kind: "ok"; currentBranch: string; restoreAttempt?: DirtyMasterRestoreAttempt })
  | ({ kind: "dirty"; currentBranch: string; trackedCount: number; untrackedCount: number; dirtyPaths: string[]; restoreAttempt?: DirtyMasterRestoreAttempt })
  | { kind: "not-a-repo" }
  | { kind: "git-status-failed"; stderr: string }
  | { kind: "restore-failed"; currentBranch: string; restoreAttempt: DirtyMasterRestoreAttempt }

export const DEFAULT_DIRTY_MASTER_ALLOWLIST = [".claude/scheduled_tasks.lock"] as const

export function normalizeRepoRelativePath(path: string): string {
  return path
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
}

function normalizeAllowlistPattern(pattern: string): string {
  return normalizeRepoRelativePath(pattern)
}

export function dirtyPathMatchesAllowlist(path: string, patterns: readonly string[]): boolean {
  const normalizedPath = normalizeRepoRelativePath(path)
  if (!normalizedPath) return false
  return patterns.some(pattern => {
    const normalizedPattern = normalizeAllowlistPattern(pattern)
    return normalizedPattern.length > 0 && matchesGlob(normalizedPath, normalizedPattern)
  })
}

export function resolveDirtyMasterAllowlistPatterns(workspaceRoot: string): string[] {
  const configured = readWorkspaceConfigSync(workspaceRoot)?.dirtyMasterAllowlist ?? []
  return [...new Set([...DEFAULT_DIRTY_MASTER_ALLOWLIST, ...configured])]
}

function shouldAutoRestoreAllowlisted(workspaceRoot: string): boolean {
  return readWorkspaceConfigSync(workspaceRoot)?.autoRestoreAllowlisted !== false
}

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

function inspectSnapshot(
  snapshot: Extract<WorkspaceStatusSnapshot, { kind: "status" }>,
  allowlistPatterns: string[] | undefined,
): WorkspaceInspection {
  if (snapshot.entries.length === 0) return { kind: "ok", currentBranch: snapshot.currentBranch }
  const dirtyPaths = snapshot.entries.map(entry => entry.path)
  if (
    (snapshot.currentBranch === "main" || snapshot.currentBranch === "master")
    && dirtyPaths.length > 0
    && allowlistPatterns?.length
    && dirtyPaths.every(path => dirtyPathMatchesAllowlist(path, allowlistPatterns))
  ) {
    return { kind: "ok", currentBranch: snapshot.currentBranch }
  }
  const untrackedCount = snapshot.entries.filter(entry => !entry.tracked).length
  return {
    kind: "dirty",
    currentBranch: snapshot.currentBranch,
    trackedCount: snapshot.entries.length - untrackedCount,
    untrackedCount,
    dirtyPaths,
  }
}

function readWorkspaceStatusSnapshot(
  workspaceRoot: string,
  options: { ignoredPaths?: string[] } = {},
): WorkspaceStatusSnapshot {
  const inside = runGit(workspaceRoot, ["rev-parse", "--is-inside-work-tree"])
  if (!inside.ok || inside.stdout !== "true") return { kind: "not-a-repo" }
  const status = runGit(workspaceRoot, [
    "status",
    "--porcelain",
    "--branch",
    "--untracked-files=all",
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
  const currentBranch = (
    aheadBehindIndex >= 0 ? branchWithoutRemote.slice(0, aheadBehindIndex) : branchWithoutRemote
  ).trim()
  const entries = lines
    .filter(line => !line.startsWith("## "))
    .map(line => {
      const path = normalizeRepoRelativePath(line.slice(3).trim().split(" -> ").at(-1) ?? "")
      if (!path) return null
      return {
        path,
        tracked: !line.startsWith("?? "),
      }
    })
    .filter((entry): entry is WorkspaceStatusEntry => Boolean(entry))
  return { kind: "status", currentBranch, entries }
}

function attachRestoreAttempt(
  inspection: WorkspaceInspection,
  restoreAttempt?: DirtyMasterRestoreAttempt,
): DirtyMasterGateInspection {
  if (inspection.kind === "ok") return restoreAttempt ? { ...inspection, restoreAttempt } : inspection
  if (inspection.kind === "dirty") return restoreAttempt ? { ...inspection, restoreAttempt } : inspection
  return inspection
}

function restoreFailure(currentBranch: string, paths: string[], error: string): DirtyMasterGateInspection {
  return {
    kind: "restore-failed",
    currentBranch,
    restoreAttempt: {
      paths,
      status: "failed",
      error,
    },
  }
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths)]
}

function evaluateDirtyMasterGate(
  workspaceRoot: string,
  options: {
    ignoredPaths?: string[]
    allowlistPatterns?: string[]
    autoRestoreAllowlisted?: boolean
  } = {},
): DirtyMasterGateInspection {
  const initialSnapshot = readWorkspaceStatusSnapshot(workspaceRoot, { ignoredPaths: options.ignoredPaths })
  if (initialSnapshot.kind !== "status") return initialSnapshot

  const initialInspection = inspectSnapshot(initialSnapshot, options.allowlistPatterns)
  if (
    initialSnapshot.currentBranch !== "main"
    && initialSnapshot.currentBranch !== "master"
  ) return initialInspection
  if (!options.allowlistPatterns?.length) return initialInspection
  if (options.autoRestoreAllowlisted === false) return initialInspection

  const restorePaths = uniquePaths(
    initialSnapshot.entries
      .filter(entry => entry.tracked && dirtyPathMatchesAllowlist(entry.path, options.allowlistPatterns ?? []))
      .map(entry => entry.path),
  )
  if (restorePaths.length === 0) return initialInspection

  const restoreResult = runGit(workspaceRoot, [
    "restore",
    "--source=HEAD",
    "--staged",
    "--worktree",
    "--",
    ...restorePaths,
  ])
  if (!restoreResult.ok) {
    return restoreFailure(
      initialSnapshot.currentBranch,
      restorePaths,
      restoreResult.stderr || restoreResult.stdout || "git restore failed",
    )
  }

  const finalSnapshot = readWorkspaceStatusSnapshot(workspaceRoot, { ignoredPaths: options.ignoredPaths })
  if (finalSnapshot.kind !== "status") {
    if (finalSnapshot.kind === "git-status-failed") {
      return restoreFailure(
        initialSnapshot.currentBranch,
        restorePaths,
        `git status after restore failed: ${finalSnapshot.stderr}`,
      )
    }
    return finalSnapshot
  }

  const stillDirtyRestorePaths = restorePaths.filter(path =>
    finalSnapshot.entries.some(entry => entry.path === path),
  )
  if (stillDirtyRestorePaths.length > 0) {
    return restoreFailure(
      finalSnapshot.currentBranch,
      restorePaths,
      `git restore left allowlisted paths dirty: ${stillDirtyRestorePaths.join(", ")}`,
    )
  }

  return attachRestoreAttempt(
    inspectSnapshot(finalSnapshot, options.allowlistPatterns),
    { paths: restorePaths, status: "completed" },
  )
}

function emitRestoreAttempt(inspection: DirtyMasterGateInspection): void {
  if (!("restoreAttempt" in inspection) || !inspection.restoreAttempt) return
  const activeRun = getActiveRun()
  if (!activeRun) return
  emitEvent({
    type: "dirty_master_allowlist_restore",
    runId: activeRun.runId,
    itemId: activeRun.itemId,
    title: activeRun.title ?? activeRun.itemId,
    branch: inspection.currentBranch,
    paths: inspection.restoreAttempt.paths,
    status: inspection.restoreAttempt.status,
    error: inspection.restoreAttempt.error,
  })
}

export function inspectWorkspaceState(
  workspaceRoot: string,
  options: { ignoredPaths?: string[]; allowlistPatterns?: string[] } = {},
): WorkspaceInspection {
  const snapshot = readWorkspaceStatusSnapshot(workspaceRoot, { ignoredPaths: options.ignoredPaths })
  if (snapshot.kind !== "status") return snapshot
  return inspectSnapshot(snapshot, options.allowlistPatterns)
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
  const inspection = evaluateDirtyMasterGate(workspaceRoot, {
    ignoredPaths: context.dirtyCheckIgnoredPaths,
    allowlistPatterns: resolveDirtyMasterAllowlistPatterns(workspaceRoot),
    autoRestoreAllowlisted: shouldAutoRestoreAllowlisted(workspaceRoot),
  })
  emitRestoreAttempt(inspection)
  switch (inspection.kind) {
    case "not-a-repo":
      throw new Error(`git: workspace ${workspaceRoot} is not a git repository`)
    case "git-status-failed":
      throw new Error(`git: git status failed: ${inspection.stderr}`)
    case "restore-failed":
      throw new Error(`git: dirty-master allowlisted restore failed: ${inspection.restoreAttempt.error}`)
    case "dirty":
      throw new Error(
        `git: workspace ${workspaceRoot} has uncommitted changes (dirty repo); commit or stash before starting`,
      )
    case "ok":
      return {
        enabled: true,
        workspaceRoot,
        baseBranch,
        itemWorktreeRoot: layout.itemWorktreeDir(requireItemScopedContext(context)),
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
