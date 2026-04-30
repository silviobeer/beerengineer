import type {
  ManagedInstallPhase,
  ManagedInstallPhaseName,
  ManagedInstallPhaseStatus,
  ManagedInstallReleaseTarget,
  ManagedInstallResult,
  ManagedInstallSummary,
} from "./types.js"

export const MANAGED_INSTALL_RESULT_VERSION = 1

export const REQUIRED_MANAGED_INSTALL_PHASES: readonly ManagedInstallPhaseName[] = [
  "prerequisites",
  "download",
  "install",
  "setup",
  "engineStart",
  "uiStart",
]

const PHASE_STATUSES: readonly ManagedInstallPhaseStatus[] = ["ok", "warning", "failed"]

export function createManagedInstallPhase(input: ManagedInstallPhase): ManagedInstallPhase {
  if (!PHASE_STATUSES.includes(input.status)) {
    throw new Error(`managed_install_diagnostics_failed:invalid_phase_status:${input.status}`)
  }
  return { ...input }
}

export function buildManagedInstallSummary(input: {
  phases: ManagedInstallPhase[]
  wrapperPath?: string
  engineUrl?: string
  uiUrl?: string
  nextCommands?: string[]
}): ManagedInstallSummary {
  const warnings = input.phases
    .filter(phase => phase.status === "warning")
    .map(phase => `${phase.name}: ${phase.message}`)
  const failed = input.phases.some(phase => phase.status === "failed")
  return {
    status: failed ? "failed" : warnings.length > 0 ? "succeeded-with-warning" : "succeeded",
    wrapperPath: input.wrapperPath,
    engineUrl: input.engineUrl,
    uiUrl: input.uiUrl,
    nextCommands: input.nextCommands ?? [],
    warnings,
  }
}

export function createManagedInstallResult(input: {
  operationId: string
  phases: ManagedInstallPhase[]
  target?: ManagedInstallReleaseTarget
  summary?: ManagedInstallSummary
}): ManagedInstallResult {
  const summary = input.summary ?? buildManagedInstallSummary({ phases: input.phases })
  return {
    version: MANAGED_INSTALL_RESULT_VERSION,
    operationId: input.operationId,
    target: input.target,
    phases: input.phases,
    summary,
    exitCode: summary.status === "failed" ? 1 : 0,
  }
}

export function createManagedInstallErrorResult(input: {
  operationId: string
  error: Error
  target?: ManagedInstallReleaseTarget
}): ManagedInstallResult {
  const failedPhase = createManagedInstallPhase({
    name: "install",
    status: "failed",
    message: input.error.message,
    fixHint: "Review the failed phase output, fix the reported issue, then rerun the installer.",
    durationMs: 0,
  })
  return {
    ...createManagedInstallResult({
      operationId: input.operationId,
      target: input.target,
      phases: [failedPhase],
    }),
    error: {
      message: input.error.message,
    },
  }
}

export function renderManagedInstallJson(result: ManagedInstallResult): string {
  return `${JSON.stringify(result, null, 2)}\n`
}

export function renderManagedInstallHuman(result: ManagedInstallResult): string {
  const lines = [
    `operation: ${result.operationId}`,
    `status: ${result.summary.status}`,
  ]
  if (result.target) lines.push(`target: ${result.target.repo} ${result.target.tag}`)
  for (const phase of result.phases) {
    lines.push(`${phase.name.padEnd(14)} ${phase.status.toUpperCase()} ${phase.message}`)
    if (phase.fixHint) lines.push(`  fix: ${phase.fixHint}`)
  }
  if (result.summary.wrapperPath) lines.push(`wrapper: ${result.summary.wrapperPath}`)
  if (result.summary.engineUrl) lines.push(`engine: ${result.summary.engineUrl}`)
  if (result.summary.uiUrl) lines.push(`ui: ${result.summary.uiUrl}`)
  if (result.summary.nextCommands.length > 0) lines.push(`next: ${result.summary.nextCommands.join(" && ")}`)
  return `${lines.join("\n")}\n`
}
