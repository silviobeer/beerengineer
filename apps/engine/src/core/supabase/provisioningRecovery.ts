import type { RunRow, WorkspaceRow } from "../../db/repositories.js"
import type { WaveDefinition, WorkflowContext } from "../../types.js"
import { writeRecoveryRecord } from "../recovery.js"
import { emitEvent } from "../runContext.js"
import { layout } from "../workspaceLayout.js"
import {
  buildSupabaseProvisioningRecoveryPayload,
  type SupabaseProvisioningFailureStep,
} from "./recoveryPayload.js"

export const SUPABASE_PROVISIONING_RECOVERY_USER_MESSAGE =
  "Supabase provisioning failed. Operator recovery action is required."

export type SupabaseProvisioningFailure = {
  failedStep: SupabaseProvisioningFailureStep
  failureCause: string
  branchRef?: string
}

const stepLabels: Record<SupabaseProvisioningFailureStep, string> = {
  provision: "branch provisioning",
  poll: "branch activation",
  handoff: "handoff generation",
  validate: "branch validation",
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function objectValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function defaultFailureCause(step: SupabaseProvisioningFailureStep): string {
  switch (step) {
    case "provision":
      return "Supabase branch provisioning failed before a readable provider cause was returned."
    case "poll":
      return "Supabase branch activation failed before a readable provider cause was returned."
    case "handoff":
      return "Supabase handoff generation failed before a readable provider cause was returned."
    case "validate":
      return "Supabase branch validation failed before a readable provider cause was returned."
  }
}

export function humanizeSupabaseProvisioningFailure(
  step: SupabaseProvisioningFailureStep,
  source: unknown,
): SupabaseProvisioningFailure {
  const row = objectValue(source)
  const failureCause = nonEmptyString(row?.message)
    ?? nonEmptyString(row?.reason)
    ?? nonEmptyString(row?.details)
    ?? nonEmptyString(row?.error)
    ?? (row?.error instanceof Error ? nonEmptyString(row.error.message) : null)
    ?? (source instanceof Error ? nonEmptyString(source.message) : null)
    ?? defaultFailureCause(step)
  return {
    failedStep: step,
    failureCause,
    branchRef: nonEmptyString(row?.branchRef) ?? nonEmptyString(row?.branch_ref) ?? undefined,
  }
}

export function supabaseProvisioningRecoverySummary(failure: SupabaseProvisioningFailure): string {
  return `Supabase provisioning failed during ${stepLabels[failure.failedStep]}: ${failure.failureCause}`
}

export async function recordSupabaseProvisioningBlockedRun(input: {
  repos: {
    getRun(id: string): RunRow | undefined
    getWorkspace(id: string): WorkspaceRow | undefined
    updateRun(
      id: string,
      patch: Partial<
        Pick<
          RunRow,
          "status" | "current_stage" | "recovery_status" | "recovery_scope" | "recovery_scope_ref" | "recovery_summary" | "recovery_payload_json"
        >
      >,
    ): void
  }
  ctx: WorkflowContext
  runId: string
  wave: Pick<WaveDefinition, "id" | "number">
  projectRef?: string
  failure: SupabaseProvisioningFailure
  itemId: string
  title: string
}): Promise<RunRow | undefined> {
  const run = input.repos.getRun(input.runId)
  if (!run) throw new Error(`run_not_found:${input.runId}`)
  const workspace = input.repos.getWorkspace(run.workspace_id)
  const summary = supabaseProvisioningRecoverySummary(input.failure)
  input.repos.updateRun(input.runId, {
    status: "blocked",
    current_stage: null,
    recovery_status: "blocked",
    recovery_scope: "run",
    recovery_scope_ref: null,
    recovery_summary: summary,
    recovery_payload_json: buildSupabaseProvisioningRecoveryPayload({
      runId: run.id,
      workspaceId: workspace?.id,
      workspaceKey: workspace?.key,
      projectRef: input.projectRef,
      waveId: input.wave.id,
      waveNumber: input.wave.number,
      branchRef: input.failure.branchRef,
      failedStep: input.failure.failedStep,
      failureCause: input.failure.failureCause,
      userMessage: SUPABASE_PROVISIONING_RECOVERY_USER_MESSAGE,
    }),
  })
  await writeRecoveryRecord(input.ctx, {
    status: "blocked",
    cause: "stage_error",
    scope: { type: "run", runId: input.runId },
    summary,
    detail: `wave=${input.wave.number} step=${input.failure.failedStep}`,
    evidencePaths: [layout.executionWaveDir(input.ctx, input.wave.number)],
  })
  emitEvent({
    type: "run_blocked",
    runId: input.runId,
    itemId: input.itemId,
    title: input.title,
    scope: { type: "run", runId: input.runId },
    cause: "stage_error",
    summary,
    branch: input.failure.branchRef,
  })
  return input.repos.getRun(input.runId)
}
