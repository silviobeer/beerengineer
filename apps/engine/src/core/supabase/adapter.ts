import type { SupabaseAdapter, SupabaseAdapterResult, SupabaseWorkspaceContext } from "./types.js"
import { createOrAttachPersistentTestBranch, type PersistentBranchClient } from "./persistentTestBranch.js"
import type { Repos } from "../../db/repositories.js"
import { ownedWaveBranchPrefix, waveBranchName } from "./branchNaming.js"
import { pollSupabaseBranch, SupabaseBranchPollTimeoutError } from "./branchPoller.js"
import { applySupabaseMigrationsAndSeeds, type SupabaseMigrationClient } from "./migrationRunner.js"
import { listSupabaseSqlFiles } from "./migrationRunner.js"
import { migrationSmoke } from "./dbTests/migrationSmoke.js"
import { recordSupabaseLifecycle } from "./lifecycleEvents.js"
import { SupabaseManagementError } from "./managementClient.js"
import {
  parseSupabaseProvisioningRecoveryPayload,
  type SupabaseProvisioningRecoveryGuidance,
} from "./recoveryPayload.js"
import { readFileSync } from "node:fs"
import { relative } from "node:path"

/**
 * QA-009: production migrations are tracked in the target Supabase project
 * itself. Idempotent CREATE makes startup safe to re-run; the single
 * canonical location means the engine survives DB resets without losing
 * the applied-migration ledger.
 */
const MIGRATION_TRACKING_TABLE_SQL =
  "CREATE TABLE IF NOT EXISTS __beerengineer_migrations ("
  + " filename TEXT PRIMARY KEY,"
  + " applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()"
  + ");"

const MIGRATION_TRACKING_SELECT_SQL = "SELECT filename FROM __beerengineer_migrations;"

/**
 * Escape a migration filename for safe embedding in a single-quoted SQL
 * literal. Filenames are derived from the workspace tree and timestamps —
 * this guards against the rare case of an apostrophe in a filename rather
 * than a deliberate injection vector.
 */
function escapeSqlLiteral(value: string): string {
  return value.replaceAll("'", "''")
}

/**
 * Wrap a migration body in BEGIN ... <body> ... INSERT ... COMMIT so the
 * tracking-table write is atomic with the schema change. If the body fails,
 * the whole transaction rolls back, including the tracking INSERT — a
 * subsequent run will re-attempt the file.
 */
function wrapMigrationInTransaction(body: string, filename: string): string {
  const trimmed = body.trim()
  const bodyWithSeparator = trimmed.endsWith(";") ? trimmed : `${trimmed};`
  return [
    "BEGIN;",
    bodyWithSeparator,
    `INSERT INTO __beerengineer_migrations (filename) VALUES ('${escapeSqlLiteral(filename)}');`,
    "COMMIT;",
  ].join("\n")
}

async function fetchAppliedMigrationFilenames(
  client: SupabaseMigrationClient,
  projectRef: string,
  branchRef: string,
): Promise<Set<string>> {
  const result = await client.runQuery(projectRef, branchRef, MIGRATION_TRACKING_SELECT_SQL)
  return extractFilenamesFromQueryResult(result)
}

/**
 * The Supabase Management runQuery shape is not formally typed — different
 * deployments return slightly different envelopes. Defensively unwrap the
 * common ones (`{ rows: [{filename: ...}] }`, bare `[{filename: ...}]`,
 * `{ result: [...] }`) so the caller doesn't crash on cosmetic differences.
 */
function extractFilenamesFromQueryResult(result: unknown): Set<string> {
  const rows = pickRowsArray(result)
  const filenames = new Set<string>()
  for (const row of rows) {
    if (row && typeof row === "object" && "filename" in row) {
      const value = (row as { filename: unknown }).filename
      if (typeof value === "string") filenames.add(value)
    }
  }
  return filenames
}

function pickRowsArray(result: unknown): unknown[] {
  if (Array.isArray(result)) return result
  if (result && typeof result === "object") {
    const obj = result as Record<string, unknown>
    if (Array.isArray(obj.rows)) return obj.rows
    if (Array.isArray(obj.result)) return obj.result
    if (Array.isArray(obj.data)) return obj.data
  }
  return []
}

export class NotImplementedError extends Error {
  constructor(operation: string) {
    super(`Supabase adapter operation not implemented: ${operation}`)
    this.name = "NotImplementedError"
  }
}

