import { randomUUID } from "node:crypto"
import type { Db } from "../../db/connection.js"

export type SupabaseDeferredCleanupJob = {
  id: string
  workspace_id: string
  branch_ref: string
  run_id: string | null
  wave_id: string | null
  handoff_path: string | null
  scheduled_at: number
  created_at: number
}

export class SupabaseDeferredCleanupStore {
  constructor(private readonly db: Db) {}

  schedule(input: {
    workspaceId: string
    branchRef: string
    runId?: string | null
    waveId?: string | null
    handoffPath?: string | null
    scheduledAt: number
  }): SupabaseDeferredCleanupJob {
    const row: SupabaseDeferredCleanupJob = {
      id: randomUUID(),
      workspace_id: input.workspaceId,
      branch_ref: input.branchRef,
      run_id: input.runId ?? null,
      wave_id: input.waveId ?? null,
      handoff_path: input.handoffPath ?? null,
      scheduled_at: input.scheduledAt,
      created_at: Date.now(),
    }
    this.db.prepare(
      `INSERT INTO supabase_deferred_cleanup
       (id, workspace_id, branch_ref, run_id, wave_id, handoff_path, scheduled_at, created_at)
       VALUES (@id, @workspace_id, @branch_ref, @run_id, @wave_id, @handoff_path, @scheduled_at, @created_at)
       ON CONFLICT(workspace_id, branch_ref) DO UPDATE SET
         run_id = excluded.run_id,
         wave_id = excluded.wave_id,
         handoff_path = excluded.handoff_path,
         scheduled_at = excluded.scheduled_at`,
    ).run(row)
    return this.get(input.workspaceId, input.branchRef)!
  }

  get(workspaceId: string, branchRef: string): SupabaseDeferredCleanupJob | undefined {
    return this.db.prepare("SELECT * FROM supabase_deferred_cleanup WHERE workspace_id = ? AND branch_ref = ?").get(workspaceId, branchRef) as SupabaseDeferredCleanupJob | undefined
  }

  listDue(now = Date.now()): SupabaseDeferredCleanupJob[] {
    return this.db.prepare("SELECT * FROM supabase_deferred_cleanup WHERE scheduled_at <= ? ORDER BY scheduled_at ASC").all(now) as SupabaseDeferredCleanupJob[]
  }

  remainingHours(workspaceId: string, branchRef: string, now = Date.now()): number | null {
    const job = this.get(workspaceId, branchRef)
    if (!job) return null
    return Math.max(0, Math.floor((job.scheduled_at - now) / 3_600_000))
  }

  delete(workspaceId: string, branchRef: string): void {
    this.db.prepare("DELETE FROM supabase_deferred_cleanup WHERE workspace_id = ? AND branch_ref = ?").run(workspaceId, branchRef)
  }
}
