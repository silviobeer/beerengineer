import { mkdir, readFile, writeFile } from "node:fs/promises"
import type {
  DocumentationArtifact,
  MergeHandoffArtifact,
  SimulatedBranch,
  SimulatedRepoState,
} from "../types.js"
import { layout, type WorkflowContext } from "./workspaceLayout.js"

const repoStateLocks = new Map<string, Promise<void>>()

function nowIso(): string {
  return new Date().toISOString()
}

function branchHash(seed: string): string {
  const normalized = seed.replace(/[^a-z0-9]+/gi, "").toLowerCase()
  let hash = 0
  for (const char of normalized) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  }
  return `${normalized.slice(0, 8) || "commit"}${hash.toString(36).slice(0, 6)}`
}

function slugify(value: string, fallback = "branch"): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || fallback
}

function cloneBranch(branch: SimulatedBranch): SimulatedBranch {
  return {
    ...branch,
    commits: branch.commits.map(commit => ({ ...commit, filesChanged: [...commit.filesChanged] })),
  }
}

function itemSlugFromContext(context: WorkflowContext): string {
  return slugify(context.itemSlug ?? context.workspaceId.replace(/-[^-]+$/, ""), "item")
}

function baseBranchFromContext(context: WorkflowContext): string {
  return context.baseBranch?.trim() || "main"
}

export function branchNameItem(context: WorkflowContext): string {
  return `item/${itemSlugFromContext(context)}`
}

export function branchNameProject(context: WorkflowContext, projectId: string): string {
  return `proj/${itemSlugFromContext(context)}__${slugify(projectId)}`
}

export function branchNameWave(context: WorkflowContext, projectId: string, waveNumber: number): string {
  return `wave/${itemSlugFromContext(context)}__${slugify(projectId)}__w${waveNumber}`
}

export function branchNameStory(
  context: WorkflowContext,
  projectId: string,
  waveNumber: number,
  storyId: string,
): string {
  return `story/${itemSlugFromContext(context)}__${slugify(projectId)}__w${waveNumber}__${slugify(storyId)}`
}

export function branchNameCandidate(context: WorkflowContext, itemSlug?: string): string {
  return `candidate/${slugify(context.runId)}__${slugify(itemSlug ?? itemSlugFromContext(context))}`
}

async function readRepoState(path: string): Promise<SimulatedRepoState | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as SimulatedRepoState
  } catch {
    return undefined
  }
}

function getBranch(state: SimulatedRepoState, name: string): SimulatedBranch | undefined {
  return state.branches.find(branch => branch.name === name)
}

function requireBranch(state: SimulatedRepoState, name: string): SimulatedBranch {
  const branch = getBranch(state, name)
  if (!branch) throw new Error(`Missing simulated branch: ${name}`)
  return branch
}

function upsertBranch(state: SimulatedRepoState, branch: SimulatedBranch): SimulatedBranch {
  const index = state.branches.findIndex(existing => existing.name === branch.name)
  if (index >= 0) {
    state.branches[index] = branch
  } else {
    state.branches.push(branch)
  }
  return branch
}

async function persistRepoState(context: WorkflowContext, state: SimulatedRepoState): Promise<void> {
  await mkdir(layout.workspaceDir(context.workspaceId), { recursive: true })
  await mkdir(layout.runDir(context), { recursive: true })
  const serialized = `${JSON.stringify(state, null, 2)}\n`
  await writeFile(layout.repoStateWorkspaceFile(context.workspaceId), serialized)
  await writeFile(layout.repoStateRunFile(context), serialized)
}

async function loadRepoState(context: WorkflowContext): Promise<SimulatedRepoState> {
  const persisted = await readRepoState(layout.repoStateWorkspaceFile(context.workspaceId))
  if (persisted) {
    const baseBranch = persisted.baseBranch || baseBranchFromContext(context)
    if (!persisted.branches.some(branch => branch.name === baseBranch)) {
      persisted.branches.push({ name: baseBranch, base: "", kind: "base", commits: [], status: "open" })
    }
    persisted.baseBranch = baseBranch
    return persisted
  }

  const baseBranch = baseBranchFromContext(context)
  return {
    branches: [{ name: baseBranch, base: "", kind: "base", commits: [], status: "open" }],
    mergedRuns: [],
    baseBranch,
  }
}

async function mutateRepoState<T>(
  context: WorkflowContext,
  mutate: (state: SimulatedRepoState) => T,
): Promise<T> {
  const lockKey = layout.repoStateWorkspaceFile(context.workspaceId)
  const previous = repoStateLocks.get(lockKey) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>(resolve => {
    release = resolve
  })
  repoStateLocks.set(lockKey, previous.then(() => current))

  await previous
  try {
    const state = await loadRepoState(context)
    const result = mutate(state)
    await persistRepoState(context, state)
    return result
  } finally {
    release()
    if (repoStateLocks.get(lockKey) === current) {
      repoStateLocks.delete(lockKey)
    }
  }
}