function notImplemented(operation: keyof SupabaseAdapter) {
  return async (_context: SupabaseWorkspaceContext): Promise<SupabaseAdapterResult> => {
    throw new NotImplementedError(operation)
  }
}

export const defaultSupabaseAdapter: SupabaseAdapter = {
  provisionBranch: notImplemented("provisionBranch"),
  pollBranchStatus: notImplemented("pollBranchStatus"),
  validateBranch: notImplemented("validateBranch"),
  destroyBranch: notImplemented("destroyBranch"),
  migrateProduction: notImplemented("migrateProduction"),
  reconcile: notImplemented("reconcile"),
}

type WaveClient = PersistentBranchClient & SupabaseMigrationClient & {
  getBranch?(projectRef: string, branchRef: string): Promise<{ id: string; ref: string; name?: string; status?: string }>
  deleteBranch?(projectRef: string, branchRef: string): Promise<void>
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isNotFoundError(err: unknown): boolean {
  return (err as { status?: unknown } | undefined)?.status === 404
}

function recoveryReuseFailure(message: string, branchRef?: string): SupabaseAdapterResult {
  return { ok: false, context: { error: "recovery_branch_unusable", message, branchRef } }
}

function dedupeBranchRefs(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0)))
}

function recoveryGuidanceFailure(
  message: string,
  guidance: SupabaseProvisioningRecoveryGuidance,
  branchRef?: string,
): SupabaseAdapterResult {
  return {
    ok: false,
    context: {
      error: "recovery_branch_unusable",
      message,
      branchRef,
      guidance,
    },
  }
}

function validateRecoveryReuseTarget(
  runId: string,
  recovery: NonNullable<ReturnType<typeof parseSupabaseProvisioningRecoveryPayload>>,
  context: Required<Pick<SupabaseWorkspaceContext, "workspaceId" | "projectRef" | "waveId">>,
): { message: string; guidance?: SupabaseProvisioningRecoveryGuidance } | null {
  if (recovery.runId !== runId) {
    return { message: "Supabase recovery refused to reuse the persisted branch because the recovery record belongs to a different run." }
  }
  if (recovery.workspaceId && recovery.workspaceId !== context.workspaceId) {
    return { message: "Supabase recovery refused to reuse the persisted branch because it targets a different workspace." }
  }
  if (recovery.projectRef && recovery.projectRef !== context.projectRef) {
    return { message: "Supabase recovery refused to reuse the persisted branch because it targets a different Supabase project." }
  }
  if (recovery.waveId !== context.waveId) {
    return {
      message: "Supabase recovery refused automatic branch reuse because the recovery record belongs to a different execution wave.",
      guidance: {
        reason: "wave_mismatch",
        attachBranchRefs: dedupeBranchRefs([recovery.branchRef]),
      },
    }
  }
  return null
}

function validateReuseIdentity(input: {
  runId: string
  runRecoveryStatus: string | null
  recoveryPayloadJson: string | null
  context: Required<Pick<SupabaseWorkspaceContext, "workspaceId" | "projectRef" | "waveId">>
}): string | null {
  if (input.runRecoveryStatus !== "blocked") return null
  const recovery = parseSupabaseProvisioningRecoveryPayload(input.recoveryPayloadJson)
  if (!recovery) return null
  if (recovery.operatorAction) return null
  return validateRecoveryReuseTarget(input.runId, recovery, input.context)?.message ?? null
}

type ReusableBranch = { ref: string; name?: string; status?: string }

function markRunBranchReusable(input: {
  repos: Repos
  runId: string
  branch: ReusableBranch
  branchName: string
  existingLifecycleState: string | null
}): SupabaseAdapterResult {
  input.repos.setRunSupabaseBranch(input.runId, {
    ref: input.branch.ref,
    name: input.branch.name ?? input.branchName,
    lifecycleState: input.branch.status === "ACTIVE_HEALTHY"
      ? "ready"
      : input.existingLifecycleState ?? "provisioning",
  })
  return {
    ok: true,
    context: {
      action: "reused",
      branchRef: input.branch.ref,
      branchName: input.branch.name ?? input.branchName,
    },
  }
}

function expectedWaveBranchName(input: Required<Pick<SupabaseWorkspaceContext, "workspaceKey" | "runId" | "itemId" | "projectId" | "waveId">>): string {
  return waveBranchName({
    workspace: input.workspaceKey,
    runId: input.runId,
    itemId: input.itemId,
    projectId: input.projectId,
    waveId: input.waveId,
  })
}

