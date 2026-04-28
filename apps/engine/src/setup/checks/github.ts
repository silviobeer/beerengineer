import type { CheckResult } from "../types.js"
import { createCheck, probeCommand, remedyForTool } from "./shared.js"

export async function runGitHubChecks(enabled: boolean): Promise<CheckResult[]> {
  const gh = await probeCommand("gh", ["--version"])
  const ghCheck = createCheck(
    "vcs.gh",
    "GitHub CLI",
    gh.ok ? "ok" : "missing",
    gh.version ?? gh.detail,
    { remedy: gh.ok ? undefined : remedyForTool("gh") },
  )
  if (!enabled) {
    return [
      ghCheck,
      createCheck("vcs.gh.auth", "GitHub auth", "skipped", "GitHub workflows are disabled in config"),
    ]
  }
  if (!gh.ok) {
    return [
      ghCheck,
      createCheck("vcs.gh.auth", "GitHub auth", "skipped", "GitHub CLI is not available"),
    ]
  }
  const auth = await probeCommand("gh", ["auth", "status"])
  return [
    ghCheck,
    createCheck("vcs.gh.auth", "GitHub auth", auth.ok ? "ok" : "missing", auth.version ?? auth.detail),
  ]
}