function ensureItemBranch(state: SimulatedRepoState, context: WorkflowContext): SimulatedBranch {
  const name = branchNameItem(context)
  const existing = getBranch(state, name)
  if (existing) {
    state.itemBranch = existing.name
    return existing
  }
  const item = upsertBranch(state, {
    name,
    base: state.baseBranch,
    kind: "item",
    commits: [],
    status: "open",
  })
  state.itemBranch = item.name
  return item
}

function ensureProjectBranch(state: SimulatedRepoState, context: WorkflowContext, projectId: string): SimulatedBranch {
  const itemBranch = ensureItemBranch(state, context)
  const name = branchNameProject(context, projectId)
  const existing = getBranch(state, name)
  if (existing) return existing
  return upsertBranch(state, {
    name,
    base: itemBranch.name,
    kind: "project",
    commits: [],
    status: "open",
  })
}

export async function ensureWaveBranch(
  context: WorkflowContext,
  projectId: string,
  waveNumber: number,
): Promise<SimulatedBranch> {
  return mutateRepoState(context, state => {
    const projectBranch = ensureProjectBranch(state, context, projectId)
    const name = branchNameWave(context, projectId, waveNumber)
    const existing = getBranch(state, name)
    if (existing) return cloneBranch(existing)
    return cloneBranch(
      upsertBranch(state, {
        name,
        base: projectBranch.name,
        kind: "wave",
        commits: [],
        status: "open",
      }),
    )
  })
}

export async function ensureStoryBranch(
  context: WorkflowContext,
  projectId: string,
  waveNumber: number,
  storyId: string,
): Promise<SimulatedBranch> {
  return mutateRepoState(context, state => {
    const projectBranch = ensureProjectBranch(state, context, projectId)
    const waveName = branchNameWave(context, projectId, waveNumber)
    const waveBranch = getBranch(state, waveName)
      ?? upsertBranch(state, {
        name: waveName,
        base: projectBranch.name,
        kind: "wave",
        commits: [],
        status: "open",
      })
    const name = branchNameStory(context, projectId, waveNumber, storyId)
    const existing = getBranch(state, name)
    if (existing) return cloneBranch(existing)
    return cloneBranch(
      upsertBranch(state, {
        name,
        base: waveBranch.name,
        kind: "story",
        commits: [],
        status: "open",
      }),
    )
  })
}

export async function appendBranchCommit(
  context: WorkflowContext,
  branchName: string,
  message: string,
  filesChanged: string[],
): Promise<SimulatedBranch> {
  return mutateRepoState(context, state => {
    const branch = requireBranch(state, branchName)
    branch.commits.push({
      hash: branchHash(`${branchName}-${branch.commits.length + 1}-${message}`),
      message,
      filesChanged,
    })
    branch.status = branch.status === "abandoned" ? "open" : branch.status
    return cloneBranch(branch)
  })
}

export async function abandonBranch(
  context: WorkflowContext,
  branchName: string,
): Promise<SimulatedBranch> {
  return mutateRepoState(context, state => {
    const branch = requireBranch(state, branchName)
    branch.status = "abandoned"
    return cloneBranch(branch)
  })
}

export async function mergeStoryBranchIntoWave(
  context: WorkflowContext,
  projectId: string,
  waveNumber: number,
  storyBranchName: string,
  filesChanged: string[],
): Promise<{ storyBranch: SimulatedBranch; waveBranch: SimulatedBranch }> {
  return mutateRepoState(context, state => {
    const storyBranch = requireBranch(state, storyBranchName)
    const waveBranch = requireBranch(state, branchNameWave(context, projectId, waveNumber))
    if (storyBranch.status === "merged") {
      return {
        storyBranch: cloneBranch(storyBranch),
        waveBranch: cloneBranch(waveBranch),
      }
    }
    waveBranch.commits.push({
      hash: branchHash(`${waveBranch.name}-${storyBranch.name}-merge`),
      message: `Merge ${storyBranch.name} into ${waveBranch.name}`,
      filesChanged,
    })
    storyBranch.status = "merged"
    storyBranch.mergedAt = nowIso()
    return {
      storyBranch: cloneBranch(storyBranch),
      waveBranch: cloneBranch(waveBranch),
    }
  })
}

export async function mergeWaveBranchIntoProject(
  context: WorkflowContext,
  projectId: string,
  waveNumber: number,
): Promise<{ waveBranch: SimulatedBranch; projectBranch: SimulatedBranch }> {
  return mutateRepoState(context, state => {
    const waveBranch = requireBranch(state, branchNameWave(context, projectId, waveNumber))
    const projectBranch = ensureProjectBranch(state, context, projectId)
    if (waveBranch.status === "merged") {
      return {
        waveBranch: cloneBranch(waveBranch),
        projectBranch: cloneBranch(projectBranch),
      }
    }
    projectBranch.commits.push({
      hash: branchHash(`${projectBranch.name}-${waveBranch.name}-merge`),
      message: `Merge ${waveBranch.name} into ${projectBranch.name}`,
      filesChanged: waveBranch.commits.flatMap(commit => commit.filesChanged),
    })
    waveBranch.status = "merged"
    waveBranch.mergedAt = nowIso()
    return {
      waveBranch: cloneBranch(waveBranch),
      projectBranch: cloneBranch(projectBranch),
    }
  })
}

