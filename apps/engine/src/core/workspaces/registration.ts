import { createInterface } from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import { basename, resolve } from "node:path"
import { mkdir, rm } from "node:fs/promises"
import type { Repos } from "../../db/repositories.js"
import type { AppConfig, SetupReport, SonarReadiness } from "../../setup/types.js"
import type {
  HarnessProfile,
  RegisterResult,
  RegisterWorkspaceInput,
  SonarConfig,
  WorkspacePreview,
  WorkspaceRow,
} from "../../types/workspace.js"
import { validateHarnessProfile } from "./harnessProfiles.js"
import {
  CODERABBIT_CONFIG_FILE,
  GITIGNORE_FILE,
  SONAR_PROPERTIES_FILE,
  SONAR_WORKFLOW_FILE,
  WORKSPACE_CONFIG_DIR,
  WORKSPACE_CONFIG_FILE,
  buildPathPreview,
  ensureGitRepo,
  ensureManagedGitignore,
  generateCodeRabbitInstallUrl,
  isInsideAllowedRootRealpath,
  pathExists,
  persistSonarTokenToGitConfig,
  previewFromDbRow,
  renderSonarWorkflow,
  renderCoderabbitConfig,
  runCommand,
  runGit,
  safeParseHarnessProfile,
  slugify,
  writeFileIfMissing,
} from "./shared.js"
import {
  buildWorkspaceConfigFile,
  generateSonarMcpSnippet,
  generateSonarProjectUrl,
  normalizeReviewPolicy,
  normalizeSonarConfig,
  readWorkspaceConfig,
  writeWorkspaceConfig,
} from "./configFile.js"
import { previewWorkspace, provisionSonarProject, runWorkspacePreflight, writeSonarProperties } from "./sonar.js"

export async function scaffoldWorkspace(root: string, opts: { createGitignore: boolean }): Promise<string[]> {
  await mkdir(root, { recursive: true })
  await mkdir(resolve(root, WORKSPACE_CONFIG_DIR), { recursive: true })
  const actions = [`created ${WORKSPACE_CONFIG_DIR}/`]
  if (opts.createGitignore) {
    const result = await ensureManagedGitignore(root)
    if (result.changed) actions.push(`updated ${GITIGNORE_FILE}`)
  }
  return actions
}

export async function initGit(root: string, opts: { defaultBranch?: string; initialCommit?: boolean }): Promise<{ ok: boolean; detail?: string; actions: string[] }> {
  const branch = opts.defaultBranch ?? "main"
  const init = runGit(["init", "-b", branch], root)
  if (!init.ok) {
    const fallback = runGit(["init"], root)
    if (!fallback.ok) return { ok: false, detail: init.stderr || fallback.stderr || "git init failed", actions: [] }
    const head = runGit(["symbolic-ref", "HEAD", `refs/heads/${branch}`], root)
    if (!head.ok) return { ok: false, detail: head.stderr || "failed to set default branch", actions: ["git init"] }
  }
  const actions = [`git init (${branch})`]
  if (opts.initialCommit) {
    const add = runGit(["add", "."], root)
    if (!add.ok) return { ok: false, detail: add.stderr || "git add failed", actions }
    const commit = runGit(["commit", "-m", "Initial beerengineer_ scaffold"], root)
    if (!commit.ok) return { ok: false, detail: commit.stderr || "git commit failed", actions }
    actions.push("git initial commit")
  }
  return { ok: true, actions }
}

type RegisterDeps = {
  repos: Repos
  config: AppConfig
  appReport: SetupReport
}

type WorkspacePreflight = Awaited<ReturnType<typeof runWorkspacePreflight>>

type RegisterWorkspaceState = {
  path: string
  preview: WorkspacePreview
  existingConfig: Awaited<ReturnType<typeof readWorkspaceConfig>>
  name: string
  key: string
  requestedSonar: SonarConfig | undefined
  validation: ReturnType<typeof validateHarnessProfile> & { ok: true }
  byKey: ReturnType<Repos["getWorkspaceByKey"]>
}

const DEFAULT_SONAR_READINESS = {
  scanner: "unknown",
  token: "unknown",
  config: "missing",
  coverage: "unknown",
  warnings: [],
} satisfies SonarReadiness

