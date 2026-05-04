import type { CapabilityId, CapabilityPreflightStatus, ReviewOutcome } from "../../core/capabilities/index.js"

export type CapabilityCliResult = {
  capabilityId: CapabilityId
  status?: CapabilityPreflightStatus
  outcome?: ReviewOutcome
  summary: string
  reason?: string
  nextActions?: string[]
  details?: unknown
}

export function renderCapabilityJson(result: CapabilityCliResult): string {
  return `${JSON.stringify(result, null, 2)}\n`
}

export function renderCapabilityText(result: CapabilityCliResult): string {
  const state = result.status ?? result.outcome ?? "unknown"
  const lines = [
    `  ${result.capabilityId}: ${state}`,
    `  ${result.summary}`,
  ]
  if (result.reason) lines.push(`  reason: ${result.reason}`)
  for (const action of result.nextActions ?? []) lines.push(`  next: ${action}`)
  return `${lines.join("\n")}\n`
}

export function stateNeedsAttention(result: CapabilityCliResult): boolean {
  const state = result.status ?? result.outcome
  return state !== undefined && state !== "ready" && state !== "ran"
}
