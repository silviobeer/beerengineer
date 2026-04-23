import { spawnSync } from "node:child_process"
import type { WorkflowContext } from "./workspaceLayout.js"
import {
  branchNameItem,
  branchNameProject,
  branchNameStory,
  branchNameWave,
} from "./repoSimulation.js"

export type RealGitDisabled = { enabled: false; reason: string }
export type RealGitEnabled = { enabled: true; workspaceRoot: string; baseBranch: string }
export type RealGitMode = RealGitEnabled | RealGitDisabled

type GitResult = { ok: boolean; stdout: string; stderr: string }

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

function ensureBranchFrom(mode: RealGitEnabled, branch: string, from: string): void {
  if (branchExists(mode.workspaceRoot, branch)) {
    const co = runGit(mode.workspaceRoot, ["checkout", branch])
    if (!co.ok) throw new Error(`realGit: checkout ${branch} failed: ${co.stderr}`)
    return
  }
  if (!branchExists(mode.workspaceRoot, from)) {
    throw new Error(`realGit: cannot branch ${branch} from missing base ${from}`)
  }
  const create = runGit(mode.workspaceRoot, ["checkout", "-b", branch, from])
  if (!create.ok) throw new Error(`realGit: create ${branch} from ${from} failed: ${create.stderr}`)
}

function mergeNoFf(mode: RealGitEnabled, target: string, source: string, message: string): void {
  const co = runGit(mode.workspaceRoot, ["checkout", target])
  if (!co.ok) throw new Error(`realGit: checkout ${target} for merge failed: ${co.stderr}`)
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
  // Defensive: if a previous run crashed mid-execution, HEAD may still be on a
  // story/wave/proj/item branch. Park on the base branch before creating or
  // reusing the item branch so subsequent `ensureBranchFrom` calls start from
  // an authoritative ref.
  if (branchExists(mode.workspaceRoot, mode.baseBranch)) {
    const co = runGit(mode.workspaceRoot, ["checkout", mode.baseBranch])
    if (!co.ok) throw new Error(`realGit: could not park on base branch ${mode.baseBranch}: ${co.stderr}`)
  }
  const name = branchNameItem(context)
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
