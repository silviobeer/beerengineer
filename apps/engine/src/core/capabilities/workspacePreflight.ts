import type {
  CapabilityId,
  CapabilityPreflightStatus,
} from "./types.js"
import type {
  WorkspaceCapabilityResult,
  WorkspacePreflightCheck,
  WorkspacePreflightReport,
} from "../../types/workspace.js"

function statusFromCheck(check: WorkspacePreflightCheck, skippedStatus: CapabilityPreflightStatus): CapabilityPreflightStatus {
  switch (check.status) {
    case "ok":
      return "ready"
    case "missing":
      return "missing"
    case "pending-install":
      return "not_configured"
    case "skipped":
      return skippedStatus
    case "invalid":
      return "failed"
  }
}

function defaultReason(capabilityId: CapabilityId, status: CapabilityPreflightStatus): string {
  switch (status) {
    case "ready":
      return `${capabilityId} is ready`
    case "missing":
      return `${capabilityId} is missing`
    case "disabled":
      return `${capabilityId} is disabled`
    case "not_configured":
      return `${capabilityId} is not configured`
    case "warning":
      return `${capabilityId} reported a warning`
    case "failed":
      return `${capabilityId} failed readiness checks`
  }
}

function capabilityResult(
  capabilityId: CapabilityId,
  status: CapabilityPreflightStatus,
  detail: string | undefined,
): WorkspaceCapabilityResult {
  const summary = status === "ready" ? `${capabilityId} ready` : defaultReason(capabilityId, status)
  return status === "ready"
    ? { capabilityId, status, summary }
    : { capabilityId, status, summary, reason: detail ?? defaultReason(capabilityId, status) }
}

export function buildWorkspacePreflightCapabilities(report: Omit<WorkspacePreflightReport, "capabilities">): WorkspaceCapabilityResult[] {
  const sonarStatus = statusFromCheck(report.sonar, "disabled")
  return [
    capabilityResult("git", statusFromCheck(report.git, "failed"), report.git.detail),
    capabilityResult("github", statusFromCheck(report.github, "not_configured"), report.github.detail),
    capabilityResult("sonar", sonarStatus, report.sonar.detail),
    capabilityResult("coderabbit", statusFromCheck(report.coderabbit, "not_configured"), report.coderabbit.detail),
  ]
}
