import { existsSync, readdirSync, rmSync } from "node:fs"
import { basename, resolve } from "node:path"
import type { WorkflowContext } from "../workspaceLayout.js"
import { layout } from "../workspaceLayout.js"
import { branchNameItem, branchNameStory, branchNameWave } from "../branchNames.js"
import {
  type GitMode,
  type ManagedWorktreeGcResult,
  type WorktreeEntry,
  branchExists,
  currentBranch,
  runGit,
} from "./shared.js"

export function listWorktrees(workspaceRoot: string): WorktreeEntry[] {
  const result = runGit(workspaceRoot, ["worktree", "list", "--porcelain"])
  if (!result.ok) return []
  const entries: WorktreeEntry[] = []
  let current: Partial<WorktreeEntry> = {}
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line.trim()) {
      if (current.path) entries.push({ path: current.path, branch: current.branch ?? null })
      current = {}
      continue
    }
    if (line.startsWith("worktree ")) current.path = resolve(line.slice("worktree ".length).trim())
    if (line.startsWith("branch ")) current.branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "")
  }
  if (current.path) entries.push({ path: current.path, branch: current.branch ?? null })
  return entries
}

export function findWorktreeByPath(workspaceRoot: string, worktreeRoot: string): WorktreeEntry | undefined {
  const expected = resolve(worktreeRoot)
  return listWorktrees(workspaceRoot).find(entry => entry.path === expected)
}

function isCanonicalManagedWorktreePath(path: string): boolean {
  return basename(resolve(path, "..")).includes("__")
}

function ensureBranchAt(primary: string, branch: string, from: string): void {
  if (branchExists(primary, branch)) return
  if (!branchExists(primary, from)) {
    throw new Error(`git: cannot branch ${branch} from missing base ${from}`)
  }
  const create = runGit(primary, ["branch", branch, from])
  if (!create.ok) throw new Error(`git: create ${branch} from ${from} failed: ${create.stderr}`)
}

function clearStaleWorktreeTarget(primary: string, targetPath: string, existing: WorktreeEntry | undefined): void {
  if (existing) {
    const remove = runGit(primary, ["worktree", "remove", "--force", targetPath])
    if (!remove.ok) throw new Error(`git: remove stale worktree ${targetPath} failed: ${remove.stderr}`)
    return
  }
  if (existsSync(targetPath)) rmSync(targetPath, { recursive: true, force: true })
}

// git refuses to put a branch in two worktrees, so an orphan worktree from a
// prior failed run holding `branch` would block the add. Prune first, then
// drop any live worktrees still holding this branch.
function reclaimBranchWorktrees(primary: string, branch: string, targetPath: string): void {
  runGit(primary, ["worktree", "prune"])
  for (const entry of listWorktrees(primary)) {
    if (entry.branch !== branch || resolve(entry.path) === resolve(targetPath)) continue
    const remove = runGit(primary, ["worktree", "remove", "--force", entry.path])
    if (!remove.ok) {
      throw new Error(
        `git: cannot reclaim ${branch} from stale worktree ${entry.path}: ${remove.stderr || remove.stdout}`,
      )
    }
  }
}

// Worktree management always operates against the primary checkout
// (mode.workspaceRoot): worktree add/remove is git's view of the repo as a
// whole, and the `from` branch is a ref reachable from any worktree.
function ensureManagedWorktree(mode: GitMode, branch: string, targetPath: string, from: string): string {
  const primary = mode.workspaceRoot
  ensureBranchAt(primary, branch, from)
  const existing = findWorktreeByPath(primary, targetPath)
  if (existing?.branch === branch) {
    if (currentBranch(targetPath) !== branch) {
      const co = runGit(targetPath, ["checkout", branch])
      if (!co.ok) throw new Error(`git: checkout ${branch} in worktree ${targetPath} failed: ${co.stderr}`)
    }
    return targetPath
  }
  clearStaleWorktreeTarget(primary, targetPath, existing)
  reclaimBranchWorktrees(primary, branch, targetPath)
  const add = runGit(primary, ["worktree", "add", "--force", targetPath, branch])
  if (!add.ok) throw new Error(`git: create worktree ${targetPath} for ${branch} failed: ${add.stderr || add.stdout}`)
  const actual = currentBranch(targetPath)
  if (actual !== branch) {
    throw new Error(`branch_gate: expected worktree ${targetPath} on ${branch}, but HEAD is ${actual || "<detached>"}`)
  }
  return targetPath
}

