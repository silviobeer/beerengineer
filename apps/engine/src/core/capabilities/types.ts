export const CAPABILITY_IDS = ["git", "github", "sonar", "coderabbit"] as const

export type CapabilityId = typeof CAPABILITY_IDS[number]

const CAPABILITY_ID_SET = new Set<string>(CAPABILITY_IDS)

export function isCapabilityId(value: unknown): value is CapabilityId {
  return typeof value === "string" && CAPABILITY_ID_SET.has(value)
}

export type CapabilityJson = {
  capabilityId: CapabilityId
}

export type CapabilityAvailabilityResult = CapabilityJson & {
  available: boolean
  reason?: string
  context?: Record<string, unknown>
}

export type CapabilityPreflightStatus =
  | "ready"
  | "missing"
  | "disabled"
  | "not_configured"
  | "warning"
  | "failed"

export type CapabilityPreflightResult = CapabilityJson & (
  | {
      status: "ready"
      reason?: string
      context?: Record<string, unknown>
    }
  | {
      status: Exclude<CapabilityPreflightStatus, "ready">
      reason: string
      context?: Record<string, unknown>
    }
)

export type CapabilityPortResult =
  | CapabilityAvailabilityResult
  | CapabilityPreflightResult
  | ReviewCapabilityEnvelope<unknown>

export type CapabilityPortHandler<T = CapabilityPortResult> = () => Promise<T> | T

export type CapabilityPorts = {
  availability?: CapabilityPortHandler<CapabilityAvailabilityResult>
  preflight?: CapabilityPortHandler<CapabilityPreflightResult>
  enable?: CapabilityPortHandler<CapabilityPreflightResult>
  connect?: CapabilityPortHandler<CapabilityPreflightResult>
  audit?: CapabilityPortHandler<CapabilityPreflightResult>
  repair?: CapabilityPortHandler<CapabilityPreflightResult>
  review?: CapabilityPortHandler<ReviewCapabilityEnvelope<unknown>>
}

export type CapabilityDefinition<Id extends CapabilityId = CapabilityId> = {
  id: Id
  ports: CapabilityPorts
}

export type ReviewOutcome =
  | "ran"
  | "skipped"
  | "failed"
  | "not_configured"
  | "not_meaningful"

export const REVIEW_OUTCOMES = [
  "ran",
  "skipped",
  "failed",
  "not_configured",
  "not_meaningful",
] as const satisfies readonly ReviewOutcome[]

export type ReviewArtifactRef = {
  label: string
  path: string
}

export type ReviewCapabilityEnvelope<ToolResult = unknown> = CapabilityJson & {
  phase: string
  blocking: boolean
  summary: string
  artifacts: ReviewArtifactRef[]
} & (
    | {
        outcome: "ran"
        reason?: never
        toolResult?: ToolResult
      }
    | {
        outcome: Exclude<ReviewOutcome, "ran">
        reason: string
        toolResult?: ToolResult
      }
  )

export function preflightReady(
  capabilityId: CapabilityId,
  context?: Record<string, unknown>,
): CapabilityPreflightResult {
  return context ? { capabilityId, status: "ready", context } : { capabilityId, status: "ready" }
}

export function preflightMissing(capabilityId: CapabilityId, reason: string): CapabilityPreflightResult {
  return { capabilityId, status: "missing", reason }
}

export function preflightDisabled(capabilityId: CapabilityId, reason: string): CapabilityPreflightResult {
  return { capabilityId, status: "disabled", reason }
}

export function preflightNotConfigured(capabilityId: CapabilityId, reason: string): CapabilityPreflightResult {
  return { capabilityId, status: "not_configured", reason }
}

export function preflightWarning(capabilityId: CapabilityId, reason: string): CapabilityPreflightResult {
  return { capabilityId, status: "warning", reason }
}

export function preflightFailed(capabilityId: CapabilityId, reason: string): CapabilityPreflightResult {
  return { capabilityId, status: "failed", reason }
}
