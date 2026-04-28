import { spawnSync } from "node:child_process"
import { access, glob, mkdir, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises"
import { constants } from "node:fs"
import { randomBytes } from "node:crypto"
import { basename, dirname, relative, resolve, sep } from "node:path"
import { createInterface } from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import type { Repos, WorkspaceRow as DbWorkspaceRow } from "../db/repositories.js"
import { isKnownModel } from "./harness/models.js"
import presetsJson from "./harness/presets.json" with { type: "json" }

type PresetRoleEntry = { harness: KnownHarness; runtime?: "cli" | "sdk" }
type PresetEntry = {
  coder: PresetRoleEntry
  reviewer: PresetRoleEntry
  "merge-resolver"?: PresetRoleEntry
}
const PRESETS = (presetsJson as { presets: Record<string, PresetEntry> }).presets

function pairsFromPreset(presetKey: string): Array<{ harness: KnownHarness; runtime: "cli" | "sdk" }> {
  const preset = PRESETS[presetKey]
  if (!preset) return []
  const roles: Array<PresetRoleEntry | undefined> = [preset.coder, preset.reviewer, preset["merge-resolver"]]
  return roles
    .filter((r): r is PresetRoleEntry => Boolean(r))
    .map(r => ({ harness: r.harness, runtime: r.runtime ?? "cli" }))
}
import type { AppConfig, SetupReport, SonarReadiness } from "../setup/types.js"
import {
  DEFAULT_WORKSPACE_RUNTIME_POLICY,
} from "../types/workspace.js"
import type {
  HarnessProfile,
  KnownHarness,
  RegisterResult,
  RegisterWorkspaceInput,
  RuntimePolicyMode,
  SonarConfig,
  ValidationResult,
  WorkspaceConfigFile,
  WorkspacePreviewConfig,
  WorkspacePreflightReport,
  WorkspaceReviewPolicy,
  WorkspaceRuntimePolicy,
  WorkspacePreview,
  WorkspaceRow,
} from "../types/workspace.js"

const WORKSPACE_SCHEMA_VERSION = 2 as const
const SONAR_DEFAULT_HOST = "https://sonarcloud.io"
const WORKSPACE_CONFIG_DIR = ".beerengineer"
const WORKSPACE_CONFIG_FILE = "workspace.json"
const SONAR_PROPERTIES_FILE = "sonar-project.properties"
const GITIGNORE_FILE = ".gitignore"
const SONAR_WORKFLOW_FILE = ".github/workflows/sonar.yml"
const CODERABBIT_CONFIG_FILE = ".coderabbit.yaml"
// Post-rooting layout: persisted run state lives under
// `.beerengineer/workspaces/<fsId>/...` and managed worktrees under
// `.beerengineer/worktrees/<fsId>/...`. `workspace.json` stays tracked.
const BEERENGINEER_GITIGNORE_ENTRIES = [
  ".env.local",
  ".beerengineer/workspaces/",
  ".beerengineer/worktrees/",
  ".beerengineer/cache/",
]
const SONAR_GENERATOR_ROOTS = ["apps", "packages", "services", "libs", "src", "lib"] as const
const SONAR_DEFAULT_TEST_INCLUSIONS = "**/*.test.ts,**/*.spec.ts,**/*.test.tsx,**/*.spec.tsx"
const SONAR_DEFAULT_EXCLUSIONS = "**/node_modules/**,**/dist/**,**/.next/**"
const SONAR_DEFAULT_LCOV_PATH = "coverage/**/lcov.info"

type SonarProperties = Record<string, string>

type CoverageProducerDetection = {
  stack: "js-ts" | "unknown"
  hasProducer: boolean
  reasons: string[]
}

function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function slugify(input: string): string {
  const core = input
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
  if (core) return core
  // Empty slug (e.g. `.`, `/`): fall back to a random suffix rather than the
  // fixed string `workspace`, which would collide across keyless registrations.
  return `workspace-${randomBytes(3).toString("hex")}`
}

function workspaceConfigPath(root: string): string {
  return resolve(root, WORKSPACE_CONFIG_DIR, WORKSPACE_CONFIG_FILE)
}

function sonarPropertiesPath(root: string): string {
  return resolve(root, SONAR_PROPERTIES_FILE)
}

function gitignorePath(root: string): string {
  return resolve(root, GITIGNORE_FILE)
}

function sonarWorkflowPath(root: string): string {
  return resolve(root, SONAR_WORKFLOW_FILE)
}

function coderabbitConfigPath(root: string): string {
  return resolve(root, CODERABBIT_CONFIG_FILE)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function splitCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map(entry => entry.trim())
    .filter(Boolean)
}

function hasGlobMagic(value: string): boolean {
  return /[*?[{\]]/.test(value)
}

function parseSonarProperties(raw: string): SonarProperties {
  const props: SonarProperties = {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const idx = trimmed.indexOf("=")
    if (idx <= 0) continue
    props[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim()
  }
  return props
}

async function expandWorkspacePattern(root: string, pattern: string): Promise<string[]> {
  if (!pattern.trim()) return []
  if (!hasGlobMagic(pattern)) {
    const absolute = resolve(root, pattern)
    return await pathExists(absolute) ? [absolute] : []
  }
  const matches = await collectGlobMatches(glob(pattern, {
    cwd: root,
    exclude: path => path.includes(`${sep}node_modules${sep}`),
  }))
  return matches.map(match => resolve(root, match))
}

async function readJsonIfPresent<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T
  } catch {
    return null
  }
}

async function collectGlobMatches(iterator: AsyncIterable<string>): Promise<string[]> {
  const matches: string[] = []
  for await (const match of iterator) matches.push(match)
  return matches
}

async function listWorkspacePackageFiles(root: string, rawWorkspaces: unknown): Promise<string[]> {
  let patterns: string[] = []
  if (Array.isArray(rawWorkspaces)) {
    patterns = rawWorkspaces.filter((value): value is string => typeof value === "string")
  } else if (rawWorkspaces && typeof rawWorkspaces === "object" && Array.isArray((rawWorkspaces as { packages?: unknown }).packages)) {
    patterns = (rawWorkspaces as { packages: unknown[] }).packages.filter((value): value is string => typeof value === "string")
  }
  const files = new Set<string>()
  for (const pattern of patterns) {
    for (const match of await collectGlobMatches(glob(pattern.replace(/\/?$/, "/package.json"), { cwd: root }))) {
      files.add(resolve(root, match))
    }
  }
  return Array.from(files)
}

type PackageJsonShape = {
  workspaces?: unknown
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

function packageLooksLikeCoverageProducer(pkg: PackageJsonShape | null): string[] {
  if (!pkg) return []
  const hits: string[] = []
  const scripts = pkg.scripts ?? {}
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  for (const [name, script] of Object.entries(scripts)) {
    const lower = script.toLowerCase()
    if (name === "coverage") hits.push(`script:${name}`)
    if (/\b(c8|vitest)\b/.test(lower)) hits.push(`script:${name}`)
    if (lower.includes("--coverage")) hits.push(`script:${name}`)
  }
  if (deps.c8) hits.push("dependency:c8")
  if (deps.vitest) hits.push("dependency:vitest")
  return Array.from(new Set(hits))
}

async function detectCoverageProducer(root: string): Promise<CoverageProducerDetection> {
  const rootPkgPath = resolve(root, "package.json")
  if (!(await pathExists(rootPkgPath))) {
    return { stack: "unknown", hasProducer: false, reasons: [] }
  }

  const rootPkg = await readJsonIfPresent<PackageJsonShape>(rootPkgPath)
  const reasons = new Set(packageLooksLikeCoverageProducer(rootPkg))
  for (const file of await listWorkspacePackageFiles(root, rootPkg?.workspaces)) {
    const pkg = await readJsonIfPresent<PackageJsonShape>(file)
    for (const hit of packageLooksLikeCoverageProducer(pkg)) reasons.add(`${relative(root, file)}:${hit}`)
  }

  return {
    stack: "js-ts",
    hasProducer: reasons.size > 0,
    reasons: Array.from(reasons),
  }
}

async function detectSonarSourceRoots(root: string): Promise<string[]> {
  const roots: string[] = []
  for (const candidate of SONAR_GENERATOR_ROOTS) {
    if (await pathExists(resolve(root, candidate))) roots.push(candidate)
  }
  return roots
}

async function loadWorkspaceSonarProperties(root: string): Promise<SonarProperties | null> {
  try {
    return parseSonarProperties(await readFile(sonarPropertiesPath(root), "utf8"))
  } catch {
    return null
  }
}

async function validateSonarProperties(root: string, props: SonarProperties | null): Promise<SonarReadiness> {
  const warnings: string[] = []
  const details: NonNullable<SonarReadiness["details"]> = {}
  const coverageProducer = await detectCoverageProducer(root)

  if (!props) {
    const readiness: SonarReadiness = {
      scanner: "unknown",
      token: "unknown",
      config: "missing",
      coverage: coverageProducer.stack === "js-ts" ? "not-configured" : "unknown",
      warnings,
      details: { config: `${SONAR_PROPERTIES_FILE} is missing` },
    }
    return readiness
  }

  const sourceEntries = splitCsv(props["sonar.sources"])
  if (sourceEntries.length === 0) {
    details.config = 'Missing required "sonar.sources"'
  } else {
    const missing: string[] = []
    for (const entry of sourceEntries) {
      const matches = await expandWorkspacePattern(root, entry)
      if (matches.length === 0) missing.push(entry)
    }
    if (missing.length > 0) {
      details.config = `Source path${missing.length > 1 ? "s" : ""} not found: ${missing.join(", ")}`
    }
  }

  for (const key of ["sonar.tests", "sonar.test.inclusions", "sonar.exclusions", "sonar.test.exclusions", "sonar.coverage.exclusions"] as const) {
    for (const entry of splitCsv(props[key])) {
      const matches = await expandWorkspacePattern(root, entry)
      if (matches.length === 0 && key.includes("exclusions") && !hasGlobMagic(entry)) {
        warnings.push(`${key} entry matches nothing: ${entry}`)
      }
    }
  }

  const lcovEntries = splitCsv(props["sonar.javascript.lcov.reportPaths"])
  let coverage: SonarReadiness["coverage"]
  if (lcovEntries.length === 0) {
    if (coverageProducer.stack === "js-ts") {
      coverage = "not-configured"
      details.coverage = coverageProducer.hasProducer
        ? "Coverage producer detected, but Sonar LCOV import is not configured."
        : "No LCOV import configured."
    } else {
      coverage = "unknown"
      details.coverage = "Coverage detection is stack-specific and was not inferred."
    }
  } else {
    const lcovMatches = await Promise.all(lcovEntries.map(entry => expandWorkspacePattern(root, entry)))
    const existingFiles = lcovMatches.flat()
    if (existingFiles.length > 0) {
      coverage = "ok"
      details.coverage = `LCOV artifact${existingFiles.length > 1 ? "s" : ""} present`
    } else if (coverageProducer.stack === "js-ts" && coverageProducer.hasProducer) {
      coverage = "artifact-missing"
      details.coverage = `Coverage command detected, but ${lcovEntries.join(", ")} has not been generated yet`
    } else if (coverageProducer.stack === "js-ts") {
      coverage = "producer-missing"
      details.coverage = "Coverage import configured but no JS/TS coverage producer was detected"
      warnings.push("Coverage import configured but no coverage command was detected")
    } else {
      coverage = "unknown"
      details.coverage = "Coverage import configured, but no matching artifact exists yet"
    }
  }

  return {
    scanner: "unknown",
    token: "unknown",
    config: details.config ? "invalid" : "ok",
    coverage,
    warnings,
    details,
  }
}

function mergeSonarReadiness(base: SonarReadiness, extra: Partial<SonarReadiness>): SonarReadiness {
  return {
    scanner: extra.scanner ?? base.scanner,
    token: extra.token ?? base.token,
    config: extra.config ?? base.config,
    coverage: extra.coverage ?? base.coverage,
    warnings: Array.from(new Set([...base.warnings, ...(extra.warnings ?? [])])),
    details: {
      ...base.details,
      ...extra.details,
    },
  }
}

function probeSonarScanner(root: string): Pick<SonarReadiness, "scanner" | "details"> {
  const scanner = runCommand("sonar-scanner", ["--version"], root)
  return {
    scanner: scanner.ok ? "ok" : "missing",
    details: {
      scanner: scanner.ok
        ? scanner.stdout.split(/\r?\n/)[0] || "sonar-scanner available"
        : scanner.stderr || "sonar-scanner is not available on PATH",
    },
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

function isContained(child: string, parent: string): boolean {
  if (child === parent) return true
  const rel = relative(parent, child)
  if (!rel || rel === "") return true
  if (rel.startsWith("..")) return false
  // `path.isAbsolute(rel)` is true on Windows when the child is on a different
  // drive, which also means "not contained".
  return !rel.startsWith(sep) && !/^[A-Za-z]:/.test(rel)
}

function isInsideAllowedRoot(path: string, allowedRoots: string[]): boolean {
  return allowedRoots.some(root => isContained(path, resolve(root)))
}

async function realpathOrResolve(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return resolve(path)
  }
}

// A link-resolved containment check. Used for destructive ops like purge so a
// symlink planted inside an allowed root can't point rm -rf at a path outside.
export async function isInsideAllowedRootRealpath(path: string, allowedRoots: string[]): Promise<boolean> {
  const resolvedChild = await realpathOrResolve(path)
  for (const root of allowedRoots) {
    const resolvedRoot = await realpathOrResolve(root)
    if (isContained(resolvedChild, resolvedRoot)) return true
  }
  return false
}

function hasGitIdentityConfigured(cwd: string): boolean {
  const email = spawnSync("git", ["config", "--get", "user.email"], { cwd, encoding: "utf8" })
  const name = spawnSync("git", ["config", "--get", "user.name"], { cwd, encoding: "utf8" })
  return email.status === 0 && !!email.stdout?.trim() && name.status === 0 && !!name.stdout?.trim()
}

function runGit(args: string[], cwd: string): { ok: boolean; stdout: string; stderr: string } {
  // Only inject the beerengineer_ fallback identity for commits AND only when the
  // user has neither env vars nor git config set. GIT_AUTHOR_* env takes
  // precedence over git config, so blind injection would silently hijack a
  // configured user's identity on the empty initial commit.
  let env: NodeJS.ProcessEnv = process.env
  if (args[0] === "commit") {
    const hasEnvIdentity = process.env.GIT_AUTHOR_EMAIL && process.env.GIT_AUTHOR_NAME
    if (!hasEnvIdentity && !hasGitIdentityConfigured(cwd)) {
      env = {
        ...process.env,
        GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME ?? "beerengineer_",
        GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL ?? "beerengineer@example.invalid",
        GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME ?? "beerengineer_",
        GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL ?? "beerengineer@example.invalid",
      }
    }
  }
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env })
  return {
    ok: result.status === 0,
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? "",
  }
}

function runCommand(command: string, args: string[], cwd: string): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" })
  return {
    ok: result.status === 0,
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? "",
  }
}