const HARNESS_PROFILE_OPTIONS = [
  ["1", { mode: "codex-first" }, "codex-first"],
  ["2", { mode: "claude-first" }, "claude-first"],
  ["3", { mode: "codex-only" }, "codex-only"],
  ["4", { mode: "claude-only" }, "claude-only"],
  ["5", { mode: "fast" }, "fast"],
  ["6", { mode: "claude-sdk-first" }, "claude-sdk-first  (Claude Agent SDK; needs ANTHROPIC_API_KEY, bills per-token)"],
  ["7", { mode: "codex-sdk-first" }, "codex-sdk-first   (Codex SDK; needs OPENAI_API_KEY, bills per-token)"],
  ["8", { mode: "opencode-china" }, "opencode-china    (qwen + deepseek via OpenRouter)"],
  ["9", { mode: "opencode-euro" }, "opencode-euro     (mistral via OpenRouter)"],
] as const satisfies ReadonlyArray<readonly [string, HarnessProfile, string]>

async function resolveRegisterWorkspaceState(
  input: RegisterWorkspaceInput,
  deps: RegisterDeps,
): Promise<RegisterWorkspaceState | RegisterResult> {
  const path = resolve(input.path)
  const preview = await previewWorkspace(path, deps.config, deps.repos)
  if (!preview.isInsideAllowedRoot) return { ok: false, error: "path_outside_allowed_roots", detail: `Path ${path} is outside allowed roots` }
  if (preview.exists && !preview.isDirectory) return { ok: false, error: "path_not_directory", detail: `Path ${path} is not a directory` }
  if (!preview.isWritable) return { ok: false, error: "path_not_writable", detail: `Path ${path} is not writable` }
  const existingConfig = await readWorkspaceConfig(path)
  const name = input.name ?? existingConfig?.name ?? basename(path)
  const key = input.key ?? existingConfig?.key ?? slugify(name)
  let requestedSonar = input.sonar ?? existingConfig?.sonar
  if (!requestedSonar?.enabled && preview.hasSonarProperties) requestedSonar = { ...requestedSonar, enabled: true }
  const validation = validateHarnessProfile(input.harnessProfile, deps.appReport)
  if (!validation.ok) return { ok: false, error: validation.error?.code ?? "unknown", detail: validation.error?.detail ?? "invalid harness profile" }
  const byPath = deps.repos.getWorkspaceByRootPath(path)
  if (byPath && byPath.key !== key) return { ok: false, error: "path_already_registered", detail: `Path ${path} is already registered as ${byPath.key}` }
  const byKey = deps.repos.getWorkspaceByKey(key)
  if (byKey?.root_path && byKey.root_path !== path) return { ok: false, error: "key_conflict", detail: `Workspace key ${key} is already registered for ${byKey.root_path}` }
  return { path, preview, existingConfig, name, key, requestedSonar, validation: validation as never, byKey }
}

async function prepareWorkspaceFilesystem(input: RegisterWorkspaceInput, state: RegisterWorkspaceState, actions: string[]): Promise<RegisterResult | null> {
  if (state.preview.isGreenfield || input.create) {
    try {
      actions.push(...await scaffoldWorkspace(state.path, { createGitignore: true }))
    } catch (err) {
      return { ok: false, error: "scaffold_failed", detail: (err as Error).message }
    }
  } else {
    await mkdir(resolve(state.path, WORKSPACE_CONFIG_DIR), { recursive: true })
    const gitignore = await ensureManagedGitignore(state.path)
    if (gitignore.changed) actions.push(`updated ${GITIGNORE_FILE}`)
  }
  const gitSetup = await ensureGitRepo(state.path, input.git?.defaultBranch ?? "main", initGit)
  if (!gitSetup.ok) return { ok: false, error: "git_init_failed", detail: gitSetup.detail ?? "git init failed" }
  actions.push(...gitSetup.actions)
  return null
}

function seedWorkspaceSonarToken(path: string, sonarToken: RegisterWorkspaceInput["sonarToken"], actions: string[]): void {
  if (!sonarToken?.value) return
  if (!process.env.SONAR_TOKEN) process.env.SONAR_TOKEN = sonarToken.value
  if (!sonarToken.persist) return
  persistSonarTokenToGitConfig(path, sonarToken.value)
  actions.push("wrote SONAR_TOKEN to repo git config for shared worktree access")
}

async function refreshWorkspacePreflight(path: string, requestedSonar: SonarConfig | undefined, hasSonarProperties: boolean) {
  return await runWorkspacePreflight(path, {
    sonarHostUrl: requestedSonar?.hostUrl,
    sonarEnabled: requestedSonar?.enabled ?? hasSonarProperties,
  })
}

