import Database from "better-sqlite3"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { readEnginePidFile } from "../../api/pidFile.js"
import { resolveDbPathInfo } from "../../db/connection.js"
import type { Repos } from "../../db/repositories.js"
import type { AppConfig } from "../../setup/types.js"
import type { UpdateReadinessState, UpdateStatus } from "./types.js"

export function buildUpdateReadiness(
  repos: Repos,
  config: AppConfig,
  opts: { pid?: number | null } = {},
): UpdateStatus["readiness"] {
  const pid = opts.pid ?? null
  const engineStarted = integrationReady(pid === null ? Boolean(readEnginePidFile()) : true)

  let dbOk: UpdateReadinessState = "failed"
  try {
    const db = new Database(resolveDbPathInfo().path, { readonly: true, fileMustExist: true })
    db.prepare("SELECT 1").get()
    db.close()
    dbOk = "ok"
  } catch {
    dbOk = "failed"
  }

  const githubOk: UpdateReadinessState = resolveGithubAuthToken() || config.vcs?.github?.enabled !== false
    ? "ok"
    : "failed"

  const claudeAuth = Boolean(process.env.ANTHROPIC_API_KEY?.trim()) || commandSucceeds("claude", ["auth", "status"])
  const codexAuth = Boolean(process.env.OPENAI_API_KEY?.trim()) || commandSucceeds("codex", ["login", "status"])
  const anthropicOk: UpdateReadinessState = config.llm.provider === "anthropic" ? integrationReady(claudeAuth) : "not_applicable"
  const openaiOk: UpdateReadinessState = config.llm.provider === "openai" ? integrationReady(codexAuth) : "not_applicable"

  const sonarEnabled = repos.listWorkspaces().some(workspace => workspace.sonar_enabled === 1)
  const sonarTokenInGitConfig = repos.listWorkspaces().some(workspace => {
    if (!workspace.root_path) return false
    const probe = spawnSync("git", ["config", "--get", "beerengineer.sonarToken"], {
      cwd: workspace.root_path,
      encoding: "utf8",
    })
    return probe.status === 0 && Boolean(probe.stdout.trim())
  })
  const sonarTokenPresent = Boolean(process.env.SONAR_TOKEN?.trim()) || repos.listWorkspaces().some(workspace => {
    if (!workspace.root_path) return false
    try {
      const envLocal = join(workspace.root_path, ".env.local")
      if (!existsSync(envLocal)) return false
      return readFileSync(envLocal, "utf8")
        .split(/\r?\n/)
        .some(line => /^SONAR_TOKEN=.+$/.test(line.trim()))
    } catch {
      return false
    }
  }) || sonarTokenInGitConfig
  const sonarOk: UpdateReadinessState = sonarEnabled ? integrationReady(sonarTokenPresent) : "not_applicable"

  return {
    engineStarted,
    dbOk,
    githubOk,
    anthropicOk,
    openaiOk,
    sonarOk,
  }
}

function integrationReady(state: boolean): UpdateReadinessState {
  return state ? "ok" : "failed"
}

function resolveGithubAuthToken(): string | null {
  const explicit = process.env.BEERENGINEER_GITHUB_TOKEN?.trim()
  if (explicit) return explicit
  const generic = process.env.GITHUB_TOKEN?.trim()
  if (generic) return generic
  if (!commandSucceeds("gh", ["--version"])) return null
  const gh = spawnSync("gh", ["auth", "token"], { encoding: "utf8" })
  if (gh.status === 0 && gh.stdout.trim()) return gh.stdout.trim()
  return null
}

function commandSucceeds(command: string, args: string[]): boolean {
  try {
    const result = spawnSync(command, args, { stdio: "ignore" })
    return result.status === 0
  } catch {
    return false
  }
}