export function ensureItemBranch(mode: GitMode, context: WorkflowContext): string {
  const name = branchNameItem(context)
  ensureManagedWorktree(mode, name, mode.itemWorktreeRoot, mode.baseBranch)
  return name
}

export function ensureStoryWorktree(
  mode: GitMode,
  context: WorkflowContext,
  projectId: string,
  waveNumber: number,
  storyId: string,
  worktreeRoot: string,
): string {
  const branch = branchNameStory(context, projectId, waveNumber, storyId)
  const canonicalPath = resolve(worktreeRoot)
  const legacyPath = resolve(layout.executionStoryLegacyWorktreeDir(context, waveNumber, storyId))
  if (legacyPath !== canonicalPath) {
    const legacy = findWorktreeByPath(mode.workspaceRoot, legacyPath)
    if (legacy?.branch === branch) removeStoryWorktree(mode, legacyPath)
  }
  return ensureManagedWorktree(mode, branch, canonicalPath, branchNameWave(context, projectId, waveNumber))
}

export function removeStoryWorktree(mode: GitMode, worktreeRoot: string): void {
  const targetPath = resolve(worktreeRoot)
  const existing = findWorktreeByPath(mode.workspaceRoot, targetPath)
  if (!existing) {
    if (existsSync(targetPath)) rmSync(targetPath, { recursive: true, force: true })
    return
  }
  const remove = runGit(mode.workspaceRoot, ["worktree", "remove", "--force", targetPath])
  if (!remove.ok) throw new Error(`git: remove worktree ${targetPath} failed: ${remove.stderr || remove.stdout}`)
}

function collectManagedWorktreePaths(root: string): string[] {
  if (!existsSync(root)) return []
  const out: string[] = []
  const stack = [resolve(root)]
  while (stack.length > 0) {
    const current = stack.pop()!
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    if (entries.some(entry => entry.name === ".git")) {
      out.push(current)
      continue
    }
    for (const entry of entries) {
      if (entry.isDirectory()) stack.push(resolve(current, entry.name))
    }
  }
  return out.sort((left, right) => left.localeCompare(right))
}

function collectDuplicates(managedPaths: string[], live: Map<string, WorktreeEntry>): Set<string> {
  const liveManagedByBranch = new Map<string, string[]>()
  for (const path of managedPaths) {
    const entry = live.get(path)
    if (!entry?.branch) continue
    const paths = liveManagedByBranch.get(entry.branch) ?? []
    paths.push(path)
    liveManagedByBranch.set(entry.branch, paths)
  }
  const duplicates = new Set<string>()
  for (const paths of liveManagedByBranch.values()) {
    if (paths.length < 2) continue
    const sorted = [...paths].sort((left, right) => {
      const canonicalDelta =
        Number(isCanonicalManagedWorktreePath(right)) - Number(isCanonicalManagedWorktreePath(left))
      if (canonicalDelta !== 0) return canonicalDelta
      return left.localeCompare(right)
    })
    for (const stale of sorted.slice(1)) duplicates.add(stale)
  }
  return duplicates
}

function processManagedWorktreePath(
  mode: GitMode,
  path: string,
  entry: WorktreeEntry | undefined,
  duplicates: Set<string>,
  result: ManagedWorktreeGcResult,
): void {
  if (duplicates.has(path)) {
    removeStoryWorktree(mode, path)
    result.removed.push(path)
    return
  }
  if (!entry) {
    rmSync(path, { recursive: true, force: true })
    result.removed.push(path)
    return
  }
  if (!entry.branch) {
    removeStoryWorktree(mode, path)
    result.removed.push(path)
    return
  }
  if (branchExists(mode.workspaceRoot, entry.branch)) {
    result.kept.push({ path, reason: `branch ${entry.branch} still exists` })
    return
  }
  removeStoryWorktree(mode, path)
  result.removed.push(path)
}

export function gcManagedStoryWorktrees(mode: GitMode, managedRoot: string): ManagedWorktreeGcResult {
  const managedPaths = collectManagedWorktreePaths(managedRoot)
  const live = new Map(listWorktrees(mode.workspaceRoot).map(entry => [entry.path, entry]))
  const result: ManagedWorktreeGcResult = { removed: [], kept: [] }
  const duplicates = collectDuplicates(managedPaths, live)
  for (const path of managedPaths) {
    processManagedWorktreePath(mode, path, live.get(path), duplicates, result)
  }
  return result
}
