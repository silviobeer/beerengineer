import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, rmSync } from "node:fs"
import { resolve } from "node:path"
import type { WorkflowContext } from "./workspaceLayout.js"
import {
  branchNameItem,
  branchNameProject,
  branchNameStory,
  branchNameWave,
} from "./repoSimulation.js"
import { isEngineOwnedBranchName } from "./baseBranch.js"

export type RealGitDisabled = { enabled: false; reason: string }
export type RealGitEnabled = { enabled: true; workspaceRoot: string; baseBranch: string }
export type RealGitMode = RealGitEnabled | RealGitDisabled

type GitResult = { ok: boolean; stdout: string; stderr: string }
type WorktreeEntry = { path: string; branch: string | null }
export type ManagedWorktreeGcResult = {
  removed: string[]
  kept: Array<{ path: string; reason: string }>
}

function runGit(workspaceRoot: string, args: string[]): GitResult {
  const result = spawnSync("git", args, { cwd: workspaceRoot, encoding: "utf8" })
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  }
}

export function detectRealGitMode(context: WorkflowContext): RealGitMode {
  const workspaceRoot = context.workspaceRoot
  if (!workspaceRoot) return { enabled: false, reason: "workspaceRoot not set" }

  const inside = runGit(workspaceRoot, ["rev-parse", "--is-inside-work-tree"])
  if (!inside.ok || inside.stdout !== "true") {
    return { enabled: false, reason: "workspace is not a git repo" }
  }

  const baseBranch = context.baseBranch?.trim()
  if (!baseBranch) return { enabled: false, reason: "base branch could not be resolved" }

  const porcelain = runGit(workspaceRoot, ["status", "--porcelain"])
  if (!porcelain.ok) return { enabled: false, reason: `git status failed: ${porcelain.stderr}` }
  if (porcelain.stdout.length > 0) return { enabled: false, reason: "workspace has uncommitted changes (dirty repo)" }

  return { enabled: true, workspaceRoot, baseBranch }
}

function branchExists(workspaceRoot: string, branch: string): boolean {
  return runGit(workspaceRoot, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).ok
}

function currentBranch(workspaceRoot: string): string {
  return runGit(workspaceRoot, ["branch", "--show-current"]).stdout
}

function listWorktrees(workspaceRoot: string): WorktreeEntry[] {
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

function findWorktreeByPath(workspaceRoot: string, worktreeRoot: string): WorktreeEntry | undefined {
  const expected = resolve(worktreeRoot)
  return listWorktrees(workspaceRoot).find(entry => entry.path === expected)
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
    const hasGitMarker = entries.some(entry => entry.name === ".git")
    if (hasGitMarker) {
      out.push(current)
      continue
    }
    for (const entry of entries) {
      if (entry.isDirectory()) stack.push(resolve(current, entry.name))
    }
  }
  return out.sort()
}

function assertActiveBranch(mode: RealGitEnabled, expected: string, reason: string): void {
  const actual = currentBranch(mode.workspaceRoot)
  if (actual !== expected) {
    throw new Error(`branch_gate: expected ${expected} after ${reason}, but HEAD is ${actual || "<detached>"}`)
  }
}

function ensureBranchFrom(mode: RealGitEnabled, branch: string, from: string): void {
  if (branchExists(mode.workspaceRoot, branch)) {
    if (currentBranch(mode.workspaceRoot) === branch) return
    const co = runGit(mode.workspaceRoot, ["checkout", branch])
    if (!co.ok) throw new Error(`realGit: checkout ${branch} failed: ${co.stderr}`)
    assertActiveBranch(mode, branch, `checking out existing branch ${branch}`)
    return
  }
  if (!branchExists(mode.workspaceRoot, from)) {
    throw new Error(`realGit: cannot branch ${branch} from missing base ${from}`)
  }
  const create = runGit(mode.workspaceRoot, ["checkout", "-b", branch, from])
  if (!create.ok) throw new Error(`realGit: create ${branch} from ${from} failed: ${create.stderr}`)
  assertActiveBranch(mode, branch, `creating branch ${branch} from ${from}`)
}

function ensureBranchExistsFrom(mode: RealGitEnabled, branch: string, from: string): void {
  if (branchExists(mode.workspaceRoot, branch)) return
  if (!branchExists(mode.workspaceRoot, from)) {
    throw new Error(`realGit: cannot branch ${branch} from missing base ${from}`)
  }
  const create = runGit(mode.workspaceRoot, ["branch", branch, from])
  if (!create.ok) throw new Error(`realGit: create ${branch} from ${from} failed: ${create.stderr}`)
}

