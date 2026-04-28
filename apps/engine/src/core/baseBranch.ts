import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"

export type BaseBranchSource = "item" | "env" | "config" | "git" | "default"
export type BaseBranchResolution = { branch: string; source: BaseBranchSource }

export function isEngineOwnedBranchName(branch: string): boolean {
  return /^(item|proj|wave|story|candidate)\//.test(branch)
}

function resolveGitDefaultBranch(workspaceRoot: string): string | null {
  const originHead = spawnSync("git", ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], {
    cwd: workspaceRoot,
    encoding: "utf8",
  })
  if (originHead.status === 0) {
    const branch = originHead.stdout.trim().replace(/^origin\//, "")
    if (branch) return branch
  }

  const remoteShow = spawnSync("git", ["remote", "show", "origin"], {
    cwd: workspaceRoot,
    encoding: "utf8",
  })
  if (remoteShow.status === 0) {
    const match = /^\s*HEAD branch:\s+(.+)$/m.exec(remoteShow.stdout)
    const branch = match?.[1]?.trim()
    if (branch) return branch
  }

  const current = spawnSync("git", ["branch", "--show-current"], {
    cwd: workspaceRoot,
    encoding: "utf8",
  })
  const branch = current.status === 0 ? current.stdout.trim() : ""
  if (branch && !isEngineOwnedBranchName(branch)) return branch
  return null
}

function readConfiguredBaseBranch(workspaceRoot: string): string | undefined {
  try {
    const configPath = resolve(workspaceRoot, ".beerengineer", "workspace.json")
    const raw = readFileSync(configPath, "utf8")
    const parsed = JSON.parse(raw) as {
      preflight?: { github?: { defaultBranch?: string | null } }
      reviewPolicy?: { sonarcloud?: { baseBranch?: string } }
      sonar?: { baseBranch?: string }
    }
    return (
      parsed.preflight?.github?.defaultBranch?.trim() ||
      parsed.reviewPolicy?.sonarcloud?.baseBranch?.trim() ||
      parsed.sonar?.baseBranch?.trim() ||
      undefined
    )
  } catch {
    return undefined
  }
}

export function resolveBaseBranchForWorkspace(workspaceRoot: string | undefined): BaseBranchResolution {
  const envOverride = process.env.BEERENGINEER_BASE_BRANCH?.trim()
  if (envOverride) return { branch: envOverride, source: "env" }

  if (workspaceRoot) {
    const fromConfig = readConfiguredBaseBranch(workspaceRoot)
    if (fromConfig && !isEngineOwnedBranchName(fromConfig)) {
      return { branch: fromConfig, source: "config" }
    }
    const fromGit = resolveGitDefaultBranch(workspaceRoot)
    if (fromGit) return { branch: fromGit, source: "git" }
  }
  return { branch: "main", source: "default" }
}

export function resolveBaseBranchForItem(
  itemOverride: string | undefined | null,
  workspaceRoot: string | undefined,
): BaseBranchResolution {
  const trimmed = itemOverride?.trim()
  if (trimmed) return { branch: trimmed, source: "item" }
  return resolveBaseBranchForWorkspace(workspaceRoot)
}
