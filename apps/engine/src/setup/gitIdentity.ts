import { existsSync } from "node:fs"
import { spawnSync, type SpawnSyncReturns } from "node:child_process"
import type { AppConfig, CheckResult } from "./types.js"

export const GIT_IDENTITY_ERROR_CODES = [
  "git_not_installed",
  "identity_missing",
  "identity_invalid",
  "workspace_not_found",
  "workspace_not_git_repo",
  "workspace_path_unavailable",
  "repair_partial_failure",
  "commit_signing_blocked",
] as const

export type GitIdentityErrorCode = (typeof GIT_IDENTITY_ERROR_CODES)[number]

export type GitIdentityInput = {
  displayName?: unknown
  email?: unknown
}

export type GitIdentityDefault = {
  displayName: string
  email: string
  localOnly: boolean
}

export type GitIdentityEmailKind = "regular" | "local-placeholder" | "github-noreply"

export type ValidatedGitIdentity = GitIdentityDefault & {
  emailKind: GitIdentityEmailKind
}

export type GitIdentityValidationResult =
  | { ok: true; identity: ValidatedGitIdentity }
  | {
      ok: false
      error: "identity_invalid"
      errors: Array<{ field: "displayName" | "email"; message: string }>
    }

export type GitIdentitySource = "repo-local" | "global" | "app-default"

export type GitIdentityValue = {
  name?: string
  email?: string
}

export type EffectiveGitIdentity = Required<GitIdentityValue> & {
  source: GitIdentitySource
  localOnly?: boolean
}

export type GitIdentityBlocker = {
  error: Extract<GitIdentityErrorCode, "git_not_installed" | "identity_missing" | "workspace_not_git_repo" | "workspace_path_unavailable">
  message: string
}

export type GitCommandOptions = {
  gitBin?: string
  env?: NodeJS.ProcessEnv
}

export type GlobalGitReadiness = {
  mode: "global"
  git: {
    installed: boolean
    version?: string
  }
  globalIdentity: GitIdentityValue
  appDefaultIdentity?: GitIdentityDefault
  effectiveIdentity?: EffectiveGitIdentity
  setupBlocked: boolean
  workflowBlocked: boolean
  availableActions: Array<"save_app_default">
  blocker?: GitIdentityBlocker
}

export type WorkspaceGitReadiness = {
  mode: "workspace"
  workspace: {
    id: string
    key?: string
  }
  git: GlobalGitReadiness["git"]
  isGitRepo: boolean
  repoLocalIdentity: GitIdentityValue
  globalIdentity: GitIdentityValue
  appDefaultIdentity?: GitIdentityDefault
  effectiveIdentity?: EffectiveGitIdentity
  ready: boolean
  setupBlocked: boolean
  workflowBlocked: boolean
  availableActions: Array<"repair_workspace_identity">
  blocker?: GitIdentityBlocker
}

export type WorkspaceGitReadinessTarget = {
  id: string
  key?: string
  rootPath?: string | null
}

export type WorkspaceGitRepairResult =
  | {
      ok: true
      actions: string[]
      readiness: WorkspaceGitReadiness
    }
  | {
      ok: false
      error: Extract<GitIdentityErrorCode, "identity_invalid" | "git_not_installed" | "workspace_not_git_repo" | "workspace_path_unavailable" | "repair_partial_failure">
      message: string
      validation?: Extract<GitIdentityValidationResult, { ok: false }>
      actions: string[]
      readiness?: WorkspaceGitReadiness
    }

const BASIC_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const GITHUB_NOREPLY_RE = /^(?:[0-9]+\+)?[A-Za-z0-9-]+@users\.noreply\.github\.com$/i

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export function classifyGitIdentityEmail(email: string): GitIdentityEmailKind {
  const normalized = email.trim().toLowerCase()
  if (normalized.endsWith("@local.beerengineer")) return "local-placeholder"
  if (GITHUB_NOREPLY_RE.test(normalized)) return "github-noreply"
  return "regular"
}

export function validateGitIdentityInput(input: GitIdentityInput): GitIdentityValidationResult {
  const displayName = normalizeString(input.displayName)
  const email = normalizeString(input.email)
  const errors: Array<{ field: "displayName" | "email"; message: string }> = []
  if (!displayName) errors.push({ field: "displayName", message: "Display name is required." })
  if (!email || !BASIC_EMAIL_RE.test(email)) errors.push({ field: "email", message: "Email must look like name@example.com." })
  if (errors.length > 0) return { ok: false, error: "identity_invalid", errors }

  const emailKind = classifyGitIdentityEmail(email)
  return {
    ok: true,
    identity: {
      displayName,
      email,
      localOnly: emailKind === "local-placeholder",
      emailKind,
    },
  }
}

export function normalizeGitIdentityDefault(input: GitIdentityInput): GitIdentityValidationResult {
  return validateGitIdentityInput(input)
}