function readEnvFileValue(raw: string, key: string): string | undefined {
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const match = /^([A-Za-z_]\w*)\s*=\s*(.*)$/.exec(trimmed)
    if (match?.[1] !== key) continue
    const value = match[2].trim()
    return value.replaceAll(/^['"]|['"]$/g, "")
  }
  return undefined
}

function parseGitHubRemote(remoteUrl: string): { owner: string; repo: string } | null {
  // Repo capture rejects `/` to avoid mis-parsing URLs like
  // https://github.com/owner/repo/tree/main as repo="repo/tree/main".
  const ssh = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/.exec(remoteUrl)
  if (ssh) return { owner: ssh[1], repo: ssh[2] }
  const https = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(remoteUrl)
  if (https) return { owner: https[1], repo: https[2] }
  return null
}

function isEngineOwnedBranch(branch: string): boolean {
  return /^(item|proj|wave|story|candidate)\//.test(branch)
}

function resolveGitDefaultBranch(root: string): string | null {
  const originHead = runGit(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], root)
  if (originHead.ok && originHead.stdout) {
    return originHead.stdout.replace(/^origin\//, "") || null
  }

  const remoteShow = runGit(["remote", "show", "origin"], root)
  if (remoteShow.ok) {
    const match = /^\s*HEAD branch:\s+(.+)$/m.exec(remoteShow.stdout)
    const branch = match?.[1]?.trim()
    if (branch) return branch
  }

  const currentBranch = runGit(["branch", "--show-current"], root)
  if (currentBranch.ok && currentBranch.stdout && !isEngineOwnedBranch(currentBranch.stdout)) {
    return currentBranch.stdout
  }

  for (const candidate of ["main", "master"]) {
    if (runGit(["rev-parse", "--verify", "--quiet", `refs/heads/${candidate}`], root).ok) {
      return candidate
    }
  }

  return null
}

async function detectSonarToken(root: string): Promise<{ value?: string; source?: "env" | ".env.local" }> {
  if (process.env.SONAR_TOKEN) return { value: process.env.SONAR_TOKEN, source: "env" }
  try {
    const envLocal = await readFile(resolve(root, ".env.local"), "utf8")
    const value = readEnvFileValue(envLocal, "SONAR_TOKEN")
    if (value) return { value, source: ".env.local" }
  } catch {
    // ignore
  }
  return {}
}

async function persistSonarTokenToEnvLocal(root: string, token: string): Promise<void> {
  const envLocalPath = resolve(root, ".env.local")
  let existing = ""
  try {
    existing = await readFile(envLocalPath, "utf8")
  } catch {
    // file doesn't exist yet — fine
  }
  const lines = existing.split(/\r?\n/).filter(line => !/^SONAR_TOKEN\s*=/.test(line))
  const trimmed = lines.filter((line, idx) => !(idx === lines.length - 1 && line === "")).join("\n")
  const prefix = trimmed ? `${trimmed}\n` : ""
  const next = `${prefix}SONAR_TOKEN=${token}\n`
  await writeFile(envLocalPath, next)
}

function sonarBearerAuthHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` }
}

function sonarBasicAuthHeader(token: string): Record<string, string> {
  const auth = Buffer.from(`${token}:`).toString("base64")
  return { authorization: `Basic ${auth}` }
}

async function fetchSonarWithAuth(
  url: URL | string,
  init: Omit<RequestInit, "signal"> & { token: string; timeoutMs?: number },
): Promise<Response> {
  const { token, headers, timeoutMs = 5000, ...rest } = init
  const bearer = await fetch(url, {
    ...rest,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      ...headers,
      ...sonarBearerAuthHeader(token),
    },
  })
  if (bearer.status !== 401) return bearer
  // Give the compatibility fallback its own timeout budget instead of reusing
  // the Bearer attempt's signal, which may already be close to expiry.
  return fetch(url, {
    ...rest,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      ...headers,
      ...sonarBasicAuthHeader(token),
    },
  })
}

async function validateSonarToken(token: string, host = SONAR_DEFAULT_HOST): Promise<boolean> {
  try {
    const response = await fetchSonarWithAuth(`${host}/api/authentication/validate`, {
      token,
      timeoutMs: 5000,
    })
    if (!response.ok) return false
    const body = await response.json() as { valid?: boolean }
    return body.valid === true
  } catch {
    return false
  }
}

async function sonarProjectExists(token: string, organization: string, projectKey: string, host = SONAR_DEFAULT_HOST): Promise<boolean> {
  try {
    const url = new URL(`${host}/api/projects/search`)
    url.searchParams.set("organization", organization)
    url.searchParams.set("projects", projectKey)
    const response = await fetchSonarWithAuth(url, {
      token,
      timeoutMs: 5000,
    })
    if (!response.ok) return false
    const body = await response.json() as { components?: unknown[] }
    return Array.isArray(body.components) && body.components.length > 0
  } catch {
    return false
  }
}

export type SonarCreateResult =
  | { ok: true; created: true }
  | { ok: true; created: false; reason: "already-exists" }
  | { ok: false; reason: string }

async function createSonarProject(
  token: string,
  organization: string,
  projectKey: string,
  name: string,
  visibility: "public" | "private" = "private",
  host = SONAR_DEFAULT_HOST,
): Promise<SonarCreateResult> {
  try {
    if (await sonarProjectExists(token, organization, projectKey, host)) {
      return { ok: true, created: false, reason: "already-exists" }
    }
    const url = new URL(`${host}/api/projects/create`)
    url.searchParams.set("organization", organization)
    url.searchParams.set("project", projectKey)
    url.searchParams.set("name", name)
    url.searchParams.set("visibility", visibility)
    const response = await fetchSonarWithAuth(url, {
      token,
      method: "POST",
      timeoutMs: 8000,
    })
    if (response.ok) return { ok: true, created: true }
    const detail = await response.text().catch(() => "")
    return { ok: false, reason: `HTTP ${response.status}: ${detail.slice(0, 200)}` }
  } catch (err) {
    return { ok: false, reason: (err as Error).message }
  }
}

async function sonarPost(
  token: string,
  path: string,
  params: Record<string, string>,
  host = SONAR_DEFAULT_HOST,
): Promise<{ ok: boolean; status: number; detail: string }> {
  try {
    const url = new URL(`${host}${path}`)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    const response = await fetchSonarWithAuth(url, {
      token,
      method: "POST",
      timeoutMs: 8000,
    })
    if (response.ok) return { ok: true, status: response.status, detail: "" }
    const detail = (await response.text().catch(() => "")).slice(0, 200)
    return { ok: false, status: response.status, detail }
  } catch (err) {
    return { ok: false, status: 0, detail: (err as Error).message }
  }
}

async function findSonarQualityGateId(
  token: string,
  organization: string,
  gateName: string,
  host = SONAR_DEFAULT_HOST,
): Promise<string | undefined> {
  try {
    const url = new URL(`${host}/api/qualitygates/list`)
    url.searchParams.set("organization", organization)
    const response = await fetchSonarWithAuth(url, {
      token,
      timeoutMs: 5000,
    })
    if (response.ok) {
      const body = await response.json() as { qualitygates?: Array<{ name?: string; id?: string | number }> }
      const hit = (body.qualitygates ?? []).find(g => g.name === gateName)
      if (hit?.id === undefined) return undefined
      return String(hit.id)
    }
    return undefined
  } catch {
    return undefined
  }
}

async function assignSonarQualityGate(
  token: string,
  organization: string,
  projectKey: string,
  gateName: string,
  host = SONAR_DEFAULT_HOST,
): Promise<{ ok: boolean; reason: string }> {
  const gateId = await findSonarQualityGateId(token, organization, gateName, host)
  if (!gateId) {
    return { ok: false, reason: `quality gate "${gateName}" not found in ${organization}` }
  }
  const result = await sonarPost(token, "/api/qualitygates/select", {
    organization,
    projectKey,
    gateId,
  }, host)
  if (result.ok) return { ok: true, reason: "" }
  return { ok: false, reason: `HTTP ${result.status}: ${result.detail}` }
}

async function disableSonarAutoScan(
  token: string,
  projectKey: string,
  host = SONAR_DEFAULT_HOST,
): Promise<{ ok: boolean; reason: string }> {
  const result = await sonarPost(token, "/api/autoscan/activation", {
    projectKey,
    enable: "false",
  }, host)
  if (result.ok) return { ok: true, reason: "" }
  return { ok: false, reason: `HTTP ${result.status}: ${result.detail}` }
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
  const defaultBranch = isGitRepo ? resolveGitDefaultBranch(resolvedPath) : null
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

async function ensureManagedGitignore(root: string): Promise<{ changed: boolean }> {
  const path = gitignorePath(root)
  const exists = await pathExists(path)
  const current = exists ? await readFile(path, "utf8") : ""
  const existingLines = new Set(current.split(/\r?\n/).map(line => line.trim()))
  const missing = BEERENGINEER_GITIGNORE_ENTRIES.filter(entry => !existingLines.has(entry))
  if (missing.length === 0) return { changed: false }

  const prefix = current.length > 0 && !current.endsWith("\n") ? `${current}\n` : current
  const body = exists
    ? `${prefix}${missing.join("\n")}\n`
    : `# beerengineer_ managed\n${BEERENGINEER_GITIGNORE_ENTRIES.join("\n")}\n`
  await writeFile(path, body, "utf8")
  return { changed: true }
}

