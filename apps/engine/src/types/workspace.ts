export type HarnessRole = "coder" | "reviewer"

export type KnownHarness = "claude" | "codex" | "opencode"

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
}

export type WorkspacePreview = {
  schemaVersion: 1
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
}

export type WorkspaceConfigFile = {
  schemaVersion: 1
  key: string
  name: string
  harnessProfile: HarnessProfile
  sonar: SonarConfig
  createdAt: number
}

export type WorkspaceRow = {
  schemaVersion: 1
  key: string
  name: string
  rootPath: string
  harnessProfile: HarnessProfile
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
      sonarProjectUrl?: string
      sonarMcpSnippet?: string
      ghCreateCommand?: string
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