function branchNotHealthyFailure(branch: ReusableBranch, expectedName: string): SupabaseAdapterResult {
  return recoveryGuidanceFailure(
    `Supabase recovery refused to reuse branch ${branch.ref} because ${expectedName} is not ACTIVE_HEALTHY (provider status: ${branch.status ?? "unknown"}).`,
    {
      reason: "branch_not_active_healthy",
      attachBranchRefs: [branch.ref],
    },
    branch.ref,
  )
}

function validateHealthyReusableBranch(branch: ReusableBranch, expectedName: string): SupabaseAdapterResult | null {
  return branch.status === "ACTIVE_HEALTHY"
    ? null
    : branchNotHealthyFailure(branch, expectedName)
}

async function resolveCurrentWaveBranchByName(input: {
  client: WaveClient
  projectRef: string
  expectedName: string
}): Promise<
  | { kind: "missing" }
  | { kind: "ambiguous"; failure: SupabaseAdapterResult }
  | { kind: "candidate"; branch: ReusableBranch }
> {
  const sameNameBranches = (await input.client.listBranches(input.projectRef))
    .filter(branch => nonEmptyString(branch.name) === input.expectedName)

  if (sameNameBranches.length === 0) return { kind: "missing" }
  if (sameNameBranches.length > 1) {
    return {
      kind: "ambiguous",
      failure: recoveryGuidanceFailure(
        `Supabase recovery found ambiguous current-wave branches named ${input.expectedName}; operator intervention is required before this run can continue.`,
        {
          reason: "multiple_name_matches",
          attachBranchRefs: dedupeBranchRefs(sameNameBranches.map(branch => branch.ref)),
        },
      ),
    }
  }
  return { kind: "candidate", branch: sameNameBranches[0] }
}

async function inspectPersistedRecoverableBranch(input: {
  client: WaveClient
  projectRef: string
  branchRef: string | null
  expectedName: string
}): Promise<{
  reusableBranch: ReusableBranch | null
  fallbackFailure: SupabaseAdapterResult | null
  failureReason: "wrong_name" | "missing" | "unhealthy" | "unverifiable" | null
}> {
  if (!input.branchRef) return { reusableBranch: null, fallbackFailure: null, failureReason: null }
  const getBranch = input.client.getBranch
  if (getBranch == null) {
    return {
      reusableBranch: null,
      fallbackFailure: recoveryReuseFailure(
        `Supabase recovery cannot continue because persisted branch ${input.branchRef} could not be verified.`,
        input.branchRef,
      ),
      failureReason: "unverifiable",
    }
  }

  try {
    const branch = await getBranch(input.projectRef, input.branchRef)
    const actualName = nonEmptyString(branch.name)
    if (actualName && actualName !== input.expectedName) {
      return {
        reusableBranch: null,
        fallbackFailure: recoveryReuseFailure(
          `Supabase recovery refused to reuse branch ${input.branchRef} because it does not belong to this blocked run target (expected ${input.expectedName}, got ${actualName}).`,
          input.branchRef,
        ),
        failureReason: "wrong_name",
      }
    }
    const healthFailure = validateHealthyReusableBranch(branch, input.expectedName)
    return {
      reusableBranch: healthFailure ? null : branch,
      fallbackFailure: healthFailure,
      failureReason: healthFailure ? "unhealthy" : null,
    }
  } catch (err) {
    if (isNotFoundError(err)) {
      return {
        reusableBranch: null,
        fallbackFailure: recoveryReuseFailure(
          `Supabase recovery cannot continue because missing recoverable branch ${input.branchRef} no longer exists in project ${input.projectRef}.`,
          input.branchRef,
        ),
        failureReason: "missing",
      }
    }
    throw err
  }
}

function recoveryBranchRef(
  run: { supabase_branch_ref: string | null },
  recovery: NonNullable<ReturnType<typeof parseSupabaseProvisioningRecoveryPayload>>,
): string | null {
  return nonEmptyString(run.supabase_branch_ref) ?? nonEmptyString(recovery.branchRef)
}