async function writeFileIfMissing(path: string, content: string): Promise<boolean> {
  if (await pathExists(path)) return false
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, "utf8")
  return true
}

async function ensureGitRepo(root: string, defaultBranch = "main"): Promise<{ ok: boolean; actions: string[]; detail?: string }> {
  const insideRepo = runGit(["rev-parse", "--is-inside-work-tree"], root)
  if (insideRepo.ok && insideRepo.stdout === "true") {
    return { ok: true, actions: [] }
  }

  const init = await initGit(root, { defaultBranch, initialCommit: false })
  if (!init.ok) return init

  const head = runGit(["rev-parse", "--verify", "HEAD"], root)
  const actions = [...init.actions]
  if (!head.ok) {
    const commit = runGit(["commit", "--allow-empty", "-m", "Initial repository commit"], root)
    if (!commit.ok) {
      return { ok: false, actions, detail: commit.stderr || "git commit failed" }
    }
    actions.push("git initial empty commit")
  }
  return { ok: true, actions }
}

export async function runWorkspacePreflight(
  root: string,
  options: { sonarHostUrl?: string; sonarEnabled?: boolean } = {},
): Promise<{ report: WorkspacePreflightReport }> {
  const gitProbe = runGit(["rev-parse", "--is-inside-work-tree"], root)
  const defaultBranch = gitProbe.ok ? resolveGitDefaultBranch(root) : null
  const remoteProbe = gitProbe.ok ? runGit(["remote", "get-url", "origin"], root) : { ok: false, stdout: "", stderr: "" }
  const parsedRemote = remoteProbe.ok ? parseGitHubRemote(remoteProbe.stdout) : null

  const ghVersion = runCommand("gh", ["--version"], root)
  const ghStatus = ghVersion.ok ? runCommand("gh", ["auth", "status"], root) : { ok: false, stdout: "", stderr: "gh unavailable" }
  let ghUser: string | undefined
  if (ghStatus.ok) {
    const userProbe = runCommand("gh", ["api", "user", "--jq", ".login"], root)
    ghUser = userProbe.ok ? userProbe.stdout : undefined
  }

  const sonarToken = await detectSonarToken(root)
  const sonarHost = options.sonarHostUrl ?? SONAR_DEFAULT_HOST
  const sonarValid = sonarToken.value ? await validateSonarToken(sonarToken.value, sonarHost) : undefined
  const localSonarReadiness = await validateSonarProperties(root, await loadWorkspaceSonarProperties(root))
  const scannerReadiness = probeSonarScanner(root)
  let sonarTokenStatus: "ok" | "invalid" | "missing" = "missing"
  if (sonarToken.value) {
    sonarTokenStatus = sonarValid ? "ok" : "invalid"
  }
  const sonarReadiness = mergeSonarReadiness(localSonarReadiness, {
    scanner: scannerReadiness.scanner,
    token: sonarTokenStatus,
    details: {
      ...scannerReadiness.details,
      token: (() => {
        if (!sonarToken.value) return "SONAR_TOKEN was not found in env or .env.local"
        return sonarValid
          ? `SONAR_TOKEN validated against ${sonarHost}`
          : `SONAR_TOKEN failed validation against ${sonarHost}`
      })(),
    },
  })
  let sonarStatus: WorkspacePreflightReport["sonar"]["status"]
  if (!sonarToken.value) {
    sonarStatus = options.sonarEnabled || localSonarReadiness.config !== "missing" ? "missing" : "skipped"
  } else if (!options.sonarEnabled && localSonarReadiness.config === "missing") {
    sonarStatus = sonarValid ? "ok" : "invalid"
  } else if (sonarValid && localSonarReadiness.config === "ok") {
    sonarStatus = "ok"
  } else if (localSonarReadiness.config === "missing") {
    sonarStatus = "missing"
  } else {
    sonarStatus = "invalid"
  }
  let sonarDetail: string | undefined
  if (localSonarReadiness.config === "invalid") {
    sonarDetail = localSonarReadiness.details?.config
  } else if (sonarToken.value && sonarValid) {
    sonarDetail = sonarReadiness.details?.coverage
  } else if (sonarToken.value) {
    sonarDetail = "SONAR_TOKEN failed Sonar validation"
  } else {
    sonarDetail = "SONAR_TOKEN was not found in env or .env.local"
  }

  const coderabbitCli = runCommand("coderabbit", ["--version"], root)
  const crCli = coderabbitCli.ok ? coderabbitCli : runCommand("cr", ["--version"], root)

  return {
    report: {
      git: {
        status: gitProbe.ok && gitProbe.stdout === "true" ? "ok" : "missing",
        detail: gitProbe.ok ? undefined : (gitProbe.stderr || undefined),
      },
      github: parsedRemote
        ? {
            status: "ok",
            owner: parsedRemote.owner,
            repo: parsedRemote.repo,
            defaultBranch,
            remoteUrl: remoteProbe.stdout,
          }
        : {
            status: remoteProbe.ok ? "invalid" : "missing",
            detail: remoteProbe.ok ? "origin is not a GitHub remote" : remoteProbe.stderr || "origin remote is not configured",
            defaultBranch,
            remoteUrl: remoteProbe.ok ? remoteProbe.stdout : undefined,
          },
      gh: ghStatus.ok
        ? {
            status: "ok",
            user: ghUser,
          }
        : {
            status: ghVersion.ok ? "missing" : "skipped",
            detail: ghVersion.ok ? (ghStatus.stderr || "gh auth status failed") : "GitHub CLI is not available",
          },
      sonar: {
        status: sonarStatus,
        tokenSource: sonarToken.source,
        tokenValid: sonarValid,
        readiness: sonarReadiness,
        detail: sonarDetail,
      },
      coderabbit: crCli.ok
        ? {
            status: "ok",
            detail: `CodeRabbit CLI available (${crCli.stdout.split(/\r?\n/)[0] || "unknown version"})`,
          }
        : {
            status: "missing",
            detail: "CodeRabbit CLI not found — install with `npm i -g @coderabbit/cli`",
          },
      checkedAt: new Date().toISOString(),
    },
  }
}

