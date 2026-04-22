export type SimulatedBranch = {
  name: string
  base: string
  kind?: "base" | "item" | "project" | "wave" | "story" | "candidate"
  commits: Array<{
    hash: string
    message: string
    filesChanged: string[]
  }>
  status: "open" | "merged" | "abandoned"
  mergedAt?: string
}

export type SimulatedRepoState = {
  branches: SimulatedBranch[]
  mergedRuns: string[]
  baseBranch: string
  itemBranch?: string
}

export type MergeHandoffArtifact = {
  project: {
    id: string
    name: string
  }
  candidateBranch: {
    name: string
    base: string
    status: SimulatedBranch["status"]
  }
  mergeTargetBranch: string
  readyForUserTest: boolean
  readyForMerge: boolean
  includes: Array<{
    projectId: string
    runId: string
    sourceBranch: string
  }>
  mergeChecklist: string[]
  decision?: "test" | "merge" | "reject"
  summary: string
}