function gitBin(options: GitCommandOptions): string {
  return options.gitBin ?? "git"
}

function gitEnv(options: GitCommandOptions): NodeJS.ProcessEnv {
  return options.env ?? process.env
}

function runGit(args: string[], options: GitCommandOptions & { cwd?: string } = {}): SpawnSyncReturns<string> {
  return spawnSync(gitBin(options), args, {
    cwd: options.cwd,
    env: gitEnv(options),
    encoding: "utf8",
  })
}

function gitConfigSet(rootPath: string, key: "user.name" | "user.email", value: string, options: GitCommandOptions): SpawnSyncReturns<string> {
  return runGit(["config", "--local", key, value], { ...options, cwd: rootPath })
}

function trimOutput(result: SpawnSyncReturns<string>): string | undefined {
  if (result.status !== 0) return undefined
  const trimmed = result.stdout.trim()
  return trimmed || undefined
}

function readGitConfigValue(scope: "--global" | "--local", key: "user.name" | "user.email", options: GitCommandOptions & { cwd?: string }): string | undefined {
  return trimOutput(runGit(["config", scope, "--get", key], options))
}

function readGlobalIdentity(options: GitCommandOptions): GitIdentityValue {
  return {
    name: readGitConfigValue("--global", "user.name", options),
    email: readGitConfigValue("--global", "user.email", options),
  }
}

function readRepoLocalIdentity(rootPath: string, options: GitCommandOptions): GitIdentityValue {
  return {
    name: readGitConfigValue("--local", "user.name", { ...options, cwd: rootPath }),
    email: readGitConfigValue("--local", "user.email", { ...options, cwd: rootPath }),
  }
}

function identityComplete(identity: GitIdentityValue | undefined): identity is Required<GitIdentityValue> {
  return Boolean(identity?.name && identity.email)
}

function appDefaultAsEffective(identity: GitIdentityDefault | undefined): EffectiveGitIdentity | undefined {
  if (!identity) return undefined
  return {
    source: "app-default",
    name: identity.displayName,
    email: identity.email,
    localOnly: identity.localOnly,
  }
}

function configIdentity(config: AppConfig): GitIdentityDefault | undefined {
  return config.gitIdentityDefault
}

function readGitInstall(options: GitCommandOptions): GlobalGitReadiness["git"] {
  const result = runGit(["--version"], options)
  if (result.status !== 0 || result.error) return { installed: false }
  return { installed: true, version: result.stdout.trim() || undefined }
}

export function readGlobalGitReadiness(config: AppConfig, options: GitCommandOptions = {}): GlobalGitReadiness {
  const git = readGitInstall(options)
  const globalIdentity = git.installed ? readGlobalIdentity(options) : {}
  const appDefaultIdentity = configIdentity(config)
  const effectiveIdentity = identityComplete(globalIdentity)
    ? { source: "global" as const, name: globalIdentity.name, email: globalIdentity.email }
    : appDefaultAsEffective(appDefaultIdentity)
  const missingGitBlocker: GitIdentityBlocker | undefined = git.installed
    ? undefined
    : { error: "git_not_installed", message: "Git is not installed or not available on PATH." }
  const missingIdentityBlocker: GitIdentityBlocker | undefined = effectiveIdentity
    ? undefined
    : { error: "identity_missing", message: "Git identity is missing. Add a global Git identity or save a beerengineer_ app default." }
  return {
    mode: "global",
    git,
    globalIdentity,
    appDefaultIdentity,
    effectiveIdentity,
    setupBlocked: !git.installed,
    workflowBlocked: !git.installed || !effectiveIdentity,
    availableActions: ["save_app_default"],
    blocker: missingGitBlocker ?? missingIdentityBlocker,
  }
}

function checkGitRepo(rootPath: string, options: GitCommandOptions): boolean {
  const result = runGit(["rev-parse", "--is-inside-work-tree"], { ...options, cwd: rootPath })
  return result.status === 0 && result.stdout.trim() === "true"
}