async function buildGeneratedSonarProperties(root: string, owner: string, repo: string): Promise<{
  content?: string
  warnings: string[]
}> {
  const sourceRoots = await detectSonarSourceRoots(root)
  if (sourceRoots.length === 0) {
    return {
      warnings: [
        "Sonar config generation skipped: no supported source roots were detected. Add sonar-project.properties manually if your repo uses a non-standard layout.",
      ],
    }
  }

  const coverageProducer = await detectCoverageProducer(root)
  const lines = [
    `sonar.projectKey=${owner}_${repo}`,
    `sonar.organization=${owner}`,
    `sonar.sources=${sourceRoots.join(",")}`,
    "sonar.tests=.",
    `sonar.test.inclusions=${SONAR_DEFAULT_TEST_INCLUSIONS}`,
    `sonar.exclusions=${SONAR_DEFAULT_EXCLUSIONS}`,
  ]
  if (coverageProducer.stack === "js-ts" && coverageProducer.hasProducer) {
    lines.push(`sonar.javascript.lcov.reportPaths=${SONAR_DEFAULT_LCOV_PATH}`)
  }
  return { content: `${lines.join("\n")}\n`, warnings: [] }
}

function renderSonarWorkflow(): string {
  return [
    "name: SonarCloud",
    "",
    "on:",
    "  push:",
    "    branches:",
    "      - main",
    "  pull_request:",
    "",
    "jobs:",
    "  sonarcloud:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "        with:",
    "          fetch-depth: 0",
    "      - uses: actions/setup-node@v4",
    "        with:",
    "          node-version: 22",
    "      - name: SonarCloud Scan",
    "        uses: SonarSource/sonarqube-scan-action@v5",
    "        env:",
    "          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}",
  ].join("\n") + "\n"
}