function mergeNoFf(mode: RealGitEnabled, target: string, source: string, message: string): void {
  const co = runGit(mode.workspaceRoot, ["checkout", target])
  if (!co.ok) throw new Error(`realGit: checkout ${target} for merge failed: ${co.stderr}`)
  assertActiveBranch(mode, target, `checking out merge target ${target}`)
  const head = runGit(mode.workspaceRoot, ["rev-parse", "HEAD"]).stdout
  const sourceHead = runGit(mode.workspaceRoot, ["rev-parse", source]).stdout
  if (head && head === sourceHead) return
  const ancestor = runGit(mode.workspaceRoot, ["merge-base", "--is-ancestor", source, target])
  if (ancestor.ok) return
  const merge = runGit(mode.workspaceRoot, ["merge", "--no-ff", "-m", message, source])
  if (!merge.ok) {
    runGit(mode.workspaceRoot, ["merge", "--abort"])
    throw new Error(`realGit: merge ${source} → ${target} failed: ${merge.stderr || merge.stdout}`)
  }
}

export function ensureItemBranchReal(mode: RealGitEnabled, context: WorkflowContext): string {
  const name = branchNameItem(context)
  // If the item branch does not yet exist, park on base first so the new
  // branch forks from base — not from whatever engine-owned branch a crashed
  // previous run might have left checked out. If the item branch already
  // exists, there is no need to touch base: ensureBranchFrom will just check
  // it out (or no-op if we're already on it).
  if (!branchExists(mode.workspaceRoot, name) && branchExists(mode.workspaceRoot, mode.baseBranch)) {
    const current = currentBranch(mode.workspaceRoot)
    if (current !== mode.baseBranch) {
      const co = runGit(mode.workspaceRoot, ["checkout", mode.baseBranch])
      if (!co.ok) throw new Error(`realGit: could not park on base branch ${mode.baseBranch}: ${co.stderr}`)
      assertActiveBranch(mode, mode.baseBranch, `parking on base branch ${mode.baseBranch}`)
    }
  }
  ensureBranchFrom(mode, name, mode.baseBranch)
  return name
}

export function ensureProjectBranchReal(mode: RealGitEnabled, context: WorkflowContext, projectId: string): string {
  const name = branchNameProject(context, projectId)
  ensureBranchFrom(mode, name, branchNameItem(context))
  return name
}

export function ensureWaveBranchReal(
  mode: RealGitEnabled,
  context: WorkflowContext,
  projectId: string,
  waveNumber: number,
): string {
  const name = branchNameWave(context, projectId, waveNumber)
  ensureBranchFrom(mode, name, branchNameProject(context, projectId))
  return name
}

export function ensureStoryBranchReal(
  mode: RealGitEnabled,
  context: WorkflowContext,
  projectId: string,
  waveNumber: number,
  storyId: string,
): string {
  const name = branchNameStory(context, projectId, waveNumber, storyId)
  ensureBranchFrom(mode, name, branchNameWave(context, projectId, waveNumber))
  return name
}

export function ensureStoryWorktreeReal(
  mode: RealGitEnabled,
  context: WorkflowContext,
  projectId: string,
  waveNumber: number,
  storyId: string,
  worktreeRoot: string,
): string {
  const branch = branchNameStory(context, projectId, waveNumber, storyId)
  ensureBranchExistsFrom(mode, branch, branchNameWave(context, projectId, waveNumber))
  const targetPath = resolve(worktreeRoot)
  const existing = findWorktreeByPath(mode.workspaceRoot, targetPath)
  if (existing?.branch === branch) {
    if (currentBranch(targetPath) !== branch) {
      const co = runGit(targetPath, ["checkout", branch])
      if (!co.ok) {
        throw new Error(`realGit: checkout ${branch} in worktree ${targetPath} failed: ${co.stderr}`)
      }
      const after = currentBranch(targetPath)
      if (after !== branch) {
        throw new Error(`branch_gate: expected worktree ${targetPath} on ${branch}, but HEAD is ${after || "<detached>"}`)
      }
    }
    return targetPath
  }

  if (existing) {
    const remove = runGit(mode.workspaceRoot, ["worktree", "remove", "--force", targetPath])
    if (!remove.ok) throw new Error(`realGit: remove stale worktree ${targetPath} failed: ${remove.stderr}`)
  } else if (existsSync(targetPath)) {
    rmSync(targetPath, { recursive: true, force: true })
  }

  const add = runGit(mode.workspaceRoot, ["worktree", "add", "--force", targetPath, branch])
  if (!add.ok) throw new Error(`realGit: create worktree ${targetPath} for ${branch} failed: ${add.stderr || add.stdout}`)
  const actual = currentBranch(targetPath)
  if (actual !== branch) {
    throw new Error(`branch_gate: expected worktree ${targetPath} on ${branch}, but HEAD is ${actual || "<detached>"}`)
  }
  return targetPath
}

