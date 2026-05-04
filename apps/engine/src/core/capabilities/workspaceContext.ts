import type { WorkspacePreflightReport } from "../../types/workspace.js"

export type WorkspaceCapabilityContext = {
  workspaceRoot: string
  git: {
    ready: boolean
    mandatory: true
    defaultBranch: string | null
  }
  github: {
    ready: boolean
    mandatory: boolean
    owner?: string
    repo?: string
    remoteUrl?: string
    defaultBranch?: string | null
    ghUser?: string
  }
}

export function buildWorkspaceCapabilityContext(
  workspaceRoot: string,
  report: WorkspacePreflightReport,
  options: { githubRequired?: boolean } = {},
): WorkspaceCapabilityContext {
  return {
    workspaceRoot,
    git: {
      ready: report.git.status === "ok",
      mandatory: true,
      defaultBranch: report.git.defaultBranch ?? report.github.defaultBranch ?? null,
    },
    github: {
      ready: report.github.status === "ok" && report.gh.status === "ok",
      mandatory: options.githubRequired ?? false,
      owner: report.github.owner,
      repo: report.github.repo,
      remoteUrl: report.github.remoteUrl,
      defaultBranch: report.github.defaultBranch,
      ghUser: report.gh.user,
    },
  }
}