function recoveryTargetMismatchFailure(input: {
  targetMismatch: NonNullable<ReturnType<typeof validateRecoveryReuseTarget>>
  runBranchRef: string | null
}): SupabaseAdapterResult {
  const branchRef = input.runBranchRef ?? undefined
  if (!input.targetMismatch.guidance) return recoveryReuseFailure(input.targetMismatch.message, branchRef)
  return recoveryGuidanceFailure(
    input.targetMismatch.message,
    input.targetMismatch.guidance,
    branchRef,
  )
}

function conflictingPersistedBranchFailure(input: {
  persistedBranchRef: string
  namedBranchRef: string
}): SupabaseAdapterResult {
  return recoveryGuidanceFailure(
    `Supabase recovery refused automatic branch reuse because persisted branch ${input.persistedBranchRef} conflicts with current-wave branch ${input.namedBranchRef}.`,
    {
      reason: "ref_conflict",
      attachBranchRefs: dedupeBranchRefs([input.persistedBranchRef, input.namedBranchRef]),
    },
    input.persistedBranchRef,
  )
}

async function reuseOperatorSelectedBranch(input: {
  repos: Repos
  client: WaveClient
  projectRef: string
  run: NonNullable<ReturnType<Repos["getRun"]>>
  recovery: NonNullable<ReturnType<typeof parseSupabaseProvisioningRecoveryPayload>>
  expectedName: string
}): Promise<SupabaseAdapterResult> {
  const attached = await inspectPersistedRecoverableBranch({
    client: input.client,
    projectRef: input.projectRef,
    branchRef: recoveryBranchRef(input.run, input.recovery),
    expectedName: input.expectedName,
  })
  if (!attached.reusableBranch) {
    return attached.fallbackFailure ?? recoveryReuseFailure("Supabase recovery cannot continue because the selected branch attachment is missing.")
  }
  return markRunBranchReusable({
    repos: input.repos,
    runId: input.run.id,
    branch: attached.reusableBranch,
    branchName: input.expectedName,
    existingLifecycleState: input.run.supabase_branch_lifecycle_state,
  })
}

async function reuseBlockedRecoveryBranch(input: {
  repos: Repos
  client: WaveClient
  projectRef: string
  run: NonNullable<ReturnType<Repos["getRun"]>>
  recovery: NonNullable<ReturnType<typeof parseSupabaseProvisioningRecoveryPayload>>
  context: Required<Pick<SupabaseWorkspaceContext, "workspaceId" | "projectRef" | "waveId">>
  expectedName: string
}): Promise<SupabaseAdapterResult> {
  const targetMismatch = validateRecoveryReuseTarget(input.run.id, input.recovery, input.context)
  if (targetMismatch) {
    return recoveryTargetMismatchFailure({
      targetMismatch,
      runBranchRef: recoveryBranchRef(input.run, input.recovery),
    })
  }

  const persisted = await inspectPersistedRecoverableBranch({
    client: input.client,
    projectRef: input.projectRef,
    branchRef: recoveryBranchRef(input.run, input.recovery),
    expectedName: input.expectedName,
  })

  const namedBranch = await resolveCurrentWaveBranchByName({
    client: input.client,
    projectRef: input.projectRef,
    expectedName: input.expectedName,
  })
  if (namedBranch.kind === "ambiguous") return namedBranch.failure
  if (persisted.reusableBranch && namedBranch.kind === "candidate" && namedBranch.branch.ref !== persisted.reusableBranch.ref) {
    return conflictingPersistedBranchFailure({
      persistedBranchRef: persisted.reusableBranch.ref,
      namedBranchRef: namedBranch.branch.ref,
    })
  }
  if (persisted.reusableBranch) {
    return markRunBranchReusable({
      repos: input.repos,
      runId: input.run.id,
      branch: persisted.reusableBranch,
      branchName: input.expectedName,
      existingLifecycleState: input.run.supabase_branch_lifecycle_state,
    })
  }
  if (persisted.failureReason === "unhealthy") return persisted.fallbackFailure!
  if (namedBranch.kind === "candidate") {
    const branchFailure = validateHealthyReusableBranch(namedBranch.branch, input.expectedName)
    if (branchFailure) return branchFailure
    return markRunBranchReusable({
      repos: input.repos,
      runId: input.run.id,
      branch: namedBranch.branch,
      branchName: input.expectedName,
      existingLifecycleState: input.run.supabase_branch_lifecycle_state,
    })
  }

  return persisted.fallbackFailure ?? recoveryReuseFailure("Supabase recovery cannot continue because this blocked run has no persisted branch identity to reuse.")
}

