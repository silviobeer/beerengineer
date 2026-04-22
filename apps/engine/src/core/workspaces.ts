import { spawnSync } from "node:child_process"
import { access, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { constants } from "node:fs"
import { basename, dirname, resolve } from "node:path"
import { createInterface } from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import type { Repos, WorkspaceRow as DbWorkspaceRow } from "../db/repositories.js"
import { isKnownModel } from "./harness/models.js"
import type { AppConfig, SetupReport } from "../setup/types.js"
import type {
  HarnessProfile,
  KnownHarness,
  RegisterResult,
  RegisterWorkspaceInput,
  SonarConfig,
  ValidationResult,
  WorkspaceConfigFile,
  WorkspacePreview,
  WorkspaceRow,
} from "../types/workspace.js"

const WORKSPACE_SCHEMA_VERSION = 1 as const
const SONAR_DEFAULT_HOST = "https://sonarcloud.io"
const WORKSPACE_CONFIG_DIR = ".beerengineer"
const WORKSPACE_CONFIG_FILE = "workspace.json"
const SONAR_PROPERTIES_FILE = "sonar-project.properties"

function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "workspace"
}

function workspaceConfigPath(root: string): string {
  return resolve(root, WORKSPACE_CONFIG_DIR, WORKSPACE_CONFIG_FILE)
}

function sonarPropertiesPath(root: string): string {
  return resolve(root, SONAR_PROPERTIES_FILE)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function isWritablePath(path: string): Promise<boolean> {
  try {
    await access(path, constants.W_OK)
    return true
  } catch {
    return false
  }
}

async function findWritableParent(path: string): Promise<boolean> {
  let cursor = resolve(path)
  while (true) {
    if (await pathExists(cursor)) return isWritablePath(cursor)
    const parent = dirname(cursor)
    if (parent === cursor) return false
    cursor = parent
  }
}

function isInsideAllowedRoot(path: string, allowedRoots: string[]): boolean {
  return allowedRoots.some(root => {
    const absRoot = resolve(root)
    return path === absRoot || path.startsWith(`${absRoot}/`)
  })
}

function runGit(args: string[], cwd: string): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME ?? "BeerEngineer",
      GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL ?? "beerengineer@example.invalid",
      GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME ?? "BeerEngineer",
      GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL ?? "beerengineer@example.invalid",
    },
  })
  return {
    ok: result.status === 0,
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? "",
  }
}

function detectStack(entries: string[]): string | null {
  const names = new Set(entries)
  if (names.has("next.config.ts") || names.has("next.config.js")) return "next"
  if (names.has("package.json")) return "node"
  if (names.has("pyproject.toml") || names.has("requirements.txt") || names.has("manage.py")) return "python"
  if (names.has("Cargo.toml")) return "rust"
  return null
}

async function buildPathPreview(path: string, allowedRoots: string[]): Promise<Omit<WorkspacePreview, "isRegistered">> {
  const resolvedPath = resolve(path)
  const exists = await pathExists(resolvedPath)
  const stats = exists ? await stat(resolvedPath) : null
  const isDirectory = stats?.isDirectory() ?? false
  const topLevelEntries = exists && isDirectory ? (await readdir(resolvedPath)).slice(0, 20) : []
  const isWritable = exists ? await isWritablePath(resolvedPath) : await findWritableParent(resolvedPath)
  const gitProbe = exists && isDirectory ? runGit(["rev-parse", "--is-inside-work-tree"], resolvedPath) : { ok: false, stdout: "", stderr: "" }
  const isGitRepo = gitProbe.ok && gitProbe.stdout === "true"
  const defaultBranch = isGitRepo ? (runGit(["branch", "--show-current"], resolvedPath).stdout || null) : null
  const remoteProbe = isGitRepo ? runGit(["remote"], resolvedPath) : { ok: false, stdout: "", stderr: "" }
  const hasRemote = Boolean(remoteProbe.stdout)
  const configFile = exists && isDirectory ? await readWorkspaceConfig(resolvedPath) : null
  const hasSonarProperties = exists && isDirectory ? await pathExists(sonarPropertiesPath(resolvedPath)) : false
  const conflicts: string[] = []
  if (exists && !isDirectory) conflicts.push("path is not a directory")
  if (!isWritable) conflicts.push("path is not writable")
  if (!isInsideAllowedRoot(resolvedPath, allowedRoots)) conflicts.push("path is outside allowed roots")
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    path: resolvedPath,
    exists,
    isDirectory,
    isWritable,
    isGitRepo,
    hasRemote,
    defaultBranch,
    detectedStack: detectStack(topLevelEntries),
    existingFiles: topLevelEntries,
    isInsideAllowedRoot: isInsideAllowedRoot(resolvedPath, allowedRoots),
    isGreenfield: !exists || (isDirectory && topLevelEntries.length === 0),
    hasWorkspaceConfigFile: Boolean(configFile),
    hasSonarProperties,
    conflicts,
  }
}

