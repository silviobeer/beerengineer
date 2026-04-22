export type SetupStatus = "ok" | "missing" | "misconfigured" | "skipped" | "unknown" | "uninitialized"
export type SetupLevel = "required" | "recommended" | "optional"

export type SetupRemedy = {
  hint: string
  command?: string
  url?: string
}

export type CheckResult = {
  id: string
  label: string
  status: SetupStatus
  version?: string
  detail?: string
  remedy?: SetupRemedy
}

export type GroupResult = {
  id: string
  label: string
  level: SetupLevel
  minOk: number
  idealOk?: number
  passed: number
  satisfied: boolean
  ideal: boolean
  checks: CheckResult[]
}

export type SetupReport = {
  reportVersion: 1
  overall: "ok" | "warning" | "blocked"
  groups: GroupResult[]
  generatedAt: number
}

export type LlmProvider = "anthropic" | "openai" | "opencode"

export type AppConfig = {
  schemaVersion: 1
  dataDir: string
  allowedRoots: string[]
  enginePort: number
  llm: {
    provider: LlmProvider
    model: string
    apiKeyRef: string
    defaultHarnessProfile: import("../types/workspace.js").HarnessProfile
    defaultSonarOrganization?: string
  }
  vcs?: {
    github?: {
      enabled?: boolean
    }
  }
  browser?: {
    enabled?: boolean
  }
}

export type ConfigFileState =
  | { kind: "ok"; path: string; config: AppConfig }
  | { kind: "missing"; path: string }
  | { kind: "invalid"; path: string; error: string }

export type SetupOverrides = {
  configPath?: string
  dataDir?: string
  allowedRoots?: string[]
  enginePort?: number
  llmProvider?: LlmProvider
  llmModel?: string
  llmApiKeyRef?: string
  llmDefaultSonarOrganization?: string
  githubEnabled?: boolean
  browserEnabled?: boolean
}