export async function mergeProjectBranchIntoItem(
  context: WorkflowContext,
  projectId: string,
): Promise<{ projectBranch: SimulatedBranch; itemBranch: SimulatedBranch }> {
  return mutateRepoState(context, state => {
    const projectBranch = ensureProjectBranch(state, context, projectId)
    const itemBranch = ensureItemBranch(state, context)
    if (projectBranch.status === "merged") {
      return {
        projectBranch: cloneBranch(projectBranch),
        itemBranch: cloneBranch(itemBranch),
      }
    }
    itemBranch.commits.push({
      hash: branchHash(`${itemBranch.name}-${projectBranch.name}-merge`),
      message: `Merge ${projectBranch.name} into ${itemBranch.name}`,
      filesChanged: projectBranch.commits.flatMap(commit => commit.filesChanged),
    })
    projectBranch.status = "merged"
    projectBranch.mergedAt = nowIso()
    return {
      projectBranch: cloneBranch(projectBranch),
      itemBranch: cloneBranch(itemBranch),
    }
  })
}

export async function createCandidateBranch(
  context: WorkflowContext,
  project: { id: string; name: string },
  documentationArtifact: DocumentationArtifact,
): Promise<MergeHandoffArtifact> {
  const candidateBranchName = branchNameCandidate(context)
  const itemBranchName = branchNameItem(context)
  const mergeTargetBranch = baseBranchFromContext(context)

  const candidateBranch = await mutateRepoState(context, state => {
    const itemBranch = ensureItemBranch(state, context)
    const candidate = upsertBranch(state, {
      name: candidateBranchName,
      base: itemBranch.name,
      kind: "candidate",
      commits: [
        ...itemBranch.commits.map(commit => ({ ...commit, filesChanged: [...commit.filesChanged] })),
        {
          hash: branchHash(`${candidateBranchName}-docs`),
          message: `Prepare ${candidateBranchName} from ${itemBranchName}`,
          filesChanged: [
            "docs/technical-doc.md",
            "docs/features-doc.md",
            "docs/README.compact.md",
            "docs/known-issues.md",
          ],
        },
      ],
      status: "open",
    })
    return cloneBranch(candidate)
  })

  const handoff: MergeHandoffArtifact = {
    project,
    candidateBranch: {
      name: candidateBranch.name,
      base: candidateBranch.base,
      status: candidateBranch.status,
    },
    mergeTargetBranch,
    readyForUserTest: true,
    readyForMerge: true,
    includes: [
      {
        projectId: project.id,
        runId: context.runId,
        sourceBranch: itemBranchName,
      },
    ],
    mergeChecklist: [
      "Execution passed for all required stories.",
      `Project review status: ${documentationArtifact.mode === "generate" ? "generated" : "updated"} docs prepared.`,
      "QA review completed or explicitly accepted by the user.",
      `Candidate branch is ready for manual user testing before merge to ${mergeTargetBranch}.`,
    ],
    summary: `${candidateBranch.name} is ready for user testing and optional manual merge into ${mergeTargetBranch}.`,
  }

  await writeHandoff(context, handoff)
  return handoff
}

async function writeHandoff(context: WorkflowContext, artifact: MergeHandoffArtifact): Promise<void> {
  await mkdir(layout.handoffDir(context), { recursive: true })
  await writeFile(layout.handoffFile(context, artifact.project.id), `${JSON.stringify(artifact, null, 2)}\n`)
}

export async function finalizeCandidateDecision(
  context: WorkflowContext,
  artifact: MergeHandoffArtifact,
  decision: "test" | "merge" | "reject",
): Promise<MergeHandoffArtifact> {
  const updated = await mutateRepoState(context, state => {
    const candidate = requireBranch(state, artifact.candidateBranch.name)
    const target = requireBranch(state, artifact.mergeTargetBranch)

    if (decision === "merge") {
      target.commits.push({
        hash: branchHash(`${target.name}-${candidate.name}-merge`),
        message: `Merge ${candidate.name} into ${target.name}`,
        filesChanged: candidate.commits.flatMap(commit => commit.filesChanged),
      })
      candidate.status = "merged"
      candidate.mergedAt = nowIso()
      if (!state.mergedRuns.includes(context.runId)) {
        state.mergedRuns.push(context.runId)
      }
    }

    if (decision === "reject") {
      candidate.status = "abandoned"
    }

    return {
      ...artifact,
      candidateBranch: {
        ...artifact.candidateBranch,
        status: candidate.status,
      },
      decision,
      summary:
        decision === "merge"
          ? `${candidate.name} was merged into ${target.name} by the user.`
          : decision === "reject"
            ? `${candidate.name} was rejected by the user and remains out of ${target.name}.`
            : `${candidate.name} remains open for further testing before merge into ${target.name}.`,
    }
  })

  await writeHandoff(context, updated)
  return updated
}