async function maybeCreateGithubRepoForWorkspace(
  input: RegisterWorkspaceInput,
  state: RegisterWorkspaceState,
  preflight: WorkspacePreflight,
  actions: string[],
) {
  if (!input.github?.create || preflight.report.github.status === "ok" || preflight.report.gh.status !== "ok") return preflight
  const visibility = input.github.visibility === "public" ? "--public" : "--private"
  const owner = input.github.owner ?? preflight.report.gh.user
  const slug = owner ? `${owner}/${state.key}` : state.key
  const ghResult = runCommand("gh", ["repo", "create", slug, visibility, "--source=.", "--remote=origin", "--push"], state.path)
  if (!ghResult.ok) {
    actions.push(`! gh repo create ${slug} failed: ${ghResult.stderr || ghResult.stdout || "unknown error"}`)
    return preflight
  }
  actions.push(`gh repo create ${slug}`)
  return await refreshWorkspacePreflight(state.path, state.requestedSonar, state.preview.hasSonarProperties)
}

function resolveWorkspaceSonarSettings(
  state: RegisterWorkspaceState,
  deps: RegisterDeps,
  preflight: WorkspacePreflight,
) {
  const githubReady = Boolean(preflight.report.github.status === "ok" && preflight.report.github.owner && preflight.report.github.repo)
  const sonar = githubReady && state.requestedSonar?.enabled
    ? normalizeSonarConfig({
        ...state.requestedSonar,
        enabled: true,
        organization: preflight.report.github.owner,
        projectKey: `${preflight.report.github.owner}_${preflight.report.github.repo}`,
        baseBranch: preflight.report.github.defaultBranch ?? state.requestedSonar.baseBranch,
      }, state.key, deps.config.llm.defaultSonarOrganization)
    : normalizeSonarConfig({ enabled: false }, state.key, deps.config.llm.defaultSonarOrganization)
  const coderabbitCliAvailable = preflight.report.coderabbit.status === "ok"
  const reviewPolicy = normalizeReviewPolicy(
    state.existingConfig?.reviewPolicy,
    sonar,
    state.key,
    deps.config.llm.defaultSonarOrganization,
    coderabbitCliAvailable,
  )
  return { githubReady, sonar, reviewPolicy }
}

function buildGithubCreateCommand(key: string, preflight: WorkspacePreflight): string | undefined {
  if (preflight.report.github.status === "ok") return undefined
  const owner = preflight.report.gh.user ?? preflight.report.github.owner
  const slug = owner ? `${owner}/${key}` : key
  return `gh repo create ${slug} --private --source=. --remote=origin --push`
}

function collectWorkspaceWarnings(
  requestedSonar: SonarConfig | undefined,
  githubReady: boolean,
  preflight: WorkspacePreflight,
  sonarReadiness: SonarReadiness,
  validationWarnings: string[],
): string[] {
  const warnings = [...validationWarnings]
  if (requestedSonar?.enabled && !githubReady) warnings.push("SonarCloud config generation skipped until a GitHub origin remote is configured")
  if (preflight.report.gh.status !== "ok") warnings.push("GitHub CLI is not authenticated; repo creation and secret sync remain manual")
  if (requestedSonar?.enabled && sonarReadiness.token === "invalid") warnings.push("SONAR_TOKEN is present but failed Sonar validation")
  else if (requestedSonar?.enabled && sonarReadiness.token === "missing") warnings.push("SONAR_TOKEN is not configured yet; local scans and project provisioning will remain incomplete")
  if (requestedSonar?.enabled && sonarReadiness.config === "invalid" && sonarReadiness.details?.config) warnings.push(`Sonar config invalid: ${sonarReadiness.details.config}`)
  if (requestedSonar?.enabled && sonarReadiness.config === "missing") warnings.push("Sonar config was not generated; add sonar-project.properties manually for this workspace layout")
  if (sonarReadiness.coverage === "producer-missing") warnings.push("Coverage import configured but no coverage command was detected")
  else if (sonarReadiness.coverage === "artifact-missing" && sonarReadiness.details?.coverage) warnings.push(sonarReadiness.details.coverage)
  warnings.push(...sonarReadiness.warnings)
  return warnings
}