export function readWorkspaceGitReadiness(
  workspace: WorkspaceGitReadinessTarget,
  config: AppConfig,
  options: GitCommandOptions = {},
): WorkspaceGitReadiness {
  const git = readGitInstall(options)
  const rootPath = workspace.rootPath?.trim()
  const pathAvailable = Boolean(rootPath && existsSync(rootPath))
  const isGitRepo = Boolean(git.installed && pathAvailable && rootPath && checkGitRepo(rootPath, options))
  const repoLocalIdentity = isGitRepo && rootPath ? readRepoLocalIdentity(rootPath, options) : {}
  const globalIdentity = git.installed ? readGlobalIdentity(options) : {}
  const appDefaultIdentity = configIdentity(config)
  const effectiveIdentity = identityComplete(repoLocalIdentity)
    ? { source: "repo-local" as const, name: repoLocalIdentity.name, email: repoLocalIdentity.email }
    : identityComplete(globalIdentity)
      ? { source: "global" as const, name: globalIdentity.name, email: globalIdentity.email }
      : undefined
  const appRepairAvailable = !effectiveIdentity && Boolean(appDefaultIdentity) && isGitRepo
  const missingGitBlocker: GitIdentityBlocker | undefined = git.installed
    ? undefined
    : { error: "git_not_installed", message: "Git is not installed or not available on PATH." }
  const missingPathBlocker: GitIdentityBlocker | undefined = git.installed && !pathAvailable
    ? { error: "workspace_path_unavailable", message: "Registered workspace path is unavailable." }
    : undefined
  const nonRepoBlocker: GitIdentityBlocker | undefined = git.installed && pathAvailable && !isGitRepo
    ? { error: "workspace_not_git_repo", message: "Registered workspace is not a Git repository." }
    : undefined
  const missingIdentityBlocker: GitIdentityBlocker | undefined = git.installed && isGitRepo && !effectiveIdentity
    ? { error: "identity_missing", message: "Git identity is missing for this workspace. Repair by applying a local identity." }
    : undefined
  return {
    mode: "workspace",
    workspace: { id: workspace.id, key: workspace.key },
    git,
    isGitRepo,
    repoLocalIdentity,
    globalIdentity,
    appDefaultIdentity,
    effectiveIdentity,
    ready: Boolean(effectiveIdentity),
    setupBlocked: !git.installed,
    workflowBlocked: !git.installed || !isGitRepo || !effectiveIdentity,
    availableActions: appRepairAvailable ? ["repair_workspace_identity"] : [],
    blocker: missingGitBlocker ?? missingPathBlocker ?? nonRepoBlocker ?? missingIdentityBlocker,
  }
}

export function repairWorkspaceGitIdentity(
  workspace: WorkspaceGitReadinessTarget,
  config: AppConfig,
  input: GitIdentityInput,
  options: GitCommandOptions = {},
): WorkspaceGitRepairResult {
  const validation = validateGitIdentityInput(input)
  if (!validation.ok) {
    return {
      ok: false,
      error: "identity_invalid",
      message: "Git identity input is invalid.",
      validation,
      actions: [],
    }
  }

  const before = readWorkspaceGitReadiness(workspace, config, options)
  if (!before.git.installed) {
    return { ok: false, error: "git_not_installed", message: before.blocker?.message ?? "Git is unavailable.", actions: [], readiness: before }
  }
  if (before.blocker?.error === "workspace_path_unavailable") {
    return { ok: false, error: "workspace_path_unavailable", message: before.blocker.message, actions: [], readiness: before }
  }
  if (!before.isGitRepo) {
    return { ok: false, error: "workspace_not_git_repo", message: before.blocker?.message ?? "Workspace is not a Git repository.", actions: [], readiness: before }
  }
  const rootPath = workspace.rootPath?.trim()
  if (!rootPath) {
    return { ok: false, error: "workspace_path_unavailable", message: "Registered workspace path is unavailable.", actions: [], readiness: before }
  }

  const actions: string[] = []
  const nameResult = gitConfigSet(rootPath, "user.name", validation.identity.displayName, options)
  if (nameResult.status === 0) actions.push("git config --local user.name")
  const emailResult = gitConfigSet(rootPath, "user.email", validation.identity.email, options)
  if (emailResult.status === 0) actions.push("git config --local user.email")

  const readiness = readWorkspaceGitReadiness(workspace, config, options)
  if (nameResult.status !== 0 || emailResult.status !== 0 || !readiness.ready) {
    return {
      ok: false,
      error: "repair_partial_failure",
      message: "Workspace Git identity repair did not fully apply.",
      actions,
      readiness,
    }
  }
  return { ok: true, actions, readiness }
}

export function gitIdentitySetupChecks(config: AppConfig | null): CheckResult[] {
  const readiness = config
    ? readGlobalGitReadiness(config)
    : readGlobalGitReadiness({} as AppConfig)
  const checks: CheckResult[] = [
    {
      id: "git.install",
      label: "Git",
      status: readiness.git.installed ? "ok" : "missing",
      version: readiness.git.version,
      detail: readiness.git.installed ? "Git is available for local checkpoints" : "Git is required for workflow checkpoints",
      remedy: readiness.git.installed ? undefined : {
        hint: "Install Git, then re-run setup.",
        url: "https://git-scm.com/downloads",
      },
    },
    {
      id: "git.identity",
      label: "Git identity",
      status: readiness.workflowBlocked ? "missing" : "ok",
      detail: readiness.workflowBlocked
        ? "Git identity is missing; workflows will be blocked until global Git identity or a beerengineer_ default exists."
        : `Git identity ready from ${readiness.effectiveIdentity?.source ?? "unknown"}`,
      remedy: readiness.workflowBlocked ? { hint: "Save a beerengineer_ Git identity default or configure Git identity." } : undefined,
    },
  ]
  return checks
}