async function reuseRecoverableWaveBranch(input: {
  repos: Repos
  client: WaveClient
  context: SupabaseWorkspaceContext
}): Promise<SupabaseAdapterResult | null> {
  const { context } = input
  if (!context.runId || !context.workspaceId || !context.workspaceKey || !context.itemId || !context.projectId || !context.projectRef || !context.waveId) {
    return null
  }
  const run = input.repos.getRun(context.runId)
  if (run?.recovery_status !== "blocked") return null

  const recovery = parseSupabaseProvisioningRecoveryPayload(run.recovery_payload_json)
  if (!recovery) return null
  if (recovery.operatorAction === "discard") return null

  const expectedName = expectedWaveBranchName({
    workspaceKey: context.workspaceKey,
    runId: context.runId,
    itemId: context.itemId,
    projectId: context.projectId,
    waveId: context.waveId,
  })
  if (recovery.operatorAction === "attach") {
    return reuseOperatorSelectedBranch({
      repos: input.repos,
      client: input.client,
      projectRef: context.projectRef,
      run,
      recovery,
      expectedName,
    })
  }

  return reuseBlockedRecoveryBranch({
    repos: input.repos,
    client: input.client,
    projectRef: context.projectRef,
    run,
    recovery,
    context: {
      workspaceId: context.workspaceId,
      projectRef: context.projectRef,
      waveId: context.waveId,
    },
    expectedName,
  })
}

async function reuseExistingWaveBranch(input: {
  repos: Repos
  client: WaveClient
  context: Required<Pick<SupabaseWorkspaceContext, "runId" | "workspaceId" | "workspaceKey" | "itemId" | "projectId" | "projectRef" | "waveId">>
  allowFreshCreateOnUnhealthyCandidate?: boolean
}): Promise<SupabaseAdapterResult | null> {
  const expectedName = expectedWaveBranchName(input.context)
  const run = input.repos.getRun(input.context.runId)
  if (!run) return null

  const identityMismatch = validateReuseIdentity({
    runId: run.id,
    runRecoveryStatus: run.recovery_status,
    recoveryPayloadJson: run.recovery_payload_json,
    context: {
      workspaceId: input.context.workspaceId,
      projectRef: input.context.projectRef,
      waveId: input.context.waveId,
    },
  })
  if (identityMismatch) return recoveryReuseFailure(identityMismatch)
  const namedBranch = await resolveCurrentWaveBranchByName({
    client: input.client,
    projectRef: input.context.projectRef,
    expectedName,
  })
  if (namedBranch.kind === "missing") return null
  if (namedBranch.kind === "ambiguous") return namedBranch.failure
  const branchFailure = validateHealthyReusableBranch(namedBranch.branch, expectedName)
  if (branchFailure) return input.allowFreshCreateOnUnhealthyCandidate ? null : branchFailure

  return markRunBranchReusable({
    repos: input.repos,
    runId: run.id,
    branch: namedBranch.branch,
    branchName: expectedName,
    existingLifecycleState: run.supabase_branch_lifecycle_state,
  })
}

async function discardStaleWaveAttachment(input: {
  repos: Repos
  client: WaveClient
  context: Required<Pick<SupabaseWorkspaceContext, "runId" | "projectRef" | "waveId" | "workspaceKey" | "itemId" | "projectId">>
}): Promise<boolean> {
  const run = input.repos.getRun(input.context.runId)
  if (!run?.supabase_branch_ref) return false

  const expectedName = expectedWaveBranchName(input.context)
  const persistedName = nonEmptyString(run.supabase_branch_name)
  let staleAttachment = false

  if (input.client.getBranch) {
    try {
      const branch = await input.client.getBranch(input.context.projectRef, run.supabase_branch_ref)
      const actualName = nonEmptyString(branch.name)
      staleAttachment = actualName != null
        ? actualName !== expectedName
        : persistedName != null && persistedName !== expectedName
    } catch (err) {
      if (isNotFoundError(err)) staleAttachment = true
      else throw err
    }
  } else if (persistedName) {
    staleAttachment = persistedName !== expectedName
  }

  if (!staleAttachment) return false
  input.repos.clearRunSupabaseBranch(input.context.runId)
  return true
}