function previewFromDbRow(row: DbWorkspaceRow): WorkspaceRow {
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    key: row.key,
    name: row.name,
    rootPath: row.root_path ?? "",
    harnessProfile: JSON.parse(row.harness_profile_json) as HarnessProfile,
    sonarEnabled: row.sonar_enabled === 1,
    createdAt: row.created_at,
    lastOpenedAt: row.last_opened_at,
  }
}

function normalizeSonarConfig(config: SonarConfig | undefined, key: string, defaultOrg?: string): SonarConfig {
  if (!config?.enabled) return { enabled: false }
  return {
    enabled: true,
    projectKey: config.projectKey ?? key,
    organization: config.organization ?? defaultOrg,
    hostUrl: config.hostUrl ?? SONAR_DEFAULT_HOST,
  }
}

function buildWorkspaceConfigFile(input: {
  key: string
  name: string
  harnessProfile: HarnessProfile
  sonar: SonarConfig
  createdAt?: number
}): WorkspaceConfigFile {
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    key: input.key,
    name: input.name,
    harnessProfile: input.harnessProfile,
    sonar: input.sonar,
    createdAt: input.createdAt ?? Date.now(),
  }
}

export async function readWorkspaceConfig(root: string): Promise<WorkspaceConfigFile | null> {
  try {
    const raw = JSON.parse(await readFile(workspaceConfigPath(root), "utf8")) as WorkspaceConfigFile
    if (raw.schemaVersion !== WORKSPACE_SCHEMA_VERSION || typeof raw.key !== "string" || typeof raw.name !== "string") {
      return null
    }
    return raw
  } catch {
    return null
  }
}

export async function writeWorkspaceConfig(root: string, config: WorkspaceConfigFile): Promise<void> {
  await mkdir(dirname(workspaceConfigPath(root)), { recursive: true })
  await writeFile(workspaceConfigPath(root), toJson(config), "utf8")
}

export async function writeSonarProperties(root: string, sonar: SonarConfig, workspaceName: string): Promise<void> {
  if (!sonar.enabled) return
  if (await pathExists(sonarPropertiesPath(root))) return
  const lines = [
    `sonar.projectKey=${sonar.projectKey}`,
    sonar.organization ? `sonar.organization=${sonar.organization}` : undefined,
    `sonar.host.url=${sonar.hostUrl ?? SONAR_DEFAULT_HOST}`,
    `sonar.projectName=${workspaceName}`,
  ].filter(Boolean)
  await writeFile(sonarPropertiesPath(root), `${lines.join("\n")}\n`, "utf8")
}

export function generateSonarProjectUrl(name: string, sonar: SonarConfig): string | undefined {
  if (!sonar.enabled || !sonar.organization || !sonar.projectKey) return undefined
  const params = new URLSearchParams({
    organization: sonar.organization,
    name,
    key: sonar.projectKey,
  })
  return `https://sonarcloud.io/projects/create?${params.toString()}`
}

export function generateSonarMcpSnippet(sonar: SonarConfig): string | undefined {
  if (!sonar.enabled) return undefined
  return JSON.stringify(
    {
      servers: {
        sonarqube: {
          url: sonar.hostUrl ?? SONAR_DEFAULT_HOST,
          token: "<SONAR_TOKEN>",
        },
      },
    },
    null,
    2,
  )
}

function harnessesForProfile(profile: HarnessProfile): KnownHarness[] {
  switch (profile.mode) {
    case "codex-first":
    case "fast":
      return ["codex", "claude"]
    case "claude-first":
      return ["claude", "codex"]
    case "codex-only":
      return ["codex"]
    case "claude-only":
      return ["claude"]
    case "opencode":
      return ["opencode"]
    case "self":
      return [profile.roles.coder.harness, profile.roles.reviewer.harness]
  }
}