async function provisionWorkspaceSonar(
  path: string,
  name: string,
  sonar: SonarConfig,
  preflight: WorkspacePreflight,
  actions: string[],
  warnings: string[],
) {
  if (!(preflight.report.github.status === "ok" && preflight.report.github.owner && preflight.report.github.repo && sonar.enabled)) return preflight
  const owner = preflight.report.github.owner
  const repo = preflight.report.github.repo
  const sonarWrite = await writeSonarProperties(path, owner, repo)
  if (sonarWrite.changed) actions.push(`wrote ${SONAR_PROPERTIES_FILE}`)
  warnings.push(...sonarWrite.warnings)
  if (await writeFileIfMissing(resolve(path, SONAR_WORKFLOW_FILE), renderSonarWorkflow())) actions.push(`wrote ${SONAR_WORKFLOW_FILE}`)
  const refreshedPreflight = await runWorkspacePreflight(path, { sonarHostUrl: sonar.hostUrl, sonarEnabled: sonar.enabled })
  if (sonar.enabled && refreshedPreflight.report.sonar.status === "ok") {
    await provisionSonarProject(path, name, sonar, actions, warnings)
  }
  return refreshedPreflight
}

export async function registerWorkspace(input: RegisterWorkspaceInput, deps: RegisterDeps): Promise<RegisterResult> {
  const resolvedState = await resolveRegisterWorkspaceState(input, deps)
  if ("ok" in resolvedState) return resolvedState
  const state = resolvedState
  const actions: string[] = []
  const prepError = await prepareWorkspaceFilesystem(input, state, actions)
  if (prepError) return prepError
  seedWorkspaceSonarToken(state.path, input.sonarToken, actions)

  let preflight = await refreshWorkspacePreflight(state.path, state.requestedSonar, state.preview.hasSonarProperties)
  preflight = await maybeCreateGithubRepoForWorkspace(input, state, preflight, actions)

  const { githubReady, sonar, reviewPolicy } = resolveWorkspaceSonarSettings(state, deps, preflight)
  const workspaceConfig = buildWorkspaceConfigFile({
    key: state.key,
    name: state.name,
    harnessProfile: input.harnessProfile,
    runtimePolicy: state.existingConfig?.runtimePolicy,
    preview: state.existingConfig?.preview,
    sonar,
    reviewPolicy,
    preflight: preflight.report,
    createdAt: state.existingConfig?.createdAt,
  })
  await writeWorkspaceConfig(state.path, workspaceConfig)
  actions.push(`wrote ${WORKSPACE_CONFIG_DIR}/${WORKSPACE_CONFIG_FILE}`)
  const warnings: string[] = []
  preflight = await provisionWorkspaceSonar(state.path, state.name, sonar, preflight, actions, warnings)
  if (await writeFileIfMissing(resolve(state.path, CODERABBIT_CONFIG_FILE), renderCoderabbitConfig())) actions.push(`wrote ${CODERABBIT_CONFIG_FILE}`)

  const dbRow = deps.repos.upsertWorkspace({
    key: state.key,
    name: state.name,
    description: state.byKey?.description ?? null,
    rootPath: state.path,
    harnessProfileJson: JSON.stringify(input.harnessProfile),
    sonarEnabled: sonar.enabled,
  })
  const workspace = previewFromDbRow(dbRow)
  const ghCommand = buildGithubCreateCommand(state.key, preflight)
  const coderabbitInstallUrl = preflight.report.github.owner ? generateCodeRabbitInstallUrl() : undefined
  const sonarReadiness = preflight.report.sonar.readiness ?? DEFAULT_SONAR_READINESS
  const finalWarnings = collectWorkspaceWarnings(state.requestedSonar, githubReady, preflight, sonarReadiness, state.validation.warnings)
  finalWarnings.push(...warnings)

  return {
    ok: true,
    workspace,
    preview: await previewWorkspace(state.path, deps.config, deps.repos),
    actions,
    warnings: finalWarnings,
    preflight: preflight.report,
    sonarReadiness,
    sonarProjectUrl: generateSonarProjectUrl(state.name, sonar),
    sonarMcpSnippet: generateSonarMcpSnippet(sonar),
    ghCreateCommand: ghCommand,
    coderabbitInstallUrl,
  }
}

export function listRegisteredWorkspaces(repos: Repos): WorkspaceRow[] {
  return repos.listWorkspaces().map(previewFromDbRow)
}

export function getRegisteredWorkspace(repos: Repos, key: string): WorkspaceRow | null {
  const row = repos.getWorkspaceByKey(key)
  return row ? previewFromDbRow(row) : null
}

export type RemoveWorkspaceResult = {
  ok: boolean
  workspace?: WorkspaceRow
  purgedPath?: string | null
  purgeSkipped?: { reason: string; path: string }
}

