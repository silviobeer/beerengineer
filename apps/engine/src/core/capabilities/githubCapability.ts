import type { WorkspacePreflightReport } from "../../types/workspace.js"
import type { WorkspaceCapabilityContext } from "./workspaceContext.js"

export function githubCapabilityReadyForAction(
  context: WorkspaceCapabilityContext,
  report: WorkspacePreflightReport,
): boolean {
  return context.github.ready && report.github.status === "ok" && report.gh.status === "ok"
}
