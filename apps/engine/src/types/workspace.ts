export type HarnessRole = "coder" | "reviewer" | "merge-resolver"

export type KnownHarness = "claude" | "codex" | "opencode"

export type RuntimePolicyMode =
  | "safe-readonly"
  | "safe-workspace-write"
  | "unsafe-autonomous-write"

export type WorkspaceRuntimePolicy = {
  stageAuthoring: Extract<RuntimePolicyMode, "safe-readonly" | "safe-workspace-write">
  reviewer: "safe-readonly"
  coderExecution: Extract<RuntimePolicyMode, "safe-workspace-write" | "unsafe-autonomous-write">
}

export const DEFAULT_WORKSPACE_RUNTIME_POLICY: WorkspaceRuntimePolicy = {
  stageAuthoring: "safe-readonly",
  reviewer: "safe-readonly",
  coderExecution: "safe-workspace-write",
}

export type RoleModelRef = {
  provider: string
  model: string
}

export type SelfHarnessRoleRef = RoleModelRef & {
  harness: KnownHarness
}

export type HarnessProfile =
  | { mode: "codex-first" }
  | { mode: "claude-first" }
  | { mode: "codex-only" }
  | { mode: "claude-only" }
  | { mode: "fast" }
  | { mode: "opencode-china" }
  | { mode: "opencode-euro" }
  | {
      mode: "opencode"
      roles: {
        coder: RoleModelRef
        reviewer: RoleModelRef
      }
    }
  | {
      mode: "self"
      roles: {
        coder: SelfHarnessRoleRef
        reviewer: SelfHarnessRoleRef
      }
    }

export type SonarConfig = {
  enabled: boolean
  projectKey?: string
  organization?: string
  hostUrl?: string
  region?: "eu" | "us"
  planTier?: "free" | "team" | "enterprise" | "oss" | "unknown"
  baseBranch?: string
  scanTimeoutMs?: number
  qualityGateName?: string
}

export type WorkspaceReviewPolicy = {
  coderabbit: {
    enabled: boolean
  }
  sonarcloud: SonarConfig
}

export type WorkspacePreview = {
  schemaVersion: 2
  path: string
  exists: boolean
  isDirectory: boolean
  isWritable: boolean
  isGitRepo: boolean
  hasRemote: boolean
  defaultBranch: string | null
  detectedStack: string | null
  existingFiles: string[]
  isRegistered: boolean
  isInsideAllowedRoot: boolean
  isGreenfield: boolean
  hasWorkspaceConfigFile: boolean
  hasSonarProperties: boolean
  conflicts: string[]
}

export type WorkspacePreflightStatus = "ok" | "missing" | "invalid" | "pending-install" | "skipped"

export type WorkspacePreflightCheck = {
  status: WorkspacePreflightStatus
  detail?: string
}

export type WorkspaceGitPreflight = WorkspacePreflightCheck

export type WorkspaceGitHubPreflight = WorkspacePreflightCheck & {
  owner?: string
  repo?: string
  defaultBranch?: string | null
  remoteUrl?: string
}

export type WorkspaceGhPreflight = WorkspacePreflightCheck & {
  user?: string
}

export type WorkspaceSonarPreflight = WorkspacePreflightCheck & {
  tokenSource?: "env" | ".env.local"
  tokenValid?: boolean
}

export type WorkspaceCoderabbitPreflight = WorkspacePreflightCheck

export type WorkspacePreflightReport = {
  git: WorkspaceGitPreflight
  github: WorkspaceGitHubPreflight
  gh: WorkspaceGhPreflight
  sonar: WorkspaceSonarPreflight
  coderabbit: WorkspaceCoderabbitPreflight
  checkedAt: string
}

export type RegisterWorkspaceInput = {
  path: string
  create?: boolean
  name?: string
  key?: string
  harnessProfile: HarnessProfile
  sonar?: SonarConfig
  git?: {
    init?: boolean
    defaultBranch?: string
  }
  github?: {
    create?: boolean
    visibility?: "public" | "private"
    owner?: string
  }
  sonarToken?: {
    value: string
    persist?: boolean
  }
}

export type WorkspaceConfigFile = {
  schemaVersion: 2
  key: string
  name: string
  harnessProfile: HarnessProfile
  runtimePolicy: WorkspaceRuntimePolicy
  sonar: SonarConfig
  reviewPolicy: WorkspaceReviewPolicy
  preflight?: WorkspacePreflightReport
  createdAt: number
}

export type WorkspaceRow = {
  schemaVersion: 2
  key: string
  name: string
  rootPath: string
  harnessProfile: HarnessProfile | null
  harnessProfileInvalid?: string
  sonarEnabled: boolean
  createdAt: number
  lastOpenedAt: number | null
}

export type RegisterErrorCode =
  | "path_outside_allowed_roots"
  | "path_already_registered"
  | "path_not_writable"
  | "path_missing_parent"
  | "path_not_directory"
  | "key_conflict"
  | "profile_references_unavailable_harness"
  | "scaffold_failed"
  | "git_init_failed"
  | "workspace_config_invalid"
  | "unknown"

export type RegisterResult =
  | {
      ok: true
      workspace: WorkspaceRow
      preview: WorkspacePreview
      actions: string[]
      warnings: string[]
      preflight: WorkspacePreflightReport
      sonarProjectUrl?: string
      sonarMcpSnippet?: string
      ghCreateCommand?: string
      coderabbitInstallUrl?: string
    }
  | {
      ok: false
      error: RegisterErrorCode
      detail: string
    }

export type ValidationResult = {
  ok: boolean
  warnings: string[]
  error?: {
    code: Extract<RegisterErrorCode, "profile_references_unavailable_harness">
    detail: string
  }
}
