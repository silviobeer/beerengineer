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
        if (context.parentBranchRef === "main" || context.parentBranchRef === "production") {
          return { ok: false, context: { error: "invalid_parent", message: "Wave branches must fork from the persistent test branch" } }
        }
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
