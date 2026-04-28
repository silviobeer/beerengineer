import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { layout, type WorkflowContext } from "./workspaceLayout.js"

export type RecoveryCause =
  | "review_limit"
  | "review_block"
  | "story_error"
  | "stage_error"
  | "system_error"
  | "worktree_port_pool_exhausted"
  | "merge_gate_cancelled"
  | "merge_gate_failed"

export type RecoveryStatus = "blocked" | "failed"

export type RecoveryScope =
  | { type: "stage"; runId: string; stageId: string }
  | { type: "story"; runId: string; waveNumber: number; storyId: string }
  | { type: "run"; runId: string }

export type RecoveryFinding = {
  source: string
  severity: string
  message: string
}

export type RecoveryRecord = {
  status: RecoveryStatus
  cause: RecoveryCause
  scope: RecoveryScope
  summary: string
  detail?: string
  branch?: string
  evidencePaths: string[]
  findings?: RecoveryFinding[]
  createdAt: string
  updatedAt: string
}

function nowIso(): string {
  return new Date().toISOString()
}

/** Resolve the single canonical `recovery.json` path for a scope. */
export function recoveryFilePath(
  ctx: WorkflowContext,
  scope: RecoveryScope,
): string {
  switch (scope.type) {
    case "stage":
      return join(layout.stageDir(ctx, scope.stageId), "recovery.json")
    case "story":
      return join(
        layout.executionRalphDir(ctx, scope.waveNumber, scope.storyId),
        "recovery.json",
      )
    case "run":
      return join(layout.runDir(ctx), "recovery.json")
  }
}

/** Projection key stored on `runs.recovery_scope_ref`. */
export function scopeRef(scope: RecoveryScope): string | null {
  switch (scope.type) {
    case "stage":
      return scope.stageId
    case "story":
      return `${scope.waveNumber}/${scope.storyId}`
    case "run":
      return null
  }
}

export async function writeRecoveryRecord(
  ctx: WorkflowContext,
  record: Omit<RecoveryRecord, "createdAt" | "updatedAt">,
): Promise<RecoveryRecord> {
  const path = recoveryFilePath(ctx, record.scope)
  await mkdir(dirname(path), { recursive: true })
  const existing = await readRecoveryRecord(ctx, record.scope)
  const createdAt = existing?.createdAt ?? nowIso()
  const next: RecoveryRecord = { ...record, createdAt, updatedAt: nowIso() }
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`)
  return next
}

export async function readRecoveryRecord(
  ctx: WorkflowContext,
  scope: RecoveryScope,
): Promise<RecoveryRecord | undefined> {
  try {
    const raw = await readFile(recoveryFilePath(ctx, scope), "utf8")
    return JSON.parse(raw) as RecoveryRecord
  } catch {
    return undefined
  }
}