export async function removeWorkspace(
  repos: Repos,
  key: string,
  opts: { purge: boolean; allowedRoots?: string[] },
): Promise<RemoveWorkspaceResult> {
  const row = repos.getWorkspaceByKey(key)
  if (!row) return { ok: false }
  const workspace = previewFromDbRow(row)
  let purgeSkipped: RemoveWorkspaceResult["purgeSkipped"]
  let purgedPath: string | null = null
  if (opts.purge) {
    if (!row.root_path) purgeSkipped = { reason: "missing_root_path", path: "" }
    else if (!opts.allowedRoots || opts.allowedRoots.length === 0) purgeSkipped = { reason: "allowed_roots_required", path: row.root_path }
    else if (await isInsideAllowedRootRealpath(row.root_path, opts.allowedRoots)) {
      await rm(row.root_path, { recursive: true, force: true })
      purgedPath = row.root_path
    } else purgeSkipped = { reason: "path_outside_allowed_roots", path: row.root_path }
  }
  repos.removeWorkspaceByKey(key)
  return { ok: true, workspace, purgedPath, purgeSkipped }
}

export function openWorkspace(repos: Repos, key: string): string | null {
  const row = repos.getWorkspaceByKey(key)
  if (!row?.root_path) return null
  repos.touchWorkspaceLastOpenedAt(key)
  return row.root_path
}

type PromptSession = ReturnType<typeof createInterface>

async function promptLine(rl: PromptSession, label: string, fallback?: string): Promise<string> {
  const suffix = fallback ? ` [${fallback}]` : ""
  const answer = (await rl.question(`  ${label}${suffix}: `)).trim()
  return answer || fallback || ""
}

async function promptYesNo(rl: PromptSession, label: string, defaultYes: boolean): Promise<boolean> {
  const fallback = defaultYes ? "Y/n" : "y/N"
  const answer = (await rl.question(`  ${label} [${fallback}] `)).trim().toLowerCase()
  if (!answer) return defaultYes
  return answer === "y" || answer === "yes"
}

function renderPreviewSummary(preview: WorkspacePreview): void {
  console.log("\n  Preview")
  const summary = previewSummaryLine(preview)
  console.log(`    ✓ ${summary}`)
  console.log(`    ${preview.isInsideAllowedRoot ? "✓" : "!"} inside allowed roots`)
  console.log(`    ${preview.isGreenfield ? "· will be a greenfield workspace" : "· will be a brownfield registration"}`)
  const gitRepoDetail = previewGitRepoDetail(preview)
  for (const detail of [
    gitRepoDetail,
    preview.detectedStack ? `detected stack: ${preview.detectedStack}` : undefined,
    preview.hasWorkspaceConfigFile ? `existing ${WORKSPACE_CONFIG_DIR}/${WORKSPACE_CONFIG_FILE} found` : undefined,
    preview.hasSonarProperties ? `existing ${SONAR_PROPERTIES_FILE} found` : undefined,
  ]) {
    if (detail) console.log(`    · ${detail}`)
  }
  for (const conflict of preview.conflicts) console.log(`    ! ${conflict}`)
  console.log("")
}

function previewSummaryLine(preview: WorkspacePreview): string {
  if (!preview.exists) return "path does not exist — will be scaffolded"
  return preview.isGreenfield
    ? "path exists and is empty — will be scaffolded in place"
    : `path exists and is populated (${preview.existingFiles.length}+ top-level entries)`
}

function previewGitRepoDetail(preview: WorkspacePreview): string {
  if (!preview.isGitRepo) return "no git repo detected"
  if (!preview.defaultBranch) return "git repo detected"
  return `git repo detected (${preview.defaultBranch})`
}

async function promptHarnessProfile(rl: PromptSession, config: AppConfig): Promise<HarnessProfile> {
  console.log("\n  Harness profile")
  for (const [id, , label] of HARNESS_PROFILE_OPTIONS) console.log(`    ${id}) ${label}`)
  const choice = await promptLine(rl, "Pick [1-9] or [d]efault", "d")
  return HARNESS_PROFILE_OPTIONS.find(([id]) => id === choice.toLowerCase())?.[1] ?? config.llm.defaultHarnessProfile
}

async function promptSonarConfig(rl: PromptSession, key: string, config: AppConfig): Promise<SonarConfig> {
  console.log("")
  const enableSonar = await promptYesNo(rl, "Enable Sonar for this workspace?", false)
  if (!enableSonar) return { enabled: false }
  return {
    enabled: true,
    projectKey: await promptLine(rl, "Project key", key),
    organization: await promptLine(rl, "Organization", config.llm.defaultSonarOrganization ?? ""),
    hostUrl: await promptLine(rl, "Host URL", "https://sonarcloud.io"),
  }
}

