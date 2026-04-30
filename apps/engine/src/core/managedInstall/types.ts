export type ManagedInstallDownloadMetadata = {
  tarballUrl: string
  host: string
  protocol: "https:"
}

export type ManagedInstallReleaseTarget = {
  repo: string
  tag: string
  version: string
  tarballUrl: string
  htmlUrl: string
  publishedAt: string | null
  download: ManagedInstallDownloadMetadata
}

export type ManagedInstallPhaseName =
  | "prerequisites"
  | "download"
  | "install"
  | "setup"
  | "engineStart"
  | "uiStart"

export type ManagedInstallPhaseStatus = "ok" | "warning" | "failed"

export type ManagedInstallPhase = {
  name: ManagedInstallPhaseName
  status: ManagedInstallPhaseStatus
  message: string
  fixHint?: string
  durationMs: number
}

export type ManagedInstallSummaryStatus = "succeeded" | "succeeded-with-warning" | "failed"

export type ManagedInstallSummary = {
  status: ManagedInstallSummaryStatus
  wrapperPath?: string
  engineUrl?: string
  uiUrl?: string
  nextCommands: string[]
  pathInstructions: string[]
  warnings: string[]
}

export type ManagedInstallResult = {
  version: number
  operationId: string
  target?: ManagedInstallReleaseTarget
  phases: ManagedInstallPhase[]
  summary: ManagedInstallSummary
  exitCode: number
  error?: {
    message: string
  }
}