function renderCoderabbitConfig(): string {
  return [
    "reviews:",
    "  profile: chill",
    "  request_changes_workflow: false",
    "  auto_review:",
    "    enabled: true",
    "    drafts: false",
    "language: en-US",
  ].join("\n") + "\n"
}

function generateCodeRabbitInstallUrl(): string {
  // Generic install flow — GitHub asks the user to pick the target account.
  // Avoids guessing User vs Organization (the previous `target_type=Organization`
  // 404s for personal accounts) and sidesteps needing numeric target_id lookups.
  return "https://github.com/apps/coderabbitai/installations/new"
}

function safeParseHarnessProfile(raw: string): { profile: HarnessProfile | null; error?: string } {
  try {
    return { profile: JSON.parse(raw) as HarnessProfile }
  } catch (err) {
    return { profile: null, error: (err as Error).message }
  }
}

function previewFromDbRow(row: DbWorkspaceRow): WorkspaceRow {
  const parsed = safeParseHarnessProfile(row.harness_profile_json)
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    key: row.key,
    name: row.name,
    rootPath: row.root_path ?? "",
    harnessProfile: parsed.profile,
    harnessProfileInvalid: parsed.error,
    sonarEnabled: row.sonar_enabled === 1,
    createdAt: row.created_at,
    lastOpenedAt: row.last_opened_at,
  }
}

function normalizeSonarConfig(config: SonarConfig | undefined, key: string, defaultOrg?: string): SonarConfig {
  if (!config?.enabled) return { enabled: false }
  const region = config.region ?? "eu"
  return {
    enabled: true,
    projectKey: config.projectKey ?? key,
    organization: config.organization ?? defaultOrg,
    hostUrl: config.hostUrl ?? (region === "us" ? "https://sonarqube.us" : SONAR_DEFAULT_HOST),
    region,
    planTier: config.planTier ?? "unknown",
    baseBranch: config.baseBranch,
    scanTimeoutMs: config.scanTimeoutMs,
  }
}

function normalizeReviewPolicy(
  policy: WorkspaceReviewPolicy | undefined,
  legacySonar: SonarConfig | undefined,
  key: string,
  defaultOrg?: string,
  coderabbitCliAvailable: boolean = false,
): WorkspaceReviewPolicy {
  const coderabbitExplicit = policy?.coderabbit?.enabled
  return {
    coderabbit: {
      // CodeRabbit CLI runs locally on a diff — no GitHub App required.
      // Default to enabled when the CLI is present; honor explicit opt-out.
      enabled: coderabbitExplicit === false ? false : (coderabbitExplicit === true || coderabbitCliAvailable),
    },
    // Always recompute sonarcloud from the freshly validated config passed in
    // as `legacySonar`. Previously we preferred `policy?.sonarcloud` from the
    // on-disk workspace.json, which meant setup corrections (e.g. changing the
    // org, flipping enabled) had no effect without a `workspace remove` first.
    sonarcloud: normalizeSonarConfig(legacySonar, key, defaultOrg),
  }
}

function buildWorkspaceConfigFile(input: {
  key: string
  name: string
  harnessProfile: HarnessProfile
  runtimePolicy?: WorkspaceRuntimePolicy
  preview?: WorkspacePreviewConfig
  sonar: SonarConfig
  reviewPolicy?: WorkspaceReviewPolicy
  preflight?: WorkspacePreflightReport
  createdAt?: number
}): WorkspaceConfigFile {
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    key: input.key,
    name: input.name,
    harnessProfile: input.harnessProfile,
    runtimePolicy: input.runtimePolicy ?? defaultWorkspaceRuntimePolicy(),
    preview: input.preview,
    sonar: input.sonar,
    reviewPolicy: input.reviewPolicy ?? normalizeReviewPolicy(undefined, input.sonar, input.key),
    preflight: input.preflight,
    createdAt: input.createdAt ?? Date.now(),
  }
}

function isRuntimePolicyMode(value: unknown): value is RuntimePolicyMode {
  return value === "safe-readonly" || value === "safe-workspace-write" || value === "unsafe-autonomous-write"
}

export function defaultWorkspaceRuntimePolicy(): WorkspaceRuntimePolicy {
  return { ...DEFAULT_WORKSPACE_RUNTIME_POLICY }
}

function normalizeRuntimePolicy(raw: unknown): WorkspaceRuntimePolicy | null {
  if (!raw || typeof raw !== "object") return null
  const policy = raw as Partial<WorkspaceRuntimePolicy>
  if (
    (policy.stageAuthoring !== "safe-readonly" && policy.stageAuthoring !== "safe-workspace-write") ||
    policy.reviewer !== "safe-readonly" ||
    (policy.coderExecution !== "safe-workspace-write" && policy.coderExecution !== "unsafe-autonomous-write")
  ) {
    return null
  }
  return {
    stageAuthoring: policy.stageAuthoring,
    reviewer: policy.reviewer,
    coderExecution: policy.coderExecution,
  }
}

function normalizePreviewConfig(raw: unknown): WorkspacePreviewConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const preview = raw as Partial<WorkspacePreviewConfig>
  if (typeof preview.command !== "string" || preview.command.trim().length === 0) {
    return undefined
  }
  return {
    command: preview.command.trim(),
    cwd: typeof preview.cwd === "string" && preview.cwd.trim().length > 0 ? preview.cwd.trim() : undefined,
  }
}

function isValidHarnessProfile(raw: unknown): raw is HarnessProfile {
  if (!raw || typeof raw !== "object") return false
  const mode = (raw as { mode?: unknown }).mode
  switch (mode) {
    case "codex-first":
    case "claude-first":
    case "codex-only":
    case "claude-only":
    case "fast":
    case "claude-sdk-first":
    case "codex-sdk-first":
    case "opencode-china":
    case "opencode-euro":
      return true
    case "opencode":
    case "self": {
      const roles = (raw as { roles?: unknown }).roles
      if (!roles || typeof roles !== "object") return false
      const coder = (roles as Record<string, unknown>).coder
      const reviewer = (roles as Record<string, unknown>).reviewer
      return !!coder && typeof coder === "object" && !!reviewer && typeof reviewer === "object"
    }
    default:
      return false
  }
}

export async function readWorkspaceConfig(root: string): Promise<WorkspaceConfigFile | null> {
  try {
    const raw = JSON.parse(await readFile(workspaceConfigPath(root), "utf8")) as {
      schemaVersion?: number
      key?: unknown
      name?: unknown
      harnessProfile?: unknown
      runtimePolicy?: unknown
      preview?: unknown
      sonar?: unknown
      reviewPolicy?: unknown
      preflight?: unknown
      createdAt?: unknown
    }
    if ((raw.schemaVersion !== 1 && raw.schemaVersion !== WORKSPACE_SCHEMA_VERSION) || typeof raw.key !== "string" || typeof raw.name !== "string") {
      return null
    }
    if (!isValidHarnessProfile(raw.harnessProfile)) {
      return null
    }
    const runtimePolicy = normalizeRuntimePolicy(raw.runtimePolicy) ?? defaultWorkspaceRuntimePolicy()
    const preview = normalizePreviewConfig(raw.preview)
    const sonar = normalizeSonarConfig(
      raw.sonar && typeof raw.sonar === "object" ? (raw.sonar as SonarConfig) : undefined,
      raw.key,
    )
    const reviewPolicy =
      raw.reviewPolicy && typeof raw.reviewPolicy === "object" ? (raw.reviewPolicy as WorkspaceReviewPolicy) : undefined
    return {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      key: raw.key,
      name: raw.name,
      harnessProfile: raw.harnessProfile,
      runtimePolicy,
      preview,
      sonar,
      reviewPolicy: normalizeReviewPolicy(reviewPolicy, sonar, raw.key),
      preflight: raw.preflight && typeof raw.preflight === "object" ? raw.preflight as WorkspacePreflightReport : undefined,
      createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
    }
  } catch {
    return null
  }
}