export function createSupabaseAdapter(deps: { repos: Repos; client: WaveClient }): SupabaseAdapter {
  return {
    ...defaultSupabaseAdapter,
    async provisionBranch(context: SupabaseWorkspaceContext): Promise<SupabaseAdapterResult> {
      const workspaceId = context.workspaceId
      if (!workspaceId) return { ok: false, context: { error: "workspace_required" } }
      if (context.waveId) {
        const workspace = deps.repos.getWorkspace(workspaceId)
        if (!workspace || !context.projectRef || !context.parentBranchRef || !context.runId || !context.itemId || !context.projectId) {
          return { ok: false, context: { error: "wave_context_required" } }
        }
        const waveContext = {
          runId: context.runId,
          workspaceId,
          workspaceKey: context.workspaceKey ?? workspace.key,
          itemId: context.itemId,
          projectId: context.projectId,
          projectRef: context.projectRef,
          waveId: context.waveId,
        }
        if (context.parentBranchRef === "main" || context.parentBranchRef === "production") {
          return { ok: false, context: { error: "invalid_parent", message: "Wave branches must fork from the persistent test branch" } }
        }
        const reused = await reuseRecoverableWaveBranch({
          repos: deps.repos,
          client: deps.client,
          context,
        })
        if (reused) return reused
        const recovery = parseSupabaseProvisioningRecoveryPayload(deps.repos.getRun(context.runId)?.recovery_payload_json)
        const staleAttachmentDiscarded = await discardStaleWaveAttachment({
          repos: deps.repos,
          client: deps.client,
          context: {
            runId: waveContext.runId,
            projectRef: waveContext.projectRef,
            waveId: waveContext.waveId,
            workspaceKey: waveContext.workspaceKey,
            itemId: waveContext.itemId,
            projectId: waveContext.projectId,
          },
        })
        const existing = await reuseExistingWaveBranch({
          repos: deps.repos,
          client: deps.client,
          context: waveContext,
          allowFreshCreateOnUnhealthyCandidate: staleAttachmentDiscarded || recovery?.operatorAction === "discard",
        })
        if (existing) return existing
        const name = waveBranchName({
          workspace: context.workspaceKey ?? workspace.key,
          runId: context.runId,
          itemId: context.itemId,
          projectId: context.projectId,
          waveId: context.waveId,
        })
        const branch = await deps.client.createBranch(context.projectRef, { name, parentRef: context.parentBranchRef })
        deps.repos.setRunSupabaseBranch(context.runId, { ref: branch.ref, name, lifecycleState: "provisioning" })
        recordSupabaseLifecycle({ repos: deps.repos, runId: context.runId, waveId: context.waveId, branchRef: branch.ref, step: "branch_creation", status: "in_progress" })
        return { ok: true, context: { branchRef: branch.ref, branchName: name, parentBranchRef: context.parentBranchRef } }
      }
      const result = await createOrAttachPersistentTestBranch({
        repos: deps.repos,
        workspaceId,
        client: deps.client,
        parentRef: context.branchRef,
      })
      return result.ok
        ? { ok: true, context: { action: result.action, branchRef: result.branch.ref, branchName: result.name } }
        : { ok: false, context: { error: result.error, message: result.message } }
    },
    async pollBranchStatus(context: SupabaseWorkspaceContext): Promise<SupabaseAdapterResult> {
      if (!context.projectRef || !context.branchRef || !deps.client.getBranch) return { ok: false, context: { error: "branch_context_required" } }
      try {
        const branch = await pollSupabaseBranch({ poll: () => deps.client.getBranch!(context.projectRef!, context.branchRef!) })
        if (context.runId) deps.repos.setRunSupabaseLifecycleState(context.runId, "ready")
        recordSupabaseLifecycle({ repos: deps.repos, runId: context.runId, waveId: context.waveId, branchRef: context.branchRef, step: "branch_creation", status: "passed" })
        return { ok: true, context: { status: "ready", branchRef: branch.ref } }
      } catch (err) {
        const status = err instanceof SupabaseBranchPollTimeoutError ? "timeout" : "failed"
        if (context.runId) deps.repos.setRunSupabaseLifecycleState(context.runId, "retained-for-diagnosis")
        recordSupabaseLifecycle({ repos: deps.repos, runId: context.runId, waveId: context.waveId, branchRef: context.branchRef, step: "branch_creation", status: "retained", reason: err instanceof Error ? err.message : "Supabase branch polling failed" })
        return { ok: false, context: { status, reason: err instanceof Error ? err.message : "Supabase branch polling failed" } }
      }
    },
    async validateBranch(context: SupabaseWorkspaceContext): Promise<SupabaseAdapterResult> {
      if (!context.workspaceRoot || !context.projectRef || !context.branchRef) return { ok: false, context: { error: "validation_context_required" } }
      if (context.runId) deps.repos.setRunSupabaseLifecycleState(context.runId, "validating")
      recordSupabaseLifecycle({ repos: deps.repos, runId: context.runId, waveId: context.waveId, branchRef: context.branchRef, step: "migrations", status: "in_progress" })
      try {
        const records = await applySupabaseMigrationsAndSeeds({
          workspaceRoot: context.workspaceRoot,
          projectRef: context.projectRef,
          branchRef: context.branchRef,
          client: deps.client,
        })
        const smoke = migrationSmoke(records)
        if (!smoke.ok) throw new Error(smoke.reason)
        if (context.runId) deps.repos.setRunSupabaseLifecycleState(context.runId, "validated")
        recordSupabaseLifecycle({ repos: deps.repos, runId: context.runId, waveId: context.waveId, branchRef: context.branchRef, step: "migrations", status: "passed" })
        recordSupabaseLifecycle({ repos: deps.repos, runId: context.runId, waveId: context.waveId, branchRef: context.branchRef, step: "seed", status: "passed" })
        recordSupabaseLifecycle({ repos: deps.repos, runId: context.runId, waveId: context.waveId, branchRef: context.branchRef, step: "db_tests", status: "passed" })
        return { ok: true, context: { status: "validated", applied: records } }
      } catch (err) {
        if (context.runId) deps.repos.setRunSupabaseLifecycleState(context.runId, "retained-for-diagnosis")
        recordSupabaseLifecycle({ repos: deps.repos, runId: context.runId, waveId: context.waveId, branchRef: context.branchRef, step: "migrations", status: "retained", reason: err instanceof Error ? err.message : "Validation failed" })
        return { ok: false, context: { status: "retained-for-diagnosis", failingStep: "migration-seed", message: err instanceof Error ? err.message : "Validation failed" } }
      }
    },
    async destroyBranch(context: SupabaseWorkspaceContext): Promise<SupabaseAdapterResult> {
      if (!context.projectRef || !context.branchRef || !deps.client.deleteBranch) return { ok: false, context: { error: "destroy_context_required" } }
      try {
        recordSupabaseLifecycle({ repos: deps.repos, runId: context.runId, waveId: context.waveId, branchRef: context.branchRef, step: "cleanup", status: "in_progress" })
        await deps.client.deleteBranch(context.projectRef, context.branchRef)
        if (context.runId) deps.repos.setRunSupabaseLifecycleState(context.runId, "destroyed")
        recordSupabaseLifecycle({ repos: deps.repos, runId: context.runId, waveId: context.waveId, branchRef: context.branchRef, step: "cleanup", status: "passed" })
        return { ok: true, context: { status: "destroyed", branchRef: context.branchRef } }
      } catch (err) {
        const status = (err as { status?: number }).status
        // QA-023: Supabase has been observed to return 410 Gone for branches
        // already deleted (race between two destroy attempts, or replay after
        // a crash). Treat 410 as success — same semantics as 404.
        if (status === 404 || status === 410) {
          recordSupabaseLifecycle({ repos: deps.repos, runId: context.runId, waveId: context.waveId, branchRef: context.branchRef, step: "cleanup", status: "passed" })
          return { ok: true, context: { status: "destroyed", branchRef: context.branchRef, idempotent: true } }
        }
        if (context.runId) deps.repos.setRunSupabaseLifecycleState(context.runId, "retained-for-diagnosis")
        recordSupabaseLifecycle({ repos: deps.repos, runId: context.runId, waveId: context.waveId, branchRef: context.branchRef, step: "cleanup", status: "retained", reason: err instanceof Error ? err.message : "Destroy failed" })
        return { ok: false, context: { status: "retained-for-diagnosis", message: err instanceof Error ? err.message : "Destroy failed" } }
      }
    },
    async reconcile(context: SupabaseWorkspaceContext): Promise<SupabaseAdapterResult> {
      if (!context.workspaceId || !context.workspaceKey || !context.projectRef) return { ok: false, context: { error: "reconcile_context_required" } }
      const branches = await deps.client.listBranches(context.projectRef)
      const prefix = ownedWaveBranchPrefix(context.workspaceKey)
      const runs = deps.repos.listRuns()
      const classifications = branches
        .filter(branch => (branch.name ?? "").startsWith(prefix))
        .map(branch => {
          const run = runs.find(candidate => candidate.supabase_branch_ref === branch.ref || candidate.supabase_branch_name === branch.name)
          const status = branch.status ?? ""
          if (!run || /error|failed/i.test(status)) return { branchRef: branch.ref, branchName: branch.name, classification: "retained-for-diagnosis" }
          if (run.status === "completed") return { branchRef: branch.ref, branchName: branch.name, runId: run.id, classification: "cleanup-candidate" }
          deps.repos.setRunSupabaseBranch(run.id, { ref: branch.ref, name: branch.name ?? branch.ref, lifecycleState: status === "ACTIVE_HEALTHY" ? "ready" : run.supabase_branch_lifecycle_state ?? "provisioning" })
          return { branchRef: branch.ref, branchName: branch.name, runId: run.id, classification: "adoptable" }
        })
      return { ok: true, context: { classifications } }
    },
    async migrateProduction(context: SupabaseWorkspaceContext): Promise<SupabaseAdapterResult> {
      if (!context.workspaceRoot || !context.projectRef) return { ok: false, context: { error: "production_migration_context_required" } }
      const branchRef = context.branchRef ?? "production"
      try {
        const files = listSupabaseSqlFiles(context.workspaceRoot)
        // QA-009: ensure the tracking table exists before consulting it.
        // CREATE TABLE IF NOT EXISTS makes this safe across reruns and
        // across cold-starts on a fresh production database.
        await deps.client.runQuery(context.projectRef, branchRef, MIGRATION_TRACKING_TABLE_SQL)
        const alreadyApplied = await fetchAppliedMigrationFilenames(deps.client, context.projectRef, branchRef)
        const applied: string[] = []
        for (const file of files.migrations) {
          const filename = relative(context.workspaceRoot, file)
          if (alreadyApplied.has(filename)) continue
          // Each migration runs inside its own BEGIN/COMMIT alongside the
          // tracking-table INSERT. A failure rolls back both the schema
          // change and the tracking row, so a subsequent retry only
          // re-attempts files that did not commit.
          const body = readFileSync(file, "utf8")
          const wrapped = wrapMigrationInTransaction(body, filename)
          await deps.client.runQuery(context.projectRef, branchRef, wrapped)
          applied.push(filename)
        }
        return { ok: true, context: { applied } }
      } catch (err) {
        const failureContext: Record<string, unknown> = {
          error: "production_migration_failed",
          message: err instanceof Error ? err.message : "Production migration failed",
        }
        if (err instanceof SupabaseManagementError && err.kind === "rate_limit" && err.retryAfter) {
          failureContext.retryAfter = err.retryAfter
        }
        return { ok: false, context: failureContext }
      }
    },
  }
}