function collectAvailableHarnesses(report: SetupReport): Set<KnownHarness> {
  const available = new Set<KnownHarness>()
  const byId = new Map(report.groups.flatMap(group => group.checks.map(check => [check.id, check.status] as const)))
  if (byId.get("llm.anthropic.cli") === "ok" && byId.get("llm.anthropic.auth") === "ok") available.add("claude")
  if (byId.get("llm.openai.cli") === "ok" && byId.get("llm.openai.auth") === "ok") available.add("codex")
  if (byId.get("llm.opencode.cli") === "ok" && byId.get("llm.opencode.auth") === "ok") available.add("opencode")
  return available
}

export function validateHarnessProfile(profile: HarnessProfile, appReport: SetupReport): ValidationResult {
  const warnings: string[] = []
  const available = collectAvailableHarnesses(appReport)
  const required = harnessesForProfile(profile)
  const missing = required.filter(harness => !available.has(harness))
  if (missing.length > 0) {
    return {
      ok: false,
      warnings,
      error: {
        code: "profile_references_unavailable_harness",
        detail: `Harness profile requires unavailable harnesses: ${Array.from(new Set(missing)).join(", ")}`,
      },
    }
  }
  if (profile.mode === "opencode") {
    for (const role of [profile.roles.coder, profile.roles.reviewer]) {
      if (!isKnownModel(role.provider, role.model)) {
        warnings.push(`Unknown ${role.provider} model "${role.model}" accepted for opencode profile`)
      }
    }
  }
  if (profile.mode === "self") {
    for (const role of [profile.roles.coder, profile.roles.reviewer]) {
      if (!isKnownModel(role.provider, role.model)) {
        warnings.push(`Unknown ${role.provider} model "${role.model}" accepted for self profile`)
      }
    }
  }
  return { ok: true, warnings }
}

export async function previewWorkspace(path: string, config: Pick<AppConfig, "allowedRoots">, repos: Repos): Promise<WorkspacePreview> {
  const base = await buildPathPreview(path, config.allowedRoots)
  const registeredByPath = repos.getWorkspaceByRootPath(base.path)
  return { ...base, isRegistered: Boolean(registeredByPath) }
}

export async function scaffoldWorkspace(root: string, opts: { createGitignore: boolean }): Promise<string[]> {
  await mkdir(root, { recursive: true })
  await mkdir(resolve(root, WORKSPACE_CONFIG_DIR), { recursive: true })
  const actions = [`created ${WORKSPACE_CONFIG_DIR}/`]
  if (opts.createGitignore) {
    const gitignorePath = resolve(root, ".gitignore")
    if (!(await pathExists(gitignorePath))) {
      await writeFile(
        gitignorePath,
        "# BeerEngineer workspace caches\n.beerengineer/runs/\n.beerengineer/cache/\n",
        "utf8",
      )
      actions.push("created .gitignore")
    }
  }
  return actions
}