export async function writeWorkspaceConfig(root: string, config: WorkspaceConfigFile): Promise<void> {
  await mkdir(dirname(workspaceConfigPath(root)), { recursive: true })
  await writeFile(workspaceConfigPath(root), toJson(config), "utf8")
}

export async function writeSonarProperties(root: string, owner: string, repo: string): Promise<{
  changed: boolean
  warnings: string[]
}> {
  if (await pathExists(sonarPropertiesPath(root))) return { changed: false, warnings: [] }
  const generated = await buildGeneratedSonarProperties(root, owner, repo)
  if (!generated.content) return { changed: false, warnings: generated.warnings }
  await mkdir(dirname(sonarPropertiesPath(root)), { recursive: true })
  await writeFile(sonarPropertiesPath(root), generated.content, "utf8")
  return { changed: true, warnings: generated.warnings }
}

export function generateSonarProjectUrl(name: string, sonar: SonarConfig): string | undefined {
  if (!sonar.enabled || !sonar.organization || !sonar.projectKey) return undefined
  // The hosted "create project" link is a SonarCloud concept. For self-hosted
  // SonarQube we can't deep-link into a matching flow, so return undefined and
  // let the caller surface a generic "visit your sonar instance" hint instead.
  const host = sonar.hostUrl ?? SONAR_DEFAULT_HOST
  if (host !== SONAR_DEFAULT_HOST) return undefined
  const params = new URLSearchParams({
    organization: sonar.organization,
    name,
    key: sonar.projectKey,
  })
  return `${SONAR_DEFAULT_HOST}/projects/create?${params.toString()}`
}

