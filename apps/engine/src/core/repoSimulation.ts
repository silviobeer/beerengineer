import { mkdir, readFile, writeFile } from "node:fs/promises"
import type {
  DocumentationArtifact,
  MergeHandoffArtifact,
  SimulatedBranch,
  SimulatedRepoState,
} from "../types.js"
import { layout, type WorkflowContext } from "./workspaceLayout.js"

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

function cloneBranch(branch: SimulatedBranch): SimulatedBranch {
  return {
    ...branch,
    commits: branch.commits.map(commit => ({ ...commit, filesChanged: [...commit.filesChanged] })),
  }
}

function branchNameProject(projectId: string): string {
  return `proj/${projectId.toLowerCase()}`
}

export function branchNameStory(projectId: string, storyId: string): string {
  return `story/${projectId.toLowerCase()}-${storyId.toLowerCase()}`
}

export function branchNameCandidate(context: WorkflowContext, projectId: string): string {
  return `pr/${context.runId.toLowerCase()}-${projectId.toLowerCase()}`
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
    if (!persisted.branches.some(branch => branch.name === "main")) {
      persisted.branches.push({ name: "main", base: "", commits: [], status: "open" })
    }
    return persisted
  }
  return {
    branches: [{ name: "main", base: "", commits: [], status: "open" }],
    mergedRuns: [],
  }
}

async function mutateRepoState<T>(
  context: WorkflowContext,
  mutate: (state: SimulatedRepoState) => T,
): Promise<T> {
  const state = await loadRepoState(context)
  const result = mutate(state)
  await persistRepoState(context, state)
  return result
}

function ensureProjectBranch(state: SimulatedRepoState, projectId: string): SimulatedBranch {
  const name = branchNameProject(projectId)
  const existing = getBranch(state, name)
  if (existing) return existing
  return upsertBranch(state, {
    name,
    base: "main",
    commits: [],
    status: "open",
  })
}

export async function ensureStoryBranch(
  context: WorkflowContext,
  projectId: string,
  storyId: string,
): Promise<SimulatedBranch> {
  return mutateRepoState(context, state => {
    const projectBranch = ensureProjectBranch(state, projectId)
    const name = branchNameStory(projectId, storyId)
    const existing = getBranch(state, name)
    if (existing) return cloneBranch(existing)
    return cloneBranch(
      upsertBranch(state, {
        name,
        base: projectBranch.name,
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

export async function mergeStoryBranchIntoProject(
  context: WorkflowContext,
  projectId: string,
  storyBranchName: string,
  filesChanged: string[],
): Promise<{ storyBranch: SimulatedBranch; projectBranch: SimulatedBranch }> {
  return mutateRepoState(context, state => {
    const storyBranch = requireBranch(state, storyBranchName)
    const projectBranch = ensureProjectBranch(state, projectId)
    projectBranch.commits.push({
      hash: branchHash(`${projectBranch.name}-${storyBranch.name}-merge`),
      message: `Merge ${storyBranch.name} into ${projectBranch.name}`,
      filesChanged,
    })
    storyBranch.status = "merged"
    storyBranch.mergedAt = nowIso()
    return {
      storyBranch: cloneBranch(storyBranch),
      projectBranch: cloneBranch(projectBranch),
    }
  })
}

export async function createCandidateBranch(
  context: WorkflowContext,
  project: { id: string; name: string },
  documentationArtifact: DocumentationArtifact,
): Promise<MergeHandoffArtifact> {
  const candidateBranchName = branchNameCandidate(context, project.id)
  const projectBranchName = branchNameProject(project.id)

  const candidateBranch = await mutateRepoState(context, state => {
    const projectBranch = ensureProjectBranch(state, project.id)
    const candidate = upsertBranch(state, {
      name: candidateBranchName,
      base: "main",
      commits: [
        ...projectBranch.commits.map(commit => ({ ...commit, filesChanged: [...commit.filesChanged] })),
        {
          hash: branchHash(`${candidateBranchName}-docs`),
          message: `Prepare ${candidateBranchName} from ${projectBranchName}`,
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
    readyForUserTest: true,
    readyForMerge: true,
    includes: [
      {
        projectId: project.id,
        runId: context.runId,
        sourceBranch: projectBranchName,
      },
    ],
    mergeChecklist: [
      "Execution passed for all required stories.",
      `Project review status: ${documentationArtifact.mode === "generate" ? "generated" : "updated"} docs prepared.`,
      "QA review completed or explicitly accepted by the user.",
      "Candidate branch is ready for manual user testing before merge to main.",
    ],
    summary: `${candidateBranch.name} is ready for user testing and optional manual merge into main.`,
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
    const main = requireBranch(state, "main")

    if (decision === "merge") {
      main.commits.push({
        hash: branchHash(`main-${candidate.name}-merge`),
        message: `Merge ${candidate.name} into main`,
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
          ? `${candidate.name} was merged into main by the user.`
          : decision === "reject"
            ? `${candidate.name} was rejected by the user and remains out of main.`
            : `${candidate.name} remains open for further testing before merge.`,
    }
  })

  await writeHandoff(context, updated)
  return updated
}