export function mergeStoryIntoWaveReal(
  mode: RealGitEnabled,
  context: WorkflowContext,
  projectId: string,
  waveNumber: number,
  storyId: string,
): void {
  const wave = branchNameWave(context, projectId, waveNumber)
  const story = branchNameStory(context, projectId, waveNumber, storyId)
  mergeNoFf(mode, wave, story, `Merge story ${storyId} into wave ${waveNumber}`)
}

export function mergeWaveIntoProjectReal(
  mode: RealGitEnabled,
  context: WorkflowContext,
  projectId: string,
  waveNumber: number,
): void {
  const project = branchNameProject(context, projectId)
  const wave = branchNameWave(context, projectId, waveNumber)
  mergeNoFf(mode, project, wave, `Merge wave ${waveNumber} into project ${projectId}`)
}

export function mergeProjectIntoItemReal(
  mode: RealGitEnabled,
  context: WorkflowContext,
  projectId: string,
): void {
  const item = branchNameItem(context)
  const project = branchNameProject(context, projectId)
  mergeNoFf(mode, item, project, `Merge project ${projectId} into item`)
}

export function exitRunToItemBranchReal(mode: RealGitEnabled, context: WorkflowContext): string {
  const item = branchNameItem(context)
  if (!branchExists(mode.workspaceRoot, item)) {
    throw new Error(`branch_gate: cannot exit run because item branch ${item} does not exist`)
  }
  const co = runGit(mode.workspaceRoot, ["checkout", item])
  if (!co.ok) throw new Error(`realGit: checkout ${item} on run exit failed: ${co.stderr}`)
  assertActiveBranch(mode, item, `exiting run to item branch ${item}`)
  return item
}

export function abandonStoryBranchReal(
  mode: RealGitEnabled,
  context: WorkflowContext,
  projectId: string,
  waveNumber: number,
  storyId: string,
): { abandonedRef: string } | null {
  const branch = branchNameStory(context, projectId, waveNumber, storyId)
  if (!branchExists(mode.workspaceRoot, branch)) return null
  // Move to a namespaced ref so the branch disappears from `git branch` but
  // remains recoverable. Timestamp prevents collisions on repeat abandons.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const abandonedRef = `refs/beerengineer/abandoned/${branch}/${stamp}`
  const sha = runGit(mode.workspaceRoot, ["rev-parse", `refs/heads/${branch}`])
  if (!sha.ok || !sha.stdout) return null
  // If we're currently on the branch, park on base before deleting it.
  if (currentBranch(mode.workspaceRoot) === branch) {
    if (branchExists(mode.workspaceRoot, mode.baseBranch)) {
      runGit(mode.workspaceRoot, ["checkout", mode.baseBranch])
    }
  }
  const update = runGit(mode.workspaceRoot, ["update-ref", abandonedRef, sha.stdout])
  if (!update.ok) return null
  const del = runGit(mode.workspaceRoot, ["branch", "-D", branch])
  if (!del.ok) {
    // Roll back the namespaced ref if the branch delete failed, so we don't
    // leave duplicates pointing at the same commit.
    runGit(mode.workspaceRoot, ["update-ref", "-d", abandonedRef])
    return null
  }
  return { abandonedRef }
}

// Re-export so callers that only reach for real-git helpers still get a single entry point.
export { isEngineOwnedBranchName }

export function removeStoryWorktreeReal(mode: RealGitEnabled, worktreeRoot: string): void {
  const targetPath = resolve(worktreeRoot)
  const existing = findWorktreeByPath(mode.workspaceRoot, targetPath)
  if (!existing) {
    if (existsSync(targetPath)) rmSync(targetPath, { recursive: true, force: true })
    return
  }
  const remove = runGit(mode.workspaceRoot, ["worktree", "remove", "--force", targetPath])
  if (!remove.ok) throw new Error(`realGit: remove worktree ${targetPath} failed: ${remove.stderr || remove.stdout}`)
}

export function gcManagedStoryWorktreesReal(mode: RealGitEnabled, managedRoot: string): ManagedWorktreeGcResult {
  const managedPaths = collectManagedWorktreePaths(managedRoot)
  const live = new Map(listWorktrees(mode.workspaceRoot).map(entry => [entry.path, entry]))
  const result: ManagedWorktreeGcResult = { removed: [], kept: [] }

  for (const path of managedPaths) {
    const entry = live.get(path)
    if (!entry) {
      rmSync(path, { recursive: true, force: true })
      result.removed.push(path)
      continue
    }
    if (!entry.branch) {
      removeStoryWorktreeReal(mode, path)
      result.removed.push(path)
      continue
    }
    if (branchExists(mode.workspaceRoot, entry.branch)) {
      result.kept.push({ path, reason: `branch ${entry.branch} still exists` })
      continue
    }
    removeStoryWorktreeReal(mode, path)
    result.removed.push(path)
  }

  return result
}