export function generateSonarMcpSnippet(sonar: SonarConfig): string | undefined {
  if (!sonar.enabled) return undefined
  const host = sonar.hostUrl ?? SONAR_DEFAULT_HOST
  const args = ["run", "--rm", "-i", "--init", "--pull=always", "-e", "SONARQUBE_TOKEN"]
  const env: string[] = ['"SONARQUBE_TOKEN" = "<YourSonarQubeUserToken>"']

  const isCloudHost = host === SONAR_DEFAULT_HOST || host === "https://sonarqube.us"
  if (isCloudHost) {
    args.push("-e", "SONARQUBE_ORG")
    env.push(`"SONARQUBE_ORG" = "${sonar.organization ?? "<YourOrganizationName>"}"`)
  }
  if (host !== SONAR_DEFAULT_HOST) {
    args.push("-e", "SONARQUBE_URL")
    env.push(`"SONARQUBE_URL" = "${host}"`)
  }

  args.push("mcp/sonarqube")
  return [
    "# See https://docs.sonarsource.com/sonarqube-mcp-server/quickstart-guide/codex-cli",
    "[mcp_servers.sonarqube]",
    'command = "docker"',
    `args = [${args.map(value => JSON.stringify(value)).join(", ")}]`,
    `env = { ${env.join(", ")} }`,
  ].join("\n")
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
    case "claude-sdk-first":
      return ["claude", "codex"]
    case "codex-sdk-first":
      return ["codex", "claude"]
    case "opencode":
    case "opencode-china":
    case "opencode-euro":
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

/**
 * Per-role `(harness, runtime)` pairs the profile actually uses. Drives both
 * the CLI-availability check (skipped for SDK roles, which only need an API
 * key) and the SDK key check below.
 */
function rolePairsForProfile(
  profile: HarnessProfile,
): Array<{ harness: KnownHarness; runtime: "cli" | "sdk" }> {
  switch (profile.mode) {
    // Read all preset-backed modes directly from presets.json so the
    // validator can never drift from the actual preset content (this used
    // to bite us — `claude-sdk-first` had a merge-resolver SDK entry that
    // validation skipped because it only listed coder + reviewer).
    case "codex-first":
    case "fast":
    case "claude-first":
    case "codex-only":
    case "claude-only":
    case "claude-sdk-first":
    case "codex-sdk-first":
    case "opencode-china":
    case "opencode-euro":
      return pairsFromPreset(profile.mode)
    case "opencode":
      return [{ harness: "opencode", runtime: "cli" }]
    case "self": {
      const pairs: Array<{ harness: KnownHarness; runtime: "cli" | "sdk" }> = [
        { harness: profile.roles.coder.harness, runtime: profile.roles.coder.runtime ?? "cli" },
        { harness: profile.roles.reviewer.harness, runtime: profile.roles.reviewer.runtime ?? "cli" },
      ]
      const mr = profile.roles["merge-resolver"]
      if (mr) pairs.push({ harness: mr.harness, runtime: mr.runtime ?? "cli" })
      return pairs
    }
  }
}

/**
 * Required env-var key for an `(harness, sdk)` pair. CLI runtimes return
 * null (auth lives in the local CLI session). Used by doctor / validation
 * to surface a missing key with the dedicated
 * `profile_references_unavailable_runtime` error.
 */
function sdkApiKeyEnv(harness: KnownHarness): string | null {
  switch (harness) {
    case "claude":
      return "ANTHROPIC_API_KEY"
    case "codex":
      return "OPENAI_API_KEY"
    case "opencode":
      return null
  }
}

export function validateHarnessProfile(profile: HarnessProfile, appReport: SetupReport): ValidationResult {
  const warnings: string[] = []

  const pairs = rolePairsForProfile(profile)

  // Reject combinations that have no implementation regardless of env state.
  // `opencode:sdk` is the only such combo today; `codex:sdk` ships via
  // `@openai/codex-sdk` and is validated only against the missing-key check
  // below.
  const hardRejects = pairs.filter(p => p.harness === "opencode" && p.runtime === "sdk")
  if (hardRejects.length > 0) {
    const labels = Array.from(new Set(hardRejects.map(p => `${p.harness}:${p.runtime}`)))
    return {
      ok: false,
      warnings,
      error: {
        code: "profile_references_unavailable_runtime",
        detail: `Harness profile requests runtime(s) that are not implemented: ${labels.join(", ")}.`,
      },
    }
  }

  // The merge-resolver runs synchronously inside the git adapter and only
  // dispatches to CLI adapters today. Catch a `merge-resolver: sdk` choice
  // here instead of at conflict-resolution time, which is far worse UX.
  if (profile.mode === "self" && profile.roles["merge-resolver"]?.runtime === "sdk") {
    return {
      ok: false,
      warnings,
      error: {
        code: "profile_references_unavailable_runtime",
        detail:
          "Harness profile sets merge-resolver runtime to sdk, which is not implemented (the resolver is sync; SDK adapters are async). " +
          'Set merge-resolver to runtime: "cli" — coder/reviewer SDK runtimes are unaffected.',
      },
    }
  }

  // CLI roles still need the local CLI installed + authed.
  const available = collectAvailableHarnesses(appReport)
  const required = Array.from(new Set(pairs.filter(p => p.runtime === "cli").map(p => p.harness)))
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

  // SDK roles need the matching API key in process env. We deliberately do
  // NOT silently fall back to CLI — operators picking SDK want SDK semantics
  // (per-token billing, in-process tool gating) and need to see this clearly.
  const missingKeys: string[] = []
  for (const pair of pairs) {
    if (pair.runtime !== "sdk") continue
    const env = sdkApiKeyEnv(pair.harness)
    if (env && !process.env[env]) missingKeys.push(`${pair.harness}:sdk requires ${env}`)
  }
  if (missingKeys.length > 0) {
    return {
      ok: false,
      warnings,
      error: {
        code: "profile_references_unavailable_runtime",
        detail: `Harness profile selects an SDK runtime without the required API key: ${Array.from(new Set(missingKeys)).join("; ")}`,
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
  let requestedSonar = input.sonar ?? existingConfig?.sonar
  // Auto-enable Sonar when the user has clearly configured it locally:
  // sonar-project.properties exists in the repo. Without this, re-running
  // workspace add without --sonar silently downgrades sonar.enabled to false.
  // Token validity is re-checked after preflight below, before we treat the
  // requested config as effective.
  if (!requestedSonar?.enabled && preview.hasSonarProperties) {
    requestedSonar = { ...requestedSonar, enabled: true }
  }
  const validation = validateHarnessProfile(input.harnessProfile, deps.appReport)
  if (!validation.ok) {
    return { ok: false, error: validation.error?.code ?? "unknown", detail: validation.error?.detail ?? "invalid harness profile" }
  }

  const byPath = deps.repos.getWorkspaceByRootPath(path)
  if (byPath && byPath.key !== key) {
    return { ok: false, error: "path_already_registered", detail: `Path ${path} is already registered as ${byPath.key}` }
  }
  const byKey = deps.repos.getWorkspaceByKey(key)
  if (byKey?.root_path && byKey.root_path !== path) {
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
    const gitignore = await ensureManagedGitignore(path)
    if (gitignore.changed) actions.push(`updated ${GITIGNORE_FILE}`)
  }

  const gitSetup = await ensureGitRepo(path, input.git?.defaultBranch ?? "main")
  if (!gitSetup.ok) {
    return { ok: false, error: "git_init_failed", detail: gitSetup.detail ?? "git init failed" }
  }
  actions.push(...gitSetup.actions)

  // Accept a SONAR_TOKEN supplied by the caller (interactive prompt or --sonar-token flag).
  // Persist to .env.local when requested, and surface via process.env so the subsequent
  // preflight's token validation + project creation can use it.
  if (input.sonarToken?.value) {
    if (!process.env.SONAR_TOKEN) process.env.SONAR_TOKEN = input.sonarToken.value
    if (input.sonarToken.persist) {
      await persistSonarTokenToEnvLocal(path, input.sonarToken.value)
      actions.push("wrote SONAR_TOKEN to .env.local")
    }
  }

  let preflight = await runWorkspacePreflight(path, {
    sonarHostUrl: requestedSonar?.hostUrl,
    sonarEnabled: requestedSonar?.enabled ?? preview.hasSonarProperties,
  })

  if (
    input.github?.create &&
    preflight.report.github.status !== "ok" &&
    preflight.report.gh.status === "ok"
  ) {
    const visibility = input.github.visibility === "public" ? "--public" : "--private"
    const owner = input.github.owner ?? preflight.report.gh.user
    const slug = owner ? `${owner}/${key}` : key
    const ghResult = runCommand("gh", ["repo", "create", slug, visibility, "--source=.", "--remote=origin", "--push"], path)
    if (ghResult.ok) {
      actions.push(`gh repo create ${slug}`)
      preflight = await runWorkspacePreflight(path, {
        sonarHostUrl: requestedSonar?.hostUrl,
        sonarEnabled: requestedSonar?.enabled ?? preview.hasSonarProperties,
      })
    } else {
      actions.push(`! gh repo create ${slug} failed: ${ghResult.stderr || ghResult.stdout || "unknown error"}`)
    }
  }

  const githubReady = preflight.report.github.status === "ok" && preflight.report.github.owner && preflight.report.github.repo
  const sonar = githubReady && requestedSonar?.enabled
    ? normalizeSonarConfig({
        ...requestedSonar,
        enabled: true,
        organization: preflight.report.github.owner,
        projectKey: `${preflight.report.github.owner}_${preflight.report.github.repo}`,
        baseBranch: preflight.report.github.defaultBranch ?? requestedSonar.baseBranch,
      }, key, deps.config.llm.defaultSonarOrganization)
    : normalizeSonarConfig({ enabled: false }, key, deps.config.llm.defaultSonarOrganization)
  const coderabbitCliAvailable = preflight.report.coderabbit.status === "ok"
  const reviewPolicy = normalizeReviewPolicy(existingConfig?.reviewPolicy, sonar, key, deps.config.llm.defaultSonarOrganization, coderabbitCliAvailable)
  const warnings = [...validation.warnings]
  if (requestedSonar?.enabled && !githubReady) {
    warnings.push("SonarCloud config generation skipped until a GitHub origin remote is configured")
  }
  if (preflight.report.gh.status !== "ok") {
    warnings.push("GitHub CLI is not authenticated; repo creation and secret sync remain manual")
  }

  const workspaceConfig = buildWorkspaceConfigFile({
    key,
    name,
    harnessProfile: input.harnessProfile,
    runtimePolicy: existingConfig?.runtimePolicy,
    preview: existingConfig?.preview,
    sonar,
    reviewPolicy,
    preflight: preflight.report,
    createdAt: existingConfig?.createdAt,
  })
  await writeWorkspaceConfig(path, workspaceConfig)
  actions.push(`wrote ${WORKSPACE_CONFIG_DIR}/${WORKSPACE_CONFIG_FILE}`)

  if (githubReady && sonar.enabled) {
    const owner = preflight.report.github.owner!
    const repo = preflight.report.github.repo!
    const sonarWrite = await writeSonarProperties(path, owner, repo)
    if (sonarWrite.changed) {
      actions.push(`wrote ${SONAR_PROPERTIES_FILE}`)
    }
    warnings.push(...sonarWrite.warnings)
    if (await writeFileIfMissing(sonarWorkflowPath(path), renderSonarWorkflow())) {
      actions.push(`wrote ${SONAR_WORKFLOW_FILE}`)
    }
    preflight = await runWorkspacePreflight(path, {
      sonarHostUrl: sonar.hostUrl,
      sonarEnabled: sonar.enabled,
    })
    // Create the SonarCloud project if the token can talk to the API and the
    // project doesn't yet exist. Non-fatal — scanner runs later will fail
    // cleanly if creation was refused (wrong permissions, org mismatch, etc.).
    if (sonar.enabled && preflight.report.sonar.status === "ok") {
      const token = (await detectSonarToken(path)).value
      if (token && sonar.organization && sonar.projectKey) {
        const host = sonar.hostUrl ?? SONAR_DEFAULT_HOST
        const create = await createSonarProject(
          token,
          sonar.organization,
          sonar.projectKey,
          name,
          "private",
          host,
        )
        const projectReady = create.ok
        if (create.ok && create.created) {
          actions.push(`created SonarCloud project ${sonar.organization}/${sonar.projectKey}`)
        } else if (create.ok && !create.created) {
          actions.push(`SonarCloud project ${sonar.organization}/${sonar.projectKey} already exists`)
        } else {
          warnings.push(`SonarCloud project create failed: ${create.reason}`)
        }

        if (projectReady) {
          // Best-effort: apply AI-qualified quality gate. Default is "Sonar way for AI Code";
          // callers can override via SonarConfig.qualityGateName.
          const gateName = sonar.qualityGateName ?? "Sonar way for AI Code"
          const gate = await assignSonarQualityGate(token, sonar.organization, sonar.projectKey, gateName, host)
          if (gate.ok) {
            actions.push(`applied SonarCloud quality gate "${gateName}"`)
          } else {
            warnings.push(`SonarCloud quality gate "${gateName}" not applied: ${gate.reason}`)
          }

          // Best-effort: disable automatic analysis so only the local sonar-scanner runs.
          const autoscan = await disableSonarAutoScan(token, sonar.projectKey, host)
          if (autoscan.ok) {
            actions.push("disabled SonarCloud automatic analysis")
          } else {
            warnings.push(`SonarCloud automatic analysis not disabled: ${autoscan.reason}`)
          }
        }
      } else if (!token) {
        warnings.push("SonarCloud project creation skipped: SONAR_TOKEN not available")
      }
    }
  }
  if (await writeFileIfMissing(coderabbitConfigPath(path), renderCoderabbitConfig())) {
    actions.push(`wrote ${CODERABBIT_CONFIG_FILE}`)
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
  const ghOwner = preflight.report.gh.user ?? preflight.report.github.owner
  let ghCommand: string | undefined
  if (preflight.report.github.status !== "ok") {
    ghCommand = ghOwner
      ? `gh repo create ${ghOwner}/${key} --private --source=. --remote=origin --push`
      : `gh repo create ${key} --private --source=. --remote=origin --push`
  }
  const coderabbitInstallUrl = preflight.report.github.owner
    ? generateCodeRabbitInstallUrl()
    : undefined
  const sonarReadiness = preflight.report.sonar.readiness ?? {
    scanner: "unknown",
    token: "unknown",
    config: "missing",
    coverage: "unknown",
    warnings: [],
  } satisfies SonarReadiness
  if (requestedSonar?.enabled && sonarReadiness.token === "invalid") {
    warnings.push("SONAR_TOKEN is present but failed Sonar validation")
  } else if (requestedSonar?.enabled && sonarReadiness.token === "missing") {
    warnings.push("SONAR_TOKEN is not configured yet; local scans and project provisioning will remain incomplete")
  }
  if (requestedSonar?.enabled && sonarReadiness.config === "invalid" && sonarReadiness.details?.config) {
    warnings.push(`Sonar config invalid: ${sonarReadiness.details.config}`)
  }
  if (requestedSonar?.enabled && sonarReadiness.config === "missing") {
    warnings.push("Sonar config was not generated; add sonar-project.properties manually for this workspace layout")
  }
  if (sonarReadiness.coverage === "producer-missing") {
    warnings.push("Coverage import configured but no coverage command was detected")
  } else if (sonarReadiness.coverage === "artifact-missing" && sonarReadiness.details?.coverage) {
    warnings.push(sonarReadiness.details.coverage)
  }
  warnings.push(...sonarReadiness.warnings)

  return {
    ok: true,
    workspace,
    preview: await previewWorkspace(path, deps.config, deps.repos),
    actions,
    warnings,
    preflight: preflight.report,
    sonarReadiness,
    sonarProjectUrl: generateSonarProjectUrl(name, sonar),
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
    if (!row.root_path) {
      purgeSkipped = { reason: "missing_root_path", path: "" }
    } else if (!opts.allowedRoots || opts.allowedRoots.length === 0) {
      // Refuse to rm -rf if the caller didn't supply an allowlist.
      purgeSkipped = { reason: "allowed_roots_required", path: row.root_path }
    } else if (await isInsideAllowedRootRealpath(row.root_path, opts.allowedRoots)) {
      await rm(row.root_path, { recursive: true, force: true })
      purgedPath = row.root_path
    } else {
      // The stored root_path may have been moved, replaced by a symlink,
      // or the allowedRoots config may have changed since registration.
      // In all of those cases we refuse to purge rather than chase the link.
      purgeSkipped = { reason: "path_outside_allowed_roots", path: row.root_path }
    }
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
  if (!preview.exists) console.log("    ✓ path does not exist — will be scaffolded")
  else if (preview.isGreenfield) console.log("    ✓ path exists and is empty — will be scaffolded in place")
  else console.log(`    ✓ path exists and is populated (${preview.existingFiles.length}+ top-level entries)`)
  console.log(`    ${preview.isInsideAllowedRoot ? "✓" : "!"} inside allowed roots`)
  console.log(`    ${preview.isGreenfield ? "· will be a greenfield workspace" : "· will be a brownfield registration"}`)
  if (preview.isGitRepo) {
    const defaultBranchSuffix = preview.defaultBranch ? ` (${preview.defaultBranch})` : ""
    console.log(`    · git repo detected${defaultBranchSuffix}`)
  }
  else console.log("    · no git repo detected")
  if (preview.detectedStack) console.log(`    · detected stack: ${preview.detectedStack}`)
  if (preview.hasWorkspaceConfigFile) console.log(`    · existing ${WORKSPACE_CONFIG_DIR}/${WORKSPACE_CONFIG_FILE} found`)
  if (preview.hasSonarProperties) console.log(`    · existing ${SONAR_PROPERTIES_FILE} found`)
  for (const conflict of preview.conflicts) console.log(`    ! ${conflict}`)
  console.log("")
}

async function promptHarnessProfile(rl: PromptSession, config: AppConfig): Promise<HarnessProfile> {
  console.log("\n  Harness profile")
  console.log("    1) codex-first")
  console.log("    2) claude-first")
  console.log("    3) codex-only")
  console.log("    4) claude-only")
  console.log("    5) fast")
  console.log("    6) claude-sdk-first  (Claude Agent SDK; needs ANTHROPIC_API_KEY, bills per-token)")
  console.log("    7) codex-sdk-first   (Codex SDK; needs OPENAI_API_KEY, bills per-token)")
  console.log("    8) opencode-china    (qwen + deepseek via OpenRouter)")
  console.log("    9) opencode-euro     (mistral via OpenRouter)")
  const choice = await promptLine(rl, "Pick [1-9] or [d]efault", "d")
  const profileMap: Record<string, HarnessProfile> = {
    "1": { mode: "codex-first" },
    "2": { mode: "claude-first" },
    "3": { mode: "codex-only" },
    "4": { mode: "claude-only" },
    "5": { mode: "fast" },
    "6": { mode: "claude-sdk-first" },
    "7": { mode: "codex-sdk-first" },
    "8": { mode: "opencode-china" },
    "9": { mode: "opencode-euro" },
    d: config.llm.defaultHarnessProfile,
  }
  return profileMap[choice.toLowerCase()] ?? config.llm.defaultHarnessProfile
}

async function promptSonarConfig(rl: PromptSession, key: string, config: AppConfig): Promise<SonarConfig> {
  console.log("")
  const enableSonar = await promptYesNo(rl, "Enable Sonar for this workspace?", false)
  if (!enableSonar) return { enabled: false }
  return {
    enabled: true,
    projectKey: await promptLine(rl, "Project key", key),
    organization: await promptLine(rl, "Organization", config.llm.defaultSonarOrganization ?? ""),
    hostUrl: await promptLine(rl, "Host URL", SONAR_DEFAULT_HOST),
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
  const detected = await detectSonarToken(path)
  if (detected.value) return undefined
  console.log("\n  SONAR_TOKEN is required for SonarCloud project creation and scanner runs.")
  console.log("  Generate one at https://sonarcloud.io/account/security")
  const value = (await promptLine(rl, "SONAR_TOKEN (blank to skip)", "")).trim()
  if (!value) return undefined
  const persist = await promptYesNo(rl, "Write SONAR_TOKEN to .env.local (git-ignored)?", true)
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
    const preview = { ...(await buildPathPreview(path, config.allowedRoots)), isRegistered: false }
    renderPreviewSummary(preview)

    const name = await promptLine(rl, "Name", basename(path))
    const key = await promptLine(rl, "Key", slugify(name))
    const profile = await promptHarnessProfile(rl, config)
    const sonar = await promptSonarConfig(rl, key, config)

    const defaultGitInit = preview.isGreenfield || !preview.isGitRepo
    const gitInit = await promptYesNo(rl, "Initialize git?", defaultGitInit)

    // Offer GitHub repo creation when gh is authenticated and the workspace
    // has no detected origin remote. Preflight runs again inside registerWorkspace
    // after the repo is created, so CodeRabbit/Sonar can key off it.
    const github = await promptGitHubCreateOption(rl, preview, path)

    // Offer to supply SONAR_TOKEN when Sonar is enabled but none is detected.
    const sonarToken = await promptSonarTokenValue(rl, path, sonar)

    const proceed = await promptYesNo(rl, "Proceed?", true)
    if (!proceed) {
      throw new Error("workspace add cancelled")
    }
    return { path, name, key, profile, sonar, gitInit, github, sonarToken }
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
    const parsed = safeParseHarnessProfile(row.harness_profile_json)
    if (!parsed.profile) {
      skipped.push({ key: row.key, reason: `harness_profile_json invalid: ${parsed.error ?? "unknown"}` })
      continue
    }
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