export async function recreatePersistentTestBranch(input: {
  repos: Repos
  adapter: SupabaseAdapter
  workspaceId: string
  projectRef: string
  branchRef: string
  branchName: string
  workspaceRoot: string
}): Promise<SupabaseAdapterResult> {
  const destroyed = await input.adapter.destroyBranch({ workspaceId: input.workspaceId, projectRef: input.projectRef, branchRef: input.branchRef })
  if (!destroyed.ok) {
    input.repos.setWorkspaceSupabasePersistentBranch(input.workspaceId, { ref: input.branchRef, name: input.branchName, status: "retained-for-diagnosis" })
    return { ok: false, context: { status: "retained-for-diagnosis", error: "destroy_failed" } }
  }
  const provisioned = await input.adapter.provisionBranch({ workspaceId: input.workspaceId, projectRef: input.projectRef, workspaceRoot: input.workspaceRoot, branchRef: input.branchRef })
  if (!provisioned.ok) {
    input.repos.setWorkspaceSupabasePersistentBranch(input.workspaceId, { ref: input.branchRef, name: input.branchName, status: "retained-for-diagnosis" })
    return { ok: false, context: { status: "retained-for-diagnosis", error: "recreate_failed", details: provisioned.context ?? null } }
  }
  return { ok: true, context: { status: "ready", branchRef: provisioned.context?.branchRef } }
}