export async function initGit(root: string, opts: { defaultBranch?: string; initialCommit?: boolean }): Promise<{ ok: boolean; detail?: string; actions: string[] }> {
  const branch = opts.defaultBranch ?? "main"
  const init = runGit(["init", "-b", branch], root)
  if (!init.ok) {
    const fallback = runGit(["init"], root)
    if (!fallback.ok) {
      return { ok: false, detail: init.stderr || fallback.stderr || "git init failed", actions: [] }
    }
    const head = runGit(["symbolic-ref", "HEAD", `refs/heads/${branch}`], root)
    if (!head.ok) {
      return { ok: false, detail: head.stderr || "failed to set default branch", actions: ["git init"] }
    }
  }
  const actions = [`git init (${branch})`]
  if (opts.initialCommit) {
    const add = runGit(["add", "."], root)
    if (!add.ok) return { ok: false, detail: add.stderr || "git add failed", actions }
    const commit = runGit(["commit", "-m", "Initial BeerEngineer scaffold"], root)
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

export async function registerWorkspace(input: RegisterWorkspaceInput, deps: RegisterDeps): Promise<RegisterResult> {
  const path = resolve(input.path)
  const preview = await previewWorkspace(path, deps.config, deps.repos)
  if (!preview.isInsideAllowedRoot) {
    return { ok: false, error: "path_outside_allowed_roots", detail: `Path ${path} is outside allowed roots` }
  }
  if (preview.exists && !preview.isDirectory) {
    return { ok: false, error: "path_not_directory", detail: `Path ${path} is not a directory` }
  }
  if (!preview.isWritable) {
    return { ok: false, error: "path_not_writable", detail: `Path ${path} is not writable` }
  }
  const existingConfig = await readWorkspaceConfig(path)
  const name = input.name ?? existingConfig?.name ?? basename(path)
  const key = input.key ?? existingConfig?.key ?? slugify(name)
  const sonar = normalizeSonarConfig(input.sonar ?? existingConfig?.sonar, key, deps.config.llm.defaultSonarOrganization)
  const validation = validateHarnessProfile(input.harnessProfile, deps.appReport)
  if (!validation.ok) {
    return { ok: false, error: validation.error?.code ?? "unknown", detail: validation.error?.detail ?? "invalid harness profile" }
  }

  const byPath = deps.repos.getWorkspaceByRootPath(path)
  if (byPath && byPath.key !== key) {
    return { ok: false, error: "path_already_registered", detail: `Path ${path} is already registered as ${byPath.key}` }
  }
  const byKey = deps.repos.getWorkspaceByKey(key)
  if (byKey && byKey.root_path && byKey.root_path !== path) {
    return { ok: false, error: "key_conflict", detail: `Workspace key ${key} is already registered for ${byKey.root_path}` }
  }

  const actions: string[] = []
  if (preview.isGreenfield || input.create) {
    try {
      actions.push(...await scaffoldWorkspace(path, { createGitignore: true }))
    } catch (err) {
      return { ok: false, error: "scaffold_failed", detail: (err as Error).message }
    }
  } else {
    await mkdir(resolve(path, WORKSPACE_CONFIG_DIR), { recursive: true })
  }

  const workspaceConfig = buildWorkspaceConfigFile({
    key,
    name,
    harnessProfile: input.harnessProfile,
    sonar,
    createdAt: existingConfig?.createdAt,
  })
  await writeWorkspaceConfig(path, workspaceConfig)
  actions.push(`wrote ${WORKSPACE_CONFIG_DIR}/${WORKSPACE_CONFIG_FILE}`)

  if (sonar.enabled && !preview.hasSonarProperties) {
    await writeSonarProperties(path, sonar, name)
    actions.push(`wrote ${SONAR_PROPERTIES_FILE}`)
  }

  const shouldInitGit = input.git?.init === true || (preview.isGreenfield && input.git?.init !== false)
  if (!preview.isGitRepo && shouldInitGit) {
    const git = await initGit(path, {
      defaultBranch: input.git?.defaultBranch ?? "main",
      initialCommit: preview.isGreenfield,
    })
    if (!git.ok) return { ok: false, error: "git_init_failed", detail: git.detail ?? "git init failed" }
    actions.push(...git.actions)
  }

  const dbRow = deps.repos.upsertWorkspace({
    key,
    name,
    description: byKey?.description ?? null,
    rootPath: path,
    harnessProfileJson: JSON.stringify(input.harnessProfile),
    sonarEnabled: sonar.enabled,
  })
  const workspace = previewFromDbRow(dbRow)
  const ghCommand = !preview.hasRemote ? `gh repo create ${key} --private --source .` : undefined

  return {
    ok: true,
    workspace,
    preview: await previewWorkspace(path, deps.config, deps.repos),
    actions: [...validation.warnings, ...actions],
    sonarProjectUrl: generateSonarProjectUrl(name, sonar),
    sonarMcpSnippet: generateSonarMcpSnippet(sonar),
    ghCreateCommand: ghCommand,
  }
}

export function listRegisteredWorkspaces(repos: Repos): WorkspaceRow[] {
  return repos.listWorkspaces().map(previewFromDbRow)
}

export function getRegisteredWorkspace(repos: Repos, key: string): WorkspaceRow | null {
  const row = repos.getWorkspaceByKey(key)
  return row ? previewFromDbRow(row) : null
}

export async function removeWorkspace(repos: Repos, key: string, opts: { purge: boolean }): Promise<{ ok: boolean; workspace?: WorkspaceRow; purgedPath?: string | null }> {
  const row = repos.getWorkspaceByKey(key)
  if (!row) return { ok: false }
  const workspace = previewFromDbRow(row)
  if (opts.purge && row.root_path) {
    await rm(row.root_path, { recursive: true, force: true })
  }
  repos.removeWorkspaceByKey(key)
  return { ok: true, workspace, purgedPath: opts.purge ? row.root_path : null }
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
  if (!preview.exists) console.log("    ✓ path does not exist — will be scaffolded")
  else if (preview.isGreenfield) console.log("    ✓ path exists and is empty — will be scaffolded in place")
  else console.log(`    ✓ path exists and is populated (${preview.existingFiles.length}+ top-level entries)`)
  console.log(`    ${preview.isInsideAllowedRoot ? "✓" : "!"} inside allowed roots`)
  console.log(`    ${preview.isGreenfield ? "· will be a greenfield workspace" : "· will be a brownfield registration"}`)
  if (preview.isGitRepo) console.log(`    · git repo detected${preview.defaultBranch ? ` (${preview.defaultBranch})` : ""}`)
  else console.log("    · no git repo detected")
  if (preview.detectedStack) console.log(`    · detected stack: ${preview.detectedStack}`)
  if (preview.hasWorkspaceConfigFile) console.log(`    · existing ${WORKSPACE_CONFIG_DIR}/${WORKSPACE_CONFIG_FILE} found`)
  if (preview.hasSonarProperties) console.log(`    · existing ${SONAR_PROPERTIES_FILE} found`)
  for (const conflict of preview.conflicts) console.log(`    ! ${conflict}`)
  console.log("")
}

export async function promptForWorkspaceAddDefaults(config: AppConfig): Promise<{
  path: string
  name?: string
  key?: string
  profile: HarnessProfile
  sonar: SonarConfig
  gitInit?: boolean
}> {
  const rl = createInterface({ input, output })
  try {
    const path = await promptLine(rl, "Path")
    const preview = { ...(await buildPathPreview(path, config.allowedRoots)), isRegistered: false }
    renderPreviewSummary(preview)

    const name = await promptLine(rl, "Name", basename(path))
    const key = await promptLine(rl, "Key", slugify(name))

    console.log("\n  Harness profile")
    console.log("    1) codex-first")
    console.log("    2) claude-first")
    console.log("    3) codex-only")
    console.log("    4) claude-only")
    console.log("    5) fast")
    const choice = await promptLine(rl, "Pick [1-5] or [d]efault", "d")
    const profileMap: Record<string, HarnessProfile> = {
      "1": { mode: "codex-first" },
      "2": { mode: "claude-first" },
      "3": { mode: "codex-only" },
      "4": { mode: "claude-only" },
      "5": { mode: "fast" },
      d: config.llm.defaultHarnessProfile,
    }
    const profile = profileMap[choice.toLowerCase()] ?? config.llm.defaultHarnessProfile

    console.log("")
    const enableSonar = await promptYesNo(rl, "Enable Sonar for this workspace?", false)
    const sonar = enableSonar
      ? {
          enabled: true,
          projectKey: await promptLine(rl, "Project key", key),
          organization: await promptLine(rl, "Organization", config.llm.defaultSonarOrganization ?? ""),
          hostUrl: await promptLine(rl, "Host URL", SONAR_DEFAULT_HOST),
        }
      : { enabled: false }

    const defaultGitInit = preview.isGreenfield || !preview.isGitRepo
    const gitInit = await promptYesNo(rl, "Initialize git?", defaultGitInit)
    const proceed = await promptYesNo(rl, "Proceed?", true)
    if (!proceed) {
      throw new Error("workspace add cancelled")
    }
    return { path, name, key, profile, sonar, gitInit }
  } finally {
    rl.close()
  }
}

export async function backfillWorkspaceConfigs(repos: Repos): Promise<{
  written: string[]
  skipped: Array<{ key: string; reason: string }>
}> {
  const written: string[] = []
  const skipped: Array<{ key: string; reason: string }> = []
  for (const row of repos.listWorkspaces()) {
    if (!row.root_path) {
      skipped.push({ key: row.key, reason: "missing root_path" })
      continue
    }
    const root = resolve(row.root_path)
    const exists = await pathExists(root)
    if (!exists) {
      skipped.push({ key: row.key, reason: "root_path does not exist" })
      continue
    }
    const writable = await isWritablePath(root)
    if (!writable) {
      skipped.push({ key: row.key, reason: "root_path is not writable" })
      continue
    }
    if (await readWorkspaceConfig(root)) {
      skipped.push({ key: row.key, reason: "workspace config already exists" })
      continue
    }
    const harnessProfile = JSON.parse(row.harness_profile_json) as HarnessProfile
    const config = buildWorkspaceConfigFile({
      key: row.key,
      name: row.name,
      harnessProfile,
      sonar: { enabled: row.sonar_enabled === 1 },
      createdAt: row.created_at,
    })
    await writeWorkspaceConfig(root, config)
    written.push(row.key)
  }
  return { written, skipped }
}