async function promptGitHubCreateOption(
  rl: PromptSession,
  preview: WorkspacePreview,
  path: string,
): Promise<{ create: boolean; visibility: "public" | "private" } | undefined> {
  const ghProbe = runCommand("gh", ["auth", "status"], process.cwd())
  const hasGhAuth = ghProbe.ok
  const hasOrigin = preview.isGitRepo && runCommand("git", ["remote", "get-url", "origin"], path).ok
  if (!hasGhAuth || hasOrigin) return undefined
  const create = await promptYesNo(rl, "No GitHub origin detected. Create a new GitHub repo now?", false)
  if (!create) return undefined
  const visibilityAnswer = await promptLine(rl, "Visibility [private/public]", "private")
  const visibility: "public" | "private" = visibilityAnswer.toLowerCase().startsWith("pub") ? "public" : "private"
  return { create: true, visibility }
}

async function promptSonarTokenValue(
  rl: PromptSession,
  path: string,
  sonar: SonarConfig,
): Promise<{ value: string; persist: boolean } | undefined> {
  if (!sonar.enabled) return undefined
  const detected = await (await import("./shared.js")).detectSonarToken(path)
  if (detected.value) return undefined
  console.log("\n  SONAR_TOKEN is required for SonarCloud project creation and scanner runs.")
  console.log("  Generate one at https://sonarcloud.io/account/security")
  const value = (await promptLine(rl, "SONAR_TOKEN (blank to skip)", "")).trim()
  if (!value) return undefined
  const persist = await promptYesNo(rl, "Write SONAR_TOKEN to repo git config for all worktrees of this workspace?", true)
  return { value, persist }
}

export async function promptForWorkspaceAddDefaults(config: AppConfig): Promise<{
  path: string
  name?: string
  key?: string
  profile: HarnessProfile
  sonar: SonarConfig
  gitInit?: boolean
  github?: { create: boolean; visibility: "public" | "private" }
  sonarToken?: { value: string; persist: boolean }
}> {
  const rl = createInterface({ input, output })
  try {
    const path = await promptLine(rl, "Path")
    const preview = { ...(await buildPathPreview(path, config.allowedRoots, readWorkspaceConfig)), isRegistered: false }
    renderPreviewSummary(preview)
    const name = await promptLine(rl, "Name", basename(path))
    const key = await promptLine(rl, "Key", slugify(name))
    const profile = await promptHarnessProfile(rl, config)
    const sonar = await promptSonarConfig(rl, key, config)
    const defaultGitInit = preview.isGreenfield || !preview.isGitRepo
    const gitInit = await promptYesNo(rl, "Initialize git?", defaultGitInit)
    const github = await promptGitHubCreateOption(rl, preview, path)
    const sonarToken = await promptSonarTokenValue(rl, path, sonar)
    const proceed = await promptYesNo(rl, "Proceed?", true)
    if (!proceed) throw new Error("workspace add cancelled")
    return { path, name, key, profile, sonar, gitInit, github, sonarToken }
  } finally {
    rl.close()
  }
}

export async function backfillWorkspaceConfigs(repos: Repos): Promise<{ written: string[]; skipped: Array<{ key: string; reason: string }> }> {
  const written: string[] = []
  const skipped: Array<{ key: string; reason: string }> = []
  for (const row of repos.listWorkspaces()) {
    const skip = (reason: string) => skipped.push({ key: row.key, reason })
    if (!row.root_path) { skip("missing root_path"); continue }
    const root = resolve(row.root_path)
    if (!await pathExists(root)) { skip("root_path does not exist"); continue }
    const writable = await (await import("./shared.js")).isWritablePath(root)
    if (!writable) { skip("root_path is not writable"); continue }
    if (await readWorkspaceConfig(root)) { skip("workspace config already exists"); continue }
    const parsed = safeParseHarnessProfile(row.harness_profile_json)
    if (!parsed.profile) { skip(`harness_profile_json invalid: ${parsed.error ?? "unknown"}`); continue }
    const config = buildWorkspaceConfigFile({
      key: row.key,
      name: row.name,
      harnessProfile: parsed.profile,
      sonar: { enabled: row.sonar_enabled === 1 },
      createdAt: row.created_at,
    })
    await writeWorkspaceConfig(root, config)
    written.push(row.key)
  }
  return { written, skipped }
}
