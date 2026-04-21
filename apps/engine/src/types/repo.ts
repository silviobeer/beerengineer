export type SimulatedBranch = {
  name: string
  base: string
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
