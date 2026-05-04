import type { CapabilityId, CapabilityPreflightStatus } from "./types.js"

export type SharedReadinessStatus = CapabilityPreflightStatus | "not_applicable"

export type SharedReadinessResult = {
  capabilityId: Extract<CapabilityId, "git" | "github" | "sonar">
  status: SharedReadinessStatus
  reason?: string
}

export function sharedReadiness(
  capabilityId: SharedReadinessResult["capabilityId"],
  status: SharedReadinessStatus,
  reason?: string,
): SharedReadinessResult {
  return reason ? { capabilityId, status, reason } : { capabilityId, status }
}

export function capabilityStatusFromReady(
  ready: boolean,
  failureStatus: Extract<CapabilityPreflightStatus, "missing" | "not_configured" | "failed"> = "failed",
): CapabilityPreflightStatus {
  return ready ? "ready" : failureStatus
}
